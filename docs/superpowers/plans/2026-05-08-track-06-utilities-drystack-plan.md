# Track 6 — Utilities, Smart Metering & Dry Stack Concierge: Implementation Plan
Date: 2026-05-08
Spec: `docs/superpowers/specs/2026-05-07-track-06-utilities-drystack-design.md`

---

## Overview

Track 6 delivers a new `utilities` Django app and a set of additive extensions to the existing `boatyard` app. The utilities app covers smart meter IoT polling (Rolec first, MarineSync second), a prepayment wallet with Stripe top-up, service bollard remote switching, wash token management, and OFGEM CSV reporting. The boatyard extensions add a concierge pick-ticket layer on `LaunchRequest`, a battery charge queue, no-show enforcement, and a full-screen forklift tablet UI authenticated via a long-lived device token rather than a per-user JWT session.

---

## Gap Analysis: Existing vs Required

### Existing boatyard models

| Model | Gaps for Track 6 |
|---|---|
| `LaunchRequest` | Missing: `scheduled_for`, `confirmed_by_customer`, `confirmation_deadline`, `arrived_at`, `no_show`, `no_show_fee_line`, `pick_ticket_complete`, `request_type` fields. Add via migration — do not replace model. |
| `StorageSlot` | No changes needed. |
| `WorkOrder` | No changes needed (used via FK in `BollardFaultLog`). |

### Existing billing / accounts

| Model | Gaps |
|---|---|
| `billing.ChargeableItem` | No structural changes — data migration (or documented fixture) seeds the required catalogue entries. |
| `billing.Invoice` / `InvoiceLineItem` | No changes — used as-is by all new charge code. |
| `accounts.Marina` | Needs `no_show_grace_minutes = models.IntegerField(default=30)` field. Add in Track 6 migration. |

### What is entirely missing

- New app `apps.utilities` with all its models.
- New boatyard models: `ConciergeCatalogueItem`, `PickTicket`, `PickTicketLine`, `BatteryChargeRequest`, `ForkliftDeviceToken`.
- New boatyard fields on `LaunchRequest` (additive via migration).
- Vendor abstraction layer (`utilities/vendors/`).
- Poll service, outage service, OFGEM service.
- DRF authentication backend `ForkliftDeviceTokenAuthentication`.
- All Celery tasks in `utilities/tasks.py` and new tasks in `boatyard/tasks.py`.

---

## New App: `apps/utilities/`

### App structure

```
backend/apps/utilities/
  __init__.py
  apps.py
  models.py
  serializers.py
  views.py
  urls.py
  admin.py
  tasks.py
  signals.py
  vendors/
    __init__.py
    base.py
    rolec.py
    marinesync.py
  services/
    __init__.py
    poll_service.py
    outage_service.py
    ofgem_service.py
    wallet_service.py
    bollard_service.py
```

### AppConfig

```python
# backend/apps/utilities/apps.py
from django.apps import AppConfig

class UtilitiesConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.utilities'
    verbose_name = 'Utilities & Smart Metering'

    def ready(self):
        import apps.utilities.signals  # noqa
```

---

## Models

### `utilities` app models (`backend/apps/utilities/models.py`)

#### UtilityIntegration

```python
from fernet_fields import EncryptedJSONField  # pip install django-fernet-fields

class UtilityIntegration(models.Model):
    class Vendor(models.TextChoices):
        ROLEC      = 'rolec',      'Rolec'
        MARINESYNC = 'marinesync', 'MarineSync'

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='utility_integrations')
    vendor      = models.CharField(max_length=20, choices=Vendor.choices)
    credentials = EncryptedJSONField(help_text='Encrypted dict: api_key, base_url, etc.')
    is_active    = models.BooleanField(default=True)
    last_sync_at    = models.DateTimeField(null=True, blank=True)
    last_sync_ok    = models.BooleanField(default=True)
    last_sync_error = models.TextField(blank=True)

    class Meta:
        unique_together = ('marina', 'vendor')
```

#### SmartMeter

```python
class SmartMeter(models.Model):
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
    device_id   = models.CharField(max_length=100)
    label       = models.CharField(max_length=100, blank=True)
    poll_interval_minutes = models.IntegerField(default=60)
    is_active   = models.BooleanField(default=True)
    last_polled = models.DateTimeField(null=True, blank=True)
    is_online   = models.BooleanField(default=True)

    class Meta:
        unique_together = ('marina', 'vendor', 'device_id')
        ordering = ['berth__code', 'meter_type']
```

#### MeterReading

```python
class MeterReading(models.Model):
    """
    SCALE WARNING — 17.5M rows/year per marina at 500 meters * 4 reads/hour.
    This table MUST be partitioned. See Migration Notes for options:
    (a) PostgreSQL RANGE partitioning via pg_partman (monthly), or
    (b) TimescaleDB hypertable.
    The ORM definition is identical either way; partitioning is done in the migration.
    """
    meter       = models.ForeignKey(SmartMeter, on_delete=models.CASCADE, related_name='readings')
    reading_kwh = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    reading_m3  = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    recorded_at = models.DateTimeField(db_index=True)
    source      = models.CharField(max_length=20, default='auto',
                                   choices=[('auto', 'Auto-poll'), ('manual', 'Manual entry')])

    class Meta:
        ordering = ['recorded_at']
        indexes = [models.Index(fields=['meter', 'recorded_at'])]
```

#### MeterOutageAlert

```python
class MeterOutageAlert(models.Model):
    meter       = models.ForeignKey(SmartMeter, on_delete=models.CASCADE, related_name='outage_alerts')
    started_at  = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    notified    = models.BooleanField(default=False)

    class Meta:
        ordering = ['-started_at']
```

#### UtilityWallet

```python
class UtilityWallet(models.Model):
    marina  = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='utility_wallets')
    member  = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='utility_wallets')
    balance = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    low_balance_threshold = models.DecimalField(max_digits=8, decimal_places=2, default=10.00)
    auto_deduct_enabled   = models.BooleanField(default=False)
    last_low_balance_alert = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ('marina', 'member')
```

#### UtilityWalletTransaction

```python
class UtilityWalletTransaction(models.Model):
    class TxType(models.TextChoices):
        TOP_UP     = 'top_up',     'Top-up (Portal)'
        STAFF_LOAD = 'staff_load', 'Staff Load (Office)'
        DEDUCTION  = 'deduction',  'Charge Deduction'
        REFUND     = 'refund',     'Refund'

    wallet     = models.ForeignKey(UtilityWallet, on_delete=models.CASCADE, related_name='transactions')
    tx_type    = models.CharField(max_length=20, choices=TxType.choices)
    amount     = models.DecimalField(max_digits=10, decimal_places=2)  # positive=credit, negative=debit
    balance_after = models.DecimalField(max_digits=10, decimal_places=2)
    description   = models.CharField(max_length=300, blank=True)
    stripe_payment_intent = models.CharField(max_length=100, blank=True)
    invoice_line  = models.ForeignKey('billing.InvoiceLineItem', on_delete=models.SET_NULL,
                                      null=True, blank=True, related_name='wallet_deductions')
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
```

