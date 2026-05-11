# DocksBase — Master Implementation Plan

**Date:** 2026-05-08  
**Author:** Senior Software Architect Review  
**Scope:** All 12 ERP tracks — full greenfield build

---

## 1. Executive Summary

DocksBase is a multi-tenant marina ERP built on Django 6.0 + DRF. Every model is scoped to a `Marina` tenant. The billing pipeline is a single canonical path: `ChargeableItem → InvoiceLineItem → Invoice → Payment`, enforced across all 12 tracks without exception.

This plan organises the 12 tracks into six dependency-ordered phases. Tracks within a phase may be built in parallel by separate squads. No phase may begin until the preceding phase's migrations and core services are fully deployed and tested in staging.

**Estimated total build: 14–18 months at 3 squads of 3.**

---

## 2. App Inventory

| Django App | Track(s) | Description |
|---|---|---|
| `accounts` | Core | Marina, Member, User, multi-tenancy |
| `berths` | Track 2 | Berth, Pier, BerthContract, availability engine |
| `bookings` | Track 2 | Booking, GhostSlot, WaitlistEntry |
| `billing` | Track 4 | ChargeableItem, Invoice, InvoiceLineItem, Payment, GL |
| `accounting` | Track 4 | JournalEntry, AccountingIntegration, DeferredRevenueLog |
| `revenue` | Track 1 | YieldRule, YieldApplication, PricingTier, waitlist sniper |
| `loyalty` | Track 3 | LoyaltyMembership, ReferralCode, CouponCode, MemberCredit |
| `boatyard` | Track 5 | WorkOrder, Haul, Technician, InventoryLevel, PurchaseOrder |
| `utilities` | Track 6 | MeterReading, DryStack, ForkliftJob, ForkliftDeviceToken |
| `comms` | Track 7 | Campaign, JourneyEnrollment, OTAChannel, OTABooking |
| `activities` | Track 8 | Course, InstructorBooking, AssetReservation, Housekeeping |
| `charter` | Track 9 | CharterManagementAgreement, RentalBooking, Commission |
| `tenants` | Track 10 | Tenancy, Unit, RentSchedule, ExchangeAgreement, Marketplace |
| `security` | Track 11 | AccessCard, ZoneAccessRule, RFID/ANPR HAL, BiometricEnrolment |
| `sustainability` | Track 12 | SustainabilityLedger, Scope1/2/3Record, WasteLog, ESGReport |

---

## 3. Dependency Graph

```
Phase 0: accounts (Marina, Member, base models)
    ↓
Phase 1: berths + billing/accounting (Track 2 + Track 4)
    ↓              ↓
Phase 2a: revenue  Phase 2b: loyalty  (Track 1 + Track 3)
    ↓
Phase 3: boatyard + utilities + activities  (Track 5 + Track 6 + Track 8)
    ↓
Phase 4: comms + charter + tenants  (Track 7 + Track 9 + Track 10)
    ↓
Phase 5: security + sustainability  (Track 11 + Track 12)
```

**Cross-phase hard dependencies:**
- Track 1 revenue endpoints require Track 4 `DeferredRevenueRecognitionLog` (guard in place; deploy Track 4 first)
- Track 12 ESG intensity metrics require Track 4 `DeferredRevenueRecognitionLog` (same guard pattern)
- Track 11 `SpendAuthorisationRequest` links to Track 4 Invoice / Track 5 PurchaseOrder
- Track 6 meter readings feed Track 12 Scope 2 calculations

---

## 4. Phase-by-Phase Implementation

---

### Phase 0 — Foundation (Weeks 1–4)

**Goal:** Django project skeleton, multi-tenancy, shared infrastructure.

#### 4.0.1 Django Project Setup

```
docksbase/
├── config/
│   ├── settings/
│   │   ├── base.py
│   │   ├── development.py
│   │   ├── staging.py
│   │   └── production.py
│   ├── urls.py
│   └── celery.py
├── accounts/         ← Marina, Member, MemberVessel, User
├── core/             ← BaseModel, TenantQuerySet, shared mixins
└── ...
```

#### 4.0.2 `core` App — Shared Abstractions

```python
class TenantModel(models.Model):
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)

    class Meta:
        abstract = True

class TenantQuerySet(models.QuerySet):
    def for_marina(self, marina):
        return self.filter(marina=marina)
```

Every model in tracks 1–12 inherits `TenantModel`. No exceptions.

#### 4.0.3 Infrastructure

| Component | Choice | Notes |
|---|---|---|
| Database | PostgreSQL 16 | `btree_gist` extension enabled at migration 0001 |
| Cache / broker | Redis 7 | Separate DBs for cache (db=0) and Celery (db=1) |
| Task queue | Celery 5 + Django-Celery-Beat | Named queues: `default`, `financial`, `pdf_generation`, `notifications`, `hardware` |
| Search | Meilisearch | OTA rate mapping, member search |
| File storage | S3-compatible | Boto3; local MinIO in dev |
| Auth | JWT (djangorestframework-simplejwt) | Refresh token rotation |
| Encryption | django-fernet-fields | All credential fields |

#### 4.0.4 Celery Queue Definition

```python
CELERY_TASK_ROUTES = {
    'billing.tasks.*': {'queue': 'financial'},
    'accounting.tasks.*': {'queue': 'financial'},
    'utilities.tasks.generate_esg_report': {'queue': 'pdf_generation'},
    'sustainability.tasks.generate_esg_report': {'queue': 'pdf_generation'},
    'security.tasks.*': {'queue': 'hardware'},
    'comms.tasks.*': {'queue': 'notifications'},
}
```

