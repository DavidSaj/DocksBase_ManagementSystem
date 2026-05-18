import secrets
import hashlib

from django.conf import settings
from django.db import models
from django.utils import timezone


# Fixed-length prefix layout: 'db_live_' (8 chars) + 8 random chars = 16 chars.
# The auth class slices the bearer token by this length to recover the prefix, so
# this MUST stay constant and the random segment MUST contain no '_' or '-' so
# that it's safe to embed in a split-by-underscore key string elsewhere.
KEY_PREFIX_LEN = 16
_KEY_RANDOM_LEN = KEY_PREFIX_LEN - len('db_live_')  # 8
# Alphabet without '_' or '-' so the random segment never collides with the
# 'db_live_<pre>_<tail>' separator structure.
_KEY_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'


def _random_segment(length: int) -> str:
    return ''.join(secrets.choice(_KEY_ALPHABET) for _ in range(length))


def generate_key():
    """
    Generate a new API key.

    Returns:
        (full, prefix, last_four)
        - full: the complete key string e.g. 'db_live_aB3xK9pQ_<32-char-tail>'
        - prefix: 'db_live_<8-char-random>' (16 chars total, no '_' / '-' in the random part)
        - last_four: the last 4 characters of the full key
    """
    pre = _random_segment(_KEY_RANDOM_LEN)
    tail = _random_segment(32)
    full = f'db_live_{pre}_{tail}'
    return full, f'db_live_{pre}', tail[-4:]


class APIKey(models.Model):
    marina = models.ForeignKey(
        'accounts.Marina',
        on_delete=models.CASCADE,
        related_name='api_keys',
    )
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='api_keys',
    )
    name = models.CharField(max_length=200)
    key_prefix = models.CharField(max_length=20, unique=True, db_index=True)
    key_hash = models.CharField(max_length=64)  # sha256 hex digest
    last_four = models.CharField(max_length=4)
    expires_at = models.DateTimeField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.name} ({self.key_prefix}...{self.last_four})'

    @property
    def is_active(self):
        if self.revoked_at:
            return False
        if self.expires_at and self.expires_at <= timezone.now():
            return False
        return True

    @property
    def status(self) -> str:
        if self.revoked_at:
            return 'revoked'
        if self.expires_at and self.expires_at <= timezone.now():
            return 'expired'
        return 'active'