#### ServiceBollard

```python
class ServiceBollard(models.Model):
    class BollardStatus(models.TextChoices):
        ACTIVE    = 'active',    'Active'
        FAULT     = 'fault',     'Fault — Power Unavailable'
        SUSPENDED = 'suspended', 'Suspended (Account)'
        OFFLINE   = 'offline',   'Offline / Decommissioned'

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='service_bollards')
    berth         = models.ForeignKey('berths.Berth', on_delete=models.SET_NULL, null=True, blank=True, related_name='service_bollards')
    label         = models.CharField(max_length=100)
    max_amps      = models.IntegerField(default=16)
    voltage       = models.IntegerField(default=230)
    has_remote_switch = models.BooleanField(default=False)
    vendor        = models.CharField(max_length=20, blank=True)
    vendor_device_id = models.CharField(max_length=100, blank=True)
    status        = models.CharField(max_length=20, choices=BollardStatus.choices, default='active')
    smart_meter   = models.ForeignKey(SmartMeter, on_delete=models.SET_NULL, null=True, blank=True, related_name='bollards')
    notes         = models.TextField(blank=True)

    class Meta:
        ordering = ['label']
        unique_together = ('marina', 'label')
```

#### BollardFaultLog

```python
class BollardFaultLog(models.Model):
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
    # Creating a BollardFaultLog also creates a boatyard.WorkOrder via signal
    work_order   = models.ForeignKey('boatyard.WorkOrder', on_delete=models.SET_NULL,
                                     null=True, blank=True, related_name='bollard_faults')

    class Meta:
        ordering = ['-reported_at']
```

#### BollardSwitchEvent

```python
class BollardSwitchEvent(models.Model):
    class Action(models.TextChoices):
        ON  = 'on',  'Power On'
        OFF = 'off', 'Power Off'

    bollard       = models.ForeignKey(ServiceBollard, on_delete=models.CASCADE, related_name='switch_events')
    action        = models.CharField(max_length=5, choices=Action.choices)
    triggered_by  = models.ForeignKey('accounts.User', on_delete=models.SET_NULL, null=True, blank=True)
    reason        = models.CharField(max_length=300, blank=True)
    success       = models.BooleanField(default=True)
    vendor_response = models.JSONField(default=dict, blank=True)
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
```

#### WashToken

```python
class WashToken(models.Model):
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
    member       = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='wash_tokens')
    facility     = models.CharField(max_length=20, choices=Facility.choices)
    token_code   = models.CharField(max_length=20, db_index=True,
                                    help_text='6-digit alphanumeric PIN. Unique within marina; NOT globally unique.')
    status       = models.CharField(max_length=20, choices=TokenStatus.choices, default='issued')
    expires_at   = models.DateTimeField(null=True, blank=True)
    issued_at    = models.DateTimeField(auto_now_add=True)
    redeemed_at  = models.DateTimeField(null=True, blank=True)
    invoice_line    = models.ForeignKey('billing.InvoiceLineItem', on_delete=models.SET_NULL, null=True, blank=True, related_name='wash_tokens')
    chargeable_item = models.ForeignKey('billing.ChargeableItem', on_delete=models.PROTECT, related_name='wash_tokens')

    class Meta:
        ordering = ['-issued_at']
        unique_together = ('marina', 'token_code')
```

### Boatyard app additions (`backend/apps/boatyard/models.py` — append)

#### LaunchRequest new fields (migration only — no model replacement)

```python
# New fields to add to existing LaunchRequest via migration:
# scheduled_for         = DateTimeField(null=True, blank=True)
# confirmed_by_customer = BooleanField(default=False)
# confirmation_deadline = DateTimeField(null=True, blank=True)
# arrived_at            = DateTimeField(null=True, blank=True)
# no_show               = BooleanField(default=False)
# no_show_fee_line      = ForeignKey('billing.InvoiceLineItem', SET_NULL, null=True, blank=True,
#                                     related_name='no_show_launch_requests')
# pick_ticket_complete  = BooleanField(default=False)
# request_type          = CharField(max_length=20, choices=[('launch','Launch'),('retrieval','Retrieval')],
#                                   default='launch')
```

#### ConciergeCatalogueItem

```python
class ConciergeCatalogueItem(models.Model):
    class ServiceTiming(models.TextChoices):
        BEFORE_LAUNCH   = 'before_launch',   'Before Launch'
        AFTER_RETRIEVAL = 'after_retrieval',  'After Retrieval'
        AT_PICKUP       = 'at_pickup',        'At Customer Pick-up'

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='concierge_items')
    name            = models.CharField(max_length=200)
    description     = models.TextField(blank=True)
    timing          = models.CharField(max_length=20, choices=ServiceTiming.choices, default='before_launch')
    estimated_minutes = models.IntegerField(default=15)
    chargeable_item = models.ForeignKey('billing.ChargeableItem', on_delete=models.PROTECT, related_name='concierge_items')
    is_active       = models.BooleanField(default=True)
    sort_order      = models.IntegerField(default=0)

    class Meta:
        ordering = ['sort_order', 'name']
        unique_together = ('marina', 'name')
```

#### PickTicket / PickTicketLine

```python
class PickTicket(models.Model):
    launch_request = models.OneToOneField('boatyard.LaunchRequest', on_delete=models.CASCADE, related_name='pick_ticket')
    created_at     = models.DateTimeField(auto_now_add=True)
    completed_at   = models.DateTimeField(null=True, blank=True)
    assigned_to    = models.CharField(max_length=200, blank=True)


class PickTicketLine(models.Model):
    class LineStatus(models.TextChoices):
        PENDING = 'pending', 'Pending'
        DONE    = 'done',    'Done'
        SKIPPED = 'skipped', 'Skipped'

    pick_ticket    = models.ForeignKey(PickTicket, on_delete=models.CASCADE, related_name='lines')
    catalogue_item = models.ForeignKey('boatyard.ConciergeCatalogueItem', on_delete=models.PROTECT)
    status         = models.CharField(max_length=20, choices=LineStatus.choices, default='pending')
    completed_at   = models.DateTimeField(null=True, blank=True)
    invoice_line   = models.ForeignKey('billing.InvoiceLineItem', on_delete=models.SET_NULL, null=True, blank=True, related_name='pick_ticket_lines')
    notes          = models.TextField(blank=True)

    class Meta:
        ordering = ['catalogue_item__sort_order']
```

#### ForkliftDeviceToken

```python
class ForkliftDeviceToken(models.Model):
    """
    Long-lived device token for a shared forklift tablet.
    Auth pattern: X-Forklift-Device-Token header. Operator identity per-action via operator_pin.
    Deactivate (never delete) when a device is retired — preserves audit trail.
    """
    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='forklift_device_tokens')
    label        = models.CharField(max_length=100)
    token        = models.CharField(max_length=64, unique=True, db_index=True)
    is_active    = models.BooleanField(default=True)
    created_by   = models.ForeignKey('accounts.User', on_delete=models.SET_NULL, null=True, blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['label']
```

