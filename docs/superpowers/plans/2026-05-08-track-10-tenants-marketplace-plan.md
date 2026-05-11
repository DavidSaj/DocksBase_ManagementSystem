# Track 10 — Tenants, Marketplace & Network: Implementation Plan
Date: 2026-05-08
Based on spec: `docs/superpowers/specs/2026-05-07-track-10-tenants-marketplace-network-design.md`

---

## Overview

Two new Django apps:
- `apps/tenants/` — commercial unit lettings, tenancy lifecycle, rent scheduling, deposit invoicing
- `apps/marketplace/` — berth sale listings, photo uploads, enquiries, berth exchange

The Boater Network sub-module (BoaterProfile, cross-marina identity) is explicitly **deferred to v2**. Models include nullable placeholder FKs where noted, but no v1 API or UI is built for network features.

All monetary flows route through `billing.ChargeableItem` → `billing.InvoiceLineItem` → `billing.Invoice`. The spec introduces two new `ChargeableItem` categories (`RENT`, `DEPOSIT`) — both already exist in the codebase (confirmed in `apps/billing/models.py`). No `ChargeableItem` model change is needed.

---

## Part 1: Pre-App Changes to Existing Models

### 1.1 `billing.Invoice` — `tenant` FK

**File:** `apps/billing/models.py`

Add:
```python
tenant = models.ForeignKey(
    'tenants.TenantContact',
    on_delete=models.SET_NULL,
    null=True, blank=True,
    related_name='invoices',
)
```

> If Track 9 has already added this field, skip. Both tracks require this FK; add it once in whichever merges first.

Serializer `validate()`: enforce that exactly one of `member` / `tenant` is populated (neither blank, not both). Applies to all invoice creation paths.

Dunning engine update: when the overdue sweep processes an invoice where `member is None`, use `invoice.tenant.email` as the notification target and `invoice.tenant.display_name` in the letter template body.

Run `makemigrations billing`.

### 1.2 `berths.Berth` — Ownership Fields

**File:** `apps/berths/models.py`

Add:
```python
owner = models.ForeignKey(
    'members.Member',
    on_delete=models.SET_NULL,
    null=True, blank=True,
    related_name='owned_berths',
)
lease_expiry = models.DateField(null=True, blank=True)
```

This migration **must** run before the `marketplace` app is created — `BerthListing` references `Berth.owner`.

Run `makemigrations berths` → `migrate`.

### 1.3 `reservations.Booking` — OTA Commission Amount

**File:** `apps/reservations/models.py`

Add (for Snag-A-Slip commission storage):
```python
ota_commission_amount = models.DecimalField(
    max_digits=8, decimal_places=2,
    null=True, blank=True,
    help_text='OTA commission amount retained by the channel (e.g. Snag-A-Slip). '
              'Stored here until the accounts payable module is implemented.',
)
```

Run `makemigrations reservations` → `migrate`.

---

## Part 2: `tenants` App

### 2.1 App Skeleton

```
apps/tenants/
    __init__.py
    apps.py
    models.py
    serializers.py
    views.py
    urls.py
    admin.py
    signals.py
    services/
        __init__.py
        rent_scheduler.py
        deposit_service.py
```

**`apps/tenants/apps.py`:**
```python
from django.apps import AppConfig

class TenantsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.tenants'

    def ready(self):
        import apps.tenants.signals  # noqa: F401
```

### 2.2 Models (`apps/tenants/models.py`)

