# Track 6 — Utilities, Smart Metering & Dry Stack Concierge: Design Spec
Date: 2026-05-07
Scope: Smart meter IoT integration (auto-polling, outage detection, OFGEM reporting, hourly trends), utility prepayment (portal top-up via Stripe, auto-deduct, low-balance alerts), service bollard management (registry, remote switching, fault log), wash token management (generate/sell/redeem), forklift operator tablet interface (separate route, full-screen large-font UI, assignment-by-assignment flow), concierge pick-ticket / valet services (service catalogue, pick-ticket linked to launch request, battery charge queue), no-show prevention (confirmation cut-off, grace period, no-show fee auto-charge).

> Spec status: Final — reviewed 2026-05-08

---

## 1. Architectural Goal

The current Billing screen has a "Utility Meters" tab that is a stub — it shows a placeholder message and a single "Enter Readings" button with no backend. Meter readings are manual-entry only. The dry stack launch queue (Boatyard screen) handles basic haul-out scheduling but has no concierge layer, no operator tablet interface, and no no-show enforcement.

This track delivers:

1. A **smart metering layer** — a vendor-abstracted polling service that auto-ingests readings from Rolec and MarineSync hardware (Rolec at launch, MarineSync second); stores hourly time-series data per berth; detects outages; and generates OFGEM-format CSV reports.

2. A **utility prepayment wallet** per member — a prepay balance that auto-deducts as meter readings are ingested; portal top-up via Stripe (Stripe integration is in scope for Track 6); low-balance alerts.

3. A **service bollard registry** — per-bollard records with optional remote switching via vendor API; fault logging wired to the maintenance `WorkOrder` pipeline.

4. A **wash token system** — single-use or time-limited tokens for showers/laundry; sold via portal or at the desk; redeemed by entering a 6-digit alphanumeric PIN code at a facility keypad; all revenue flows through `ChargeableItem` → `InvoiceLineItem`.

5. A **forklift tablet UI** at the route `/field/forklift` — a separate, full-screen, large-font React app mode mounted under the existing Field app router; authenticates with the same JWT but a strict role check limited to the `forklift_operator` role (plus `yard_manager` and `admin`); the `forklift_operator` role is locked to the tablet UI — logging in on any other device immediately redirects to `/field/forklift`; renders one assignment card at a time.

6. A **concierge pick-ticket** model on `LaunchRequest` — a service catalogue for valet add-ons selectable by boaters directly on the portal confirmation screen, a battery charge queue (billed as a flat fee per session via a `ChargeableItem`), and all charges billed through `ChargeableItem`.

7. A **no-show prevention** workflow on `LaunchRequest` — confirmation cut-off, auto-reminder, no-show logging, and fee auto-charge. The no-show grace period defaults to 30 minutes and is configurable per marina via a `no_show_grace_minutes` field on the Marina settings. The no-show fee is a `ChargeableItem` named "No-Show Penalty" (category=`service`); the Celery enforcement job looks up this item at runtime.

All new charges flow through the existing `ChargeableItem` → `InvoiceLineItem` → `Invoice` billing pipeline. No parallel pricing mechanism is introduced.

---

## 2. Data Models (Django class definitions)

All new models live in a new Django app: **`utilities`**. The dry stack additions are extensions to the existing **`boatyard`** app. Vendor credentials are stored in a new `UtilityIntegration` model (one record per marina per vendor) with API keys encrypted at rest using `django-fernet-fields`; they are never stored in `SmartMeter` records or in the generic `Marina.settings` JSON field.

### 2a. New app: `utilities`

