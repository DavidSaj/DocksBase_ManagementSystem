# Track 1 — Revenue Intelligence & Dynamic Pricing: Design Spec
Date: 2026-05-07
Scope: Demand-based pricing engine (yield rules, floor/ceiling, last-minute discounts, gap-fill), pacing & forecasting reports (ADR, RevPAB, pacing curves, deferred revenue schedule), upsell/upgrade campaigns (booking tier system, AI upgrade offers, in-stay upsell), and part-day/hourly booking support.

> Spec status: Final — reviewed 2026-05-08

---

## 1. Architectural Goal

The Revenue Intelligence track adds a yield and forecasting layer on top of the existing `ChargeableItem`-based pricing foundation. The central invariant is preserved: **every charge must ultimately resolve to an `InvoiceLineItem` that points to a `ChargeableItem`**. The yield engine never bypasses this chain — it computes an effective price at booking time, creates a temporary or overridden `ChargeableItem` record (or an adjustment line), and writes the result through the standard billing pipeline.

Three capability areas are introduced:

1. **Yield Engine** — `YieldRule` records define when the engine should move prices up or down. At booking-creation time, the engine evaluates all active rules for the berth/category and returns the effective unit price using a **first-match** strategy: rules are evaluated in priority order and the first matching rule wins — no stacking. The engine always respects configured floor and ceiling bounds. The result is recorded on the `Booking` as `dynamic_price_applied` (a decimal override) and on the `InvoiceLineItem` as an audit trail. Yield rules are hard-guarded at the engine level to apply **to transient bookings only** — they never fire for seasonal or annual contracts regardless of UI configuration.

2. **Revenue Analytics** — a new `reports` sub-module (`revenue_intelligence`) that exposes ADR, RevPAB, pacing, deferred-revenue, and competitor benchmarking endpoints. The ADR and RevPAB calculations include only bookings with status `confirmed`, `checked_in`, or `checked_out`. Pending and pending-approval bookings appear exclusively in the forecasting tab as tentative revenue. No new persisted aggregate tables are introduced in v1. All queries run against existing `Booking`, `Invoice`, and `InvoiceLineItem` records.

3. **Upsell & Upgrade Campaigns** — `BookingTier` records group berths into commercial grades (Standard / Premium / Superyacht). `UpgradeCampaign` records are generated automatically by a nightly background task (see §3.5 and §6). In-stay upsell is handled via the public booking flow's quote screen (see §3.6 and §5.7). A `UpsellOffer` model records what was offered and what was redeemed.

4. **Part-Day / Hourly Bookings** — the existing `Booking` model is extended with `start_time` / `end_time` fields and a new `duration_minutes` computed property. Sub-hour pricing is calculated as a fraction of the `per_hour` unit price (e.g. 45 minutes = `unit_price × 0.75`). No new `PricingModel` choice is added to `ChargeableItem`. An `HourlySlot` config per `Berth` defines minimum/maximum duration and eligible booking types.

5. **Competitor Benchmarking** — a `CompetitorRate` model is introduced in v1 to record manually entered or automatically scraped rates from rival marinas. A lightweight weekly scraper populates these records. Competitor rates are surfaced as a reference overlay on the ADR analytics chart.

6. **Waitlist Sniper (Gap-Fill & Last-Minute Notification)** — when a gap-fill or last-minute yield rule fires, the system intercepts the booking, generates a cryptographic single-use checkout link (Stripe) with a 2-hour expiration, and emails all waitlist-eligible boaters (matching boat size) via Zoho SMTP. If no waitlist boater claims the berth within 2 hours, the discounted price is automatically applied to the public booking widget.

All new models live in a new Django app: `backend/apps/revenue_intelligence/`.

---

## 2. New Django App / Model Location

```
backend/apps/revenue_intelligence/
    __init__.py
    apps.py          # name = 'revenue_intelligence'
    models.py
    serializers.py
    views.py
    urls.py
    admin.py
    engine.py        # YieldEngine service class
    tasks.py         # background tasks (upgrade campaign cron, waitlist notifications)
    scraper.py       # competitor rate scraper
    migrations/
```

Register in `INSTALLED_APPS` as `'apps.revenue_intelligence'`.

Wire into the top-level URL conf:
```python
path('api/v1/revenue/', include('apps.revenue_intelligence.urls')),
```

---

## 3. Data Models

### 3.1 `BookingTier` (booking tier / grade system)

```python
class BookingTier(models.Model):
    """
    Defines commercial grades for berth groupings.
    e.g. Standard, Premium, Superyacht.
    Berths are tagged to at most one tier via a FK on Berth (added via migration).
    """
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                               related_name='booking_tiers')
    name = models.CharField(max_length=100)          # e.g. "Premium"
    display_order = models.PositiveSmallIntegerField(default=0)
    rate_premium_pct = models.DecimalField(           # % markup over base rate
        max_digits=5, decimal_places=2, default=0)    # e.g. 25.00 = +25%
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['display_order', 'name']
        unique_together = [('marina', 'name')]

    def __str__(self):
        return f'{self.name} (+{self.rate_premium_pct}%)'
```

> **Migration note:** Add `booking_tier = ForeignKey('revenue_intelligence.BookingTier', null=True, blank=True, on_delete=SET_NULL)` to `berths.Berth` in a separate migration on the `berths` app.

---

### 3.2 `YieldRule`