#### BatteryChargeRequest

```python
class BatteryChargeRequest(models.Model):
    class ChargeStatus(models.TextChoices):
        QUEUED      = 'queued',      'Queued'
        IN_PROGRESS = 'in_progress', 'Charging'
        COMPLETE    = 'complete',    'Complete'
        NOTIFIED    = 'notified',    'Owner Notified'

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='battery_charge_requests')
    vessel      = models.ForeignKey('vessels.Vessel', on_delete=models.PROTECT, related_name='battery_charge_requests')
    storage_slot = models.ForeignKey('boatyard.StorageSlot', on_delete=models.SET_NULL, null=True, blank=True)
    status      = models.CharField(max_length=20, choices=ChargeStatus.choices, default='queued')
    requested_at = models.DateTimeField(auto_now_add=True)
    started_at  = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    notes       = models.TextField(blank=True)
    invoice_line = models.ForeignKey('billing.InvoiceLineItem', on_delete=models.SET_NULL, null=True, blank=True, related_name='battery_charge_requests')

    class Meta:
        ordering = ['requested_at']
```

### Marina model addition (accounts app migration)

```python
# Append to accounts.Marina
no_show_grace_minutes = models.IntegerField(default=30)
```

---

## Service Layer

### Vendor abstraction (`utilities/vendors/base.py`)

```python
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


class VendorConnectionError(Exception):
    pass

class DeviceNotFoundError(Exception):
    pass


class BaseMeterVendor(ABC):
    @abstractmethod
    def __init__(self, credentials: dict):
        """credentials: decrypted dict from UtilityIntegration.credentials"""

    @abstractmethod
    def fetch_reading(self, device_id: str) -> VendorReading:
        ...

    @abstractmethod
    def fetch_readings_bulk(self, device_ids: list[str]) -> list[VendorReading]:
        ...


def get_vendor_adapter(vendor_key: str, marina_id: int) -> BaseMeterVendor:
    """
    Reads UtilityIntegration for the marina + vendor, decrypts credentials,
    returns the appropriate adapter instance.
    """
    from apps.utilities.models import UtilityIntegration
    integration = UtilityIntegration.objects.get(marina_id=marina_id, vendor=vendor_key, is_active=True)
    if vendor_key == 'rolec':
        from .rolec import RolecAdapter
        return RolecAdapter(integration.credentials)
    elif vendor_key == 'marinesync':
        from .marinesync import MarineSyncAdapter
        return MarineSyncAdapter(integration.credentials)
    raise ValueError(f'Unknown vendor: {vendor_key}')
```

### Polling service (`utilities/services/poll_service.py`)

```python
def poll_all_meters(marina_id: int) -> None:
    """
    Groups active meters by vendor, bulk-fetches readings, saves MeterReading rows,
    updates SmartMeter.last_polled and is_online, then runs outage detection.
    """
    from apps.utilities.models import SmartMeter, MeterReading
    from django.utils import timezone

    meters = SmartMeter.objects.filter(marina_id=marina_id, is_active=True)
    by_vendor = {}
    for m in meters:
        by_vendor.setdefault(m.vendor, []).append(m)

    now = timezone.now()
    for vendor_key, vendor_meters in by_vendor.items():
        adapter = get_vendor_adapter(vendor_key, marina_id)
        device_ids = [m.device_id for m in vendor_meters]
        try:
            readings = adapter.fetch_readings_bulk(device_ids)
        except VendorConnectionError:
            _flag_vendor_offline(vendor_meters)
            continue
        _save_readings(readings, vendor_meters, now)

    check_outages(marina_id)


def _save_readings(readings, meter_map_list, polled_at):
    """Bulk-insert MeterReading rows; update SmartMeter.last_polled."""
    from apps.utilities.models import MeterReading, SmartMeter
    meter_by_device = {m.device_id: m for m in meter_map_list}
    to_create = []
    to_update_pks = []
    for r in readings:
        meter = meter_by_device.get(r.device_id)
        if not meter:
            continue
        to_create.append(MeterReading(
            meter=meter,
            reading_kwh=r.cumulative_kwh,
            reading_m3=r.cumulative_m3,
            recorded_at=r.recorded_at,
            source='auto',
        ))
        to_update_pks.append(meter.pk)

    MeterReading.objects.bulk_create(to_create)
    SmartMeter.objects.filter(pk__in=to_update_pks).update(last_polled=polled_at, is_online=True)
```

### Outage detection service (`utilities/services/outage_service.py`)

```python
def check_outages(marina_id: int) -> None:
    """
    For each active SmartMeter:
    - If now() - last_polled > poll_interval_minutes * 2 AND is_online=True:
        set is_online=False, create MeterOutageAlert, notify maintenance inbox.
    - If last_polled is recent AND is_online=False:
        set is_online=True, resolve open MeterOutageAlert.
    """
    from apps.utilities.models import SmartMeter, MeterOutageAlert
    from django.utils import timezone
    from datetime import timedelta

    now = timezone.now()
    meters = SmartMeter.objects.filter(marina_id=marina_id, is_active=True)
    for meter in meters:
        threshold = timedelta(minutes=meter.poll_interval_minutes * 2)
        overdue = meter.last_polled and (now - meter.last_polled) > threshold

        if overdue and meter.is_online:
            meter.is_online = False
            meter.save(update_fields=['is_online'])
            alert = MeterOutageAlert.objects.create(meter=meter)
            _notify_outage(alert)

        elif not overdue and not meter.is_online:
            meter.is_online = True
            meter.save(update_fields=['is_online'])
            MeterOutageAlert.objects.filter(meter=meter, resolved_at__isnull=True).update(resolved_at=now)
```

### OFGEM report service (`utilities/services/ofgem_service.py`)

```python
def generate_ofgem_report(marina_id: int, date_from, date_to) -> bytes:
    """
    Returns UTF-8 CSV bytes. Aggregates MeterReading rows by 30-minute intervals.
    Columns: device_id, berth_code, period_start, period_end, consumption_kwh, consumption_m3, unit.
    Uses Django ORM Trunc('recorded_at', 'hour') + annotate for aggregation.
    """
    import csv
    import io
    from django.db.models.functions import Trunc
    from django.db.models import Sum
    from apps.utilities.models import MeterReading

    rows = (
        MeterReading.objects
        .filter(
            meter__marina_id=marina_id,
            recorded_at__date__gte=date_from,
            recorded_at__date__lte=date_to,
        )
        .annotate(period=Trunc('recorded_at', 'hour'))
        .values('meter__device_id', 'meter__berth__code', 'period')
        .annotate(total_kwh=Sum('reading_kwh'), total_m3=Sum('reading_m3'))
        .order_by('meter__device_id', 'period')
    )

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=['device_id', 'berth_code', 'period_start', 'period_end', 'consumption_kwh', 'consumption_m3', 'unit'])
    writer.writeheader()
    for row in rows:
        writer.writerow({
            'device_id': row['meter__device_id'],
            'berth_code': row['meter__berth__code'] or '',
            'period_start': row['period'].isoformat(),
            'period_end': row['period'].isoformat(),  # half-hour offset computed if needed
            'consumption_kwh': row['total_kwh'] or '',
            'consumption_m3': row['total_m3'] or '',
            'unit': 'kWh' if row['total_kwh'] else 'm3',
        })

    return buf.getvalue().encode('utf-8')
```

