import os as _os
if _os.environ.get('DJANGO_ENV') == 'production':
    raise RuntimeError('Dev settings must not be used in production. Set DJANGO_SETTINGS_MODULE to config.settings.prod')

from .base import *

DEBUG = True

# Static key for dev so signing tokens (magic links, sessions) survive server restarts.
# base.py generates a random key when SECRET_KEY env var is absent — override that here.
if not _os.environ.get('SECRET_KEY'):
    SECRET_KEY = 'dev-static-secret-key-not-for-production-use-only'

ALLOWED_HOSTS = ['localhost', '127.0.0.1', '.lvh.me']

import dj_database_url as _dj_db

_db_url = _os.environ.get('DATABASE_URL', '')
if _db_url:
    DATABASES = {'default': _dj_db.parse(_db_url)}
else:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'db.sqlite3',
        }
    }

# Allow both localhost:517x origins and any *.lvh.me origins for local subdomain dev
CORS_ALLOWED_ORIGINS = [
    'http://localhost:5173',  # management frontend
    'http://localhost:5174',  # website
    'http://localhost:5175',  # field app
    'http://localhost:5176',  # portal
]

CORS_ALLOWED_ORIGIN_REGEXES = [
    r'^http://[a-z0-9\-]+\.lvh\.me(:\d+)?$',
]

EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'

PORTAL_BASE_URL = 'http://localhost:5176'

STRIPE_SECRET_KEY = _os.environ.get('STRIPE_SECRET_KEY', '')
STRIPE_WEBHOOK_SECRET = _os.environ.get('STRIPE_WEBHOOK_SECRET', '')

# Disable rate throttling in development/test so test suites don't hit 429s
REST_FRAMEWORK['DEFAULT_THROTTLE_CLASSES'] = []