```python
class YieldRule(models.Model):
    """
    A single condition → action pricing rule evaluated by the yield engine.
    Rules are evaluated in priority order; the first matching rule wins (no stacking).
    Yield rules are enforced at the engine level for transient bookings only.
    The OCCUPANCY_THRESHOLD trigger evaluates occupancy scoped to the BookingTier
    defined on the rule (occupancy_scope='tier'). If no tier is set on the rule,
    marina-wide occupancy is used. The scope is configurable per rule.
    """

    class TriggerType(models.TextChoices):
        OCCUPANCY_THRESHOLD = 'occupancy_threshold', 'Occupancy % Threshold'
        DAYS_TO_ARRIVAL     = 'days_to_arrival',     'Days to Arrival (last-minute)'
        DAYS_IN_ADVANCE     = 'days_in_advance',     'Days in Advance (early-bird)'
        GAP_FILL            = 'gap_fill',            'Gap-Fill Window'

    class ActionType(models.TextChoices):
        PERCENT_UPLIFT   = 'percent_uplift',   'Percentage Uplift'
        PERCENT_DISCOUNT = 'percent_discount', 'Percentage Discount'
        FIXED_UPLIFT     = 'fixed_uplift',     'Fixed Amount Uplift'
        FIXED_DISCOUNT   = 'fixed_discount',   'Fixed Amount Discount'

    class OccupancyScope(models.TextChoices):
        TIER   = 'tier',   'BookingTier Scope'
        MARINA = 'marina', 'Marina-Wide'

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                               related_name='yield_rules')

    name = models.CharField(max_length=200)
    priority = models.PositiveSmallIntegerField(default=100)  # lower = evaluated first

    trigger_type = models.CharField(max_length=30, choices=TriggerType.choices)

    # --- Trigger parameters (used depending on trigger_type) ---
    # OCCUPANCY_THRESHOLD: fire when marina-wide or category occupancy >= this value
    occupancy_threshold_pct = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True)  # e.g. 80.00
    occupancy_scope = models.CharField(
        max_length=10, choices=OccupancyScope.choices, default=OccupancyScope.TIER,
        help_text='Whether to evaluate occupancy at the BookingTier level or marina-wide.')

    # DAYS_TO_ARRIVAL: fire when check_in is within this many days
    days_to_arrival_lte = models.PositiveSmallIntegerField(null=True, blank=True)  # e.g. 3

    # DAYS_IN_ADVANCE: fire when booking is made this many days before check_in
    # (early-bird: a booking made 30+ days in advance receives a discount)
    days_in_advance_gte = models.PositiveSmallIntegerField(null=True, blank=True)  # e.g. 30

    # GAP_FILL: fire when the gap between adjacent bookings on a berth is <= this
    gap_max_nights = models.PositiveSmallIntegerField(null=True, blank=True)  # e.g. 3

    # --- Scope (null = apply to all) ---
    booking_tier = models.ForeignKey(
        'BookingTier', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='yield_rules')  # null = all tiers
    # applies_to_booking_type is informational only; the engine hard-guards to 'transient'
    applies_to_booking_type = models.CharField(
        max_length=20, blank=True,
        choices=[('transient', 'Transient'), ('', 'All')])

    # --- Action ---
    action_type = models.CharField(max_length=30, choices=ActionType.choices)
    action_value = models.DecimalField(max_digits=10, decimal_places=2)
    # e.g. action_type=percent_uplift, action_value=15.00 → +15%

    # --- Guard rails ---
    floor_price = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True)  # never go below
    ceiling_price = models.DecimalField(
        max_digits=10, decimal_places=2, null=True, blank=True)  # never go above

    class PricingModelScope(models.TextChoices):
        PER_NIGHT = 'per_night', 'Per Night (overnight bookings)'
        PER_HOUR  = 'per_hour',  'Per Hour (sub-day bookings)'
        ALL       = 'all',       'All Pricing Models'

    # Controls whether floor/ceiling are interpreted as per-night or per-hour amounts.
    # If ALL, the engine converts floor/ceiling to the booking's rate basis before clamping:
    #   hourly bookings → floor_price_per_night / 24, ceiling_price_per_night / 24.
    # Prevents a €100/night floor from clamping a 2-hour €40 stay up to €100.
    pricing_model_scope = models.CharField(
        max_length=10, choices=PricingModelScope.choices, default=PricingModelScope.ALL)

    # --- Validity window ---
    valid_from = models.DateField(null=True, blank=True)
    valid_until = models.DateField(null=True, blank=True)

    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['priority', 'name']
        unique_together = [('marina', 'name')]

    def __str__(self):
        return f'[{self.priority}] {self.name} ({self.trigger_type})'
```

---

### 3.3 `YieldApplication` (audit log)

```python
class YieldApplication(models.Model):
    """
    Immutable record written every time the yield engine applies (or considers)
    a rule to a booking. Provides an audit trail for dynamic pricing decisions.
    """
    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE,
        related_name='yield_applications')
    booking = models.ForeignKey(
        'reservations.Booking', on_delete=models.CASCADE,
        related_name='yield_applications')
    rule = models.ForeignKey(
        YieldRule, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='applications')
    rule_name_snapshot = models.CharField(max_length=200)  # captured at time of application
    base_price = models.DecimalField(max_digits=10, decimal_places=2)
    computed_price = models.DecimalField(max_digits=10, decimal_places=2)
    applied_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-applied_at']

    def __str__(self):
        return f'YA-{self.pk}: {self.rule_name_snapshot} → €{self.computed_price}'
```

---

### 3.4 `HourlyBerthConfig` (part-day / hourly bookings)

```python
class HourlyBerthConfig(models.Model):
    """
    Enables sub-day bookings for a specific berth.
    If no record exists for a berth, that berth only accepts overnight bookings.
    Sub-hour pricing is calculated as a fraction of the per_hour ChargeableItem
    unit price (e.g. 45 minutes = unit_price × 0.75). No additional PricingModel
    choice is needed on ChargeableItem.
    """

    class IncrementChoices(models.TextChoices):
        MIN_15  = '15',  '15 Minutes'
        MIN_30  = '30',  '30 Minutes'
        HOUR_1  = '60',  '1 Hour'
        HOUR_4  = '240', '4 Hours (Half Day)'

    berth = models.OneToOneField(
        'berths.Berth', on_delete=models.CASCADE,
        related_name='hourly_config')
    min_duration_minutes = models.PositiveSmallIntegerField(default=60)   # e.g. 60
    max_duration_minutes = models.PositiveSmallIntegerField(default=480)  # e.g. 480 = 8h
    increment_minutes = models.CharField(
        max_length=5, choices=IncrementChoices.choices, default='60')
    pricing_item = models.ForeignKey(
        'billing.ChargeableItem', on_delete=models.PROTECT,
        limit_choices_to={'pricing_model': 'per_hour'},
        related_name='hourly_berth_configs')
    eligible_booking_types = models.CharField(
        max_length=50, default='transient',
        help_text='Comma-separated: transient,seasonal')
    is_active = models.BooleanField(default=True)

    def __str__(self):
        return f'{self.berth} — hourly ({self.min_duration_minutes}–{self.max_duration_minutes} min)'
```

> **Migration note:** Add two nullable fields to `reservations.Booking`:
> ```python
> # In a new migration on the reservations app:
> start_time = models.TimeField(null=True, blank=True)  # for sub-day bookings
> end_time   = models.TimeField(null=True, blank=True)
> is_hourly  = models.BooleanField(default=False)
> ```
> `nights` remains the unit for overnight bookings. For hourly bookings, `nights=0` and duration is derived from `start_time`/`end_time` on the same `check_in` date. Sub-hour pricing uses `unit_price × (duration_minutes / 60)`.

> **Calendar display:** Hourly bookings are displayed as fractional blocks within the day cell — a split-colour pill or partial fill indicator. The day is not marked fully blocked; the availability algorithm blocks only the specific overlapping time range.

---

### 3.5 `UpgradeCampaign`

```python
class UpgradeCampaign(models.Model):
    """
    Tracks an automated upgrade offer sent to a guest in a lower BookingTier.
    Generated nightly by the background upgrade task (runs at 03:00 AM):
    — Looks at arrivals within 3 days.
    — If the guest is in a Standard tier and the Premium tier is under 70% occupancy,
      an UpgradeCampaign is created and an upgrade email is sent automatically.
    Updated when the guest accepts (via portal link) or when the offer expires.
    """

    class Status(models.TextChoices):
        PENDING  = 'pending',  'Pending (sent)'
        ACCEPTED = 'accepted', 'Accepted'
        DECLINED = 'declined', 'Declined'
        EXPIRED  = 'expired',  'Expired'

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                               related_name='upgrade_campaigns')
    booking = models.ForeignKey(
        'reservations.Booking', on_delete=models.CASCADE,
        related_name='upgrade_campaigns')
    from_tier = models.ForeignKey(
        BookingTier, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='upgrades_from')
    to_tier = models.ForeignKey(
        BookingTier, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='upgrades_to')
    offered_berth = models.ForeignKey(
        'berths.Berth', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='upgrade_offers')
    differential_amount = models.DecimalField(max_digits=10, decimal_places=2)
    checkout_link = models.URLField(
        blank=True,
        help_text='Single-use Stripe Checkout link for the differential amount.')
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING)
    sent_at = models.DateTimeField(auto_now_add=True)
    responded_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField()

    class Meta:
        ordering = ['-sent_at']

    def __str__(self):
        return f'UpgC-{self.pk}: {self.booking} → {self.to_tier} ({self.status})'
```

