# Celery Full Wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire Celery fully into the DocksBase backend — enable all commented-out task decorators, fix beat schedule name mismatches, add missing beat entries, and provide a hybrid Docker dev environment (Redis + worker + beat in Docker, Django native).

**Architecture:** All changes are pure wiring — no business logic. `django-celery-beat`'s `DatabaseScheduler` persists beat state across container restarts. The Celery worker uses `watchmedo` to hot-reload on `.py` file saves without a Docker rebuild. Both Celery containers override `REDIS_URL` to `redis://redis:6379/0` (Docker internal DNS) while the native Django process uses `redis://localhost:6379/0` from `.env`.

**Tech Stack:** Django 6, Celery 5.3+, Redis 7, django-celery-beat 2.6, watchdog 4.0, Docker Compose v2

---

## Prerequisite

The Celery containers connect to the database via `DATABASE_URL` from `.env`. SQLite (the dev fallback) **does not work** — Celery workers write concurrently and the file path inside the container is not the same as on the host. Ensure `DATABASE_URL` is set in `backend/.env` pointing to PostgreSQL (Supabase or local) before running `docker compose up`.

---

## Files

| Action | Path | Responsibility |
|---|---|---|
| Create | `DocksBase_ManagementSystem/backend/Dockerfile` | Builds the image used by both Celery services |
| Create | `DocksBase_ManagementSystem/docker-compose.yml` | Redis + celery_worker + celery_beat services |
| Modify | `backend/requirements.txt` | Add `django-celery-beat>=2.6,<3.0` |
| Modify | `backend/requirements-dev.txt` | Add `watchdog>=4.0,<5.0` |
| Modify | `backend/config/settings/base.py` | Add `django_celery_beat` to INSTALLED_APPS; fix 2 beat entries; add 8 beat entries |
| Modify | `backend/apps/sustainability/tasks.py` | Uncomment 7 `@shared_task` decorators; remove outdated setup docblock |
| Modify | `backend/apps/communications/tasks.py` | Add `name='communications.run_journey_enrollments'` to `evaluate_journey_steps` |
| Modify | `backend/apps/channels/tasks.py` | Add explicit `name=` to `push_ota_availability` and `pull_ota_bookings` |
| Create | `backend/tests/test_celery_beat_registry.py` | Verifies every beat schedule entry resolves to a registered task |

---

## Task 1: Add dependencies

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/requirements-dev.txt`

- [ ] **Step 1: Add django-celery-beat to requirements.txt**

Open `backend/requirements.txt`. After the `# ERP track dependencies` block, add:

```
django-celery-beat>=2.6,<3.0
```

- [ ] **Step 2: Add watchdog to requirements-dev.txt**

Open `backend/requirements-dev.txt`. Append:

```
watchdog>=4.0,<5.0
```

- [ ] **Step 3: Commit**

```bash
git add backend/requirements.txt backend/requirements-dev.txt
git commit -m "feat: add django-celery-beat and watchdog dependencies"
```

---

## Task 2: Add django_celery_beat to INSTALLED_APPS

**Files:**
- Modify: `backend/config/settings/base.py`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_celery_beat_registry.py`:

```python
import pytest


