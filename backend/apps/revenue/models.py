from decimal import Decimal
from django.db import models


class BookingTier(models.Model):
    """Base pricing matrix — berth category × season × booking type."""
    SEASON_CHOICES = [
        ('peak',      'Peak'),
        ('shoulder',  'Shoulder'),
        ('off',       'Off-Season'),
    ]
    BOOKING_TYPE_CHOICES = [
        ('transient', 'Transient'),
        ('seasonal',  'Seasonal'),
    ]

    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='booking_tiers'
    )
    berth_category = models.ForeignKey(
        'berths.BerthCategory',
        on_delete=models.CASCADE,
        related_name='booking_tiers',
    )
    season = models.CharField(max_length=20, choices=SEASON_CHOICES)
    booking_type = models.CharField(max_length=20, choices=BOOKING_TYPE_CHOICES, default='transient')
    base_nightly_rate = models.DecimalField(max_digits=10, decimal_places=2)
    min_stay_nights = models.IntegerField(default=1)

    class Meta:
        ordering = ['berth_category', 'season']
        unique_together = [('marina', 'berth_category', 'season', 'booking_type')]

    def __str__(self):
        return f'{self.berth_category} / {self.season} / {self.booking_type} — €{self.base_nightly_rate}/night'


class YieldRule(models.Model):
    """Dynamic pricing rule applied on top of the base BookingTier rate."""
    RULE_TYPE_CHOICES = [
        ('occupancy_threshold', 'Occupancy Threshold'),
        ('seasonal',            'Seasonal Date Range'),
        ('last_minute',         'Last-Minute Discount'),
        ('length_of_stay',      'Length-of-Stay Discount'),
        ('early_bird',          'Early Bird'),
    ]

    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='yield_rules'
    )
    name = models.CharField(max_length=200)
    rule_type = models.CharField(max_length=30, choices=RULE_TYPE_CHOICES)
    # parameters schema depends on rule_type:
    # occupancy_threshold: {"threshold_pct": 80, "apply_from_pct": 80}
    # seasonal:            {"start_month": 6, "end_month": 8}
    # last_minute:         {"days_before": 3}
    # length_of_stay:      {"min_nights": 7}
    # early_bird:          {"days_ahead": 60}
    parameters = models.JSONField(default=dict)
    multiplier = models.DecimalField(
        max_digits=5, decimal_places=4, default=Decimal('1.0000'),
        help_text='e.g. 1.20 = 20% surcharge, 0.85 = 15% discount',
    )
    priority = models.IntegerField(
        default=0,
        help_text='Higher priority rules are evaluated first. Only the first matching rule applies.',
    )
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-priority', 'name']

    def __str__(self):
        return f'{self.name} (×{self.multiplier})'


class YieldApplication(models.Model):
    """Immutable log of which yield rule (if any) was applied to a booking's price."""
    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='yield_applications'
    )
    booking = models.OneToOneField(
        'reservations.Booking', on_delete=models.CASCADE, related_name='yield_application'
    )
    rule = models.ForeignKey(
        YieldRule, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='applications',
    )
    base_price = models.DecimalField(max_digits=10, decimal_places=2)
    applied_price = models.DecimalField(max_digits=10, decimal_places=2)
    applied_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-applied_at']

    @property
    def discount_pct(self):
        if self.base_price == 0:
            return Decimal('0')
        return ((self.applied_price - self.base_price) / self.base_price * 100).quantize(Decimal('0.01'))

    def __str__(self):
        rule_name = self.rule.name if self.rule else 'base rate'
        return f'YA-{self.pk} — BK-{self.booking_id} @ {rule_name} (€{self.applied_price})'


class WaitlistEntry(models.Model):
    """Member waiting for any available berth matching their vessel's requirements."""
    PRIORITY_CHOICES = [
        ('high',   'High'),
        ('normal', 'Normal'),
        ('low',    'Low'),
    ]

    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='waitlist_entries'
    )
    member = models.ForeignKey(
        'members.Member', on_delete=models.CASCADE, related_name='waitlist_entries'
    )
    vessel = models.ForeignKey(
        'vessels.Vessel', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='waitlist_entries',
    )
    # Desired dates
    desired_from = models.DateField()
    desired_to = models.DateField(null=True, blank=True)  # null = open-ended / seasonal contract
    booking_type = models.CharField(
        max_length=20,
        choices=[('transient', 'Transient'), ('seasonal', 'Seasonal')],
        default='seasonal',
    )
    # Vessel dimensions at time of entry (snapshot, vessel may be updated later)
    vessel_loa = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    vessel_beam = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    vessel_draft = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    notes = models.TextField(blank=True)
    priority_score = models.IntegerField(
        default=0,
        help_text='Computed score: higher = gets offered first when a berth frees up.',
    )
    is_active = models.BooleanField(default=True)
    fulfilled_booking = models.OneToOneField(
        'reservations.Booking', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='waitlist_source',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-priority_score', 'created_at']

    def __str__(self):
        return f'WL-{self.pk} — {self.member} from {self.desired_from}'