```python
# backend/apps/utilities/models.py

class UtilityIntegration(models.Model):
    """
    Per-marina, per-vendor credential store for smart meter API access.
    API keys are encrypted at rest (django-fernet-fields).
    """

    class Vendor(models.TextChoices):
        ROLEC      = 'rolec',      'Rolec'
        MARINESYNC = 'marinesync', 'MarineSync'

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='utility_integrations')
    vendor      = models.CharField(max_length=20, choices=Vendor.choices)
    credentials = EncryptedJSONField(help_text='Encrypted dict: api_key, base_url, etc.')
    is_active   = models.BooleanField(default=True)
    last_sync_at = models.DateTimeField(null=True, blank=True)
    last_sync_ok = models.BooleanField(default=True)
    last_sync_error = models.TextField(blank=True)

    class Meta:
        unique_together = ('marina', 'vendor')

    def __str__(self):
        return f'{self.get_vendor_display()} integration for {self.marina}'


class SmartMeter(models.Model):
    """Registry of physical smart meter hardware assigned to a berth."""

    class Vendor(models.TextChoices):
        ROLEC      = 'rolec',      'Rolec'
        MARINESYNC = 'marinesync', 'MarineSync'

    class MeterType(models.TextChoices):
        ELECTRICITY = 'electricity', 'Electricity'
        WATER       = 'water',       'Water'

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='smart_meters')
    berth       = models.ForeignKey('berths.Berth', on_delete=models.SET_NULL, null=True, blank=True, related_name='smart_meters')
    vendor      = models.CharField(max_length=20, choices=Vendor.choices)
    meter_type  = models.CharField(max_length=20, choices=MeterType.choices)
    device_id   = models.CharField(max_length=100, help_text='Vendor device identifier used in API calls')
    label       = models.CharField(max_length=100, blank=True, help_text='Human-readable label, e.g. "A-12 Power"')
    poll_interval_minutes = models.IntegerField(default=60, help_text='How often to poll, in minutes')
    is_active   = models.BooleanField(default=True)
    last_polled = models.DateTimeField(null=True, blank=True)
    is_online   = models.BooleanField(default=True)

    class Meta:
        unique_together = ('marina', 'vendor', 'device_id')
        ordering = ['berth__code', 'meter_type']

    def __str__(self):
        return f'{self.label or self.device_id} ({self.get_vendor_display()} / {self.get_meter_type_display()})'


class MeterReading(models.Model):
    """
    Individual timestamped reading ingested from smart meter hardware.
    Also used for manual readings entered in the Billing UI.

    SCALE WARNING — 17.5M rows/year per marina at 500 meters × 4 reads/hour:
    This table MUST be implemented as either:
      (a) a PostgreSQL declarative range-partitioned table partitioned by
          RANGE(recorded_at) with monthly partitions managed by pg_partman, OR
      (b) a TimescaleDB hypertable (SELECT create_hypertable('utilities_meterreading',
          'recorded_at', chunk_time_interval => INTERVAL '1 month')).
    Standard unpartitioned Django model is not viable at production scale.
    The choice between (a) and (b) is made at deployment time; the ORM model
    definition is identical — partitioning is configured in the migration.
    """
    meter       = models.ForeignKey(SmartMeter, on_delete=models.CASCADE, related_name='readings')
    reading_kwh = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True,
                                      help_text='Cumulative kWh (electricity meters)')
    reading_m3  = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True,
                                      help_text='Cumulative m³ (water meters)')
    recorded_at = models.DateTimeField(db_index=True)
    source      = models.CharField(max_length=20, default='auto',
                                   choices=[('auto', 'Auto-poll'), ('manual', 'Manual entry')])

    class Meta:
        ordering = ['recorded_at']
        indexes = [models.Index(fields=['meter', 'recorded_at'])]

    def __str__(self):
        return f'{self.meter} @ {self.recorded_at}'


class MeterOutageAlert(models.Model):
    """
    Created when a SmartMeter stops reporting within its expected poll window.
    Resolved when polling resumes.
    """
    meter       = models.ForeignKey(SmartMeter, on_delete=models.CASCADE, related_name='outage_alerts')
    started_at  = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    notified    = models.BooleanField(default=False)

    class Meta:
        ordering = ['-started_at']

    def __str__(self):
        return f'Outage: {self.meter} from {self.started_at}'


class UtilityWallet(models.Model):
    """
    Prepayment wallet per member per marina.
    Balance is held in pence/cents as a Decimal to avoid float drift.
    Members top up via Stripe (portal) or staff can load manually.
    A last_low_balance_alert timestamp prevents duplicate alert emails within 24h.
    """
    marina  = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='utility_wallets')
    member  = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='utility_wallets')
    balance = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    low_balance_threshold = models.DecimalField(max_digits=8, decimal_places=2, default=10.00,
                                                help_text='Alert fires when balance drops below this amount')
    auto_deduct_enabled = models.BooleanField(default=False,
                                              help_text='Member has opted in to automatic charge deduction from wallet')
    last_low_balance_alert = models.DateTimeField(null=True, blank=True,
                                                  help_text='Timestamp of last low-balance alert; used to suppress duplicate notifications within 24h')

    class Meta:
        unique_together = ('marina', 'member')

    def __str__(self):
        return f'Wallet: {self.member} @ {self.marina} — {self.balance}'


class UtilityWalletTransaction(models.Model):
    """Ledger of every credit and debit against a UtilityWallet."""

    class TxType(models.TextChoices):
        TOP_UP     = 'top_up',     'Top-up (Portal)'
        STAFF_LOAD = 'staff_load', 'Staff Load (Office)'
        DEDUCTION  = 'deduction',  'Charge Deduction'
        REFUND     = 'refund',     'Refund'

    wallet     = models.ForeignKey(UtilityWallet, on_delete=models.CASCADE, related_name='transactions')
    tx_type    = models.CharField(max_length=20, choices=TxType.choices)
    amount     = models.DecimalField(max_digits=10, decimal_places=2,
                                     help_text='Positive = credit, negative = debit')
    balance_after = models.DecimalField(max_digits=10, decimal_places=2)
    description   = models.CharField(max_length=300, blank=True)
    stripe_payment_intent = models.CharField(max_length=100, blank=True,
                                             help_text='Set when tx_type=top_up and funded via Stripe')
    invoice_line  = models.ForeignKey('billing.InvoiceLineItem', on_delete=models.SET_NULL,
                                      null=True, blank=True, related_name='wallet_deductions',
                                      help_text='Set when tx_type=deduction')
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.get_tx_type_display()} {self.amount} for {self.wallet.member}'


class ServiceBollard(models.Model):
    """Shore power service bollard physical registry."""

    class BollardStatus(models.TextChoices):
        ACTIVE      = 'active',      'Active'
        FAULT       = 'fault',       'Fault — Power Unavailable'
        SUSPENDED   = 'suspended',   'Suspended (Account)'
        OFFLINE     = 'offline',     'Offline / Decommissioned'

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='service_bollards')
    berth         = models.ForeignKey('berths.Berth', on_delete=models.SET_NULL, null=True, blank=True, related_name='service_bollards')
    label         = models.CharField(max_length=100, help_text='Physical label on bollard, e.g. "A-12-P1"')
    max_amps      = models.IntegerField(default=16)
    voltage       = models.IntegerField(default=230)
    has_remote_switch = models.BooleanField(default=False)
    vendor        = models.CharField(max_length=20, blank=True,
                                     help_text='Remote switch vendor (e.g. rolec); blank if manual-only')
    vendor_device_id = models.CharField(max_length=100, blank=True)
    status        = models.CharField(max_length=20, choices=BollardStatus.choices, default='active')
    smart_meter   = models.ForeignKey(SmartMeter, on_delete=models.SET_NULL, null=True, blank=True,
                                      related_name='bollards', help_text='Associated smart electricity meter')
    notes         = models.TextField(blank=True)

    class Meta:
        ordering = ['label']
        unique_together = ('marina', 'label')

    def __str__(self):
        return f'{self.label} ({self.marina})'


class BollardFaultLog(models.Model):
    """
    Fault events for a service bollard. Creating a fault log record
    also creates a WorkOrder in the boatyard app (see service layer).
    """

    class FaultType(models.TextChoices):
        SUPPLY_FAILURE   = 'supply_failure',   'Supply Failure'
        OVERCURRENT_TRIP = 'overcurrent_trip', 'Overcurrent Trip'
        COMMS_ERROR      = 'comms_error',      'Communications Error'
        OTHER            = 'other',            'Other'

    bollard      = models.ForeignKey(ServiceBollard, on_delete=models.CASCADE, related_name='fault_logs')
    fault_type   = models.CharField(max_length=30, choices=FaultType.choices)
    description  = models.TextField(blank=True)
    reported_at  = models.DateTimeField(auto_now_add=True)
    resolved_at  = models.DateTimeField(null=True, blank=True)
    work_order   = models.ForeignKey('boatyard.WorkOrder', on_delete=models.SET_NULL,
                                     null=True, blank=True, related_name='bollard_faults')

    class Meta:
        ordering = ['-reported_at']

    def __str__(self):
        return f'Fault: {self.bollard} — {self.get_fault_type_display()}'


class BollardSwitchEvent(models.Model):
    """Audit log of every remote on/off command sent to a bollard."""

    class Action(models.TextChoices):
        ON  = 'on',  'Power On'
        OFF = 'off', 'Power Off'

    bollard    = models.ForeignKey(ServiceBollard, on_delete=models.CASCADE, related_name='switch_events')
    action     = models.CharField(max_length=5, choices=Action.choices)
    triggered_by = models.ForeignKey('accounts.User', on_delete=models.SET_NULL, null=True, blank=True)
    reason     = models.CharField(max_length=300, blank=True)
    success    = models.BooleanField(default=True)
    vendor_response = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class WashToken(models.Model):
    """
    Single-use or time-limited access token for coin-free facilities.
    Redeemed by entering a 6-digit alphanumeric PIN code at a facility keypad.
    The keypad is the mandated redemption mechanism — QR and NFC are not supported.
    """

    class Facility(models.TextChoices):
        SHOWER  = 'shower',  'Shower'
        LAUNDRY = 'laundry', 'Laundry'
        CARWASH = 'carwash', 'Car Wash'

    class TokenStatus(models.TextChoices):
        ISSUED   = 'issued',   'Issued'
        REDEEMED = 'redeemed', 'Redeemed'
        EXPIRED  = 'expired',  'Expired'
        VOIDED   = 'voided',   'Voided'

    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='wash_tokens')
    member       = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True,
                                     related_name='wash_tokens', help_text='Null for walk-in cash sales')
    facility     = models.CharField(max_length=20, choices=Facility.choices)
    token_code   = models.CharField(max_length=20, db_index=True,
                                    help_text='6-digit alphanumeric PIN displayed on receipt / sent via SMS. '
                                              'Unique within a marina, not globally — the redeem endpoint MUST '
                                              'scope lookup to the requesting marina via hardware_id or marina_api_key '
                                              'header to prevent cross-marina token collision.')
    status       = models.CharField(max_length=20, choices=TokenStatus.choices, default='issued')
    expires_at   = models.DateTimeField(null=True, blank=True,
                                        help_text='Null = single-use token, not time-bounded')
    issued_at    = models.DateTimeField(auto_now_add=True)
    redeemed_at  = models.DateTimeField(null=True, blank=True)
    invoice_line = models.ForeignKey('billing.InvoiceLineItem', on_delete=models.SET_NULL,
                                     null=True, blank=True, related_name='wash_tokens',
                                     help_text='The sale line item; set when sold')
    chargeable_item = models.ForeignKey('billing.ChargeableItem', on_delete=models.PROTECT,
                                        related_name='wash_tokens',
                                        help_text='Pricing rule used at point of sale')

    class Meta:
        ordering = ['-issued_at']
        unique_together = ('marina', 'token_code')

    def __str__(self):
        return f'Token {self.token_code} ({self.facility}) — {self.status}'
```

