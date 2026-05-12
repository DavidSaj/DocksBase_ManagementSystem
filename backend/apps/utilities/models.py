from django.db import models
from apps.accounting.fields import EncryptedJSONField


# ---------------------------------------------------------------------------
# Utility Integration (vendor credentials, encrypted)
# ---------------------------------------------------------------------------

class UtilityIntegration(models.Model):
    """
    Per-marina, per-vendor integration record.
    Credentials are stored encrypted via django-fernet-fields.
    Install: pip install django-fernet-fields
    Settings: FERNET_KEYS = [os.environ.get('FERNET_KEY', '')]
    """

    class Vendor(models.TextChoices):
        ROLEC      = 'rolec',      'Rolec'
        MARINESYNC = 'marinesync', 'MarineSync'

    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='utility_integrations')
    vendor           = models.CharField(max_length=20, choices=Vendor.choices)
    credentials = EncryptedJSONField(
        default=dict,
        help_text='Encrypted dict: api_key, base_url, etc.',
    )
    is_active        = models.BooleanField(default=True)
    last_sync_at     = models.DateTimeField(null=True, blank=True)
    last_sync_ok     = models.BooleanField(default=True)
    last_sync_error  = models.TextField(blank=True)

    class Meta:
        unique_together = ('marina', 'vendor')

    def __str__(self):
        return f'{self.get_vendor_display()} — {self.marina}'


# ---------------------------------------------------------------------------
# Smart Meter
# ---------------------------------------------------------------------------

class SmartMeter(models.Model):
    class Vendor(models.TextChoices):
        ROLEC      = 'rolec',      'Rolec'
        MARINESYNC = 'marinesync', 'MarineSync'

    class MeterType(models.TextChoices):
        ELECTRICITY = 'electricity', 'Electricity'
        WATER       = 'water',       'Water'

    marina               = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='smart_meters')
    berth                = models.ForeignKey('berths.Berth', on_delete=models.SET_NULL, null=True, blank=True, related_name='smart_meters')
    vendor               = models.CharField(max_length=20, choices=Vendor.choices)
    meter_type           = models.CharField(max_length=20, choices=MeterType.choices)
    device_id            = models.CharField(max_length=100)
    label                = models.CharField(max_length=100, blank=True)
    poll_interval_minutes = models.IntegerField(default=60)
    is_active            = models.BooleanField(default=True)
    last_polled          = models.DateTimeField(null=True, blank=True)
    is_online            = models.BooleanField(default=True)

    class Meta:
        unique_together = ('marina', 'vendor', 'device_id')
        ordering = ['berth__code', 'meter_type']

    def __str__(self):
        return f'{self.label or self.device_id} ({self.get_meter_type_display()})'


# ---------------------------------------------------------------------------
# MeterReading
# ---------------------------------------------------------------------------

class MeterReading(models.Model):
    """
    SCALE WARNING — 17.5M rows/year per marina at 500 meters * 4 reads/hour.
    This table MUST be partitioned in production. See INSTALL.md for:
      (a) PostgreSQL RANGE partitioning via pg_partman (monthly), or
      (b) TimescaleDB hypertable (recommended for cloud/analytics-heavy deployments).
    The ORM definition is identical either way; partitioning SQL is run
    post-migration and is documented in INSTALL.md.
    The composite index (meter_id, recorded_at) is critical for all time-series
    queries — do NOT rely on the default id-based primary key for reads.
    """

    meter       = models.ForeignKey(SmartMeter, on_delete=models.CASCADE, related_name='readings')
    reading_kwh = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    reading_m3  = models.DecimalField(max_digits=12, decimal_places=3, null=True, blank=True)
    recorded_at = models.DateTimeField(db_index=True)
    source      = models.CharField(
        max_length=20,
        default='auto',
        choices=[('auto', 'Auto-poll'), ('manual', 'Manual entry')],
    )

    class Meta:
        ordering = ['recorded_at']
        indexes = [models.Index(fields=['meter', 'recorded_at'])]

    def __str__(self):
        return f'Reading {self.meter} @ {self.recorded_at}'


