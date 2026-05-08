# Track 8 — Activities & Housekeeping: Design Spec
Date: 2026-05-07
Scope: Two new Django apps (`activities`, `housekeeping`) covering the full lifecycle of bookable marina activities (catalogue, scheduling, resource assignment, billing, cancellation) and housekeeping operations (task generation from checkout events, matrix dashboard, mobile checklist app, linen/consumable inventory).

> Spec status: Final — reviewed 2026-05-08

---

## 1. Architectural Goal

Introduce two independent Django apps that plug cleanly into the existing multi-tenant architecture. Both apps follow the same patterns as the rest of the platform: every model carries a `marina` FK, all pricing flows through `ChargeableItem → InvoiceLineItem`, and physical equipment is referenced from `maintenance.Asset`. Neither app has a hard dependency on Track 9 (charter) at build time — the charter-checkout trigger is wired as a conditional, feature-flagged side effect that activates after both tracks merge.

Key invariants:
- All money lives in `billing.ChargeableItem` and `billing.InvoiceLineItem`. The `activities` app never stores a raw price directly on a booking — it resolves to a `ChargeableItem` and writes an `InvoiceLineItem`.
- Equipment reservations use `maintenance.Asset` as the source of truth for physical items. The `activities` app adds a thin reservation layer on top.
- Instructor availability is resolved from `staff.Shift` — no separate rota model is introduced. A hard conflict block prevents the same instructor from being assigned to two simultaneous activities (see Section 5).
- Housekeeping defect escalation creates `maintenance.Defect` records (existing model), keeping the single defect workflow for the whole marina.
- Activity bookings are managed exclusively by marina staff (v1). The public boater portal is out of scope for Track 8; the availability endpoint is authenticated-only. A public-facing self-service booking flow is deferred to v2.
- Housekeeping consumable stock is maintained in a dedicated pool separate from Boatyard Parts & Inventory — the two apps remain strictly decoupled.
- Linen inventory is tracked at the marina level (single pool per linen set type), not per vessel.

---

## 2. New Django Apps

### 2a. `activities` app

Location: `backend/apps/activities/`

Register in `INSTALLED_APPS` as `'apps.activities'`. Add to `urls.py` under the `/api/v1/activities/` prefix.

Models: `Activity`, `ActivityPricingRule`, `ActivityResourceRequirement`, `ActivityExtra`, `ActivityBooking`, `ActivityBookingParticipant`, `ActivityBookingExtra`, `CancellationPolicy`, `AssetReservation`.

### 2b. `housekeeping` app

Location: `backend/apps/housekeeping/`

Register in `INSTALLED_APPS` as `'apps.housekeeping'`. Add to `urls.py` under the `/api/v1/housekeeping/` prefix.

Models: `HousekeepingTask`, `ChecklistItem`, `TaskChecklistCompletion`, `TaskPhoto`, `LinenSet`, `LinenInventory`, `ConsumableStock`, `ConsumableUsage`.

---

## 3. Data Models — Activities

### 3a. `Activity`

The master catalogue record for a bookable activity. One `Activity` can have many `ActivityBooking` instances.

Group discounts are configured directly on the `Activity` model via `group_discount_threshold` and `group_discount_pct`. When a booking's participant count meets or exceeds the threshold, the billing bridge creates a negative `InvoiceLineItem` for the discount amount — no separate customer type is used for groups.

Bookings outside an activity's `season_start / season_end` window are blocked by default but can be overridden by staff. The override is recorded on `ActivityBooking.season_override` (see Section 3f). This is a soft warning with a required staff confirmation, not a hard API rejection.

```python
class Activity(models.Model):
    class Category(models.TextChoices):
        WATER_SPORT  = 'water_sport',  'Water Sport'
        LESSON       = 'lesson',       'Lesson / Course'
        EQUIPMENT    = 'equipment',    'Equipment Hire'
        GUIDED_TRIP  = 'guided_trip',  'Guided Trip'
        WELLNESS     = 'wellness',     'Wellness'
        OTHER        = 'other',        'Other'

    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='activities')
    name             = models.CharField(max_length=200)
    description      = models.TextField(blank=True)
    category         = models.CharField(max_length=30, choices=Category.choices, default=Category.OTHER)
    duration_minutes = models.PositiveIntegerField()            # e.g. 90
    capacity_min     = models.PositiveIntegerField(default=1)   # minimum participants to run
    capacity_max     = models.PositiveIntegerField()            # maximum participants per session
    min_age          = models.PositiveIntegerField(default=0)   # 0 = no restriction
    photo            = models.ImageField(upload_to='activities/photos/', null=True, blank=True)
    is_active        = models.BooleanField(default=True)

    # Seasonal availability window — null means year-round
    season_start     = models.DateField(null=True, blank=True)
    season_end       = models.DateField(null=True, blank=True)

    # Group discount — applied as a negative InvoiceLineItem when participant_count >= threshold
    group_discount_threshold = models.PositiveIntegerField(null=True, blank=True)  # e.g. 5
    group_discount_pct       = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True
    )  # e.g. 10.00 → 10% off the total

    # Cancellation policy (FK — see CancellationPolicy)
    cancellation_policy = models.ForeignKey(
        'CancellationPolicy', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='activities'
    )

    created_at = models.DateTimeField(auto_now_add=True)
```

### 3b. `ActivityPricingRule`

Stores price-per-person broken down by customer type. Each rule points to a `ChargeableItem` (category `service`, pricing_model `flat_fee`) which carries the canonical unit price. This is how the activity billing flows through the existing billing engine.

Customer types are `member`, `guest`, and `child`. Group discounts are handled separately on `Activity` (see above) — there is no `group` customer type.

```python
class ActivityPricingRule(models.Model):
    class CustomerType(models.TextChoices):
        MEMBER  = 'member',  'Member'
        GUEST   = 'guest',   'Guest'
        CHILD   = 'child',   'Child'

    activity        = models.ForeignKey(Activity, on_delete=models.CASCADE, related_name='pricing_rules')
    customer_type   = models.CharField(max_length=20, choices=CustomerType.choices)
    chargeable_item = models.ForeignKey(
        'billing.ChargeableItem', on_delete=models.PROTECT, related_name='activity_pricing_rules'
    )
    # The unit price on chargeable_item IS the price per person for this type.
    # No raw price field here — ChargeableItem is the source of truth.

    class Meta:
        unique_together = [('activity', 'customer_type')]
```

### 3c. `ActivityResourceRequirement`

Specifies which staff roles (instructors) and which assets (equipment) are required for an activity to run. Booking confirmation is blocked if any required resource is unavailable.