**Automated nightly logic (`tasks.py`):**

Implemented as a Celery beat periodic task (Celery + Redis). Runs at 03:00 AM daily.

The background task (`run_upgrade_campaigns`) runs at 03:00 AM daily. For each marina:
1. Find all bookings with `check_in` within the next 3 days that are in a non-Premium tier.
2. Check if the Premium (or higher) tier has occupancy below 70% for the arrival date.
3. For each eligible booking, compute `differential_amount` **dynamically at offer-generation time**:
   ```python
   target_price = YieldEngine(marina).compute(
       berth=offered_berth,
       check_in=booking.check_in,
       check_out=booking.check_out,
       booking_type='transient',
   )['effective_price'] * booking.nights
   actual_paid = booking.amount   # what the guest actually paid, including any early-bird yield discount
   differential_amount = target_price - actual_paid
   ```
   Never use a static tier rate delta. The guest may have booked 6 months ago using an early-bird yield discount. Using a flat tier delta would under-price the upgrade and leak revenue. If `differential_amount <= 0` (the guest somehow already paid more than the target tier costs today), skip the offer for this booking.
4. Create an `UpgradeCampaign` record with the computed `differential_amount` and generate a single-use Stripe Checkout link for that amount.
5. Send an upgrade email via Zoho SMTP: "Upgrade to a Premium slip with 30A power for just €X more per night."
5. The email contains the direct Stripe Checkout link. Payment acceptance triggers the berth swap and `InvoiceLineItem` creation via a Stripe webhook.

---

### 3.6 `UpsellOffer`

```python
class UpsellOffer(models.Model):
    """
    Records an in-stay or at-booking upsell offer.
    Upsell items are presented to the boater on the booking quote screen
    (Step 3 of the public booking flow) as a dynamic "Add-ons" box.
    Only ChargeableItems with is_upsell_eligible=True are surfaced.
    When a boater selects an add-on at booking time, an InvoiceLineItem is
    created instantly alongside the booking. UpsellOffer also covers manual
    mid-stay offers triggered by the harbor master.
    """

    class TriggerEvent(models.TextChoices):
        BOOKING_QUOTE = 'booking_quote', 'Booking Quote Screen'
        CHECK_IN      = 'check_in',      'Check-In'
        MID_STAY      = 'mid_stay',      'Mid-Stay'
        MANUAL        = 'manual',        'Manual'

    class Status(models.TextChoices):
        SENT     = 'sent',     'Sent'
        REDEEMED = 'redeemed', 'Redeemed'
        EXPIRED  = 'expired',  'Expired'

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                               related_name='upsell_offers')
    booking = models.ForeignKey(
        'reservations.Booking', on_delete=models.CASCADE,
        related_name='upsell_offers')
    chargeable_item = models.ForeignKey(
        'billing.ChargeableItem', on_delete=models.PROTECT,
        related_name='upsell_offers',
        limit_choices_to={'is_upsell_eligible': True},
        help_text='Must have is_upsell_eligible=True on the ChargeableItem.')
    trigger_event = models.CharField(
        max_length=20, choices=TriggerEvent.choices, default=TriggerEvent.BOOKING_QUOTE)
    offer_text = models.TextField(blank=True)
    discount_pct = models.DecimalField(
        max_digits=5, decimal_places=2, default=0,
        help_text='Optional discount on the chargeable item for this offer.')
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.SENT)
    sent_at = models.DateTimeField(auto_now_add=True)
    redeemed_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField()
    invoice_line_item = models.ForeignKey(
        'billing.InvoiceLineItem', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='upsell_source',
        help_text='Set when the guest redeems and the charge is posted.')

    class Meta:
        ordering = ['-sent_at']

    def __str__(self):
        return f'UO-{self.pk}: {self.booking} → {self.chargeable_item} ({self.status})'
```

> **Migration note:** Add `is_upsell_eligible = models.BooleanField(default=False)` to `billing.ChargeableItem` in a separate migration on the `billing` app. This explicit opt-in prevents internal accounting entries (e.g., penalty fees, crane lift charges) from being offered as upsell items.

---

### 3.7 `WaitlistEntry`

```python
class WaitlistEntry(models.Model):
    """
    Records a boater's interest in a berth/date range for waitlist notification.
    When a gap-fill or last-minute yield rule fires, all WaitlistEntry records
    matching the berth's criteria (boat_length_max >= vessel size) are notified
    via a time-locked Stripe Checkout link (2-hour expiry).
    If no waitlist boater claims the berth within 2 hours, the discounted rate
    is published to the public booking widget automatically.
    """
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                               related_name='waitlist_entries')
    email = models.EmailField()
    vessel_length_m = models.DecimalField(max_digits=5, decimal_places=2)
    desired_from = models.DateField(null=True, blank=True)
    desired_to = models.DateField(null=True, blank=True)
    booking_tier = models.ForeignKey(
        'BookingTier', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='waitlist_entries')
    created_at = models.DateTimeField(auto_now_add=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'WL: {self.email} ({self.vessel_length_m}m) @ {self.marina}'
```

**Waitlist Sniper flow (`tasks.py`):**

The sniper uses **persistent database state**, not `apply_async(countdown=7200)`. Relying on a Redis countdown for a multi-hour financial inventory lock is fragile — a Redis restart, memory eviction, or rolling deployment within the 2-hour window silently drops the task, leaving the berth locked and the public widget never updated. Instead:

**`WaitlistOffer` model** (add to `models.py` alongside `WaitlistEntry`):

```python
class WaitlistOffer(models.Model):
    class Status(models.TextChoices):
        PENDING  = 'pending',  'Pending (awaiting claim)'
        CLAIMED  = 'claimed',  'Claimed'
        EXPIRED  = 'expired',  'Expired (published to widget)'

    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                         related_name='waitlist_offers')
    waitlist_entry   = models.ForeignKey(WaitlistEntry, on_delete=models.CASCADE,
                                         related_name='offers')
    berth            = models.ForeignKey('berths.Berth', on_delete=models.CASCADE)
    check_in         = models.DateField()
    check_out        = models.DateField()
    discounted_price = models.DecimalField(max_digits=10, decimal_places=2)
    stripe_checkout_url = models.URLField(blank=True)
    status           = models.CharField(max_length=10, choices=Status.choices,
                                        default=Status.PENDING)
    sent_at          = models.DateTimeField(auto_now_add=True)
    expires_at       = models.DateTimeField()  # sent_at + 2 hours
    claimed_at       = models.DateTimeField(null=True, blank=True)
```

**Sniper flow:**