```python
from decimal import Decimal
from django.core.exceptions import ValidationError
from django.db import models


class CommercialUnit(models.Model):
    UNIT_TYPE_CHOICES = [
        ('chandlery',     'Chandlery / Marine Shop'),
        ('workshop',      'Workshop'),
        ('office',        'Office Suite'),
        ('storage',       'Dry Storage Unit'),
        ('retail',        'Retail Unit'),
        ('food_kiosk',    'Food & Beverage Kiosk Plot'),
        ('parking_bay',   'Car Parking Bay'),
        ('trailer_store', 'Boat Trailer Storage'),
    ]

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='commercial_units')
    unit_ref      = models.CharField(max_length=50)
    unit_type     = models.CharField(max_length=30, choices=UNIT_TYPE_CHOICES)
    description   = models.TextField(blank=True)
    area_m2       = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    has_power     = models.BooleanField(default=False)
    has_water     = models.BooleanField(default=False)
    has_broadband = models.BooleanField(default=False)
    is_active     = models.BooleanField(default=True)
    notes         = models.TextField(blank=True)

    class Meta:
        unique_together = ('marina', 'unit_ref')
        ordering = ['unit_type', 'unit_ref']

    def __str__(self):
        return f'{self.unit_ref} — {self.get_unit_type_display()} ({self.marina})'


class TenantContact(models.Model):
    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='tenant_contacts')
    display_name  = models.CharField(max_length=200)
    is_company    = models.BooleanField(default=False)
    company_name  = models.CharField(max_length=200, blank=True)
    contact_name  = models.CharField(max_length=200, blank=True)
    email         = models.EmailField(blank=True)
    phone         = models.CharField(max_length=30, blank=True)
    address       = models.TextField(blank=True)
    vat_number    = models.CharField(max_length=50, blank=True)
    notes         = models.TextField(blank=True)
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['display_name']

    def __str__(self):
        return f'{self.display_name} ({self.marina})'


class Tenancy(models.Model):
    FREQ_CHOICES = [
        ('monthly',   'Monthly'),
        ('quarterly', 'Quarterly'),
        ('annually',  'Annually'),
    ]
    STATUS_CHOICES = [
        ('active',     'Active'),
        ('notice',     'Notice Period'),
        ('expired',    'Expired'),
        ('terminated', 'Terminated'),
    ]

    marina             = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='tenancies')
    unit               = models.ForeignKey(CommercialUnit, on_delete=models.PROTECT, related_name='tenancies')
    tenant             = models.ForeignKey(TenantContact, on_delete=models.PROTECT, related_name='tenancies')
    status             = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    lease_start        = models.DateField()
    lease_end          = models.DateField(null=True, blank=True)
    notice_period_days = models.IntegerField(default=28)
    permitted_use      = models.CharField(max_length=500, blank=True)
    rent_amount        = models.DecimalField(max_digits=10, decimal_places=2)
    rent_frequency     = models.CharField(max_length=20, choices=FREQ_CHOICES, default='monthly')
    service_charge     = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    deposit_amount     = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    next_review_date   = models.DateField(null=True, blank=True)
    review_notes       = models.TextField(blank=True)
    break_clause_date  = models.DateField(null=True, blank=True)
    break_clause_notes = models.CharField(max_length=500, blank=True)

    # category must be 'rent'
    rent_chargeable_item = models.ForeignKey(
        'billing.ChargeableItem',
        on_delete=models.PROTECT,
        null=True, blank=True,
        related_name='tenancies',
        limit_choices_to={'category': 'rent'},
    )
    # category must be 'deposit' — mapped to a Liability GL account
    deposit_chargeable_item = models.ForeignKey(
        'billing.ChargeableItem',
        on_delete=models.PROTECT,
        null=True, blank=True,
        related_name='deposit_tenancies',
        limit_choices_to={'category': 'deposit'},
    )
    # Null until auto-generated on creation via post_save signal
    deposit_invoice = models.OneToOneField(
        'billing.Invoice',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='deposit_tenancy',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-lease_start']

    @property
    def deposit_held(self) -> bool:
        """True once the deposit invoice has been paid. Never stored as a field."""
        return self.deposit_invoice_id is not None and self.deposit_invoice.status == 'paid'

    def clean(self):
        if self.status == 'active':
            # select_for_update is called in the ViewSet's create(); clean() validates the result.
            qs = Tenancy.objects.filter(unit=self.unit, status='active')
            if self.pk:
                qs = qs.exclude(pk=self.pk)
            if qs.exists():
                raise ValidationError('This unit already has an active tenancy.')
        if self.lease_end and self.lease_end < self.lease_start:
            raise ValidationError({'lease_end': 'Lease end must be after lease start.'})

    def __str__(self):
        return f'Tenancy: {self.tenant} @ {self.unit} ({self.status})'


class TenancyDocument(models.Model):
    DOC_TYPE_CHOICES = [
        ('lease_agreement',    'Lease Agreement'),
        ('guarantor',          'Guarantor Document'),
        ('planning_permission','Planning Permission'),
        ('compliance_cert',    'Compliance Certificate'),
        ('insurance',          'Insurance Certificate'),
        ('correspondence',     'Correspondence'),
        ('other',              'Other'),
    ]

    tenancy     = models.ForeignKey(Tenancy, on_delete=models.CASCADE, related_name='documents')
    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='tenancy_documents')
    doc_type    = models.CharField(max_length=30, choices=DOC_TYPE_CHOICES)
    file        = models.FileField(upload_to='tenancy_docs/')
    filename    = models.CharField(max_length=255, blank=True)
    expires_at  = models.DateField(null=True, blank=True)
    notes       = models.CharField(max_length=500, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-uploaded_at']

    def __str__(self):
        return f'{self.get_doc_type_display()} — {self.tenancy}'


class RentScheduleEntry(models.Model):
    STATUS_CHOICES = [
        ('scheduled', 'Scheduled'),
        ('invoiced',  'Invoiced'),
        ('cancelled', 'Cancelled'),
    ]

    tenancy           = models.ForeignKey(Tenancy, on_delete=models.CASCADE, related_name='schedule_entries')
    marina            = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='rent_schedule_entries')
    period_ref        = models.CharField(max_length=20)   # e.g. "2026-06" or "Q2-2026"
    due_date          = models.DateField()
    amount            = models.DecimalField(max_digits=10, decimal_places=2)
    status            = models.CharField(max_length=20, choices=STATUS_CHOICES, default='scheduled')
    invoice           = models.OneToOneField(
        'billing.Invoice',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='rent_schedule_entry',
    )
    is_pro_rata         = models.BooleanField(default=False)
    pro_rata_days       = models.PositiveIntegerField(null=True, blank=True)
    pro_rata_total_days = models.PositiveIntegerField(null=True, blank=True)
    created_at          = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['due_date']
        unique_together = ('tenancy', 'period_ref')

    def __str__(self):
        return f'Rent {self.period_ref} — {self.tenancy} ({self.status})'


class TenancyTask(models.Model):
    STATUS_CHOICES = [
        ('open',        'Open'),
        ('in_progress', 'In Progress'),
        ('done',        'Done'),
        ('cancelled',   'Cancelled'),
    ]
    TYPE_CHOICES = [
        ('rent_review',   'Rent Review'),
        ('lease_renewal', 'Lease Renewal'),
        ('compliance',    'Compliance Check'),
        ('general',       'General'),
    ]

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='tenancy_tasks')
    tenancy     = models.ForeignKey(Tenancy, on_delete=models.CASCADE, related_name='tasks', null=True, blank=True)
    task_type   = models.CharField(max_length=30, choices=TYPE_CHOICES, default='general')
    title       = models.CharField(max_length=300)
    due_date    = models.DateField(null=True, blank=True)
    assigned_to = models.ForeignKey('accounts.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='tenancy_tasks')
    status      = models.CharField(max_length=20, choices=STATUS_CHOICES, default='open')
    notes       = models.TextField(blank=True)
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['due_date', 'created_at']

    def __str__(self):
        return f'{self.title} ({self.get_status_display()})'
```

### 2.3 Signals (`apps/tenants/signals.py`)