@pytest.mark.django_db
def test_django_celery_beat_in_installed_apps(settings):
    assert 'django_celery_beat' in settings.INSTALLED_APPS, (
        "django_celery_beat must be in INSTALLED_APPS for the DatabaseScheduler to work"
    )
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd backend
pytest tests/test_celery_beat_registry.py::test_django_celery_beat_in_installed_apps -v
```

Expected: `FAILED — AssertionError: django_celery_beat must be in INSTALLED_APPS`

- [ ] **Step 3: Add django_celery_beat to INSTALLED_APPS**

In `backend/config/settings/base.py`, find the `THIRD_PARTY_APPS` list and add `'django_celery_beat'`:

```python
THIRD_PARTY_APPS = [
    'channels',
    'rest_framework',
    'rest_framework_simplejwt',
    'rest_framework_simplejwt.token_blacklist',
    'corsheaders',
    'django_filters',
    'storages',
    'anymail',
    'csp',
    'django_celery_beat',
]
```

- [ ] **Step 4: Run the test and confirm it passes**

```bash
pytest tests/test_celery_beat_registry.py::test_django_celery_beat_in_installed_apps -v
```

Expected: `PASSED`

- [ ] **Step 5: Commit**

```bash
git add backend/config/settings/base.py backend/tests/test_celery_beat_registry.py
git commit -m "feat: add django_celery_beat to INSTALLED_APPS"
```

---

## Task 3: Fix task decorator name mismatches

**Files:**
- Modify: `backend/apps/communications/tasks.py`
- Modify: `backend/apps/channels/tasks.py`

These two task files have `@shared_task` decorators without explicit `name=` parameters. Without names, Celery auto-generates names from the module path, which don't match the strings in `CELERY_BEAT_SCHEDULE`.

- [ ] **Step 1: Fix communications/tasks.py — evaluate_journey_steps**

In `backend/apps/communications/tasks.py`, find:

```python
@shared_task
def evaluate_journey_steps():
```

Change to:

```python
@shared_task(name='communications.run_journey_enrollments')
def evaluate_journey_steps():
```

- [ ] **Step 2: Fix channels/tasks.py — push_ota_availability**

In `backend/apps/channels/tasks.py`, find:

```python
@shared_task
def push_ota_availability():
```

Change to:

```python
@shared_task(name='channels.push_ota_availability')
def push_ota_availability():
```

- [ ] **Step 3: Fix channels/tasks.py — pull_ota_bookings**

In `backend/apps/channels/tasks.py`, find:

```python
@shared_task
def pull_ota_bookings():
```

Change to:

```python
@shared_task(name='channels.pull_ota_bookings')
def pull_ota_bookings():
```

- [ ] **Step 4: Commit**

```bash
git add backend/apps/communications/tasks.py backend/apps/channels/tasks.py
git commit -m "fix: add explicit Celery task names to communications and channels"
```

---

## Task 4: Uncomment sustainability task decorators

**Files:**
- Modify: `backend/apps/sustainability/tasks.py`

All seven functions have `# @shared_task` commented out. Uncomment each and add `name=`.

- [ ] **Step 1: Uncomment fetch_grid_intensity**

Find:
```python
# @shared_task
def fetch_grid_intensity():
```

Replace with:
```python
@shared_task(name='sustainability.fetch_grid_intensity')
def fetch_grid_intensity():
```

- [ ] **Step 2: Uncomment calculate_scope3_fuel_dock**

Find:
```python
# @shared_task
def calculate_scope3_fuel_dock():
```

Replace with:
```python
@shared_task(name='sustainability.calculate_scope3_fuel_dock')
def calculate_scope3_fuel_dock():
```

- [ ] **Step 3: Uncomment roll_sustainability_ledger**

Find:
```python
# @shared_task
def roll_sustainability_ledger():
```

Replace with:
```python
@shared_task(name='sustainability.roll_sustainability_ledger')
def roll_sustainability_ledger():
```

- [ ] **Step 4: Uncomment recalculate_ledger_period**

Find:
```python
# @shared_task
def recalculate_ledger_period(marina_id: int, period: str):
```

Replace with:
```python
@shared_task(name='sustainability.recalculate_ledger_period')
def recalculate_ledger_period(marina_id: int, period: str):
```

- [ ] **Step 5: Uncomment sync_play_it_green**

Find:
```python
# @shared_task
def sync_play_it_green():
```

Replace with:
```python
@shared_task(name='sustainability.sync_play_it_green')
def sync_play_it_green():
```

- [ ] **Step 6: Uncomment create_offset_contribution**

Find:
```python
# @shared_task
def create_offset_contribution(line_item_id: int):
```

Replace with:
```python
@shared_task(name='sustainability.create_offset_contribution')
def create_offset_contribution(line_item_id: int):
```

- [ ] **Step 7: Uncomment generate_esg_report_async**

Find the multi-line commented decorator block:
```python
# @shared_task(
#     name='sustainability.generate_esg_report_async',
#     queue='pdf_generation',      # MANDATORY: dedicated queue
#     acks_late=True,              # requeue if worker killed mid-task
#     reject_on_worker_lost=True,  # requeue on OOM kill
# )
def generate_esg_report_async(archive_id: int):
```

