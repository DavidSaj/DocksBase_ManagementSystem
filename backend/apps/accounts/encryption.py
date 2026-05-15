"""
Symmetric Fernet encryption helpers for sensitive marina credentials.

Key sourcing
------------
The Fernet key is read once at module import from ``DOCKSBASE_FERNET_KEY`` and
must be a urlsafe-base64-encoded 32-byte value (the format that
``cryptography.fernet.Fernet.generate_key()`` produces).

To generate a key locally::

    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"

Operational semantics
---------------------
* In **DEBUG / no-key environments**, ``encrypt()`` is a no-op (returns the
  plaintext unchanged) and ``decrypt()`` simply returns its input. This keeps
  local development workable without forcing every developer to mint a key.
* In **production** (``DEBUG=False``), a missing or invalid key raises at
  import time so deployments fail fast instead of silently saving plaintext.
* ``decrypt()`` is intentionally tolerant: input that is not a valid Fernet
  token is returned verbatim. This is what lets the system run in mixed-state
  databases where some rows are already encrypted and others are not.
"""

import logging
from functools import lru_cache

from django.conf import settings

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _fernet():
    """Return a configured ``Fernet`` instance, or ``None`` when no key is set."""
    key = getattr(settings, 'DOCKSBASE_FERNET_KEY', '') or ''
    if not key:
        if not getattr(settings, 'DEBUG', False):
            raise RuntimeError(
                'DOCKSBASE_FERNET_KEY is not set. Refusing to start in production '
                'with no encryption key. Generate one with: '
                'python -c "from cryptography.fernet import Fernet; '
                'print(Fernet.generate_key().decode())"'
            )
        logger.warning(
            'DOCKSBASE_FERNET_KEY not set — credential fields will be stored '
            'in plaintext. Set the env var to enable encryption.'
        )
        return None
    from cryptography.fernet import Fernet, InvalidToken  # noqa: F401
    try:
        return Fernet(key.encode() if isinstance(key, str) else key)
    except Exception as exc:
        raise RuntimeError(f'DOCKSBASE_FERNET_KEY is not a valid Fernet key: {exc}')


def is_configured() -> bool:
    return _fernet() is not None


def encrypt(plaintext: str) -> str:
    """
    Encrypt ``plaintext`` and return the Fernet token (urlsafe-base64 str).

    If no key is configured, returns the input unchanged. Empty strings are
    always passed through — there's nothing to encrypt and storing them as
    ciphertext only complicates ``blank=True`` form handling.
    """
    if plaintext in ('', None):
        return plaintext
    f = _fernet()
    if f is None:
        return plaintext
    return f.encrypt(plaintext.encode()).decode()


def decrypt(value: str) -> str:
    """
    Decrypt a Fernet token. Inputs that are not valid Fernet tokens (legacy
    plaintext, empty strings) are returned verbatim. This is what enables the
    lazy-upgrade path: a column can hold both encrypted and plaintext rows
    while a one-shot management command re-encrypts the latter.
    """
    if value in ('', None):
        return value
    f = _fernet()
    if f is None:
        return value
    from cryptography.fernet import InvalidToken
    try:
        return f.decrypt(value.encode() if isinstance(value, str) else value).decode()
    except (InvalidToken, ValueError, TypeError):
        return value


def looks_encrypted(value: str) -> bool:
    """Best-effort check: does this value Fernet-decrypt under the current key?"""
    if not value or _fernet() is None:
        return False
    from cryptography.fernet import InvalidToken
    try:
        _fernet().decrypt(value.encode() if isinstance(value, str) else value)
        return True
    except (InvalidToken, ValueError, TypeError):
        return False