```python
from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver
from apps.tenants.models import Tenancy


@receiver(post_save, sender=Tenancy)
def auto_create_deposit_invoice(sender, instance, created, **kwargs):
    """
    On tenancy creation, if deposit_amount > 0 and deposit_chargeable_item is set,
    auto-generate a draft deposit Invoice and link it back to tenancy.deposit_invoice.
    """
    if not created or instance.deposit_amount <= 0:
        return
    if not instance.deposit_chargeable_item_id:
        return  # marina must configure a deposit ChargeableItem first

    def _create():
        from billing.models import Invoice, InvoiceLineItem
        from apps.accounts.utils import generate_invoice_number

        invoice = Invoice.objects.create(
            marina=instance.marina,
            tenant=instance.tenant,
            member=None,
            source_type='tenancy_deposit',
            source_id=str(instance.pk),
            invoice_number=generate_invoice_number(instance.marina),
            status='draft',
        )
        InvoiceLineItem.objects.create(
            invoice=invoice,
            description=f'Security Deposit — {instance.unit.unit_ref}',
            chargeable_item=instance.deposit_chargeable_item,
            quantity=1,
            unit_price=instance.deposit_amount,
            total_price=instance.deposit_amount,
            tax_rate=instance.deposit_chargeable_item.tax_rate,
        )
        # Use update() not save() to avoid re-triggering the post_save signal
        Tenancy.objects.filter(pk=instance.pk).update(deposit_invoice=invoice)

    transaction.on_commit(_create)
```

### 2.4 Services

#### `apps/tenants/services/rent_scheduler.py`

```python
from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal
from django.db import transaction
from apps.tenants.models import Tenancy, RentScheduleEntry


def compute_pro_rata_amount(rent_amount: Decimal, lease_start: date, period_start: date, period_end: date):
    """
    Returns (amount, is_pro_rata, days_active, days_in_period).
    """
    days_in_period = (period_end - period_start).days + 1
    active_start = max(lease_start, period_start)
    days_active = (period_end - active_start).days + 1
    if days_active == days_in_period:
        return rent_amount, False, days_active, days_in_period
    amount = (Decimal(days_active) / Decimal(days_in_period)) * rent_amount
    return amount.quantize(Decimal('0.01')), True, days_active, days_in_period


def _get_period_bounds_monthly(year: int, month: int):
    """Returns (period_start, period_end, period_ref) for a monthly period."""
    last_day = monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day), f'{year}-{month:02d}'


def run_rent_scheduler(marina, year: int, month: int):
    """
    Idempotent: generates invoices for all active tenancies with scheduled entries due
    in the given month. Re-running for a month that already has invoices is a no-op.
    Called daily by a management command (no Celery yet — invoke from a cron-triggered
    management command or transaction.on_commit).
    """
    from billing.models import Invoice, InvoiceLineItem
    from apps.accounts.utils import generate_invoice_number

    today = date.today()
    active_tenancies = Tenancy.objects.filter(
        marina=marina,
        status__in=['active', 'notice'],
    ).select_related('unit', 'tenant', 'rent_chargeable_item')

    for tenancy in active_tenancies:
        period_start, period_end, period_ref = _get_period_bounds_monthly(year, month)

        # Pro-rata check for first period (lease started mid-month)
        amount, is_pro_rata, days_active, days_in_period = compute_pro_rata_amount(
            rent_amount=tenancy.rent_amount + tenancy.service_charge,
            lease_start=tenancy.lease_start,
            period_start=period_start,
            period_end=period_end,
        )

        with transaction.atomic():
            entry, created = RentScheduleEntry.objects.get_or_create(
                tenancy=tenancy,
                period_ref=period_ref,
                defaults={
                    'marina': tenancy.marina,
                    'due_date': period_start,
                    'amount': amount,
                    'is_pro_rata': is_pro_rata,
                    'pro_rata_days': days_active if is_pro_rata else None,
                    'pro_rata_total_days': days_in_period if is_pro_rata else None,
                    'status': 'scheduled',
                }
            )

            if entry.status == 'invoiced':
                continue  # already processed — idempotent skip

            if entry.due_date > today:
                continue  # not yet due

            if not tenancy.rent_chargeable_item_id:
                continue  # marina has not configured a rent ChargeableItem

            invoice, inv_created = Invoice.objects.get_or_create(
                source_type='tenancy_rent',
                source_id=str(entry.pk),
                defaults={
                    'marina': tenancy.marina,
                    'member': None,
                    'tenant': tenancy.tenant,
                    'invoice_number': generate_invoice_number(tenancy.marina),
                    'status': 'draft',
                }
            )

            if inv_created:
                description = (
                    f'Rent — {tenancy.unit.unit_ref} ({days_active}/{days_in_period} days)'
                    if is_pro_rata
                    else f'Rent — {tenancy.unit.unit_ref}'
                )
                InvoiceLineItem.objects.create(
                    invoice=invoice,
                    description=description,
                    chargeable_item=tenancy.rent_chargeable_item,
                    quantity=1,
                    unit_price=entry.amount,
                    total_price=entry.amount,
                    tax_rate=tenancy.rent_chargeable_item.tax_rate,
                )
                invoice.subtotal = entry.amount
                invoice.total = entry.amount
                invoice.save(update_fields=['subtotal', 'total'])

            entry.status = 'invoiced'
            entry.invoice = invoice
            entry.save(update_fields=['status', 'invoice'])

            # Generate next period entry if none exists within next 2 periods
            _ensure_future_entries(tenancy, year, month, lookahead=2)


def _ensure_future_entries(tenancy, current_year, current_month, lookahead=2):
    """Creates scheduled entries for the next N months if they do not exist."""
    for i in range(1, lookahead + 1):
        month = current_month + i
        year = current_year + (month - 1) // 12
        month = ((month - 1) % 12) + 1
        period_start, period_end, period_ref = _get_period_bounds_monthly(year, month)

        if tenancy.lease_end and period_start > tenancy.lease_end:
            break

        amount, is_pro_rata, days_active, days_in_period = compute_pro_rata_amount(
            rent_amount=tenancy.rent_amount + tenancy.service_charge,
            lease_start=tenancy.lease_start,
            period_start=period_start,
            period_end=period_end,
        )

        RentScheduleEntry.objects.get_or_create(
            tenancy=tenancy,
            period_ref=period_ref,
            defaults={
                'marina': tenancy.marina,
                'due_date': period_start,
                'amount': amount,
                'is_pro_rata': is_pro_rata,
                'pro_rata_days': days_active if is_pro_rata else None,
                'pro_rata_total_days': days_in_period if is_pro_rata else None,
                'status': 'scheduled',
            }
        )


def create_rent_review_tasks(marina):
    """
    Called daily. Creates TenancyTask records for tenancies with next_review_date
    within 60 days where no open rent_review task exists.
    """
    from datetime import date, timedelta
    from apps.tenants.models import TenancyTask

    upcoming = date.today() + timedelta(days=60)
    tenancies = Tenancy.objects.filter(
        marina=marina,
        status='active',
        next_review_date__lte=upcoming,
        next_review_date__gte=date.today(),
    )
    for tenancy in tenancies:
        already_open = TenancyTask.objects.filter(
            tenancy=tenancy,
            task_type='rent_review',
            status__in=['open', 'in_progress'],
        ).exists()
        if not already_open:
            TenancyTask.objects.create(
                marina=marina,
                tenancy=tenancy,
                task_type='rent_review',
                title=f'Rent review due — {tenancy.unit.unit_ref} ({tenancy.tenant.display_name})',
                due_date=tenancy.next_review_date,
                status='open',
            )
```

