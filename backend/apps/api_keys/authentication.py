import hashlib
import hmac

from django.utils import timezone
from rest_framework import authentication, exceptions

from .models import APIKey, KEY_PREFIX_LEN


class APIKeyAuthentication(authentication.BaseAuthentication):
    keyword = 'Bearer'

    def authenticate(self, request):
        header = request.META.get('HTTP_AUTHORIZATION', '')
        if not header.startswith('Bearer db_live_'):
            return None  # not our scheme — let JWT auth try next

        token = header[len('Bearer '):].strip()
        # The prefix is a fixed-length slice ('db_live_' + 8 random url-safe chars =
        # KEY_PREFIX_LEN chars). DO NOT parse on underscores: secrets.token_urlsafe()
        # can emit '_' inside the 8-char random segment, which would break a split-based
        # parser and surface as a spurious 'Invalid API key.' on ~12% of keys.
        if len(token) < KEY_PREFIX_LEN:
            raise exceptions.AuthenticationFailed('Invalid API key.')
        prefix = token[:KEY_PREFIX_LEN]

        try:
            key = APIKey.objects.select_related('marina', 'created_by').get(key_prefix=prefix)
        except APIKey.DoesNotExist:
            raise exceptions.AuthenticationFailed('Invalid API key.')

        presented_hash = hashlib.sha256(token.encode()).hexdigest()
        if not hmac.compare_digest(presented_hash, key.key_hash):
            raise exceptions.AuthenticationFailed('Invalid API key.')

        if not key.is_active:
            raise exceptions.AuthenticationFailed(f'API key is {key.status}.')

        if not key.created_by.is_active:
            raise exceptions.AuthenticationFailed('API key creator is deactivated.')

        # Update last_used_at without triggering save signals or auto_now logic.
        APIKey.objects.filter(pk=key.pk).update(last_used_at=timezone.now())

        return (key.created_by, key)

    def authenticate_header(self, request):
        return 'Bearer'