Instructor availability is enforced as a hard block: the availability service performs a `NOT EXISTS` check against `ActivityBooking` for the specific `StaffMember` during the requested datetime window. An instructor cannot be assigned to two simultaneous activities under any circumstance.

```python
class ActivityResourceRequirement(models.Model):
    class ResourceType(models.TextChoices):
        INSTRUCTOR = 'instructor', 'Instructor (Staff)'
        ASSET      = 'asset',      'Equipment Asset'

    activity      = models.ForeignKey(Activity, on_delete=models.CASCADE, related_name='resource_requirements')
    resource_type = models.CharField(max_length=20, choices=ResourceType.choices)

    # For instructor requirements: match by StaffMember.role (free-text) or specific staff
    required_role    = models.CharField(max_length=100, blank=True)  # e.g. "Kayak Instructor"
    staff_member     = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='activity_requirements'
    )  # null = any staff with required_role; populated = specific person required

    # For asset requirements
    asset            = models.ForeignKey(
        'maintenance.Asset', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='activity_requirements'
    )
    quantity_required = models.PositiveIntegerField(default=1)
```

### 3d. `ActivityExtra`

Add-on items attachable to a booking (wetsuit hire, refreshment pack, etc.). Each extra is also backed by a `ChargeableItem`.

```python
class ActivityExtra(models.Model):
    activity        = models.ForeignKey(Activity, on_delete=models.CASCADE, related_name='extras')
    name            = models.CharField(max_length=200)
    chargeable_item = models.ForeignKey(
        'billing.ChargeableItem', on_delete=models.PROTECT, related_name='activity_extras'
    )
    is_active       = models.BooleanField(default=True)
```

### 3e. `CancellationPolicy`

Reusable cancellation policy definitions. One policy can be shared across many activities.

```python
class CancellationPolicy(models.Model):
    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='cancellation_policies')
    name         = models.CharField(max_length=200)   # e.g. "Standard 48h Policy"

    # Tier 1: full refund if cancelled more than `full_refund_hours` before start
    full_refund_hours    = models.PositiveIntegerField(default=48)

    # Tier 2: partial refund (percentage) if cancelled between `partial_refund_hours` and full_refund_hours
    partial_refund_hours = models.PositiveIntegerField(default=24)
    partial_refund_pct   = models.DecimalField(max_digits=5, decimal_places=2, default=50)

    # Tier 3: no refund if cancelled within `partial_refund_hours` of start
    # (implied — no extra field needed)

    is_default = models.BooleanField(default=False)  # marina-level default applied to new activities
```

### 3f. `ActivityBooking`

One booking record per session (a group booking is a single `ActivityBooking` with multiple participants).

Bookings are created by marina staff only (v1). The `payment_mode` of `berth_invoice` adds charges to the member's berth invoice; `direct` creates a standalone draft `Invoice`. Booking confirmation emails are sent via the Track 7 Communications Engine using the `ACTIVITY_BOOKED` journey trigger — no bespoke SMTP logic lives in this app.

When `participant_count` meets or exceeds `Activity.group_discount_threshold`, the billing bridge creates an additional negative `InvoiceLineItem` for the group discount.

```python
class ActivityBooking(models.Model):
    class Status(models.TextChoices):
        CONFIRMED  = 'confirmed',  'Confirmed'
        CANCELLED  = 'cancelled',  'Cancelled'
        COMPLETED  = 'completed',  'Completed'
        NO_SHOW    = 'no_show',    'No Show'

    class PaymentMode(models.TextChoices):
        BERTH_INVOICE = 'berth_invoice', 'Add to Berth Invoice'
        DIRECT        = 'direct',        'Direct Payment'

    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='activity_bookings')
    activity         = models.ForeignKey(Activity, on_delete=models.PROTECT, related_name='bookings')
    member           = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True)
    lead_name        = models.CharField(max_length=200, blank=True)   # for non-member / walk-in
    lead_email       = models.EmailField(blank=True)
    lead_phone       = models.CharField(max_length=30, blank=True)

    start_datetime   = models.DateTimeField()
    end_datetime     = models.DateTimeField()   # computed: start + activity.duration_minutes

    participant_count = models.PositiveIntegerField(default=1)
    status           = models.CharField(max_length=20, choices=Status.choices, default=Status.CONFIRMED)
    payment_mode     = models.CharField(max_length=20, choices=PaymentMode.choices, default=PaymentMode.DIRECT)

    # Season override — staff can force a booking outside the activity's season window
    season_override  = models.BooleanField(default=False)

    # Assigned instructor (resolved from Shift availability at booking time; hard-blocked if double-booked)
    assigned_instructor = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='activity_bookings'
    )

    # Billing link — populated once charge is raised
    invoice          = models.ForeignKey(
        'billing.Invoice', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='activity_bookings'
    )

    # Cancellation
    cancelled_at     = models.DateTimeField(null=True, blank=True)
    cancellation_reason = models.TextField(blank=True)
    refund_amount    = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    # TTL for walk-up / POS direct payment bookings.
    # In walk-up scenarios, staff start a booking (locking AssetReservation rows),
    # the customer walks away, and the tab is closed — leaving an orphaned draft invoice
    # and a permanently locked asset. expires_at prevents this: the sweep task
    # (sweep_expired_direct_bookings) cancels and releases reservations after expiry.
    # Set to now() + 15 minutes for payment_mode='direct'; null for berth_invoice mode.
    expires_at       = models.DateTimeField(null=True, blank=True,
                                            help_text='TTL for direct-payment bookings. Null for berth_invoice. '
                                                      'Sweep task cancels draft invoices + releases AssetReservations '
                                                      'when expires_at < now() and invoice.status = draft.')

    notes            = models.TextField(blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['start_datetime']
```

### 3g. `ActivityBookingParticipant`

Individual participant detail rows within a group booking. Primarily used for age verification (min_age rule) and customer-type price differentiation.

```python
class ActivityBookingParticipant(models.Model):
    class CustomerType(models.TextChoices):
        MEMBER = 'member', 'Member'
        GUEST  = 'guest',  'Guest'
        CHILD  = 'child',  'Child'

    booking       = models.ForeignKey(ActivityBooking, on_delete=models.CASCADE, related_name='participants')
    name          = models.CharField(max_length=200, blank=True)
    age           = models.PositiveIntegerField(null=True, blank=True)
    customer_type = models.CharField(max_length=20, choices=CustomerType.choices, default=CustomerType.GUEST)
```

### 3h. `ActivityBookingExtra`

Extras selected for a booking.

