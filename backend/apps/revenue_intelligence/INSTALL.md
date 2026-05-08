# Revenue Intelligence — Installation Guide

This document lists all changes required to **existing** apps and configuration
files.  No existing file was modified as part of the initial scaffold; all
changes are described here so they can be applied deliberately.

---

## 1. Register the app — `config/settings/base.py`

Add `'apps.revenue_intelligence'` to `LOCAL_APPS`:

```python
LOCAL_APPS = [
    ...
    'apps.revenue_intelligence',
]
```

---

## 2. Wire URLs — `config/urls.py`

Inside the `api/v1/` URL block, include the revenue intelligence URLs:

```python
path('', include('apps.revenue_intelligence.urls')),
```

All endpoints are prefixed with `revenue/` within the router, so they will
be available at `/api/v1/revenue/...`.

---

## 3. Add `booking_tier` FK to `berths.Berth` — `apps/berths/models.py`

```python
booking_tier = models.ForeignKey(
    'revenue_intelligence.BookingTier',
    on_delete=models.SET_NULL,
    null=True,
    blank=True,
    related_name='berths',
)
```

Then create a migration in the `berths` app:

```bash
python manage.py makemigrations berths --name add_booking_tier_to_berth
```

---

## 4. Add `is_upsell_eligible` to `billing.ChargeableItem` — `apps/billing/models.py`

```python
is_upsell_eligible = models.BooleanField(
    default=False,
    help_text='Mark items that can be offered as upsells during booking or check-in.',
)
```

Then create a migration in the `billing` app:

```bash
python manage.py makemigrations billing --name add_is_upsell_eligible_to_chargeableitem
```

---

## 5. Add hourly / dynamic-price fields to `reservations.Booking` — `apps/reservations/models.py`

```python
# Hourly berthing support
start_time = models.TimeField(null=True, blank=True)
end_time = models.TimeField(null=True, blank=True)
is_hourly = models.BooleanField(default=False)

# Dynamic pricing audit
dynamic_price_applied = models.DecimalField(
    max_digits=10, decimal_places=2, null=True, blank=True
)
```

Then create a migration in the `reservations` app:

```bash
python manage.py makemigrations reservations --name add_hourly_and_dynamic_price_fields
```

---

## 6. Celery configuration — `config/settings/base.py`

### Basic Celery settings

```python
CELERY_BROKER_URL = env('REDIS_URL', default='redis://localhost:6379/0')
CELERY_RESULT_BACKEND = env('REDIS_URL', default='redis://localhost:6379/0')
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = 'UTC'
```

### Beat schedule

```python
from celery.schedules import crontab

CELERY_BEAT_SCHEDULE = {
    # Expire pending waitlist offers every 5 minutes.
    'expire-waitlist-offers': {
        'task': 'revenue_intelligence.expire_waitlist_offers',
        'schedule': crontab(minute='*/5'),
    },
    # Run upgrade campaign scan daily at 03:00 UTC.
    'run-upgrade-campaigns': {
        'task': 'revenue_intelligence.run_upgrade_campaigns',
        'schedule': crontab(hour=3, minute=0),
    },
    # Scrape competitor rates every Sunday at 06:00 UTC.
    'scrape-competitor-rates': {
        'task': 'revenue_intelligence.scrape_competitor_rates',
        'schedule': crontab(hour=6, minute=0, day_of_week='sunday'),
    },
}
```

---

## 7. Hook YieldEngine into booking creation — `apps/reservations/views.py`

After a booking is created (e.g. in the `BookingViewSet.perform_create` or
equivalent service function), call the engine, persist a `YieldApplication`,
and conditionally dispatch the waitlist sniper:

```python
from django.db import transaction
from apps.revenue_intelligence.engine import YieldEngine
from apps.revenue_intelligence.models import YieldApplication
from apps.revenue_intelligence.tasks import run_waitlist_sniper

def _apply_yield_to_booking(booking):
    """Call after booking.save() inside an atomic block."""
    marina = booking.marina
    berth = booking.berth
    if berth is None:
        return

    engine = YieldEngine(marina)
    result = engine.compute(
        berth=berth,
        check_in=booking.check_in,
        check_out=booking.check_out,
        booking_type=booking.booking_type,
        is_hourly=getattr(booking, 'is_hourly', False),
    )

    YieldApplication.objects.create(
        marina=marina,
        booking=booking,
        rule=None,  # Resolve via rule name if needed.
        rule_name_snapshot=result['rule_applied'] or '',
        base_price=result['base_price'],
        computed_price=result['effective_price'],
        floor_ceiling_clamped=result['floor_ceiling_clamped'],
    )

    # Update the booking amount with the dynamic price.
    if result['effective_price'] != result['base_price']:
        booking.amount = result['total_amount']
        booking.dynamic_price_applied = result['effective_price']
        booking.save(update_fields=['amount', 'dynamic_price_applied'])

    # Dispatch sniper task if eligible (gap-fill / last-minute discount).
    if result['sniper_eligible']:
        transaction.on_commit(
            lambda: run_waitlist_sniper.delay(
                berth_id=berth.pk,
                check_in=str(booking.check_in),
                check_out=str(booking.check_out),
                discounted_price=str(result['effective_price']),
                marina_id=marina.pk,
            )
        )
```

---

## 8. Run migrations

After all model changes have been applied:

```bash
python manage.py migrate
```

---

## 9. Optional: seed BookingTiers

Create at least one `BookingTier` per marina via the Django admin or a data
migration before assigning `booking_tier` to berths.