PDF worker config: `--concurrency 1 --max-tasks-per-child 1 --max-memory-per-child 512000`

#### 4.0.5 accounts App

Models: `Marina`, `Member`, `MemberVessel`, `VesselDocument`, `MarinaUser` (staff).

Key decisions:
- `Marina.features = JSONField(default=dict)` — feature flags per marina (e.g., `anpr_debounce_seconds`, `enable_ota`, `enable_sustainability`)
- `Member.marina = FK(Marina)` — members are per-marina, no cross-marina sharing
- `MemberVessel` is the M2M through-table with `is_primary` and `ownership_percentage`

**Deliverables:** Migrations, DRF serializers, JWT auth endpoints, admin, test suite (unit + integration, real DB).

---

### Phase 1 — Core Berths & Billing (Weeks 5–14)

**Two squads in parallel. Merge point before Phase 2.**

---

#### 4.1.1 Track 2 — Berth Intelligence

**App:** `berths`, `bookings`

##### Key Models

```python
class Berth(TenantModel):
    pier_label = CharField(max_length=50)          # e.g. "A", "B", "North"
    name = CharField(max_length=50)
    berth_type = CharField(choices=BERTH_TYPE_CHOICES)
    length_m = DecimalField(max_digits=6, decimal_places=2)
    beam_m = DecimalField(max_digits=6, decimal_places=2)
    depth_m = DecimalField(max_digits=6, decimal_places=2)
    is_active = BooleanField(default=True)
    map_slot_id = CharField(max_length=50, blank=True)  # link to map editor

class BerthContract(TenantModel):
    berth = FK(Berth)
    member = FK('accounts.Member')
    start_date = DateField()
    end_date = DateField(null=True, blank=True)
    is_active = BooleanField(default=True)

    class Meta:
        constraints = [
            UniqueConstraint(
                fields=['berth', 'is_active'],
                condition=Q(is_active=True),
                name='unique_active_contract_per_berth',
            )
        ]

class Booking(TenantModel):
    berth = FK(Berth)
    member = FK('accounts.Member', null=True, blank=True)
    guest_name = CharField(max_length=255, blank=True)
    guest_email = EmailField(blank=True)
    vessel = FK('accounts.MemberVessel', null=True, blank=True)
    start_date = DateField()
    end_date = DateField()
    status = CharField(choices=BOOKING_STATUS_CHOICES)
    source = CharField(choices=BOOKING_SOURCE_CHOICES)  # direct, ota, portal, staff

    class Meta:
        constraints = [
            ExclusionConstraint(
                name='no_overlapping_bookings',
                expressions=[
                    ('berth_id', RangeOperators.EQUAL),
                    (DateRange('start_date', 'end_date', bounds='[)'), RangeOperators.OVERLAPS),
                ],
                condition=~Q(status='cancelled'),
            )
        ]
```

##### Availability Algorithm

- `get_available_berths(marina, vessel, start, end)` — filters by size, active contracts, booking overlaps, ExclusionConstraint
- `GhostSlot` — transient slots for map editor (never persisted if booking not confirmed)
- Waitlist: `WaitlistEntry` with `priority_score` calculated from tenure + vessel size

##### API Endpoints

```
GET  /api/v1/berths/                         # list berths (filtered by available dates)
GET  /api/v1/berths/{id}/availability/       # berth-specific availability calendar
POST /api/v1/bookings/                       # create booking
PATCH /api/v1/bookings/{id}/                 # modify booking
POST /api/v1/bookings/{id}/cancel/           # cancel
GET  /api/v1/waitlist/                       # waitlist entries for marina
POST /api/v1/waitlist/                       # join waitlist
```

##### Testing
- ExclusionConstraint overlap enforcement (integration test against real DB)
- Availability algorithm boundary cases (same-day checkout/checkin)
- Waitlist sniper: dispatch wrapped in `transaction.on_commit()` (test with `TestCase.captureOnCommitCallbacks()`)

---

#### 4.1.2 Track 4 — Financial Accounting & Billing

**App:** `billing`, `accounting`

##### Billing Pipeline (Single Source of Truth)

```
ChargeableItem (price catalogue)
    ↓  (creates)
InvoiceLineItem  (quantity × unit_price)
    ↓  (aggregated into)
Invoice  (total, status, due_date, tenant FK optional)
    ↓  (settled by)
Payment  (stripe / cash / bank_transfer)
    ↓  (triggers)
JournalEntry  (double-entry GL posting)
```

**Rule:** No track may store prices in JSON fields, model-level amount fields (outside this pipeline), or bypass `ChargeableItem`. All custom charges flow through the above path.

##### Key Models

