import uuid as _uuid
from decimal import Decimal
from django.db import models, IntegrityError as _IntegrityError, transaction as _transaction
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.utils.text import slugify

from .fields import EncryptedCharField


def _default_onboarding():
    return {
        'draw_map': False,
        'set_pricing': False,
        'connect_bank': False,
        'invite_staff': False,
    }


class Marina(models.Model):
    name = models.CharField(max_length=200)
    address = models.TextField(blank=True)
    lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    timezone = models.CharField(max_length=50, default='UTC')
    plan = models.CharField(max_length=50, default='professional')
    contact_email = models.EmailField(blank=True)
    phone = models.CharField(max_length=30, blank=True)
    website = models.URLField(max_length=255, blank=True)
    vat_number = models.CharField(max_length=50, blank=True)
    currency = models.CharField(max_length=3, default='EUR')
    payment_terms = models.IntegerField(default=7)
    total_berths = models.IntegerField(default=0)
    dry_storage_slots = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    operations_paused = models.BooleanField(default=False)
    BOOKING_MODE_CHOICES = [
        ('manual_approval', 'Manual Approval'),
        ('auto_tetris', 'Auto-Tetris'),
    ]
    booking_mode = models.CharField(max_length=20, choices=BOOKING_MODE_CHOICES, default='manual_approval')
    vat_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'))
    stripe_account_id = models.CharField(max_length=255, blank=True)
    stripe_customer_id     = models.CharField(max_length=64, blank=True, null=True)
    stripe_subscription_id = models.CharField(max_length=64, blank=True, null=True)
    abandon_email_sent     = models.BooleanField(default=False)
    MARINA_STATUS_CHOICES = [
        ('pending_payment', 'Pending Payment'),
        ('trial',           'Trial'),
        ('active',          'Active'),
        ('suspended',       'Suspended'),
    ]
    status = models.CharField(max_length=20, choices=MARINA_STATUS_CHOICES, default='active')
    trial_ends = models.DateField(null=True, blank=True)
    next_renewal = models.DateField(null=True, blank=True)
    suspend_reason = models.TextField(blank=True)

    # ── Platform billing gate (Feature A — dunning lifecycle) ────────────────
    # Spec ref: docs/superpowers/specs/2026-05-17-billing-gates-design.md §A.2
    BILLING_STATE_CHOICES = [
        ('current',     'Current'),
        ('past_due',    'Past Due'),
        ('grace',       'Grace'),
        ('restricted',  'Restricted'),
        ('suspended',   'Suspended'),
        ('cancelled',   'Cancelled'),
        ('manual',      'Manual Contract'),
    ]
    billing_state = models.CharField(
        max_length=20, choices=BILLING_STATE_CHOICES, default='current',
        help_text='Automatic platform-billing lifecycle. Independent of Marina.status.',
    )
    billing_state_since      = models.DateTimeField(null=True, blank=True)
    billing_grace_until      = models.DateTimeField(null=True, blank=True)
    billing_failure_count    = models.IntegerField(default=0)
    billing_last_failure_at  = models.DateTimeField(null=True, blank=True)
    billing_last_email_at    = models.DateTimeField(null=True, blank=True)
    billing_admin_override   = models.BooleanField(default=False)
    billing_admin_override_reason     = models.TextField(blank=True)
    billing_admin_override_set_by     = models.ForeignKey(
        'accounts.User', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='+',
    )
    billing_admin_override_set_at     = models.DateTimeField(null=True, blank=True)
    billing_admin_override_expires_at = models.DateTimeField(null=True, blank=True)

    # ── Feature B — manual-contract flag ─────────────────────────────────────
    # Spec ref: §B.2
    manual_contract                   = models.BooleanField(default=False)
    manual_contract_signed_at         = models.DateField(null=True, blank=True)
    manual_contract_signed_by         = models.CharField(max_length=200, blank=True)
    manual_contract_reference         = models.CharField(max_length=100, blank=True)
    manual_contract_po_number         = models.CharField(max_length=100, blank=True)
    manual_contract_notes             = models.TextField(blank=True)
    manual_contract_invoice_terms     = models.CharField(max_length=20, blank=True)
    manual_contract_renewal_date      = models.DateField(null=True, blank=True)
    manual_contract_set_by            = models.ForeignKey(
        'accounts.User', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='+',
    )
    manual_contract_set_at            = models.DateTimeField(null=True, blank=True)


    features = models.JSONField(default=dict)
    onboarding = models.JSONField(default=_default_onboarding)
    app_config = models.JSONField(default=dict, blank=True)
    fuel_berths = models.JSONField(default=list)
    mrr_override = models.IntegerField(null=True, blank=True)
    max_staff = models.IntegerField(default=10)
    sms_unit_cost_cents = models.IntegerField(
        default=250,
        help_text=(
            'Per-SMS-segment cost in 1/100 cents (i.e. 250 = $0.025 = 2.5¢). '
            'Used by Broadcast Center cost previews.'
        ),
    )
    slug = models.SlugField(max_length=100, unique=True, blank=True)
    custom_domain = models.CharField(max_length=255, null=True, blank=True, unique=True)
    wallet_wifi_network = models.CharField(max_length=100, null=True, blank=True)
    wallet_wifi_password = models.CharField(max_length=100, null=True, blank=True)
    wallet_gate_codes = models.JSONField(default=list)
    wallet_harbour_master_phone = models.CharField(max_length=30, null=True, blank=True)
    wallet_vhf_channel = models.CharField(max_length=10, null=True, blank=True)
    wallet_office_hours = models.CharField(max_length=100, null=True, blank=True)
    waiver_template_id = models.CharField(max_length=255, null=True, blank=True)
    booking_terms_pdf_url           = models.URLField(blank=True, default='')
    booking_terms_version           = models.CharField(max_length=32, blank=True, default='1.0')
    requires_air_draft              = models.BooleanField(default=False)
    requires_insurance_at_booking   = models.BooleanField(default=False)
    dropboxsign_api_key    = models.CharField(max_length=255, blank=True, default='')
    dropboxsign_client_id  = models.CharField(max_length=255, blank=True, default='')
    marinetraffic_api_key  = models.CharField(max_length=255, blank=True, default='')
    openweathermap_api_key = models.CharField(max_length=255, blank=True, default='')
    basin_polygon = models.JSONField(
        default=list, blank=True,
        help_text='Marina basin polygon as list of [lat, lng] vertices. Used for AIS arrival detection.',
    )
    ais_poll_radius_nm = models.IntegerField(
        default=10,
        help_text='Bounding-box radius around marina lat/lng (nautical miles) used to query AIS providers.',
    )
    docusign_api_key       = models.CharField(max_length=255, blank=True, default='')
    docusign_account_id    = models.CharField(max_length=255, blank=True, default='')
    docusign_user_id       = models.CharField(max_length=64, blank=True, default='')
    docusign_private_key   = models.TextField(blank=True, default='')
    docusign_base_url      = models.CharField(
        max_length=255, blank=True, default='',
        help_text='Account base URL, e.g. https://demo.docusign.net/restapi or https://na2.docusign.net/restapi',
    )
    support_access_granted_until = models.DateTimeField(null=True, blank=True)

    # Waitlist (apps.waitlist)
    waitlist_enabled = models.BooleanField(default=False)
    waitlist_deposit_cents = models.IntegerField(default=7500)
    max_waitlist_declines = models.IntegerField(
        default=3,
        help_text='Number of waitlist offers a boater may decline before being removed.',
    )

    # Security: when True, owners and managers without active MFA are routed
    # to forced enrollment on next login (after the password step).
    require_mfa_for_managers = models.BooleanField(default=False)

    # Track 2 — Berth Intelligence: approval workflow + non-return alert configuration
    require_manager_approval_loa_m = models.DecimalField(
        max_digits=5, decimal_places=1, null=True, blank=True,
        help_text='Vessels with LOA >= this value require manager approval.',
    )
    require_manager_approval_types = models.JSONField(
        default=list,
        help_text='Vessel types that always require manager approval (e.g. ["catamaran"]).',
    )
    require_approval_for_seasonal = models.BooleanField(
        default=True,
        help_text='If True, all seasonal bookings require manager approval.',
    )
    document_gate_enabled = models.BooleanField(
        default=False,
        help_text='If True, bookings require insurance/registration/waiver verification before confirmation.',
    )
    non_return_grace_hours = models.IntegerField(
        default=2,
        help_text='Hours after expected_return before a non-return alert is raised.',
    )
    coastguard_escalation_hours = models.IntegerField(
        default=4,
        help_text='Hours after alert creation before status elevates to CRITICAL.',
    )
    berth_sale_commission_pct = models.DecimalField(
        max_digits=5, decimal_places=2, default=0,
        help_text='Commission percentage charged on berth sale transactions.',
    )

    # Track 6 — Dry Stack no-show enforcement
    no_show_grace_minutes = models.IntegerField(
        default=30,
        help_text='Minutes after scheduled_for before a LaunchRequest is flagged as a no-show.',
    )

    # Track 3 — Customer Intelligence & Loyalty
    points_earn_rate = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal('1.00'))
    points_to_currency_ratio = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal('100.00'))
    referral_referrer_benefit_type = models.CharField(max_length=20, default='points')
    referral_referrer_benefit_value = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    referral_referee_benefit_type = models.CharField(max_length=20, default='discount')
    referral_referee_benefit_value = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    harbour_master_email = models.EmailField(blank=True)

    # Email configuration (per-marina from-address + optional SMTP override)
    notification_from_email = models.EmailField(blank=True, help_text='From address used in all outgoing marina emails.')
    smtp_host     = models.CharField(max_length=255, blank=True, help_text='SMTP host (leave blank to use platform default).')
    smtp_port     = models.PositiveIntegerField(null=True, blank=True, help_text='SMTP port, e.g. 587.')
    smtp_user     = models.CharField(max_length=255, blank=True)
    smtp_password = EncryptedCharField(max_length=512, blank=True, help_text='Encrypted at rest with DOCKSBASE_FERNET_KEY.')
    smtp_use_tls  = models.BooleanField(default=True)

    # SMS configuration (per-marina provider override; falls back to platform defaults)
    SMS_PROVIDER_CHOICES = [
        ('twilio',      'Twilio'),
        ('vonage',      'Vonage'),
        ('messagebird', 'MessageBird'),
    ]
    sms_enabled       = models.BooleanField(default=False, help_text='Master switch for outgoing SMS from this marina.')
    sms_provider      = models.CharField(max_length=20, choices=SMS_PROVIDER_CHOICES, default='twilio', blank=True)
    # Twilio
    twilio_account_sid = models.CharField(max_length=64,  blank=True)
    twilio_auth_token  = EncryptedCharField(max_length=512, blank=True, help_text='Encrypted at rest with DOCKSBASE_FERNET_KEY.')
    twilio_from_number = models.CharField(max_length=32,  blank=True, help_text='E.164 format, e.g. +14155551234.')
    # Vonage (formerly Nexmo)
    vonage_api_key     = models.CharField(max_length=64,  blank=True)
    vonage_api_secret  = EncryptedCharField(max_length=512, blank=True, help_text='Encrypted at rest with DOCKSBASE_FERNET_KEY.')
    vonage_from        = models.CharField(max_length=32,  blank=True, help_text='Sender ID or E.164 number.')
    # MessageBird
    messagebird_access_key = EncryptedCharField(max_length=512, blank=True, help_text='Encrypted at rest with DOCKSBASE_FERNET_KEY.')
    messagebird_originator = models.CharField(max_length=32,  blank=True, help_text='Sender ID or E.164 number.')

    # Notification rules: per-rule channel toggles, e.g.
    # {'new_booking_confirmation': {'email': true, 'sms': false}, ...}
    notification_rules = models.JSONField(default=dict, blank=True)

    # Track 5 — Warranty GL accounts
    # billing.Account does not yet exist; using billing.ChargeableItem as a
    # placeholder until a full Chart of Accounts model is added (Track 4 GL).
    # See apps/boatyard/INSTALL.md for the correct FK once billing.Account exists.
    warranty_gl_account = models.ForeignKey(
        'billing.ChargeableItem', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='+',
        help_text='GL account for warranty reimbursement income.',
    )
    warranty_cogs_offset_account = models.ForeignKey(
        'billing.ChargeableItem', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='+',
        help_text='GL account for COGS offset on warranty repairs.',
    )

    # Seasonal-berth tenancy (spec 2026-05-17, locked decision §9.6):
    # if True, mid-season starts are billed at the full season_total
    # instead of being pro-rated by remaining calendar days.
    charge_full_season_on_mid_start = models.BooleanField(
        default=False,
        help_text=(
            'When True, a lease that starts mid-season is billed at the '
            'full season_total instead of being pro-rated by remaining '
            'calendar days (spec §6.1).'
        ),
    )

    @property
    def is_billing_managed_externally(self):
        """True when this marina pays via an offline contract, not Stripe."""
        return bool(self.manual_contract)

    @property
    def billing_admin_override_active(self):
        """True when an unexpired billing admin override is in effect."""
        if not self.billing_admin_override:
            return False
        from django.utils import timezone as _tz
        exp = self.billing_admin_override_expires_at
        return exp is None or exp > _tz.now()

    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name)[:96] or _uuid.uuid4().hex[:8]
            slug = base
            n = 1
            while True:
                try:
                    with _transaction.atomic():
                        self.slug = slug
                        super().save(*args, **kwargs)
                    return
                except _IntegrityError:
                    slug = f'{base}-{n}'
                    n += 1
        else:
            super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class UserManager(BaseUserManager):
    def create_user(self, email, password=None, **extra):
        if not email:
            raise ValueError('Email required')
        email = self.normalize_email(email)
        user = self.model(email=email, **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault('role', 'owner')
        extra.setdefault('is_staff', True)
        extra.setdefault('is_superuser', True)
        return self.create_user(email, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    ROLE_CHOICES = [
        ('owner', 'Owner'),
        ('manager', 'Manager'),
        ('staff', 'Staff'),
        ('boater', 'Boater'),
    ]

    marina = models.ForeignKey(Marina, on_delete=models.CASCADE, null=True, blank=True, related_name='users')
    email = models.EmailField(unique=True)
    first_name = models.CharField(max_length=100, blank=True)
    last_name = models.CharField(max_length=100, blank=True)
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='staff')
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    is_platform_admin = models.BooleanField(default=False)
    module_permissions = models.JSONField(
        default=dict, blank=True,
        help_text=(
            'Per-module access for staff users. '
            'Keys are module IDs; value false blocks access. '
            'Empty dict means all modules allowed (default).'
        ),
    )
    platform_role = models.CharField(
        max_length=20,
        choices=[('admin', 'Admin'), ('support', 'Support')],
        blank=True,
    )

    # Security T3: periodic email re-verification (180/210-day thresholds).
    # Null means never explicitly verified via re-verification flow; the
    # backfill migration sets this to created_at for all pre-existing users so
    # they don't immediately hit the 210-day hard block.
    email_verified_at = models.DateTimeField(null=True, blank=True)

    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = []

    objects = UserManager()

    def __str__(self):
        return self.email


class MagicToken(models.Model):
    user       = models.ForeignKey(User, on_delete=models.CASCADE, related_name='magic_tokens')
    token      = models.UUIDField(default=_uuid.uuid4, unique=True, db_index=True)
    expires_at = models.DateTimeField()

    def __str__(self):
        return f"MagicToken({self.user.email}, expires {self.expires_at})"


class EmailVerification(models.Model):
    user       = models.OneToOneField(User, on_delete=models.CASCADE, related_name='email_verification')
    token      = models.UUIDField(default=_uuid.uuid4, unique=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"EmailVerification({self.user.email})"


# ── Track 7 — Marina groups ───────────────────────────────────────────────────

class MarinaGroup(models.Model):
    name                  = models.CharField(max_length=200)
    slug                  = models.SlugField(unique=True)
    max_marinas           = models.IntegerField(default=1)
    billing_contact_email = models.EmailField(blank=True)
    vat_number            = models.CharField(max_length=50, blank=True)
    stripe_customer_id    = models.CharField(max_length=64, blank=True)
    base_currency         = models.CharField(max_length=3, default='EUR')
    created_at            = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class MarinaGroupMembership(models.Model):
    group  = models.ForeignKey(MarinaGroup, on_delete=models.CASCADE, related_name='memberships')
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='group_memberships')

    class Meta:
        unique_together = [('group', 'marina')]

    def __str__(self):
        return f'{self.group.name} — {self.marina}'


class MarinaGroupUserRole(models.Model):
    class Role(models.TextChoices):
        VIEWER = 'viewer', 'Viewer'
        ADMIN  = 'admin',  'Admin'

    group = models.ForeignKey(MarinaGroup, on_delete=models.CASCADE, related_name='user_roles')
    user  = models.ForeignKey('accounts.User', on_delete=models.CASCADE, related_name='group_roles')
    role  = models.CharField(max_length=20, choices=Role.choices, default=Role.VIEWER)

    class Meta:
        unique_together = [('group', 'user')]

    def __str__(self):
        return f'{self.user} in {self.group.name} ({self.role})'


# ──────────────────────────────────────────────────────────────────────────────
# Data export — manager-triggered marina-wide CSV/JSON archive.
# ──────────────────────────────────────────────────────────────────────────────


class DataExport(models.Model):
    """One marina-wide data-export job.

    The actual file is written to default storage at `file_path`. We never
    expose the storage path directly; downloads go through a view that
    returns a short-lived signed URL.
    """

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        RUNNING = 'running', 'Running'
        READY   = 'ready',   'Ready'
        FAILED  = 'failed',  'Failed'

    marina        = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='data_exports',
    )
    requested_by  = models.ForeignKey(
        'accounts.User', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='data_exports_requested',
    )
    status        = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    file_path     = models.CharField(max_length=500, blank=True)
    size_bytes    = models.BigIntegerField(null=True, blank=True)
    entity_counts = models.JSONField(default=dict, blank=True)
    error_message = models.TextField(blank=True)
    created_at    = models.DateTimeField(auto_now_add=True)
    ready_at      = models.DateTimeField(null=True, blank=True)
    expires_at    = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'DataExport(marina={self.marina_id}, status={self.status})'