### Wallet service (`utilities/services/wallet_service.py`)

```python
def debit_wallet(wallet, amount, description, invoice_line=None):
    """
    Atomically deduct from wallet. Creates UtilityWalletTransaction.
    Returns updated wallet. Creates low-balance alert if balance drops below threshold.
    Caller checks wallet.balance <= 0 to trigger bollard cut-off.
    """
    from django.db import transaction as db_transaction
    from apps.utilities.models import UtilityWalletTransaction

    with db_transaction.atomic():
        # Lock the wallet row
        wallet = type(wallet).objects.select_for_update().get(pk=wallet.pk)
        wallet.balance -= amount
        wallet.save(update_fields=['balance'])
        UtilityWalletTransaction.objects.create(
            wallet=wallet,
            tx_type=UtilityWalletTransaction.TxType.DEDUCTION,
            amount=-amount,
            balance_after=wallet.balance,
            description=description,
            invoice_line=invoice_line,
        )
    return wallet


def credit_wallet(wallet, amount, tx_type, description, stripe_payment_intent=''):
    from django.db import transaction as db_transaction
    from apps.utilities.models import UtilityWalletTransaction

    with db_transaction.atomic():
        wallet = type(wallet).objects.select_for_update().get(pk=wallet.pk)
        wallet.balance += amount
        wallet.save(update_fields=['balance'])
        UtilityWalletTransaction.objects.create(
            wallet=wallet,
            tx_type=tx_type,
            amount=amount,
            balance_after=wallet.balance,
            description=description,
            stripe_payment_intent=stripe_payment_intent,
        )
    return wallet
```

### Bollard switch service (`utilities/services/bollard_service.py`)

```python
def switch_bollard(bollard, action: str, triggered_by=None, reason: str = '') -> dict:
    """
    Sends remote on/off command to bollard via vendor API.
    Creates BollardSwitchEvent audit record regardless of success.
    Returns vendor_response dict.
    """
    from apps.utilities.models import BollardSwitchEvent

    if not bollard.has_remote_switch:
        raise ValueError('Bollard does not support remote switching.')

    adapter = get_vendor_adapter(bollard.vendor, bollard.bollard.marina_id)
    try:
        vendor_response = adapter.switch(bollard.vendor_device_id, action)
        success = True
    except VendorConnectionError as e:
        vendor_response = {'error': str(e)}
        success = False

    BollardSwitchEvent.objects.create(
        bollard=bollard,
        action=action,
        triggered_by=triggered_by,
        reason=reason,
        success=success,
        vendor_response=vendor_response,
    )
    if success:
        bollard.status = 'active' if action == 'on' else 'suspended'
        bollard.save(update_fields=['status'])

    return vendor_response
```

---

## Authentication: ForkliftDeviceTokenAuthentication

File: `backend/apps/boatyard/authentication.py`

```python
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from apps.boatyard.models import ForkliftDeviceToken
from django.utils import timezone


class ForkliftDeviceTokenAuthentication(BaseAuthentication):
    """
    Authenticates a request using X-Forklift-Device-Token header.
    Returns (None, token_record) so request.user is None but request.auth
    is the ForkliftDeviceToken instance — views access request.auth.marina.
    Only used on forklift-specific endpoints.
    """

    def authenticate(self, request):
        token_value = request.headers.get('X-Forklift-Device-Token')
        if not token_value:
            return None  # Fall through to next authenticator

        try:
            token = ForkliftDeviceToken.objects.select_related('marina').get(
                token=token_value, is_active=True
            )
        except ForkliftDeviceToken.DoesNotExist:
            raise AuthenticationFailed('Invalid or inactive forklift device token.')

        token.last_used_at = timezone.now()
        token.save(update_fields=['last_used_at'])
        return (None, token)  # No user object — identity is the device

    def authenticate_header(self, request):
        return 'ForkliftDeviceToken'
```

Add `ForkliftDeviceTokenAuthentication` to `DEFAULT_AUTHENTICATION_CLASSES` in the DRF settings — or, preferably, override `authentication_classes` only on the forklift-specific ViewSets/views to avoid impacting other endpoints.

---

## API Endpoints

### Utilities app (`/api/v1/utilities/`)

| Method | URL | Description |
|---|---|---|
| GET | `/api/v1/utilities/smart-meters/` | List meters; filter: `?berth=`, `?is_online=false` |
| POST | `/api/v1/utilities/smart-meters/` | Register new meter |
| PATCH | `/api/v1/utilities/smart-meters/{id}/` | Update meter config |
| GET | `/api/v1/utilities/smart-meters/{id}/readings/` | Readings; filter: `?from=`, `?to=` |
| POST | `/api/v1/utilities/smart-meters/{id}/readings/` | Manual reading entry |
| GET | `/api/v1/utilities/smart-meters/{id}/trend/` | Aggregated hourly trend JSON for charts |
| GET | `/api/v1/utilities/outage-alerts/` | Active (unresolved) outage alerts |
| GET | `/api/v1/utilities/ofgem-report/` | Stream OFGEM CSV; params: `from`, `to` |
| GET | `/api/v1/utilities/wallets/` | List wallets; filter: `?member=` |
| GET | `/api/v1/utilities/wallets/{id}/` | Wallet detail + transaction ledger |
| POST | `/api/v1/utilities/wallets/{id}/top-up/` | Staff manual top-up |
| POST | `/api/v1/utilities/wallets/{id}/stripe-top-up/` | Initiate Stripe Payment Intent |
| POST | `/api/v1/utilities/wallets/{id}/stripe-confirm/` | Confirm payment + credit wallet |
| GET | `/api/v1/utilities/bollards/` | Bollard registry |
| POST | `/api/v1/utilities/bollards/` | Register bollard |
| PATCH | `/api/v1/utilities/bollards/{id}/` | Update bollard |
| POST | `/api/v1/utilities/bollards/{id}/switch/` | Remote on/off; body: `{"action": "on"|"off", "reason": "..."}` |
| GET | `/api/v1/utilities/bollards/{id}/fault-logs/` | Fault history |
| POST | `/api/v1/utilities/bollards/{id}/fault-logs/` | Log fault; signal auto-creates WorkOrder |
| GET | `/api/v1/utilities/wash-tokens/` | Token list; filter: `?status=`, `?facility=` |
| POST | `/api/v1/utilities/wash-tokens/` | Generate + sell token; creates InvoiceLineItem |
| POST | `/api/v1/utilities/wash-tokens/redeem/` | Redeem by PIN; requires `X-Hardware-ID` or `X-Marina-API-Key` header; uses `select_for_update()` inside `atomic()` |