When a `GAP_FILL` or `DAYS_TO_ARRIVAL` yield rule fires during a booking attempt:
1. The engine intercepts before publishing the discounted price publicly.
2. `run_waitlist_sniper` queries all active `WaitlistEntry` records where `vessel_length_m` fits the berth and the date range overlaps.
3. For each match, create a `WaitlistOffer` row with `expires_at = now() + timedelta(hours=2)`, generate a single-use Stripe Checkout link, and store it in `stripe_checkout_url`.
4. Send an email via Zoho SMTP: "A slip just opened for this weekend. Claim it in the next 2 hours for €X."

**`expire_waitlist_offers` sweep task** (registered as a Celery beat periodic task, every 5 minutes):

```python
@app.task(name='revenue_intelligence.expire_waitlist_offers')
def expire_waitlist_offers():
    now = timezone.now()
    expired = WaitlistOffer.objects.filter(status='pending', expires_at__lte=now)
    for offer in expired:
        offer.status = 'expired'
        offer.save(update_fields=['status'])
        # Publish the discounted price to the public booking widget for this berth/date range.
        # Implementation: set a DiscountedRate cache entry or a flag the public API reads.
    expired.update(status='expired')
```

The sweep task is the source of truth for expiry — not an in-memory Redis countdown. If Redis restarts or workers are redeployed during the 2-hour window, the next sweep (within 5 minutes of service restoration) catches all pending offers and publishes the rates correctly. No inventory lock is ever permanent.

---

### 3.8 `CompetitorRate`

```python
class CompetitorRate(models.Model):
    """
    Stores pricing data from rival marinas — either manually entered or
    auto-populated by the weekly scraper (scraper.py).
    Surfaced as a dotted reference overlay on the ADR chart in ForecastingScreen.
    """
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                               related_name='competitor_rates')
    competitor_name = models.CharField(max_length=200)
    competitor_url = models.URLField(
        blank=True,
        help_text='Public booking URL used by the weekly scraper.')
    vessel_length_m = models.DecimalField(
        max_digits=5, decimal_places=2,
        help_text='Reference vessel length for the scraped/entered rate (e.g. 10.0).')
    rate_per_night = models.DecimalField(max_digits=10, decimal_places=2)
    valid_from = models.DateField()
    valid_until = models.DateField(null=True, blank=True)
    source = models.CharField(
        max_length=20,
        choices=[('manual', 'Manual Entry'), ('scraper', 'Auto-Scraped')],
        default='manual')
    scraped_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-valid_from', 'competitor_name']

    def __str__(self):
        return f'{self.competitor_name}: €{self.rate_per_night}/night ({self.valid_from})'
```

**Weekly scraper (`scraper.py`):**

A lightweight Python script (using `requests` + `BeautifulSoup`) runs once per week as a Celery beat periodic task (Celery + Redis). For each `CompetitorRate` record with a `competitor_url`, it fetches the public pricing page for a configurable reference vessel (e.g. 10 m), parses the rate, and creates/updates a `CompetitorRate` record with `source='scraper'` and `scraped_at=now()`. The scraper runs as a scheduled background task alongside the nightly upgrade campaign job.

---

## 4. API Contract

All endpoints are marina-scoped: views filter by `request.user.marina`. All responses follow the standard DRF paginated envelope used across the codebase.

### 4.1 Booking Tiers

#### `GET /api/v1/revenue/booking-tiers/`
Returns all tiers for the marina.

```json
{
  "results": [
    {
      "id": 1,
      "name": "Standard",
      "display_order": 0,
      "rate_premium_pct": "0.00",
      "description": "",
      "is_active": true
    },
    {
      "id": 2,
      "name": "Premium",
      "display_order": 1,
      "rate_premium_pct": "25.00",
      "description": "Finger pontoon, shore power 32A, water.",
      "is_active": true
    }
  ]
}
```

#### `POST /api/v1/revenue/booking-tiers/`
Create a tier. Returns `201 Created`.

#### `PATCH /api/v1/revenue/booking-tiers/{id}/`
Partial update. Returns `200 OK`.

No DELETE endpoint. Deactivate with `PATCH { "is_active": false }`.

---

### 4.2 Yield Rules

#### `GET /api/v1/revenue/yield-rules/`
Returns all active yield rules ordered by priority.

```json
{
  "results": [
    {
      "id": 5,
      "name": "High-Season Uplift 80%",
      "priority": 10,
      "trigger_type": "occupancy_threshold",
      "occupancy_threshold_pct": "80.00",
      "occupancy_scope": "tier",
      "days_to_arrival_lte": null,
      "days_in_advance_gte": null,
      "gap_max_nights": null,
      "booking_tier": null,
      "applies_to_booking_type": "transient",
      "action_type": "percent_uplift",
      "action_value": "15.00",
      "floor_price": "45.00",
      "ceiling_price": "120.00",
      "valid_from": "2026-06-01",
      "valid_until": "2026-09-30",
      "is_active": true
    }
  ]
}
```

#### `POST /api/v1/revenue/yield-rules/`
Create a rule. Returns `201 Created`.

#### `PATCH /api/v1/revenue/yield-rules/{id}/`
Partial update. Returns `200 OK`.

---

### 4.3 Yield Engine — Price Preview

#### `POST /api/v1/revenue/yield-rules/preview/`

Called from the booking creation form to show the effective price before confirming.

Request:
```json
{
  "berth_id": 14,
  "check_in": "2026-07-15",
  "check_out": "2026-07-18",
  "booking_type": "transient"
}
```

Response:
```json
{
  "base_price_per_night": "55.00",
  "effective_price_per_night": "63.25",
  "total_amount": "189.75",
  "nights": 3,
  "rule_applied": {
    "id": 5,
    "name": "High-Season Uplift 80%",
    "action_type": "percent_uplift",
    "action_value": "15.00"
  },
  "floor_ceiling_clamped": false
}
```

If no rule fires, `rule_applied` is `null` and `effective_price_per_night` equals `base_price_per_night`.

---

### 4.4 Hourly Berth Config

#### `GET /api/v1/revenue/hourly-configs/`
Returns all hourly configs for the marina (one per berth, if set).

```json
{
  "results": [
    {
      "id": 3,
      "berth": 22,
      "berth_name": "D-04",
      "min_duration_minutes": 60,
      "max_duration_minutes": 480,
      "increment_minutes": "60",
      "pricing_item": 7,
      "pricing_item_name": "Day Visitor — Per Hour",
      "eligible_booking_types": "transient",
      "is_active": true
    }
  ]
}
```

#### `POST /api/v1/revenue/hourly-configs/`
Create a config. Returns `201 Created`.

#### `PATCH /api/v1/revenue/hourly-configs/{id}/`
Partial update. Returns `200 OK`.

---

### 4.5 Upgrade Campaigns

#### `GET /api/v1/revenue/upgrade-campaigns/`
Query params: `?status=pending`, `?booking_id=<id>`

```json
{
  "results": [
    {
      "id": 11,
      "booking": 204,
      "guest_name": "James Alderton",
      "from_tier": {"id": 1, "name": "Standard"},
      "to_tier": {"id": 2, "name": "Premium"},
      "offered_berth": 17,
      "offered_berth_name": "B-07",
      "differential_amount": "42.00",
      "checkout_link": "https://checkout.stripe.com/...",
      "status": "pending",
      "sent_at": "2026-07-14T09:30:00Z",
      "expires_at": "2026-07-15T09:30:00Z"
    }
  ]
}
```

