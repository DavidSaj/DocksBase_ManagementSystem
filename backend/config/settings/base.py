import os
import secrets as _secrets
from pathlib import Path
from datetime import timedelta
from corsheaders.defaults import default_headers
from dotenv import load_dotenv
from celery.schedules import crontab

BASE_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(BASE_DIR / '.env')

SECRET_KEY = os.environ.get('SECRET_KEY', _secrets.token_hex(50))

DEBUG = False

ALLOWED_HOSTS = []

DJANGO_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'django.contrib.postgres',
]

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

LOCAL_APPS = [
    'apps.accounts',
    'apps.berths',
    'apps.reservations',
    'apps.vessels',
    'apps.members',
    'apps.billing',
    'apps.maintenance',
    'apps.staff',
    'apps.boatyard',
    'apps.documents',
    'apps.restaurant',
    'apps.events',
    'apps.sales',
    'apps.reports',
    'apps.fuel_dock',
    'apps.search',
    'apps.notifications',
    'apps.portal',
    'apps.admin_portal',
    'apps.enterprise',
    'apps.mobile',
    # ERP tracks
    'apps.revenue',
    'apps.loyalty',
    'apps.accounting',
    'apps.movements',
    'apps.utilities',
    'apps.activities',
    'apps.housekeeping',
    'apps.charter',
    'apps.harbour',
    'apps.access_control',
    'apps.sustainability',
    # Tracks 1, 7, 10
    'apps.revenue_intelligence',
    'apps.communications',
    'apps.channels',
    'apps.tenants',
    'apps.marketplace',
    'apps.tickets',
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'csp.middleware.CSPMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'apps.accounts.middleware.TenantMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'apps.admin_portal.middleware.ImpersonationAuditMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'

AUTH_USER_MODEL = 'accounts.User'

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

DROPBOX_SIGN_API_KEY = os.environ.get('DROPBOX_SIGN_API_KEY', '')
DROPBOX_SIGN_CLIENT_ID = os.environ.get('DROPBOX_SIGN_CLIENT_ID', '')
DROPBOX_SIGN_WEBHOOK_SECRET = os.environ.get('DROPBOX_SIGN_WEBHOOK_SECRET', '')

DEFAULT_FROM_EMAIL = 'DocksBase <noreply@docksbase.com>'
PORTAL_BASE_URL = os.environ.get('PORTAL_BASE_URL', 'https://portal.docksbase.com')

PLAN_PRICES = {
    'starter': 149,
    'professional': 349,
    'enterprise': 899,
}

PLATFORM_FEE_RATE = '0.01'  # 1% of GMV

STRIPE_SECRET_KEY = os.environ.get('STRIPE_SECRET_KEY', '')
STRIPE_WEBHOOK_SECRET = os.environ.get('STRIPE_WEBHOOK_SECRET', '')
STRIPE_CONNECT_WEBHOOK_SECRET = os.environ.get('STRIPE_CONNECT_WEBHOOK_SECRET', '')
INGRESS_WEBHOOK_SECRET = os.environ.get('INGRESS_WEBHOOK_SECRET', '')
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:5173')
WEBSITE_URL = os.environ.get('WEBSITE_URL', '')

TWILIO_ACCOUNT_SID  = os.environ.get('TWILIO_ACCOUNT_SID', '')
TWILIO_AUTH_TOKEN   = os.environ.get('TWILIO_AUTH_TOKEN', '')
TWILIO_FROM_NUMBER  = os.environ.get('TWILIO_FROM_NUMBER', '')

# Supabase Storage (S3-compatible). Falls back to local FileSystemStorage when env vars absent.
_supabase_endpoint = os.environ.get('SUPABASE_S3_ENDPOINT', '')
if _supabase_endpoint:
    DEFAULT_FILE_STORAGE = 'storages.backends.s3boto3.S3Boto3Storage'
    AWS_S3_ENDPOINT_URL = _supabase_endpoint
    AWS_STORAGE_BUCKET_NAME = os.environ.get('SUPABASE_S3_BUCKET', 'staff-certs')
    AWS_ACCESS_KEY_ID = os.environ.get('SUPABASE_S3_KEY', '')
    AWS_SECRET_ACCESS_KEY = os.environ.get('SUPABASE_S3_SECRET', '')
    AWS_S3_FILE_OVERWRITE = False
    AWS_DEFAULT_ACL = None

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

ASGI_APPLICATION = 'config.asgi.application'

CHANNEL_LAYERS = {
    'default': {
        'BACKEND': 'channels.layers.InMemoryChannelLayer',
    }
}

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
        'apps.admin_portal.permissions.IsSafeModeReadOnly',
    ),
    'DEFAULT_FILTER_BACKENDS': (
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ),
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 100,
    'DEFAULT_THROTTLE_CLASSES': [
        'rest_framework.throttling.AnonRateThrottle',
        'rest_framework.throttling.UserRateThrottle',
    ],
    'DEFAULT_THROTTLE_RATES': {
        'anon': '20/min',
        'user': '200/min',
    },
}

CORS_ALLOW_HEADERS = list(default_headers) + [
    'X-Marina-Slug',
]

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=15),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=30),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': True,
}

# ---------------------------------------------------------------------------
# Celery
# ---------------------------------------------------------------------------
CELERY_BROKER_URL        = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
CELERY_RESULT_BACKEND    = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
CELERY_ACCEPT_CONTENT    = ['json']
CELERY_TASK_SERIALIZER   = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE          = 'UTC'
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_ROUTES = {
    'sustainability.generate_esg_report_async': {'queue': 'pdf_generation'},
}
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
    'auto-no-show': {
        'task': 'reservations.auto_no_show',
        'schedule': crontab(hour=22, minute=0),          # daily 22:00 UTC
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

CONTENT_SECURITY_POLICY = {
    'DIRECTIVES': {
        'default-src': ("'self'",),
        'script-src': ("'self'",),
        'style-src': ("'self'", "'unsafe-inline'", "https://fonts.googleapis.com"),
        'font-src': ("'self'", "https://fonts.gstatic.com"),
        'img-src': ("'self'", "data:"),
        'connect-src': ("'self'", "https://api.stripe.com", "https://api.resend.com"),
    }
}
