# Track 8 — Activities & Housekeeping: Implementation Plan
Date: 2026-05-08
Status: Ready for execution

---

## Overview

Track 8 introduces two new Django apps:

- **`apps/activities/`** — bookable activity catalogue, resource scheduling (instructor + equipment), multi-participant billing via `ChargeableItem`, group discounts as negative `InvoiceLineItem`, cancellation policies with tiered refunds.
- **`apps/housekeeping/`** — task management (status machine), checklist templates, photo capture, linen inventory, consumable stock, defect escalation to `maintenance.Defect`, matrix dashboard API.

Key invariants that must never be violated:
- All money flows through `billing.ChargeableItem` → `billing.InvoiceLineItem`. No raw prices on activity models.
- Equipment conflict prevention uses PostgreSQL's `ExclusionConstraint` with `DateTimeRangeField` — not a Python-level check and not a `unique_together` constraint.
- Instructor conflict detection is a hard block using a `NOT EXISTS` check against `ActivityBooking.assigned_instructor` plus a shift availability check. Date-only comparisons are forbidden; all checks use proper datetime overlap.
- All three operations in activity booking creation (booking, asset reservation, invoice) must succeed atomically inside a single `transaction.atomic()`.
- Linen inventory increments must use Django `F()` expressions inside `transaction.atomic()` — never a read-modify-write pattern.
- The charter-checkout trigger is feature-flagged and only activates after Track 9 merges.

Staff-only access in v1. No public boater portal for activities.

---

## Part 1 — New Apps Scaffold

### 1.1 `apps/activities/__init__.py` — empty

### 1.2 `apps/activities/apps.py`

```python
from django.apps import AppConfig


class ActivitiesConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.activities'

    def ready(self):
        import apps.activities.signals  # noqa: F401
```

### 1.3 `apps/housekeeping/__init__.py` — empty

### 1.4 `apps/housekeeping/apps.py`

```python
from django.apps import AppConfig


class HousekeepingConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.housekeeping'

    def ready(self):
        import apps.housekeeping.signals  # noqa: F401
        # Charter checkout signal — only connect if Track 9 is present
        from django.apps import apps
        if apps.is_installed('apps.charter'):
            from apps.charter.signals import charter_checkout_processed
            from apps.housekeeping.signals import on_charter_checkout
            charter_checkout_processed.connect(on_charter_checkout)
```

---

## Part 2 — Models: Activities

All models live in `apps/activities/models.py`. Define in dependency order.

### 2.1 `CancellationPolicy`

```python
class CancellationPolicy(models.Model):
    marina               = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                             related_name='cancellation_policies')
    name                 = models.CharField(max_length=200)   # e.g. "Standard 48h Policy"
    full_refund_hours    = models.PositiveIntegerField(default=48)
    partial_refund_hours = models.PositiveIntegerField(default=24)
    partial_refund_pct   = models.DecimalField(max_digits=5, decimal_places=2, default=50)
    # Tier 3 (no refund) is implied: cancellation within partial_refund_hours of start
    is_default           = models.BooleanField(default=False)

    def __str__(self):
        return self.name
```

### 2.2 `Activity`

```python
class Activity(models.Model):
    class Category(models.TextChoices):
        WATER_SPORT = 'water_sport', 'Water Sport'
        LESSON      = 'lesson',      'Lesson / Course'
        EQUIPMENT   = 'equipment',   'Equipment Hire'
        GUIDED_TRIP = 'guided_trip', 'Guided Trip'
        WELLNESS    = 'wellness',    'Wellness'
        OTHER       = 'other',       'Other'

    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                         related_name='activities')
    name             = models.CharField(max_length=200)
    description      = models.TextField(blank=True)
    category         = models.CharField(max_length=30, choices=Category.choices, default=Category.OTHER)
    duration_minutes = models.PositiveIntegerField()
    capacity_min     = models.PositiveIntegerField(default=1)
    capacity_max     = models.PositiveIntegerField()
    min_age          = models.PositiveIntegerField(default=0)
    photo            = models.ImageField(upload_to='activities/photos/', null=True, blank=True)
    is_active        = models.BooleanField(default=True)

    # Seasonal availability — null = year-round
    season_start     = models.DateField(null=True, blank=True)
    season_end       = models.DateField(null=True, blank=True)

    # Group discount — creates a negative InvoiceLineItem when participant_count >= threshold
    group_discount_threshold = models.PositiveIntegerField(null=True, blank=True)
    group_discount_pct       = models.DecimalField(max_digits=5, decimal_places=2,
                                                    null=True, blank=True)

    cancellation_policy = models.ForeignKey(
        CancellationPolicy, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='activities'
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name
```

### 2.3 `ActivityPricingRule`

```python
class ActivityPricingRule(models.Model):
    class CustomerType(models.TextChoices):
        MEMBER = 'member', 'Member'
        GUEST  = 'guest',  'Guest'
        CHILD  = 'child',  'Child'

    activity        = models.ForeignKey(Activity, on_delete=models.CASCADE, related_name='pricing_rules')
    customer_type   = models.CharField(max_length=20, choices=CustomerType.choices)
    chargeable_item = models.ForeignKey(
        'billing.ChargeableItem', on_delete=models.PROTECT, related_name='activity_pricing_rules'
    )
    # No raw price field — ChargeableItem.unit_price IS the price per person for this type

    class Meta:
        unique_together = [('activity', 'customer_type')]
```

### 2.4 `ActivityResourceRequirement`

```python
class ActivityResourceRequirement(models.Model):
    class ResourceType(models.TextChoices):
        INSTRUCTOR = 'instructor', 'Instructor (Staff)'
        ASSET      = 'asset',      'Equipment Asset'

    activity          = models.ForeignKey(Activity, on_delete=models.CASCADE,
                                           related_name='resource_requirements')
    resource_type     = models.CharField(max_length=20, choices=ResourceType.choices)

    # Instructor requirements
    required_role     = models.CharField(max_length=100, blank=True)   # e.g. "Kayak Instructor"
    staff_member      = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='activity_requirements'
    )  # null = any staff with required_role; non-null = specific person required

    # Asset requirements
    asset             = models.ForeignKey(
        'maintenance.Asset', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='activity_requirements'
    )
    quantity_required = models.PositiveIntegerField(default=1)
```

### 2.5 `ActivityExtra`

```python
class ActivityExtra(models.Model):
    activity        = models.ForeignKey(Activity, on_delete=models.CASCADE, related_name='extras')
    name            = models.CharField(max_length=200)
    chargeable_item = models.ForeignKey(
        'billing.ChargeableItem', on_delete=models.PROTECT, related_name='activity_extras'
    )
    is_active       = models.BooleanField(default=True)
```

### 2.6 `ActivityBooking`