Replace with:
```python
@shared_task(
    name='sustainability.generate_esg_report_async',
    queue='pdf_generation',
    acks_late=True,
    reject_on_worker_lost=True,
)
def generate_esg_report_async(archive_id: int):
```

- [ ] **Step 8: Remove the outdated setup docstring block**

The module-level docstring at the top of `sustainability/tasks.py` contains manual setup instructions (beat schedule YAML, worker command) that are now handled by the spec. Remove the entire docstring from line 1 down to and including the closing `"""`. Keep the imports and the module intact from `import logging` onward.

- [ ] **Step 9: Add the shared_task import**

Verify the file already has `from celery import shared_task` at the top. If not, add it after the standard library imports.

- [ ] **Step 10: Commit**

```bash
git add backend/apps/sustainability/tasks.py
git commit -m "feat: enable all sustainability Celery task decorators"
```

---

## Task 5: Fix and extend CELERY_BEAT_SCHEDULE

**Files:**
- Modify: `backend/config/settings/base.py`

- [ ] **Step 1: Write the failing beat registry test**

Add to `backend/tests/test_celery_beat_registry.py`:

```python
@pytest.mark.django_db
def test_all_beat_schedule_tasks_registered(settings):
    """Every task name in CELERY_BEAT_SCHEDULE must be registered with Celery."""
    # Import all task modules to trigger @shared_task registration
    import apps.billing.tasks          # noqa: F401
    import apps.reservations.tasks     # noqa: F401
    import apps.sustainability.tasks   # noqa: F401
    import apps.revenue_intelligence.tasks  # noqa: F401
    import apps.communications.tasks   # noqa: F401
    import apps.channels.tasks         # noqa: F401
    import apps.berths.tasks           # noqa: F401
    import apps.accounting.tasks       # noqa: F401
    import apps.notifications.tasks    # noqa: F401

    from celery import current_app

    missing = []
    for key, config in settings.CELERY_BEAT_SCHEDULE.items():
        task_name = config['task']
        if task_name not in current_app.tasks:
            missing.append((key, task_name))

    assert not missing, (
        "Beat schedule entries pointing at unregistered tasks:\n" +
        "\n".join(f"  beat key '{k}' -> task '{t}'" for k, t in missing)
    )
```

- [ ] **Step 2: Run it and note which entries fail**

```bash
cd backend
pytest tests/test_celery_beat_registry.py::test_all_beat_schedule_tasks_registered -v
```

Expected: FAILED — several entries listed as missing (the 2 mismatches + the 8 missing entries)

- [ ] **Step 3: Replace CELERY_BEAT_SCHEDULE in base.py**

In `backend/config/settings/base.py`, find the entire `CELERY_BEAT_SCHEDULE = { ... }` block and replace it with:

```python
CELERY_BEAT_SCHEDULE = {
    # ── Sustainability (Track 12) ─────────────────────────────────────────────
    'roll-sustainability-ledger': {
        'task': 'sustainability.roll_sustainability_ledger',
        'schedule': crontab(hour=4, minute=0),           # nightly 04:00 UTC
    },
    'fetch-grid-intensity': {
        'task': 'sustainability.fetch_grid_intensity',
        'schedule': crontab(hour=2, minute=0),           # daily 02:00 UTC
    },
    'sync-play-it-green': {
        'task': 'sustainability.sync_play_it_green',
        'schedule': crontab(day_of_week=0, hour=5, minute=0),  # weekly Sun 05:00 UTC
    },
    # ── Revenue Intelligence (Track 1) ────────────────────────────────────────
    'expire-waitlist-offers': {
        'task': 'revenue_intelligence.expire_waitlist_offers',
        'schedule': 3600,                                # hourly
    },
    'run-upgrade-campaigns': {
        'task': 'revenue_intelligence.run_upgrade_campaigns',
        'schedule': crontab(hour=3, minute=0),           # daily 03:00 UTC
    },
    # ── Communications (Track 7) ─────────────────────────────────────────────
    'run-communication-journeys': {
        'task': 'communications.run_journey_enrollments',
        'schedule': 300,                                 # every 5 minutes
    },
    # ── Billing ───────────────────────────────────────────────────────────────
    'send-overdue-invoice-alerts': {
        'task': 'billing.send_overdue_invoice_alerts',
        'schedule': crontab(hour=9, minute=0),           # daily 09:00 UTC
    },
    # ── Reservations ─────────────────────────────────────────────────────────
    'send-overstay-alerts': {
        'task': 'reservations.send_overstay_alerts',
        'schedule': crontab(hour=8, minute=0),           # daily 08:00 UTC
    },
    'send-prearival-reminders': {
        'task': 'reservations.send_prearival_reminders',
        'schedule': crontab(hour=10, minute=0),          # daily 10:00 UTC
    },
    # ── Accounting (Track 4) ─────────────────────────────────────────────────
    'instalment-processor': {
        'task': 'apps.accounting.tasks.instalment_processor',
        'schedule': crontab(hour=0, minute=30),          # nightly 00:30 UTC
    },
    'deferred-revenue-recogniser': {
        'task': 'apps.accounting.tasks.deferred_revenue_recogniser',
        'schedule': crontab(hour=1, minute=0),           # nightly 01:00 UTC
    },
    'hmrc-duty-aggregator': {
        'task': 'apps.accounting.tasks.hmrc_duty_period_aggregator',
        'schedule': crontab(hour=3, minute=0, day_of_month=1,
                            month_of_year='1,4,7,10'),   # quarterly
    },
    'fx-rate-updater': {
        'task': 'apps.accounting.tasks.fx_rate_updater',
        'schedule': crontab(hour=6, minute=0),           # daily 06:00 UTC
    },
    'accounting-sync-push': {
        'task': 'apps.accounting.tasks.accounting_sync_push',
        'schedule': 900,                                 # every 15 minutes
    },
    # ── OTA Channels (Track 7) ───────────────────────────────────────────────
    'push-ota-availability': {
        'task': 'channels.push_ota_availability',
        'schedule': crontab(hour=3, minute=0),           # nightly full push 03:00 UTC
    },
    'pull-ota-bookings': {
        'task': 'channels.pull_ota_bookings',
        'schedule': crontab(minute=0),                   # hourly
    },
    # ── Berths ───────────────────────────────────────────────────────────────
    'check-non-returns': {
        'task': 'berths.check_non_returns',
        'schedule': 1800,                                # every 30 minutes
    },
}
```

- [ ] **Step 4: Run the registry test and confirm it passes**

```bash
pytest tests/test_celery_beat_registry.py::test_all_beat_schedule_tasks_registered -v
```

Expected: `PASSED`

- [ ] **Step 5: Run both registry tests together**

```bash
pytest tests/test_celery_beat_registry.py -v
```

Expected: both tests `PASSED`

- [ ] **Step 6: Commit**

```bash
git add backend/config/settings/base.py backend/tests/test_celery_beat_registry.py
git commit -m "fix: correct beat schedule mismatches and add 8 missing beat entries"
```

---

## Task 6: Create Dockerfile and docker-compose.yml

**Files:**
- Create: `backend/Dockerfile`
- Create: `docker-compose.yml` (repo root of submodule: `DocksBase_ManagementSystem/docker-compose.yml`)

- [ ] **Step 1: Create backend/Dockerfile**

Create `DocksBase_ManagementSystem/backend/Dockerfile`:

```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt requirements-dev.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-dev.txt

COPY . .
```

This image is used by both `celery_worker` and `celery_beat`. The `COPY . .` gives a baseline; the actual source is overlaid by the volume mount at runtime so no rebuild is needed after code changes.

- [ ] **Step 2: Create docker-compose.yml**

Create `DocksBase_ManagementSystem/docker-compose.yml`:

```yaml
version: '3.9'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data

  celery_worker:
    build: ./backend
    working_dir: /app
    volumes:
      - ./backend:/app
    command: >
      watchmedo auto-restart
        --directory=./
        --pattern=*.py
        --recursive
        --
        celery -A config worker -l info
    env_file:
      - ./backend/.env
    environment:
      - REDIS_URL=redis://redis:6379/0
    depends_on:
      - redis

  celery_beat:
    build: ./backend
    working_dir: /app
    volumes:
      - ./backend:/app
    command: >
      celery -A config beat -l info
        --scheduler django_celery_beat.schedulers:DatabaseScheduler
    env_file:
      - ./backend/.env
    environment:
      - REDIS_URL=redis://redis:6379/0
    depends_on:
      - redis

volumes:
  redis_data:
```