**WashToken redeem view detail:**

```python
class WashTokenRedeemView(APIView):
    """
    Resolves marina from X-Hardware-ID or X-Marina-API-Key header.
    Uses select_for_update() inside transaction.atomic() to prevent double-redemption.
    Returns 400 with code 'token_already_redeemed' if status != 'issued'.
    """
    permission_classes = []  # No JWT required — hardware-initiated

    def post(self, request):
        marina = resolve_marina_from_header(request)  # raises 401 if header missing/invalid
        token_code = request.data.get('token_code')
        with transaction.atomic():
            try:
                token = WashToken.objects.select_for_update().get(
                    marina=marina, token_code=token_code
                )
            except WashToken.DoesNotExist:
                return Response({'detail': 'Invalid token code.'}, status=400)
            if token.status != 'issued':
                return Response({'detail': 'token_already_redeemed'}, status=400)
            if token.expires_at and token.expires_at < timezone.now():
                return Response({'detail': 'Token has expired.'}, status=400)
            token.status = 'redeemed'
            token.redeemed_at = timezone.now()
            token.save(update_fields=['status', 'redeemed_at'])
        return Response({'facility': token.facility, 'token_code': token.token_code})
```

### Boatyard app additions (`/api/v1/boatyard/`)

| Method | URL | Description |
|---|---|---|
| GET/POST | `/api/v1/boatyard/concierge-catalogue/` | List/create concierge services |
| PATCH | `/api/v1/boatyard/concierge-catalogue/{id}/` | Update/deactivate |
| GET | `/api/v1/boatyard/pick-tickets/` | List pick-tickets; filter: `?launch_request=` |
| PATCH | `/api/v1/boatyard/pick-ticket-lines/{id}/` | Mark line done/skipped; signal updates `pick_ticket_complete` |
| GET/POST | `/api/v1/boatyard/battery-charge-requests/` | Battery charge queue |
| PATCH | `/api/v1/boatyard/battery-charge-requests/{id}/` | Update status; `complete` transition fires notification signal |
| POST | `/api/v1/boatyard/launch-requests/{id}/confirm/` | Customer confirms; creates PickTicket if concierge services selected |
| POST | `/api/v1/boatyard/launch-requests/{id}/arrive/` | Mark owner arrived; clears no-show timer |
| POST | `/api/v1/boatyard/launch-requests/{id}/no-show/` | Manually flag no-show + charge fee via ChargeableItem |
| GET/POST | `/api/v1/boatyard/forklift-device-tokens/` | List/generate device tokens (admin/yard_manager only) |
| DELETE | `/api/v1/boatyard/forklift-device-tokens/{id}/` | Revoke (sets `is_active=False`) |
| GET | `/api/v1/boatyard/forklift-device-tokens/me/` | Tablet self-check; auth via `X-Forklift-Device-Token` |

**ForkliftDeviceToken generation:** The `token` field is set server-side using `secrets.token_urlsafe(48)` — never generated client-side.

---

## Celery Tasks

### `utilities/tasks.py`

#### poll_smart_meters

```python
@shared_task
def poll_smart_meters(marina_id: int):
    """Entry point from Celery Beat. Delegates to poll_service.poll_all_meters()."""
    from apps.utilities.services.poll_service import poll_all_meters
    poll_all_meters(marina_id)
```

Beat schedule: every 15 minutes, one task per active marina (use a fan-out: `poll_smart_meters_all` iterates active marinas, calls `poll_smart_meters.delay(marina_id)` for each).

#### check_meter_outages

```python
@shared_task
def check_meter_outages(marina_id: int):
    from apps.utilities.services.outage_service import check_outages
    check_outages(marina_id)
```

Wire as a Celery `chain()` after `poll_smart_meters` so outage detection always runs after the latest readings are committed.

#### send_low_balance_alerts

```python
@shared_task
def send_low_balance_alerts():
    """
    Every hour. Finds UtilityWallet records where balance < low_balance_threshold
    and auto_deduct_enabled=True. Sends notification if last_low_balance_alert
    is null or older than 24h. Updates last_low_balance_alert.
    """
```

#### auto_deduct_utility_charges

```python
@shared_task
def auto_deduct_utility_charges():
    """
    Every hour. For each wallet with auto_deduct_enabled=True:
    1. Calculate kWh consumed since the last deduction (delta between latest and
       previous MeterReading for the member's active berth smart meters).
    2. Look up ChargeableItem for utility (kWh), compute charge.
    3. Create InvoiceLineItem via billing engine.
    4. Call debit_wallet(wallet, charge_amount, ...).
    5. If wallet.balance <= 0 after deduction:
       - Find all ServiceBollard records linked to member's berth SmartMeter
         where has_remote_switch=True AND status='active'.
       - For each: call switch_bollard(bollard, 'off', reason='Wallet balance exhausted — auto-deduct').
       - Log BollardSwitchEvent per bollard.
       Note: power restoration is NOT automatic — staff must manually switch back
             after confirming payment.
    """
```

#### send_launch_confirmation_reminders

```python
@shared_task
def send_launch_confirmation_reminders():
    """
    Every 30 min. Finds LaunchRequest where confirmed_by_customer=False
    and confirmation_deadline is within 2 hours. Sends reminder via comms app.
    """
```

#### enforce_no_show

```python
@shared_task
def enforce_no_show():
    """
    Every 15 min. Finds LaunchRequest where:
    - status='launching', arrived_at is null
    - scheduled_for + marina.no_show_grace_minutes < now()
    - no_show=False

    For each:
    1. Set no_show=True.
    2. Look up 'No-Show Penalty' ChargeableItem (category='service').
    3. Create InvoiceLineItem; set launch_request.no_show_fee_line.
    4. Send member notification.
    5. CRITICAL: create new LaunchRequest with request_type='retrieval',
       status='scheduled', slot=original slot, vessel=vessel.
       This puts the vessel back in the forklift queue to clear the staging dock.
    """
```

#### expire_wash_tokens

```python
@shared_task
def expire_wash_tokens():
    """
    Every hour. Sets status='expired' on WashToken where
    expires_at < now() and status='issued'.
    """
    from apps.utilities.models import WashToken
    from django.utils import timezone
    WashToken.objects.filter(expires_at__lt=timezone.now(), status='issued').update(status='expired')
```

### `boatyard/tasks.py` additions

#### notify_battery_charge_complete (signal-driven, not beat)

This is handled via a Django signal on `BatteryChargeRequest.post_save` rather than a beat task (the spec describes it as event-driven). The signal fires when status transitions to `'complete'` and sends in-app + email/SMS notification to the vessel owner.

