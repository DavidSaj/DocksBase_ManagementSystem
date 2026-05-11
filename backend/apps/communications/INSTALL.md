# Track 7 — Communications & OTA: Installation Instructions

## 1. Add apps to LOCAL_APPS

In `config/settings/base.py`, add to `LOCAL_APPS`:

```python
LOCAL_APPS = [
    # ... existing apps ...
    'apps.communications',
    'apps.channels',
]
```

## 2. Add URL routes

In `config/urls.py`, inside the `api/v1/` urlpatterns block, add:

```python
path('communications/', include('apps.communications.urls')),
path('channels/', include('apps.channels.urls')),
```

The communications URLs include nested routes (journeys/{id}/steps/) which require
`djangorestframework-nested` — install with:
```
pip install drf-nested-routers
```

## 3. Run migrations

```bash
python manage.py makemigrations communications
python manage.py makemigrations channels
python manage.py makemigrations billing      # CouponCode, CouponRedemption added
python manage.py makemigrations portal       # BookingWidgetConfig added
python manage.py makemigrations accounts     # MarinaGroup, MarinaGroupMembership, MarinaGroupUserRole added
python manage.py makemigrations members      # whatsapp_opt_in field added to Member
python manage.py migrate
```

## 4. Add settings to config/settings/base.py

```python
# WhatsApp / Meta Cloud API
WHATSAPP_PROVIDER = 'meta'                  # currently only 'meta' supported
WHATSAPP_VERIFY_TOKEN = env('WHATSAPP_VERIFY_TOKEN', default='')
WHATSAPP_ACCESS_TOKEN = env('WHATSAPP_ACCESS_TOKEN', default='')
WHATSAPP_APP_SECRET   = env('WHATSAPP_APP_SECRET', default='')  # for X-Hub-Signature-256 validation

# Twilio (SMS)
TWILIO_ACCOUNT_SID  = env('TWILIO_ACCOUNT_SID', default='')
TWILIO_AUTH_TOKEN   = env('TWILIO_AUTH_TOKEN', default='')
TWILIO_FROM_NUMBER  = env('TWILIO_FROM_NUMBER', default='')

# OTA channel webhook tokens (per-provider)
OTA_WEBHOOK_TOKENS = {
    'dockwa':         env('OTA_TOKEN_DOCKWA', default=''),
    'rentals_united': env('OTA_TOKEN_RENTALS_UNITED', default=''),
    'pitchup':        env('OTA_TOKEN_PITCHUP', default=''),
    'snag_a_slip':    env('OTA_TOKEN_SNAG_A_SLIP', default=''),
    'mysea':          env('OTA_TOKEN_MYSEA', default=''),
    'noforeignland':  env('OTA_TOKEN_NOFOREIGNLAND', default=''),
}

# Booking widget token expiry
WIDGET_BOOKING_TOKEN_EXPIRY_SECONDS = 3600

# Fernet encryption key (used by apps.accounting.fields.EncryptedCharField)
# Generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
FERNET_KEYS = [env('FERNET_KEY', default='')]
```

## 5. Add Celery beat schedule entries

In your Celery beat config (e.g. `config/celery.py` or beat schedule dict), add:

```python
from celery.schedules import crontab

CELERY_BEAT_SCHEDULE = {
    # ... existing entries ...
    'evaluate-journey-steps': {
        'task': 'apps.communications.tasks.evaluate_journey_steps',
        'schedule': crontab(minute='*/5'),   # every 5 minutes
    },
    'send-scheduled-campaigns': {
        'task': 'apps.communications.tasks.send_scheduled_campaigns',
        'schedule': crontab(minute='*/10'),
    },
    'pick-ab-test-winner': {
        'task': 'apps.communications.tasks.pick_ab_test_winner',
        'schedule': crontab(minute=0, hour='*/1'),  # hourly
    },
    'push-ota-availability': {
        'task': 'apps.channels.tasks.push_ota_availability',
        'schedule': crontab(minute=0, hour=3),  # daily at 03:00
    },
    'pull-ota-bookings': {
        'task': 'apps.channels.tasks.pull_ota_bookings',
        'schedule': crontab(minute='*/15'),  # every 15 minutes
    },
}
```

## 6. Wire OTA delta sync in reservations/receivers.py

In `apps/reservations/receivers.py`, add a post_save receiver on Booking to trigger
OTA availability delta push and journey enrollment:

```python
from django.db.models.signals import post_save
from django.dispatch import receiver
from django.db import transaction

@receiver(post_save, sender='reservations.Booking')
def on_booking_saved(sender, instance, created, **kwargs):
    from apps.channels.tasks import push_ota_availability_delta
    from apps.communications.services.journey import enroll_in_journey
    from apps.communications.models import Journey

    # OTA delta push: push availability for affected berth when a booking is saved
    if instance.berth_id:
        date_from = str(instance.start_date)
        date_to = str(instance.end_date)
        transaction.on_commit(
            lambda: push_ota_availability_delta.delay(instance.berth_id, date_from, date_to)
        )

    # Journey enrollment: enroll member in BOOKING_CONFIRMED journeys on creation
    if created and instance.member_id:
        marina = instance.marina
        journeys = Journey.objects.filter(
            marina=marina,
            trigger_event=Journey.TriggerEvent.BOOKING_CONFIRMED,
            is_active=True,
        )
        for journey in journeys:
            transaction.on_commit(
                lambda jid=journey.pk: enroll_in_journey(
                    journey_id=jid,
                    marina=marina,
                    member=instance.member,
                    booking=instance,
                )
            )
```

## 7. EncryptedCharField note

`apps.channels.models.OTAChannel.api_key` and `api_secret` use `apps.accounting.fields.EncryptedCharField`
(NOT `django-fernet-fields`, which is broken on Django 6). This field requires `FERNET_KEYS` to be set
in settings (see step 4). In development without a key, values are stored as plaintext.

## 8. DotdigitalConfig.api_password note

`DotdigitalConfig.api_password` is stored as a plain CharField. For production deployments, consider
converting it to `EncryptedCharField` from `apps.accounting.fields` or storing it in a secrets manager.

## 9. CouponCode note

`CouponCode` already exists in `apps/loyalty/models.py` (added by a previous track).
Track 7 did NOT add a duplicate — a comment placeholder was left in `apps/billing/models.py`
instead. The single source of truth for coupons is `apps.loyalty.models.CouponCode`.
No additional migration is required for coupons.