# ---------------------------------------------------------------------------
# Meter Outage Alert
# ---------------------------------------------------------------------------

class MeterOutageAlert(models.Model):
    meter       = models.ForeignKey(SmartMeter, on_delete=models.CASCADE, related_name='outage_alerts')
    started_at  = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    notified    = models.BooleanField(default=False)

    class Meta:
        ordering = ['-started_at']

    def __str__(self):
        status = 'resolved' if self.resolved_at else 'active'
        return f'Outage {self.meter} ({status})'


# ---------------------------------------------------------------------------
# Utility Wallet
# ---------------------------------------------------------------------------

class UtilityWallet(models.Model):
    marina                 = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='utility_wallets')
    member                 = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='utility_wallets')
    balance                = models.DecimalField(max_digits=10, decimal_places=2, default=0.00)
    low_balance_threshold  = models.DecimalField(max_digits=8, decimal_places=2, default=10.00)
    auto_deduct_enabled    = models.BooleanField(default=False)
    last_low_balance_alert = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ('marina', 'member')

    def __str__(self):
        return f'Wallet: {self.member} @ {self.marina} (£{self.balance})'


# ---------------------------------------------------------------------------
# Utility Wallet Transaction
# ---------------------------------------------------------------------------

class UtilityWalletTransaction(models.Model):
    class TxType(models.TextChoices):
        TOP_UP     = 'top_up',     'Top-up (Portal)'
        STAFF_LOAD = 'staff_load', 'Staff Load (Office)'
        DEDUCTION  = 'deduction',  'Charge Deduction'
        REFUND     = 'refund',     'Refund'

    wallet                = models.ForeignKey(UtilityWallet, on_delete=models.CASCADE, related_name='transactions')
    tx_type               = models.CharField(max_length=20, choices=TxType.choices)
    amount                = models.DecimalField(max_digits=10, decimal_places=2)  # positive=credit, negative=debit
    balance_after         = models.DecimalField(max_digits=10, decimal_places=2)
    description           = models.CharField(max_length=300, blank=True)
    stripe_payment_intent = models.CharField(max_length=100, blank=True)
    invoice_line          = models.ForeignKey(
        'billing.InvoiceLineItem', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='wallet_deductions',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.get_tx_type_display()} £{self.amount} — {self.wallet}'


# ---------------------------------------------------------------------------
# Service Bollard
# ---------------------------------------------------------------------------

class ServiceBollard(models.Model):
    class BollardStatus(models.TextChoices):
        ACTIVE    = 'active',    'Active'
        FAULT     = 'fault',     'Fault — Power Unavailable'
        SUSPENDED = 'suspended', 'Suspended (Account)'
        OFFLINE   = 'offline',   'Offline / Decommissioned'

    marina            = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='service_bollards')
    berth             = models.ForeignKey('berths.Berth', on_delete=models.SET_NULL, null=True, blank=True, related_name='service_bollards')
    label             = models.CharField(max_length=100)
    max_amps          = models.IntegerField(default=16)
    voltage           = models.IntegerField(default=230)
    has_remote_switch = models.BooleanField(default=False)
    vendor            = models.CharField(max_length=20, blank=True)
    vendor_device_id  = models.CharField(max_length=100, blank=True)
    status            = models.CharField(max_length=20, choices=BollardStatus.choices, default='active')
    smart_meter       = models.ForeignKey(SmartMeter, on_delete=models.SET_NULL, null=True, blank=True, related_name='bollards')
    notes             = models.TextField(blank=True)

    class Meta:
        ordering = ['label']
        unique_together = ('marina', 'label')

    def __str__(self):
        return f'{self.label} ({self.get_status_display()})'


# ---------------------------------------------------------------------------
# Bollard Fault Log
# ---------------------------------------------------------------------------