---

## Monthly Billing Management Command (Celery stub)

Until Celery Beat is wired for the monthly billing run, expose a management command:

File: `backend/apps/utilities/management/commands/generate_utility_invoices.py`

```python
from django.core.management.base import BaseCommand
from apps.utilities.services.wallet_service import generate_monthly_utility_invoices

class Command(BaseCommand):
    help = 'Generate monthly utility invoices for all active marina members.'

    def add_arguments(self, parser):
        parser.add_argument('--marina', type=int, required=True)
        parser.add_argument('--month', type=str, help='YYYY-MM', required=True)

    def handle(self, *args, **options):
        generate_monthly_utility_invoices(
            marina_id=options['marina'],
            month_str=options['month'],
        )
        self.stdout.write(self.style.SUCCESS('Done.'))
```

`generate_monthly_utility_invoices()` in `wallet_service.py` iterates members with `UtilityWallet`, calculates total consumption for the month from `MeterReading` deltas, creates one `Invoice` per member with one `InvoiceLineItem` per meter, and posts `UtilityWalletTransaction` debits.

---

## Signals

### `utilities/signals.py`

```python
from django.db.models.signals import post_save
from django.dispatch import receiver
from apps.utilities.models import BollardFaultLog


@receiver(post_save, sender=BollardFaultLog)
def create_work_order_for_fault(sender, instance, created, **kwargs):
    """Auto-create a boatyard.WorkOrder when a bollard fault is logged."""
    if created and not instance.work_order_id:
        from apps.boatyard.models import WorkOrder
        wo = WorkOrder.objects.create(
            marina=instance.bollard.marina,
            title=f'Bollard Fault: {instance.bollard.label} — {instance.get_fault_type_display()}',
            category='electrical',
            description=instance.description,
            priority='high',
            status='pending_auth',
        )
        instance.work_order = wo
        instance.save(update_fields=['work_order'])
```

### `boatyard/signals.py` additions

```python
from django.db.models.signals import post_save
from django.dispatch import receiver
from apps.boatyard.models import PickTicketLine, BatteryChargeRequest


@receiver(post_save, sender=PickTicketLine)
def update_pick_ticket_complete(sender, instance, **kwargs):
    """Set pick_ticket_complete on LaunchRequest when all lines are done/skipped."""
    pick_ticket = instance.pick_ticket
    lines = pick_ticket.lines.all()
    if lines.exists() and all(l.status in ('done', 'skipped') for l in lines):
        pick_ticket.launch_request.pick_ticket_complete = True
        pick_ticket.launch_request.save(update_fields=['pick_ticket_complete'])


@receiver(post_save, sender=BatteryChargeRequest)
def notify_battery_charge_complete(sender, instance, **kwargs):
    """Send notification when battery charge is marked complete."""
    if instance.status == 'complete' and instance.vessel.member:
        # Call existing notification service
        from apps.accounts.notifications import send_notification
        send_notification(
            recipient=instance.vessel.member,
            subject='Battery Charge Complete',
            body=f'Your vessel {instance.vessel.name} battery charge is complete.',
        )
```

---

## Admin

File: `backend/apps/utilities/admin.py`

```python
from django.contrib import admin
from .models import (
    UtilityIntegration, SmartMeter, MeterReading, MeterOutageAlert,
    UtilityWallet, UtilityWalletTransaction, ServiceBollard,
    BollardFaultLog, BollardSwitchEvent, WashToken,
)

@admin.register(UtilityIntegration)
class UtilityIntegrationAdmin(admin.ModelAdmin):
    list_display = ['marina', 'vendor', 'is_active', 'last_sync_at', 'last_sync_ok']
    list_filter  = ['vendor', 'is_active']
    # NOTE: credentials field is encrypted — not displayed in raw form

@admin.register(SmartMeter)
class SmartMeterAdmin(admin.ModelAdmin):
    list_display = ['device_id', 'label', 'vendor', 'meter_type', 'berth', 'is_active', 'is_online', 'last_polled']
    list_filter  = ['vendor', 'meter_type', 'is_active', 'is_online']
    search_fields = ['device_id', 'label']

@admin.register(MeterOutageAlert)
class MeterOutageAlertAdmin(admin.ModelAdmin):
    list_display = ['meter', 'started_at', 'resolved_at', 'notified']
    list_filter  = ['notified']

@admin.register(UtilityWallet)
class UtilityWalletAdmin(admin.ModelAdmin):
    list_display = ['member', 'marina', 'balance', 'low_balance_threshold', 'auto_deduct_enabled']
    list_filter  = ['auto_deduct_enabled', 'marina']
    search_fields = ['member__name']

@admin.register(ServiceBollard)
class ServiceBollardAdmin(admin.ModelAdmin):
    list_display = ['label', 'marina', 'berth', 'status', 'has_remote_switch', 'vendor']
    list_filter  = ['status', 'has_remote_switch', 'marina']

@admin.register(BollardFaultLog)
class BollardFaultLogAdmin(admin.ModelAdmin):
    list_display = ['bollard', 'fault_type', 'reported_at', 'resolved_at', 'work_order']
    list_filter  = ['fault_type']

@admin.register(WashToken)
class WashTokenAdmin(admin.ModelAdmin):
    list_display = ['token_code', 'facility', 'member', 'status', 'issued_at', 'redeemed_at']
    list_filter  = ['facility', 'status']
    search_fields = ['token_code']
```

File: `backend/apps/boatyard/admin.py` additions

```python
@admin.register(ForkliftDeviceToken)
class ForkliftDeviceTokenAdmin(admin.ModelAdmin):
    list_display = ['label', 'marina', 'is_active', 'created_at', 'last_used_at']
    list_filter  = ['is_active', 'marina']
    # token field shown but not editable — generated server-side

@admin.register(ConciergeCatalogueItem)
class ConciergeCatalogueItemAdmin(admin.ModelAdmin):
    list_display = ['name', 'marina', 'timing', 'is_active', 'sort_order']
    list_filter  = ['timing', 'is_active', 'marina']

@admin.register(BatteryChargeRequest)
class BatteryChargeRequestAdmin(admin.ModelAdmin):
    list_display = ['vessel', 'marina', 'status', 'requested_at', 'completed_at']
    list_filter  = ['status', 'marina']
```

---

## Settings / URL Wiring

### Settings additions (`config/settings/base.py`)

