"""
Test settings: extends dev, but overrides email backend to use in-memory
so django.core.mail.outbox works in tests.
"""
from .dev import *  # noqa: F401, F403

EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'

# Use in-process cache for tests so they don't require a Redis container.
CACHES = {
    'default': {
        'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
        'LOCATION': 'docksbase-tests',
    },
}