```python
class ActivityBookingExtra(models.Model):
    booking  = models.ForeignKey(ActivityBooking, on_delete=models.CASCADE, related_name='booking_extras')
    extra    = models.ForeignKey(ActivityExtra, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField(default=1)
```

### 3i. `AssetReservation`

Lightweight reservation lock on a `maintenance.Asset` for the duration of an activity booking. Prevents double-booking of physical equipment.

**Why a standard index cannot prevent double-booking:** A B-Tree index or `unique_together` constraint operates on exact field values. If Reservation A covers 10:00–12:00 and Reservation B covers 11:00–13:00, they have entirely different `(start_datetime, end_datetime)` tuples — the database will happily store both, double-booking the asset. To enforce mutual exclusion over time ranges, PostgreSQL's `ExclusionConstraint` with the `&&` (overlap) operator is required.

```python
from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import DateTimeRangeField, RangeOperators

class AssetReservation(models.Model):
    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    asset            = models.ForeignKey('maintenance.Asset', on_delete=models.CASCADE, related_name='reservations')
    activity_booking = models.ForeignKey(ActivityBooking, on_delete=models.CASCADE, related_name='asset_reservations')

    # DateTimeRangeField stores [start, end) as a native PostgreSQL tstzrange.
    # Required for ExclusionConstraint — separate start/end DateTimeFields cannot
    # participate in an overlap operator constraint.
    time_range       = DateTimeRangeField(
        help_text='Reservation window [start, end). Derived from ActivityBooking.start_datetime + duration.'
    )

    class Meta:
        constraints = [
            ExclusionConstraint(
                name='prevent_asset_double_booking',
                expressions=[
                    ('asset', RangeOperators.EQUAL),
                    ('time_range', RangeOperators.OVERLAPS),
                ],
                # Exclude cancelled bookings from the constraint via a WHERE clause
                # so that releasing a cancelled reservation does not block re-booking.
                # (ExclusionConstraint supports condition= kwarg in Django 4.2+)
            )
        ]
        indexes = [
            models.Index(fields=['asset']),
        ]
```

The `time_range` field replaces the separate `start_datetime` / `end_datetime` approach. All queries that previously filtered on `start_datetime` / `end_datetime` must use `time_range__overlap=DateTimeTZRange(start, end)` instead. The migration for this model must include `CREATE EXTENSION IF NOT EXISTS btree_gist;` via `RunSQL` before the `ExclusionConstraint` is created — PostgreSQL requires the `btree_gist` extension for GIST indexes on non-geometric types.

---

## 4. Data Models — Housekeeping

### 4a. `HousekeepingTask`

One task per unit/vessel clean. The source of the task is recorded so the origin is always traceable.

```python
class HousekeepingTask(models.Model):
    class SourceType(models.TextChoices):
        CHARTER_CHECKOUT       = 'charter_checkout',       'Charter Checkout'
        ACCOMMODATION_CHECKOUT = 'accommodation_checkout', 'Accommodation Checkout'
        MID_STAY_RECURRING     = 'mid_stay_recurring',     'Mid-Stay Recurring'
        ON_DEMAND              = 'on_demand',              'On-Demand (Guest Request)'
        MANUAL                 = 'manual',                 'Manual (Staff Created)'

    class UnitType(models.TextChoices):
        VESSEL        = 'vessel',        'Charter Vessel'
        ACCOMMODATION = 'accommodation', 'Accommodation Unit'
        FACILITY      = 'facility',      'Facility / Common Area'

    class Status(models.TextChoices):
        DIRTY              = 'dirty',              'Dirty'
        IN_PROGRESS        = 'in_progress',        'In Progress'
        READY_INSPECTION   = 'ready_inspection',   'Ready for Inspection'
        CLEAN              = 'clean',              'Inspected & Clean'
        READY_GUEST        = 'ready_guest',        'Ready for Guest'

    class Priority(models.TextChoices):
        NORMAL = 'normal', 'Normal'
        HIGH   = 'high',   'High'
        URGENT = 'urgent', 'Urgent'

    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='housekeeping_tasks')
    source_type  = models.CharField(max_length=30, choices=SourceType.choices)
    source_id    = models.CharField(max_length=255, blank=True)   # FK ID of the triggering booking/request

    unit_type    = models.CharField(max_length=20, choices=UnitType.choices)
    unit_id      = models.CharField(max_length=255)               # Vessel PK or accommodation unit identifier
    unit_label   = models.CharField(max_length=200)               # Denormalised display name (vessel name / unit name)

    status       = models.CharField(max_length=25, choices=Status.choices, default=Status.DIRTY)
    priority     = models.CharField(max_length=10, choices=Priority.choices, default=Priority.NORMAL)

    triggered_at     = models.DateTimeField(auto_now_add=True)
    target_ready_by  = models.DateTimeField(null=True, blank=True)   # next check-in datetime
    started_at       = models.DateTimeField(null=True, blank=True)
    completed_at     = models.DateTimeField(null=True, blank=True)

    assigned_to  = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='housekeeping_tasks'
    )
    supervisor   = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='supervised_housekeeping_tasks'
    )

    notes        = models.TextField(blank=True)

    # Mid-stay recurring config (null for one-off tasks)
    recurrence_interval_days = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ['target_ready_by', '-priority']
```

### 4b. `ChecklistItem`

Template checklist items associated with an activity type or unit type. Reusable across tasks.

```python
class ChecklistItem(models.Model):
    marina     = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='checklist_items')
    unit_type  = models.CharField(max_length=20, choices=HousekeepingTask.UnitType.choices)
    order      = models.PositiveIntegerField(default=0)
    text       = models.CharField(max_length=500)
    is_active  = models.BooleanField(default=True)

    class Meta:
        ordering = ['unit_type', 'order']
```

### 4c. `TaskChecklistCompletion`

Per-task checklist completion state. Rows are created (pre-populated from `ChecklistItem` templates) when a task is assigned.

```python
class TaskChecklistCompletion(models.Model):
    task          = models.ForeignKey(HousekeepingTask, on_delete=models.CASCADE, related_name='checklist')
    checklist_item = models.ForeignKey(ChecklistItem, on_delete=models.PROTECT, related_name='completions')
    is_done       = models.BooleanField(default=False)
    completed_at  = models.DateTimeField(null=True, blank=True)
    note          = models.CharField(max_length=500, blank=True)
```

### 4d. `TaskPhoto`

Before/after photos attached to a task by the housekeeper.