**Why `REDIS_URL` is overridden:** The `.env` file uses `redis://localhost:6379/0`, which is correct for the native Django server (connecting via the host-mapped port). Inside Docker, `localhost` resolves to the container itself — nothing is listening there. The override `redis://redis:6379/0` uses Docker's internal DNS to reach the `redis` service directly.

- [ ] **Step 3: Add .env.example entry**

If `backend/.env.example` exists, add:

```
REDIS_URL=redis://localhost:6379/0
```

If it does not exist, create it with that single line.

- [ ] **Step 4: Add docker-compose.yml to .gitignore exclusion check**

Confirm `docker-compose.yml` is not in any `.gitignore`. It should be committed.

- [ ] **Step 5: Commit**

```bash
git add backend/Dockerfile docker-compose.yml backend/.env.example
git commit -m "feat: add hybrid docker-compose for Redis, Celery worker, and beat"
```

---

## Task 7: Run migration and smoke test

- [ ] **Step 1: Install new dependencies locally**

```bash
cd backend
pip install -r requirements.txt -r requirements-dev.txt
```

Expected: `django-celery-beat` and `watchdog` installed with no errors.

- [ ] **Step 2: Run the django_celery_beat migration**

```bash
python manage.py migrate django_celery_beat
```

Expected output includes lines like:
```
Running migrations:
  Applying django_celery_beat.0001_initial... OK
  ...
```

This creates the tables (`django_celery_beat_periodictask`, etc.) that `DatabaseScheduler` requires. Run this on every environment after deploying.

- [ ] **Step 3: Verify Celery can discover all tasks**

```bash
celery -A config inspect registered
```

Expected: a list of task names including all of the following:
- `sustainability.fetch_grid_intensity`
- `sustainability.roll_sustainability_ledger`
- `sustainability.sync_play_it_green`
- `sustainability.generate_esg_report_async`
- `communications.run_journey_enrollments`
- `channels.push_ota_availability`
- `channels.pull_ota_bookings`
- `berths.check_non_returns`
- `apps.accounting.tasks.instalment_processor`
- `revenue_intelligence.run_upgrade_campaigns`

If this command hangs (no broker running), use instead:

```bash
celery -A config inspect registered --without-gossip --without-mingle --without-heartbeat -b redis://localhost:6379/0
```

Or skip and rely on the pytest registry test from Task 5, which does not require a live broker.

- [ ] **Step 4: Start Docker services and verify worker starts cleanly**

```bash
docker compose up -d
docker compose logs celery_worker
```

Expected: worker logs show task registration lines, no `redis.exceptions.ConnectionError`.

```bash
docker compose logs celery_beat
```

Expected: beat logs show `Scheduler: Sending due task ...` lines within the first scheduled interval, no errors.

- [ ] **Step 5: Verify hot-reload works**

Add a blank comment to any task file (e.g., `apps/billing/tasks.py`), save it. Watch the worker container logs:

```bash
docker compose logs -f celery_worker
```

Expected: `watchmedo` triggers a restart and the worker comes back up within 2-3 seconds without running `docker compose restart`.

Remove the blank comment line and save again to restore the file.

- [ ] **Step 6: Run the full test suite**

```bash
pytest tests/test_celery_beat_registry.py -v
```

Expected: both tests `PASSED`.

- [ ] **Step 7: Final commit**

```bash
git add .
git commit -m "chore: run django_celery_beat migration and verify full Celery wiring"
```

---

## Dev workflow reference

```bash
# Start async infrastructure (run once per dev session)
docker compose up -d

# Start Django natively (in a separate terminal)
cd backend && python manage.py runserver

# Tail async logs
docker compose logs -f celery_worker celery_beat

# Stop everything
docker compose down
```

After deploying to any new environment, run:
```bash
python manage.py migrate django_celery_beat
```