```python
class ChargeableItem(TenantModel):
    CATEGORIES = [
        ('berth', 'Berth Fee'), ('fuel', 'Fuel'), ('repair', 'Repair'),
        ('equipment', 'Equipment'), ('course', 'Course'), ('loyalty', 'Loyalty Redemption'),
        ('subscription', 'Subscription'), ('penalty', 'Penalty'),
        ('deposit', 'Deposit'), ('rent', 'Rent'),
        ('offset', 'Carbon Offset'), ('commission', 'Commission'),
        ('charter', 'Charter Fee'), ('misc', 'Miscellaneous'),
    ]
    name = CharField(max_length=200)
    category = CharField(choices=CATEGORIES)
    unit_price = DecimalField(max_digits=10, decimal_places=2)
    gl_account = FK('accounting.GLAccount')
    is_discountable = BooleanField(default=True)  # False for offsets, deposits
    is_active = BooleanField(default=True)

class Invoice(TenantModel):
    member = FK('accounts.Member', null=True, blank=True)
    tenant = FK('tenants.TenantContact', null=True, blank=True, on_delete=SET_NULL)
    total = DecimalField(max_digits=12, decimal_places=2)
    status = CharField(choices=['draft','sent','paid','overdue','cancelled','refunded'])
    due_date = DateField()
    paid_at = DateTimeField(null=True, blank=True)

class JournalEntryLine(TenantModel):
    entry = FK('JournalEntry')
    account = FK('GLAccount')
    debit = DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'))
    credit = DecimalField(max_digits=12, decimal_places=2, default=Decimal('0'))

    def clean(self):
        if (self.debit > 0) == (self.credit > 0):
            raise ValidationError(
                "A journal line must have exactly one of debit or credit non-zero."
            )

    class Meta:
        constraints = [
            CheckConstraint(
                check=(Q(debit=0, credit__gt=0) | Q(debit__gt=0, credit=0)),
                name='journal_line_debit_xor_credit',
            )
        ]

class JournalEntry(TenantModel):
    is_posted = BooleanField(default=False)
    posted_at = DateTimeField(null=True, blank=True)
    reference = CharField(max_length=100)

    def save(self, *args, **kwargs):
        if self.pk and self.is_posted:
            raise PermissionError("Cannot modify a posted journal entry.")
        super().save(*args, **kwargs)
```

##### DeferredRevenueRecognitionLog

Critical for Track 1 and Track 12 intensity metrics. Created by an idempotent Celery task:

```python
@shared_task(bind=True, max_retries=3)
def recognise_revenue_for_invoice(self, invoice_id):
    invoice = Invoice.objects.select_for_update().get(pk=invoice_id)
    for line in invoice.lines.all():
        DeferredRevenueRecognitionLog.objects.get_or_create(
            invoice=invoice,
            line=line,
            recognition_period=compute_period(invoice, line),
            defaults={'amount': line.recognised_amount},
        )
```

##### PaymentPlan Processor

```python
def process_overdue_instalments(marina_id):
    with transaction.atomic():
        instalments = PaymentPlanInstalment.objects.select_for_update(skip_locked=True).filter(
            marina_id=marina_id, status='pending', due_date__lte=date.today()
        )
        for instalment in instalments:
            charge_instalment(instalment)
```

##### AccountingIntegrationConfig

```python
from fernet_fields import EncryptedJSONField

class AccountingIntegrationConfig(TenantModel):
    provider = CharField(choices=['xero', 'quickbooks', 'sage'])
    credentials = EncryptedJSONField()  # encrypted at rest
    is_active = BooleanField(default=True)
```

##### API Endpoints

```
POST /api/v1/invoices/                       # create invoice
GET  /api/v1/invoices/{id}/                  # invoice detail
POST /api/v1/invoices/{id}/send/             # email invoice
POST /api/v1/invoices/{id}/record-payment/   # mark paid
GET  /api/v1/gl/accounts/                    # chart of accounts
GET  /api/v1/gl/journal-entries/             # GL ledger
POST /api/v1/gl/journal-entries/             # manual journal
GET  /api/v1/revenue/deferred/               # DeferredRevenue endpoint (requires Track 4 migrations)
```

**Deliverables:** Both squads merge. Full billing + berth integration tested end-to-end. E2E: create booking → auto-invoice → record payment → GL journal posted.

---

### Phase 2 — Revenue Intelligence & Customer Loyalty (Weeks 15–22)

**Two squads in parallel.**

---

#### 4.2.1 Track 1 — Revenue Intelligence

**App:** `revenue`

##### Key Models

```python
class YieldRule(TenantModel):
    name = CharField(max_length=200)
    rule_type = CharField(choices=['occupancy_threshold','seasonal','last_minute','length_of_stay'])
    parameters = JSONField()
    multiplier = DecimalField(max_digits=5, decimal_places=4)
    priority = IntegerField()
    is_active = BooleanField(default=True)

class YieldApplication(TenantModel):
    marina = FK('accounts.Marina', on_delete=CASCADE, related_name='yield_applications')
    booking = FK('bookings.Booking')
    rule = FK(YieldRule)
    base_price = DecimalField(max_digits=10, decimal_places=2)
    applied_price = DecimalField(max_digits=10, decimal_places=2)
    applied_at = DateTimeField(auto_now_add=True)

class BookingTier(TenantModel):
    berth_type = CharField(choices=BERTH_TYPE_CHOICES)
    season = CharField(choices=SEASON_CHOICES)
    base_nightly_rate = DecimalField(max_digits=10, decimal_places=2)
    min_stay_nights = IntegerField(default=1)
```

##### Waitlist Sniper

Triggered on booking cancellation signal:

```python
@receiver(post_save, sender=Booking)
def on_booking_cancelled(sender, instance, **kwargs):
    if instance.status == 'cancelled':
        transaction.on_commit(
            lambda: run_waitlist_sniper.delay(
                marina_id=instance.marina_id,
                berth_id=instance.berth_id,
                freed_start=str(instance.start_date),
                freed_end=str(instance.end_date),
            )
        )
```

##### Deferred Revenue Endpoint

```python
# GET /api/v1/revenue/analytics/deferred-revenue/
# Dependency: Track 4 DeferredRevenueRecognitionLog must be installed.
# Returns empty dataset if Track 4 not yet migrated.
def get_recognized_revenue_for_period(marina, year, month):
    try:
        from accounting.models import DeferredRevenueRecognitionLog
    except ImportError:
        return Decimal('0')
    ...
```

---