```python
class ActivityBooking(models.Model):
    class Status(models.TextChoices):
        CONFIRMED = 'confirmed', 'Confirmed'
        CANCELLED = 'cancelled', 'Cancelled'
        COMPLETED = 'completed', 'Completed'
        NO_SHOW   = 'no_show',   'No Show'

    class PaymentMode(models.TextChoices):
        BERTH_INVOICE = 'berth_invoice', 'Add to Berth Invoice'
        DIRECT        = 'direct',        'Direct Payment'

    marina            = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                           related_name='activity_bookings')
    activity          = models.ForeignKey(Activity, on_delete=models.PROTECT, related_name='bookings')
    member            = models.ForeignKey('members.Member', on_delete=models.SET_NULL,
                                           null=True, blank=True)
    lead_name         = models.CharField(max_length=200, blank=True)
    lead_email        = models.EmailField(blank=True)
    lead_phone        = models.CharField(max_length=30, blank=True)

    start_datetime    = models.DateTimeField()
    end_datetime      = models.DateTimeField()   # set at creation: start + activity.duration_minutes

    participant_count = models.PositiveIntegerField(default=1)
    status            = models.CharField(max_length=20, choices=Status.choices, default=Status.CONFIRMED)
    payment_mode      = models.CharField(max_length=20, choices=PaymentMode.choices,
                                          default=PaymentMode.DIRECT)

    season_override   = models.BooleanField(default=False)

    assigned_instructor = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='activity_bookings'
    )

    invoice           = models.ForeignKey(
        'billing.Invoice', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='activity_bookings'
    )

    cancelled_at        = models.DateTimeField(null=True, blank=True)
    cancellation_reason = models.TextField(blank=True)
    refund_amount       = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    # TTL for walk-up direct-payment bookings — prevents orphaned draft invoices and locked assets
    # Set to now() + 15 minutes for payment_mode='direct'; null for berth_invoice
    expires_at        = models.DateTimeField(
        null=True, blank=True,
        help_text='TTL for direct-payment bookings. Sweep task cancels and releases assets on expiry.'
    )

    notes             = models.TextField(blank=True)
    created_at        = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['start_datetime']
```

### 2.7 `ActivityBookingParticipant`

```python
class ActivityBookingParticipant(models.Model):
    class CustomerType(models.TextChoices):
        MEMBER = 'member', 'Member'
        GUEST  = 'guest',  'Guest'
        CHILD  = 'child',  'Child'

    booking       = models.ForeignKey(ActivityBooking, on_delete=models.CASCADE,
                                       related_name='participants')
    name          = models.CharField(max_length=200, blank=True)
    age           = models.PositiveIntegerField(null=True, blank=True)
    customer_type = models.CharField(max_length=20, choices=CustomerType.choices,
                                      default=CustomerType.GUEST)
```

### 2.8 `ActivityBookingExtra`

```python
class ActivityBookingExtra(models.Model):
    booking  = models.ForeignKey(ActivityBooking, on_delete=models.CASCADE,
                                  related_name='booking_extras')
    extra    = models.ForeignKey(ActivityExtra, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField(default=1)
```

### 2.9 `AssetReservation`

This is the most critical model in Track 8. It uses PostgreSQL's `ExclusionConstraint` with a `DateTimeRangeField` to enforce true time-range mutual exclusion at the database level.

```python
from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import DateTimeRangeField, RangeOperators
from psycopg2.extras import DateTimeTZRange


class AssetReservation(models.Model):
    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    asset            = models.ForeignKey('maintenance.Asset', on_delete=models.CASCADE,
                                          related_name='reservations')
    activity_booking = models.ForeignKey(ActivityBooking, on_delete=models.CASCADE,
                                          related_name='asset_reservations')

    # DateTimeRangeField stores [start, end) as PostgreSQL tstzrange.
    # Required for ExclusionConstraint — separate start/end DateTimeFields cannot
    # participate in an overlap operator constraint.
    time_range       = DateTimeRangeField(
        help_text='Reservation window [start, end). Derived from ActivityBooking.start/end.'
    )

    class Meta:
        constraints = [
            ExclusionConstraint(
                name='prevent_asset_double_booking',
                expressions=[
                    ('asset', RangeOperators.EQUAL),
                    ('time_range', RangeOperators.OVERLAPS),
                ],
                # Cancelled bookings are excluded so releasing a reservation
                # does not block re-booking the same asset in the same window.
                # Use condition= kwarg (Django 4.2+) when ready:
                # condition=Q(activity_booking__status='confirmed')
            )
        ]
        indexes = [
            models.Index(fields=['asset']),
        ]
```

**Critical migration note:** The `AssetReservation` migration must include a `RunSQL` step to enable the `btree_gist` PostgreSQL extension before the `CreateModel` step. Without this extension, PostgreSQL cannot create a GIST index on non-geometric types (like `DateTimeRangeField`), and the `ExclusionConstraint` will fail.

```python
# In the generated migration file, add before CreateModel:
migrations.RunSQL("CREATE EXTENSION IF NOT EXISTS btree_gist;"),
```

---

## Part 3 — Models: Housekeeping

All models live in `apps/housekeeping/models.py`.

### 3.1 `HousekeepingTask`

```python
class HousekeepingTask(models.Model):
    class SourceType(models.TextChoices):
        CHARTER_CHECKOUT       = 'charter_checkout',       'Charter Checkout'
        ACCOMMODATION_CHECKOUT = 'accommodation_checkout', 'Accommodation Checkout'
        MID_STAY_RECURRING     = 'mid_stay_recurring',     'Mid-Stay Recurring'
        ON_DEMAND              = 'on_demand',              'On-Demand'
        MANUAL                 = 'manual',                 'Manual'
        LAUNDRY                = 'laundry',                'Laundry Run'

    class UnitType(models.TextChoices):
        VESSEL        = 'vessel',        'Charter Vessel'
        ACCOMMODATION = 'accommodation', 'Accommodation Unit'
        FACILITY      = 'facility',      'Facility / Common Area'

    class Status(models.TextChoices):
        DIRTY            = 'dirty',            'Dirty'
        IN_PROGRESS      = 'in_progress',       'In Progress'
        READY_INSPECTION = 'ready_inspection',  'Ready for Inspection'
        CLEAN            = 'clean',             'Inspected & Clean'
        READY_GUEST      = 'ready_guest',       'Ready for Guest'

    class Priority(models.TextChoices):
        NORMAL = 'normal', 'Normal'
        HIGH   = 'high',   'High'
        URGENT = 'urgent', 'Urgent'

    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                      related_name='housekeeping_tasks')
    source_type  = models.CharField(max_length=30, choices=SourceType.choices)
    source_id    = models.CharField(max_length=255, blank=True)

    unit_type    = models.CharField(max_length=20, choices=UnitType.choices)
    unit_id      = models.CharField(max_length=255)
    unit_label   = models.CharField(max_length=200)

    status       = models.CharField(max_length=25, choices=Status.choices, default=Status.DIRTY)
    priority     = models.CharField(max_length=10, choices=Priority.choices, default=Priority.NORMAL)

    triggered_at     = models.DateTimeField(auto_now_add=True)
    target_ready_by  = models.DateTimeField(null=True, blank=True)
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

    # Mid-stay recurring config — null for one-off tasks
    recurrence_interval_days = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ['target_ready_by', '-priority']
```

### 3.2 `ChecklistItem`

```python
class ChecklistItem(models.Model):
    marina     = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                    related_name='checklist_items')
    unit_type  = models.CharField(max_length=20, choices=HousekeepingTask.UnitType.choices)
    order      = models.PositiveIntegerField(default=0)
    text       = models.CharField(max_length=500)
    is_active  = models.BooleanField(default=True)

    class Meta:
        ordering = ['unit_type', 'order']
```

### 3.3 `TaskChecklistCompletion`

```python
class TaskChecklistCompletion(models.Model):
    task           = models.ForeignKey(HousekeepingTask, on_delete=models.CASCADE,
                                        related_name='checklist')
    checklist_item = models.ForeignKey(ChecklistItem, on_delete=models.PROTECT,
                                        related_name='completions')
    is_done        = models.BooleanField(default=False)
    completed_at   = models.DateTimeField(null=True, blank=True)
    note           = models.CharField(max_length=500, blank=True)
```

### 3.4 `TaskPhoto`

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
        'staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True
    )