```python
class TaskPhoto(models.Model):
    class PhotoType(models.TextChoices):
        BEFORE = 'before', 'Before'
        AFTER  = 'after',  'After'
        DEFECT = 'defect', 'Defect'

    task       = models.ForeignKey(HousekeepingTask, on_delete=models.CASCADE, related_name='photos')
    photo_type = models.CharField(max_length=10, choices=PhotoType.choices)
    image      = models.ImageField(upload_to='housekeeping/photos/%Y/%m/')
    caption    = models.CharField(max_length=300, blank=True)
    taken_at   = models.DateTimeField(auto_now_add=True)
    taken_by   = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL,
        null=True, blank=True
    )
```

### 4e. `LinenSet`

Definition of a linen set type (e.g. "Single Berth Set", "Double Cabin Set").

```python
class LinenSet(models.Model):
    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='linen_sets')
    name         = models.CharField(max_length=200)
    description  = models.TextField(blank=True)
    is_active    = models.BooleanField(default=True)
```

### 4f. `LinenInventory`

Marina-level clean/dirty stock counts per linen set type. Linen is tracked as a single marina-level pool — there is no per-vessel allocation. Updated when tasks are completed and when laundry is returned. When `qty_dirty >= laundry_threshold`, a laundry task is generated automatically.

**Race condition risk — concurrent housekeeper task completions:** On a busy checkout morning, multiple housekeepers may mark tasks as complete simultaneously on their mobile devices, all incrementing `qty_dirty` at the same instant. A naïve `inventory.qty_dirty += 1; inventory.save()` pattern causes lost updates (read-modify-write collisions), and multiple concurrent requests that all read `qty_dirty = 9` before any write completes will each evaluate `9 >= 10` as False, missing the threshold, or all evaluate `10 >= 10` as True and each independently create a duplicate "Send to Laundry" task.

**Required implementation pattern** — all `qty_dirty` increments must use a database-level `F()` expression, and the threshold check + task creation must be wrapped in `transaction.atomic()` with an existence guard:

```python
from django.db.models import F
from django.db import transaction

def mark_linen_dirty(inventory_id: int, qty: int = 1):
    with transaction.atomic():
        # Atomic increment — no lost updates under concurrency
        LinenInventory.objects.filter(pk=inventory_id).update(
            qty_dirty=F('qty_dirty') + qty,
            qty_clean=F('qty_clean') - qty,
        )
        # Re-fetch inside the transaction to get the committed value after the update
        inventory = LinenInventory.objects.select_for_update().get(pk=inventory_id)
        if inventory.qty_dirty >= inventory.laundry_threshold:
            # Existence guard: only create a new laundry task if none is already open
            already_open = HousekeepingTask.objects.filter(
                marina=inventory.marina,
                source_type='laundry',
                unit_id=str(inventory.linen_set_id),
                status__in=['dirty', 'in_progress', 'ready_inspection'],
            ).exists()
            if not already_open:
                HousekeepingTask.objects.create(
                    marina=inventory.marina,
                    source_type='laundry',
                    unit_type='facility',
                    unit_id=str(inventory.linen_set_id),
                    unit_label=f'Laundry: {inventory.linen_set.name}',
                    priority='high',
                )
```

```python
class LinenInventory(models.Model):
    marina     = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='linen_inventory')
    linen_set  = models.ForeignKey(LinenSet, on_delete=models.CASCADE, related_name='inventory')
    qty_clean  = models.PositiveIntegerField(default=0)
    qty_dirty  = models.PositiveIntegerField(default=0)
    qty_total  = models.PositiveIntegerField(default=0)
    laundry_threshold = models.PositiveIntegerField(default=10)  # trigger laundry task when dirty >= this
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('marina', 'linen_set')]
```

### 4g. `ConsumableStock`

Marina-level stock of housekeeping consumable items (soap, welcome packs, etc.). This is a dedicated pool entirely separate from Boatyard Parts & Inventory — the two apps do not share stock records.

```python
class ConsumableStock(models.Model):
    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='consumable_stock')
    name            = models.CharField(max_length=200)
    unit            = models.CharField(max_length=50, blank=True)  # e.g. "units", "ml"
    qty_on_hand     = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    low_stock_alert = models.DecimalField(max_digits=10, decimal_places=2, default=5)
    is_active       = models.BooleanField(default=True)
```

### 4h. `ConsumableUsage`

Records depletion of consumables per task.

```python
class ConsumableUsage(models.Model):
    task       = models.ForeignKey(HousekeepingTask, on_delete=models.CASCADE, related_name='consumable_usage')
    consumable = models.ForeignKey(ConsumableStock, on_delete=models.PROTECT, related_name='usage')
    qty_used   = models.DecimalField(max_digits=10, decimal_places=2)
    recorded_at = models.DateTimeField(auto_now_add=True)
```

---

## 5. API Contract

All endpoints are scoped to `marina` via the authenticated user's marina context (same pattern as all existing ViewSets). All endpoints require authentication — no public or unauthenticated access is provided in v1.

