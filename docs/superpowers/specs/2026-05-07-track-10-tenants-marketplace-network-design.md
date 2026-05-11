# Track 10 — Tenants, Berth Marketplace & Boater Network: Design Spec
Date: 2026-05-07
Scope: Three related but architecturally distinct sub-modules: (1) commercial unit lettings and tenancy management on marina property, (2) a berth sale/exchange marketplace for berth holders, and (3) a cross-marina boater identity network. This spec covers Django data models, API contracts, frontend architecture, and the key architectural decision around global vs. per-marina identity.

> Spec status: Final — reviewed 2026-05-08

---

## 1. Architectural Goal

This track extends DocksBase from a single-marina operational tool into a platform with network effects. The three sub-modules each introduce a distinct architectural concern:

- **Tenants** are a new category of commercial counterparty — not boaters, not staff — who occupy physical commercial units on marina property under formal lease agreements. They need their own model graph (unit, tenancy, rent schedule) while reusing the existing `Invoice` billing pipeline.
- **Berth Marketplace** extends the existing `Berth` model with a listing lifecycle (for-sale, exchange), enquiry management, and OTA channel integration (Snag-A-Slip). All listing data stays marina-scoped. The public-facing aspect is a read-only portal surface, not a separate data layer.
- **Boater Network** is the most significant architectural departure: it requires a **global identity layer** that sits above the per-marina `Member` model. A `BoaterProfile` is not owned by any marina — it belongs to a registered boater and is recognised across all participating marinas. This breaks the `marina = ForeignKey(Marina)` convention that every other model follows. **The Boater Network is a v2 feature.** All `BoaterProfile`, `BoaterVessel`, `MarinaNetworkMembership`, `MarinaPublicProfile`, `BoaterReview`, and `/api/v1/boater/` endpoints are deferred. The architecture is documented here for planning purposes; implementation begins after Tenants and Marketplace are delivered.

The overriding constraint is that the existing `Invoice` / `ChargeableItem` billing pipeline must handle all rent invoicing — no parallel billing system is introduced. Tenancy rents become `ChargeableItem` records with a new `RENT` category.

---

## 2. New Django Apps

### 2a. New app: `tenants`

Create a new app `backend/apps/tenants/`. This is not extended into `members` because:
- A tenant contact may be a company (not a person/boater), requiring a different contact model. A commercial tenant dealing in a 500 m² chandlery brings company registration numbers, VAT IDs, guarantor documents, and significant financial liability — fields that have no place on a `Member` record.
- Tenancy has its own lifecycle (lease term, rent review, break clause) with no overlap with berth membership.
- Keeping tenancy logic in `members` would bloat the `Member` model and muddle the separation between berth holders and commercial lessees.

Registered under `INSTALLED_APPS` as `'apps.tenants'`.

### 2b. New app: `marketplace`

Create a new app `backend/apps/marketplace/`. Berth sale listings, exchange listings, and enquiries are distinct from the existing `reservations` and `berths` apps. The marketplace has its own lifecycle states (draft, published, under offer, sold) that do not map cleanly to `Booking` or `Berth.status`.

Registered under `INSTALLED_APPS` as `'apps.marketplace'`.

### 2c. Extend existing app: `accounts`

Add `BoaterProfile` (the global identity model) to `backend/apps/accounts/models.py` when the v2 Boater Network track begins. This app is the correct home because `accounts` already owns the global `User` model — the only model in the system with no `marina` FK.

### 2d. Extend existing app: `berths`

Add `owner = ForeignKey(Member)` and `lease_expiry = DateField()` directly to the `Berth` model (see Section 3.7). This is a v1 change required by the Berth Marketplace.

---

## 3. Data Models — Tenants & Commercial Lettings

### 3.1 `tenants.CommercialUnit`

Represents a single lettable space on marina property (chandlery, workshop, office, storage bay, parking bay, etc.).

```python
class CommercialUnit(models.Model):
    UNIT_TYPE_CHOICES = [
        ('chandlery',    'Chandlery / Marine Shop'),
        ('workshop',     'Workshop'),
        ('office',       'Office Suite'),
        ('storage',      'Dry Storage Unit'),
        ('retail',       'Retail Unit'),
        ('food_kiosk',   'Food & Beverage Kiosk Plot'),
        ('parking_bay',  'Car Parking Bay'),
        ('trailer_store','Boat Trailer Storage'),
    ]

    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='commercial_units')
    unit_ref       = models.CharField(max_length=50)           # e.g. "Unit 3B"
    unit_type      = models.CharField(max_length=30, choices=UNIT_TYPE_CHOICES)
    description    = models.TextField(blank=True)
    area_m2        = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    has_power      = models.BooleanField(default=False)
    has_water      = models.BooleanField(default=False)
    has_broadband  = models.BooleanField(default=False)
    is_active      = models.BooleanField(default=True)         # soft-delete / decommission
    notes          = models.TextField(blank=True)

    class Meta:
        unique_together = ('marina', 'unit_ref')
        ordering = ['unit_type', 'unit_ref']

    def __str__(self):
        return f'{self.unit_ref} — {self.get_unit_type_display()} ({self.marina})'
```

### 3.2 `tenants.TenantContact`

A commercial tenant — may be an individual or a company. Deliberately and completely separate from `Member`. A commercial lease counterparty is a different class of entity from a berth holder: they may be a company with a registered address, VAT number, and guarantors. Merging these into `Member` would pollute the berth-holder model with corporate legal fields. The separation is intentional and permanent.