```

### 3.5 `LinenSet`

```python
class LinenSet(models.Model):
    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                     related_name='linen_sets')
    name        = models.CharField(max_length=200)
    description = models.TextField(blank=True)
    is_active   = models.BooleanField(default=True)
```

### 3.6 `LinenInventory`

```python
class LinenInventory(models.Model):
    marina             = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                            related_name='linen_inventory')
    linen_set          = models.ForeignKey(LinenSet, on_delete=models.CASCADE, related_name='inventory')
    qty_clean          = models.PositiveIntegerField(default=0)
    qty_dirty          = models.PositiveIntegerField(default=0)
    qty_total          = models.PositiveIntegerField(default=0)
    laundry_threshold  = models.PositiveIntegerField(default=10)
    updated_at         = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('marina', 'linen_set')]
```

### 3.7 `ConsumableStock`

```python
class ConsumableStock(models.Model):
    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                         related_name='consumable_stock')
    name            = models.CharField(max_length=200)
    unit            = models.CharField(max_length=50, blank=True)
    qty_on_hand     = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    low_stock_alert = models.DecimalField(max_digits=10, decimal_places=2, default=5)
    is_active       = models.BooleanField(default=True)
```

### 3.8 `ConsumableUsage`

```python
class ConsumableUsage(models.Model):
    task        = models.ForeignKey(HousekeepingTask, on_delete=models.CASCADE,
                                     related_name='consumable_usage')
    consumable  = models.ForeignKey(ConsumableStock, on_delete=models.PROTECT, related_name='usage')
    qty_used    = models.DecimalField(max_digits=10, decimal_places=2)
    recorded_at = models.DateTimeField(auto_now_add=True)
```

---

## Part 4 — Service Layer: Activities

### 4.1 `apps/activities/services/availability.py`

**`check_instructor_availability(staff_member, start_dt, end_dt, exclude_booking_id=None) -> bool`**

```python
def check_instructor_availability(staff_member, start_dt, end_dt, exclude_booking_id=None):
    """
    Returns True only if the instructor is both:
    1. Scheduled to work (has a Shift covering this datetime window), AND
    2. Not already assigned to another confirmed ActivityBooking that overlaps.

    Uses proper datetime overlap — NOT date-only comparison, which would miss
    cross-midnight sessions and cause false conflicts within the same day.
    """
    from apps.staff.models import Shift
    import pytz
    from datetime import datetime

    # Step 1: Check Shift covers the window
    # Shift stores week_start + day + start_time/end_time. Reconstruct shift datetimes.
    # Find shifts where the shift date matches start_dt.date() and times overlap.
    day_abbr = start_dt.strftime('%a').lower()  # 'mon', 'tue', etc.
    shifts = Shift.objects.filter(
        staff_member=staff_member,
        week_start__lte=start_dt.date(),
        day=day_abbr,
        is_off=False,
    )
    shift_covers = False
    for shift in shifts:
        shift_start = datetime.combine(start_dt.date(), shift.start_time, tzinfo=pytz.utc)
        shift_end   = datetime.combine(start_dt.date(), shift.end_time,   tzinfo=pytz.utc)
        if shift_start <= start_dt and shift_end >= end_dt:
            shift_covers = True
            break
    if not shift_covers:
        return False

    # Step 2: Check no overlapping confirmed ActivityBooking already uses this instructor
    qs = ActivityBooking.objects.filter(
        assigned_instructor=staff_member,
        status='confirmed',
        start_datetime__lt=end_dt,   # existing booking starts before our end
        end_datetime__gt=start_dt,   # existing booking ends after our start
    )
    if exclude_booking_id:
        qs = qs.exclude(pk=exclude_booking_id)
    return not qs.exists()
```

**`check_asset_availability(asset, start_dt, end_dt, exclude_booking_id=None) -> bool`**

```python
def check_asset_availability(asset, start_dt, end_dt, exclude_booking_id=None):
    """
    Checks AssetReservation for conflicts using time_range overlap.
    Does NOT use start_datetime/end_datetime range filters — only DateTimeRangeField overlap.
    """
    from psycopg2.extras import DateTimeTZRange
    from apps.activities.models import AssetReservation
    window = DateTimeTZRange(start_dt, end_dt)
    qs = AssetReservation.objects.filter(asset=asset, time_range__overlap=window)
    if exclude_booking_id:
        qs = qs.exclude(activity_booking_id=exclude_booking_id)
    return not qs.exists()
```

**`get_activity_availability(activity, date_from, date_to) -> list`**

Iterates over date range. For each date, computes potential slots based on activity duration. Checks instructor and equipment availability for each slot. Returns list of slot dicts matching the spec's API response format.

### 4.2 `apps/activities/services/billing.py`

**`create_activity_invoice(booking) -> Invoice`**

Called inside `transaction.atomic()` during booking creation.

```python
def create_activity_invoice(booking):
    """
    Create a draft Invoice + InvoiceLineItem rows from ActivityPricingRule.chargeable_item references.
    Must be called inside transaction.atomic() — partial creation is an invalid state.
    """
    from apps.billing.service import create_invoice, add_line_item_from_catalog
    from collections import Counter

    activity = booking.activity
    participants = booking.participants.all()

    # Group participants by customer_type
    type_counts = Counter(p.customer_type for p in participants)

    invoice = create_invoice(
        marina=booking.marina,
        member=booking.member,
        source_type='activity_booking',
        source_id=str(booking.pk),
    )

    for customer_type, count in type_counts.items():
        try:
            rule = activity.pricing_rules.get(customer_type=customer_type)
        except ActivityPricingRule.DoesNotExist:
            # Fall back to guest pricing if no specific rule exists
            rule = activity.pricing_rules.get(customer_type='guest')
        add_line_item_from_catalog(invoice, rule.chargeable_item, quantity=count)

    # Group discount: negative InvoiceLineItem when participant_count >= threshold
    if (activity.group_discount_threshold and
            booking.participant_count >= activity.group_discount_threshold and
            activity.group_discount_pct):
        subtotal = sum(item.total_price for item in invoice.items.all())
        discount_amount = -(subtotal * activity.group_discount_pct / 100).quantize(Decimal('0.01'))
        InvoiceLineItem.objects.create(
            invoice=invoice,
            description=f'Group Discount ({activity.group_discount_pct}%)',
            quantity=1,
            unit_price=discount_amount,
            total_price=discount_amount,
        )

    # Extras
    for booking_extra in booking.booking_extras.select_related('extra__chargeable_item').all():
        add_line_item_from_catalog(invoice, booking_extra.extra.chargeable_item,
                                   quantity=booking_extra.quantity)

    return invoice