### Activities

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/activities/catalogue/` | List activities (`?is_active=true`, `?category=`) |
| POST | `/api/v1/activities/catalogue/` | Create activity |
| GET/PATCH | `/api/v1/activities/catalogue/{id}/` | Retrieve / update activity |
| GET | `/api/v1/activities/catalogue/{id}/availability/` | Query available slots for a date range (authenticated) |
| GET | `/api/v1/activities/bookings/` | List bookings (`?date=`, `?activity=`, `?status=`) |
| POST | `/api/v1/activities/bookings/` | Create booking (triggers availability + resource check) |
| GET/PATCH | `/api/v1/activities/bookings/{id}/` | Retrieve / update booking |
| POST | `/api/v1/activities/bookings/{id}/cancel/` | Cancel booking (applies cancellation policy, computes refund) |
| GET | `/api/v1/activities/cancellation-policies/` | List policies |
| POST | `/api/v1/activities/cancellation-policies/` | Create policy |

**Availability endpoint response (GET `.../catalogue/{id}/availability/`):**

Query params: `?from=YYYY-MM-DD&to=YYYY-MM-DD`

```json
{
  "activity_id": 7,
  "slots": [
    {
      "start": "2026-07-15T10:00:00Z",
      "end": "2026-07-15T11:30:00Z",
      "capacity_remaining": 4,
      "instructor_available": true,
      "equipment_available": true,
      "bookable": true
    }
  ]
}
```

`bookable` is `true` only when both `instructor_available` and `equipment_available` are `true` and `capacity_remaining > 0`.

**Create booking — key validation logic (backend `perform_create`):**
1. Check `activity.season_start / season_end` window. If the requested date falls outside the season window and `season_override` is not `true` in the request payload, return `400` with a structured warning payload (not `409`) so the frontend can display a confirmation prompt. When the staff confirms, re-submit with `"season_override": true`.
2. Check `participant_count` within `capacity_min` and `capacity_max`.
3. Check all `ActivityResourceRequirement` records:
   - For instructor requirements: query `staff.Shift` for availability AND perform a `NOT EXISTS` check against `ActivityBooking.assigned_instructor` during the requested datetime window. If the instructor is already assigned to another booking in that window, the slot is unavailable — this is a hard block, not a warning.
   - For equipment requirements: query `AssetReservation` for conflicts.
4. If all checks pass: wrap the following three operations in a single `transaction.atomic()` block — creating the `ActivityBooking`, reserving the asset, and creating the invoice must all succeed or all roll back. A booking without an asset reservation or without an invoice is an inconsistent state.
   Inside `transaction.atomic()`:
   - Create `ActivityBooking`.
   - Create `AssetReservation` rows (using `time_range=DateTimeTZRange(start, end)` for the exclusion constraint).
   - If `payment_mode == 'direct'`: create a draft `Invoice` + `InvoiceLineItem` records (one per participant customer-type group, resolved from `ActivityPricingRule.chargeable_item`). If `participant_count >= activity.group_discount_threshold`, create an additional negative `InvoiceLineItem` for the group discount amount. Set `ActivityBooking.expires_at = now() + timedelta(minutes=15)`.
   - If `payment_mode == 'berth_invoice'`: set `expires_at = None` — berth invoices are never orphaned in a draft state.
5. After successful booking creation, fire the `ACTIVITY_BOOKED` journey trigger via the Track 7 Communications Engine to dispatch the confirmation email. This is a non-blocking call — booking creation must not fail if the email dispatch fails.
6. Return `409 Conflict` with a structured error if any resource check fails.

**Reactive group discount — participant count signals:**

Invoice generation at booking creation is not a one-time event. If a group books 6 participants (threshold 5, €50 discount applied) and then 2 drop out, the `participant_count` falls to 4 — below the threshold — but the discount `InvoiceLineItem` remains, creating a silent revenue leak.

`ActivityBookingParticipant` `post_save` and `post_delete` signals must trigger a full invoice line item recalculation for the parent booking:

```python
@receiver(post_save, sender=ActivityBookingParticipant)
@receiver(post_delete, sender=ActivityBookingParticipant)
def on_participant_count_changed(sender, instance, **kwargs):
    """
    Wipe and fully re-calculate InvoiceLineItem rows for this booking whenever
    the participant list changes. This ensures group discount eligibility is
    re-evaluated dynamically rather than being locked in at creation time.
    """
    from apps.activities.services.billing import recalculate_activity_invoice
    booking = instance.booking
    if booking.status == 'confirmed' and booking.invoice_id:
        recalculate_activity_invoice(booking)
```

`recalculate_activity_invoice(booking)` in `activities/services/billing.py`:
1. Delete all existing `InvoiceLineItem` records linked to this booking's `Invoice`.
2. Re-query `booking.participants.all()` to get current active participant rows.
3. Re-group by `customer_type`, resolve each `ActivityPricingRule.chargeable_item`, and create fresh `InvoiceLineItem` rows.
4. If `booking.participants.count() >= activity.group_discount_threshold`: create the negative discount `InvoiceLineItem`. Otherwise: do not create it (or delete an existing one).
5. This function must run inside `transaction.atomic()` — partial recalculation must never be committed.

Note: if the invoice has already transitioned to `status='sent'` or `status='paid'`, the recalculation must be blocked and an in-app alert fired to the staff member: "Participant count changed after invoice was issued — manual review required." Immutable invoices must not be mutated (per the Track 4 invoice immutability rule).

**Instructor call-in-sick signal — reverse shift validation:**

Booking-time availability checks only guard the moment of creation. If an instructor calls in sick the day before an activity, a manager will delete or reassign their `staff.Shift` record in the HR module. Without a reverse-validation hook, the `ActivityBooking.assigned_instructor` remains set to the absent instructor — the group arrives and there is no teacher.

A `post_delete` and `post_save` signal must be attached to `staff.Shift` in `activities/signals.py`:

```python
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver

@receiver(post_delete, sender='staff.Shift')
@receiver(post_save, sender='staff.Shift')
def on_shift_modified(sender, instance, **kwargs):
    """
    When a Shift is deleted or its times change, find every ActivityBooking whose
    assigned_instructor is that StaffMember and whose time window overlaps the
    now-missing shift. Clear the instructor and fire a high-priority alert.
    """
    from apps.activities.models import ActivityBooking
    from apps.communications.services import send_alert  # Track 7 alert service

    # NOTE: Date-only comparison (start_datetime__date=instance.date) misses cross-midnight
    # sessions and allows double-booking within the same day at different times. Use proper
    # datetime overlap instead:
    from datetime import datetime
    import pytz
    shift_start = datetime.combine(instance.date, instance.start_time, tzinfo=pytz.utc)
    shift_end   = datetime.combine(instance.date, instance.end_time,   tzinfo=pytz.utc)

    affected = ActivityBooking.objects.filter(
        assigned_instructor=instance.staff_member,
        status='confirmed',
        start_datetime__lt=shift_end,    # booking starts before shift ends
        end_datetime__gt=shift_start,    # booking ends after shift starts
    )
    if not affected.exists():
        return

    for booking in affected:
        booking.assigned_instructor = None
        booking.save(update_fields=['assigned_instructor'])

    # Fire a high-priority in-app + email alert to the marina's harbour master
    activity_names = ', '.join(
        f"'{b.activity.name}' at {b.start_datetime:%H:%M on %d %b}" for b in affected
    )
    send_alert(
        marina_id=instance.staff_member.marina_id,
        alert_type='instructor_conflict',
        priority='high',
        subject='Action Required: Activity instructor removed due to shift change',
        body=(
            f"The shift for {instance.staff_member.name} on {instance.date} was modified or deleted. "
            f"The following activities now have no assigned instructor: {activity_names}. "
            f"Please assign a replacement instructor immediately."
        ),
    )
