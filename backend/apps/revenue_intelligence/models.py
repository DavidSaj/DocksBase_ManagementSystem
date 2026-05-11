from django.db import models


# ---------------------------------------------------------------------------
# BookingTier
# ---------------------------------------------------------------------------

class BookingTier(models.Model):
    """Named tiers for berths that carry a rate premium (e.g. Premium, Standard)."""

    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='ri_booking_tiers'
    )
    name = models.CharField(max_length=100)
    display_order = models.PositiveSmallIntegerField(default=0)
    rate_premium_pct = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['display_order', 'name']
        unique_together = [('marina', 'name')]

    def __str__(self):
        return f'{self.name} ({self.marina_id})'


# ---------------------------------------------------------------------------
# YieldRule
# ---------------------------------------------------------------------------

class YieldRule(models.Model):
    """Dynamic pricing rule applied by the YieldEngine at booking time."""

    class TriggerType(models.TextChoices):
        OCCUPANCY_THRESHOLD = 'occupancy_threshold', 'Occupancy Threshold'
        DAYS_TO_ARRIVAL = 'days_to_arrival', 'Days to Arrival'
        DAYS_IN_ADVANCE = 'days_in_advance', 'Days in Advance'
        GAP_FILL = 'gap_fill', 'Gap Fill'

    class ActionType(models.TextChoices):
        PERCENT_UPLIFT = 'percent_uplift', 'Percent Uplift'
        PERCENT_DISCOUNT = 'percent_discount', 'Percent Discount'
        FIXED_UPLIFT = 'fixed_uplift', 'Fixed Uplift'
        FIXED_DISCOUNT = 'fixed_discount', 'Fixed Discount'

    class OccupancyScope(models.TextChoices):
        TIER = 'tier', 'Tier'
        MARINA = 'marina', 'Marina'

    class PricingModelScope(models.TextChoices):
        PER_NIGHT = 'per_night', 'Per Night'
        PER_HOUR = 'per_hour', 'Per Hour'
        ALL = 'all', 'All'

    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='ri_yield_rules'
    )
    name = models.CharField(max_length=200)
    booking_tier = models.ForeignKey(
        BookingTier,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='rules',
    )
    trigger_type = models.CharField(max_length=30, choices=TriggerType.choices)
    action_type = models.CharField(max_length=30, choices=ActionType.choices)
    action_value = models.DecimalField(max_digits=8, decimal_places=2)

    # Occupancy trigger params
    occupancy_scope = models.CharField(
        max_length=20, choices=OccupancyScope.choices, blank=True
    )
    occupancy_threshold_pct = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True
    )

    # Days-to-arrival trigger param
    days_to_arrival_lte = models.IntegerField(null=True, blank=True)

    # Days-in-advance trigger param
    days_in_advance_gte = models.IntegerField(null=True, blank=True)

    # Gap-fill trigger param
    gap_max_nights = models.IntegerField(null=True, blank=True)

    # Floor / ceiling constraints
    floor_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    ceiling_price = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    pricing_model_scope = models.CharField(
        max_length=20,
        choices=PricingModelScope.choices,
        default=PricingModelScope.ALL,
    )

    # Validity window
    valid_from = models.DateField(null=True, blank=True)
    valid_until = models.DateField(null=True, blank=True)

    # Restrict rule to a specific booking type; empty string means "all types"
    applies_to_booking_type = models.CharField(
        max_length=30, blank=True, default='',
        help_text='Booking type this rule applies to, e.g. "transient". Empty = all types.',
    )

    priority = models.IntegerField(default=10)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['priority', 'name']

    def __str__(self):
        return f'{self.name} [{self.trigger_type}]'


# ---------------------------------------------------------------------------
# YieldApplication
# ---------------------------------------------------------------------------

class YieldApplication(models.Model):
    """Audit record for every time the YieldEngine modified a booking price."""

    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='ri_yield_applications'
    )
    booking = models.ForeignKey(
        'reservations.Booking', on_delete=models.CASCADE, related_name='yield_applications'
    )
    rule = models.ForeignKey(
        YieldRule, on_delete=models.SET_NULL, null=True, blank=True
    )
    rule_name_snapshot = models.CharField(max_length=200, blank=True)
    base_price = models.DecimalField(max_digits=10, decimal_places=2)
    computed_price = models.DecimalField(max_digits=10, decimal_places=2)
    floor_ceiling_clamped = models.BooleanField(default=False)
    applied_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-applied_at']

    def __str__(self):
        return f'YieldApplication booking={self.booking_id} rule={self.rule_name_snapshot}'


# ---------------------------------------------------------------------------
# HourlyBerthConfig
# ---------------------------------------------------------------------------

class HourlyBerthConfig(models.Model):
    """Per-berth configuration for hourly berthing pricing."""

    class IncrementMinutes(models.TextChoices):
        FIFTEEN = '15', '15 minutes'
        THIRTY = '30', '30 minutes'
        SIXTY = '60', '1 hour'
        TWO_FORTY = '240', '4 hours'

    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='hourly_berth_configs'
    )
    berth = models.OneToOneField(
        'berths.Berth', on_delete=models.CASCADE, related_name='hourly_config'
    )
    min_duration_minutes = models.IntegerField(default=60)
    max_duration_minutes = models.IntegerField(default=480)
    increment_minutes = models.CharField(
        max_length=5,
        choices=IncrementMinutes.choices,
        default=IncrementMinutes.SIXTY,
    )
    pricing_item = models.ForeignKey(
        'billing.ChargeableItem',
        on_delete=models.PROTECT,
        related_name='hourly_berth_configs',
    )
    # Comma-separated booking types that may use hourly berthing, e.g. "transient,seasonal"
    eligible_booking_types = models.CharField(
        max_length=200, default='transient', blank=True,
        help_text='Comma-separated booking types eligible for hourly pricing.',
    )
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return f'HourlyConfig berth={self.berth_id}'