```python
class TenantContact(models.Model):
    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='tenant_contacts')
    display_name   = models.CharField(max_length=200)           # person name or company name
    is_company     = models.BooleanField(default=False)
    company_name   = models.CharField(max_length=200, blank=True)
    contact_name   = models.CharField(max_length=200, blank=True)  # primary contact if is_company
    email          = models.EmailField(blank=True)
    phone          = models.CharField(max_length=30, blank=True)
    address        = models.TextField(blank=True)
    vat_number     = models.CharField(max_length=50, blank=True)
    notes          = models.TextField(blank=True)
    created_at     = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['display_name']

    def __str__(self):
        return f'{self.display_name} ({self.marina})'
```

### 3.3 `tenants.Tenancy`

The lease record linking a unit to a tenant. One unit can have at most one active tenancy at a time (enforced by a model-level `clean()` method and a DB partial unique index).

```python
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

    marina            = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='tenancies')
    unit              = models.ForeignKey(CommercialUnit, on_delete=models.PROTECT, related_name='tenancies')
    tenant            = models.ForeignKey(TenantContact, on_delete=models.PROTECT, related_name='tenancies')
    status            = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')

    # Lease terms
    lease_start       = models.DateField()
    lease_end         = models.DateField(null=True, blank=True)  # null = rolling / no fixed end
    notice_period_days= models.IntegerField(default=28)
    permitted_use     = models.CharField(max_length=500, blank=True)

    # Financial terms
    rent_amount       = models.DecimalField(max_digits=10, decimal_places=2)
    rent_frequency    = models.CharField(max_length=20, choices=FREQ_CHOICES, default='monthly')
    service_charge    = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    deposit_amount    = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    # deposit_held is NOT a BooleanField — see @property below.

    # Rent review
    next_review_date  = models.DateField(null=True, blank=True)
    review_notes      = models.TextField(blank=True)

    # Break clause
    break_clause_date = models.DateField(null=True, blank=True)
    break_clause_notes= models.CharField(max_length=500, blank=True)

    # Billing links
    # Category must be 'rent' (new category added to ChargeableItem — see Section 3.5)
    rent_chargeable_item = models.ForeignKey(
        'billing.ChargeableItem',
        on_delete=models.PROTECT,
        null=True, blank=True,
        related_name='tenancies',
        limit_choices_to={'category': 'rent'},
    )
    # Security deposit — must use a ChargeableItem mapped to a Liability GL account.
    # A deposit is NOT income until the tenancy ends and the marina retains it.
    # Storing it as a flat BooleanField loses the GL trail entirely.
    deposit_chargeable_item = models.ForeignKey(
        'billing.ChargeableItem',
        on_delete=models.PROTECT,
        null=True, blank=True,
        related_name='deposit_tenancies',
        limit_choices_to={'category': 'deposit'},
    )
    # The invoice raised for the deposit payment. OneToOne because one tenancy has
    # exactly one deposit invoice. Null until the deposit invoice is auto-generated
    # on tenancy creation (see post_save signal below).
    deposit_invoice = models.OneToOneField(
        'billing.Invoice',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='deposit_tenancy',
    )

    @property
    def deposit_held(self) -> bool:
        """True once the deposit invoice has been paid. Derived — never stored."""
        return self.deposit_invoice_id is not None and self.deposit_invoice.status == 'paid'

    created_at        = models.DateTimeField(auto_now_add=True)
    updated_at        = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-lease_start']

    def clean(self):
        from django.core.exceptions import ValidationError
        if self.status == 'active':
            # select_for_update() acquires a row-level lock on all active tenancies for
            # this unit before the uniqueness check. Without this lock, two concurrent
            # HTTP requests could both pass the 'no active tenancy' check and both create
            # a tenancy for the same unit — leaving the unit double-let.
            # This must be called inside an atomic transaction. The TenancyViewSet's
            # create() must wrap the clean() + save() call in transaction.atomic().
            qs = Tenancy.objects.select_for_update().filter(unit=self.unit, status='active')
            if self.pk:
                qs = qs.exclude(pk=self.pk)
            if qs.exists():
                raise ValidationError('This unit already has an active tenancy.')
        if self.lease_end and self.lease_end < self.lease_start:
            raise ValidationError({'lease_end': 'Lease end must be after lease start.'})

    def __str__(self):
        return f'Tenancy: {self.tenant} @ {self.unit} ({self.status})'
```

### 3.4 `tenants.TenancyDocument`

Document vault for lease-related files. Reuses the document storage infrastructure but scoped to the tenancy.

```python
class TenancyDocument(models.Model):
    DOC_TYPE_CHOICES = [
        ('lease_agreement',   'Lease Agreement'),
        ('guarantor',         'Guarantor Document'),
        ('planning_permission','Planning Permission'),
        ('compliance_cert',   'Compliance Certificate'),
        ('insurance',         'Insurance Certificate'),
        ('correspondence',    'Correspondence'),
        ('other',             'Other'),
    ]

    tenancy    = models.ForeignKey(Tenancy, on_delete=models.CASCADE, related_name='documents')
    marina     = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='tenancy_documents')
    doc_type   = models.CharField(max_length=30, choices=DOC_TYPE_CHOICES)
    file       = models.FileField(upload_to='tenancy_docs/')
    filename   = models.CharField(max_length=255, blank=True)
    expires_at = models.DateField(null=True, blank=True)
    notes      = models.CharField(max_length=500, blank=True)
    uploaded_at= models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-uploaded_at']

    def __str__(self):
        return f'{self.get_doc_type_display()} — {self.tenancy}'
```

### 3.5 `billing.ChargeableItem` — New `RENT` and `DEPOSIT` Categories