### 2b. Boatyard app extensions

```python
# Additions to backend/apps/boatyard/models.py
# (Do not replace the existing file; add these models and fields.)

class ConciergeCatalogueItem(models.Model):
    """
    Marina-defined valet services that can be added to a launch request.
    Boaters select services themselves when confirming a launch request on the portal.
    All items are priced through ChargeableItem.
    """

    class ServiceTiming(models.TextChoices):
        BEFORE_LAUNCH  = 'before_launch',  'Before Launch'
        AFTER_RETRIEVAL = 'after_retrieval', 'After Retrieval'
        AT_PICKUP      = 'at_pickup',      'At Customer Pick-up'

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='concierge_items')
    name            = models.CharField(max_length=200, help_text='e.g. "Vessel Wash-down", "Fuel Pre-fill"')
    description     = models.TextField(blank=True)
    timing          = models.CharField(max_length=20, choices=ServiceTiming.choices, default='before_launch')
    estimated_minutes = models.IntegerField(default=15, help_text='Estimated prep time in minutes')
    chargeable_item = models.ForeignKey('billing.ChargeableItem', on_delete=models.PROTECT,
                                        related_name='concierge_items')
    is_active       = models.BooleanField(default=True)
    sort_order      = models.IntegerField(default=0)

    class Meta:
        ordering = ['sort_order', 'name']
        unique_together = ('marina', 'name')

    def __str__(self):
        return f'{self.name} ({self.marina})'


# Extend LaunchRequest with the concierge / no-show fields:
# Add via migration to the existing LaunchRequest model.

# New fields on LaunchRequest:
#
#   requested_at   = models.DateTimeField(auto_now_add=True)   # rename created_at → requested_at in migration
#   scheduled_for  = models.DateTimeField(null=True, blank=True)
#   confirmed_by_customer = models.BooleanField(default=False)
#   confirmation_deadline = models.DateTimeField(null=True, blank=True,
#       help_text='Operator-set cut-off; reminder fires 2h before this')
#   arrived_at     = models.DateTimeField(null=True, blank=True,
#       help_text='Timestamp when owner physically arrives at dock')
#   no_show        = models.BooleanField(default=False)
#   no_show_fee_line = models.ForeignKey('billing.InvoiceLineItem', on_delete=models.SET_NULL,
#       null=True, blank=True, related_name='no_show_launch_requests')
#   pick_ticket_complete = models.BooleanField(default=False,
#       help_text='True when all PickTicketLine items are marked done by dock team')
#
# Note: created_at already exists; add scheduled_for and the concierge fields as new columns.


class PickTicket(models.Model):
    """
    Concierge work-list attached to a LaunchRequest.
    One PickTicket per LaunchRequest; created automatically when concierge
    services are selected by the boater (via portal) or office staff.
    """
    launch_request = models.OneToOneField('boatyard.LaunchRequest', on_delete=models.CASCADE,
                                          related_name='pick_ticket')
    created_at     = models.DateTimeField(auto_now_add=True)
    completed_at   = models.DateTimeField(null=True, blank=True)
    assigned_to    = models.CharField(max_length=200, blank=True)

    def __str__(self):
        return f'PickTicket for LaunchRequest #{self.launch_request_id}'


class PickTicketLine(models.Model):
    """Individual concierge service line within a PickTicket."""

    class LineStatus(models.TextChoices):
        PENDING   = 'pending',   'Pending'
        DONE      = 'done',      'Done'
        SKIPPED   = 'skipped',   'Skipped'

    pick_ticket      = models.ForeignKey(PickTicket, on_delete=models.CASCADE, related_name='lines')
    catalogue_item   = models.ForeignKey('boatyard.ConciergeCatalogueItem', on_delete=models.PROTECT)
    status           = models.CharField(max_length=20, choices=LineStatus.choices, default='pending')
    completed_at     = models.DateTimeField(null=True, blank=True)
    invoice_line     = models.ForeignKey('billing.InvoiceLineItem', on_delete=models.SET_NULL,
                                         null=True, blank=True, related_name='pick_ticket_lines')
    notes            = models.TextField(blank=True)

    class Meta:
        ordering = ['catalogue_item__sort_order']


class ForkliftDeviceToken(models.Model):
    """
    Long-lived device token that authenticates a shared forklift tablet to a marina
    without a per-user browser session. Tablets run 24/7 and must survive Wi-Fi blips,
    shift changes, and power cycles — standard JWT (short-lived, user-bound) is not viable.

    Auth pattern:
      - Token is generated once per tablet and stored on the device (e.g. .env / local storage).
      - Every API request from the tablet includes the header:
          X-Forklift-Device-Token: <token>
      - The backend resolves the marina from the token; individual operator identity
        is captured via a 4-digit PIN included in each mutating request body
        (e.g. {"rack": "A1", "operator_pin": "1234"}).
      - The PIN is validated server-side against the operator's staff record
        (NOT used as a browser session login).
      - Tokens do not expire automatically; they are revoked manually via the admin
        panel or via DELETE /api/v1/boatyard/forklift-device-tokens/{id}/.
    """
    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='forklift_device_tokens')
    label        = models.CharField(max_length=100, help_text='Human label, e.g. "Yard Tablet #1"')
    token        = models.CharField(max_length=64, unique=True, db_index=True)
    is_active    = models.BooleanField(default=True)
    # NOTE: Tokens should be deactivated (not deleted) when a device is retired or reassigned,
    # preserving the audit trail of which device processed which job.
    created_by   = models.ForeignKey('accounts.User', on_delete=models.SET_NULL, null=True, blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['label']

    def __str__(self):
        return f'{self.label} ({self.marina})'


class BatteryChargeRequest(models.Model):
    """
    Dedicated queue for vessels requiring battery charging while on the rack.
    Billed as a flat fee per session via a ChargeableItem (not per kWh).
    Separate from the launch-linked PickTicket to support walk-up requests.
    """

    class ChargeStatus(models.TextChoices):
        QUEUED     = 'queued',     'Queued'
        IN_PROGRESS = 'in_progress', 'Charging'
        COMPLETE   = 'complete',   'Complete'
        NOTIFIED   = 'notified',   'Owner Notified'

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='battery_charge_requests')
    vessel      = models.ForeignKey('vessels.Vessel', on_delete=models.PROTECT, related_name='battery_charge_requests')
    storage_slot = models.ForeignKey('boatyard.StorageSlot', on_delete=models.SET_NULL, null=True, blank=True)
    status      = models.CharField(max_length=20, choices=ChargeStatus.choices, default='queued')
    requested_at = models.DateTimeField(auto_now_add=True)
    started_at  = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    notes       = models.TextField(blank=True)
    invoice_line = models.ForeignKey('billing.InvoiceLineItem', on_delete=models.SET_NULL,
                                     null=True, blank=True, related_name='battery_charge_requests')

    class Meta:
        ordering = ['requested_at']

    def __str__(self):
        return f'BatteryCharge — {self.vessel.name} ({self.status})'
```

