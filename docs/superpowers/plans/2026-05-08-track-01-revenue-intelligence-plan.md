# Track 1 — Revenue Intelligence: Implementation Plan

Date: 2026-05-08
Based on spec: `docs/superpowers/specs/2026-05-07-track-01-revenue-intelligence-design.md`

---

## Overview

This plan covers the gap between the existing `apps/revenue` partial implementation and the full spec for Track 1 — Revenue Intelligence. The spec mandates a new app `apps/revenue_intelligence` with a completely redesigned model set. The existing `apps/revenue` app must be retired (or left as a legacy stub), and a clean `revenue_intelligence` app must be created. All new code lives in `backend/apps/revenue_intelligence/`.

**Summary of work:** Create new Django app, 9 new models, redesigned YieldEngine class, 5 analytics views, 8 CRUD viewsets, Celery task infrastructure, competitor scraper, and signal wiring into `BookingViewSet`.

---

## Gap Analysis

### What exists in `apps/revenue`

| Component | Status |
|---|---|
| `BookingTier` model | Wrong shape — scoped by berth category + season, not commercial grade |
| `YieldRule` model | Wrong shape — uses `rule_type` + `parameters` JSONField + `multiplier`, not the spec's trigger/action split |
| `YieldApplication` model | Close but uses `OneToOneField` on Booking; spec requires `ForeignKey` (multiple applications possible) |
| `WaitlistEntry` model | Wrong shape — linked to `Member`+`Vessel`, not bare email; has `priority_score` and `fulfilled_booking` not in spec |
| `engine.py` — `calculate_booking_price()` | Wrong interface — returns tuple, not dict; no `is_hourly` support; no `occupancy_scope`; no floor/ceiling; no `pricing_model_scope` |
| `engine.py` — `run_waitlist_sniper()` | Wrong implementation — synchronous, no `WaitlistOffer` model, no Stripe link generation |
| `views.py` | Wrong endpoints — `tiers/`, `rules/`, `applications/`, `waitlist/`, `calculate-price/`, `occupancy/` |
| `urls.py` | Does not match spec URL patterns |
| No `HourlyBerthConfig` model | Missing |
| No `UpgradeCampaign` model | Missing |
| No `UpsellOffer` model | Missing |
| No `WaitlistOffer` model | Missing |
| No `CompetitorRate` model | Missing |
| No analytics views | Missing |
| No Celery tasks | Missing |
| No `tasks.py` | Missing |
| No `scraper.py` | Missing |

### What needs to be built

Everything in the spec. The existing `apps/revenue` app is a different architectural shape and should not be extended — create `apps/revenue_intelligence` as a clean slate. The existing `apps/revenue` URLs remain active so as not to break any existing integrations; the new app adds its own URL prefix at `api/v1/revenue/`.

---

## Models

All models live in `backend/apps/revenue_intelligence/models.py`.

### Required migrations to OTHER apps (run before revenue_intelligence migrations)

**`berths` app — new migration `0028_berth_booking_tier.py`:**
```python
# Add to berths.Berth:
booking_tier = models.ForeignKey(
    'revenue_intelligence.BookingTier',
    on_delete=models.SET_NULL,
    null=True, blank=True,
    related_name='berths',
)
```

**`reservations` app — new migration `000X_booking_hourly_fields.py`:**
```python
# Add to reservations.Booking:
start_time = models.TimeField(null=True, blank=True)
end_time   = models.TimeField(null=True, blank=True)
is_hourly  = models.BooleanField(default=False)
dynamic_price_applied = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
```
The `dynamic_price_applied` field records the per-night or per-hour effective price set by the engine (audit field alongside `YieldApplication`).

**`billing` app — new migration `000X_chargeable_item_upsell.py`:**
```python
# Add to billing.ChargeableItem:
is_upsell_eligible = models.BooleanField(default=False)
```

**`accounts` app — no new fields required for Track 1.**

### Model 1: `BookingTier`