Add two new choices to `ChargeableItem.Category.choices`:

- `RENT = 'rent', 'Commercial Rent'` — for periodic rent invoices. `pricing_model = 'flat_fee'`, `unit_price` = the periodic rent amount. Named `f"Rent — {unit.unit_ref}"`.
- `DEPOSIT = 'deposit', 'Commercial Deposit'` — for tenancy security deposits. Must be mapped to a **Liability GL account** (not income) because the deposit is owed back to the tenant until the tenancy ends. Named `f"Deposit — {unit.unit_ref}"`.

These are two single-line additions to the existing model. Do not modify any other field on `ChargeableItem`.

### 3.5a `billing.Invoice` — `tenant` FK

Add the following field to `billing.Invoice`:

```python
# On billing.Invoice — populated for all rent and deposit invoices
tenant = models.ForeignKey(
    'tenants.TenantContact',
    on_delete=models.SET_NULL,
    null=True, blank=True,
    related_name='invoices',
)
```

**Why this field is required:** Tenant invoices have no `member` — a commercial lessee (`TenantContact`) is a different entity class from a berth holder (`Member`). Without a `tenant` FK, the Invoice record is orphaned: the billing UI cannot link it back to the counterparty, and the dunning engine cannot determine who to chase for overdue rent. Both `member` and `tenant` remain nullable — an invoice always has exactly one of the two populated (enforced in the serializer `validate()` method).

**Dunning engine update:** When the overdue invoice sweep runs, it must check `invoice.tenant` if `invoice.member` is null. The notification target for a tenant invoice is `invoice.tenant.email`. The dunning letter template must use `tenant.display_name` in place of the member name.

### 3.6 `tenants.RentScheduleEntry`

Tracks each rent invoice that has been, or is scheduled to be, generated for a tenancy. The scheduler (Celery beat task) reads outstanding entries and creates `Invoice` + `InvoiceLineItem` records when the due date arrives.

```python
class RentScheduleEntry(models.Model):
    STATUS_CHOICES = [
        ('scheduled', 'Scheduled'),
        ('invoiced',  'Invoiced'),
        ('cancelled', 'Cancelled'),
    ]

    tenancy    = models.ForeignKey(Tenancy, on_delete=models.CASCADE, related_name='schedule_entries')
    marina     = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='rent_schedule_entries')
    period_ref = models.CharField(max_length=20)   # e.g. "2026-06" or "Q2-2026"
    due_date   = models.DateField()
    amount     = models.DecimalField(max_digits=10, decimal_places=2)
    status     = models.CharField(max_length=20, choices=STATUS_CHOICES, default='scheduled')
    invoice    = models.OneToOneField(
        'billing.Invoice',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='rent_schedule_entry',
    )

    # Pro-rata fields — populated by compute_pro_rata_amount() when lease_start or
    # lease_end falls mid-period. When is_pro_rata=True, `amount` already holds the
    # reduced figure; these two integer fields allow the invoice renderer to describe
    # the partial period (e.g. "18/31 days") without re-deriving calendar arithmetic.
    is_pro_rata       = models.BooleanField(default=False)
    pro_rata_days     = models.PositiveIntegerField(null=True, blank=True)  # days active in period
    pro_rata_total_days = models.PositiveIntegerField(null=True, blank=True)  # total days in period

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['due_date']
        unique_together = ('tenancy', 'period_ref')

    def __str__(self):
        return f'Rent {self.period_ref} — {self.tenancy} ({self.status})'
```

**Scheduler logic (Celery beat, runs daily):**

**The rent scheduler must be idempotent — re-running it for a period that already has invoices must be a no-op.** Use `get_or_create` keyed on the `RentScheduleEntry` to prevent duplicate invoices if the task fires twice (e.g. Celery retry after a transient failure or accidental manual re-run).

1. Query all `RentScheduleEntry` records where `status='scheduled'` and `due_date <= today`.
2. For each entry:
   - If `entry.is_pro_rata` is `True`: use `entry.amount` as-is (already computed by the pro-rata engine — see below). Otherwise use `tenancy.rent_amount + tenancy.service_charge`.
   - Use `get_or_create` to find or create the `Invoice`, keyed on the deterministic lookup `(source_type='tenancy_rent', source_id=str(entry.pk))`. This ensures re-running the scheduler for a period that already has an invoice is a no-op:
     ```python
     invoice, created = Invoice.objects.get_or_create(
         source_type='tenancy_rent',
         source_id=str(entry.pk),   # keyed on RentScheduleEntry PK — unique per period
         defaults={
             'marina': tenancy.marina,
             'member': None,
             'tenant': entry.tenancy.tenant,
             'status': 'draft',
         }
     )
     if created:
         InvoiceLineItem.objects.create(
             invoice=invoice,
             chargeable_item=tenancy.rent_chargeable_item,
             quantity=1,
             unit_price=entry.amount,
         )
     ```
   - Note: `source_id` uses `entry.pk` (the `RentScheduleEntry` PK), not `tenancy.pk`. Using `tenancy.pk` would collide across multiple periods for the same tenancy.
3. Set `entry.status = 'invoiced'` and link `entry.invoice` (idempotent: skip if already `invoiced`).
4. After creating each invoice, generate future schedule entries forward by one period if none exist within the next two periods (rolling generation). This avoids creating years of entries upfront while ensuring the schedule is always visible at least one period ahead.

**Pro-rata engine (called at schedule generation time, not invoice time):**

When a new `Tenancy` is created or a tenancy ends mid-period, the first and/or last `RentScheduleEntry` may cover a partial month/quarter. The scheduler must detect this and create a pro-rata entry:

```python
from calendar import monthrange
from decimal import Decimal

def compute_pro_rata_amount(rent_amount, lease_start, period_start, period_end):
    """
    lease_start: date the tenancy begins (may be mid-month)
    period_start / period_end: first and last day of the billing period
    Returns (amount, is_pro_rata, days_active, days_in_period)
    """
    days_in_period = (period_end - period_start).days + 1
    active_start = max(lease_start, period_start)
    days_active = (period_end - active_start).days + 1
    if days_active == days_in_period:
        return rent_amount, False, days_active, days_in_period
    amount = (Decimal(days_active) / Decimal(days_in_period)) * rent_amount
    return amount.quantize(Decimal('0.01')), True, days_active, days_in_period
```

Set `RentScheduleEntry.is_pro_rata = True`, `pro_rata_days = days_active`, `pro_rata_total_days = days_in_period` on any entry where the result is partial. The invoice line item description must read `f"Rent — {unit.unit_ref} ({days_active}/{days_in_period} days)"` for pro-rata entries so the tenant's invoice is self-explanatory.

### 3.7 `tenants.TenancyTask`

A lightweight administrative task model for office workflows — explicitly not a `WorkOrder` from the boatyard `maintenance` app. Boatyard work and office lease administration are completely separate workflows and must not share a task table.

```python
class TenancyTask(models.Model):
    STATUS_CHOICES = [
        ('open',       'Open'),
        ('in_progress','In Progress'),
        ('done',       'Done'),
        ('cancelled',  'Cancelled'),
    ]
    TYPE_CHOICES = [
        ('rent_review',    'Rent Review'),
        ('lease_renewal',  'Lease Renewal'),
        ('compliance',     'Compliance Check'),
        ('general',        'General'),
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

**Rent review task trigger:** A Celery beat task checks all active `Tenancy` records where `next_review_date` is within 60 days and no open `TenancyTask` of type `rent_review` exists for that tenancy. It creates a `TenancyTask` assigned to the marina manager with `task_type='rent_review'` and `due_date = tenancy.next_review_date`.

**Deposit invoice auto-generation (post_save signal):**

```python
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.db import transaction

@receiver(post_save, sender=Tenancy)
def auto_create_deposit_invoice(sender, instance, created, **kwargs):
    """
    On tenancy creation, if deposit_amount > 0, auto-generate a deposit Invoice
    and link it back to tenancy.deposit_invoice.
    The ChargeableItem used must have category='deposit' and be mapped to a
    Liability GL account — the deposit is owed back to the tenant, not income.
    """
    if not created or instance.deposit_amount <= 0:
        return
    if not instance.deposit_chargeable_item_id:
        return  # marina must configure a deposit ChargeableItem first

    def _create():
        from billing.models import Invoice, InvoiceLineItem
        invoice = Invoice.objects.create(
            marina=instance.marina,
            tenant=instance.tenant,
            member=None,
            source_type='tenancy_deposit',
            source_id=str(instance.pk),
            status='draft',
        )
        InvoiceLineItem.objects.create(
            invoice=invoice,
            chargeable_item=instance.deposit_chargeable_item,
            quantity=1,
            unit_price=instance.deposit_amount,
        )
        Tenancy.objects.filter(pk=instance.pk).update(deposit_invoice=invoice)

    transaction.on_commit(_create)
```

The deposit `Invoice` is created in `draft` status and issued manually by staff (the marina must confirm the deposit amount before sending). The `deposit_held` property returns `True` only once the invoice transitions to `paid`.

---

## 4. Data Models — Berth Marketplace

### 4.1 `berths.Berth` — New Ownership Fields

Add the following two fields directly to the existing `Berth` model. This is a v1 requirement: in a leasehold marina the marina owns the seabed but a `Member` owns the long-term berth licence. Without tracking the licence owner on the `Berth` itself, it is impossible to correctly route annual maintenance fee `ChargeableItem` records or to validate who is legally entitled to sell or sub-let the berth.

```python
# New fields on berths.Berth
owner        = models.ForeignKey(
    'members.Member',
    on_delete=models.SET_NULL,
    null=True, blank=True,
    related_name='owned_berths',
)
lease_expiry = models.DateField(null=True, blank=True)
```

A migration must be created for these additions before the `marketplace` app references `Berth.owner`.

### 4.2 `marketplace.BerthListing`

A for-sale listing placed on a berth. The berth owner (a `Member`) or the marina itself can be the listing party.

Published listings are visible to the general public via the marina's booking portal (`GET /public/marina/listings/`) without requiring login. The asking price defaults to "Price on Application" (`show_asking_price = False`). The listing seller may explicitly enable public price display by toggling `show_asking_price = True`. This behaviour protects market value at premium marinas while allowing open lead generation.

```python
class BerthListing(models.Model):
    STATUS_CHOICES = [
        ('draft',      'Draft'),
        ('published',  'Published'),
        ('under_offer','Under Offer'),
        ('sold',       'Sold'),
        ('withdrawn',  'Withdrawn'),
    ]
    LISTING_PARTY_CHOICES = [
        ('member', 'Berth Holder'),
        ('marina', 'Marina'),
    ]

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='berth_listings')
    berth           = models.ForeignKey('berths.Berth', on_delete=models.PROTECT, related_name='listings')
    listing_party   = models.CharField(max_length=10, choices=LISTING_PARTY_CHOICES, default='member')
    listed_by_member= models.ForeignKey(
        'members.Member', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='berth_listings',
    )
    status          = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')

    # Listing content
    headline        = models.CharField(max_length=200, blank=True)
    description     = models.TextField(blank=True)
    asking_price    = models.DecimalField(max_digits=12, decimal_places=2)
    show_asking_price = models.BooleanField(default=False)  # False = display "P.O.A." publicly
    licence_transfer_terms = models.TextField(blank=True)

    # Physical spec (denormalised snapshot — berth dimensions may change after listing)
    length_m        = models.DecimalField(max_digits=6, decimal_places=1, null=True, blank=True)
    max_beam_m      = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    max_draft_m     = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    has_power       = models.BooleanField(default=False)
    has_water       = models.BooleanField(default=False)

    # Publication flags
    publish_to_portal    = models.BooleanField(default=True)   # marina's own portal
    publish_to_network   = models.BooleanField(default=False)  # DocksBase public marketplace (v2)
    publish_to_third_party = models.BooleanField(default=False) # e.g. Marina Match

    # Transaction outcome
    sale_price      = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    sold_to_member  = models.ForeignKey(
        'members.Member', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='purchased_berths',
    )
    transfer_date   = models.DateField(null=True, blank=True)

    published_at    = models.DateTimeField(null=True, blank=True)
    created_at      = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Listing: {self.berth} — {self.get_status_display()}'