#### `POST /api/v1/revenue/upgrade-campaigns/`
Create (manually or programmatically by the nightly task). Returns `201 Created`.

#### `PATCH /api/v1/revenue/upgrade-campaigns/{id}/`
Used to record `status = accepted | declined`. When `accepted` (triggered by Stripe webhook or manual action), the view must:
1. Reassign `booking.berth` to `offered_berth`.
2. Create an `InvoiceLineItem` on the booking's invoice for `differential_amount`, pointing to the berth's `pricing_tier` `ChargeableItem`.
3. Set `responded_at = now()`.

---

### 4.6 Upsell Offers

#### `GET /api/v1/revenue/upsell-offers/`
Query params: `?status=sent`, `?booking_id=<id>`

```json
{
  "results": [
    {
      "id": 8,
      "booking": 204,
      "chargeable_item": 31,
      "chargeable_item_name": "Restaurant Discount Voucher",
      "trigger_event": "booking_quote",
      "offer_text": "Welcome! Enjoy 15% off dinner tonight.",
      "discount_pct": "15.00",
      "status": "sent",
      "sent_at": "2026-07-15T14:00:00Z",
      "expires_at": "2026-07-15T23:59:00Z"
    }
  ]
}
```

#### `POST /api/v1/revenue/upsell-offers/`
Create an offer. Returns `201 Created`.

#### `PATCH /api/v1/revenue/upsell-offers/{id}/`
Mark as `redeemed`. When redeemed, the view must post a charge via `InvoiceLineItem` using the `chargeable_item` at its unit price minus any `discount_pct`.

---

### 4.7 Waitlist

#### `GET /api/v1/revenue/waitlist/`
Returns all active waitlist entries for the marina.

#### `POST /api/v1/revenue/waitlist/`
Add a boater to the waitlist. Returns `201 Created`.

#### `DELETE /api/v1/revenue/waitlist/{id}/`
Remove a waitlist entry (or `PATCH { "is_active": false }`).

---

### 4.8 Competitor Rates

#### `GET /api/v1/revenue/competitor-rates/`
Returns all competitor rate records for the marina.

```json
{
  "results": [
    {
      "id": 1,
      "competitor_name": "Porto Lago Marina",
      "competitor_url": "https://portolago.ch/berths",
      "vessel_length_m": "10.00",
      "rate_per_night": "62.00",
      "valid_from": "2026-06-01",
      "valid_until": "2026-09-30",
      "source": "scraper",
      "scraped_at": "2026-05-05T03:10:00Z"
    }
  ]
}
```

#### `POST /api/v1/revenue/competitor-rates/`
Create a manual entry. Returns `201 Created`.

#### `PATCH /api/v1/revenue/competitor-rates/{id}/`
Partial update. Returns `200 OK`.

#### `DELETE /api/v1/revenue/competitor-rates/{id}/`
Delete a competitor entry. Returns `204 No Content`.

---

### 4.9 Revenue Analytics Endpoints

All analytics endpoints are `GET` only. They operate against the live `Booking` and `Invoice` tables — no persisted aggregates in v1. ADR and RevPAB calculations include only bookings with status `confirmed`, `checked_in`, or `checked_out`.

#### `GET /api/v1/revenue/analytics/adr/`
Average Daily Rate.

Query params: `?from=2026-01-01&to=2026-06-30&booking_tier_id=2`

```json
{
  "period_from": "2026-01-01",
  "period_to": "2026-06-30",
  "adr": "58.40",
  "total_revenue": "87600.00",
  "total_occupied_nights": 1500,
  "by_month": [
    {"month": "2026-01", "adr": "42.10", "occupied_nights": 180},
    {"month": "2026-06", "adr": "71.50", "occupied_nights": 310}
  ],
  "competitor_overlay": [
    {
      "competitor_name": "Porto Lago Marina",
      "by_month": [
        {"month": "2026-01", "rate_per_night": "55.00"},
        {"month": "2026-06", "rate_per_night": "62.00"}
      ]
    }
  ]
}
```

ADR formula: `sum(booking.amount) / sum(booking.nights)` for confirmed/checked_in/checked_out bookings in the period. The `competitor_overlay` array provides the dotted reference lines for the ADR chart.

---

#### `GET /api/v1/revenue/analytics/revpab/`
Revenue Per Available Berth-night.

Query params: `?from=2026-01-01&to=2026-06-30`

```json
{
  "period_from": "2026-01-01",
  "period_to": "2026-06-30",
  "revpab": "34.20",
  "total_revenue": "87600.00",
  "total_available_berth_nights": 2562,
  "by_month": [
    {"month": "2026-01", "revpab": "22.10", "available_berth_nights": 434},
    {"month": "2026-06", "revpab": "49.80", "available_berth_nights": 420}
  ]
}
```

RevPAB formula: `total_berth_revenue / (active_berth_count × days_in_period)`.

---

#### `GET /api/v1/revenue/analytics/pacing/`
Pacing report — current booking volume vs same period prior year at same booking-cycle point.

"Same point in the booking cycle" is defined as: bookings created on or before `today - 365 days` for the prior-year period. This answers: "Exactly one year ago today, how much revenue did we have on the books for this upcoming period?"

Query params: `?future_period_from=2026-07-01&future_period_to=2026-08-31`

```json
{
  "current_year": {
    "period": "2026-07-01 to 2026-08-31",
    "confirmed_bookings": 87,
    "confirmed_revenue": "31200.00",
    "occupancy_pct": "62.1"
  },
  "prior_year_same_point": {
    "period": "2025-07-01 to 2025-08-31",
    "confirmed_bookings_at_this_date": 104,
    "confirmed_revenue_at_this_date": "38900.00",
    "occupancy_pct": "74.3"
  },
  "pacing_index": 0.84,
  "commentary": "Booking pace is 16% behind prior year at the same point in the cycle."
}
```

---

#### `GET /api/v1/revenue/analytics/forecast/`
Projected revenue from confirmed and tentative bookings.

Query params: `?horizon_days=90`

```json
{
  "horizon_days": 90,
  "windows": [
    {
      "label": "Next 30 days",
      "from": "2026-05-07",
      "to": "2026-06-06",
      "confirmed_revenue": "14200.00",
      "tentative_revenue": "3800.00",
      "total_projected": "18000.00"
    },
    {
      "label": "Next 60 days",
      "from": "2026-05-07",
      "to": "2026-07-06",
      "confirmed_revenue": "28100.00",
      "tentative_revenue": "9200.00",
      "total_projected": "37300.00"
    },
    {
      "label": "Next 90 days",
      "from": "2026-05-07",
      "to": "2026-08-05",
      "confirmed_revenue": "41500.00",
      "tentative_revenue": "17600.00",
      "total_projected": "59100.00"
    }
  ]
}
```

"Tentative" = bookings with status `pending` or `pending_approval`. "Confirmed" = `confirmed`, `checked_in`.

---

