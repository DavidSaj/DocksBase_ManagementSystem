# Track 2 — Berth Intelligence: Installation Notes

## 1. Register the new app

Add `'apps.movements'` to `LOCAL_APPS` in `config/settings/base.py`:

```python
LOCAL_APPS = [
    ...
    'apps.movements',
]
```

## 2. Wire URLs

In `config/urls.py`, inside the `api/v1/` block, add:

```python
path('', include('apps.movements.urls')),
```

This exposes `VesselMovement` at `/api/v1/berths/movements/` for API consistency.

All other Track 2 routes are already included via `apps.berths.urls` and `apps.reservations.urls`.

## 3. Run migrations in order

```bash
python manage.py makemigrations members        # adds sublet_opt_in
python manage.py makemigrations accounts       # adds 7 Marina approval/alert fields
python manage.py makemigrations reservations   # adds document-gate fields + is_sublet
python manage.py makemigrations berths         # 0029_berth_air_draft + 0030_berth_intelligence_models
python manage.py makemigrations movements      # 0001_initial (VesselMovement)
python manage.py migrate
```

Migration `0029_berth_intelligence_models` includes a `RunPython` data migration
that auto-creates a `BerthScoreWeights` row (default weights) for every existing marina.

## 4. PostgreSQL btree_gist extension (optional — not required for Track 2)

Track 2 does NOT use `ExclusionConstraint`. Availability is computed via ORM date-overlap
queries, not PostgreSQL range exclusion constraints.

If a future track adds `ExclusionConstraint` for booking overlap, the following must run
**before** that migration:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

This must be added as a `RunSQL` step in the migration that introduces the constraint,
and `django.contrib.postgres` must be in `INSTALLED_APPS`.

## 5. Celery beat schedule

Add to `CELERY_BEAT_SCHEDULE` in `config/settings/base.py`:

```python
from celery.schedules import crontab

CELERY_BEAT_SCHEDULE = {
    ...
    'check-non-returns': {
        'task': 'berths.check_non_returns',
        'schedule': crontab(minute='*/30'),
    },
}
```

## 6. New API endpoints summary

### apps/berths/urls.py (appended)

| Method | URL | Description |
|--------|-----|-------------|
| GET | `berths/smart-assign/` | Ranked available berths for vessel+dates |
| GET/PATCH | `berths/score-weights/` | Per-marina scorer weight configuration |
| POST | `berths/fleet-assign/` | Async fleet assignment (202 Accepted) |
| GET | `berths/fleet-assign/{job_id}/status/` | Poll job status |
| GET, POST | `berths/temporary-departures/` | Temp departure management |
| PATCH | `berths/temporary-departures/{id}/` | Update departure |
| POST | `berths/temporary-departures/{id}/activate/` | Activate departure, create movement |
| POST | `berths/temporary-departures/{id}/return/` | Process return + collision handling |
| GET | `berths/sublet-bookings/` | View sub-let bookings |
| POST | `berths/sublet-bookings/{id}/apply-credit/` | Apply revenue credit to holder |
| GET, POST | `berths/dock-walk/sessions/` | Dock walk session management |
| GET | `berths/dock-walk/sessions/{id}/` | Session detail |
| POST | `berths/dock-walk/sessions/{id}/entries/` | Bulk submit observations |
| PATCH | `berths/dock-walk/sessions/{id}/finish/` | Finish session |
| GET | `berths/dock-walk/offline-payload/` | Compact berth snapshot for service worker |
| GET | `berths/alerts/` | List berth alerts |
| PATCH | `berths/alerts/{id}/resolve/` | Resolve alert |
| POST | `berths/alerts/{id}/escalate-coastguard/` | Generate coast guard report |
| GET, POST | `berths/listings/` | Berth sale listings |
| PATCH | `berths/listings/{id}/` | Update listing (triggers commission on sold) |
| GET, POST | `berths/listings/{id}/enquiries/` | Listing enquiries |

### apps/movements/urls.py (new)

| Method | URL | Description |
|--------|-----|-------------|
| GET | `berths/movements/` | Vessel movement log |
| POST | `berths/movements/` | Log a movement |
| PATCH | `berths/movements/{id}/complete/` | Mark movement complete (only mutation) |
| GET | `berths/movements/expected-board/` | Today's arrivals and departures |
| GET | `berths/movements/traffic-log/` | Date-range log + CSV export |

### apps/reservations/urls.py (appended)

| Method | URL | Description |
|--------|-----|-------------|
| POST | `bookings/{id}/clear-document-gate/` | Mark all 3 documents verified |

## 7. Key design decisions

- **Air draft is never a hard exclusion** — `SmartBerthScorer` sets `air_draft_warning=True`
  and amber warning text but does NOT call `exclude()` on the berth.
- **Movement records are immutable** — no DELETE or general PATCH endpoint. Only the
  `complete` action is allowed. Admin has `has_delete_permission = False`.
- **FleetAssignJob dispatch uses `transaction.on_commit()`** — the Celery task is never
  dispatched before the `FleetAssignJob` row commits to the database.
- **Coast guard escalation is human-only** — `check_non_returns` task elevates to CRITICAL
  but never sets `coastguard_report_text`. Only the `escalate_coastguard` staff endpoint does.
- **Sub-let credit: post-checkout only** — `apply_credit` returns 400 if booking status
  is not `checked_out`.
- **All signals in movements/signals.py wrap `VesselMovement.objects.create()` in
  `transaction.on_commit()`** to guarantee FK commit ordering.
