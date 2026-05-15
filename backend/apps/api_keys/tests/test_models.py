import hashlib
import pytest
from django.utils import timezone
from datetime import timedelta

from apps.api_keys.models import APIKey, generate_key


class TestGenerateKey:
    def test_returns_tuple_of_three(self):
        result = generate_key()
        assert len(result) == 3

    def test_full_key_starts_with_prefix(self):
        full, prefix, last_four = generate_key()
        assert full.startswith('db_live_')

    def test_prefix_format(self):
        full, prefix, last_four = generate_key()
        # prefix = 'db_live_' (8 chars) + 8 random chars = 'db_live_XXXXXXXX'
        assert prefix.startswith('db_live_')
        # The prefix should be 'db_live_' + 8 chars = 16 chars
        assert len(prefix) == 16

    def test_last_four_length(self):
        full, prefix, last_four = generate_key()
        assert len(last_four) == 4

    def test_last_four_matches_end_of_full_key(self):
        full, prefix, last_four = generate_key()
        assert full.endswith(last_four)

    def test_full_key_contains_prefix(self):
        full, prefix, last_four = generate_key()
        assert full.startswith(prefix + '_')

    def test_two_generated_keys_are_distinct(self):
        full1, _, _ = generate_key()
        full2, _, _ = generate_key()
        assert full1 != full2

    def test_two_prefixes_are_distinct(self):
        _, prefix1, _ = generate_key()
        _, prefix2, _ = generate_key()
        assert prefix1 != prefix2


class TestAPIKeyStatus:
    def test_active_key(self, owner_user, marina, db):
        key = APIKey.objects.create(
            marina=marina,
            created_by=owner_user,
            name='Test Key',
            key_prefix='db_live_abcdefgh',
            key_hash='fakehash',
            last_four='abcd',
        )
        assert key.status == 'active'
        assert key.is_active is True

    def test_revoked_key(self, owner_user, marina, db):
        key = APIKey.objects.create(
            marina=marina,
            created_by=owner_user,
            name='Test Key',
            key_prefix='db_live_abcdefgi',
            key_hash='fakehash',
            last_four='abcd',
            revoked_at=timezone.now(),
        )
        assert key.status == 'revoked'
        assert key.is_active is False

    def test_expired_key(self, owner_user, marina, db):
        key = APIKey.objects.create(
            marina=marina,
            created_by=owner_user,
            name='Test Key',
            key_prefix='db_live_abcdefgj',
            key_hash='fakehash',
            last_four='abcd',
            expires_at=timezone.now() - timedelta(hours=1),
        )
        assert key.status == 'expired'
        assert key.is_active is False

    def test_future_expiry_is_active(self, owner_user, marina, db):
        key = APIKey.objects.create(
            marina=marina,
            created_by=owner_user,
            name='Test Key',
            key_prefix='db_live_abcdefgk',
            key_hash='fakehash',
            last_four='abcd',
            expires_at=timezone.now() + timedelta(days=30),
        )
        assert key.status == 'active'
        assert key.is_active is True

    def test_revoked_overrides_expiry(self, owner_user, marina, db):
        key = APIKey.objects.create(
            marina=marina,
            created_by=owner_user,
            name='Test Key',
            key_prefix='db_live_abcdefgl',
            key_hash='fakehash',
            last_four='abcd',
            revoked_at=timezone.now(),
            expires_at=timezone.now() + timedelta(days=30),
        )
        assert key.status == 'revoked'
        assert key.is_active is False


class TestUserDeactivationRevokesKeys:
    def test_deactivating_user_revokes_active_keys(self, owner_user, marina, db):
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
        assert key.revoked_at is None

        # Deactivate the user
        owner_user.is_active = False
        owner_user.save()

        key.refresh_from_db()
        assert key.revoked_at is not None

    def test_deactivating_user_does_not_revoke_already_revoked_keys(self, owner_user, marina, db):
        full, prefix, last_four = generate_key()
        key_hash = hashlib.sha256(full.encode()).hexdigest()
        revoked_time = timezone.now() - timedelta(days=1)
        key = APIKey.objects.create(
            marina=marina,
            created_by=owner_user,
            name='Test Key',
            key_prefix=prefix,
            key_hash=key_hash,
            last_four=last_four,
            revoked_at=revoked_time,
        )

        owner_user.is_active = False
        owner_user.save()

        key.refresh_from_db()
        # Should not have changed the original revocation time
        assert abs((key.revoked_at - revoked_time).total_seconds()) < 1