```

**`recalculate_activity_invoice(booking)`**

Called by `ActivityBookingParticipant` post_save/post_delete signals. Must run inside `transaction.atomic()`.

```python
def recalculate_activity_invoice(booking):
    """
    Wipe and fully recompute all InvoiceLineItem rows for a booking.
    Called whenever participant list changes (participant added or removed).

    BLOCKS recalculation if invoice is already sent or paid — immutable invoices
    must not be mutated. Fires an in-app alert to staff instead.
    """
    from apps.billing.models import Invoice, InvoiceLineItem
    from apps.billing.service import add_line_item_from_catalog
    from collections import Counter
    from decimal import Decimal

    if not booking.invoice_id:
        return

    invoice = Invoice.objects.select_for_update().get(pk=booking.invoice_id)

    if invoice.status in ('sent', 'paid', 'unpaid', 'open'):
        # Immutable invoice — alert staff, do not mutate
        _alert_immutable_invoice(booking, invoice)
        return

    with transaction.atomic():
        # Wipe all existing line items
        invoice.items.all().delete()

        # Recompute from current participant list
        participants = booking.participants.all()
        type_counts  = Counter(p.customer_type for p in participants)
        activity     = booking.activity

        for customer_type, count in type_counts.items():
            try:
                rule = activity.pricing_rules.get(customer_type=customer_type)
            except ActivityPricingRule.DoesNotExist:
                rule = activity.pricing_rules.get(customer_type='guest')
            add_line_item_from_catalog(invoice, rule.chargeable_item, quantity=count)

        # Recheck group discount eligibility
        if (activity.group_discount_threshold and
                booking.participant_count >= activity.group_discount_threshold and
                activity.group_discount_pct):
            subtotal = sum(item.total_price for item in invoice.items.all())
            discount_amount = -(subtotal * activity.group_discount_pct / 100).quantize(Decimal('0.01'))
            InvoiceLineItem.objects.create(
                invoice=invoice,
                description=f'Group Discount ({activity.group_discount_pct}%)',
                quantity=1, unit_price=discount_amount, total_price=discount_amount,
            )

        # Recalculate invoice totals
        from apps.billing.service import recalculate_invoice_totals
        recalculate_invoice_totals(invoice)


def _alert_immutable_invoice(booking, invoice):
    """Log a warning for staff — the invoice cannot be recalculated automatically."""
    import logging
    logger = logging.getLogger('apps.activities')
    logger.warning(
        'Participant count changed on ActivityBooking #%s after invoice #%s was issued '
        '(status: %s). Manual review required.',
        booking.pk, invoice.invoice_number, invoice.status
    )
    # If Track 7 is available, fire an alert via the communications app
    try:
        from apps.communications.services.alert import send_alert
        send_alert(
            marina_id=booking.marina_id,
            alert_type='stock_low',  # reuse closest available type; add 'invoice_discrepancy' later
            subject='Activity Invoice Manual Review Required',
            body=(f'Participant count changed on ActivityBooking #{booking.pk} after '
                  f'Invoice {invoice.invoice_number} ({invoice.status}) was issued. '
                  f'Manual review required.'),
        )
    except Exception:
        pass
```

**`compute_cancellation_refund(booking) -> Decimal`**

```python
def compute_cancellation_refund(booking):
    """
    Applies CancellationPolicy tiers based on hours until activity start.
    Returns the refund amount (Decimal). Returns 0 if no policy or no invoice.
    """
    from django.utils import timezone
    from decimal import Decimal

    if not booking.activity.cancellation_policy or not booking.invoice_id:
        return Decimal('0.00')

    policy = booking.activity.cancellation_policy
    hours_until_start = (booking.start_datetime - timezone.now()).total_seconds() / 3600

    # Retrieve total paid amount (invoice total)
    invoice_total = booking.invoice.total

    if hours_until_start >= policy.full_refund_hours:
        return invoice_total
    elif hours_until_start >= policy.partial_refund_hours:
        return (invoice_total * policy.partial_refund_pct / 100).quantize(Decimal('0.01'))
    else:
        return Decimal('0.00')
```

### 4.3 `apps/activities/services/booking.py`

**`book_activity_session(marina, activity, start_datetime, member=None, lead_name='', lead_email='', lead_phone='', participant_data=None, extras_data=None, payment_mode='direct', season_override=False, assigned_instructor_id=None) -> ActivityBooking`**

This is the core service. It must be called from `ActivityBookingViewSet.perform_create()`. It owns the entire atomic creation sequence.

```python
def book_activity_session(marina, activity, start_datetime, member=None,
                           lead_name='', lead_email='', lead_phone='',
                           participant_data=None, extras_data=None,
                           payment_mode='direct', season_override=False,
                           assigned_instructor_id=None):
    from datetime import timedelta
    from django.utils import timezone
    from psycopg2.extras import DateTimeTZRange
    from apps.activities.services.availability import (
        check_instructor_availability, check_asset_availability
    )
    from apps.activities.services.billing import create_activity_invoice

    participant_data = participant_data or []
    extras_data      = extras_data or []
    end_datetime     = start_datetime + timedelta(minutes=activity.duration_minutes)
    participant_count = len(participant_data) or 1

    # Season window check — soft warning, not hard rejection
    if activity.season_start and activity.season_end and not season_override:
        booking_date = start_datetime.date()
        if not (activity.season_start <= booking_date <= activity.season_end):
            raise SeasonWarning('Booking date is outside the activity season window.')

    # Capacity check
    if participant_count < activity.capacity_min or participant_count > activity.capacity_max:
        raise ValueError(f'Participant count {participant_count} outside allowed range '
                         f'[{activity.capacity_min}, {activity.capacity_max}].')

    # Resource availability checks
    resolved_instructor = None
    required_assets = []
    for req in activity.resource_requirements.all():
        if req.resource_type == 'instructor':
            candidate = req.staff_member or _find_available_instructor(
                marina, req.required_role, start_datetime, end_datetime
            )
            if candidate is None or not check_instructor_availability(
                    candidate, start_datetime, end_datetime):
                raise ResourceUnavailable(f'Instructor unavailable for {start_datetime}.')
            resolved_instructor = assigned_instructor_id and (
                lambda: StaffMember.objects.get(pk=assigned_instructor_id)
            )() or candidate

        elif req.resource_type == 'asset':
            if not check_asset_availability(req.asset, start_datetime, end_datetime):
                raise ResourceUnavailable(f'Asset {req.asset.name} unavailable for {start_datetime}.')
            required_assets.append((req.asset, req.quantity_required))

    # Atomic: booking + asset reservations + invoice — all or nothing
    with transaction.atomic():
        booking = ActivityBooking.objects.create(
            marina=marina,
            activity=activity,
            member=member,
            lead_name=lead_name,
            lead_email=lead_email,
            lead_phone=lead_phone,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
            participant_count=participant_count,
            status=ActivityBooking.Status.CONFIRMED,
            payment_mode=payment_mode,
            season_override=season_override,
            assigned_instructor=resolved_instructor,
            expires_at=(timezone.now() + timedelta(minutes=15)
                        if payment_mode == 'direct' else None),
        )

        # Participants
        for pdata in participant_data:
            ActivityBookingParticipant.objects.create(booking=booking, **pdata)

        # Extras
        for edata in extras_data:
            ActivityBookingExtra.objects.create(booking=booking, **edata)

        # Asset reservations — ExclusionConstraint will IntegrityError on double-book
        window = DateTimeTZRange(start_datetime, end_datetime)
        for asset, qty in required_assets:
            for _ in range(qty):
                AssetReservation.objects.create(
                    marina=marina,
                    asset=asset,
                    activity_booking=booking,
                    time_range=window,
                )

        # Invoice creation (only for direct payment or berth_invoice with draft)
        if payment_mode in ('direct', 'berth_invoice'):
            invoice = create_activity_invoice(booking)
            booking.invoice = invoice
            booking.save(update_fields=['invoice'])

    # Non-blocking: fire ACTIVITY_BOOKED journey trigger (Track 7)
    # Booking creation must succeed even if this fails
    try:
        transaction.on_commit(lambda: _fire_activity_booked_journey(booking))
    except Exception:
        pass

    return booking


class SeasonWarning(Exception):
    """Raised when booking date is outside season window and season_override is False."""


class ResourceUnavailable(Exception):
    """Raised when a required instructor or asset is not available."""
