# Celery Full Wiring — Design Spec
**Date:** 2026-05-11
**Branch:** feature/stripe-connect-booking-payments (or dedicated branch)
**Approach:** Option A — single atomic PR

---

## Context

Celery infrastructure is already partially in place: `config/celery.py`, `config/__init__.py`, `requirements.txt`, and `CELERY_*` settings in `config/settings/base.py` are all correct. The gaps are:

1. No local Redis / Celery dev setup (docker-compose)
2. `sustainability/tasks.py` — all `@shared_task` decorators commented out
3. Two beat schedule entries point at task names that don't exist
4. Eight tasks documented in their own docstrings as beat-scheduled are absent from `CELERY_BEAT_SCHEDULE`
5. Break-glass override in `admin_portal/views.py` uses a bare `threading.Thread`

---

## Section 1 — docker-compose.yml (Hybrid approach)

**File:** `DocksBase_ManagementSystem/docker-compose.yml`

Three services. Django `runserver` runs natively (not in Docker) so engineers keep direct log feedback and debugger access.

### Services

**redis**
- Image: `redis:7-alpine`
- Port: `6379:6379`
- Named volume `redis_data` for persistence across restarts

**celery_worker**
- Build context: `./backend`
- Working dir: `/app`
- Volume mount: `./backend:/app` (hot-reload on file save — no rebuild needed)
- Command: `celery -A config worker -l info`
- Depends on: `redis`
- Env file: `./backend/.env`

**celery_beat**
- Same image and volume mount as `celery_worker`
- Command: `celery -A config beat -l info --scheduler django_celery_beat.schedulers:DatabaseScheduler`
- Depends on: `redis`
- Env file: `./backend/.env`

### Beat scheduler

Uses `django_celery_beat`'s database scheduler so beat schedule state survives container restarts and can be inspected/edited via Django admin.

**`requirements.txt` addition:** `django-celery-beat>=2.6,<3.0`

**`INSTALLED_APPS` addition** (in `base.py`): `'django_celery_beat'`

**`.env.example` addition:**
```
REDIS_URL=redis://localhost:6379/0
```
(The existing `CELERY_BROKER_URL` and `CELERY_RESULT_BACKEND` already read from `REDIS_URL`.)

### Dev workflow

```bash
docker compose up -d          # starts Redis + worker + beat
python manage.py runserver    # start Django natively as usual
docker compose logs -f celery_worker celery_beat   # tail background logs
docker compose down           # stop everything
```

---

## Section 2 — sustainability/tasks.py: uncomment decorators

All seven functions in `apps/sustainability/tasks.py` are promoted from plain functions to registered Celery tasks.

| Function | Decorator |
|---|---|
| `fetch_grid_intensity` | `@shared_task(name='sustainability.fetch_grid_intensity')` |
| `calculate_scope3_fuel_dock` | `@shared_task(name='sustainability.calculate_scope3_fuel_dock')` |
| `roll_sustainability_ledger` | `@shared_task(name='sustainability.roll_sustainability_ledger')` |
| `recalculate_ledger_period` | `@shared_task(name='sustainability.recalculate_ledger_period')` |
| `sync_play_it_green` | `@shared_task(name='sustainability.sync_play_it_green')` |
| `create_offset_contribution` | `@shared_task(name='sustainability.create_offset_contribution')` |
| `generate_esg_report_async` | `@shared_task(name='sustainability.generate_esg_report_async', queue='pdf_generation', acks_late=True, reject_on_worker_lost=True)` |

The docstring comment block (which contained setup instructions for a future developer) is removed — the decorators are now the source of truth.

No business logic changes. Function bodies are unchanged.

---

## Section 3 — Beat schedule: fix mismatches and add missing entries

All changes in `config/settings/base.py` → `CELERY_BEAT_SCHEDULE`.

### Fix 2 name mismatches

**Mismatch 1: `communications.run_journey_enrollments`**
The beat entry is correct. The task is wrong: `evaluate_journey_steps` in `communications/tasks.py` has no explicit `name=`. Fix: add `name='communications.run_journey_enrollments'` to that decorator.