#### `GET /api/v1/revenue/analytics/deferred-revenue/`
> **Dependency:** This endpoint requires Track 4's `DeferredRevenueRecognitionLog` model. Ensure Track 4 migrations are applied before Track 1. If queried before Track 4 is installed, return an empty dataset rather than raising a 500.

Deferred revenue schedule: advance payments received for future stays.

Deferred revenue is the sum of cash actually collected (paid invoices and paid invoice line items) for bookings whose `check_in` date is in the future. Only the amount actually received is counted — not unpaid balances or projected totals.

Query params: `?as_of=2026-05-07`

```json
{
  "as_of": "2026-05-07",
  "total_deferred": "62400.00",
  "by_month": [
    {
      "month": "2026-06",
      "bookings_count": 34,
      "deferred_amount": "18200.00",
      "check_ins_in_month": 28
    },
    {
      "month": "2026-07",
      "bookings_count": 61,
      "deferred_amount": "31400.00",
      "check_ins_in_month": 55
    }
  ]
}
```

**Logic — proportional night-by-night allocation (GAAP/IFRS compliant):**

Grouping by `booking.check_in` month violates revenue recognition standards. A booking spanning May 28–June 7 for €1,000 earns €400 in May and €600 in June — lumping it entirely into May is illegal for tax reporting purposes.

The correct approach:
1. For each paid invoice where the linked `booking.check_out > as_of` (i.e., at least one night is still in the future):
2. Compute `daily_rate = invoice.total / booking.nights`.
3. Iterate through each night of the stay (`check_in` to `check_out - 1 day`).
4. For each future night (`night_date > as_of`), add `daily_rate` to the bucket for `night_date.strftime('%Y-%m')`.
5. Sum all allocations per month.

This means a cross-month booking is correctly split across the months where the nights actually occur. The `DeferredRevenueView` performs this iteration in Python after a single DB query — do not attempt to do it in SQL. The result is grouped by month and summed before returning.

`bookings_count` in the response counts distinct bookings contributing at least one night to that month (a cross-month booking is counted in both months it spans).

---

## 5. Frontend Architecture

### 5.1 Sidebar Navigation

Add a new top-level sidebar group **"Revenue"** positioned immediately below "Billing" and above "Reports". The full sidebar order becomes: Dashboard → Infrastructure → Reservations → Billing → **Revenue** → Reports → Members → Master Data.

Contents of the Revenue group:

- **Pricing Rules** → `/revenue/pricing-rules`
- **Forecasting** → `/revenue/forecasting`
- **Campaigns** → `/revenue/campaigns`

---

### 5.2 `PricingRulesScreen.jsx`

Route: `/revenue/pricing-rules`

Layout: Two-tab horizontal tab bar.

**Tab 1: Yield Rules**
- Header with `[ + New Rule ]` button → opens `YieldRuleDrawer.jsx` in create mode.
- `YieldRuleList.jsx` — table with columns: Name, Priority, Trigger, Action, Scope, Valid Period, Status badge.
- Row click → opens `YieldRuleDrawer.jsx` in edit mode.

**Tab 2: Booking Tiers**
- Header with `[ + New Tier ]` button → opens `BookingTierDrawer.jsx` in create mode.
- `BookingTierList.jsx` — table with columns: Name, Rate Premium %, Berths Assigned (count), Status badge.
- Row click → opens `BookingTierDrawer.jsx` in edit mode.

**Price Preview Banner (bottom of page):**
A compact `YieldPreviewPanel.jsx` — enter a berth, date range, and booking type; calls `POST /api/v1/revenue/yield-rules/preview/` and shows the effective price breakdown inline. Used to test rules before publishing.

---

### 5.3 Drawers

**`YieldRuleDrawer.jsx`**
Slide-in from right. Fields: Name, Priority, Trigger Type (select), trigger-specific fields (shown conditionally based on trigger type), Occupancy Scope (tier / marina-wide — shown only when trigger type is `occupancy_threshold`), Scope (Booking Tier select, Booking Type — fixed to Transient), Action Type (select), Action Value, Floor Price, Ceiling Price, Valid From, Valid Until, Active toggle. Validation: `action_value > 0`; at least one trigger parameter must be filled for the selected trigger type.

**`BookingTierDrawer.jsx`**
Fields: Name, Display Order, Rate Premium %, Description, Active toggle.

**`HourlyConfigDrawer.jsx`**
Opened from the Berth detail view (Infrastructure screen). Fields: Min Duration, Max Duration, Increment, Pricing Item (filtered to `?pricing_model=per_hour`), Eligible Booking Types, Active toggle.

**`CompetitorRateDrawer.jsx`**
Fields: Competitor Name, Booking URL (for scraper), Reference Vessel Length, Rate Per Night, Valid From, Valid Until.

---

### 5.4 `ForecastingScreen.jsx`

Route: `/revenue/forecasting`

Four horizontal tabs matching the analytics endpoints:

**Tab 1: ADR & RevPAB**
- KPI row: Current Month ADR, Prior Month ADR, Current Month RevPAB, YTD RevPAB.
- `AdrRevpabChart.jsx` — monthly bar chart (reuse the `Bar` component pattern from `Reports.jsx`) showing ADR and RevPAB side-by-side per month. Competitor rates from `competitor_overlay` are rendered as dotted reference lines over the ADR bars.
- Date range picker (from/to) and optional Booking Tier filter.
- Data from `useAdrRevpab.js` hook → `GET /api/v1/revenue/analytics/adr/` and `GET /api/v1/revenue/analytics/revpab/`.
- `[ Manage Competitor Rates ]` button → opens `CompetitorRateDrawer.jsx` for adding/editing competitor benchmarks.

**Tab 2: Pacing**
- `PacingChart.jsx` — line chart comparing current-year booking count/revenue for a future period vs prior year at the same booking cycle point.
- Pacing Index badge (green if > 1.0, amber if 0.85–1.0, red if < 0.85).
- Future period picker (from/to defaults to next 60 days).
- Data from `usePacing.js` hook → `GET /api/v1/revenue/analytics/pacing/`.

**Tab 3: Forecast**
- `ForecastPanel.jsx` — three side-by-side cards for 30 / 60 / 90-day windows, each showing confirmed vs tentative revenue with a stacked bar.
- Data from `useForecast.js` hook → `GET /api/v1/revenue/analytics/forecast/`.

**Tab 4: Deferred Revenue**
- `DeferredRevenueTable.jsx` — table by month: Month, Bookings Count, Deferred Amount, Check-ins in Month.
- KPI at top: Total Deferred (as of today).
- Data from `useDeferredRevenue.js` hook → `GET /api/v1/revenue/analytics/deferred-revenue/`.

---

### 5.5 `CampaignsScreen.jsx`

Route: `/revenue/campaigns`

Two-tab layout:

**Tab 1: Upgrade Campaigns**
- `UpgradeCampaignList.jsx` — table: Guest, Booking Dates, From Tier, To Tier, Berth Offered, Differential, Status badge, Sent At.
- Filter by status (pending / accepted / declined / expired).
- `[ + Create Upgrade Offer ]` button → `UpgradeCampaignDrawer.jsx` (manual creation; select a booking, pick a target tier and berth, set expiry — the Stripe checkout link is generated on save).
- Row expand → shows accept/decline controls if status is pending (for manual override; automated acceptance happens via Stripe webhook).