#### 4.2.2 Track 3 — Customer Loyalty

**App:** `loyalty`

##### Key Models

```python
class ReferralCode(TenantModel):
    member = FK('accounts.Member')
    code = CharField(max_length=20)   # NOT unique globally — only per marina
    reward_points = IntegerField(default=500)
    uses_remaining = IntegerField(default=10)

    class Meta:
        unique_together = [('marina', 'member'), ('marina', 'code')]

class LoyaltyMembership(TenantModel):
    member = OneToOneField('accounts.Member', on_delete=CASCADE)
    tier = CharField(choices=TIER_CHOICES, default='bronze')
    points_balance = IntegerField(default=0)
    lifetime_points = IntegerField(default=0)

class MemberCreditAccount(TenantModel):
    member = FK('accounts.Member')
    balance = DecimalField(max_digits=10, decimal_places=2, default=Decimal('0'))
```

##### Points Balance Mutation Pattern

All mutations to `points_balance` or `MemberCreditAccount.balance` must use row-level locking:

```python
def earn_points(member, points, reason):
    with transaction.atomic():
        membership = LoyaltyMembership.objects.select_for_update().get(member=member)
        membership.points_balance = F('points_balance') + points
        membership.lifetime_points = F('lifetime_points') + points
        membership.save(update_fields=['points_balance', 'lifetime_points'])
        PointTransaction.objects.create(membership=membership, delta=points, reason=reason)
```

Failure to use `select_for_update()` here risks double-spend on concurrent redemption requests (e.g. two API calls arriving simultaneously on mobile app retry).

##### CouponCode Engine

- `is_discountable=False` items (offset `ChargeableItem`, deposit `ChargeableItem`) are excluded from all discount calculations
- Coupon applies only to `InvoiceLine.chargeable_item.is_discountable=True` lines

---

### Phase 3 — Operations (Weeks 23–34)

**Three squads in parallel (one per track).**

---

#### 4.3.1 Track 5 — Boatyard Advanced

**App:** `boatyard`

##### Key Models

- `WorkOrder` — repair/haul lifecycle with status machine
- `HaulRecord` — vessel haul-out (in/out dates, pressure wash, blocking)
- `InventoryItem` + `InventoryLevel` (per location) + `InventoryTransaction`
- `PurchaseOrder` + `PurchaseOrderLine` — procurement
- `Technician` — staff linked to WorkOrder labour
- `WarrantyClaim` — links to `ChargeableItem` for parts credit

##### Critical Patterns

**Truck stock transfer (inter-location):**
```python
with transaction.atomic():
    source = InventoryLevel.objects.select_for_update().get(item=item, location=from_loc)
    dest = InventoryLevel.objects.select_for_update().get(item=item, location=to_loc)
    if source.quantity < qty:
        raise InsufficientStockError()
    source.quantity = F('quantity') - qty
    dest.quantity = F('quantity') + qty
    source.save(); dest.save()
```

**Warranty GL posting — async:**
```python
@receiver(post_save, sender=WarrantyClaim)
def on_warranty_approved(sender, instance, **kwargs):
    if instance.status == 'approved':
        transaction.on_commit(
            lambda: post_warranty_gl_entry.delay(claim_id=instance.pk)
        )
```

**Redis lock timeout:** Lock timeout for pricing computation must be ≥ 30 seconds (worst-case complex price matrix). Tune upward if profiling shows longer computation.

---

#### 4.3.2 Track 6 — Utilities & Drystack

**App:** `utilities`

##### Key Models

- `MeterPoint` — electric/water meter linked to berth or unit
- `MeterReading` — raw reading (17.5M rows/year at 100-berth marina)
- `DryStackVessel` — boat stored in rack; `DryStackLaunch` — individual launch/retrieve events
- `ForkliftJob` — links DryStackLaunch to driver + forklift
- `ForkliftDeviceToken` — hardware token for dock tablet

```python
class ForkliftDeviceToken(TenantModel):
    device_uid = CharField(max_length=100, unique=True)
    label = CharField(max_length=100)
    is_active = BooleanField(default=True)  # deactivate on device retirement, never delete
    last_used = DateTimeField(null=True)
```

##### MeterReading Scale

At 100 berths × 480 readings/day = 17.5M rows/year. Use PostgreSQL table partitioning by month or TimescaleDB hypertable:

```sql
-- TimescaleDB
SELECT create_hypertable('utilities_meterreading', 'read_at', chunk_time_interval => INTERVAL '1 month');
```

Alternatively, partition by `marina_id` + month with `django-postgres-extra`.

##### Billing Integration

`MeterReading` delta → `ChargeableItem(category='utilities')` → `InvoiceLineItem` via monthly batch task.

##### Track 12 Integration

`MeterReading` feeds `SustainabilityLedger` Scope 2 calculations. The `roll_ledger_for_marina_period()` task must always call `calculate_scope2_electricity_for_period()` using meter data.

---

#### 4.3.3 Track 8 — Activities & Housekeeping

**App:** `activities`

##### Key Models

- `Course` — scheduled activity/class
- `Instructor` + `InstructorAvailability`
- `InstructorBooking` — time block with proper datetime overlap detection
- `CourseEnrollment` — member signup + waitlist
- `Asset` — kayak, paddleboard, classroom (shared resource)
- `AssetReservation` — exclusive time block on an asset
- `HousekeepingTask` — berth/facility cleaning jobs with status machine

##### Instructor Conflict Detection (datetime, not date)