```

The receiver is registered in `activities/apps.py` `ready()`. The `send_alert` call is non-blocking — instructor assignment is cleared regardless of whether the notification succeeds.

**Cancel booking — `POST .../bookings/{id}/cancel/`:**

```json
{ "reason": "Customer request" }
```

Backend computes hours until `start_datetime`, applies `CancellationPolicy` tiers, sets `ActivityBooking.status = 'cancelled'`, records `refund_amount`, releases `AssetReservation` records. Returns the computed `refund_amount`.

### Housekeeping

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/housekeeping/tasks/` | List tasks (`?status=`, `?unit_type=`, `?date=`, `?assigned_to=`) |
| POST | `/api/v1/housekeeping/tasks/` | Create manual task |
| GET/PATCH | `/api/v1/housekeeping/tasks/{id}/` | Retrieve / update task |
| POST | `/api/v1/housekeeping/tasks/{id}/advance/` | Advance status to next stage |
| POST | `/api/v1/housekeeping/tasks/{id}/photos/` | Upload photo (multipart) |
| POST | `/api/v1/housekeeping/tasks/{id}/escalate-defect/` | Create `maintenance.Defect` from task |
| GET | `/api/v1/housekeeping/matrix/` | Matrix data for dashboard (see below) |
| GET | `/api/v1/housekeeping/checklist-templates/` | List checklist item templates |
| POST | `/api/v1/housekeeping/checklist-templates/` | Create template item |
| GET | `/api/v1/housekeeping/linen/` | Linen inventory summary |
| PATCH | `/api/v1/housekeeping/linen/{id}/` | Update qty_clean / qty_dirty after laundry return |
| GET | `/api/v1/housekeeping/consumables/` | Consumable stock list |
| PATCH | `/api/v1/housekeeping/consumables/{id}/` | Adjust stock on hand |

**Matrix endpoint (GET `/api/v1/housekeeping/matrix/`):**

Query params: `?from=YYYY-MM-DD&to=YYYY-MM-DD`

```json
{
  "dates": ["2026-07-15", "2026-07-16", "2026-07-17"],
  "units": [
    {
      "unit_id": "vessel-42",
      "unit_label": "Sea Sprite",
      "unit_type": "vessel",
      "cells": {
        "2026-07-15": { "task_id": 101, "status": "dirty",    "assigned_to": "Maria L." },
        "2026-07-16": { "task_id": null, "status": null,      "assigned_to": null },
        "2026-07-17": { "task_id": 104, "status": "clean",    "assigned_to": "Maria L." }
      }
    }
  ]
}
```

**Escalate-defect action (POST `.../tasks/{id}/escalate-defect/`):**

```json
{
  "description": "Broken shower head fitting",
  "severity": "medium"
}
```

Creates a `maintenance.Defect` with `location` set to the task's `unit_label`, links back to the task via `Defect.notes` (includes task ID). On creation, the system sends an in-app alert and email notification to the Maintenance Manager. If Track 7 is merged and the `CRITICAL_DEFECT` AlertRoute is configured, the escalation also fires that route (e.g. Slack/Teams channel). Returns the created `Defect` id. No new model is required — this reuses the existing `Defect` model.

---

## 6. Frontend Architecture — Activities

### Sidebar placement

Activities sit in the sidebar immediately below Events (currently the last item in the "Operations" group). They are conceptually adjacent — both are time-bounded marina offerings — but are separate screens. The nav entry is "Activities" with a route of `/activities`.

Sidebar group: **Operations**
Order: ... | Events | **Activities** | ...

### Screens and components

**`ActivitiesScreen.jsx`** — top-level screen at `/activities`. Two tabs: `Catalogue` | `Bookings`.

---

**`CatalogueTab.jsx`**

- Header: search input + category filter chips + `[ + New Activity ]` button.
- Body: `ActivityCard` grid (similar 3-column grid to `VenueTab` in `Events.jsx`). Each card shows: photo thumbnail, name, category badge, duration, capacity, season window, and a `[ Book ]` / `[ Edit ]` button pair.
- `[ + New Activity ]` opens `ActivityFormDrawer` (slide-in from right, same pattern as `CatalogFormDrawer` in the service catalog spec).
- `ActivityFormDrawer` sections:
  - Basic info (name, category, description, photo upload)
  - Scheduling (duration, capacity min/max, min age, season window)
  - Pricing (table of customer types → ChargeableItem picker, one row per type: member / guest / child)
  - Group discount (optional: threshold headcount + discount percentage; when set, the billing bridge generates a negative line item)
  - Resources (add instructor requirement rows, add equipment asset rows)
  - Extras (add-on items list)
  - Cancellation policy (dropdown from `CancellationPolicy` list)

---

**`BookingsTab.jsx`**

- Header: date picker (defaults to today) + activity filter + status filter + `[ + New Booking ]`.
- Two sub-views toggled by a segmented control: **Calendar** (week view, colour-coded by activity category) | **List** (table).
- Calendar view: `ActivityCalendar.jsx` — 7-column week grid, each activity session shown as a coloured pill. Clicking a pill opens `BookingDetailDrawer`.
- List view: table columns: Activity | Date/Time | Lead Name | Participants | Instructor | Status | Amount.
- `[ + New Booking ]` opens `BookingFormDrawer`:
  - Step 1: select activity + date/time → calls availability endpoint (authenticated), shows remaining capacity and resource status. Slots with instructor conflicts are shown as unavailable (not bookable).
  - Step 2: lead contact + participant list (name, age, customer type per row) → pricing preview auto-calculated, including group discount if applicable.
  - Step 3: extras selection + payment mode (berth invoice / direct).
  - Step 4: confirm + submit. If the requested date falls outside the activity's season window, a warning banner is shown at this step with an "Override Season Warning" button. Staff must explicitly confirm the override before the booking is submitted.
- `BookingDetailDrawer`: shows full booking summary, checklist of resources assigned, extras, invoice link, and a `[ Cancel Booking ]` button that shows computed refund amount before confirming.

### Data hooks

```
hooks/useActivities.js           — CRUD for /activities/catalogue/
hooks/useActivityBookings.js     — CRUD + cancel action for /activities/bookings/
hooks/useCancellationPolicies.js — list/create /activities/cancellation-policies/
```

---

## 7. Frontend Architecture — Housekeeping

### Sidebar placement

Housekeeping is a dedicated top-level sidebar screen under the Operations group, separate from the Boatyard screen. The Boatyard handles heavy mechanical operations; Housekeeping handles hospitality and guest readiness — mixing them would violate the UX mental model of marina staff.

Sidebar group: **Operations**
Order: ... | Activities | **Housekeeping** | ...

Route: `/housekeeping`

### `HousekeepingScreen.jsx`

Two tabs: `Matrix` | `Tasks`.

---

**Matrix tab — `HousekeepingMatrix.jsx`**

This is the primary operational view. It is a standalone screen (not embedded in Boatyard), because its subject matter (charter vessels and accommodation units) is distinct from the dry-stack and haul-out subject matter of the Boatyard screen.

