from django.db import models
from django.contrib.postgres.constraints import ExclusionConstraint
from django.contrib.postgres.fields import DateTimeRangeField, RangeOperators


class CancellationPolicy(models.Model):
    marina               = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                             related_name='cancellation_policies')
    name                 = models.CharField(max_length=200)
    full_refund_hours    = models.PositiveIntegerField(default=48)
    partial_refund_hours = models.PositiveIntegerField(default=24)
    partial_refund_pct   = models.DecimalField(max_digits=5, decimal_places=2, default=50)
    # Tier 3 (no refund) is implied: cancellation within partial_refund_hours of start
    is_default           = models.BooleanField(default=False)

    def __str__(self):
        return self.name


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


class ActivityResourceRequirement(models.Model):
    class ResourceType(models.TextChoices):
        INSTRUCTOR = 'instructor', 'Instructor (Staff)'
        ASSET      = 'asset',      'Equipment Asset'

    activity          = models.ForeignKey(Activity, on_delete=models.CASCADE,
                                           related_name='resource_requirements')
    resource_type     = models.CharField(max_length=20, choices=ResourceType.choices)

    # Instructor requirements
    required_role     = models.CharField(max_length=100, blank=True)
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


class ActivityExtra(models.Model):
    activity        = models.ForeignKey(Activity, on_delete=models.CASCADE, related_name='extras')
    name            = models.CharField(max_length=200)
    chargeable_item = models.ForeignKey(
        'billing.ChargeableItem', on_delete=models.PROTECT, related_name='activity_extras'
    )
    is_active       = models.BooleanField(default=True)


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


class ActivityBookingExtra(models.Model):
    booking  = models.ForeignKey(ActivityBooking, on_delete=models.CASCADE,
                                  related_name='booking_extras')
    extra    = models.ForeignKey(ActivityExtra, on_delete=models.PROTECT)
    quantity = models.PositiveIntegerField(default=1)


class AssetReservation(models.Model):
    """
    Reserves an equipment asset for a specific time window.

    The ExclusionConstraint on (asset, time_range) prevents double-booking at the
    database level. The btree_gist extension must be enabled before the migration runs.
    See INSTALL.md for the migration RunSQL step.

    Service-layer note: check_asset_availability() in services/availability.py performs
    a Python-level overlap check BEFORE attempting the insert. The ExclusionConstraint
    is the final hard guard that catches any race conditions.
    """
    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                          related_name='asset_reservations')
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
                # Upgrade path: add condition=Q(activity_booking__status='confirmed')
                # in Django 4.2+ to exclude cancelled bookings from the constraint.
                # This allows re-booking the same asset in the same window after cancellation.
            )
        ]
        indexes = [
            models.Index(fields=['asset']),
        ]

    def __str__(self):
        return f'Reservation: {self.asset} @ {self.time_range}'


class ActivityTimeSlot(models.Model):
    """
    Weekly recurring slot template for an activity.

    The public booking surface materialises concrete dated slots on demand by
    walking forward from today and emitting one slot per matching weekday inside
    the activity's season window. Templates are not pre-expanded into rows.
    """
    class Weekday(models.IntegerChoices):
        MON = 0, 'Monday'
        TUE = 1, 'Tuesday'
        WED = 2, 'Wednesday'
        THU = 3, 'Thursday'
        FRI = 4, 'Friday'
        SAT = 5, 'Saturday'
        SUN = 6, 'Sunday'

    activity   = models.ForeignKey(Activity, on_delete=models.CASCADE, related_name='time_slots')
    weekday    = models.IntegerField(choices=Weekday.choices)
    start_time = models.TimeField()
    is_active  = models.BooleanField(default=True)

    class Meta:
        unique_together = [('activity', 'weekday', 'start_time')]
        ordering = ['weekday', 'start_time']

    def __str__(self):
        return f'{self.activity.name} {self.get_weekday_display()} {self.start_time:%H:%M}'
