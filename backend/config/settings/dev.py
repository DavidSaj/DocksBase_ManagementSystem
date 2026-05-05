import os as _os
if _os.environ.get('DJANGO_ENV') == 'production':
    raise RuntimeError('Dev settings must not be used in production. Set DJANGO_SETTINGS_MODULE to config.settings.prod')

from .base import *

DEBUG = True

ALLOWED_HOSTS = ['localhost', '127.0.0.1', '.lvh.me']

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}

# Allow both localhost:517x origins and any *.lvh.me origins for local subdomain dev
CORS_ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
]

CORS_ALLOWED_ORIGIN_REGEXES = [
    r'^http://[a-z0-9\-]+\.lvh\.me(:\d+)?$',
]

EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'

STRIPE_SECRET_KEY = 'sk_test_placeholder'
STRIPE_WEBHOOK_SECRET = 'whsec_placeholder'

# Disable rate throttling in development/test so test suites don't hit 429s
REST_FRAMEWORK['DEFAULT_THROTTLE_CLASSES'] = []