**Mismatch 2: `expire-upgrade-campaigns`**
The beat entry points at `revenue_intelligence.expire_upgrade_campaigns` which does not exist. The correct task is `run_upgrade_campaigns` with `name='revenue_intelligence.run_upgrade_campaigns'`. Fix: update the beat key to `'run-upgrade-campaigns'` pointing at `revenue_intelligence.run_upgrade_campaigns`.

### Add 8 missing beat entries

| Beat key | Task name | Schedule |
|---|---|---|
| `instalment-processor` | `apps.accounting.tasks.instalment_processor` | `crontab(hour=0, minute=30)` — nightly 00:30 UTC |
| `deferred-revenue-recogniser` | `apps.accounting.tasks.deferred_revenue_recogniser` | `crontab(hour=1, minute=0)` — nightly 01:00 UTC |
| `hmrc-duty-aggregator` | `apps.accounting.tasks.hmrc_duty_period_aggregator` | `crontab(hour=3, minute=0, day_of_month=1, month_of_year='1,4,7,10')` — quarterly |
| `fx-rate-updater` | `apps.accounting.tasks.fx_rate_updater` | `crontab(hour=6, minute=0)` — daily 06:00 UTC |
| `accounting-sync-push` | `apps.accounting.tasks.accounting_sync_push` | `900` — every 15 minutes |
| `push-ota-availability` | `channels.push_ota_availability` | `crontab(hour=3, minute=0)` — nightly full push |
| `pull-ota-bookings` | `channels.pull_ota_bookings` | `crontab(minute=0)` — hourly |
| `check-non-returns` | `berths.check_non_returns` | `1800` — every 30 minutes |

The two `channels` tasks also get explicit `name=` parameters added to their `@shared_task` decorators to match the beat references:
- `name='channels.push_ota_availability'`
- `name='channels.pull_ota_bookings'`

---

## Section 4 — Break-glass override: threading → Celery task

### New file: `apps/admin_portal/tasks.py`

```python
from celery import shared_task

@shared_task(
    name='admin_portal.dispatch_break_glass_alerts',
    max_retries=3,
    default_retry_delay=30,
    acks_late=True,
)
def dispatch_break_glass_alerts(marina_email, marina_name, admin_email, bypass_reason):
    # body moved verbatim from _dispatch_break_glass_alerts in views.py
    ...
```

All parameters are primitives (strings) — JSON-serialisable through Celery.

### Changes in `apps/admin_portal/views.py`

- Remove `import threading`
- Delete `_dispatch_break_glass_alerts` function
- Replace the `threading.Thread(...).start()` block with:

```python
from apps.admin_portal.tasks import dispatch_break_glass_alerts
dispatch_break_glass_alerts.delay(
    marina.contact_email, marina.name, request.user.email, bypass_reason
)
```

No logic changes. The function body moves as-is.

---

## Files Changed (summary)

| File | Change |
|---|---|
| `DocksBase_ManagementSystem/docker-compose.yml` | New file |
| `backend/requirements.txt` | Add `django-celery-beat>=2.6,<3.0` |
| `backend/.env.example` | Add `REDIS_URL=redis://localhost:6379/0` |
| `backend/config/settings/base.py` | Add `django_celery_beat` to INSTALLED_APPS; fix 2 beat entries; add 8 beat entries |
| `backend/apps/sustainability/tasks.py` | Uncomment 7 `@shared_task` decorators; remove setup docblock |
| `backend/apps/communications/tasks.py` | Add `name='communications.run_journey_enrollments'` to `evaluate_journey_steps` |
| `backend/apps/channels/tasks.py` | Add explicit `name=` to `push_ota_availability` and `pull_ota_bookings` |
| `backend/apps/admin_portal/views.py` | Remove threading import, delete helper function, call `.delay()` |
| `backend/apps/admin_portal/tasks.py` | New file — `dispatch_break_glass_alerts` Celery task |

---

## Post-deploy steps

After merging, run once on every environment:
```bash
python manage.py migrate django_celery_beat
```
This creates the beat scheduler tables that `DatabaseScheduler` requires. Without it, `celery_beat` will crash on startup with a missing table error.

---

## Out of Scope

- Celery task monitoring UI (Flower) — not needed for MVP
- Production Redis clustering — handled at infrastructure layer, not in this spec
- New business logic in any task — this spec is wiring only
