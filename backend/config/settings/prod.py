import os
from .base import *

SECRET_KEY = os.environ['SECRET_KEY']

DEBUG = False

ALLOWED_HOSTS = [h for h in os.environ.get('ALLOWED_HOSTS', '').split(',') if h]

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'OPTIONS': {
            'service': 'docksbase',
        },
    }
}

# Railway sets DATABASE_URL; dj-database-url parses it if needed.
# Alternatively parse DATABASE_URL directly:
import dj_database_url  # noqa: E402  (optional dep)
_db_url = os.environ.get('DATABASE_URL')
if _db_url:
    DATABASES['default'] = dj_database_url.config(default=_db_url, conn_max_age=600)

CORS_ALLOWED_ORIGINS = [o for o in os.environ.get('CORS_ALLOWED_ORIGINS', '').split(',') if o]

SECURE_SSL_REDIRECT = True
SESSION_COOKIE_SECURE = True
CSRF_COOKIE_SECURE = True
SECURE_HSTS_SECONDS = 31536000
SECURE_HSTS_INCLUDE_SUBDOMAINS = True
SECURE_HSTS_PRELOAD = True
SECURE_CONTENT_TYPE_NOSNIFF = True
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = True

EMAIL_BACKEND = 'anymail.backends.resend.EmailBackend'
ANYMAIL = {
    'RESEND_API_KEY': os.environ['RESEND_API_KEY'],
}