---

## 3. Smart Meter Integration Architecture

### 3a. Vendor API abstraction layer

All vendor-specific HTTP logic is isolated behind a common interface. The launch priority is **Rolec first** (dominant in European/UK marinas), followed by **MarineSync** (US market). Metron (legacy serial-protocol hardware) is deferred to v2. New vendors are added by implementing the interface without touching any polling, storage, or alert code.

Vendor credentials are stored in the `UtilityIntegration` model (Section 2a) with API keys encrypted at rest via `django-fernet-fields`. The `get_vendor_adapter()` factory reads credentials from `UtilityIntegration`, never from `SmartMeter` records.

```
backend/apps/utilities/
  vendors/
    __init__.py
    base.py            # Abstract base class
    rolec.py           # Rolec Cloud API adapter (launch vendor)
    marinesync.py      # MarineSync API adapter (second vendor)
  services/
    poll_service.py    # Orchestrates polling for a marina
    outage_service.py  # Outage detection logic
    ofgem_service.py   # OFGEM CSV report generation
```

```python
# utilities/vendors/base.py

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal


@dataclass
class VendorReading:
    device_id: str
    recorded_at: datetime
    cumulative_kwh: Decimal | None = None
    cumulative_m3: Decimal | None  = None


class BaseMeterVendor(ABC):
    """
    Implement one subclass per hardware vendor.
    Credentials are retrieved from UtilityIntegration (encrypted), not hardcoded.
    """

    @abstractmethod
    def __init__(self, credentials: dict):
        """credentials: decrypted dict from UtilityIntegration.credentials"""

    @abstractmethod
    def fetch_reading(self, device_id: str) -> VendorReading:
        """
        Fetch the latest reading for a single device.
        Raise VendorConnectionError on network/auth failure.
        Raise DeviceNotFoundError if the device_id is unknown to the vendor.
        """

    @abstractmethod
    def fetch_readings_bulk(self, device_ids: list[str]) -> list[VendorReading]:
        """
        Fetch readings for a batch of devices in a single API round-trip.
        Fall back to serial fetch_reading() calls if the vendor has no bulk endpoint.
        """
```