```python
class BookingTier(models.Model):
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                               related_name='booking_tiers')
    name = models.CharField(max_length=100)
    display_order = models.PositiveSmallIntegerField(default=0)
    rate_premium_pct = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    description = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['display_order', 'name']
        unique_together = [('marina', 'name')]
```

This replaces the old `apps/revenue.BookingTier` conceptually. It is a commercial grade label (Standard / Premium / Superyacht), not a pricing matrix.

### Model 2: `YieldRule`

Full spec definition — copy verbatim from spec §3.2. Key fields not in the old model:
- `trigger_type` (TextChoices: `occupancy_threshold`, `days_to_arrival`, `days_in_advance`, `gap_fill`)
- `action_type` (TextChoices: `percent_uplift`, `percent_discount`, `fixed_uplift`, `fixed_discount`)
- `action_value` — explicit decimal, not a `multiplier`
- `occupancy_scope` (TextChoices: `tier`, `marina`)
- `occupancy_threshold_pct`, `days_to_arrival_lte`, `days_in_advance_gte`, `gap_max_nights` — separate typed fields, not JSONField
- `booking_tier` FK — scope rule to a specific tier
- `floor_price`, `ceiling_price` — guard rails
- `pricing_model_scope` (TextChoices: `per_night`, `per_hour`, `all`) — controls floor/ceiling basis
- `valid_from`, `valid_until` — date window
- `priority` (lower = evaluated first, opposite convention from old model)

### Model 3: `YieldApplication`

Spec §3.3. Key differences from old model:
- `ForeignKey` on `booking` (not `OneToOneField`) — multiple applications may be written for a single booking if rules are re-evaluated
- `rule_name_snapshot` field (captures rule name at time of application)
- `computed_price` replaces `applied_price`
- No `booking` related_name collision: use `related_name='yield_applications'`

### Model 4: `HourlyBerthConfig`

New model — spec §3.4. OneToOneField on `berths.Berth`. Fields: `min_duration_minutes`, `max_duration_minutes`, `increment_minutes` (CharField with TextChoices: 15/30/60/240), `pricing_item` FK to `billing.ChargeableItem` (limit_choices_to `per_hour`), `eligible_booking_types`, `is_active`.

### Model 5: `UpgradeCampaign`

New model — spec §3.5. Fields: `marina`, `booking`, `from_tier`, `to_tier` (both FK to `BookingTier`), `offered_berth` FK to `berths.Berth`, `differential_amount`, `checkout_link` (URLField), `status` (TextChoices: `pending`/`accepted`/`declined`/`expired`), `sent_at`, `responded_at`, `expires_at`.

### Model 6: `UpsellOffer`

New model — spec §3.6. Fields: `marina`, `booking`, `chargeable_item` FK (limit_choices_to `is_upsell_eligible=True`), `trigger_event` (TextChoices: `booking_quote`/`check_in`/`mid_stay`/`manual`), `offer_text`, `discount_pct`, `status` (TextChoices: `sent`/`redeemed`/`expired`), `sent_at`, `redeemed_at`, `expires_at`, `invoice_line_item` FK to `billing.InvoiceLineItem` (null).

### Model 7: `WaitlistEntry`

Spec §3.7. Note: this is a different shape from the old `apps/revenue.WaitlistEntry`. Key differences:
- Uses bare `email` field (not Member FK) — for anonymous boaters from the public portal
- `vessel_length_m` (not split loa/beam/draft)
- `booking_tier` FK
- No `member`, `vessel`, `fulfilled_booking`, `priority_score` fields

### Model 8: `WaitlistOffer`

New model — spec §3.7 (persistent offer state). Fields: `marina`, `waitlist_entry` FK, `berth` FK, `check_in`, `check_out`, `discounted_price`, `stripe_checkout_url`, `status` (TextChoices: `pending`/`claimed`/`expired`), `sent_at`, `expires_at`, `claimed_at`. Add `db_index=True` on `expires_at` for the sweep task query.

### Model 9: `CompetitorRate`

