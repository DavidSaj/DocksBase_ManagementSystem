"""
Custom EncryptedJSONField using cryptography.fernet.
Replaces django-fernet-fields which is incompatible with Django 6.

Configure via settings.FERNET_KEYS = ['<base64-url-safe-32-byte-key>'].
Generate a key: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

In development with no FERNET_KEYS configured, data is stored as plain JSON (no encryption).
"""
import json
import logging

from django.db import models
from django.conf import settings

logger = logging.getLogger(__name__)


def _get_fernet():
    try:
        from cryptography.fernet import Fernet
        keys = getattr(settings, 'FERNET_KEYS', [])
        key = next((k for k in keys if k), None)
        if not key:
            return None
        return Fernet(key.encode() if isinstance(key, str) else key)
    except ImportError:
        return None


class EncryptedJSONField(models.TextField):
    """
    TextField that transparently encrypts/decrypts JSON using Fernet symmetric encryption.
    Falls back to plaintext JSON when FERNET_KEYS is empty (dev/test only).
    """
    def from_db_value(self, value, expression, connection):
        if value is None:
            return {}
        f = _get_fernet()
        if f:
            try:
                value = f.decrypt(value.encode()).decode()
            except Exception:
                # Already plaintext (legacy row or dev environment)
                pass
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return {}

    def get_prep_value(self, value):
        if value is None:
            return None
        text = json.dumps(value if value is not None else {})
        f = _get_fernet()
        if f:
            return f.encrypt(text.encode()).decode()
        return text

    def to_python(self, value):
        if isinstance(value, dict):
            return value
        if value is None:
            return {}
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return {}

    def value_to_string(self, obj):
        return self.get_prep_value(self.value_from_object(obj))


class EncryptedCharField(models.TextField):
    """
    TextField that transparently encrypts/decrypts a string using Fernet.
    Falls back to plaintext when FERNET_KEYS is empty (dev/test only).
    max_length is advisory only (stored as encrypted blob in TEXT column).
    """
    def __init__(self, *args, max_length=255, **kwargs):
        # Store max_length for validation but use TextField storage
        self._declared_max_length = max_length
        super().__init__(*args, **kwargs)

    def from_db_value(self, value, expression, connection):
        if value is None:
            return ''
        f = _get_fernet()
        if f:
            try:
                return f.decrypt(value.encode()).decode()
            except Exception:
                pass
        return value

    def get_prep_value(self, value):
        if value is None:
            return None
        f = _get_fernet()
        if f:
            return f.encrypt(str(value).encode()).decode()
        return str(value)

    def to_python(self, value):
        return value or ''