### 3b. Polling job

The polling job is a Celery beat periodic task that runs every 15 minutes. It queries only meters whose `poll_interval_minutes` aligns with the current tick.

```python
# utilities/services/poll_service.py

def poll_all_meters(marina_id: int):
    """
    Entry point called by Celery beat.
    Groups meters by vendor, fetches in bulk per vendor, saves MeterReading rows,
    and runs outage detection for each meter.
    Credentials are loaded from UtilityIntegration for the relevant vendor.
    """
    meters = SmartMeter.objects.filter(marina_id=marina_id, is_active=True)
    by_vendor = group_by(meters, key=lambda m: m.vendor)
    for vendor_key, vendor_meters in by_vendor.items():
        adapter = get_vendor_adapter(vendor_key, marina_id)  # reads UtilityIntegration
        device_ids = [m.device_id for m in vendor_meters]
        try:
            readings = adapter.fetch_readings_bulk(device_ids)
        except VendorConnectionError:
            # Mark all meters for this vendor as potentially offline
            flag_vendor_offline(vendor_meters)
            continue
        save_readings(readings, vendor_meters)
    check_outages(marina_id)
```

**Outage detection logic** (`outage_service.py`):

- For each active `SmartMeter`, compare `last_polled` to `now()`. If `now() - last_polled > poll_interval_minutes * 2`, the meter is overdue.
- If overdue and `is_online=True`: set `is_online=False`, create a `MeterOutageAlert`, send an alert to the marina's maintenance inbox (email or in-app notification).
- If `last_polled` is recent and `is_online=False`: set `is_online=True`, set `alert.resolved_at = now()`.

### 3c. OFGEM report generation

The mandated output format is a **standardised half-hourly aggregated CSV**. XML output is not produced at launch; if a specific regulator later requires an XML schema, an `ofgem_xml_service.py` adapter can be added without modifying the existing service.

```python
# utilities/services/ofgem_service.py

def generate_ofgem_report(marina_id: int, date_from: date, date_to: date) -> bytes:
    """
    Returns a UTF-8 CSV containing:
    - Metering device identifier (SmartMeter.device_id)
    - Berth reference (Berth.code)
    - Period start / end (half-hourly aggregated)
    - Total consumption (kWh or m³)
    - Unit of measure
    Returns raw bytes so the view can stream it as a file download.
    """
```

---

## 4. Forklift Tablet UI Architecture

### 4a. Route and authentication

The forklift UI lives at `/field/forklift`. It is a **separate route** under the existing Field app router, not a mode toggle within the regular Boatyard screen. This keeps the tablet URL bookmarkable and prevents casual navigation away from the tablet view.

**Authentication uses a `ForkliftDeviceToken` (Section 2b), not a per-user JWT session.** Standard JWT is not viable for a shared tablet: the token expires on Wi-Fi drops, session timeouts lock out the next operator, and browser sessions don't survive power cycles. The device token approach:

- A marina admin generates a `ForkliftDeviceToken` once per physical tablet via the admin panel or `POST /api/v1/boatyard/forklift-device-tokens/`. The token value is stored on the device (e.g. as a bookmarked URL query param or in localStorage on a dedicated browser profile).
- Every API request from the tablet includes the header `X-Forklift-Device-Token: <token>`. The DRF authentication backend resolves the marina from the token.
- The tablet stays on the `/field/forklift` URL permanently — no login screen, no session timeout.
- **Individual operator identity** is captured per action: each mutating request body includes `"operator_pin": "1234"`. The backend validates the PIN against the operator's staff record. This is a request-level signature, not a browser session — the operator does not "log in" to the tablet.
- `yard_manager` and `admin` users can still access `/field/forklift` via their normal user JWT when debugging (no device token required for those roles).

The `/field/forklift` route is a full-browser-viewport React component. The parent app shell (sidebar, topbar) is **not rendered** — the component reads the device token from storage and renders its own minimal chrome.

### 4b. Component structure

```
frontend/src/screens/field/
  ForkliftApp.jsx          # Full-screen wrapper — hides shell, manages assignment list
  ForkliftAssignmentCard.jsx  # Single-card assignment view (one per screen)
  ForkliftPutAwayModal.jsx    # Confirmation dialog: put-away rack position input
  ForkliftLeaveOutModal.jsx   # Confirmation dialog: day berth assignment for leave-out
```

### 4c. Interaction flow

The operator's flow is strictly linear — one assignment at a time, no list scrolling:

1. **Unlock** — operator taps the bookmarked URL on the tablet. The tablet is already authenticated via `ForkliftDeviceToken` (no login screen). The `ForkliftApp` component reads the device token from localStorage, sends `GET /api/v1/boatyard/forklift-device-tokens/me/` (token in `X-Forklift-Device-Token` header) to confirm the token is still active, then loads the assignment queue. The operator does not enter credentials to access the tablet; their 4-digit PIN is only required per action (see steps 4–5).

2. **Assignment queue** — the app loads `GET /api/v1/boatyard/launch-requests/?status=scheduled&assigned_to=me&today=true` and displays the count of queued assignments. A large "Start Next Assignment" button is shown.

3. **Active assignment card** (`ForkliftAssignmentCard`) — fills the full screen. Displays:
   - Vessel name (48px bold)
   - Rack position or destination (36px)
   - Pick-ticket items (if any) as a large checklist — operator taps each item to mark done
   - Current status (e.g. "LAUNCHING" or "RETRIEVING") as a coloured banner
   - Two large action buttons at the bottom: `[ Put Away ]` and `[ Leave Out ]`

4. **Put-away flow** — operator taps "Put Away". `ForkliftPutAwayModal` shows a large input for rack position (lane / col / tier) and a large-button numpad for the operator's 4-digit PIN. On confirm: `PATCH /api/v1/boatyard/storage-slots/{id}/` with body `{"vessel": <id>, "operator_pin": "1234"}`, then `PATCH /api/v1/boatyard/launch-requests/{id}/` with `{"status": "retrieved", "operator_pin": "1234"}`. The backend validates the PIN server-side and records the operator on the status change log. Screen returns to the queue.

