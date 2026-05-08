# Track 12 — Sustainability & ESG: Installation Guide

## Prerequisites

### 1. Python packages
Add to `requirements.txt` before deploying:

```
weasyprint>=60.0          # PDF generation
requests>=2.31.0          # Play It Green API calls
```

> WeasyPrint requires system-level GTK/Pango libraries.
> On Ubuntu/Debian: `apt-get install -y libpango-1.0-0 libpangoft2-1.0-0`

### 2. Prior migrations that must run first

| App          | Migration                               | Adds                                     |
|--------------|-----------------------------------------|------------------------------------------|
| `accounts`   | `0016_remove_marina_channel_fields`     | Marina base (already present)            |
| `billing`    | `0012_chargeableitem_is_discountable_and_more` | `ChargeableItem.is_discountable` |
| `fuel_dock`  | `0003_fueldockentry_is_internal_use`    | `FuelDockEntry.is_internal_use`          |
| `reservations` | `0012_booking_track2_fields`          | Booking fields (already present)         |
| `staff`      | `0002_certification_pdf_file_staffmember_user` | StaffMember.user FK             |

### 3. Redis
Redis must be configured as the Django cache backend (used for ledger-staleness debounce):

```python
# config/settings/base.py
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.redis.RedisCache',
        'LOCATION': env('REDIS_URL', default='redis://localhost:6379/1'),
    }
}
```

### 4. Celery
Celery must be configured. The PDF generation task routes to a dedicated queue with memory limits — run a separate worker for it:

```bash
# Main worker
celery -A backend worker --queues celery --concurrency 4

# PDF generation worker (run separately)
celery -A backend worker \
    --queues pdf_generation \
    --concurrency 1 \
    --max-tasks-per-child 1 \
    --max-memory-per-child 512000
```

### 5. File storage for PDF archives
`ESGReportArchive.pdf_file` uses Django's default file storage. Configure `DEFAULT_FILE_STORAGE` (or `STORAGES`) to point to S3/GCS in production.

---

## Installation

### Step 1 — Register the app

```python
# config/settings/base.py
LOCAL_APPS = [
    # ... existing apps ...
    'apps.sustainability',
]
```

### Step 2 — Add URL routes

```python
# config/urls.py
urlpatterns = [
    # ... existing routes ...
    path('api/sustainability/', include('apps.sustainability.urls')),
]
```

### Step 3 — Run migrations

```bash
python manage.py migrate sustainability
```

This runs two migrations:
- `0001_initial` — creates all 10 sustainability models
- `0002_seed_emission_factors` — seeds DEFRA 2023 UK factors for all existing Marina rows

### Step 4 — Seed US emission factors (production only)

The data migration seeds UK (DEFRA 2023) factors automatically. To also seed US (EPA eGRID 2022) factors run:

```bash
python manage.py seed_emission_factors
```

This command is idempotent — safe to run multiple times.

---

## Celery Beat Schedule

Add to `CELERY_BEAT_SCHEDULE` in `config/settings/base.py`:

```python
from celery.schedules import crontab

CELERY_BEAT_SCHEDULE = {
    # ... existing entries ...

    'fetch-grid-intensity': {
        'task': 'sustainability.fetch_grid_intensity',
        'schedule': crontab(hour=2, minute=0),           # daily 02:00 UTC
    },
    'calculate-scope3-fuel-dock': {
        'task': 'sustainability.calculate_scope3_fuel_dock',
        'schedule': crontab(day_of_month=1, hour=3, minute=0),  # monthly 1st 03:00 UTC
    },
    'roll-sustainability-ledger': {
        'task': 'sustainability.roll_sustainability_ledger',
        'schedule': crontab(hour=4, minute=0),           # nightly 04:00 UTC
    },
    'sync-play-it-green': {
        'task': 'sustainability.sync_play_it_green',
        'schedule': crontab(day_of_week=0, hour=5, minute=0),  # weekly Sunday 05:00 UTC
    },
}

CELERY_TASK_ROUTES = {
    'sustainability.generate_esg_report_async': {'queue': 'pdf_generation'},
}
```

---

## Marina Feature Flags

Enable features per-marina via `Marina.features` (a JSONField):

| Key                              | Type    | Default | Effect                                                          |
|----------------------------------|---------|---------|-----------------------------------------------------------------|
| `esg_enabled`                    | bool    | `false` | Gates all ESG API endpoints (returns 403 when false)            |
| `live_grid_intensity_enabled`    | bool    | `false` | When true, uses National Grid ESO API for Scope 2 intensity     |
| `play_it_green_api_key`          | string  | `null`  | PIG API key — sync skipped when absent                          |
| `esg_gri_annex_enabled`          | bool    | `false` | Appends GRI Standards annex to PDF reports                      |

Example (via Django shell or admin):
```python
marina.features['esg_enabled'] = True
marina.features['play_it_green_api_key'] = 'pig-live-xxxxx'
marina.save()
```

---

## Scope 1 / Scope 3 Double-Counting Prevention

`FuelDockEntry.is_internal_use` (added by `fuel_dock/migrations/0003`) controls this:

- `is_internal_use=False` (default) — customer fuel sales → counted in **Scope 3** (category: `fuel_sold_vessels`)
- `is_internal_use=True` — marina's own vehicles/plant → counted in **Scope 1** only (via manual Scope1Record)

Mark internal entries at the point of fuelling in the fuel dock UI or via API:
```json
{ "is_internal_use": true }
```

---

## Ledger Staleness & Debounce

When any Scope 1/2/3 record or WasteLog is saved, a `post_save` signal flags the corresponding `SustainabilityLedger` row as `is_stale=True` and queues a `recalculate_ledger_period` task. Duplicate signals within 60 seconds are collapsed via Redis `cache.add()` (atomic set-if-not-exists):

```
cache.add('ledger:recalc:{marina_id}:{period}', '1', timeout=60)
```

This prevents recalculation stampede when bulk-importing records.

---

## Manual Scope 2 Override Guard

`Scope2Record` rows with `data_source='manual'` are never overwritten by the nightly `roll_sustainability_ledger` task. The task skips any period where a manual record exists. To switch back to automated calculation, delete the manual record via the API or admin.

---

## ESG Report Formats

| Format | Status      | Notes                                               |
|--------|-------------|-----------------------------------------------------|
| `pdf`  | Supported   | 9-section report; optional GRI annex                |
| `tcfd` | Not yet     | Returns HTTP 400 — renderer not implemented          |

---

## Track 4 Integration (Deferred Revenue)

`SustainabilityLedger.revenue_gbp` uses recognised revenue when Track 4 (`DeferredRevenueRecognitionLog`) is installed. If Track 4 is not present, the calculation gracefully falls back to gross `Invoice.total` for the period. No configuration change required — the import is wrapped in a `try/except ImportError`.

---

## Known Limitations

1. **TCFD format not implemented** — `generate()` returns HTTP 400 for `report_format='tcfd'`. Planned for a future track.
2. **National Grid ESO API** — `fetch_grid_intensity` currently fetches UK half-hourly data. US EPA eGRID intensity must be set via manual `GridCarbonIntensity` records or the emission factor library.
3. **Play It Green certificate pull** — `sync_play_it_green` pushes contributions but certificate retrieval depends on PIG API v2 bulk endpoint availability. Missing certificates are logged in `PlayItGreenSync` with `status='pending_certificate'`.
4. **WeasyPrint memory** — PDF generation can exceed 400 MB for large date ranges. The dedicated `pdf_generation` Celery worker with `--max-memory-per-child 512000` is mandatory in production.
