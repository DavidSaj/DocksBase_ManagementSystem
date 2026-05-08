# Track 6 — Utilities & Dry Stack: Installation Guide

## 1. Python Dependencies

Install the following packages (add to requirements.txt):

```
django-fernet-fields>=0.7   # encrypted credentials storage for UtilityIntegration
requests>=2.31              # Rolec Cloud API HTTP calls
```

Run:
```bash
pip install django-fernet-fields requests
```

## 2. Settings — config/settings/base.py

### 2a. Add to LOCAL_APPS

```python
LOCAL_APPS = [
    # ... existing apps ...
    'apps.utilities',
]
```

### 2b. Fernet encryption key (for UtilityIntegration.credentials)

```python
import os

FERNET_KEYS = [os.environ.get('FERNET_KEY', '')]
```

Generate a key once:
```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Add to `.env`:
```
FERNET_KEY=<output from command above>
```

**Never commit this key to version control.**

### 2c. CORS headers (add custom headers to CORS_ALLOW_HEADERS)

```python
from corsheaders.defaults import default_headers

CORS_ALLOW_HEADERS = list(default_headers) + [
    'X-Marina-Slug',
    'X-Forklift-Device-Token',
    'X-Hardware-ID',
    'X-Marina-API-Key',
]
```

### 2d. Celery Beat schedule (merge with existing CELERY_BEAT_SCHEDULE)

```python
CELERY_BEAT_SCHEDULE = {
    # ... existing entries ...

    'poll-smart-meters-all-15min': {
        'task': 'apps.utilities.tasks.poll_smart_meters_all_marinas',
        'schedule': 60 * 15,  # 15 minutes
    },
    'send-low-balance-alerts-hourly': {
        'task': 'apps.utilities.tasks.send_low_balance_alerts',
        'schedule': 60 * 60,
    },
    'auto-deduct-utility-charges-hourly': {
        'task': 'apps.utilities.tasks.auto_deduct_utility_charges',
        'schedule': 60 * 60,
    },
    'send-launch-confirmation-reminders-30min': {
        'task': 'apps.utilities.tasks.send_launch_confirmation_reminders',
        'schedule': 60 * 30,
    },
    'enforce-no-show-15min': {
        'task': 'apps.utilities.tasks.enforce_no_show',
        'schedule': 60 * 15,
    },
    'expire-wash-tokens-hourly': {
        'task': 'apps.utilities.tasks.expire_wash_tokens',
        'schedule': 60 * 60,
    },
}
```

## 3. URL Wiring — config/urls.py

Inside the `api/v1/` include block:

```python
path('utilities/', include('apps.utilities.urls')),
```

## 4. Apply Migrations (in order)

```bash
python manage.py migrate accounts    # 0017_marina_no_show_grace_minutes
python manage.py migrate boatyard    # 0003_track6_drystack_concierge
python manage.py migrate utilities   # 0001_initial
```

## 5. MeterReading — PostgreSQL Partitioning (REQUIRED before production)

At 500 meters × 4 reads/hour, `utilities_meterreading` accumulates **~17.5 million
rows per year per marina**. A standard unpartitioned Django table is not viable in
production beyond ~6 months of data.

Choose ONE strategy before the first migration is applied to a production database.

---

### Option A — PostgreSQL Declarative Range Partitioning (pg_partman)

Recommended for most self-hosted or managed PostgreSQL deployments (AWS RDS, Azure,
Supabase).

**Step 1**: Install pg_partman as a PostgreSQL extension:

```sql
CREATE EXTENSION IF NOT EXISTS pg_partman;
```

**Step 2**: After running the initial migration, replace the table with a partitioned
version. Run these SQL statements in a database shell (psql or via a RunSQL migration):

```sql
-- Rename the ORM-created table
ALTER TABLE utilities_meterreading RENAME TO utilities_meterreading_unpartitioned;

-- Create the partitioned parent table (same schema)
CREATE TABLE utilities_meterreading (
    id          bigserial,
    meter_id    bigint NOT NULL REFERENCES utilities_smartmeter(id) ON DELETE CASCADE,
    reading_kwh numeric(12, 3),
    reading_m3  numeric(12, 3),
    recorded_at timestamptz NOT NULL,
    source      varchar(20) DEFAULT 'auto',
    PRIMARY KEY (id, recorded_at)
) PARTITION BY RANGE (recorded_at);

-- Create a composite index (meter_id, recorded_at) on all partitions
CREATE INDEX utilities_meterreading_meter_recorded_idx
    ON utilities_meterreading (meter_id, recorded_at);