New model — spec §3.8. Fields: `marina`, `competitor_name`, `competitor_url`, `vessel_length_m`, `rate_per_night`, `valid_from`, `valid_until`, `source` (choices: `manual`/`scraper`), `scraped_at`, `created_at`.

---

## Services (`engine.py`)

Replace the existing `apps/revenue/engine.py` function-based module with a class-based `YieldEngine` in `backend/apps/revenue_intelligence/engine.py`.

### `YieldEngine` class

```python
class YieldEngine:
    def __init__(self, marina):
        self.marina = marina

    def compute(
        self,
        berth,
        check_in: date,
        check_out: date,
        booking_type: str,
        is_hourly: bool = False,
        duration_minutes: int | None = None,
    ) -> dict:
        """
        Returns:
        {
            'base_price': Decimal,        # per-night or per-hour rate
            'effective_price': Decimal,    # after rule + clamp
            'total_amount': Decimal,       # effective_price × nights (or × fraction for hourly)
            'rule_applied': YieldRule | None,
            'floor_ceiling_clamped': bool,
        }
        """
```

**Hard guard (line 1 of compute):** If `booking_type != 'transient'`, return base price immediately with no rule applied.

**Base price resolution:**
1. If `berth.booking_tier` is set and the tier has a `rate_premium_pct`, resolve base from `berth.pricing_tier.unit_price` × (1 + `rate_premium_pct` / 100).
2. Else fall back to `berth.pricing_tier.unit_price`.
3. For hourly: base is the `HourlyBerthConfig.pricing_item.unit_price` (per-hour rate).

**Rule evaluation (ordered by `priority` ascending — lower number = first evaluated):**
```
active rules = YieldRule.objects.filter(
    marina=marina,
    is_active=True,
    valid_from__lte=today or null,
    valid_until__gte=today or null,
).order_by('priority', 'name')
```

For each rule, evaluate its trigger:
- `OCCUPANCY_THRESHOLD`: if `occupancy_scope == 'tier'`, count occupied berths in `rule.booking_tier` (berths with that FK); if `occupancy_scope == 'marina'`, use marina-wide count. Fire if occupancy_pct >= `occupancy_threshold_pct`.
- `DAYS_TO_ARRIVAL`: fire if `(check_in - today).days <= days_to_arrival_lte`.
- `DAYS_IN_ADVANCE`: fire if `(check_in - today).days >= days_in_advance_gte`.
- `GAP_FILL`: fire if there is an adjacent booking on the same berth where the gap between that booking's `check_out` and this `check_in` (or vice versa) is <= `gap_max_nights`.

First match wins — no stacking.

**Action calculation:**
```python
if action_type == 'percent_uplift':    effective = base × (1 + action_value/100)
if action_type == 'percent_discount':  effective = base × (1 - action_value/100)
if action_type == 'fixed_uplift':      effective = base + action_value
if action_type == 'fixed_discount':    effective = base - action_value
```

**Floor/ceiling clamping logic:**
- If `is_hourly=True` and `rule.pricing_model_scope == 'per_night'`: skip this rule entirely (do not fire at all for hourly bookings).
- If `is_hourly=True` and `rule.pricing_model_scope == 'all'`: convert floor/ceiling to hourly basis before clamping: `floor_per_hour = rule.floor_price / 24`, `ceiling_per_hour = rule.ceiling_price / 24`.
- If `is_hourly=True` and `rule.pricing_model_scope == 'per_hour'`: use floor/ceiling as-is.
- For overnight bookings: use floor/ceiling as per-night amounts directly.
- Set `floor_ceiling_clamped = True` if the effective price was adjusted by clamping.

**Total amount:**
- Overnight: `effective_price × nights`
- Hourly: `effective_price × (duration_minutes / 60)`

### Waitlist Sniper integration

When the engine fires a `GAP_FILL` or `DAYS_TO_ARRIVAL` rule in `compute()`, it should return `'sniper_eligible': True` in the result dict. The caller (`BookingViewSet`) is responsible for dispatching the sniper task via `transaction.on_commit()`.