# ---------------------------------------------------------------------------
# UpgradeCampaign
# ---------------------------------------------------------------------------

class UpgradeCampaign(models.Model):
    """An upgrade offer sent to a boater to move them to a better berth/tier."""

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        ACCEPTED = 'accepted', 'Accepted'
        DECLINED = 'declined', 'Declined'
        EXPIRED = 'expired', 'Expired'

    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='upgrade_campaigns'
    )
    booking = models.ForeignKey(
        'reservations.Booking', on_delete=models.CASCADE, related_name='upgrade_campaigns'
    )
    from_tier = models.ForeignKey(
        BookingTier,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='from_campaigns',
    )
    to_tier = models.ForeignKey(
        BookingTier,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='to_campaigns',
    )
    offered_berth = models.ForeignKey(
        'berths.Berth',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='upgrade_campaigns',
    )
    differential_amount = models.DecimalField(max_digits=10, decimal_places=2)
    checkout_link = models.URLField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    sent_at = models.DateTimeField(null=True, blank=True)
    responded_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'UpgradeCampaign booking={self.booking_id} status={self.status}'


# ---------------------------------------------------------------------------
# UpsellOffer
# ---------------------------------------------------------------------------

class UpsellOffer(models.Model):
    """A targeted add-on offer (e.g. electric hook-up, pump-out) tied to a booking."""

    class TriggerEvent(models.TextChoices):
        BOOKING_QUOTE = 'booking_quote', 'Booking Quote'
        CHECK_IN = 'check_in', 'Check In'
        MID_STAY = 'mid_stay', 'Mid Stay'
        MANUAL = 'manual', 'Manual'

    class Status(models.TextChoices):
        SENT = 'sent', 'Sent'
        REDEEMED = 'redeemed', 'Redeemed'
        EXPIRED = 'expired', 'Expired'

    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='upsell_offers'
    )
    booking = models.ForeignKey(
        'reservations.Booking', on_delete=models.CASCADE, related_name='upsell_offers'
    )
    chargeable_item = models.ForeignKey(
        'billing.ChargeableItem',
        on_delete=models.PROTECT,
        related_name='upsell_offers',
    )
    trigger_event = models.CharField(max_length=30, choices=TriggerEvent.choices)
    offer_text = models.TextField(blank=True)
    discount_pct = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SENT)
    sent_at = models.DateTimeField(null=True, blank=True)
    redeemed_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True)
    invoice_line_item = models.ForeignKey(
        'billing.InvoiceLineItem',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='upsell_offers',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'UpsellOffer booking={self.booking_id} item={self.chargeable_item_id}'


# ---------------------------------------------------------------------------
# WaitlistEntry
# ---------------------------------------------------------------------------

class WaitlistEntry(models.Model):
    """A guest who wants to be notified when a berth becomes available."""

    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='ri_waitlist_entries'
    )
    email = models.EmailField()
    name = models.CharField(max_length=200, blank=True)
    vessel_length_m = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True
    )
    booking_tier = models.ForeignKey(
        BookingTier,
        on_delete=models.SET_NULL,
        null=True, blank=True,
    )
    desired_check_in = models.DateField(null=True, blank=True)
    desired_check_out = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'WaitlistEntry {self.email} marina={self.marina_id}'


# ---------------------------------------------------------------------------
# WaitlistOffer
# ---------------------------------------------------------------------------

class WaitlistOffer(models.Model):
    """A concrete berth offer sent to a WaitlistEntry."""

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending'
        CLAIMED = 'claimed', 'Claimed'
        EXPIRED = 'expired', 'Expired'

    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='waitlist_offers'
    )
    waitlist_entry = models.ForeignKey(
        WaitlistEntry, on_delete=models.CASCADE, related_name='offers'
    )
    berth = models.ForeignKey(
        'berths.Berth', on_delete=models.CASCADE, related_name='waitlist_offers'
    )
    check_in = models.DateField()
    check_out = models.DateField()
    discounted_price = models.DecimalField(max_digits=10, decimal_places=2)
    stripe_checkout_url = models.URLField(blank=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    sent_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)
    claimed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'WaitlistOffer berth={self.berth_id} status={self.status}'


# ---------------------------------------------------------------------------
# CompetitorRate
# ---------------------------------------------------------------------------

class CompetitorRate(models.Model):
    """A competitor marina's nightly rate, entered manually or scraped."""

    class Source(models.TextChoices):
        MANUAL = 'manual', 'Manual'
        SCRAPER = 'scraper', 'Scraper'

    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='competitor_rates'
    )
    competitor_name = models.CharField(max_length=200)
    competitor_url = models.URLField(blank=True)
    vessel_length_m = models.DecimalField(
        max_digits=6, decimal_places=2, null=True, blank=True
    )
    rate_per_night = models.DecimalField(max_digits=10, decimal_places=2)
    valid_from = models.DateField(null=True, blank=True)
    valid_until = models.DateField(null=True, blank=True)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.MANUAL)
    scraped_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.competitor_name} {self.rate_per_night}/night'