5. **Leave-out flow** — operator taps "Leave Out". `ForkliftLeaveOutModal` shows available day berths as a large-button grid and a PIN numpad. On confirm: assigns the vessel to the selected day berth with `{"day_berth": <id>, "operator_pin": "1234"}` and sets `status='retrieved'` on the launch request with the same PIN. Screen returns to the queue.

6. **Pick-ticket completion** — as the operator marks each pick-ticket line done, `PATCH /api/v1/boatyard/pick-ticket-lines/{id}/` is called. When all lines are done, `pick_ticket_complete` on the `LaunchRequest` is set automatically by the backend via signal.

**Design constraints for the tablet view:**
- Minimum touch target: 64px height for all interactive elements
- Font size minimum: 24px body, 48px vessel name, 36px rack position
- Background: dark navy (`#0d1b2a`) with high-contrast white text — readable in outdoor light
- No hover states — touch-only interaction model
- No sidebar, no breadcrumbs, no notification bell
- Single action per screen to prevent operator error

---

## 5. API Contract

All endpoints follow the pattern `/api/v1/<app>/<resource>/` with standard DRF `ModelViewSet` unless noted.

### Utilities app

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/utilities/smart-meters/` | List meters (filter: `?berth=`, `?is_online=false`) |
| POST | `/api/v1/utilities/smart-meters/` | Register new meter |
| PATCH | `/api/v1/utilities/smart-meters/{id}/` | Update meter config |
| GET | `/api/v1/utilities/smart-meters/{id}/readings/` | Hourly readings (filter: `?from=`, `?to=`) |
| POST | `/api/v1/utilities/smart-meters/{id}/readings/` | Manual reading entry |
| GET | `/api/v1/utilities/smart-meters/{id}/trend/` | Aggregated hourly trend JSON for charts |
| GET | `/api/v1/utilities/outage-alerts/` | Active outage alerts |
| GET | `/api/v1/utilities/ofgem-report/` | Download OFGEM CSV (query params: `from`, `to`) |
| GET | `/api/v1/utilities/wallets/` | Member wallets (filter: `?member=`) |
| GET | `/api/v1/utilities/wallets/{id}/` | Wallet detail + transaction ledger |
| POST | `/api/v1/utilities/wallets/{id}/top-up/` | Staff manual top-up |
| POST | `/api/v1/utilities/wallets/{id}/stripe-top-up/` | Initiate Stripe Payment Intent for portal top-up |
| POST | `/api/v1/utilities/wallets/{id}/stripe-confirm/` | Confirm Stripe payment and credit wallet |
| GET | `/api/v1/utilities/bollards/` | Bollard registry |
| POST | `/api/v1/utilities/bollards/` | Register bollard |
| PATCH | `/api/v1/utilities/bollards/{id}/` | Update bollard record |
| POST | `/api/v1/utilities/bollards/{id}/switch/` | Remote on/off (body: `{"action": "on"|"off", "reason": "..."}`) |
| GET | `/api/v1/utilities/bollards/{id}/fault-logs/` | Fault history for a bollard |
| POST | `/api/v1/utilities/bollards/{id}/fault-logs/` | Log a new fault |
| GET | `/api/v1/utilities/wash-tokens/` | Token list (filter: `?status=`, `?facility=`) |
| POST | `/api/v1/utilities/wash-tokens/` | Generate and sell a token |
| POST | `/api/v1/utilities/wash-tokens/redeem/` | Redeem by 6-digit PIN code. Requires `X-Hardware-ID` or `X-Marina-API-Key` header to scope the lookup to a specific marina (prevents cross-marina code collision). The view resolves the marina from the header, then executes `WashToken.objects.select_for_update().get(marina=marina, token_code=code, status='issued')` inside `transaction.atomic()`. Returns `400 token_already_redeemed` if status is not `issued`. Body: `{"token_code": "..."}` |

### Boatyard app additions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/boatyard/concierge-catalogue/` | List concierge services |
| POST | `/api/v1/boatyard/concierge-catalogue/` | Add catalogue item |
| PATCH | `/api/v1/boatyard/concierge-catalogue/{id}/` | Update / deactivate |
| GET | `/api/v1/boatyard/pick-tickets/` | List pick-tickets (filter: `?launch_request=`) |
| PATCH | `/api/v1/boatyard/pick-ticket-lines/{id}/` | Mark line done/skipped |
| GET | `/api/v1/boatyard/battery-charge-requests/` | Battery charge queue |
| POST | `/api/v1/boatyard/battery-charge-requests/` | Add to queue |
| PATCH | `/api/v1/boatyard/battery-charge-requests/{id}/` | Update status |
| POST | `/api/v1/boatyard/launch-requests/{id}/confirm/` | Customer confirms launch request |
| POST | `/api/v1/boatyard/launch-requests/{id}/arrive/` | Mark owner arrived (clears no-show timer) |
| POST | `/api/v1/boatyard/launch-requests/{id}/no-show/` | Manually flag no-show + charge fee |
| GET | `/api/v1/boatyard/forklift-device-tokens/` | List device tokens for the marina (admin/yard_manager only) |
| POST | `/api/v1/boatyard/forklift-device-tokens/` | Generate new device token for a tablet |
| DELETE | `/api/v1/boatyard/forklift-device-tokens/{id}/` | Revoke a device token |
| GET | `/api/v1/boatyard/forklift-device-tokens/me/` | Tablet self-check: verify token is active (auth via `X-Forklift-Device-Token` header) |

**Sample response — meter trend data:**

```json
GET /api/v1/utilities/smart-meters/42/trend/?from=2026-05-01&to=2026-05-07

{
  "meter_id": 42,
  "label": "A-12 Power",
  "meter_type": "electricity",
  "period_from": "2026-05-01T00:00:00Z",
  "period_to":   "2026-05-07T23:59:59Z",
  "hourly": [
    { "hour": "2026-05-01T00:00:00Z", "consumption_kwh": "0.312" },
    { "hour": "2026-05-01T01:00:00Z", "consumption_kwh": "0.298" }
  ],
  "period_total_kwh": "47.821"
}
```