### Unit tests required (`tests/test_engine.py`)

Write tests for each scenario listed in spec §6 step 9:
1. No rule fires → effective_price == base_price
2. Occupancy rule fires at tier scope (mock occupancy query)
3. Occupancy rule fires at marina scope
4. Last-minute (`DAYS_TO_ARRIVAL`) rule fires
5. Gap-fill (`GAP_FILL`) rule fires
6. Seasonal booking → hard guard returns base immediately
7. Floor clamp prevents price dropping below floor (nightly)
8. Floor clamp does not overcharge 2-hour booking (hourly conversion: floor_price/24)
9. Ceiling clamp prevents price exceeding ceiling

---

## API Endpoints

All viewsets filter by `request.user.marina`. Authentication: JWT (existing pattern). URL prefix: `api/v1/revenue/`.

### Endpoint map

| Method | URL | View class | Notes |
|---|---|---|---|
| GET, POST | `revenue/booking-tiers/` | `BookingTierViewSet` list + create | |
| PATCH | `revenue/booking-tiers/{id}/` | `BookingTierViewSet` partial_update | No DELETE |
| GET, POST | `revenue/yield-rules/` | `YieldRuleViewSet` list + create | |
| PATCH | `revenue/yield-rules/{id}/` | `YieldRuleViewSet` partial_update | |
| POST | `revenue/yield-rules/preview/` | `YieldPreviewView` | Calls engine, no persistence |
| GET, POST | `revenue/hourly-configs/` | `HourlyBerthConfigViewSet` | |
| PATCH | `revenue/hourly-configs/{id}/` | `HourlyBerthConfigViewSet` partial_update | |
| GET, POST | `revenue/upgrade-campaigns/` | `UpgradeCampaignViewSet` | Filter: `?status=`, `?booking_id=` |
| PATCH | `revenue/upgrade-campaigns/{id}/` | `UpgradeCampaignViewSet` partial_update | Accept/decline logic |
| GET, POST | `revenue/upsell-offers/` | `UpsellOfferViewSet` | Filter: `?status=`, `?booking_id=` |
| PATCH | `revenue/upsell-offers/{id}/` | `UpsellOfferViewSet` partial_update | Redeem logic |
| GET, POST | `revenue/waitlist/` | `WaitlistEntryViewSet` | |
| DELETE | `revenue/waitlist/{id}/` | `WaitlistEntryViewSet` destroy | Or PATCH `is_active=false` |
| GET, POST | `revenue/competitor-rates/` | `CompetitorRateViewSet` | |
| PATCH, DELETE | `revenue/competitor-rates/{id}/` | `CompetitorRateViewSet` | |
| GET | `revenue/analytics/adr/` | `AdrView` | Params: `from`, `to`, `booking_tier_id` |
| GET | `revenue/analytics/revpab/` | `RevpabView` | Params: `from`, `to` |
| GET | `revenue/analytics/pacing/` | `PacingView` | Params: `future_period_from`, `future_period_to` |
| GET | `revenue/analytics/forecast/` | `ForecastView` | Param: `horizon_days` |
| GET | `revenue/analytics/deferred-revenue/` | `DeferredRevenueView` | Param: `as_of` |

### `YieldPreviewView` — `POST /api/v1/revenue/yield-rules/preview/`

Request body: `{ berth_id, check_in, check_out, booking_type }`. Optionally `is_hourly`, `duration_minutes` for hourly preview.

Response shape:
```json
{
  "base_price_per_night": "55.00",
  "effective_price_per_night": "63.25",
  "total_amount": "189.75",
  "nights": 3,
  "rule_applied": { "id": 5, "name": "...", "action_type": "...", "action_value": "..." },
  "floor_ceiling_clamped": false
}
```
`rule_applied` is `null` if no rule fires.

### `UpgradeCampaignViewSet.partial_update` — accept logic