```python
def check_instructor_conflict(instructor, start_datetime, end_datetime, exclude_pk=None):
    qs = InstructorBooking.objects.filter(
        instructor=instructor,
        start_datetime__lt=end_datetime,  # existing starts before new ends
        end_datetime__gt=start_datetime,  # existing ends after new starts
    )
    if exclude_pk:
        qs = qs.exclude(pk=exclude_pk)
    return qs.exists()
```

Date-only comparison (`start_datetime__date=date`) is wrong — it allows double-booking within the same day at non-overlapping times while also false-positiving on same-day sessions that don't actually overlap.

##### Atomic Booking Creation

```python
with transaction.atomic():
    booking = CourseEnrollment.objects.create(...)
    AssetReservation.objects.create(
        asset=asset,
        start_datetime=booking.start_datetime,
        end_datetime=booking.end_datetime,
        enrollment=booking,
    )
    Invoice.objects.create(...)
```

All three operations succeed or all roll back.

---

### Phase 4 — Commercial Expansion (Weeks 35–46)

**Three squads in parallel.**

---

#### 4.4.1 Track 7 — Comms, Marketing & OTA

**App:** `comms`

##### Key Models

```python
class OTAChannel(TenantModel):
    name = CharField(choices=['mysea', 'direct_booking', 'booking_com'])
    api_key = EncryptedCharField(max_length=255)      # encrypted at rest
    api_secret = EncryptedCharField(max_length=255)   # encrypted at rest
    is_active = BooleanField(default=True)

class OTABooking(TenantModel):
    channel = FK(OTAChannel)
    ota_ref = CharField(max_length=200)
    booking = OneToOneField('bookings.Booking', on_delete=CASCADE)

    class Meta:
        constraints = [
            UniqueConstraint(
                fields=['channel', 'ota_ref'],
                name='unique_ota_booking_per_channel',
            )
        ]
        # Webhook retries are idempotent — same ota_ref on same channel = same booking

class JourneyEnrollment(TenantModel):
    member = FK('accounts.Member')
    journey = FK('Journey')
    current_step = IntegerField(default=0)
    status = CharField(choices=['active', 'completed', 'exited'])
```

##### JourneyEnrollment Advance — Concurrent Protection

```python
with transaction.atomic():
    enrolment = JourneyEnrollment.objects.select_for_update().get(pk=pk, status='active')
    if enrolment.current_step != expected_step:
        return  # already advanced by concurrent request
    enrolment.current_step += 1
    enrolment.save()
    dispatch_next_step_action(enrolment)
```

##### Campaign Engine

- `Campaign` → `CampaignSegment` (member filter criteria) → `CampaignMessage` (email/SMS/push)
- Unsubscribe: `CommunicationPreference` per member per channel
- Celery task `send_campaign_batch()` processes segments in chunks of 500

---

#### 4.4.2 Track 9 — Charter & Commercial Harbour

**App:** `charter`

##### Key Models

- `CharterVessel` — vessel available for charter
- `CharterManagementAgreement` — multi-party ownership split with `ownership_percentage`
- `CharterBooking` — guest charter
- `Commission` — calculated from `CharterBooking` revenue × `CharterManagementAgreement.commission_rate`
- `RentalBooking` — day-boat/equipment rental
- `HarbourDues` — commercial vessel dues

##### Commission Signal — on_commit

```python
@receiver(post_save, sender=CharterBooking)
def on_charter_booking_confirmed(sender, instance, **kwargs):
    if instance.status == 'confirmed':
        transaction.on_commit(
            lambda: calculate_commission.delay(charter_id=instance.pk)
        )
```

##### RentalBooking Turnaround Overlap

```python
with transaction.atomic():
    conflicts = RentalBooking.objects.select_for_update().filter(
        vessel=vessel,
        start_date__lt=end_date + timedelta(hours=turnaround_hours),
        end_date__gt=start_date,
        status__in=['confirmed', 'active'],
    )
    if conflicts.exists():
        raise BookingConflictError()
    RentalBooking.objects.create(...)
```

##### OTA Idempotency

```python
class CharterOTABooking(TenantModel):
    channel = FK(OTAChannel)
    channel_ref = CharField(max_length=200)
    charter_booking = FK(CharterBooking)

    class Meta:
        unique_together = [('marina', 'channel', 'channel_ref')]
```

---

#### 4.4.3 Track 10 — Tenants, Marketplace & Network

**App:** `tenants`

##### Key Models

```python
class Unit(TenantModel):
    name = CharField(max_length=100)
    unit_type = CharField(choices=['office','retail','storage','berth'])
    floor_area_m2 = DecimalField(max_digits=7, decimal_places=2)

class Tenancy(TenantModel):
    unit = FK(Unit)
    tenant_contact = FK('TenantContact')
    start_date = DateField()
    end_date = DateField(null=True, blank=True)
    is_active = BooleanField(default=True)
    deposit_chargeable_item = FK('billing.ChargeableItem', related_name='+')
    deposit_invoice = OneToOneField('billing.Invoice', null=True, blank=True, on_delete=SET_NULL)

    @property
    def deposit_held(self):
        return bool(self.deposit_invoice and self.deposit_invoice.status == 'paid')

class RentScheduleEntry(TenantModel):
    tenancy = FK(Tenancy)
    period_start = DateField()
    period_end = DateField()
    base_amount = DecimalField(max_digits=10, decimal_places=2)
    is_pro_rata = BooleanField(default=False)
    pro_rata_days = IntegerField(null=True, blank=True)
    pro_rata_total_days = IntegerField(null=True, blank=True)
    invoice = FK('billing.Invoice', null=True, blank=True, on_delete=SET_NULL)
```

##### Concurrent Active Tenancy Guard

