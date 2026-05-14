import uuid as _uuid
from decimal import Decimal
from django.db import models, IntegrityError as _IntegrityError, transaction as _transaction
from django.contrib.auth.models import AbstractBaseUser, BaseUserManager, PermissionsMixin
from django.utils.text import slugify


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
    max_loa = models.DecimalField(max_digits=6, decimal_places=1, null=True, blank=True)
    max_draft = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
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
    features = models.JSONField(default=dict)
    onboarding = models.JSONField(default=_default_onboarding)
    app_config = models.JSONField(default=dict, blank=True)
    fuel_berths = models.JSONField(default=list)
    mrr_override = models.IntegerField(null=True, blank=True)
    max_staff = models.IntegerField(default=10)
    slug = models.SlugField(max_length=100, unique=True, blank=True)
    custom_domain = models.CharField(max_length=255, null=True, blank=True, unique=True)
    wallet_wifi_network = models.CharField(max_length=100, null=True, blank=True)
    wallet_wifi_password = models.CharField(max_length=100, null=True, blank=True)
    wallet_gate_codes = models.JSONField(default=list)
    wallet_harbour_master_phone = models.CharField(max_length=30, null=True, blank=True)
    wallet_vhf_channel = models.CharField(max_length=10, null=True, blank=True)
    wallet_office_hours = models.CharField(max_length=100, null=True, blank=True)
    waiver_template_id = models.CharField(max_length=255, null=True, blank=True)
    dropboxsign_api_key    = models.CharField(max_length=255, blank=True, default='')
    dropboxsign_client_id  = models.CharField(max_length=255, blank=True, default='')
    marinetraffic_api_key  = models.CharField(max_length=255, blank=True, default='')
    openweathermap_api_key = models.CharField(max_length=255, blank=True, default='')
    docusign_api_key       = models.CharField(max_length=255, blank=True, default='')
    docusign_account_id    = models.CharField(max_length=255, blank=True, default='')
    docusign_user_id       = models.CharField(max_length=64, blank=True, default='')
    docusign_private_key   = models.TextField(blank=True, default='')
    docusign_base_url      = models.CharField(
        max_length=255, blank=True, default='',
        help_text='Account base URL, e.g. https://demo.docusign.net/restapi or https://na2.docusign.net/restapi',
    )
    support_access_granted_until = models.DateTimeField(null=True, blank=True)

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
    smtp_password = models.CharField(max_length=255, blank=True, help_text='Stored in plaintext — use environment secrets for production deployments.')
    smtp_use_tls  = models.BooleanField(default=True)

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