When `status` changes to `accepted`:
1. Reassign `booking.berth = campaign.offered_berth`.
2. Create `InvoiceLineItem` on the booking's invoice for `differential_amount`, pointing to `offered_berth.pricing_tier` ChargeableItem.
3. Set `responded_at = timezone.now()`.
4. Save booking and campaign.

When `status` changes to `declined`: set `responded_at` only.

### `UpsellOfferViewSet.partial_update` — redeem logic

When `status` changes to `redeemed`:
1. Compute charge: `chargeable_item.unit_price × (1 - discount_pct/100)`.
2. Create `InvoiceLineItem` on the booking's invoice.
3. Set `redeemed_at = timezone.now()` and `invoice_line_item = created_line_item`.

### Analytics views — query logic

**`AdrView`:**
- Filter `Booking` where `status__in=['confirmed', 'checked_in', 'checked_out']` and date range.
- ADR = `sum(amount) / sum(nights)`.
- Group by month using `TruncMonth`.
- Include `competitor_overlay` from `CompetitorRate` records for the period.

**`RevpabView`:**
- RevPAB = `total_revenue / (active_berth_count × days_in_period)`.
- `active_berth_count = marina.berths.filter(status__in=['available','occupied','reserved']).count()`.
- Group by month.

**`PacingView`:**
- Current year: bookings for `future_period_from` to `future_period_to`.
- Prior year same point: bookings created on or before `today - 365 days` for the equivalent prior-year period.
- `pacing_index = current_confirmed_revenue / prior_confirmed_revenue`.

**`ForecastView`:**
- Three windows: 30, 60, 90 days from today.
- Confirmed = status `confirmed`, `checked_in`.
- Tentative = status `pending`, `pending_approval`.

**`DeferredRevenueView`:**
- Gracefully return empty dataset if Track 4 is not installed (wrap import in try/except).
- For each paid invoice where `booking.check_out > as_of`:
  - `daily_rate = invoice.total / booking.nights`
  - Iterate nights from `booking.check_in` to `booking.check_out - 1 day`
  - For each `night_date > as_of`, add `daily_rate` to bucket `night_date.strftime('%Y-%m')`
- Do this in Python, not SQL.
- `bookings_count` = distinct bookings contributing at least one night to that month.
- Add `django.db.connection.queries` logging guard: log WARNING if query time exceeds 500ms.

### Serializers

One serializer per model in `serializers.py`:

- `BookingTierSerializer` — all fields, read-only `id` and `created_at`.
- `YieldRuleSerializer` — all fields. Validate: `action_value > 0`, at least one trigger param filled for the selected trigger type.
- `YieldApplicationSerializer` — all fields read-only.
- `HourlyBerthConfigSerializer` — all fields, add `berth_name` (read-only via source), `pricing_item_name` (read-only via source).
- `UpgradeCampaignSerializer` — all fields, nested `from_tier` and `to_tier` as `{id, name}` (read-only), `offered_berth_name`, `guest_name` (from `booking.guest_name`).
- `UpsellOfferSerializer` — all fields, `chargeable_item_name` as read-only annotated field.
- `WaitlistEntrySerializer` — all fields.
- `WaitlistOfferSerializer` — all fields.
- `CompetitorRateSerializer` — all fields.

---

## Signals

**File:** `backend/apps/revenue_intelligence/signals.py`

No Django signals are needed for the core engine flow. Instead, the integration points are method calls within views:

1. **`BookingViewSet.create()`** (in `apps/reservations/views.py`): after saving the booking, call `YieldEngine(marina).compute(...)`. Write a `YieldApplication` record. If the result has `sniper_eligible: True`, dispatch the sniper task via `transaction.on_commit()`:
   ```python
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

2. **Post-save signal on `WaitlistOffer`** (in `signals.py`): no signal needed — expiry is handled by the `expire_waitlist_offers` sweep task.

**Connect signals in `apps.py` `ready()` method:**
```python
class RevenueIntelligenceConfig(AppConfig):
    name = 'apps.revenue_intelligence'
    def ready(self):
        import apps.revenue_intelligence.signals  # noqa