```python
# Add to LOCAL_APPS:
LOCAL_APPS = [
    ...
    'apps.utilities',
]

# Add to CORS_ALLOW_HEADERS:
CORS_ALLOW_HEADERS = list(default_headers) + [
    'X-Marina-Slug',
    'X-Forklift-Device-Token',
    'X-Hardware-ID',
    'X-Marina-API-Key',
]

# django-fernet-fields encryption key (must be 32 url-safe base64 chars or a Fernet key)
FERNET_KEYS = [os.environ.get('FERNET_KEY', '')]

# Celery Beat additions (merge with any existing schedule):
from celery.schedules import crontab
CELERY_BEAT_SCHEDULE = {
    ...
    'poll-smart-meters-all-15min': {
        'task': 'apps.utilities.tasks.poll_smart_meters_all_marinas',
        'schedule': 60 * 15,  # 15 minutes
    },
    'send-low-balance-alerts-hourly': {
        'task': 'apps.utilities.tasks.send_low_balance_alerts',
        'schedule': 60 * 60,
    },
    'auto-deduct-utility-charges-hourly': {
        'task': 'apps.utilities.tasks.auto_deduct_utility_charges',
        'schedule': 60 * 60,
    },
    'send-launch-confirmation-reminders-30min': {
        'task': 'apps.utilities.tasks.send_launch_confirmation_reminders',
        'schedule': 60 * 30,
    },
    'enforce-no-show-15min': {
        'task': 'apps.utilities.tasks.enforce_no_show',
        'schedule': 60 * 15,
    },
    'expire-wash-tokens-hourly': {
        'task': 'apps.utilities.tasks.expire_wash_tokens',
        'schedule': 60 * 60,
    },
}
```

### URL wiring (`config/urls.py`)

```python
# Add inside the api/v1/ include block:
path('utilities/', include('apps.utilities.urls')),
```

### `utilities/urls.py`

```python
from rest_framework.routers import DefaultRouter
from .views import (
    SmartMeterViewSet, MeterOutageAlertViewSet, OfgemReportView,
    UtilityWalletViewSet, ServiceBollardViewSet,
    WashTokenViewSet, WashTokenRedeemView,
)
from django.urls import path

router = DefaultRouter()
router.register(r'smart-meters', SmartMeterViewSet, basename='smart-meter')
router.register(r'outage-alerts', MeterOutageAlertViewSet, basename='outage-alert')
router.register(r'wallets', UtilityWalletViewSet, basename='utility-wallet')
router.register(r'bollards', ServiceBollardViewSet, basename='service-bollard')
router.register(r'wash-tokens', WashTokenViewSet, basename='wash-token')

urlpatterns = [
    path('ofgem-report/', OfgemReportView.as_view(), name='ofgem-report'),
    path('wash-tokens/redeem/', WashTokenRedeemView.as_view(), name='wash-token-redeem'),
] + router.urls
```

Note: `wash-tokens/redeem/` must appear before `router.urls` in the list so the exact path is matched before the router's `{id}/` pattern.

### Boatyard additions to `boatyard/urls.py`

```python
# Append to existing router registrations from Track 5:
router.register(r'boatyard/concierge-catalogue', ConciergeCatalogueViewSet, basename='concierge-catalogue')
router.register(r'boatyard/pick-tickets', PickTicketViewSet, basename='pick-ticket')
router.register(r'boatyard/pick-ticket-lines', PickTicketLineViewSet, basename='pick-ticket-line')
router.register(r'boatyard/battery-charge-requests', BatteryChargeRequestViewSet, basename='battery-charge')
router.register(r'boatyard/forklift-device-tokens', ForkliftDeviceTokenViewSet, basename='forklift-token')
```

`LaunchRequest` confirm/arrive/no-show are custom `@action` decorators on the existing `LaunchRequestDetail` view or a new `LaunchRequestViewSet`. Recommend migrating `LaunchRequest` to a ViewSet in this track to support custom actions cleanly.

---

## Migration Notes

### Scale: MeterReading table

The `MeterReading` table will accumulate ~17.5M rows/year per marina at 500 meters × 4 reads/hour. A standard unpartitioned Django table is not viable in production beyond ~6 months of data. Choose one of:

**(a) PostgreSQL declarative range partitioning (pg_partman — recommended for most deployments)**

In the migration that creates `utilities_meterreading`, replace `migrations.CreateModel` with:

```python
migrations.RunSQL("""
    CREATE TABLE utilities_meterreading (
        id bigserial,
        meter_id bigint NOT NULL,
        reading_kwh numeric(12,3),
        reading_m3  numeric(12,3),
        recorded_at timestamptz NOT NULL,
        source      varchar(20) DEFAULT 'auto',
        PRIMARY KEY (id, recorded_at)
    ) PARTITION BY RANGE (recorded_at);
""")
# Then let pg_partman create monthly child partitions automatically.
```

Add to `DATABASES` settings: `pg_partman` must be installed as a PostgreSQL extension (`CREATE EXTENSION pg_partman`). Document in `docs/infrastructure/meter-readings-partitioning.md`.

**(b) TimescaleDB hypertable (recommended for cloud deployments or analytics-heavy usage)**

Run a post-migration `RunSQL`:

```python
migrations.RunSQL(
    "SELECT create_hypertable('utilities_meterreading', 'recorded_at', "
    "chunk_time_interval => INTERVAL '1 month', if_not_exists => TRUE);"
)
```

In either case: add a composite index `(meter_id, recorded_at)` — already present in the model `Meta.indexes`. Do not rely on the ORM default `id`-based primary key for time-series queries.

**Decision must be made at deployment time** before the first migration is applied. Document the chosen strategy in `docs/infrastructure/meter-readings-partitioning.md`.

### Migration order

1. `accounts` migration: add `no_show_grace_minutes` to `Marina`.
2. `utilities` initial migration: all `utilities` models (`UtilityIntegration`, `SmartMeter`, `MeterReading` + partitioning RunSQL, `MeterOutageAlert`, `UtilityWallet`, `UtilityWalletTransaction`, `ServiceBollard`, `BollardFaultLog`, `BollardSwitchEvent`, `WashToken`).
3. `boatyard` migration (Track 6 additions): new fields on `LaunchRequest`, new models `ConciergeCatalogueItem`, `PickTicket`, `PickTicketLine`, `ForkliftDeviceToken`, `BatteryChargeRequest`.
4. Data migration: seed expected `ChargeableItem` entries (Utility kWh, Wash Token Shower, Wash Token Laundry, Battery Charge, No-Show Penalty, Concierge Vessel Wash-down) as a `RunPython` migration in `utilities/migrations/`.

---

## Implementation Order

Follow this exact sequence. Steps marked **(Backend)** and **(Frontend)** can be parallelised if two developers are available.

1. **(Backend)** Create `apps/utilities/` app — `python manage.py startapp utilities` inside `apps/`; create `apps.py` with `UtilitiesConfig`; register `'apps.utilities'` in `LOCAL_APPS`.

2. **(Backend)** Add `no_show_grace_minutes` to `accounts.Marina` — write and apply migration `accounts/migrations/XXXX_marina_no_show_grace.py`.

3. **(Backend)** Install `django-fernet-fields` (`pip install django-fernet-fields`); add `FERNET_KEYS` to settings and `.env.example`; add `FERNET_KEY` to env.

4. **(Backend)** Write `utilities` models and initial migration — include the partitioning `RunSQL` based on the chosen strategy. Apply migration.