```python
with transaction.atomic():
    existing = Tenancy.objects.select_for_update().filter(
        unit=unit, is_active=True
    )
    if existing.exists():
        raise ValidationError("Unit already has an active tenancy.")
    Tenancy.objects.create(unit=unit, tenant_contact=tenant, ...)
```

##### Rent Scheduler — Idempotent

```python
def run_rent_scheduler_for_period(marina, year, month):
    tenancies = Tenancy.objects.filter(marina=marina, is_active=True)
    for tenancy in tenancies:
        with transaction.atomic():
            period_start = date(year, month, 1)
            period_end = last_day_of_month(year, month)
            entry, created = RentScheduleEntry.objects.get_or_create(
                tenancy=tenancy,
                period_start=period_start,
                defaults={
                    'period_end': period_end,
                    'base_amount': compute_rent(tenancy, period_start, period_end),
                    **compute_pro_rata(tenancy, period_start, period_end),
                }
            )
            if created:
                create_rent_invoice(entry)
```

##### Deposit Auto-Creation Signal

```python
@receiver(post_save, sender=Tenancy)
def auto_create_deposit_invoice(sender, instance, created, **kwargs):
    if created and instance.deposit_chargeable_item_id and not instance.deposit_invoice_id:
        transaction.on_commit(
            lambda: _create_deposit_invoice.delay(tenancy_id=instance.pk)
        )
```

##### ExchangeAgreement

```python
class ExchangeAgreement(TenantModel):
    party_a = FK('accounts.Member')
    party_b = FK('accounts.Member')
    party_a_start = DateField()
    party_a_end = DateField()
    party_b_start = DateField()
    party_b_end = DateField()
    berth_a = FK('berths.Berth')
    berth_b = FK('berths.Berth')
    status = CharField(choices=['pending', 'active', 'completed', 'cancelled'])
```

---

### Phase 5 — Security, Compliance & Intelligence (Weeks 47–56)

**Two squads in parallel.**

---

#### 4.5.1 Track 11 — Security & Access Control

**App:** `security`

##### Hardware Abstraction Layer (HAL)

```python
class AccessControlDriver(ABC):
    @abstractmethod
    def grant_access(self, card_uid: str, zone_id: int) -> bool: ...

    @abstractmethod
    def revoke_access(self, card_uid: str) -> bool: ...

    @abstractmethod
    def read_event_stream(self) -> Iterator[AccessEvent]: ...

class HIDDriver(AccessControlDriver): ...
class PAXTONDriver(AccessControlDriver): ...
class SimulatorDriver(AccessControlDriver): ...  # for CI
```

Vendor is configured per marina: `Marina.features['access_control_driver'] = 'hid'`

##### AccessCard

```python
class AccessCard(TenantModel):
    member = FK('accounts.Member')
    card_uid = CharField(max_length=100)
    is_active = BooleanField(default=True)
    valid_from = DateField()
    valid_to = DateField(null=True, blank=True)
    deactivated_at = DateTimeField(null=True, blank=True)
    deactivated_reason = CharField(max_length=255, blank=True)

    class Meta:
        constraints = [
            UniqueConstraint(
                fields=['marina', 'card_uid'],
                condition=Q(is_active=True),
                name='unique_active_card_uid_per_marina',
            )
        ]
        # Partial constraint: same card_uid can exist multiple times (recycled cards)
        # but only one active record per marina. member FK never changes — full audit trail.
```

Card deactivation → hardware revoke must use `transaction.on_commit()`:

```python
@receiver(post_save, sender=AccessCard)
def on_card_status_change(sender, instance, **kwargs):
    if not instance.is_active:
        transaction.on_commit(
            lambda: revoke_hardware_access.apply_async(
                args=[instance.pk],
                queue='hardware',
            )
        )
```

##### Celery Beat — Expired Card Cleanup

```python
'deactivate-expired-access-cards': {
    'task': 'security.tasks.deactivate_expired_access_cards',
    'schedule': crontab(hour=1, minute=0),
}

# Task:
def deactivate_expired_access_cards():
    expired = AccessCard.objects.filter(is_active=True, valid_to__lt=timezone.now().date())
    for card in expired:
        card.is_active = False
        card.deactivated_at = timezone.now()
        card.deactivated_reason = 'auto_expired'
        card.save()
        # on_commit signal fires revoke_hardware_access
```

##### Zone Access Service

```python
def member_can_access_zone(member, zone, marina):
    rule = ZoneAccessRule.objects.filter(zone=zone, marina=marina).first()
    if not rule:
        return False
    if not zone.requires_berth_assignment:
        return True
    if rule.link_to_berth_pier:
        # Spatial check: member's active berth must be on zone's pier
        active_berths = _get_member_active_berths(member, marina)
        return active_berths.filter(pier_label__in=zone.allowed_piers).exists()
    return _member_has_active_contract_or_booking(member, marina)
```

##### ANPR Debounce

```python
DEBOUNCE_TTL = marina.features.get('anpr_debounce_seconds', 60)
debounce_key = f'anpr:{marina.pk}:{camera_uid}:{plate}'
if cache.get(debounce_key):
    return  # duplicate event — suppress
cache.set(debounce_key, '1', timeout=DEBOUNCE_TTL)
process_anpr_event(plate, camera_uid, marina)
```

##### GDPR Biometric Deletion

