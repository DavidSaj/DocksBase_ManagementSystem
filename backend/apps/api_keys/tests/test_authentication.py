import hashlib
import pytest
from datetime import timedelta
from django.utils import timezone
from rest_framework.test import APIRequestFactory

from apps.api_keys.models import APIKey, generate_key
from apps.api_keys.authentication import APIKeyAuthentication


@pytest.fixture
def api_key(owner_user, marina, db):
    """Create a real API key for the owner_user."""
    full, prefix, last_four = generate_key()
    key_hash = hashlib.sha256(full.encode()).hexdigest()
    key = APIKey.objects.create(
        marina=marina,
        created_by=owner_user,
        name='Test Key',
        key_prefix=prefix,
        key_hash=key_hash,
        last_four=last_four,
    )
    return key, full  # return both the model and the raw key


@pytest.fixture
def auth():
    return APIKeyAuthentication()


@pytest.fixture
def factory():
    return APIRequestFactory()


class TestAPIKeyAuthentication:
    def test_non_db_live_token_returns_none(self, auth, factory):
        """Non-db_live_ tokens should return None to let JWT try next."""
        request = factory.get('/', HTTP_AUTHORIZATION='Bearer some.jwt.token')
        result = auth.authenticate(request)
        assert result is None

    def test_no_authorization_header_returns_none(self, auth, factory):
        """Missing auth header returns None."""
        request = factory.get('/')
        result = auth.authenticate(request)
        assert result is None

    def test_valid_token_returns_user_and_key(self, auth, factory, api_key, owner_user):
        """Valid API key returns (user, key) tuple."""
        key_obj, full_key = api_key
        request = factory.get('/', HTTP_AUTHORIZATION=f'Bearer {full_key}')
        result = auth.authenticate(request)
        assert result is not None
        user, key = result
        assert user == owner_user
        assert key == key_obj

    def test_tampered_token_raises_authentication_failed(self, auth, factory, api_key):
        """One char changed in the tail should raise AuthenticationFailed."""
        from rest_framework.exceptions import AuthenticationFailed
        key_obj, full_key = api_key
        # Change the last character
        tampered = full_key[:-1] + ('X' if full_key[-1] != 'X' else 'Y')
        request = factory.get('/', HTTP_AUTHORIZATION=f'Bearer {tampered}')
        with pytest.raises(AuthenticationFailed):
            auth.authenticate(request)

    def test_unknown_prefix_raises_authentication_failed(self, auth, factory, db):
        """Unknown prefix raises AuthenticationFailed."""
        from rest_framework.exceptions import AuthenticationFailed
        request = factory.get('/', HTTP_AUTHORIZATION='Bearer db_live_XXXXXXXX_' + 'a' * 32)
        with pytest.raises(AuthenticationFailed):
            auth.authenticate(request)

    def test_revoked_key_raises_authentication_failed(self, auth, factory, api_key):
        """Revoked key raises AuthenticationFailed with 'revoked' in message."""
        from rest_framework.exceptions import AuthenticationFailed
        key_obj, full_key = api_key
        key_obj.revoked_at = timezone.now()
        key_obj.save()
        request = factory.get('/', HTTP_AUTHORIZATION=f'Bearer {full_key}')
        with pytest.raises(AuthenticationFailed) as exc_info:
            auth.authenticate(request)
        assert 'revoked' in str(exc_info.value.detail).lower()

    def test_expired_key_raises_authentication_failed(self, auth, factory, api_key):
        """Expired key raises AuthenticationFailed."""
        from rest_framework.exceptions import AuthenticationFailed
        key_obj, full_key = api_key
        key_obj.expires_at = timezone.now() - timedelta(hours=1)
        key_obj.save()
        request = factory.get('/', HTTP_AUTHORIZATION=f'Bearer {full_key}')
        with pytest.raises(AuthenticationFailed):
            auth.authenticate(request)

    def test_deactivated_creator_raises_authentication_failed(self, auth, factory, api_key, owner_user):
        """If the creator is deactivated, raises AuthenticationFailed."""
        from rest_framework.exceptions import AuthenticationFailed
        key_obj, full_key = api_key
        # Deactivate user (this also revokes the key via signal)
        # So we need to deactivate and manually un-revoke the key
        owner_user.is_active = False
        owner_user.save()
        # Restore the key's revoked_at to None to test the creator deactivated path
        APIKey.objects.filter(pk=key_obj.pk).update(revoked_at=None)
        key_obj.refresh_from_db()
        request = factory.get('/', HTTP_AUTHORIZATION=f'Bearer {full_key}')
        with pytest.raises(AuthenticationFailed):
            auth.authenticate(request)

    def test_successful_auth_updates_last_used_at(self, auth, factory, api_key):
        """Successful authentication updates last_used_at to within 5 seconds of now."""
        key_obj, full_key = api_key
        assert key_obj.last_used_at is None
        request = factory.get('/', HTTP_AUTHORIZATION=f'Bearer {full_key}')
        auth.authenticate(request)
        key_obj.refresh_from_db()
        assert key_obj.last_used_at is not None
        diff = abs((timezone.now() - key_obj.last_used_at).total_seconds())
        assert diff < 5

    def test_authenticate_with_underscore_in_random_prefix_segment(
        self, auth, factory, owner_user, marina, db
    ):
        """
        Regression: the old parser split the bearer token by '_' and took the
        first three parts as the prefix. If the random 8-char prefix segment
        produced by secrets.token_urlsafe() happened to contain an underscore
        (~12% of keys), the parsed prefix was truncated and lookup failed with
        a spurious 'Invalid API key.'. This is a deterministic re-creation of
        that exact pathological key shape — it would have failed under the
        old slice-by-underscore parser every time.
        """
        from apps.api_keys.models import APIKey
        # Manually craft a key whose random prefix segment contains an underscore.
        pathological_pre = 'aB_xK9pQ'  # 8 chars, contains '_'
        prefix = f'db_live_{pathological_pre}'  # 16 chars
        tail = 'a' * 32
        full = f'{prefix}_{tail}'
        key_hash = hashlib.sha256(full.encode()).hexdigest()
        APIKey.objects.create(
            marina=marina,
            created_by=owner_user,
            name='Pathological',
            key_prefix=prefix,
            key_hash=key_hash,
            last_four=tail[-4:],
        )
        request = factory.get('/', HTTP_AUTHORIZATION=f'Bearer {full}')
        result = auth.authenticate(request)
        assert result is not None, 'fixed-length prefix slice must handle "_" in random segment'
        user, key = result
        assert user == owner_user
        assert key.key_prefix == prefix