5. **(Backend)** Data migration — seed `ChargeableItem` records in `utilities/migrations/XXXX_seed_chargeable_items.py` using `RunPython`. Items: Utility kWh, Shower Token, Laundry Token, Car Wash Token, Battery Charge, No-Show Penalty, Concierge Vessel Wash-down.

6. **(Backend)** Write `boatyard` Track 6 migration — add new `LaunchRequest` fields (`scheduled_for`, `confirmed_by_customer`, `confirmation_deadline`, `arrived_at`, `no_show`, `no_show_fee_line`, `pick_ticket_complete`, `request_type`) and new models (`ConciergeCatalogueItem`, `PickTicket`, `PickTicketLine`, `ForkliftDeviceToken`, `BatteryChargeRequest`). Apply migration.

7. **(Backend)** Implement vendor abstraction layer — `utilities/vendors/base.py` with `BaseMeterVendor`, `VendorReading`, `VendorConnectionError`, `DeviceNotFoundError`, `get_vendor_adapter()`. Implement `utilities/vendors/rolec.py` (`RolecAdapter` — production Rolec Cloud API). Stub `utilities/vendors/marinesync.py` (`MarineSyncAdapter` — raises `NotImplementedError` with clear message). Wire Metron as v2 deferred.

8. **(Backend)** Implement `utilities/services/poll_service.py` and `utilities/services/outage_service.py`.

9. **(Backend)** Implement `utilities/services/ofgem_service.py`.

10. **(Backend)** Implement `utilities/services/wallet_service.py` (`debit_wallet`, `credit_wallet`, `generate_monthly_utility_invoices`).

11. **(Backend)** Implement `utilities/services/bollard_service.py` (`switch_bollard`).

12. **(Backend)** Write `utilities/serializers.py` — one serializer per model. `WashTokenRedeemSerializer` validates `token_code` length/format.

13. **(Backend)** Write `utilities/views.py` — all ViewSets and the `WashTokenRedeemView`. Wire `OFGEM` as a `StreamingHttpResponse` returning CSV bytes from `generate_ofgem_report()`.

14. **(Backend)** Write `utilities/urls.py` — router + explicit paths for `ofgem-report` and `wash-tokens/redeem/`. Add `path('utilities/', include('apps.utilities.urls'))` to `config/urls.py`.

15. **(Backend)** Write `boatyard/authentication.py` — `ForkliftDeviceTokenAuthentication`. Add `X-Forklift-Device-Token` and `X-Hardware-ID` to `CORS_ALLOW_HEADERS`.

16. **(Backend)** Write boatyard Track 6 serializers — `ConciergeCatalogueItemSerializer`, `PickTicketSerializer` (nested lines), `PickTicketLineSerializer`, `BatteryChargeRequestSerializer`, `ForkliftDeviceTokenSerializer` (token field write-only; generated server-side).

17. **(Backend)** Write boatyard Track 6 ViewSets — `ConciergeCatalogueViewSet`, `PickTicketViewSet`, `PickTicketLineViewSet`, `BatteryChargeRequestViewSet`, `ForkliftDeviceTokenViewSet`. Migrate `LaunchRequest` to `LaunchRequestViewSet` and add `confirm`, `arrive`, `no_show` custom actions.

18. **(Backend)** Extend `boatyard/urls.py` — register Track 6 ViewSets in the DRF router.

19. **(Backend)** Write `utilities/tasks.py` — all Celery tasks. Write boatyard additions to `boatyard/tasks.py` (notification task). Wire all tasks in `CELERY_BEAT_SCHEDULE`.

20. **(Backend)** Write `utilities/signals.py` and extend `boatyard/signals.py` — `BollardFaultLog → WorkOrder` auto-create; `PickTicketLine → pick_ticket_complete` update; `BatteryChargeRequest → notification`.

21. **(Backend)** Write `utilities/admin.py` and extend `boatyard/admin.py`.

22. **(Backend)** Write management command `generate_utility_invoices`.

23. **(Frontend)** Replace `Billing.jsx` Utility Meters stub tab — build `UtilityMetersTab.jsx`, `MeterTrendChart.jsx`, `OutageAlertBanner.jsx`, `WalletDrawer.jsx`. Write `useSmartMeters.js` and `useUtilityWallets.js` hooks.

24. **(Frontend)** Build new `Utilities.jsx` screen (Bollards, Wash Tokens, OFGEM Reports tabs). Add sidebar entry under Operations group between Boatyard and Maintenance. Route: `/utilities`.

25. **(Frontend)** Add Concierge and Pick Tickets tabs to `Boatyard.jsx` — concierge catalogue CRUD table, battery charge queue, pick-ticket list.

26. **(Frontend)** Build `ForkliftApp.jsx` full-screen wrapper — hides app shell, reads device token from `localStorage`, calls `GET /api/v1/boatyard/forklift-device-tokens/me/` to verify token on load. Build `ForkliftAssignmentCard.jsx` (48px vessel name, 36px rack position, large checklist), `ForkliftPutAwayModal.jsx` (large input + numpad), `ForkliftLeaveOutModal.jsx` (day berth grid + numpad). Design constraints: dark navy `#0d1b2a` background, white text, 64px minimum touch targets, no hover states, no sidebar.

27. **(Frontend)** Write `useForkliftQueue.js` hook — fetches `/api/v1/boatyard/launch-requests/?status=scheduled&today=true`, exposes `queue`, `activeAssignment`, `markLineDone`, `confirmPutAway`, `confirmLeaveOut`. All mutations use `onSuccess` refetch — no optimistic updates for forklift.

28. **(Frontend)** Add `/field/forklift` route to the Field app router.

29. **(Frontend)** Build portal additions — `My Utility Balance` page (wallet balance, Stripe top-up, transaction history); `Launch Request Confirmation` page at `/portal/launch/{token}/confirm` (confirm button, concierge service picker, charge summary).

30. **(Backend + QA)** Integration test pass — validate:
    - Polling with stubbed Rolec adapter creates `MeterReading` rows.
    - Outage detection creates `MeterOutageAlert` when `last_polled` is overdue; resolves when polling resumes.
    - `auto_deduct_utility_charges` fires `BollardSwitchEvent action='off'` when `wallet.balance <= 0` (test with mocked bollard switch service).
    - `enforce_no_show` creates a retrieval `LaunchRequest` targeting the vessel's original `StorageSlot`; verify the retrieval request appears in the forklift queue before asserting the no-show fee.
    - `WashToken.redeem` rejects double-redemption with `token_already_redeemed` under concurrent requests (run with two simultaneous requests to verify `select_for_update()` prevents race).
    - `ForkliftDeviceTokenAuthentication` rejects requests with invalid or inactive tokens.
    - `BollardFaultLog` creation auto-creates a `WorkOrder` via signal.
    - Stripe top-up flow (test mode): Payment Intent created, confirmed, wallet credited, `UtilityWalletTransaction` written.