-- Configure pg_partman to create monthly child partitions automatically
SELECT partman.create_parent(
    p_parent_table  => 'public.utilities_meterreading',
    p_control       => 'recorded_at',
    p_interval      => '1 month',
    p_premake       => 3   -- pre-create 3 future months
);

-- Copy existing data (if any) from the unpartitioned table
INSERT INTO utilities_meterreading
SELECT * FROM utilities_meterreading_unpartitioned;

-- Drop the old table
DROP TABLE utilities_meterreading_unpartitioned;
```

**Step 3**: Schedule pg_partman maintenance in cron or Celery Beat (weekly):

```sql
-- Run weekly to create future partitions and drop old ones (if retention is configured)
SELECT partman.run_maintenance();
```

---

### Option B — TimescaleDB Hypertable

Recommended for cloud deployments or analytics-heavy usage where TimescaleDB
is available (Supabase, Timescale Cloud, self-hosted).

After the initial migration, run:

```sql
SELECT create_hypertable(
    'utilities_meterreading',
    'recorded_at',
    chunk_time_interval => INTERVAL '1 month',
    if_not_exists       => TRUE
);
```

No schema change is needed — TimescaleDB manages partitioning transparently.

---

### Which to choose?

| Factor | pg_partman | TimescaleDB |
|---|---|---|
| Standard PostgreSQL | Yes | Extension required |
| AWS RDS / Azure DB | Yes | Limited (check version) |
| Supabase | Yes | Available as extension |
| Compression | Manual tablespace | Built-in (columnar) |
| Continuous aggregates | No | Yes |
| Setup complexity | Medium | Low |

**Decision must be made at deployment time before the first migration is applied.**
Document the chosen strategy in `docs/infrastructure/meter-readings-partitioning.md`.

---

## 6. Composite Index (always required — partition-independent)

Regardless of partitioning strategy, ensure this index exists:

```sql
CREATE INDEX IF NOT EXISTS utilities_meterreading_meter_recorded_idx
    ON utilities_meterreading (meter_id, recorded_at);
```

This is already defined in `MeterReading.Meta.indexes` so the ORM migration creates
it. Verify it was created on the partitioned table (pg_partman requires the index to
be created on the parent, not child partitions, which the above handles).

---

## 7. Seed ChargeableItem records (data migration)

After migrating, seed the required catalogue entries. Run via Django shell or create
a RunPython migration:

```python
from apps.billing.models import ChargeableItem
from apps.accounts.models import Marina

for marina in Marina.objects.all():
    items = [
        dict(category='utility_kwh',       name='Electricity (per kWh)',         unit_price='0.28'),
        dict(category='utility_m3',        name='Water (per m³)',                unit_price='3.50'),
        dict(category='wash_token_shower', name='Shower Token',                  unit_price='2.00'),
        dict(category='wash_token_laundry',name='Laundry Token',                 unit_price='4.00'),
        dict(category='wash_token_carwash',name='Car Wash Token',                unit_price='3.00'),
        dict(category='battery_charge',    name='Battery Charge Service',        unit_price='15.00'),
        dict(category='no_show_penalty',   name='No-Show Penalty',               unit_price='25.00'),
        dict(category='concierge_washdown',name='Concierge Vessel Wash-down',    unit_price='45.00'),
    ]
    for item in items:
        ChargeableItem.objects.get_or_create(
            marina=marina,
            category=item['category'],
            defaults={
                'name': item['name'],
                'unit_price': item['unit_price'],
                'is_active': True,
            },
        )
```

Adjust `unit_price` values per marina pricing before seeding.

---

## 8. ForkliftDeviceTokenAuthentication — usage

Apply to forklift-specific ViewSets **only** by overriding `authentication_classes`
(do NOT add to `DEFAULT_AUTHENTICATION_CLASSES` — this would break normal JWT auth):

```python
from apps.utilities.authentication import ForkliftDeviceTokenAuthentication

class ForkliftDeviceTokenViewSet(viewsets.ModelViewSet):
    authentication_classes = [ForkliftDeviceTokenAuthentication]
    permission_classes     = []  # Marina scoping via request.auth.marina
    ...
```

Generate tokens server-side (never client-side):
```python
import secrets
token = secrets.token_urlsafe(48)
```

---

## 9. Monthly utility billing management command

Until Celery Beat is wired for the monthly billing run, trigger manually:

```bash
python manage.py generate_utility_invoices --marina <id> --month YYYY-MM
```

Example:
```bash
python manage.py generate_utility_invoices --marina 1 --month 2026-04
```