**Tab 2: In-Stay Upsell**
- `UpsellOfferList.jsx` — table: Guest, Booking, Item, Discount %, Status badge, Sent At.
- Filter by status.
- `[ + Send Upsell Offer ]` button → `UpsellOfferDrawer.jsx` (select active booking, select `ChargeableItem` with `is_upsell_eligible=True`, set discount, offer text, expiry).

---

### 5.6 Hooks

| Hook | Endpoint | Purpose |
|------|----------|---------|
| `useYieldRules.js` | `GET/POST/PATCH /api/v1/revenue/yield-rules/` | Rule list + CRUD mutations |
| `useYieldPreview.js` | `POST /api/v1/revenue/yield-rules/preview/` | Price preview (no caching — always fresh) |
| `useBookingTiers.js` | `GET/POST/PATCH /api/v1/revenue/booking-tiers/` | Tier list + CRUD mutations |
| `useHourlyConfigs.js` | `GET/POST/PATCH /api/v1/revenue/hourly-configs/` | Hourly berth config CRUD |
| `useUpgradeCampaigns.js` | `GET/POST/PATCH /api/v1/revenue/upgrade-campaigns/` | Campaign list + accept/decline |
| `useUpsellOffers.js` | `GET/POST/PATCH /api/v1/revenue/upsell-offers/` | Upsell offer CRUD + redeem |
| `useWaitlist.js` | `GET/POST/DELETE /api/v1/revenue/waitlist/` | Waitlist entry management |
| `useCompetitorRates.js` | `GET/POST/PATCH/DELETE /api/v1/revenue/competitor-rates/` | Competitor rate CRUD |
| `useAdrRevpab.js` | `GET /api/v1/revenue/analytics/adr/` + `revpab/` | ADR and RevPAB data |
| `usePacing.js` | `GET /api/v1/revenue/analytics/pacing/` | Pacing report |
| `useForecast.js` | `GET /api/v1/revenue/analytics/forecast/` | 30/60/90-day forecast |
| `useDeferredRevenue.js` | `GET /api/v1/revenue/analytics/deferred-revenue/` | Deferred revenue schedule |

All mutation hooks follow the existing pattern: React Query + Axios, `toast` notifications on success/error, `queryClient.invalidateQueries` on success.

---

### 5.7 Booking Form Integration

The existing booking creation form (wherever it lives in the Reservations screen) must be updated to:

1. After the user selects a berth and date range, call `POST /api/v1/revenue/yield-rules/preview/` and display the returned `effective_price_per_night` (with a tooltip showing whether a rule was applied and which one).
2. Allow the user to accept the dynamic price or manually override it (with a reason field, stored in `Booking.notes`).
3. If the selected berth has an `HourlyBerthConfig`, show a toggle **"Hourly Booking"** which replaces the date-range picker with a single date + time-range picker (start time / end time, constrained by `min_duration_minutes`, `max_duration_minutes`, `increment_minutes`). Set `is_hourly = true` and populate `start_time` / `end_time` on the booking payload.

### 5.8 Public Booking Flow — Quote Screen Add-ons

At Step 3 of the public booking flow (the quote/checkout screen, before card entry), display a dynamic **"Add-ons"** box beneath the price summary. The box lists all `ChargeableItem` records where `is_upsell_eligible=True` for the marina. Each add-on shows its name, description, and price. The boater can toggle any add-on on/off; the total updates dynamically. On booking confirmation, an `InvoiceLineItem` is created for each selected add-on instantly alongside the booking record, and a `UpsellOffer` record is written with `trigger_event='booking_quote'` and `status='redeemed'`.

---

## 6. Implementation Steps

Steps are ordered by dependency. Do not reorder.

1. **Create `revenue_intelligence` app** — `python manage.py startapp revenue_intelligence` inside `backend/apps/`. Add to `INSTALLED_APPS`. Create `urls.py` and wire into the top-level URL conf.

2. **Write `BookingTier` model and migration** — create model, run `makemigrations revenue_intelligence`. Also create a migration on the `berths` app adding `booking_tier = ForeignKey('revenue_intelligence.BookingTier', null=True, blank=True, on_delete=SET_NULL)` to `Berth`.

3. **Write `YieldRule` and `YieldApplication` models and migration** — create both models in the same migration. Include the `occupancy_scope` and `pricing_model_scope` fields on `YieldRule`.

4. **Write `HourlyBerthConfig` model and migration** — create model. Also create a migration on the `reservations` app adding `start_time`, `end_time`, `is_hourly` to `Booking`.

5. **Write `UpgradeCampaign` and `UpsellOffer` models and migration** — single migration for both. Include `checkout_link` on `UpgradeCampaign`.

6. **Write `WaitlistEntry`, `WaitlistOffer`, and `CompetitorRate` models and migration** — single migration for all three. `WaitlistOffer.expires_at` is indexed for the sweep task query.

7. **Add `is_upsell_eligible` to `ChargeableItem`** — migration on the `billing` app adding `is_upsell_eligible = BooleanField(default=False)`.

8. **Write serializers** — one serializer per model. `UpgradeCampaignSerializer` must include nested read-only `from_tier` and `to_tier` name fields, plus `checkout_link`. `UpsellOfferSerializer` must include `chargeable_item_name` as a read-only annotated field.

9. **Write `YieldEngine` service class** — `backend/apps/revenue_intelligence/engine.py`. Method signature: `YieldEngine(marina).compute(berth, check_in, check_out, booking_type, is_hourly=False, duration_minutes=None) -> dict`. Engine hard-guards: if `booking_type != 'transient'`, return base price immediately with no rule applied. For `OCCUPANCY_THRESHOLD` rules, evaluate occupancy at the scope defined by `occupancy_scope` (tier-level if `tier`, marina-wide if `marina`). Queries active `YieldRule` records ordered by priority, evaluates each trigger condition, applies the first matching rule's action (no stacking), then clamps using the following floor/ceiling logic: if `is_hourly=True` and `rule.pricing_model_scope == 'all'`, convert floor/ceiling to hourly basis before clamping (`floor_per_hour = rule.floor_price / 24`, `ceiling_per_hour = rule.ceiling_price / 24`); if `rule.pricing_model_scope == 'per_hour'`, use floor/ceiling as-is (already in hourly terms); if `rule.pricing_model_scope == 'per_night'`, skip this rule entirely for hourly bookings. Returns `{base_price, effective_price, rule_applied}`. Write unit tests for: no rule fires, occupancy rule fires at tier scope, occupancy rule fires at marina scope, last-minute rule fires, gap-fill rule fires, seasonal booking (no rule applied), floor clamp (nightly), floor clamp does not overcharge 2-hour booking (hourly conversion), ceiling clamp.

10. **Wire yield engine into `BookingViewSet`** — in `reservations/views.py`, call `YieldEngine` during booking `create` and write a `YieldApplication` record. Store `effective_price` as `booking.amount`. Do not alter the existing billing pipeline; the `InvoiceLineItem` is created downstream as normal.