```python
class BiometricEnrolment(TenantModel):
    member = FK('accounts.Member')
    template_ref = CharField(max_length=200)
    pending_deletion = BooleanField(default=False)
    pending_deletion_since = DateTimeField(null=True, blank=True)

    objects = BiometricEnrolmentManager()  # excludes pending_deletion=True by default
    all_objects = models.Manager()         # unfiltered (admin, deletion task)

# DELETE endpoint returns 202 Accepted — actual deletion is async
@shared_task(bind=True, max_retries=20)
def revoke_biometric_enrolment(self, enrolment_id):
    enrolment = BiometricEnrolment.all_objects.get(pk=enrolment_id)
    try:
        driver.delete_template(enrolment.template_ref)
        enrolment.delete()
    except HardwareError as exc:
        raise self.retry(exc=exc, countdown=exponential_backoff(self.request.retries))
```

After 24h without successful deletion, `FraudAnomalyAlert(alert_type='biometric_deletion_stalled')` is raised.

##### SpendAuthorisationRequest

```python
class SpendAuthorisationRequest(TenantModel):
    invoice = FK('billing.Invoice', null=True, blank=True)
    purchase_order = FK('boatyard.PurchaseOrder', null=True, blank=True)
    expense_claim = FK('ExpenseClaim', null=True, blank=True)
    status = CharField(choices=['pending','suspended','approved','rejected','overridden'])
    suspended_at = DateTimeField(null=True)
    override_forced_by = FK(settings.AUTH_USER_MODEL, null=True, related_name='+')
    override_forced_at = DateTimeField(null=True)

    class Meta:
        constraints = [
            CheckConstraint(
                check=(
                    Q(invoice__isnull=False) |
                    Q(purchase_order__isnull=False) |
                    Q(expense_claim__isnull=False)
                ),
                name='spend_auth_requires_financial_reference',
            )
        ]
```

---

#### 4.5.2 Track 12 — Sustainability & ESG

**App:** `sustainability`

##### Key Models

```python
class SustainabilityLedger(TenantModel):
    year = IntegerField()
    month = IntegerField()
    scope1_total_kg = DecimalField(max_digits=12, decimal_places=2, default=0)
    scope2_total_kwh = DecimalField(max_digits=12, decimal_places=2, default=0)
    scope3_total_kg = DecimalField(max_digits=12, decimal_places=2, default=0)
    total_emissions_kg = DecimalField(max_digits=12, decimal_places=2, default=0)
    recognized_revenue = DecimalField(max_digits=14, decimal_places=2, default=0)
    emissions_intensity = DecimalField(max_digits=10, decimal_places=6, default=0)
    is_stale = BooleanField(default=False)

    class Meta:
        unique_together = [('marina', 'year', 'month')]
```

##### Revenue Denominator (GAAP-Aligned)

```python
def get_recognized_revenue_for_period(marina, year, month):
    # Uses DeferredRevenueRecognitionLog — requires Track 4 migrations.
    # Falls back gracefully if not installed.
    try:
        from accounting.models import DeferredRevenueRecognitionLog
    except ImportError:
        return _fallback_gross_revenue(marina, year, month)

    deferred_recognized = DeferredRevenueRecognitionLog.objects.filter(
        marina=marina,
        recognition_period__year=year,
        recognition_period__month=month,
    ).aggregate(total=Sum('amount'))['total'] or Decimal('0')

    spot_invoices = Invoice.objects.filter(
        marina=marina,
        paid_at__year=year,
        paid_at__month=month,
        lines__chargeable_item__is_deferred=False,
    ).aggregate(total=Sum('total'))['total'] or Decimal('0')

    return deferred_recognized + spot_invoices
```

##### Staleness Signals + Deduplication

```python
def _flag_ledger_stale_and_queue(marina_id, year, month):
    SustainabilityLedger.objects.filter(
        marina_id=marina_id, year=year, month=month
    ).update(is_stale=True)

    DEDUPE_KEY = f'ledger:recalc:{marina_id}:{year}:{month}'
    if not cache.add(DEDUPE_KEY, '1', timeout=60):
        return  # already queued — skip duplicate dispatch

    transaction.on_commit(
        lambda: recalculate_ledger_period.apply_async(
            args=[marina_id, year, month],
            countdown=30,  # debounce: coalesce rapid writes into single recalc
        )
    )

for Model in [Scope1Record, Scope2Record, Scope3Record, WasteLog]:
    post_save.connect(_stale_handler(Model), sender=Model)
    post_delete.connect(_stale_handler(Model), sender=Model)
```

##### Carbon Offset — Non-Discountable

```python
# offset ChargeableItem must always be created with:
ChargeableItem.objects.create(
    marina=marina,
    category='offset',
    name='Carbon Offset Certificate',
    unit_price=offset_rate,
    is_discountable=False,   # MANDATORY — coupons/loyalty must not apply
)

# on_invoice_paid signal guard:
@receiver(post_save, sender=Payment)
def on_invoice_paid(sender, instance, **kwargs):
    if instance.invoice.status == 'paid':
        for line in instance.invoice.lines.all():
            if line.unit_price <= 0:
                continue  # skip zero/negative lines (discounted items, credits)
            if line.chargeable_item.category == 'offset':
                create_offset_contribution(line)
```

##### PDF Generation (WeasyPrint)

```python
@shared_task(
    bind=True,
    queue='pdf_generation',
    acks_late=True,
    reject_on_worker_lost=True,
)
def generate_esg_report_pdf(self, ledger_id):
    try:
        ledger = SustainabilityLedger.objects.get(pk=ledger_id)
        html = render_to_string('sustainability/esg_report.html', {'ledger': ledger})
        pdf_bytes = weasyprint.HTML(string=html).write_pdf()
        ledger.report_pdf.save(f'esg_{ledger.year}_{ledger.month}.pdf', ContentFile(pdf_bytes))
    except Exception as exc:
        ledger.error_detail = str(exc)
        ledger.save(update_fields=['error_detail'])
        raise

# Worker: celery -A config worker -Q pdf_generation --concurrency 1
#         --max-tasks-per-child 1 --max-memory-per-child 512000
```