#### `apps/tenants/services/deposit_service.py`

```python
def auto_create_deposit_invoice(tenancy_id: int):
    """
    Standalone function version — can be called directly where needed.
    The signal in signals.py calls this via transaction.on_commit.
    """
    from apps.tenants.models import Tenancy
    from billing.models import Invoice, InvoiceLineItem
    from apps.accounts.utils import generate_invoice_number

    tenancy = Tenancy.objects.select_related('marina', 'tenant', 'deposit_chargeable_item', 'unit').get(pk=tenancy_id)

    if not tenancy.deposit_chargeable_item_id or tenancy.deposit_amount <= 0:
        return

    invoice = Invoice.objects.create(
        marina=tenancy.marina,
        tenant=tenancy.tenant,
        member=None,
        source_type='tenancy_deposit',
        source_id=str(tenancy.pk),
        invoice_number=generate_invoice_number(tenancy.marina),
        status='draft',
    )
    InvoiceLineItem.objects.create(
        invoice=invoice,
        description=f'Security Deposit — {tenancy.unit.unit_ref}',
        chargeable_item=tenancy.deposit_chargeable_item,
        quantity=1,
        unit_price=tenancy.deposit_amount,
        total_price=tenancy.deposit_amount,
        tax_rate=tenancy.deposit_chargeable_item.tax_rate,
    )
    invoice.subtotal = tenancy.deposit_amount
    invoice.total = tenancy.deposit_amount
    invoice.save(update_fields=['subtotal', 'total'])

    Tenancy.objects.filter(pk=tenancy.pk).update(deposit_invoice=invoice)
    return invoice
```

### 2.5 Serializers (`apps/tenants/serializers.py`)

**`TenancySerializer`:**
- `validate(data)`: call `Tenancy.clean()` logic within the serializer's validate to surface errors before save. The ViewSet wraps create in `transaction.atomic()` and calls `select_for_update()` before calling the serializer.
- `validate_rent_chargeable_item`: must have `category='rent'`. Raise `ValidationError("rent_chargeable_item must have category='rent'.")`.
- `validate_deposit_chargeable_item`: must have `category='deposit'`.

**`InvoiceSerializer` update (apps/billing/serializers.py):**
- `validate(data)`: if `member` is None and `tenant` is None → raise `ValidationError('An invoice must have either a member or a tenant.')`. If both are set → raise `ValidationError('An invoice cannot have both a member and a tenant.')`.

**`RentScheduleEntrySerializer`:** read-only (staff cannot edit entries directly — only the scheduler does). Expose `period_ref`, `due_date`, `amount`, `status`, `is_pro_rata`, `pro_rata_days`, `pro_rata_total_days`, `invoice_id`.

### 2.6 Views (`apps/tenants/views.py`)

Use `generics.ListCreateAPIView` / `RetrieveUpdateDestroyAPIView`. All querysets filtered by `marina=self.request.user.marina`.

**`TenancyViewSet.create()`:** wrap the entire create sequence in `transaction.atomic()`. Before calling `serializer.save()`, run:
```python
from django.db import transaction
with transaction.atomic():
    # Acquire row-level lock on competing active tenancies for this unit
    Tenancy.objects.select_for_update().filter(unit=unit_id, status='active')
    # Now safe to run serializer.save() — clean() will check and raise if conflict exists
    serializer.save(marina=self.request.user.marina)
```

**Custom actions:**
- `GET /tenants/tenancies/{id}/schedule/` → list `RentScheduleEntry` records for the tenancy.
- `POST /tenants/tenancies/{id}/schedule/generate/` → manually trigger `run_rent_scheduler(marina, year, month)` for the current month. Body: `{"year": 2026, "month": 6}` (optional; defaults to current month). Returns list of entries created or already-invoiced.
- `GET/POST /tenants/tenancies/{id}/documents/` → list and upload `TenancyDocument` records.

### 2.7 URLs (`apps/tenants/urls.py`)

