# housekeeping — Installation Notes

## 1. LOCAL_APPS

Add to `config/settings/base.py` in the `LOCAL_APPS` list:

```python
LOCAL_APPS = [
    # ... existing entries ...
    'apps.housekeeping',
]
```

## 2. URL wiring

In `config/urls.py`, inside the `api/v1/` block:

```python
path('housekeeping/', include('apps.housekeeping.urls')),
```

## 3. Run migrations

```bash
python manage.py makemigrations housekeeping
python manage.py migrate housekeeping
```

No special migration steps required (no PostgreSQL extensions needed for this app).

## 4. New settings key

Add to `config/settings/base.py`:

```python
import os

# Feature flag for charter-checkout housekeeping trigger (activates after Track 9 merges)
HOUSEKEEPING_CHARTER_TRIGGER_ENABLED = (
    os.environ.get('HOUSEKEEPING_CHARTER_TRIGGER_ENABLED', 'False') == 'True'
)
```

Add to `.env`:
```
HOUSEKEEPING_CHARTER_TRIGGER_ENABLED=False
```

Set to `True` in production only after Track 9 (`apps.charter`) has been merged and
`backfill_housekeeping_tasks` has been run.

## 5. Celery Beat schedule

Add to Celery Beat configuration:

```python
CELERY_BEAT_SCHEDULE = {
    # ... existing entries ...
    'generate-recurring-housekeeping-tasks': {
        'task': 'apps.housekeeping.tasks.generate_recurring_housekeeping_tasks',
        'schedule': crontab(hour=2, minute=0),   # daily at 02:00
    },
}
```

## 6. Track 9 charter integration

When Track 9 (`apps.charter`) merges:

1. Set `HOUSEKEEPING_CHARTER_TRIGGER_ENABLED=True` in production environment.
2. Run the backfill command for past checkouts:
   ```bash
   python manage.py backfill_housekeeping_tasks --dry-run   # preview
   python manage.py backfill_housekeeping_tasks              # execute
   ```
3. Verify that `charter_checkout_processed` signal payload matches the
   `on_charter_checkout()` receiver signature in `housekeeping/signals.py`.

The charter integration is connected in `HousekeepingConfig.ready()` **only if**
`apps.charter` is in `INSTALLED_APPS`, so adding `apps.housekeeping` before Track 9
is merged is safe.

## 7. Dependencies

This app imports from:
- `apps.accounts` — Marina FK
- `apps.staff` — StaffMember FK
- `apps.maintenance` — Defect (via `escalate_to_defect()` service)

Optional:
- `apps.communications` — `send_alert()` in `escalate_to_defect()`. Failures are swallowed.
- `apps.charter` — charter checkout signal. Not connected until Track 9 is installed.

## 8. Media storage

Task photos are stored at `MEDIA_ROOT/housekeeping/photos/YYYY/MM/`.
Ensure `MEDIA_ROOT` and serving are configured in settings.