Layout:
- Header: date-range picker (default: today + 6 days) + `[ + New Task ]` button + summary chip row (counts of Dirty / In Progress / Clean / Ready).
- Body: CSS grid. Rows = units/vessels (from the matrix API). Columns = dates in the selected range. Fixed left column shows unit label + unit type icon.
- Each cell is colour-coded by status:
  - `dirty` → red background
  - `in_progress` → amber
  - `ready_inspection` → blue
  - `clean` → teal
  - `ready_guest` → green
  - empty (no task) → light grey
- Clicking a non-empty cell opens `TaskDetailDrawer` (slide-in from right).
- Delay alert: cells where `target_ready_by` is within 2 hours and status is not `ready_guest` get a pulsing warning border.

---

**Tasks tab — `TaskListTab.jsx`**

- Filters: status dropdown + unit type dropdown + assigned-to dropdown + date picker.
- Table columns: Unit | Status | Priority | Assigned To | Target Ready By | Progress (checklist x/y items done).
- Row click opens `TaskDetailDrawer`.
- `[ + New Task ]` opens `TaskFormDrawer` (manual task creation).

---

**`TaskDetailDrawer.jsx`**

Slide-in panel with:
- Task header (unit label, source type badge, status badge).
- Status advance button: `[ Mark In Progress ]` / `[ Ready for Inspection ]` / `[ Mark Clean ]` / `[ Ready for Guest ]` — each maps to the `advance/` action.
- Checklist section: each `TaskChecklistCompletion` row as a checkbox. Check/uncheck sends PATCH.
- Photos section: before/after photo grid + `[ Upload Photo ]` button (type selector: Before / After / Defect).
- Consumable usage: list of consumables recorded against this task + `[ Log Usage ]` inline form.
- Defect escalation: `[ Escalate to Maintenance ]` button — opens a small inline form (description + severity) that POSTs to the `escalate-defect` action. The button label makes clear that this will notify the Maintenance Manager immediately.
- Assigned linen set: shows which linen set was used, with a link to linen inventory.

---

**Mobile housekeeping screen**

The mobile screen is a React PWA route at `/housekeeping/my-tasks`, intended for housekeeping staff using a phone or tablet on the floor. Authentication uses the existing JWT system with a 4-digit PIN fast-switching flow (identical to the pattern used for Forklift operators in Track 6). The device stays authenticated to the marina; the specific `StaffMember` context switches instantly via the PIN pad, eliminating the need to type email/password with wet or gloved hands.

- `MyTasksScreen.jsx` — list of tasks assigned to the currently logged-in staff member, sorted by `target_ready_by`.
- Each task card shows: unit name, check-in time of next guest, progress bar (checklist items done/total), and a large status advance button.
- Tapping a card navigates to `MobileTaskScreen.jsx`:
  - Full checklist with tap-to-complete items.
  - Camera capture buttons (Before / After / Defect) using the HTML `<input type="file" accept="image/*" capture="environment">` pattern.
  - "Escalate Defect" shortcut at the bottom.

### Data hooks

```
hooks/useHousekeepingTasks.js   — list, create, advance, escalate
hooks/useHousekeepingMatrix.js  — matrix endpoint
hooks/useLinenInventory.js      — linen summary + update
hooks/useConsumableStock.js     — consumable list + usage logging
hooks/useChecklistTemplates.js  — template CRUD
```

---

## 8. Charter Checkout Trigger (Dependency on Track 9)

### The dependency

`§20.1` specifies that when a `CharterBooking` checkout is processed, a `HousekeepingTask` is auto-created for that vessel. `CharterBooking` does not exist until Track 9 is merged.

### Safe wiring strategy

**Step 1 — Feature flag.** Add `HOUSEKEEPING_CHARTER_TRIGGER_ENABLED` to Django settings (default `False`). Gate all charter-checkout signal handling behind this flag. This allows Track 8 to be deployed to production independently.

**Step 2 — Django signal (deferred, not a direct call).** When Track 9 adds the `CharterBooking` model, it emits a custom Django signal `charter_checkout_processed` with payload `{ charter_booking_id, vessel_id, vessel_label, checkout_datetime, next_checkin_datetime }`. Track 8 registers a signal receiver in `housekeeping/signals.py`:

```python
# housekeeping/signals.py
from django.conf import settings

def on_charter_checkout(sender, charter_booking_id, vessel_id, vessel_label,
                        checkout_datetime, next_checkin_datetime, marina_id, **kwargs):
    if not getattr(settings, 'HOUSEKEEPING_CHARTER_TRIGGER_ENABLED', False):
        return
    HousekeepingTask.objects.create(
        marina_id=marina_id,
        source_type=HousekeepingTask.SourceType.CHARTER_CHECKOUT,
        source_id=str(charter_booking_id),
        unit_type=HousekeepingTask.UnitType.VESSEL,
        unit_id=str(vessel_id),
        unit_label=vessel_label,
        status=HousekeepingTask.Status.DIRTY,
        target_ready_by=next_checkin_datetime,
    )
```

**Step 3 — Receiver registration.** The receiver is registered in `housekeeping/apps.py` `ready()` method, but it only imports `charter_checkout_processed` if `apps.is_installed('apps.charter')`. This prevents an `ImportError` if Track 9 is not yet present:

```python
# housekeeping/apps.py
def ready(self):
    from django.apps import apps
    if apps.is_installed('apps.charter'):
        from apps.charter.signals import charter_checkout_processed
        from .signals import on_charter_checkout
        charter_checkout_processed.connect(on_charter_checkout)
```

**Step 4 — Merge sequence.** When Track 9 merges: (a) Track 9 emits the signal from its checkout view, (b) set `HOUSEKEEPING_CHARTER_TRIGGER_ENABLED = True` in production settings, (c) write a management command `backfill_housekeeping_tasks` that creates tasks for any past checkouts that occurred before the flag was enabled.

### Mid-stay recurring trigger

Mid-stay tasks do not depend on Track 9. A Django management command `generate_recurring_housekeeping_tasks` runs daily (via cron/Celery beat) and creates tasks for any active charter or accommodation booking whose interval has elapsed. This command is self-contained in the `housekeeping` app and does not import from `charter`.

---

## 9. Implementation Steps (Ordered)

Steps respect Django migration dependencies. Do not reorder within each phase.

**Phase A — Backend: Activities**

