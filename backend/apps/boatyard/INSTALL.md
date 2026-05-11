Track 5 — Boatyard Advanced: Installation Notes
===============================================

Changes in this track are ADDITIVE. No existing models, views, or URL
patterns were modified. Follow the steps below after merging.


1. Run migrations
-----------------
Generate and apply migrations for all affected apps:

    python manage.py makemigrations boatyard accounts
    python manage.py migrate

Migration order note:
- `billing` migrations must be applied before `boatyard` if you add the
  `WarrantyClaim.journal_entry` FK (see section 4 below).
- `accounts` must be migrated after `billing` because `Marina` now has two
  FK fields pointing to `billing.ChargeableItem` (placeholder — see section 3).


2. `config/urls.py` — no changes needed
-----------------------------------------
The Track 5 router URLs are included inside `apps/boatyard/urls.py` via
`include(router.urls)`. As long as `boatyard` is already mounted in the
root URLconf (e.g. `path('api/v1/boatyard/', include('apps.boatyard.urls'))`),
all new endpoints are automatically available.

New endpoints added (prefix: /api/v1/boatyard/):

    GET/POST   v2/work-orders/
    POST       v2/work-orders/{id}/gantt/
    POST       v2/work-orders/{id}/lock_baseline/
    POST       v2/work-orders/{id}/apply_template/
    CRUD       work-order-tasks/
    CRUD       task-dependencies/
    CRUD       build-projects/
    GET/POST   build-projects/{id}/bom/
    GET/POST   build-projects/{id}/milestones/
    CRUD       bom-items/
    CRUD       build-milestones/
    POST       build-milestones/{id}/complete/
    CRUD       job-templates/
    CRUD       job-template-tasks/
    CRUD       job-template-parts/
    CRUD       batch-posts/
    CRUD       batch-post-lines/
    CRUD       warranty-agreements/
    CRUD       warranty-claims/
    POST       warranty-claims/{id}/submit/
    CRUD       supplier-price-files/
    POST       supplier-price-files/{id}/confirm-mapping/
    CRUD       supplier-column-maps/
    GET        part-price-history/
    POST       part-price-history/{id}/approve/
    CRUD       locations/
    CRUD       service-trucks/
    CRUD       inventory-levels/
    CRUD       inventory-anomalies/
    CRUD       truck-transfers/


3. `config/settings/base.py` — required additions
---------------------------------------------------

### 3a. Celery Beat schedule

Add to CELERY_BEAT_SCHEDULE (create the dict if not present):

    CELERY_BEAT_SCHEDULE = {
        # ... existing entries ...
        'boatyard-check-truck-restock': {
            'task': 'apps.boatyard.tasks.check_truck_restock',
            'schedule': crontab(hour=7, minute=0),   # daily at 07:00
        },
    }

Import crontab at the top of settings/base.py:

    from celery.schedules import crontab

### 3b. CORS headers

Add the forklift device token header to CORS:

    CORS_ALLOW_HEADERS = list(default_headers) + [
        'X-Forklift-Device-Token',
    ]

    # At top of settings/base.py:
    from corsheaders.defaults import default_headers

### 3c. WeasyPrint (optional — only needed for warranty PDF generation)

    pip install weasyprint

Ensure system dependencies (Pango, Cairo) are installed on the server:

    # Debian/Ubuntu
    apt-get install libpango-1.0-0 libcairo2 libgdk-pixbuf2.0-0


4. `billing.JournalEntry` — NOT YET IMPLEMENTED
------------------------------------------------
`WarrantyClaim.journal_entry` is a OneToOneField pointing to
`'billing.JournalEntry'`. This model does not exist in the codebase yet
(it is part of the Track 4 GL / double-entry accounting scope).

Until Track 4 is implemented:
- The migration will FAIL if `billing.JournalEntry` doesn't exist.
- Workaround: comment out the `journal_entry` field in `WarrantyClaim` and
  the corresponding serializer field before running `makemigrations`. Re-add
  once Track 4 is merged.

The `post_warranty_gl_entry` Celery task already has a guard:

    try:
        from billing.models import JournalEntry
    except ImportError:
        # logs a warning and returns {'deferred': True}

So task execution is safe even if the model is missing.


5. `accounts.Marina` GL account fields — billing.Account placeholder
----------------------------------------------------------------------
`Marina.warranty_gl_account` and `Marina.warranty_cogs_offset_account`
currently point to `billing.ChargeableItem` as a placeholder because
`billing.Account` (a proper Chart of Accounts model) does not yet exist.

Once `billing.Account` is added, update both FK definitions in
`apps/accounts/models.py` to point to `'billing.Account'` and run a new
migration.


6. Redis — required for CPM lock
----------------------------------
`recalculate_critical_path` uses `django.core.cache` with a 60 s TTL to
prevent duplicate runs. Ensure `CACHES` in settings points to a Redis
backend (e.g. django-redis):

    CACHES = {
        'default': {
            'BACKEND': 'django_redis.cache.RedisCache',
            'LOCATION': env('REDIS_URL', default='redis://localhost:6379/1'),
        }
    }


7. S3 storage — required for warranty PDF upload
-------------------------------------------------
`generate_warranty_claim_pdf` uses `django.core.files.storage.default_storage`
to save the rendered PDF. Configure django-storages + boto3:

    DEFAULT_FILE_STORAGE = 'storages.backends.s3boto3.S3Boto3Storage'
    AWS_STORAGE_BUCKET_NAME = env('AWS_STORAGE_BUCKET_NAME')
    AWS_S3_REGION_NAME = env('AWS_S3_REGION_NAME', default='eu-west-1')