```
(Only needed if any actual Django signal receivers are defined.)

---

## Tasks (`tasks.py`)

File: `backend/apps/revenue_intelligence/tasks.py`

### Task 1: `run_waitlist_sniper` (called programmatically, not periodic)

```python
@app.task(name='revenue_intelligence.run_waitlist_sniper')
def run_waitlist_sniper(berth_id, check_in, check_out, discounted_price, marina_id):
```

Logic:
1. Query active `WaitlistEntry` records where `vessel_length_m` fits `berth.length_m` and date range overlaps `check_in/check_out`.
2. For each matching entry, create a `WaitlistOffer` row with `expires_at = now() + timedelta(hours=2)`.
3. Generate a single-use Stripe Checkout link and store in `stripe_checkout_url`.
4. Send email via Zoho SMTP (Django's `send_mail` or `anymail` backend).
5. State lives in the database — no Redis countdown used.

### Task 2: `expire_waitlist_offers` (periodic — every 5 minutes)

```python
@app.task(name='revenue_intelligence.expire_waitlist_offers')
def expire_waitlist_offers():
    now = timezone.now()
    qs = WaitlistOffer.objects.filter(status='pending', expires_at__lte=now)
    for offer in qs:
        offer.status = 'expired'
        offer.save(update_fields=['status'])
        # Publish discounted rate to public widget (set cache key or DB flag)
```

### Task 3: `run_upgrade_campaigns` (periodic — daily at 03:00)

```python
@app.task(bind=True, max_retries=3, default_retry_delay=60,
          name='revenue_intelligence.run_upgrade_campaigns')
def run_upgrade_campaigns(self):
```

Logic per marina:
1. Find bookings with `check_in` within 3 days, booking in a non-Premium `BookingTier`.
2. Check Premium tier occupancy for the arrival date — skip if >= 70%.
3. Find an available Premium berth for the booking's dates.
4. Compute `differential_amount` using `YieldEngine.compute()` for the offered berth minus `booking.amount`. Skip if <= 0.
5. Create `UpgradeCampaign` record.
6. Generate Stripe Checkout link for `differential_amount`.
7. Send upgrade email via Zoho SMTP.
8. On email failure: `self.retry(exc=exc)`.

### Task 4: `scrape_competitor_rates` (periodic — weekly, Sunday 06:00 UTC)

```python
@app.task(name='revenue_intelligence.scrape_competitor_rates')
def scrape_competitor_rates():
```

For each `CompetitorRate` with a `competitor_url`, the task is defined in `scraper.py` and called from here. See scraper section below.

### Celery beat schedule (add to `settings/base.py`):

```python
from celery.schedules import crontab

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
        'schedule': crontab(minute='*/5'),
    },
}
```

---

## Admin (`admin.py`)

```python
# backend/apps/revenue_intelligence/admin.py
from django.contrib import admin
from .models import (
    BookingTier, YieldRule, YieldApplication,
    HourlyBerthConfig, UpgradeCampaign, UpsellOffer,
    WaitlistEntry, WaitlistOffer, CompetitorRate,
)

@admin.register(YieldRule)
class YieldRuleAdmin(admin.ModelAdmin):
    list_display = ['name', 'priority', 'trigger_type', 'action_type', 'action_value', 'is_active']
    list_filter  = ['marina', 'trigger_type', 'is_active']
    ordering     = ['priority', 'name']

@admin.register(YieldApplication)
class YieldApplicationAdmin(admin.ModelAdmin):
    list_display = ['pk', 'booking', 'rule_name_snapshot', 'base_price', 'computed_price', 'applied_at']
    list_filter  = ['marina']
    readonly_fields = ['applied_at']

@admin.register(UpgradeCampaign)
class UpgradeCampaignAdmin(admin.ModelAdmin):
    list_display = ['pk', 'booking', 'from_tier', 'to_tier', 'differential_amount', 'status', 'sent_at']
    list_filter  = ['marina', 'status']