**Sample response — bollard switch:**

```json
POST /api/v1/utilities/bollards/7/switch/
{ "action": "off", "reason": "Account suspended — overdue balance" }

→ 200 OK
{
  "bollard_id": 7,
  "action": "off",
  "success": true,
  "switch_event_id": 291,
  "vendor_response": { "status": "ok", "relay": "open" }
}
```

---

## 6. Frontend Architecture

### 6a. Billing screen — Utility Meters tab (replacement)

The existing stub tab (`tab === 'utilities'`) in `Billing.jsx` is replaced with a fully functional view. The tab title remains "Utility Meters".

```
frontend/src/screens/billing/UtilityMetersTab.jsx   # Tab content component
frontend/src/hooks/useSmartMeters.js                # React Query hook for meters + readings
frontend/src/hooks/useUtilityWallets.js             # React Query hook for wallets
frontend/src/components/utility/MeterTrendChart.jsx # Hourly trend sparkline / line chart
frontend/src/components/utility/OutageAlertBanner.jsx
frontend/src/components/utility/WalletDrawer.jsx    # Slide-out wallet + transaction ledger
```

The tab layout:
- Top: `OutageAlertBanner` — sticky banner showing count of offline meters with link to detail.
- Left panel (60%): Meter list table — columns: Berth, Label, Vendor, Type, Last Reading, Consumption (24h), Status badge (Online / Offline). Clicking a row opens a `MeterDetailDrawer` with the `MeterTrendChart` and a manual reading entry form.
- Right panel (40%): Wallet list — member search, wallet balance, last transaction. Clicking a member opens `WalletDrawer`.

### 6b. Utilities screen (new top-level screen)

Add a new sidebar entry: **Utilities** (under Operations group, between Boatyard and Maintenance). Route: `/utilities`.

```
frontend/src/screens/Utilities.jsx         # Screen shell with tabs
```

Tabs:
1. **Bollards** — bollard registry table; remote switch toggle per row; "Log Fault" button; fault log drawer.
2. **Wash Tokens** — issue token form (facility, member search, quantity); token list with status badges; "Redeem" button opens a code-entry modal for the 6-digit PIN.
3. **OFGEM Reports** — date range picker; "Generate Report" button that hits `/api/v1/utilities/ofgem-report/` and triggers a CSV file download.

### 6c. Boatyard screen additions

The existing `Boatyard.jsx` screen adds two new sub-tabs to its tab bar:
1. **Concierge** — catalogue management table (CRUD for `ConciergeCatalogueItem`); battery charge request queue list below.
2. **Pick Tickets** — filterable list of pick-tickets for today's launch requests; status per line; assign dock hand.

### 6d. Forklift app

See Section 4. The forklift app uses its own React hook:

```
frontend/src/hooks/useForkliftQueue.js
  # Fetches /api/v1/boatyard/launch-requests/?status=scheduled&today=true
  # Exposes: queue, activeAssignment, markLineDone, confirmPutAway, confirmLeaveOut
```

All forklift mutations use `useMutation` with `onSuccess` refetching the queue. Optimistic updates are not used — the operator must see the confirmed server state before moving to the next assignment.

### 6e. Customer portal additions

The portal gains two new sections (these are portal-facing components, outside the staff app):

1. **My Utility Balance** — wallet balance display, Stripe top-up button (Apple Pay / card via Stripe hosted flow), transaction history. Boaters can self-serve a top-up at any time, including outside office hours; the wallet credits immediately on Stripe payment confirmation.

2. **Launch Request Confirmation** — the boater receives an email/SMS link; the link opens the portal at `/portal/launch/{token}/confirm`; a large "Confirm Launch" button, a concierge service picker (checkboxes for active `ConciergeCatalogueItem` records), and a summary of charges; tapping confirm calls `POST /api/v1/boatyard/launch-requests/{id}/confirm/` and creates a `PickTicket` if any concierge services were selected.

---

## 7. Background Jobs & Scheduled Tasks

All jobs run in Celery beat. New tasks are registered in `utilities/tasks.py` and `boatyard/tasks.py`.

| Task | Schedule | Description |
|------|----------|-------------|
| `poll_smart_meters` | Every 15 min | Calls `poll_service.poll_all_meters()` for each active marina. Skips meters whose `poll_interval_minutes` does not divide the current tick. |
| `check_meter_outages` | Every 15 min | Runs after `poll_smart_meters` via `chain()`. Sets `is_online=False` and creates `MeterOutageAlert` for overdue meters. Resolves existing alerts for meters that have resumed. |
| `send_low_balance_alerts` | Every 1 hour | Queries `UtilityWallet` records where `balance < low_balance_threshold` and `auto_deduct_enabled=True`. Sends in-app + email notification if `last_low_balance_alert` is null or older than 24h. |
| `auto_deduct_utility_charges` | Every 1 hour | For wallets with `auto_deduct_enabled=True`, calculates consumption since last deduction using the latest `MeterReading` delta. Creates an `InvoiceLineItem` via the billing engine and posts a `UtilityWalletTransaction` debit. **After each deduction, if `wallet.balance <= 0`, the task looks up every `ServiceBollard` linked to the member's active `SmartMeter` berth where `has_remote_switch=True` and `status='active'`, then calls the bollard switch service with `action='off'` (which fires `POST /api/v1/utilities/bollards/{id}/switch/` internally and records a `BollardSwitchEvent` with `reason='Wallet balance exhausted — auto-deduct'`). Power is only restored when the member tops up and `wallet.balance > 0`; the restoration is NOT automatic — staff must manually switch the bollard back on after confirming payment.** |
| `send_launch_confirmation_reminders` | Every 30 min | Queries `LaunchRequest` records where `confirmed_by_customer=False` and `confirmation_deadline` is within 2 hours. Sends reminder email/SMS via the existing communications app. |
| `enforce_no_show` | Every 15 min | Queries `LaunchRequest` records where status is `launching`, `arrived_at` is null, and the marina's `no_show_grace_minutes` has elapsed since `scheduled_for`. Flags `no_show=True`, looks up the "No-Show Penalty" `ChargeableItem`, creates an `InvoiceLineItem` at that price, sends member notification. **Critically: the vessel is physically on the staging dock at this point — the task MUST also create a new `LaunchRequest` with `request_type='retrieval'` and `status='scheduled'` targeting the vessel's original `StorageSlot`. This retrieval task appears in the forklift operator's queue immediately so the dock can be cleared. Without this step the staging dock is deadlocked: the no-show vessel occupies the dock while new launches are queued behind it.** |
| `expire_wash_tokens` | Every 1 hour | Sets `status='expired'` on `WashToken` records where `expires_at < now()` and `status='issued'`. |
| `notify_battery_charge_complete` | Continuous (event-driven via signal) | When `BatteryChargeRequest.status` transitions to `'complete'`, fires a Django signal that sends an in-app + email/SMS notification to the vessel owner. |