```

**On sale completion:** set `berth.vessel = None`, update `berth.owner` to `sold_to_member`, and update `berth.lease_expiry` as appropriate. Generate a licence transfer document via the `documents` app.

**Public portal serializer:** When serving `GET /public/marina/listings/`, the serializer omits `asking_price` and substitutes the string `"P.O.A."` if `show_asking_price = False`.

### 4.3 `marketplace.BerthListingPhoto`

```python
class BerthListingPhoto(models.Model):
    listing    = models.ForeignKey(BerthListing, on_delete=models.CASCADE, related_name='photos')
    marina     = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='listing_photos')
    file       = models.ImageField(upload_to='berth_listing_photos/')
    caption    = models.CharField(max_length=200, blank=True)
    sort_order = models.IntegerField(default=0)
    uploaded_at= models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['sort_order', 'uploaded_at']
```

### 4.4 `marketplace.BerthEnquiry`

Logged when an interested party submits an enquiry through the portal or marketplace. The enquirer may be a registered `Member` or an anonymous email submission. Because the Boater Network is v2, the `enquirer_boater_profile` FK is deferred; anonymous enquiry capture via name/email/phone is the v1 path for non-member enquirers.

```python
class BerthEnquiry(models.Model):
    STATUS_CHOICES = [
        ('new',      'New'),
        ('contacted','Contacted'),
        ('closed',   'Closed'),
    ]

    listing         = models.ForeignKey(BerthListing, on_delete=models.CASCADE, related_name='enquiries')
    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='berth_enquiries')
    enquirer_member = models.ForeignKey(
        'members.Member', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='berth_enquiries',
    )
    # For anonymous enquiries:
    enquirer_name   = models.CharField(max_length=200, blank=True)
    enquirer_email  = models.EmailField(blank=True)
    enquirer_phone  = models.CharField(max_length=30, blank=True)
    message         = models.TextField(blank=True)
    status          = models.CharField(max_length=20, choices=STATUS_CHOICES, default='new')
    created_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
```

### 4.5 `marketplace.ExchangeListing`

A berth holder registers their berth for reciprocal holiday exchange — "I'll make my berth available if someone swaps theirs with me at another time/marina."

```python
class ExchangeListing(models.Model):
    STATUS_CHOICES = [
        ('available', 'Available'),
        ('matched',   'Matched'),
        ('expired',   'Expired'),
        ('withdrawn', 'Withdrawn'),
    ]

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='exchange_listings')
    berth       = models.ForeignKey('berths.Berth', on_delete=models.PROTECT, related_name='exchange_listings')
    member      = models.ForeignKey('members.Member', on_delete=models.PROTECT, related_name='exchange_listings')
    status      = models.CharField(max_length=20, choices=STATUS_CHOICES, default='available')

    available_from = models.DateField()
    available_to   = models.DateField()
    notes          = models.TextField(blank=True)

    # Desired exchange: free-text description of where/when they want to go
    desired_location = models.CharField(max_length=500, blank=True)

    # Publication: visible to other holders at this marina, or to the full DocksBase network (v2)
    network_visible = models.BooleanField(default=False)

    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