---

## 5. Testing Strategy

### 5.1 Principles

- **No mocks for database.** All tests hit a real PostgreSQL instance (via `pytest-django` with a test DB). Mock only external APIs (Stripe, OTA webhooks, hardware drivers).
- **Simulation driver for hardware.** Track 11 uses `SimulatorDriver` in all test environments. `AccessControlDriver` ABC ensures tests pass without physical RFID readers.
- **Integration tests for all financial paths.** Every invoice creation, payment, and GL posting scenario has an integration test that verifies the DB state end-to-end.
- **Idempotency tests.** Every Celery task that creates records must have a test proving double-invocation is a no-op.

### 5.2 Test Matrix

| Layer | Tool | Scope |
|---|---|---|
| Unit | pytest | Pure functions: pricing engine, revenue recognition, pro-rata calculation |
| Integration | pytest-django | DB operations: booking creation, invoice pipeline, GL posting |
| API | DRF APIClient | All endpoints with authentication |
| Concurrent | `threading` + `transaction.atomic` | `select_for_update()` correctness, double-booking prevention |
| E2E | Playwright | Critical paths: booking → invoice → payment; charter check-in; tenant rent cycle |
| Load | Locust | MeterReading ingestion at 17.5M rows/year throughput |

### 5.3 CI Pipeline

```
PR opened →
  1. ruff + black + mypy
  2. pytest (parallel, 4 workers)
  3. Coverage gate: 80% minimum
  4. migrations check: no missing migrations
  5. security scan: bandit + safety

Merge to main →
  6. Integration test suite against staging DB
  7. E2E suite (Playwright)
  8. Deploy to staging
```

---

## 6. Migration Dependency Order

Migrations must be applied in this order (each depends on the previous being fully applied):

```
0001_accounts_marina_member
0002_billing_chargeable_item_invoice_gl
0003_berths_bookings
0004_accounting_journal_deferred_revenue
0005_revenue_yield_rules
0006_loyalty_referral_points
0007_boatyard_workorders_inventory
0008_utilities_meters_drystack
0009_activities_courses_housekeeping
0010_comms_campaign_journey_ota
0011_charter_rental_harbour
0012_tenants_units_marketplace
0013_security_access_cards_zones
0014_sustainability_ledger_esg
```

**Critical:** `0004` (DeferredRevenueRecognitionLog) must precede `0005` and `0014`. Both Track 1 and Track 12 have runtime guards that degrade gracefully if `0004` is absent, but the guard should not be needed in production.

---

## 7. Risk Register

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| MeterReading table growth (17.5M rows/year) | High | High | TimescaleDB hypertable or monthly partitions from day 1; cannot retrofit easily |
| OTA webhook idempotency failure → duplicate bookings | High | High | `unique_together` on `OTABooking(channel, ota_ref)` + `get_or_create` in handler |
| WeasyPrint OOM crash → lost PDF task | Medium | Medium | Dedicated queue, `acks_late=True`, `max-tasks-per-child=1` |
| GDPR biometric deletion stall → regulatory breach | Medium | Critical | 20-retry Celery task + 24h stall alert + manual override documented |
| Double-booking race condition under load | Medium | High | `ExclusionConstraint` at DB level (cannot be bypassed by application bugs) |
| Accounting credential exposure | Low | Critical | `EncryptedJSONField` enforced at model level; secret rotation documented |
| DeferredRevenueRecognitionLog missing → wrong ESG intensity | Low | Medium | Runtime guard with graceful fallback; enforced by migration order |
| `JournalEntry` mutation after posting | Low | Critical | `save()` guard + DB-level audit trigger recommended for production |
| Card recycling audit gap | Low | Medium | Partial `UniqueConstraint` preserves all historical rows; member FK immutable |
| Commission double-posting on retry | Low | High | `get_or_create` pattern in commission task |

---

## 8. Delivery Milestones

| Milestone | Target Week | Criteria |
|---|---|---|
| M0: Foundation | W4 | Django project, accounts, CI green, staging deployed |
| M1: Core Berths + Billing | W14 | Booking → Invoice → Payment E2E working |
| M2: Revenue + Loyalty | W22 | Yield pricing live, referral codes functional |
| M3: Operations | W34 | Boatyard, Forklift, Activities all functional |
| M4: Commercial | W46 | OTA channel live (MySea), Tenants billing cycle running |
| M5: Security + ESG | W56 | RFID access control live, first ESG report generated |
| M6: Load Test + Harden | W60 | MeterReading ingestion load test passed, security penetration test passed |

---

## 9. Open Architecture Decisions

These require stakeholder input before implementation:

1. **TimescaleDB vs native PostgreSQL partitioning** for `MeterReading` — TimescaleDB has better tooling but adds an infrastructure dependency.
2. **Deferred revenue recognition schedule** — straight-line over contract period or milestone-based? This affects `DeferredRevenueRecognitionLog` schema.
3. **Multi-marina member sharing** — can a Member exist across marinas, or is each marina fully isolated? Current design is fully isolated; changing later is a large migration.
4. **WeasyPrint vs headless Chrome** for PDF generation — WeasyPrint is lightweight but has CSS limitations; Chrome (via Playwright) renders perfectly but uses more memory.
5. **RFID vendor** — which HAL driver to implement first? Drives Track 11 testing strategy.