---

## 8. Implementation Steps (ordered)

Steps are ordered to respect Django migration dependencies and the principle that the billing pipeline must be in place before any charges are introduced.

1. **Create `utilities` Django app** — `python manage.py startapp utilities`; register in `INSTALLED_APPS`; add URL include to the project router.

2. **Write `utilities` migrations** — create all models from Section 2a, including `UtilityIntegration` with `django-fernet-fields` for credential encryption. No foreign key to billing models other than `ChargeableItem` and `InvoiceLineItem` (both already exist).

3. **Add ChargeableItem entries for new charge types** — via a data migration (or documented fixture), create the expected `ChargeableItem` records the marina manager will customise:
   - Utility (kWh): category=`utility`, pricing_model=`per_kwh`
   - Wash Token — Shower: category=`service`, pricing_model=`flat_fee`
   - Wash Token — Laundry: category=`service`, pricing_model=`flat_fee`
   - Concierge — Vessel Wash-down: category=`service`, pricing_model=`flat_fee`
   - Battery Charge: category=`service`, pricing_model=`flat_fee`
   - No-Show Penalty: category=`service`, pricing_model=`flat_fee`

4. **Extend `LaunchRequest` model** — add migration to `boatyard` app: new fields `scheduled_for`, `confirmed_by_customer`, `confirmation_deadline`, `arrived_at`, `no_show`, `no_show_fee_line`, `pick_ticket_complete`.

5. **Add `boatyard` models** — `ConciergeCatalogueItem`, `PickTicket`, `PickTicketLine`, `BatteryChargeRequest` (Section 2b).

6. **Implement vendor abstraction layer** — `utilities/vendors/base.py` + `RolecAdapter` (launch vendor). Stub adapter for MarineSync (to be completed second). Metron is deferred to v2.

7. **Implement `poll_service.py` and `outage_service.py`** — wire to Celery beat. Before writing the first `MeterReading` migration, choose the partitioning strategy: either (a) add `PARTITION BY RANGE (recorded_at)` to the `CREATE TABLE` statement in the migration and configure `pg_partman` to create monthly child partitions, or (b) convert the table to a TimescaleDB hypertable via `SELECT create_hypertable('utilities_meterreading', 'recorded_at', chunk_time_interval => INTERVAL '1 month')` in a post-migration `RunSQL`. The choice is infrastructure-dependent; the ORM code is identical either way. Document the chosen strategy in `docs/infrastructure/meter-readings-partitioning.md`.

8. **Implement `ofgem_service.py`** — generate half-hourly aggregated CSV from `MeterReading` records for a date range.

9. **Build DRF ViewSets for all utilities endpoints** (Section 5) — smart meters, readings, trend, outage alerts, OFGEM download, wallets, top-up (staff + Stripe), bollards, switch, fault logs, wash tokens.

10. **Build DRF ViewSets for boatyard additions** — concierge catalogue, pick-tickets, pick-ticket lines, battery charge requests, launch request confirm/arrive/no-show actions.

11. **Replace Billing "Utility Meters" tab stub** — implement `UtilityMetersTab.jsx`, `useSmartMeters.js`, `useUtilityWallets.js`, `MeterTrendChart.jsx`, `OutageAlertBanner.jsx`, `WalletDrawer.jsx`.

12. **Build new Utilities screen** — `Utilities.jsx` with Bollards, Wash Tokens, and OFGEM Reports tabs; add sidebar entry.

13. **Add Concierge and Pick Tickets tabs to Boatyard screen** — concierge catalogue table, battery charge queue, pick-ticket list.

14. **Build Forklift Tablet UI** — `ForkliftApp.jsx`, `ForkliftAssignmentCard.jsx`, `ForkliftPutAwayModal.jsx`, `ForkliftLeaveOutModal.jsx`, `useForkliftQueue.js` (Section 4). Add `/field/forklift` route. Implement `ForkliftDeviceToken` model, DRF authentication backend (`ForkliftDeviceTokenAuthentication`), and the device token management endpoints. The `ForkliftApp` reads the token from localStorage and sends it in `X-Forklift-Device-Token`; it does not use a user JWT. Add `forklift_operator` role to accounts app; because the tablet uses a device token rather than a user session, the redirect-on-login rule applies only when a `forklift_operator` user authenticates via the normal staff login flow on a non-tablet device.

15. **Implement Celery tasks** — all tasks from Section 7. Wire to beat schedule. Add `no_show_grace_minutes` integer field to Marina settings (default 30). Two critical behaviours must be validated in integration tests: (a) `auto_deduct_utility_charges` cuts the remote relay (`BollardSwitchEvent action='off'`) when `wallet.balance <= 0` after deduction — test with a stubbed bollard switch service; (b) `enforce_no_show` creates a new `LaunchRequest` with `request_type='retrieval'` and `status='scheduled'` pointing to the vessel's original `StorageSlot` — verify the new retrieval request appears in the forklift queue before the test asserts the no-show fee.

16. **Portal additions** — My Utility Balance page with Stripe top-up flow; launch request confirmation page at `/portal/launch/{token}/confirm` with concierge service picker.

17. **QA and integration test pass** — test polling with a stubbed vendor adapter; test no-show enforcement with time-shifted datetimes; test wallet auto-deduction with a mock meter reading ingestion; test Stripe top-up flow in test mode.