```

### 4.4 `apps/activities/services/cancellation.py`

**`cancel_activity_booking(booking, reason='') -> dict`**

```python
def cancel_activity_booking(booking, reason=''):
    from django.utils import timezone
    from apps.activities.services.billing import compute_cancellation_refund

    with transaction.atomic():
        refund_amount = compute_cancellation_refund(booking)
        booking.status              = ActivityBooking.Status.CANCELLED
        booking.cancelled_at        = timezone.now()
        booking.cancellation_reason = reason
        booking.refund_amount       = refund_amount
        booking.save(update_fields=['status', 'cancelled_at', 'cancellation_reason', 'refund_amount'])

        # Release asset reservations
        booking.asset_reservations.all().delete()

    return {'refund_amount': str(refund_amount)}
```

---

## Part 5 — Service Layer: Housekeeping

### 5.1 `apps/housekeeping/services.py`

**`mark_linen_dirty(inventory_id, qty=1)`**

```python
def mark_linen_dirty(inventory_id, qty=1):
    """
    Atomic linen inventory update. Uses F() expression to prevent lost updates
    under concurrent housekeeper task completions on mobile devices.
    Checks laundry threshold and creates a laundry task if needed, with an
    existence guard to prevent duplicate tasks.
    """
    from django.db.models import F
    from apps.housekeeping.models import LinenInventory, HousekeepingTask

    with transaction.atomic():
        # Atomic increment — eliminates read-modify-write race condition
        LinenInventory.objects.filter(pk=inventory_id).update(
            qty_dirty=F('qty_dirty') + qty,
            qty_clean=F('qty_clean') - qty,
        )
        # Re-fetch with lock to get committed value for threshold check
        inventory = LinenInventory.objects.select_for_update().get(pk=inventory_id)

        if inventory.qty_dirty >= inventory.laundry_threshold:
            # Existence guard: only create if no open laundry task already exists
            already_open = HousekeepingTask.objects.filter(
                marina=inventory.marina,
                source_type=HousekeepingTask.SourceType.LAUNDRY,
                unit_id=str(inventory.linen_set_id),
                status__in=['dirty', 'in_progress', 'ready_inspection'],
            ).exists()
            if not already_open:
                HousekeepingTask.objects.create(
                    marina=inventory.marina,
                    source_type=HousekeepingTask.SourceType.LAUNDRY,
                    unit_type=HousekeepingTask.UnitType.FACILITY,
                    unit_id=str(inventory.linen_set_id),
                    unit_label=f'Laundry: {inventory.linen_set.name}',
                    priority=HousekeepingTask.Priority.HIGH,
                )
```

**`escalate_to_defect(task, description, severity) -> Defect`**

```python
def escalate_to_defect(task, description, severity):
    """
    Creates a maintenance.Defect from a housekeeping task.
    Notifies Maintenance Manager in-app and optionally via Track 7 CRITICAL_DEFECT AlertRoute.
    """
    from apps.maintenance.models import Defect
    defect = Defect.objects.create(
        marina=task.marina,
        location=task.unit_label,
        description=description,
        severity=severity,
        reporter=task.assigned_to.name if task.assigned_to else 'Housekeeping',
        notes=f'Escalated from Housekeeping Task #{task.pk}',
        status='open',
    )
    # Notify Maintenance Manager
    try:
        from apps.communications.services.alert import send_alert
        send_alert(
            marina_id=task.marina_id,
            alert_type='critical_defect',
            subject=f'Defect Escalated from Housekeeping: {task.unit_label}',
            body=f'{description} (Severity: {severity}). Task #{task.pk}, Unit: {task.unit_label}.',
        )
    except Exception:
        pass
    return defect
```

**`populate_task_checklist(task)`**

```python
def populate_task_checklist(task):
    """
    Pre-populate TaskChecklistCompletion rows from ChecklistItem templates
    matching the task's unit_type. Called when a task is first assigned.
    """
    from apps.housekeeping.models import ChecklistItem, TaskChecklistCompletion
    templates = ChecklistItem.objects.filter(
        marina=task.marina,
        unit_type=task.unit_type,
        is_active=True,
    )
    TaskChecklistCompletion.objects.bulk_create([
        TaskChecklistCompletion(task=task, checklist_item=item)
        for item in templates
    ])
```

**`advance_task_status(task) -> HousekeepingTask`**

Advances status through the state machine: `dirty → in_progress → ready_inspection → clean → ready_guest`. On transition to `clean`, calls `mark_linen_dirty()` if a linen set is linked. Returns updated task.

---

## Part 6 — Signals

### 6.1 `apps/activities/signals.py`

```python
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver


@receiver(post_delete, sender='staff.Shift')
@receiver(post_save, sender='staff.Shift')
def on_shift_modified(sender, instance, **kwargs):
    """
    When a Shift is deleted or its times change, find every ActivityBooking whose
    assigned_instructor overlaps the now-missing/changed shift window.
    Clear the instructor assignment and fire a high-priority alert.

    Uses proper datetime overlap — NOT date-only comparison.
    """
    from datetime import datetime
    import pytz
    from apps.activities.models import ActivityBooking

    shift_start = datetime.combine(instance.date, instance.start_time, tzinfo=pytz.utc)
    shift_end   = datetime.combine(instance.date, instance.end_time,   tzinfo=pytz.utc)

    affected = ActivityBooking.objects.filter(
        assigned_instructor=instance.staff_member,
        status='confirmed',
        start_datetime__lt=shift_end,
        end_datetime__gt=shift_start,
    )
    if not affected.exists():
        return

    for booking in affected:
        booking.assigned_instructor = None
        booking.save(update_fields=['assigned_instructor'])

    activity_names = ', '.join(
        f"'{b.activity.name}' at {b.start_datetime:%H:%M on %d %b}" for b in affected
    )
    try:
        from apps.communications.services.alert import send_alert
        send_alert(
            marina_id=instance.staff_member.marina_id,
            alert_type='instructor_conflict',
            priority='high',
            subject='Action Required: Activity instructor removed due to shift change',
            body=(
                f'The shift for {instance.staff_member.name} on {instance.date} was modified or '
                f'deleted. The following activities now have no assigned instructor: {activity_names}. '
                f'Please assign a replacement instructor immediately.'
            ),
        )
    except Exception:
        pass  # send_alert must not block instructor assignment clearance


@receiver(post_save, sender='activities.ActivityBookingParticipant')
@receiver(post_delete, sender='activities.ActivityBookingParticipant')
def on_participant_count_changed(sender, instance, **kwargs):
    """
    Recalculate invoice line items whenever the participant list changes.
    Ensures group discount eligibility is re-evaluated dynamically.
    """
    from apps.activities.services.billing import recalculate_activity_invoice
    booking = instance.booking
    if booking.status == 'confirmed' and booking.invoice_id:
        recalculate_activity_invoice(booking)
```

**Note on `staff.Shift` date field:** The existing `Shift` model uses `week_start` (DateField) + `day` (CharField like 'mon', 'tue'). The signal needs to reconstruct the actual shift date. Add a helper property `shift_date` to `Shift` or compute it in the signal: `shift_date = week_start + timedelta(days=DAYS.index(day))`.

### 6.2 `apps/activities/apps.py` `ready()` — registers signals

```python
def ready(self):
    import apps.activities.signals  # noqa: F401
    # Staff shift signals — connect explicitly to avoid import ordering issues
    from django.db.models.signals import post_save, post_delete
    from apps.staff.models import Shift
    from apps.activities.signals import on_shift_modified
    post_save.connect(on_shift_modified, sender=Shift, dispatch_uid='activities.on_shift_save')
    post_delete.connect(on_shift_modified, sender=Shift, dispatch_uid='activities.on_shift_delete')
```

### 6.3 `apps/housekeeping/signals.py`

```python
from django.conf import settings