1. Scaffold `backend/apps/activities/` app directory, register in `INSTALLED_APPS` and `urls.py`.
2. Write models: `CancellationPolicy`, `Activity` (including `group_discount_threshold`, `group_discount_pct`, and `season_override` fields), `ActivityPricingRule`, `ActivityResourceRequirement`, `ActivityExtra`, `ActivityBooking` (including `expires_at`), `ActivityBookingParticipant`, `ActivityBookingExtra`, `AssetReservation` (with `time_range = DateTimeRangeField` and `ExclusionConstraint`). Run `makemigrations`. The `AssetReservation` migration must include `migrations.RunSQL("CREATE EXTENSION IF NOT EXISTS btree_gist;")` before the `CreateModel` operation — the `ExclusionConstraint` requires the `btree_gist` PostgreSQL extension.
3. Write serializers for all models. `ActivityBookingSerializer.create()` must implement the full validation + resource-check + invoice-creation logic described in Section 5, including the season-override soft warning flow, instructor hard-block check, group discount negative line item, and the non-blocking `ACTIVITY_BOOKED` journey trigger call to Track 7. The booking creation + asset reservation + invoice creation must be wrapped in a single `transaction.atomic()` block — all three succeed or all roll back.
4. Write ViewSets: `ActivityViewSet`, `ActivityBookingViewSet` (with `cancel` and `availability` custom actions), `CancellationPolicyViewSet`. Register routers.
5. Write availability resolution service (`activities/services/availability.py`) — queries `Shift` for instructor availability, performs `NOT EXISTS` check against `ActivityBooking.assigned_instructor` for hard conflict detection, and queries `AssetReservation` using `time_range__overlap` for equipment conflict detection (not `start_datetime`/`end_datetime` range filter).
6. Write billing bridge (`activities/services/billing.py`) — creates draft `Invoice` + `InvoiceLineItem` rows from `ActivityPricingRule.chargeable_item` references, plus a negative `InvoiceLineItem` for group discounts when applicable. Implement `recalculate_activity_invoice(booking)` as a separate function inside `transaction.atomic()` that wipes and fully recomputes all `InvoiceLineItem` rows for a booking, including group discount eligibility re-evaluation. Wire `ActivityBookingParticipant` `post_save` and `post_delete` signals to call `recalculate_activity_invoice`; block recalculation and alert staff if invoice is already `sent` or `paid`.
6a. Write `activities/signals.py` — register `post_save` and `post_delete` on `staff.Shift` to call the instructor conflict resolver (Section 5). Register `post_save` and `post_delete` on `ActivityBookingParticipant` to call `recalculate_activity_invoice`. Register both in `activities/apps.py` `ready()`.
6b. Write `sweep_expired_direct_bookings` Celery beat task (runs every 5 minutes): query `ActivityBooking.objects.filter(status='confirmed', payment_mode='direct', invoice__status='draft', expires_at__lt=now())`. For each result: set `status='cancelled'`, delete linked `AssetReservation` rows (releasing the inventory lock), void the draft `Invoice`. Log each sweep action to a `SystemEvent` or application log for auditability. Verify with an integration test: create a booking with `expires_at = now() - timedelta(minutes=1)`, run the task, assert the `AssetReservation` is gone and the `Invoice` is voided.

**Phase B — Backend: Housekeeping**

7. Scaffold `backend/apps/housekeeping/` app, register.
8. Write models: `ChecklistItem`, `HousekeepingTask`, `TaskChecklistCompletion`, `TaskPhoto`, `LinenSet`, `LinenInventory`, `ConsumableStock`, `ConsumableUsage`. Run `makemigrations`.
9. Write serializers. `HousekeepingTaskSerializer` must include nested `checklist` and `photos` on detail read.
10. Write ViewSets: `HousekeepingTaskViewSet` (with `advance`, `photos`, `escalate-defect` actions), `HousekeepingMatrixView` (non-router `APIView`), `ChecklistTemplateViewSet`, `LinenInventoryViewSet`, `ConsumableStockViewSet`. The `escalate-defect` action must trigger an in-app alert and email to the Maintenance Manager on creation, and optionally fire the Track 7 `CRITICAL_DEFECT` AlertRoute if that track is merged. The `advance` action, when transitioning a task to `status='clean'`, must call the `mark_linen_dirty` atomic service (Section 4f) via `F()` expression + `select_for_update()` + laundry task existence guard — never a direct `qty_dirty += 1; save()` pattern. The `LinenInventoryViewSet` `PATCH` endpoint (for laundry-return qty updates) must similarly use `F()` expressions for `qty_clean` and `qty_dirty` adjustments.
11. Write `housekeeping/signals.py` with the feature-flagged receiver. Write `housekeeping/apps.py` `ready()` with the guarded import.
12. Write `generate_recurring_housekeeping_tasks` management command.

**Phase C — Frontend: Activities**

13. Create `hooks/useActivities.js`, `hooks/useActivityBookings.js`, `hooks/useCancellationPolicies.js`.
14. Build `ActivitiesScreen.jsx` with tab shell.
15. Build `CatalogueTab.jsx` + `ActivityCard.jsx` + `ActivityFormDrawer.jsx` (with pricing table for member/guest/child types, group discount fields, resource requirement rows, extras list).
16. Build `BookingsTab.jsx` + `ActivityCalendar.jsx` + `BookingFormDrawer.jsx` (multi-step wizard, including season-override confirmation step and group discount preview) + `BookingDetailDrawer.jsx`.
17. Add "Activities" nav entry to sidebar below Events.

**Phase D — Frontend: Housekeeping**

18. Create `hooks/useHousekeepingTasks.js`, `hooks/useHousekeepingMatrix.js`, `hooks/useLinenInventory.js`, `hooks/useConsumableStock.js`, `hooks/useChecklistTemplates.js`.
19. Build `HousekeepingScreen.jsx` with Matrix / Tasks tab shell.
20. Build `HousekeepingMatrix.jsx` — CSS grid with colour-coded cells and delay alert logic.
21. Build `TaskListTab.jsx` + `TaskDetailDrawer.jsx` (checklist, photos, consumable logging, defect escalation with Maintenance Manager notification note).
22. Build `MyTasksScreen.jsx` + `MobileTaskScreen.jsx` for the `/housekeeping/my-tasks` PWA route, with 4-digit PIN fast-switching authentication (same pattern as Track 6 Forklift operators).
23. Add "Housekeeping" nav entry to sidebar below Activities.

**Phase E — Integration and flag activation (post Track 9 merge)**

24. Verify Track 9's `charter_checkout_processed` signal payload matches the receiver signature.
25. Set `HOUSEKEEPING_CHARTER_TRIGGER_ENABLED = True` in production settings.
26. Run `backfill_housekeeping_tasks` management command.