11. **Write analytics views** — five read-only `APIView` classes in `revenue_intelligence/views.py`: `AdrView`, `RevpabView`, `PacingView`, `ForecastView`, `DeferredRevenueView`. Each queries existing models and returns computed JSON. `AdrView` must include a `competitor_overlay` array from `CompetitorRate` records for the requested period. Add `django.db.connection.queries` logging guard: if any single analytics query exceeds 500ms, log a warning.

12. **Write `YieldPreviewView`** — `POST /api/v1/revenue/yield-rules/preview/`. Calls `YieldEngine.compute()` without persisting anything. Returns the preview dict.

13. **Write Waitlist Sniper task and sweep task** — implement two tasks in `tasks.py`:
    - `run_waitlist_sniper(berth_id, check_in, check_out, discounted_price, marina_id)`: called programmatically from `BookingViewSet` when a gap-fill or last-minute rule fires. Creates `WaitlistOffer` rows (one per matching `WaitlistEntry`), generates Stripe Checkout links, sends emails. Does **not** use `apply_async(countdown=7200)` — state lives in the database. **Must be dispatched inside `transaction.on_commit()`** to prevent the task from running before the triggering booking row is visible to other database connections:
      ```python
      from django.db import transaction
      transaction.on_commit(
          lambda: run_waitlist_sniper.delay(
              berth_id=berth.pk,
              check_in=str(booking.check_in),
              check_out=str(booking.check_out),
              discounted_price=str(effective_price),
              marina_id=marina.pk,
          )
      )
      ```
    - `expire_waitlist_offers()`: registered as a Celery beat periodic task every 5 minutes. Sweeps `WaitlistOffer.objects.filter(status='pending', expires_at__lte=now())`, marks them `expired`, and publishes the discounted rate to the public booking widget. This is the authoritative expiry mechanism — Redis state is irrelevant. Add to `CELERY_BEAT_SCHEDULE`: `crontab` every 5 minutes.

14. **Write nightly upgrade campaign task** — in `tasks.py`, implement `run_upgrade_campaigns()`. Runs at 03:00 AM daily. Criteria: arrivals within 3 days, guest in non-Premium tier, Premium tier < 70% occupancy for arrival date. For each match: create `UpgradeCampaign`, generate Stripe Checkout link for `differential_amount`, send upgrade email via Zoho SMTP. Wire Stripe webhook to accept the upgrade and call the same berth-swap + `InvoiceLineItem` logic as the `PATCH` endpoint. Register as a Celery beat periodic task: schedule `run_upgrade_campaigns` at 03:00 AM daily in `CELERY_BEAT_SCHEDULE` in `settings.py`.

15. **Write weekly competitor scraper task** — in `scraper.py`, implement `scrape_competitor_rates()`. Runs once per week. For each `CompetitorRate` with a `competitor_url`, fetch and parse the public pricing page for a configured reference vessel length. Update the record with the scraped rate and `scraped_at=now()`. Register as a Celery beat periodic task: schedule `scrape_competitor_rates` weekly (e.g. every Sunday at 06:00 UTC) in `CELERY_BEAT_SCHEDULE`.

16. **Write `UpgradeCampaign` accept/decline logic** — override `PATCH` in `UpgradeCampaignViewSet.partial_update`. When `status` changes to `accepted`: reassign booking berth, create `InvoiceLineItem` for differential amount, set `responded_at`.

17. **Write `UpsellOffer` redeem logic** — override `PATCH` in `UpsellOfferViewSet.partial_update`. When `status` changes to `redeemed`: compute discounted price, create `InvoiceLineItem` against the booking's invoice.

18. **Add "Revenue" sidebar group** — add to the frontend sidebar component with the three routes, positioned between Billing and Reports.

19. **Build `PricingRulesScreen.jsx`** — `YieldRuleList.jsx`, `YieldRuleDrawer.jsx`, `BookingTierList.jsx`, `BookingTierDrawer.jsx`, `YieldPreviewPanel.jsx`. Wire `useYieldRules.js` and `useBookingTiers.js`. Include `occupancy_scope` field in `YieldRuleDrawer.jsx` (conditionally shown).

20. **Build `ForecastingScreen.jsx`** — four tabs with their respective chart/table components. Wire all four analytics hooks. Include competitor overlay lines in `AdrRevpabChart.jsx` and `CompetitorRateDrawer.jsx` for managing competitor entries.

21. **Build `CampaignsScreen.jsx`** — `UpgradeCampaignList.jsx`, `UpgradeCampaignDrawer.jsx`, `UpsellOfferList.jsx`, `UpsellOfferDrawer.jsx`. Wire `useUpgradeCampaigns.js` and `useUpsellOffers.js`.

22. **Update booking creation form** — add yield preview call, hourly booking toggle, and `HourlyConfigDrawer.jsx` in the Infrastructure/Berth detail view.

23. **Build public booking flow add-ons box** — implement the quote screen add-ons section (§5.8). Wire `useUpsellOffers.js` to create offers on checkout.

24. **Write `useHourlyConfigs.js`** and wire `HourlyConfigDrawer.jsx` into the Berth detail view (Infrastructure screen).

25. **Write `useWaitlist.js`** and `useCompetitorRates.js` hooks.

---

## 7. Celery & Redis Configuration

All background tasks use **Celery with Redis as the broker and result backend**. This is consistent with the Track 4 (Financial & Accounting) declaration of Celery + Redis as the platform-wide task queue.

### Required packages (if not already installed)
```
celery
redis
django-celery-beat   # for database-backed periodic task schedule
```

### Settings additions

```python
# settings.py
CELERY_BROKER_URL = env('REDIS_URL')          # e.g. redis://localhost:6379/0
CELERY_RESULT_BACKEND = env('REDIS_URL')
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'

CELERY_BEAT_SCHEDULE = {
    'run-upgrade-campaigns-nightly': {
        'task': 'revenue_intelligence.tasks.run_upgrade_campaigns',
        'schedule': crontab(hour=3, minute=0),
    },
    'scrape-competitor-rates-weekly': {
        'task': 'revenue_intelligence.tasks.scrape_competitor_rates',
        'schedule': crontab(hour=6, minute=0, day_of_week='sunday'),
    },
    'expire-waitlist-offers': {
        'task': 'revenue_intelligence.tasks.expire_waitlist_offers',
        'schedule': crontab(minute='*/5'),   # every 5 minutes
    },
}
```

The waitlist sniper (`run_waitlist_sniper`) is not registered as a periodic task — it is called programmatically from `BookingViewSet`. Expiry is handled by the `expire_waitlist_offers` sweep task, not by `apply_async(countdown=7200)`. Persistent `WaitlistOffer` rows are the source of truth; Redis state is not relied upon for multi-hour inventory locks.

### Retry policy for upgrade campaign emails

```python
@app.task(bind=True, max_retries=3, default_retry_delay=60)
def run_upgrade_campaigns(self):
    ...
```

Email failures (Zoho SMTP unreachable) retry up to 3 times with 60-second back-off. A failure after all retries logs a Django `WARN` to the admin email channel.

### Railway deployment note

On Railway, run the Celery worker and Celery beat as two separate processes (two Railway services pointing at the same repo). Example `Procfile` entries:

```
worker: celery -A backend worker --loglevel=info
beat:   celery -A backend beat --scheduler django_celery_beat.schedulers:DatabaseScheduler --loglevel=info
```
