# activities — Installation Notes

## 1. LOCAL_APPS

Add to `config/settings/base.py` in the `LOCAL_APPS` list:

```python
LOCAL_APPS = [
    # ... existing entries ...
    'apps.activities',
    'django.contrib.postgres',   # required for DateTimeRangeField and ExclusionConstraint
]
```

`django.contrib.postgres` must appear **before** `apps.activities` in `INSTALLED_APPS` so
that `DateTimeRangeField` and `ExclusionConstraint` are registered when migrations run.

## 2. URL wiring

In `config/urls.py`, inside the `api/v1/` block:

```python
path('activities/', include('apps.activities.urls')),
```

## 3. Migration: btree_gist extension

The `AssetReservation` model uses an `ExclusionConstraint` with `DateTimeRangeField`.
PostgreSQL requires the `btree_gist` extension to create GIST indexes on non-geometric types.

The initial migration (`0001_initial.py`) already includes a `RunSQL` step to enable it:

```python
migrations.RunSQL(
    sql='CREATE EXTENSION IF NOT EXISTS btree_gist;',
    reverse_sql=migrations.RunSQL.noop,
),
```

**Verify `btree_gist` is available:**
```sql
-- Connect to your database and run:
SELECT name, default_version FROM pg_available_extensions WHERE name = 'btree_gist';
```
It is included in standard PostgreSQL distributions (9.1+) but must be enabled per-database.

**Run migrations:**
```bash
python manage.py makemigrations activities
python manage.py migrate activities
```

If `makemigrations` is run from scratch, edit the generated file to insert the
`RunSQL("CREATE EXTENSION IF NOT EXISTS btree_gist;")` operation **immediately before**
the `CreateModel` for `AssetReservation`.

## 4. ExclusionConstraint upgrade path

Currently the `AssetReservation.ExclusionConstraint` has no condition — all reservations
(including cancelled bookings) participate in the constraint. This means releasing a
reservation by deleting the row is required before the slot can be re-booked.

**Future upgrade (Django 4.2+):** Add a `condition` kwarg to exclude cancelled bookings:

```python
ExclusionConstraint(
    name='prevent_asset_double_booking',
    expressions=[
        ('asset', RangeOperators.EQUAL),
        ('time_range', RangeOperators.OVERLAPS),
    ],
    condition=Q(activity_booking__status='confirmed'),
)
```

This allows soft-cancellation (status change instead of deletion) while still preventing
double-booking on confirmed reservations.

## 5. Celery Beat schedule

Add to Celery Beat configuration:

```python
CELERY_BEAT_SCHEDULE = {
    # ... existing entries ...
    'sweep-expired-activity-bookings': {
        'task': 'apps.activities.tasks.sweep_expired_direct_bookings',
        'schedule': crontab(minute='*/5'),   # every 5 minutes
    },
}
```

## 6. Dependencies

This app imports from:
- `apps.accounts` — Marina FK
- `apps.members` — Member FK
- `apps.billing` — ChargeableItem, Invoice, InvoiceLineItem (via billing.service)
- `apps.staff` — StaffMember, Shift
- `apps.maintenance` — Asset

All must be migrated before running `migrate activities`.

## 7. Optional: Track 7 communications

`services/billing.py` and `signals.py` attempt to import `apps.communications.services.alert.send_alert`.
Failures are swallowed silently — the app works without Track 7.