```python
from django.urls import path
from apps.tenants import views

urlpatterns = [
    # Commercial Units
    path('tenants/units/',                                    views.CommercialUnitListCreateView.as_view(),      name='tenants-unit-list'),
    path('tenants/units/<int:pk>/',                           views.CommercialUnitDetailView.as_view(),          name='tenants-unit-detail'),
    # Tenant Contacts
    path('tenants/contacts/',                                 views.TenantContactListCreateView.as_view(),       name='tenants-contact-list'),
    path('tenants/contacts/<int:pk>/',                        views.TenantContactDetailView.as_view(),           name='tenants-contact-detail'),
    # Tenancies
    path('tenants/tenancies/',                                views.TenancyListCreateView.as_view(),             name='tenants-tenancy-list'),
    path('tenants/tenancies/<int:pk>/',                       views.TenancyDetailView.as_view(),                 name='tenants-tenancy-detail'),
    path('tenants/tenancies/<int:pk>/documents/',             views.TenancyDocumentListCreateView.as_view(),     name='tenants-tenancy-documents'),
    path('tenants/tenancies/<int:pk>/schedule/',              views.RentScheduleListView.as_view(),              name='tenants-schedule-list'),
    path('tenants/tenancies/<int:pk>/schedule/generate/',     views.RentScheduleGenerateView.as_view(),          name='tenants-schedule-generate'),
    # Tasks
    path('tenants/tasks/',                                    views.TenancyTaskListCreateView.as_view(),         name='tenants-task-list'),
    path('tenants/tasks/<int:pk>/',                           views.TenancyTaskDetailView.as_view(),             name='tenants-task-detail'),
]
```

### 2.8 Admin (`apps/tenants/admin.py`)

```python
from django.contrib import admin
from apps.tenants.models import CommercialUnit, TenantContact, Tenancy, TenancyDocument, RentScheduleEntry, TenancyTask

@admin.register(CommercialUnit)
class CommercialUnitAdmin(admin.ModelAdmin):
    list_display = ['unit_ref', 'marina', 'unit_type', 'area_m2', 'is_active']
    list_filter = ['marina', 'unit_type', 'is_active']
    search_fields = ['unit_ref']

@admin.register(TenantContact)
class TenantContactAdmin(admin.ModelAdmin):
    list_display = ['display_name', 'marina', 'is_company', 'email', 'phone']
    list_filter = ['marina', 'is_company']
    search_fields = ['display_name', 'company_name', 'email']

@admin.register(Tenancy)
class TenancyAdmin(admin.ModelAdmin):
    list_display = ['unit', 'tenant', 'marina', 'status', 'lease_start', 'lease_end', 'rent_amount', 'rent_frequency']
    list_filter = ['marina', 'status', 'rent_frequency']
    raw_id_fields = ['unit', 'tenant', 'rent_chargeable_item', 'deposit_chargeable_item', 'deposit_invoice']

@admin.register(RentScheduleEntry)
class RentScheduleEntryAdmin(admin.ModelAdmin):
    list_display = ['tenancy', 'period_ref', 'due_date', 'amount', 'status', 'is_pro_rata']
    list_filter = ['status', 'is_pro_rata']

@admin.register(TenancyTask)
class TenancyTaskAdmin(admin.ModelAdmin):
    list_display = ['title', 'task_type', 'marina', 'status', 'due_date', 'assigned_to']
    list_filter = ['marina', 'task_type', 'status']
```

### 2.9 Management Command (Rent Scheduler Runner)

Since there is no Celery yet, implement a management command that is invoked by a cron job or OS task scheduler:

**`apps/tenants/management/commands/run_rent_scheduler.py`:**
```python
from django.core.management.base import BaseCommand
from django.utils import timezone
from apps.accounts.models import Marina
from apps.tenants.services.rent_scheduler import run_rent_scheduler, create_rent_review_tasks


class Command(BaseCommand):
    help = 'Run the monthly rent scheduler and rent review task creator for all marinas.'

    def handle(self, *args, **options):
        today = timezone.now().date()
        marinas = Marina.objects.filter(is_active=True)
        for marina in marinas:
            self.stdout.write(f'Processing marina: {marina}')
            run_rent_scheduler(marina, today.year, today.month)
            create_rent_review_tasks(marina)
        self.stdout.write(self.style.SUCCESS('Rent scheduler complete.'))
```

Schedule this command to run daily at 06:00 via cron / Windows Task Scheduler / server OS task runner.

---

## Part 3: `marketplace` App

### 3.1 App Skeleton

```
apps/marketplace/
    __init__.py
    apps.py
    models.py
    serializers.py
    views.py
    urls.py
    admin.py
```

**`apps/marketplace/apps.py`:**
```python
from django.apps import AppConfig

class MarketplaceConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.marketplace'
```

### 3.2 Models (`apps/marketplace/models.py`)