```

### 4.6 `marketplace.ExchangeAgreement`

Generated when two holders agree to an exchange. Blocks both berths in their respective calendars for the agreed periods.

```python
class ExchangeAgreement(models.Model):
    STATUS_CHOICES = [
        ('pending',   'Pending Signature'),
        ('agreed',    'Agreed'),
        ('cancelled', 'Cancelled'),
    ]

    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='exchange_agreements')
    listing_a        = models.ForeignKey(ExchangeListing, on_delete=models.PROTECT, related_name='agreements_as_a')
    listing_b        = models.ForeignKey(ExchangeListing, on_delete=models.PROTECT, related_name='agreements_as_b')
    status           = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')

    # Explicit agreed date ranges for each party.
    # listing_a.available_from/to defines the WINDOW in which the berth is offered — not
    # the agreed swap dates. A listing open for the whole of July may agree a swap for
    # just 5–12 July. Without these four date fields the system has no record of which
    # specific dates are locked, and calendar blocking is impossible.
    party_a_start_date = models.DateField(
        help_text='Start of the date window Party A (listing_a owner) will use listing_b\'s berth.'
    )
    party_a_end_date   = models.DateField(
        help_text='End of the date window Party A will use listing_b\'s berth.'
    )
    party_b_start_date = models.DateField(
        help_text='Start of the date window Party B (listing_b owner) will use listing_a\'s berth.'
    )
    party_b_end_date   = models.DateField(
        help_text='End of the date window Party B will use listing_a\'s berth.'
    )

    agreed_at        = models.DateTimeField(null=True, blank=True)
    document         = models.FileField(upload_to='exchange_agreements/', null=True, blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def clean(self):
        from django.core.exceptions import ValidationError
        if self.party_a_start_date and self.party_a_end_date and self.party_a_start_date >= self.party_a_end_date:
            raise ValidationError({'party_a_end_date': 'Party A end date must be after start date.'})
        if self.party_b_start_date and self.party_b_end_date and self.party_b_start_date >= self.party_b_end_date:
            raise ValidationError({'party_b_end_date': 'Party B end date must be after start date.'})
        # Agreed dates must fall within the respective listing's availability window
        if self.listing_a_id:
            la = self.listing_a
            if self.party_b_start_date < la.available_from or self.party_b_end_date > la.available_to:
                raise ValidationError('Party B dates fall outside listing A\'s availability window.')
        if self.listing_b_id:
            lb = self.listing_b
            if self.party_a_start_date < lb.available_from or self.party_a_end_date > lb.available_to:
                raise ValidationError('Party A dates fall outside listing B\'s availability window.')
```

**Calendar blocking with race-condition guard:** On the `confirm/` endpoint transitioning `status` to `'agreed'`, the view must:

1. Run `reservations.services.is_berth_available(berth=listing_a.berth, arrival=party_b_start_date, departure=party_b_end_date)` for listing_a's berth.
2. Run `reservations.services.is_berth_available(berth=listing_b.berth, arrival=party_a_start_date, departure=party_a_end_date)` for listing_b's berth.
3. If either check fails: return `409 Conflict` with body `{"error": "berth_no_longer_available", "berth_id": <id>, "detail": "A booking was placed on this berth while the exchange was pending."}` and rollback — do NOT transition the agreement to `agreed`.
4. If both are clear: inside `transaction.atomic()`, create two `Booking` records (one per berth) with `source='exchange'`, `status='reserved'`, using the exact `party_a_*` and `party_b_*` date fields as `arrival`/`departure`. Set `agreement.status = 'agreed'` and `agreement.agreed_at = now()` within the same transaction.

This prevents the scenario where a paying transient guest is assigned to a berth while the exchange is `pending`, and the subsequent `confirm/` call blindly double-books it.

---

## 5. Boater Network Architecture (v2 — Deferred)

### 5.1 Decision

The Boater Network is a v2 feature. The Tenants and Marketplace sub-modules are delivered first as they generate immediate ROI for the marina operator.

The global identity layer (`BoaterProfile`) breaks the per-marina multi-tenant isolation boundary. It also requires cross-marina data sharing consent mechanisms (GDPR), a standalone consumer-facing portal, and significant rewrites to the authentication flow. These concerns are out of scope for v1.

### 5.2 Architecture Summary (for v2 planning)

When the v2 Boater Network track begins:

- `BoaterProfile` and `BoaterVessel` are added to `backend/apps/accounts/`. They carry no `marina` FK — they belong to the global `accounts` app alongside the existing `User` model.
- `MarinaNetworkMembership` (marina opt-in) and `MarinaPublicProfile` (public-facing marina content) are added to `accounts/`.
- `BoaterReview` (post-stay reviews linked to a `BoaterProfile` and a marina) is added to `accounts/`.
- `BoaterProfile` creation is invite-only: a marina creates a `Member` record and the boater is invited to claim their global profile via a magic link. Open self-registration is not supported to protect data quality.
- The vessel pre-fill flow is unidirectional: global `BoaterVessel` → marina `vessels.Vessel`. The marina's copy is never pushed back to the global profile. The boater updates their global profile directly through the boater portal.
- All `/api/v1/boater/` endpoints and the `docksbase.com/marinas/<slug>/` public profile pages are v2 deliverables.

The `BerthEnquiry.enquirer_boater_profile` FK and `BerthListing.publish_to_network` flag are included in v1 models as nullable/defaulting-false fields to avoid a breaking migration at v2, but they are not exposed or used in v1 APIs or UI.

---

## 6. Snag-A-Slip Integration & OTA Commission

### 6.1 OTA Connection

Snag-A-Slip is handled as a specialised `OTAConnection` (the model already exists in `berths.OTAConnection`). A new `slug='snag_a_slip'` OTA connection type is registered. Inbound bookings import as `Booking` records with `source='snag_a_slip'`.

No new model is required for the connection or the booking itself.

### 6.2 Commission Accounting

Snag-A-Slip (like Dockwa or Booking.com) collects the gross amount from the boater, holds the funds, and remits the net amount to the marina at the end of the month with a commission invoice for their cut. The marina's income accounting must reflect this reality:

- The boater's `Invoice` shows the full gross amount (e.g. €100). No negative line item is added to the boater's invoice; their receipt must not show a deduction they did not make.
- The Snag-A-Slip commission (e.g. €15) is recorded as a separate **accounts payable invoice** against a "Snag-A-Slip" supplier account, not as a line item on the boater's booking invoice.

Implementation: when a Snag-A-Slip booking is imported and a marina `Invoice` is generated, a corresponding AP expense entry is created. The exact AP model will be specified when the accounts payable module is designed; for now, the commission amount is stored on the `Booking` record via a new `ota_commission_amount` field (`DecimalField`, nullable) so it is not lost before AP is implemented.

---

## 7. API Contract

All endpoints follow the pattern `/api/v1/<app>/<resource>/`. All marina-scoped endpoints are filtered by the authenticated user's `marina` automatically at the ViewSet level.

### 7.1 Tenants APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/v1/tenants/units/` | List / create commercial units |
| GET/PATCH | `/api/v1/tenants/units/{id}/` | Retrieve / update a unit |
| GET/POST | `/api/v1/tenants/contacts/` | List / create tenant contacts |
| GET/PATCH | `/api/v1/tenants/contacts/{id}/` | Retrieve / update a contact |
| GET/POST | `/api/v1/tenants/tenancies/` | List / create tenancies |
| GET/PATCH | `/api/v1/tenants/tenancies/{id}/` | Retrieve / update a tenancy |
| GET/POST | `/api/v1/tenants/tenancies/{id}/documents/` | List / upload tenancy documents |
| GET | `/api/v1/tenants/tenancies/{id}/schedule/` | View rent schedule entries for a tenancy |
| POST | `/api/v1/tenants/tenancies/{id}/schedule/generate/` | Manually trigger schedule generation (staff action) |
| GET/POST | `/api/v1/tenants/tasks/` | List / create tenancy tasks |
| GET/PATCH | `/api/v1/tenants/tasks/{id}/` | Retrieve / update a tenancy task |

No hard DELETE on tenancy records — soft-close via `status='terminated'`.

### 7.2 Marketplace APIs

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/v1/marketplace/listings/` | List / create berth sale listings |
| GET/PATCH | `/api/v1/marketplace/listings/{id}/` | Retrieve / update listing |
| POST | `/api/v1/marketplace/listings/{id}/publish/` | Transition draft → published |
| POST | `/api/v1/marketplace/listings/{id}/mark-sold/` | Record sale transaction |
| GET/POST | `/api/v1/marketplace/listings/{id}/photos/` | Upload / list listing photos |
| GET/POST | `/api/v1/marketplace/listings/{id}/enquiries/` | List / submit enquiries |
| GET/POST | `/api/v1/marketplace/exchange/` | List / create exchange listings |
| GET/PATCH | `/api/v1/marketplace/exchange/{id}/` | Retrieve / update exchange listing |
| GET/POST | `/api/v1/marketplace/exchange/{id}/agreements/` | List / create exchange agreements |
| POST | `/api/v1/marketplace/exchange/agreements/{id}/confirm/` | Confirm agreement and block calendars |

Public (unauthenticated) endpoints for the marina's own portal:

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/public/marina/listings/` | Public berth sale listings for this marina's portal (price shown as "P.O.A." unless `show_asking_price=True`) |

### 7.3 Boater Network APIs (v2 — Deferred)

All `/api/v1/boater/` endpoints and marina staff review management endpoints (`/api/v1/accounts/reviews/`) are v2 deliverables and are not implemented in v1.

---

## 8. Frontend Architecture

### 8.1 New Sidebar Section: "Commercial"

Add a new sidebar group **"Commercial"** between the existing "Billing" and "Boatyard" groups:

- **Units** → `/commercial/units` — commercial unit inventory
- **Tenancies** → `/commercial/tenancies` — active tenancies list
- **Tasks** → `/commercial/tasks` — tenancy task list (rent reviews, lease renewals)
- **Berth Marketplace** → `/marketplace` — listing management

The existing nav pattern (sidebar group → screen → drawer) is followed throughout.

### 8.2 Commercial Units Screen (`/commercial/units`)

Pattern: List + Drawer (same as Service Catalog screen).

- `CommercialUnitsScreen.jsx` — wrapper with "+ Add Unit" button
- `UnitList.jsx` — table: Unit Ref, Type, Area (m²), Facilities badges, Current Tenant, Status
- `UnitFormDrawer.jsx` — create / edit unit; deactivate action (no hard delete)

### 8.3 Tenancies Screen (`/commercial/tenancies`)

Pattern: List with status filter tabs (Active | Notice | Expired | All) + Drawer.

- `TenanciesScreen.jsx` — wrapper with tabs and "+ New Tenancy" button
- `TenancyList.jsx` — table: Unit, Tenant, Rent (with frequency), Lease End, Review Date, Status badge
- `TenancyDetailDrawer.jsx` — tabbed drawer:
  - **Overview**: lease terms, rent, dates
  - **Schedule**: `RentScheduleEntry` list with invoice links; "Generate Next Invoice" manual action
  - **Documents**: file upload list; expiry date badges for documents with `expires_at`
  - **Tasks**: `TenancyTask` list scoped to this tenancy; inline "Add Task" action
  - **History**: audit trail of status changes and rent reviews

### 8.4 Tenancy Tasks Screen (`/commercial/tasks`)

- `TenancyTasksScreen.jsx` — list of all `TenancyTask` records for this marina, filterable by status (Open | In Progress | Done | All) and by type (Rent Review | Lease Renewal | Compliance | General)
- Row actions: Mark In Progress, Mark Done
- Alert badge in sidebar nav when open `TenancyTask` records with `due_date <= today` exist

### 8.5 Berth Marketplace Screen (`/marketplace`)

Pattern: List with status filter tabs (Published | Under Offer | Draft | Sold | All) + Drawer.

- `MarketplaceScreen.jsx` — wrapper with tabs and "+ New Listing" button
- `ListingList.jsx` — table: Berth, Headline, Asking Price (or "P.O.A."), Enquiries count, Status, Published Date
- `ListingDetailDrawer.jsx` — tabbed drawer:
  - **Listing**: content fields, publish toggles, `show_asking_price` toggle, photo upload gallery
  - **Enquiries**: `BerthEnquiry` list with status and reply action
  - **Transaction**: mark as Under Offer / Sold form

Exchange sub-section within the same screen (secondary tab on the Marketplace screen):

- **Exchanges tab** → `ExchangeList.jsx` — table of exchange listings with match/agreement actions

### 8.6 Boater Network Settings (v2 — Deferred)

The network opt-in form, public marina profile editor, and reviews management screen (`/settings/network`, `/reports/reviews`) are v2 deliverables.

### 8.7 Hooks

Follow the pattern from `useServiceCatalog.js`. Create:

```
hooks/useCommercialUnits.js    — GET/POST/PATCH /tenants/units/
hooks/useTenancies.js          — GET/POST/PATCH /tenants/tenancies/
hooks/useRentSchedule.js       — GET /tenants/tenancies/{id}/schedule/
hooks/useTenancyTasks.js       — GET/POST/PATCH /tenants/tasks/
hooks/useBerthListings.js      — GET/POST/PATCH /marketplace/listings/
hooks/useBerthEnquiries.js     — GET /marketplace/listings/{id}/enquiries/
hooks/useExchangeListings.js   — GET/POST/PATCH /marketplace/exchange/
```

All hooks: React Query + Axios, toast on mutation success/error, invalidate relevant query key on mutation success.

---

## 9. Implementation Steps (Ordered)

Steps are ordered to respect Django migration and FK dependencies.

1. **Add `owner` and `lease_expiry` fields to `berths.Berth`** — migration required before marketplace references them. This also enables correct annual fee routing via `ChargeableItem`.

2. **Add `RENT` and `DEPOSIT` categories to `ChargeableItem`** — two-line model change + migration. Both must come before `Tenancy` references them. Ensure the `DEPOSIT` category's `ChargeableItem` is documented as requiring a Liability GL account mapping during marina onboarding.

2a. **Add `tenant` FK to `billing.Invoice`** — `ForeignKey('tenants.TenantContact', null=True, blank=True, SET_NULL)`. Migration required. Serializer `validate()` must enforce that exactly one of `member` / `tenant` is populated. Update the dunning engine sweep to check `invoice.tenant` when `invoice.member is None`.

3. **Create `tenants` app** — register in `INSTALLED_APPS`, create `CommercialUnit`, `TenantContact`, `Tenancy` (with `deposit_chargeable_item`, `deposit_invoice` FKs; no `deposit_held` BooleanField — it is now a `@property`), `TenancyDocument`, `RentScheduleEntry` (with `is_pro_rata`, `pro_rata_days`, `pro_rata_total_days` fields), `TenancyTask` models, initial migrations.

4. **Create `marketplace` app** — register in `INSTALLED_APPS`, create `BerthListing`, `BerthListingPhoto`, `BerthEnquiry`, `ExchangeListing`, `ExchangeAgreement` models, initial migrations.

5. **Tenants ViewSets and serializers** — build DRF ViewSets for all tenants models (units, contacts, tenancies, documents, schedule, tasks); wire to `api/v1/tenants/` router.

6. **Rent scheduler (Celery beat task)** — implement the daily invoice generation task. Scheduler must: (a) populate `invoice.tenant` on every generated invoice; (b) call `compute_pro_rata_amount()` for first/last periods and set `is_pro_rata`, `pro_rata_days`, `pro_rata_total_days` on the `RentScheduleEntry`; (c) use the pro-rata `amount` as the line item price when `is_pro_rata=True`. Also implement the rent review `TenancyTask` creation task. Wire up the `auto_create_deposit_invoice` post-save signal for automatic deposit invoice generation on tenancy creation.

7. **Marketplace ViewSets and serializers** — build DRF ViewSets for listing, photo, enquiry, exchange, agreement; wire to `api/v1/marketplace/` router; implement `publish/` and `mark-sold/` action endpoints. The `mark-sold/` action must update `berth.owner` and `berth.vessel`.

8. **Exchange agreement calendar blocking** — on agreement confirmation, create two `Booking` records (one per berth) with `source='exchange'`.

9. **Public portal endpoint** — extend `GET /public/marina/listings/` to serve published `BerthListing` records. The serializer returns `"P.O.A."` in place of `asking_price` when `show_asking_price = False`.

10. **Snag-A-Slip OTA connection** — register `slug='snag_a_slip'` as a known OTA type; add `ota_commission_amount` field to `Booking`; implement commission storage on import. Full AP invoice generation deferred to the accounts payable module.

11. **Frontend: "Commercial" sidebar group and screens** — `CommercialUnitsScreen`, `TenanciesScreen`, `TenancyTasksScreen`, all drawers, all hooks.

12. **Frontend: Marketplace screen** — `MarketplaceScreen`, `ListingDetailDrawer`, `ExchangeList`.

---

## 10. Out of Scope for v1

The following items are explicitly deferred to v2:

- `BoaterProfile`, `BoaterVessel`, `MarinaNetworkMembership`, `MarinaPublicProfile`, `BoaterReview` models
- All `/api/v1/boater/` namespace endpoints
- Marina staff review management (`/api/v1/accounts/reviews/`)
- Network opt-in settings UI (`/settings/network`)
- Reviews panel UI
- `docksbase.com/marinas/<slug>/` public marina profile pages
- `publish_to_network` marketplace flag (field exists, never exposed)
- `ExchangeListing.network_visible` flag (field exists, never exposed)
- Boater self-registration funnel
- GDPR cross-marina data sharing consent flow