class BollardFaultLog(models.Model):
    class FaultType(models.TextChoices):
        SUPPLY_FAILURE   = 'supply_failure',   'Supply Failure'
        OVERCURRENT_TRIP = 'overcurrent_trip', 'Overcurrent Trip'
        COMMS_ERROR      = 'comms_error',      'Communications Error'
        OTHER            = 'other',            'Other'

    bollard     = models.ForeignKey(ServiceBollard, on_delete=models.CASCADE, related_name='fault_logs')
    fault_type  = models.CharField(max_length=30, choices=FaultType.choices)
    description = models.TextField(blank=True)
    reported_at = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    # Creating a BollardFaultLog auto-creates a boatyard.WorkOrder via signal (see signals.py)
    work_order  = models.ForeignKey(
        'boatyard.WorkOrder', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='bollard_faults',
    )

    class Meta:
        ordering = ['-reported_at']

    def __str__(self):
        return f'{self.get_fault_type_display()} — {self.bollard}'


# ---------------------------------------------------------------------------
# Bollard Switch Event
# ---------------------------------------------------------------------------

class BollardSwitchEvent(models.Model):
    class Action(models.TextChoices):
        ON  = 'on',  'Power On'
        OFF = 'off', 'Power Off'

    bollard         = models.ForeignKey(ServiceBollard, on_delete=models.CASCADE, related_name='switch_events')
    action          = models.CharField(max_length=5, choices=Action.choices)
    triggered_by    = models.ForeignKey('accounts.User', on_delete=models.SET_NULL, null=True, blank=True)
    reason          = models.CharField(max_length=300, blank=True)
    success         = models.BooleanField(default=True)
    vendor_response = models.JSONField(default=dict, blank=True)
    created_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.get_action_display()} — {self.bollard} @ {self.created_at}'


# ---------------------------------------------------------------------------
# Wash Token
# ---------------------------------------------------------------------------

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

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='wash_tokens')
    member          = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='wash_tokens')
    facility        = models.CharField(max_length=20, choices=Facility.choices)
    token_code      = models.CharField(
        max_length=20,
        db_index=True,
        help_text='6-digit alphanumeric PIN. Unique within marina; NOT globally unique.',
    )
    status          = models.CharField(max_length=20, choices=TokenStatus.choices, default='issued')
    expires_at      = models.DateTimeField(null=True, blank=True)
    issued_at       = models.DateTimeField(auto_now_add=True)
    redeemed_at     = models.DateTimeField(null=True, blank=True)
    invoice_line    = models.ForeignKey(
        'billing.InvoiceLineItem', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='wash_tokens',
    )
    chargeable_item = models.ForeignKey(
        'billing.ChargeableItem', on_delete=models.PROTECT,
        related_name='wash_tokens',
    )

    class Meta:
        ordering = ['-issued_at']
        unique_together = ('marina', 'token_code')

    def __str__(self):
        return f'{self.token_code} ({self.get_facility_display()}, {self.get_status_display()})'


# ---------------------------------------------------------------------------
# Pending Utility Charge (Dockwalk billing staging)
# ---------------------------------------------------------------------------

class PendingUtilityCharge(models.Model):
    """
    Staging ledger for Dockwalk utility charges.
    Created when a dockhand enters a meter reading. Never touches an active invoice.
    The monthly billing sweep collects rows where swept_to_invoice is None
    and attaches them to the new invoice.
    """
    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='pending_utility_charges')
    member        = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='pending_utility_charges')
    meter         = models.ForeignKey(SmartMeter, on_delete=models.PROTECT, related_name='pending_charges')
    meter_reading = models.ForeignKey(MeterReading, on_delete=models.PROTECT, related_name='pending_charges')
    kwh_delta     = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True)
    m3_delta      = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True)
    unit_price    = models.DecimalField(max_digits=10, decimal_places=4)
    amount        = models.DecimalField(max_digits=10, decimal_places=2)
    rollover      = models.BooleanField(default=False)
    swept_to_invoice = models.ForeignKey(
        'billing.Invoice',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='utility_charges',
    )
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'PendingCharge {self.member} {self.amount}'