@admin.register(CompetitorRate)
class CompetitorRateAdmin(admin.ModelAdmin):
    list_display = ['competitor_name', 'vessel_length_m', 'rate_per_night', 'valid_from', 'source', 'scraped_at']
    list_filter  = ['marina', 'source']

# Register remaining models with default admin
admin.site.register(BookingTier)
admin.site.register(HourlyBerthConfig)
admin.site.register(UpsellOffer)
admin.site.register(WaitlistEntry)
admin.site.register(WaitlistOffer)
```

---

## Settings and URL Wiring

### `config/settings/base.py`

Add to `LOCAL_APPS`:
```python
'apps.revenue_intelligence',
'django_celery_beat',   # if not already present
```

Add Celery settings (if not present from another track):
```python
CELERY_BROKER_URL      = env('REDIS_URL')
CELERY_RESULT_BACKEND  = env('REDIS_URL')
CELERY_ACCEPT_CONTENT  = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
```

Add `CELERY_BEAT_SCHEDULE` dict (see Tasks section above). Import `crontab` from `celery.schedules` at the top of `base.py`.

### `config/urls.py`

Add inside the `api/v1/` block:
```python
path('', include('apps.revenue_intelligence.urls')),
```
The existing `path('', include('apps.revenue.urls'))` remains untouched.

### `backend/celery.py` (create if not present)

```python
import os
from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.base')
app = Celery('backend')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()
```

### `backend/__init__.py`

```python
from .celery import app as celery_app
__all__ = ('celery_app',)
```

---

## Migration Notes

Run in this order:

1. `python manage.py makemigrations billing` — adds `is_upsell_eligible` to `ChargeableItem`
2. `python manage.py makemigrations reservations` — adds `start_time`, `end_time`, `is_hourly`, `dynamic_price_applied` to `Booking`
3. `python manage.py makemigrations revenue_intelligence` — creates all 9 new models
4. `python manage.py makemigrations berths` — adds `booking_tier` FK to `Berth` (depends on `revenue_intelligence` migration being present first)
5. `python manage.py makemigrations django_celery_beat` — if `django_celery_beat` is newly added
6. `python manage.py migrate`

No `btree_gist` extension is required for Track 1 (that is a Track 2 concern).

---

## Implementation Order

Follow this exact sequence — each step depends on the previous.

**Step 1 — Create the `revenue_intelligence` app skeleton**
- `cd backend && python manage.py startapp revenue_intelligence apps/revenue_intelligence`
- Create `apps.py` with `name = 'apps.revenue_intelligence'`
- Create empty `models.py`, `serializers.py`, `views.py`, `urls.py`, `admin.py`, `engine.py`, `tasks.py`, `scraper.py`
- Add `'apps.revenue_intelligence'` to `LOCAL_APPS` in `settings/base.py`

**Step 2 — Write models and run initial migrations**
- Write `BookingTier` model in `revenue_intelligence/models.py`
- Write `YieldRule` model
- Write `YieldApplication` model
- Write `HourlyBerthConfig` model
- Write `UpgradeCampaign` model
- Write `UpsellOffer` model
- Write `WaitlistEntry` and `WaitlistOffer` models
- Write `CompetitorRate` model
- `makemigrations billing` (adds `is_upsell_eligible`)
- `makemigrations reservations` (adds hourly fields + `dynamic_price_applied`)
- `makemigrations revenue_intelligence`
- `makemigrations berths` (adds `booking_tier` FK — references `revenue_intelligence.BookingTier`)
- `migrate`

**Step 3 — Write serializers**
- All 9 model serializers in `serializers.py`
- Include nested read-only fields per spec
- Add validation to `YieldRuleSerializer`

**Step 4 — Write `YieldEngine` in `engine.py`**
- Implement `YieldEngine` class with full `compute()` method
- Implement all trigger type evaluations
- Implement all action type calculations
- Implement floor/ceiling clamping with `pricing_model_scope` logic
- Write unit tests in `tests/test_engine.py` (all 9 scenarios from spec)

**Step 5 — Write CRUD viewsets and URL configuration**
- Implement all 8 viewsets + `YieldPreviewView` in `views.py`
- Implement `UpgradeCampaignViewSet.partial_update` accept/decline logic
- Implement `UpsellOfferViewSet.partial_update` redeem logic
- Wire all URLs in `urls.py`
- Register URL in `config/urls.py`

**Step 6 — Write analytics views**
- Implement `AdrView`, `RevpabView`, `PacingView`, `ForecastView`, `DeferredRevenueView` in `views.py`
- Add query time logging guard (>500ms → log WARNING)
- Wire URLs
- Write integration tests in `tests/test_analytics.py`

**Step 7 — Wire `YieldEngine` into `BookingViewSet`**
- In `apps/reservations/views.py`, import `YieldEngine` from `apps.revenue_intelligence.engine`
- In `create()` (or `perform_create()`): call `engine.compute()`, store `dynamic_price_applied` on booking, write `YieldApplication` record
- If `sniper_eligible` in result: dispatch `run_waitlist_sniper` via `transaction.on_commit()`
- Ensure booking `amount` is set to `result['total_amount']`

**Step 8 — Set up Celery**
- Create `backend/celery.py` and update `backend/__init__.py`
- Install packages: `pip install celery redis django-celery-beat`
- Add Celery settings to `settings/base.py`
- Add `CELERY_BEAT_SCHEDULE` to `settings/base.py`
- Add `'django_celery_beat'` to `THIRD_PARTY_APPS`

**Step 9 — Write tasks**
- Implement `run_waitlist_sniper` task in `tasks.py`
- Implement `expire_waitlist_offers` task in `tasks.py`
- Implement `run_upgrade_campaigns` task in `tasks.py` (including Stripe Checkout link generation and Zoho SMTP email)
- Implement `scrape_competitor_rates` task in `tasks.py` (delegates to `scraper.py`)

**Step 10 — Write competitor scraper**
- Implement `scrape_competitor_rates()` in `scraper.py` using `requests` + `BeautifulSoup`
- For each `CompetitorRate` with `competitor_url`: fetch page, parse rate, update record with `source='scraper'` and `scraped_at=now()`

**Step 11 — Wire Stripe webhook for upgrade acceptance**
- In the existing Stripe webhook handler (or a new one), handle `checkout.session.completed` events where metadata includes `upgrade_campaign_id`
- Call the same berth-swap + `InvoiceLineItem` logic as the `PATCH` endpoint accept path

**Step 12 — Register admin**
- Write `admin.py` as specified above

**Step 13 — Frontend (backend team hands off)**
- Add "Revenue" sidebar group
- Build `PricingRulesScreen.jsx` with `YieldRuleDrawer`, `BookingTierDrawer`, `YieldPreviewPanel`
- Build `ForecastingScreen.jsx` with 4 tabs and all chart components
- Build `CampaignsScreen.jsx` with upgrade campaigns and upsell tabs
- Update booking creation form for yield preview and hourly toggle
- Build public booking flow add-ons box
- Write all 12 hooks listed in spec §5.6

**Step 14 — Railway deployment**
- Add `Procfile` entries for `worker` and `beat` processes
- Set `REDIS_URL` environment variable in Railway

---

## Cross-cutting Notes

- The existing `apps/revenue` app stays registered in `INSTALLED_APPS` and its URLs remain active. Do not remove it until a deliberate deprecation phase.
- All new viewsets must enforce `request.user.marina` filtering — never expose cross-marina data.
- The `DeferredRevenueView` must gracefully handle the absence of Track 4's `DeferredRevenueRecognitionLog` — wrap the import in `try/except ImportError` and return an empty `by_month: []` list.
- The `run_waitlist_sniper` task must be dispatched inside `transaction.on_commit()` — never call `.delay()` directly inside the view body, as the booking row may not yet be committed to the database.