def on_charter_checkout(sender, charter_booking_id, vessel_id, vessel_label,
                         checkout_datetime, next_checkin_datetime, marina_id, **kwargs):
    """
    Feature-flagged receiver. Only creates tasks when HOUSEKEEPING_CHARTER_TRIGGER_ENABLED=True.
    Connected in housekeeping/apps.py ready() only if apps.charter is installed.
    """
    if not getattr(settings, 'HOUSEKEEPING_CHARTER_TRIGGER_ENABLED', False):
        return
    from apps.housekeeping.models import HousekeepingTask
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

---

## Part 7 — Celery Tasks

### 7.1 `apps/activities/tasks.py`

```python
from celery import shared_task
from django.utils import timezone


@shared_task
def sweep_expired_direct_bookings():
    """
    Runs every 5 minutes. Cancels expired direct-payment bookings whose draft invoices
    were never confirmed (e.g., walk-up customer walked away mid-payment).
    Releases AssetReservation rows and voids draft invoices.
    """
    from apps.activities.models import ActivityBooking
    from apps.billing.models import Invoice

    expired = ActivityBooking.objects.filter(
        status='confirmed',
        payment_mode='direct',
        invoice__status='draft',
        expires_at__lt=timezone.now(),
    ).select_related('invoice')

    for booking in expired:
        booking.asset_reservations.all().delete()
        if booking.invoice:
            booking.invoice.status = 'void'
            booking.invoice.save(update_fields=['status'])
        booking.status = 'cancelled'
        booking.cancellation_reason = 'Expired — direct payment not completed.'
        booking.save(update_fields=['status', 'cancellation_reason'])
```

### 7.2 `apps/housekeeping/tasks.py`

```python
from celery import shared_task


@shared_task
def generate_recurring_housekeeping_tasks():
    """
    Daily task. Creates mid-stay recurring housekeeping tasks for active bookings
    whose recurrence interval has elapsed. Self-contained — does not import from charter.
    """
    from apps.housekeeping.models import HousekeepingTask
    from django.utils import timezone
    from datetime import timedelta

    # Find recurring tasks where it's time for the next recurrence
    recurring = HousekeepingTask.objects.filter(
        recurrence_interval_days__isnull=False,
        status=HousekeepingTask.Status.CLEAN,
    )
    for task in recurring:
        next_due = task.completed_at + timedelta(days=task.recurrence_interval_days)
        if next_due <= timezone.now():
            HousekeepingTask.objects.create(
                marina=task.marina,
                source_type=HousekeepingTask.SourceType.MID_STAY_RECURRING,
                source_id=task.source_id,
                unit_type=task.unit_type,
                unit_id=task.unit_id,
                unit_label=task.unit_label,
                status=HousekeepingTask.Status.DIRTY,
                recurrence_interval_days=task.recurrence_interval_days,
            )
```

---

## Part 8 — API Endpoints

### 8.1 Activities

All endpoints require `IsAuthenticated`. Queryset scoped via `request.user.marina`.

**`apps/activities/urls.py`**

```python
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import ActivityViewSet, ActivityBookingViewSet, CancellationPolicyViewSet

router = DefaultRouter()
router.register('catalogue',             ActivityViewSet,            basename='activity')
router.register('bookings',              ActivityBookingViewSet,     basename='activity-booking')
router.register('cancellation-policies', CancellationPolicyViewSet,  basename='cancellation-policy')

urlpatterns = [path('', include(router.urls))]
```

**`ActivityViewSet`** — standard CRUD (`list`, `retrieve`, `create`, `partial_update`). Add custom action:
- `@action(detail=True, methods=['get'])` `availability(request, pk)` — calls `get_activity_availability()`, returns slot list with `bookable`, `capacity_remaining`, `instructor_available`, `equipment_available` fields.

**`ActivityBookingViewSet`** — standard CRUD. `perform_create()` delegates to `book_activity_session()`. Handle `SeasonWarning` → return `400` with `{ "season_warning": true, "message": "..." }` so frontend can show confirmation prompt. Handle `ResourceUnavailable` → return `409`. Custom actions:
- `@action(detail=True, methods=['post'])` `cancel(request, pk)` — calls `cancel_activity_booking()`.

**Inline nested serializers:** `ActivityBookingSerializer` must accept `participants` (list of `{name, age, customer_type}`) and `extras` (list of `{extra_id, quantity}`) in the create payload. Use `write_only=True` fields; create these after the booking in `perform_create`.

**Key validation in `perform_create`:**

```python
def perform_create(self, serializer):
    marina = self.request.user.marina
    activity = serializer.validated_data['activity']
    season_override = serializer.validated_data.get('season_override', False)
    ...
    try:
        booking = book_activity_session(marina=marina, ...)
    except SeasonWarning as e:
        raise ValidationError({'season_warning': True, 'detail': str(e)})
    except ResourceUnavailable as e:
        raise ValidationError({'detail': str(e)}, code=status.HTTP_409_CONFLICT)
```

### 8.2 Housekeeping

All endpoints require `IsAuthenticated`. Queryset scoped via `request.user.marina`.

**`apps/housekeeping/urls.py`**

```python
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import (
    HousekeepingTaskViewSet, HousekeepingMatrixView,
    ChecklistTemplateViewSet, LinenInventoryViewSet, ConsumableStockViewSet,
)

router = DefaultRouter()
router.register('tasks',               HousekeepingTaskViewSet,    basename='housekeeping-task')
router.register('checklist-templates', ChecklistTemplateViewSet,   basename='checklist-template')
router.register('linen',               LinenInventoryViewSet,       basename='linen-inventory')
router.register('consumables',         ConsumableStockViewSet,      basename='consumable-stock')

urlpatterns = [
    path('', include(router.urls)),
    path('matrix/', HousekeepingMatrixView.as_view(), name='housekeeping-matrix'),
]
```

**`HousekeepingTaskViewSet`** — standard CRUD with filters: `status`, `unit_type`, `date` (filter on `triggered_at__date`), `assigned_to`. Custom actions:
- `@action(detail=True, methods=['post'])` `advance(request, pk)` — calls `advance_task_status()`. On transition to `clean`, calls `mark_linen_dirty()` if applicable.
- `@action(detail=True, methods=['post'], parser_classes=[MultiPartParser])` `photos(request, pk)` — creates `TaskPhoto`.
- `@action(detail=True, methods=['post'])` `escalate_defect(request, pk)` — calls `escalate_to_defect()`. Accepts `{ description, severity }`.

**`HousekeepingMatrixView`** — `APIView`, not a ViewSet. Query params: `?from=YYYY-MM-DD&to=YYYY-MM-DD`. Queries all `HousekeepingTask` records within the date range. Groups by `unit_id`. Builds the matrix dict as specified in the API contract. Returns the matrix JSON response. Note: this view does a cross-product of units × dates — use efficient queryset evaluation (`values()` + `annotate()` rather than Python-level nested loops over large datasets).

**Matrix response structure:**

```python
{
  "dates": ["2026-07-15", ...],
  "units": [
    {
      "unit_id": "vessel-42",
      "unit_label": "Sea Sprite",
      "unit_type": "vessel",
      "cells": {
        "2026-07-15": { "task_id": 101, "status": "dirty", "assigned_to": "Maria L." },
        "2026-07-16": { "task_id": null, "status": null, "assigned_to": null },
      }
    }
  ]
}
```

**`LinenInventoryViewSet`** — `list`, `retrieve`, `partial_update`. The `PATCH` endpoint (for laundry-return qty updates) must use `F()` expressions — not direct field assignment. Example:

```python
def perform_update(self, serializer):
    instance = self.get_object()
    qty_clean_delta = self.request.data.get('qty_clean_delta', 0)
    qty_dirty_delta = self.request.data.get('qty_dirty_delta', 0)
    with transaction.atomic():
        LinenInventory.objects.filter(pk=instance.pk).update(
            qty_clean=F('qty_clean') + qty_clean_delta,
            qty_dirty=F('qty_dirty') + qty_dirty_delta,
        )
```

**`ConsumableStockViewSet`** — standard CRUD. Stock depletion is recorded via `ConsumableUsage` creation (linked to a task), not a direct PATCH on `qty_on_hand`. The PATCH endpoint is for manual stock replenishment only (receiving a delivery).

---

## Part 9 — Admin

### `apps/activities/admin.py`

```python
from django.contrib import admin
from .models import (
    Activity, ActivityPricingRule, ActivityResourceRequirement,
    ActivityExtra, ActivityBooking, ActivityBookingParticipant,
    ActivityBookingExtra, CancellationPolicy, AssetReservation,
)

class ActivityPricingRuleInline(admin.TabularInline):
    model = ActivityPricingRule
    extra = 0

class ActivityResourceRequirementInline(admin.TabularInline):
    model = ActivityResourceRequirement
    extra = 0

class ActivityExtraInline(admin.TabularInline):
    model = ActivityExtra
    extra = 0

@admin.register(Activity)
class ActivityAdmin(admin.ModelAdmin):
    list_display  = ['name', 'marina', 'category', 'is_active', 'duration_minutes', 'capacity_max']
    list_filter   = ['category', 'is_active']
    search_fields = ['name']
    inlines       = [ActivityPricingRuleInline, ActivityResourceRequirementInline, ActivityExtraInline]

class ActivityBookingParticipantInline(admin.TabularInline):
    model = ActivityBookingParticipant
    extra = 0

@admin.register(ActivityBooking)
class ActivityBookingAdmin(admin.ModelAdmin):
    list_display  = ['pk', 'activity', 'marina', 'start_datetime', 'status', 'participant_count']
    list_filter   = ['status', 'payment_mode']
    search_fields = ['lead_name', 'lead_email']
    inlines       = [ActivityBookingParticipantInline]
    readonly_fields = ['invoice', 'created_at']

admin.site.register(CancellationPolicy)
admin.site.register(AssetReservation)
```

### `apps/housekeeping/admin.py`

```python
from django.contrib import admin
from .models import (
    HousekeepingTask, ChecklistItem, TaskChecklistCompletion,
    TaskPhoto, LinenSet, LinenInventory, ConsumableStock, ConsumableUsage,
)

class TaskChecklistCompletionInline(admin.TabularInline):
    model = TaskChecklistCompletion
    extra = 0

class TaskPhotoInline(admin.TabularInline):
    model = TaskPhoto
    extra = 0

@admin.register(HousekeepingTask)
class HousekeepingTaskAdmin(admin.ModelAdmin):
    list_display  = ['pk', 'unit_label', 'unit_type', 'status', 'priority',
                     'assigned_to', 'target_ready_by']
    list_filter   = ['status', 'priority', 'unit_type', 'source_type']
    search_fields = ['unit_label']
    inlines       = [TaskChecklistCompletionInline, TaskPhotoInline]

@admin.register(LinenInventory)
class LinenInventoryAdmin(admin.ModelAdmin):
    list_display = ['marina', 'linen_set', 'qty_clean', 'qty_dirty', 'laundry_threshold']

admin.site.register(ChecklistItem)
admin.site.register(LinenSet)
admin.site.register(ConsumableStock)
admin.site.register(ConsumableUsage)
```

---

## Part 10 — Settings & URL Wiring

### 10.1 `config/settings/base.py` — LOCAL_APPS additions

```python
LOCAL_APPS = [
    # ... existing entries ...
    'apps.activities',
    'apps.housekeeping',
    'django.contrib.postgres',   # required for DateTimeRangeField and ExclusionConstraint
]
```

`django.contrib.postgres` must be in `INSTALLED_APPS` for `DateTimeRangeField` to work.

### 10.2 `config/urls.py` — new include entries

```python
path('activities/',   include('apps.activities.urls')),
path('housekeeping/', include('apps.housekeeping.urls')),
```

Add within the existing `api/v1/` block.

### 10.3 New settings keys

```python
# Feature flag for charter-checkout housekeeping trigger (activates after Track 9 merges)
HOUSEKEEPING_CHARTER_TRIGGER_ENABLED = os.environ.get('HOUSEKEEPING_CHARTER_TRIGGER_ENABLED', 'False') == 'True'
```

---

## Part 11 — Migration Notes

1. **`django.contrib.postgres`** must be added to `INSTALLED_APPS` before running migrations that use `DateTimeRangeField` or `ExclusionConstraint`.

2. **`apps/activities/` migration 0001:** Before the `CreateModel AssetReservation` operation, the migration must include:
   ```python
   migrations.RunSQL("CREATE EXTENSION IF NOT EXISTS btree_gist;"),
   ```
   The `ExclusionConstraint` on `AssetReservation` requires PostgreSQL's `btree_gist` extension. Without this, `migrate` will raise a `ProgrammingError`. Verify the extension is available on the target PostgreSQL instance (it is included in standard PostgreSQL distributions but must be explicitly enabled per database).

3. **`apps/housekeeping/` migration 0001:** Standard additive migration. No special steps required.

4. Both apps have FK dependencies on `accounts.Marina`, `members.Member`, `staff.StaffMember`, `maintenance.Asset`, `billing.ChargeableItem`, `billing.Invoice`. All of these are already migrated. Run `makemigrations activities` and `makemigrations housekeeping` after all existing apps are migrated.

