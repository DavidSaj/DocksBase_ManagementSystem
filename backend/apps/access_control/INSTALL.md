# Track 11 — Security & Access Control: Installation Guide

## Prerequisites (must be done BEFORE running access_control migrations)

### 1. Add `pier_label` to `berths.Berth`

Already done by this PR — see `apps/berths/migrations/0028_berth_pier_label.py`.

Run:
```bash
python manage.py migrate berths
```

### 2. Install `django-encrypted-model-fields`

```bash
pip install django-encrypted-model-fields
```

Add to `.env`:
```
BIOMETRIC_FIELD_KEY=your-32-byte-base64-encoded-key-here
```

Generate a key:
```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

### 3. Redis Cache

The ANPR debounce and HAL on_commit dispatch require Redis. Ensure `REDIS_URL` is set in `.env` and `CACHES` in `settings/base.py` uses `django.core.cache.backends.redis.RedisCache`.

### 4. `fuel_dock.FuelDockEntry.is_internal_use`

Already added by `apps/fuel_dock/migrations/0003_fueldockentry_is_internal_use.py` (Track 12 prerequisite, also needed here for the SpendAuthorisationRequest FK).

Run:
```bash
python manage.py migrate fuel_dock
```

---

## `config/settings/base.py` — Add to `LOCAL_APPS`

```python
LOCAL_APPS = [
    # ... existing apps ...
    'encrypted_model_fields',   # THIRD_PARTY_APPS (add here or in THIRD_PARTY_APPS)
    'apps.access_control',
]

# Encryption key for BiometricEnrolment.template_handle
FIELD_ENCRYPTION_KEY = os.environ.get('BIOMETRIC_FIELD_KEY', '')
```

---

## `config/urls.py` — Add URL include

```python
path('api/v1/access-control/', include('apps.access_control.urls')),
```

Place after existing ERP track includes.

---

## Run Migrations

```bash
python manage.py migrate access_control
```

This runs:
- `0001_initial` — creates all 13 models
- `0002_seed_fraud_thresholds` — seeds fraud detection defaults into Marina.features

---

## Celery Beat Schedule (add to `settings/base.py` when Celery is wired)

```python
CELERY_BEAT_SCHEDULE = {
    # ... existing ...
    'deactivate-expired-access-cards': {
        'task':     'access_control.deactivate_expired_access_cards',
        'schedule': crontab(hour=1, minute=0),       # daily at 01:00
    },
    'detect-fraud-anomalies': {
        'task':     'access_control.detect_fraud_anomalies',
        'schedule': crontab(hour=3, minute=0),       # daily at 03:00
    },
    'purge-old-access-events': {
        'task':     'access_control.purge_old_access_events',
        'schedule': crontab(hour=2, minute=0),       # nightly at 02:00
    },
}
```

---

## Feature Flags (set per marina in `marina.features`)

| Key | Default | Description |
|-----|---------|-------------|
| `rfid_adapter` | `"demo"` | HAL adapter: `"demo"`, `"paxton_net2"`, `"salto"` |
| `anpr_adapter` | `"demo"` | ANPR adapter |
| `biometric_adapter` | `"demo"` | Biometric adapter |
| `anpr_enabled` | `false` | Enable ANPR endpoints for this marina |
| `biometric_enabled` | `false` | Enable biometric endpoints |
| `anpr_debounce_seconds` | `60` | ANPR debounce window |
| `anpr_confidence_threshold` | `0.85` | Minimum ANPR confidence to accept |
| `access_log_retention_days` | `730` | Days to keep AccessEvent rows |
| `max_cards_per_member` | `4` | Max active cards per member |
| `access_webhook_secret` | `""` | HMAC secret for ingest webhooks |
| `fraud_discount_count_threshold` | `3` | Discounts/24h before alert |
| `fraud_writeoff_threshold_amount` | `"200.00"` | Write-off GBP threshold |
| `fraud_after_hours_start` | `"22:00"` | After-hours window start |
| `fraud_after_hours_end` | `"06:00"` | After-hours window end |

---

## Hardware Ingest Webhook Setup

Each hardware reader must send events to:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/access-control/ingest/rfid/` | POST | RFID card reads |
| `/api/v1/access-control/ingest/anpr/` | POST | ANPR plate reads |
| `/api/v1/access-control/ingest/biometric/` | POST | Biometric auth events |

All requests must include:
- `X-DocksBase-Marina-ID: {marina_pk}`
- `X-DocksBase-Signature: {hmac_sha256_hex}` (when `access_webhook_secret` is set)

---

## Known Limitations (v1)

- `BiometricEnrolment` schema is defined; terminal SDK integration deferred to v2.
- `SpendAuthorisationRequest.pos_order` FK is commented out — no POS/Sale model exists yet in `apps/sales/`.
- RFID adapters `paxton_net2` and `salto` are stubbed in factory comments only.
- The `revoke_biometric_enrolment` task's retry logic requires Celery (`@shared_task`). Until Celery is wired, it is called synchronously via `transaction.on_commit()`.