```python
from django.core.exceptions import ValidationError
from django.db import models


class BerthListing(models.Model):
    STATUS_CHOICES = [
        ('draft',       'Draft'),
        ('published',   'Published'),
        ('under_offer', 'Under Offer'),
        ('sold',        'Sold'),
        ('withdrawn',   'Withdrawn'),
    ]
    LISTING_PARTY_CHOICES = [
        ('member', 'Berth Holder'),
        ('marina', 'Marina'),
    ]

    marina                  = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='berth_listings')
    berth                   = models.ForeignKey('berths.Berth', on_delete=models.PROTECT, related_name='listings')
    listing_party           = models.CharField(max_length=10, choices=LISTING_PARTY_CHOICES, default='member')
    listed_by_member        = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='berth_listings')
    status                  = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    headline                = models.CharField(max_length=200, blank=True)
    description             = models.TextField(blank=True)
    asking_price            = models.DecimalField(max_digits=12, decimal_places=2)
    show_asking_price       = models.BooleanField(default=False)
    licence_transfer_terms  = models.TextField(blank=True)
    # Physical spec snapshot (denormalised — berth dimensions may change post-listing)
    length_m                = models.DecimalField(max_digits=6, decimal_places=1, null=True, blank=True)
    max_beam_m              = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    max_draft_m             = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    has_power               = models.BooleanField(default=False)
    has_water               = models.BooleanField(default=False)
    # Publication flags
    publish_to_portal       = models.BooleanField(default=True)
    publish_to_network      = models.BooleanField(default=False)   # v2 — never exposed in v1
    publish_to_third_party  = models.BooleanField(default=False)
    # Transaction outcome
    sale_price              = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    sold_to_member          = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='purchased_berths')
    transfer_date           = models.DateField(null=True, blank=True)
    published_at            = models.DateTimeField(null=True, blank=True)
    created_at              = models.DateTimeField(auto_now_add=True)
    updated_at              = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Listing: {self.berth} — {self.get_status_display()}'


class BerthListingPhoto(models.Model):
    listing     = models.ForeignKey(BerthListing, on_delete=models.CASCADE, related_name='photos')
    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='listing_photos')
    file        = models.ImageField(upload_to='berth_listing_photos/')
    caption     = models.CharField(max_length=200, blank=True)
    sort_order  = models.IntegerField(default=0)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['sort_order', 'uploaded_at']


class BerthEnquiry(models.Model):
    STATUS_CHOICES = [
        ('new',       'New'),
        ('contacted', 'Contacted'),
        ('closed',    'Closed'),
    ]

    listing         = models.ForeignKey(BerthListing, on_delete=models.CASCADE, related_name='enquiries')
    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='berth_enquiries')
    enquirer_member = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='berth_enquiries')
    # Anonymous enquiry fields (v1 path for non-member enquirers)
    enquirer_name   = models.CharField(max_length=200, blank=True)
    enquirer_email  = models.EmailField(blank=True)
    enquirer_phone  = models.CharField(max_length=30, blank=True)
    message         = models.TextField(blank=True)
    status          = models.CharField(max_length=20, choices=STATUS_CHOICES, default='new')
    created_at      = models.DateTimeField(auto_now_add=True)
    # v2 placeholder — not exposed in v1
    # enquirer_boater_profile = models.ForeignKey('accounts.BoaterProfile', null=True, blank=True, ...)

    class Meta:
        ordering = ['-created_at']


class ExchangeListing(models.Model):
    STATUS_CHOICES = [
        ('available', 'Available'),
        ('matched',   'Matched'),
        ('expired',   'Expired'),
        ('withdrawn', 'Withdrawn'),
    ]

    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='exchange_listings')
    berth            = models.ForeignKey('berths.Berth', on_delete=models.PROTECT, related_name='exchange_listings')
    member           = models.ForeignKey('members.Member', on_delete=models.PROTECT, related_name='exchange_listings')
    status           = models.CharField(max_length=20, choices=STATUS_CHOICES, default='available')
    available_from   = models.DateField()
    available_to     = models.DateField()
    notes            = models.TextField(blank=True)
    desired_location = models.CharField(max_length=500, blank=True)
    network_visible  = models.BooleanField(default=False)  # v2 — never exposed in v1
    created_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


class ExchangeAgreement(models.Model):
    STATUS_CHOICES = [
        ('pending',   'Pending Signature'),
        ('agreed',    'Agreed'),
        ('cancelled', 'Cancelled'),
    ]

    marina             = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='exchange_agreements')
    listing_a          = models.ForeignKey(ExchangeListing, on_delete=models.PROTECT, related_name='agreements_as_a')
    listing_b          = models.ForeignKey(ExchangeListing, on_delete=models.PROTECT, related_name='agreements_as_b')
    status             = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    party_a_start_date = models.DateField()
    party_a_end_date   = models.DateField()
    party_b_start_date = models.DateField()
    party_b_end_date   = models.DateField()
    agreed_at          = models.DateTimeField(null=True, blank=True)
    document           = models.FileField(upload_to='exchange_agreements/', null=True, blank=True)
    created_at         = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def clean(self):
        if self.party_a_start_date and self.party_a_end_date and self.party_a_start_date >= self.party_a_end_date:
            raise ValidationError({'party_a_end_date': 'Party A end date must be after start date.'})
        if self.party_b_start_date and self.party_b_end_date and self.party_b_start_date >= self.party_b_end_date:
            raise ValidationError({'party_b_end_date': 'Party B end date must be after start date.'})
        if self.listing_a_id:
            la = self.listing_a
            if self.party_b_start_date < la.available_from or self.party_b_end_date > la.available_to:
                raise ValidationError('Party B dates fall outside listing A\'s availability window.')
        if self.listing_b_id:
            lb = self.listing_b
            if self.party_a_start_date < lb.available_from or self.party_a_end_date > lb.available_to:
                raise ValidationError('Party A dates fall outside listing B\'s availability window.')
```

### 3.3 Views (`apps/marketplace/views.py`)

**`BerthListingViewSet`:**
- `publish(self, request, pk)` — POST: transition `draft` → `published`. Set `published_at = now()`.
- `mark_sold(self, request, pk)` — POST: body `{"sale_price": 12000, "sold_to_member": 45, "transfer_date": "2026-07-01"}`. Inside `transaction.atomic()`: set listing fields, then update `berth.owner = sold_to_member`, `berth.vessel = None`, `berth.lease_expiry = transfer_date`. Generate a licence transfer document via the `documents` app (create a `DocTemplate`-based `Envelope` if a charter agreement template exists). Set `listing.status = 'sold'`.

**Public listing view (unauthenticated):**
- `GET /public/marina/listings/` → returns published `BerthListing` records for the authenticated marina (identified by subdomain middleware). Serializer omits `asking_price` and substitutes `"P.O.A."` when `show_asking_price = False`.

**`ExchangeAgreementViewSet`:**
- `confirm(self, request, pk)` — POST: transition `pending` → `agreed`. Inside `transaction.atomic()`:
  1. Call `reservations.services.is_berth_available(berth=listing_a.berth, arrival=party_b_start_date, departure=party_b_end_date)`.
  2. Call `reservations.services.is_berth_available(berth=listing_b.berth, arrival=party_a_start_date, departure=party_a_end_date)`.
  3. If either is unavailable: return `HTTP 409` with `{"error": "berth_no_longer_available", "berth_id": <id>, "detail": "..."}`.
  4. Create two `Booking` records (one per berth) with `source='exchange'`, `status='reserved'`.
  5. Set `agreement.status = 'agreed'`, `agreement.agreed_at = now()`.

**`BerthEnquiryViewSet`:** standard CRUD. Unauthenticated POST to `listings/{id}/enquiries/` permitted for public portal enquirers (anonymous submissions). Return `HTTP 201`.

### 3.4 Public Serializer Note