5. **Migration order:** `activities` before `housekeeping` (housekeeping has no FK to activities, so order doesn't strictly matter, but activities first is conventional).

---

## Part 12 — Management Commands

### `apps/activities/management/commands/sweep_expired_bookings.py`

Manual runner for `sweep_expired_direct_bookings` task.

### `apps/housekeeping/management/commands/generate_recurring_tasks.py`

Manual runner for `generate_recurring_housekeeping_tasks` task.

### `apps/housekeeping/management/commands/backfill_housekeeping_tasks.py`

Post-Track-9-merge: scans past `CharterBooking` checkouts that occurred before `HOUSEKEEPING_CHARTER_TRIGGER_ENABLED` was set to True, and creates `HousekeepingTask` records for them. This command is written now but only run after Track 9 merges. It must be idempotent: check for existing tasks with `source_type='charter_checkout'` and `source_id=charter_booking_id` before creating.

---

## Part 13 — Implementation Order (Numbered Steps)

Execute in this exact order. Each step is independently verifiable.

**Phase A — Backend: Activities**

1. **Add `django.contrib.postgres` to `INSTALLED_APPS`.** Verify `python manage.py check` passes.

2. **Scaffold `apps/activities/`.** Create `__init__.py`, `apps.py`, `migrations/__init__.py`, empty `models.py`, `urls.py`, `views.py`, `serializers.py`, `admin.py`, `signals.py`. Register `'apps.activities'` in `LOCAL_APPS`. Add `path('activities/', include('apps.activities.urls'))` to `config/urls.py`. Run `python manage.py check`.

3. **Write all Activities models** in `apps/activities/models.py` in this order: `CancellationPolicy`, `Activity`, `ActivityPricingRule`, `ActivityResourceRequirement`, `ActivityExtra`, `ActivityBooking`, `ActivityBookingParticipant`, `ActivityBookingExtra`, `AssetReservation`. Run `makemigrations activities`. Edit the generated migration file to insert `migrations.RunSQL("CREATE EXTENSION IF NOT EXISTS btree_gist;")` immediately before the `CreateModel` for `AssetReservation`. Run `migrate`. Verify via `python manage.py shell` that `AssetReservation.objects.all()` executes without error.

4. **Write `apps/activities/services/availability.py`.** Implement `check_instructor_availability()` (datetime overlap, not date-only) and `check_asset_availability()` (using `time_range__overlap`, not range filter). Write unit tests: (a) assert two overlapping bookings for the same instructor are caught; (b) assert a booking exactly after an existing booking is NOT caught; (c) assert date-only comparison would have missed a same-day conflict (demonstrates why datetime overlap is required).

5. **Write `apps/activities/services/billing.py`.** Implement `create_activity_invoice()`, `recalculate_activity_invoice()`, `compute_cancellation_refund()`. Unit test: group discount correctly applies at threshold and is absent below threshold.

6. **Write `apps/activities/services/booking.py`.** Implement `book_activity_session()` with atomic create sequence. Unit test: simulate two concurrent requests trying to reserve the same asset — verify one gets an `IntegrityError` from the `ExclusionConstraint` and the other succeeds cleanly.

7. **Write `apps/activities/services/cancellation.py`.** Implement `cancel_activity_booking()`. Unit test: verify each cancellation policy tier (full refund, partial refund, no refund) returns correct amount.

8. **Write `apps/activities/signals.py`.** Implement `on_shift_modified` and `on_participant_count_changed`. Register in `apps/activities/apps.py` `ready()`. Unit test: delete a `Shift` covering a confirmed `ActivityBooking` → assert `assigned_instructor` is cleared and alert is fired.

9. **Write `apps/activities/serializers.py`.** `ActivitySerializer` with nested `pricing_rules`, `resource_requirements`, `extras`. `ActivityBookingSerializer` with `participants` and `booking_extras` write-only list fields; read representation shows full detail. `CancellationPolicySerializer`. `AssetReservationSerializer`.

10. **Write `apps/activities/views.py`.** `ActivityViewSet` with `availability` custom action. `ActivityBookingViewSet` with `cancel` custom action. `CancellationPolicyViewSet`. Register routers in `urls.py`.

11. **Write `apps/activities/admin.py`.** Register all models with appropriate inlines.

12. **Write `apps/activities/tasks.py`.** `sweep_expired_direct_bookings` Celery task. Write `apps/activities/management/commands/sweep_expired_bookings.py` management command as manual runner. Integration test: create a booking with `expires_at = now() - timedelta(minutes=1)`, run command, assert `AssetReservation` deleted and `Invoice` voided.

**Phase B — Backend: Housekeeping**

13. **Scaffold `apps/housekeeping/`.** Same pattern as step 2. Register in `LOCAL_APPS` and `config/urls.py`.

14. **Write all Housekeeping models** in `apps/housekeeping/models.py` in this order: `HousekeepingTask`, `ChecklistItem`, `TaskChecklistCompletion`, `TaskPhoto`, `LinenSet`, `LinenInventory`, `ConsumableStock`, `ConsumableUsage`. Run `makemigrations housekeeping`. Run `migrate`.

15. **Write `apps/housekeeping/services.py`.** Implement `mark_linen_dirty()` (F() + select_for_update + existence guard), `escalate_to_defect()`, `populate_task_checklist()`, `advance_task_status()`. Unit test: simulate 10 concurrent calls to `mark_linen_dirty()` — verify `qty_dirty` is correct and only one laundry task is created.

16. **Write `apps/housekeeping/signals.py`.** Implement `on_charter_checkout()` with feature flag guard. Wire conditional import in `apps/housekeeping/apps.py` `ready()`.

17. **Write `apps/housekeeping/serializers.py`.** `HousekeepingTaskSerializer` with nested `checklist` and `photos` on detail read (use `depth=1` or explicit nested serializer). `ChecklistItemSerializer`. `LinenInventorySerializer`. `ConsumableStockSerializer`.

18. **Write `apps/housekeeping/views.py`.** `HousekeepingTaskViewSet` with `advance`, `photos`, `escalate_defect` actions. `HousekeepingMatrixView` as `APIView` using efficient `values()` queryset. `ChecklistTemplateViewSet`. `LinenInventoryViewSet` with `F()`-based PATCH. `ConsumableStockViewSet`. Register in `urls.py`.

19. **Write `apps/housekeeping/admin.py`.** Register all models with inlines.

20. **Write `apps/housekeeping/tasks.py`.** `generate_recurring_housekeeping_tasks` Celery task. Write management commands: `generate_recurring_tasks`, `backfill_housekeeping_tasks`.

**Phase C — Settings & Integration**

21. **Add `HOUSEKEEPING_CHARTER_TRIGGER_ENABLED` to `base.py`** (default `False`). Add to `.env`.

22. **Add `sweep_expired_direct_bookings` to Celery Beat schedule** (every 5 minutes) and `generate_recurring_housekeeping_tasks` (daily) once Celery is wired.

23. **Run full test suite.** Ensure no regressions in `billing`, `reservations`, `maintenance`, or `staff` apps from new FK relationships.

**Phase D — Frontend: Activities** (steps 24–27, post-backend)

24. **Create data hooks:** `hooks/useActivities.js`, `hooks/useActivityBookings.js`, `hooks/useCancellationPolicies.js`.

25. **Build `ActivitiesScreen.jsx`** with `Catalogue` and `Bookings` tab shell. Add `Activities` to sidebar under Operations group, below Events.

26. **Build `CatalogueTab.jsx`** with `ActivityCard.jsx` grid and `ActivityFormDrawer.jsx` (pricing table for member/guest/child, group discount fields, resource requirement rows, extras list, cancellation policy dropdown).

27. **Build `BookingsTab.jsx`** with `ActivityCalendar.jsx` (week view, coloured pills), `BookingFormDrawer.jsx` (4-step wizard: availability check → participants → extras+payment → confirm with season-override banner), `BookingDetailDrawer.jsx` with cancel button showing computed refund.

**Phase E — Frontend: Housekeeping** (steps 28–31, post-backend)

28. **Create data hooks:** `hooks/useHousekeepingTasks.js`, `hooks/useHousekeepingMatrix.js`, `hooks/useLinenInventory.js`, `hooks/useConsumableStock.js`, `hooks/useChecklistTemplates.js`.

29. **Build `HousekeepingScreen.jsx`** with `Matrix` and `Tasks` tab shell. Add `Housekeeping` to sidebar under Operations group, below Activities.

30. **Build `HousekeepingMatrix.jsx`** — CSS grid with colour-coded cells (dirty=red, in_progress=amber, ready_inspection=blue, clean=teal, ready_guest=green, empty=light grey). Pulsing warning border for cells where `target_ready_by` is within 2 hours and status is not `ready_guest`. Cell click opens `TaskDetailDrawer`.

31. **Build `TaskListTab.jsx`** + `TaskDetailDrawer.jsx` (checklist checkboxes, before/after photo grid, consumable usage logging inline form, `[ Escalate to Maintenance ]` button). Build `MyTasksScreen.jsx` + `MobileTaskScreen.jsx` for PWA route `/housekeeping/my-tasks` with 4-digit PIN fast-switching (same pattern as Track 6 Forklift operators).

**Phase F — Integration & Track 9 wiring** (post Track 9 merge)

32. **Verify `charter_checkout_processed` signal payload** matches `on_charter_checkout` receiver signature in `housekeeping/signals.py`.

33. **Set `HOUSEKEEPING_CHARTER_TRIGGER_ENABLED=True`** in production settings.

34. **Run `backfill_housekeeping_tasks`** management command.