```python
class PublicBerthListingSerializer(serializers.ModelSerializer):
    asking_price_display = serializers.SerializerMethodField()

    def get_asking_price_display(self, obj):
        return str(obj.asking_price) if obj.show_asking_price else 'P.O.A.'

    class Meta:
        model = BerthListing
        fields = [
            'id', 'berth', 'headline', 'description', 'asking_price_display',
            'length_m', 'max_beam_m', 'max_draft_m', 'has_power', 'has_water',
            'photos', 'published_at',
        ]
```

### 3.5 URLs (`apps/marketplace/urls.py`)

```python
from django.urls import path
from apps.marketplace import views

urlpatterns = [
    # Berth Listings (staff)
    path('marketplace/listings/',                               views.BerthListingListCreateView.as_view(),       name='marketplace-listing-list'),
    path('marketplace/listings/<int:pk>/',                      views.BerthListingDetailView.as_view(),           name='marketplace-listing-detail'),
    path('marketplace/listings/<int:pk>/publish/',              views.BerthListingPublishView.as_view(),          name='marketplace-listing-publish'),
    path('marketplace/listings/<int:pk>/mark-sold/',            views.BerthListingMarkSoldView.as_view(),         name='marketplace-listing-mark-sold'),
    path('marketplace/listings/<int:pk>/photos/',               views.BerthListingPhotoListCreateView.as_view(),  name='marketplace-listing-photos'),
    path('marketplace/listings/<int:pk>/enquiries/',            views.BerthEnquiryListCreateView.as_view(),       name='marketplace-listing-enquiries'),
    # Exchange Listings
    path('marketplace/exchange/',                               views.ExchangeListingListCreateView.as_view(),    name='marketplace-exchange-list'),
    path('marketplace/exchange/<int:pk>/',                      views.ExchangeListingDetailView.as_view(),        name='marketplace-exchange-detail'),
    path('marketplace/exchange/<int:pk>/agreements/',           views.ExchangeAgreementListCreateView.as_view(),  name='marketplace-exchange-agreements'),
    path('marketplace/exchange/agreements/<int:pk>/confirm/',   views.ExchangeAgreementConfirmView.as_view(),     name='marketplace-exchange-confirm'),
    # Public (unauthenticated) — extend portal public_urls instead of here
    # path('public/marina/listings/', ...) — add to apps/portal/public_urls.py
]
```

**Public listing endpoint** — add to `apps/portal/public_urls.py`:
```python
path('marina/listings/', views.PublicBerthListingView.as_view(), name='public-berth-listings'),
```

### 3.6 Admin (`apps/marketplace/admin.py`)

```python
from django.contrib import admin
from apps.marketplace.models import BerthListing, BerthListingPhoto, BerthEnquiry, ExchangeListing, ExchangeAgreement

@admin.register(BerthListing)
class BerthListingAdmin(admin.ModelAdmin):
    list_display = ['berth', 'marina', 'headline', 'asking_price', 'show_asking_price', 'status', 'published_at']
    list_filter = ['marina', 'status', 'listing_party']
    search_fields = ['headline', 'berth__name']

@admin.register(BerthEnquiry)
class BerthEnquiryAdmin(admin.ModelAdmin):
    list_display = ['listing', 'enquirer_name', 'enquirer_email', 'status', 'created_at']
    list_filter = ['status']

@admin.register(ExchangeListing)
class ExchangeListingAdmin(admin.ModelAdmin):
    list_display = ['berth', 'member', 'marina', 'status', 'available_from', 'available_to']
    list_filter = ['marina', 'status']

@admin.register(ExchangeAgreement)
class ExchangeAgreementAdmin(admin.ModelAdmin):
    list_display = ['listing_a', 'listing_b', 'status', 'agreed_at']
    list_filter = ['status']
```

---

## Part 4: Snag-A-Slip OTA Integration

Register `slug='snag_a_slip'` as a known `OTAConnection` type in the `berths` app. No new model required.

When a Snag-A-Slip booking is imported (inbound iCal or webhook, following the existing OTA adapter pattern in the `berths` app):
1. Create the `Booking` record with `source='snag_a_slip'`.
2. Calculate the OTA commission amount (from the Snag-A-Slip rate sheet stored in marina settings).
3. Set `booking.ota_commission_amount = commission_amount`.

AP invoice generation is deferred until the accounts payable module is specified. The commission amount is preserved on the `Booking` record.

---

## Part 5: Settings & URL Wiring

### 5.1 `config/settings/base.py`

Add to `LOCAL_APPS`:
```python
'apps.tenants',
'apps.marketplace',
```

### 5.2 `config/urls.py`

Add to the `api/v1/` include block:
```python
path('', include('apps.tenants.urls')),
path('', include('apps.marketplace.urls')),
```

---

## Part 6: Migration Notes

Migration order must be respected:

1. `makemigrations billing` — add `tenant` FK to `Invoice` (if not already done by Track 9). Additive only.
2. `makemigrations berths` — add `owner` FK and `lease_expiry` to `Berth`. **Must run before marketplace.**
3. `makemigrations reservations` — add `ota_commission_amount` to `Booking`.
4. `makemigrations tenants` — initial migration for all tenants models.
5. `makemigrations marketplace` — initial migration. Depends on `berths` migration (step 2) being applied.
6. `migrate` — apply all in order.

All migrations are additive. No existing data is modified.

---

## Part 7: Implementation Order (Step-by-Step)

### Step 1 — Berths model extension
- Add `owner` FK and `lease_expiry` to `Berth` model.
- Run `makemigrations berths` → `migrate`.
- Verify no existing berth admin views break (both fields are nullable).

### Step 2 — Billing Invoice `tenant` FK
- Add `tenant = ForeignKey('tenants.TenantContact', ...)` to `Invoice`.
- Run `makemigrations billing` → `migrate`.
- Update `InvoiceSerializer.validate()` to enforce exactly one of `member`/`tenant` is populated.
- Update dunning sweep logic to use `invoice.tenant.email` when `member` is null.

### Step 3 — Reservations `ota_commission_amount`
- Add field to `Booking`.
- Run `makemigrations reservations` → `migrate`.

### Step 4 — Create `tenants` app skeleton
- Create directory `apps/tenants/` with all files listed in §2.1.
- Register `'apps.tenants'` in `LOCAL_APPS`.
- Add `path('', include('apps.tenants.urls'))` to `config/urls.py`.

### Step 5 — Implement `tenants` models
- Write `apps/tenants/models.py` exactly as specified in §2.2.
- Run `makemigrations tenants` → `migrate`.
- Confirm FK references resolve: `accounts.Marina`, `billing.ChargeableItem`, `billing.Invoice`, `accounts.User`.

### Step 6 — Implement `tenants` signals
- Write `apps/tenants/signals.py` (§2.3).
- Ensure `TenantsConfig.ready()` imports signals.
- Test manually: create a `Tenancy` with `deposit_amount > 0` via Django shell → verify `deposit_invoice` is linked.

### Step 7 — Implement rent scheduler service
- Write `apps/tenants/services/rent_scheduler.py` (§2.4).
- Write unit tests:
  - `test_full_month_rent`: first of month, full period → amount = `rent_amount + service_charge`, `is_pro_rata=False`.
  - `test_pro_rata_first_month`: lease starts 15th of a 31-day month → amount = `(17/31) × rent`, `is_pro_rata=True`, `pro_rata_days=17`, `pro_rata_total_days=31`.
  - `test_idempotency`: run scheduler twice for same month → second run is a no-op (no duplicate invoices).
  - `test_future_entry_generation`: after invoicing June, entries for July and August are created.
  - `test_rent_review_task_creation`: tenancy with `next_review_date` within 60 days → task created; running again → no duplicate task.

### Step 8 — Implement `tenants` serializers and views
- Write `apps/tenants/serializers.py` (§2.5).
- Write `apps/tenants/views.py` (§2.6). Wrap `TenancyViewSet.create()` in `transaction.atomic()` with `select_for_update()` as described.
- Wire URLs.

### Step 9 — Implement management command
- Create `apps/tenants/management/commands/run_rent_scheduler.py`.
- Test: `python manage.py run_rent_scheduler` → verify no errors on an empty DB.
- Schedule via OS cron (Linux: `0 6 * * * python manage.py run_rent_scheduler`) or Windows Task Scheduler.

### Step 10 — Register `tenants` admin
- Write `apps/tenants/admin.py` (§2.8).
- Smoke-test in `/_platform/admin/`.

### Step 11 — Create `marketplace` app skeleton
- Create directory `apps/marketplace/` with all files.
- Register `'apps.marketplace'` in `LOCAL_APPS`.
- Add `path('', include('apps.marketplace.urls'))` to `config/urls.py`.

### Step 12 — Implement `marketplace` models
- Write `apps/marketplace/models.py` (§3.2).
- Run `makemigrations marketplace` → `migrate`.
- Confirm FK references resolve: `berths.Berth`, `members.Member`, `accounts.Marina`.

### Step 13 — Implement `marketplace` serializers and views
- Write `apps/marketplace/serializers.py`.
- Write `apps/marketplace/views.py` (§3.3).
- Implement `publish/` action (set `published_at`, status transition).
- Implement `mark-sold/` action: update berth owner, vessel = None, generate documents, set status.
- Implement `confirm/` exchange agreement action with race-condition guard (§3.3).
- Add public listing endpoint to `apps/portal/public_urls.py`.

### Step 14 — Register `marketplace` admin
- Write `apps/marketplace/admin.py` (§3.6).

### Step 15 — Snag-A-Slip OTA type
- In the berths OTA connection management, accept `slug='snag_a_slip'` (no code change needed — `slug` is free-text).
- Implement commission calculation in the existing OTA import path; set `booking.ota_commission_amount`.

### Step 16 — End-to-end smoke test
- Create a `CommercialUnit`, `TenantContact`, `Tenancy` with deposit. Verify deposit invoice auto-created.
- Run `run_rent_scheduler` management command. Verify `RentScheduleEntry` + draft `Invoice` created.
- Create a `BerthListing`. Call `publish/`. Verify status change. Hit public endpoint and verify P.O.A. when `show_asking_price=False`.
- Create two `ExchangeListing` records. Create `ExchangeAgreement`. Call `confirm/`. Verify two `Booking` records created.

### Step 17 — Frontend: "Commercial" sidebar and screens
- Build React Query hooks: `useCommercialUnits`, `useTenancies`, `useRentSchedule`, `useTenancyTasks`.
- Build `CommercialUnitsScreen.jsx`, `UnitFormDrawer.jsx`.
- Build `TenanciesScreen.jsx`, `TenancyDetailDrawer.jsx` (tabbed: Overview, Schedule, Documents, Tasks, History).
- Build `TenancyTasksScreen.jsx` with open-task badge logic.

### Step 18 — Frontend: Marketplace screen
- Build React Query hooks: `useBerthListings`, `useBerthEnquiries`, `useExchangeListings`.
- Build `MarketplaceScreen.jsx`, `ListingDetailDrawer.jsx` (tabbed: Listing, Enquiries, Transaction).
- Build `ExchangeList.jsx` with match/agreement actions.

---

## Part 8: Out of Scope for v1 (Do Not Implement)

The following are explicitly deferred to v2. Do not wire any routes, views, or UI for these:

- `BoaterProfile`, `BoaterVessel`, `MarinaNetworkMembership`, `MarinaPublicProfile`, `BoaterReview` — models not created in v1.
- All `/api/v1/boater/` namespace endpoints.
- Marina staff review management.
- Network opt-in settings UI (`/settings/network`).
- `publish_to_network` flag on `BerthListing` — field exists (defaults `False`) but is never exposed or checked in v1 logic.
- `ExchangeListing.network_visible` — field exists but never queried or displayed.
- Boater self-registration funnel.
- GDPR cross-marina data sharing consent flow.
- `docksbase.com/marinas/<slug>/` public profile pages.
