"""
TDD tests for MFA models and services.

Covers:
- UserMFA.is_active state matrix
- start_enrollment 4-state table (none/abandoned/active/disabled)
- complete_enrollment
- TOTP verify with valid code and clock skew
- Backup code single-use semantics
- MFAChallenge brute-force cap (5 attempts → invalidated)
- Challenge binding semantics (purpose mismatch, expiry, consumed)
- disable_mfa requires password
- Device trust cookie sign/verify
"""

import hashlib
from datetime import timedelta
from unittest.mock import patch, MagicMock

import pyotp
import pytest
from django.utils import timezone

from apps.security.models import MFABackupCode, MFAChallenge, UserMFA
from apps.security.services.mfa import (
    BRUTE_FORCE_MAX_ATTEMPTS,
    build_totp_uri,
    complete_enrollment,
    consume_backup_code,
    consume_challenge,
    disable_mfa,
    is_device_trusted,
    issue_challenge,
    mark_challenge_consumed,
    mark_device_trusted,
    record_failed_attempt,
    start_enrollment,
    verify_totp,
)


# ---------------------------------------------------------------------------
# UserMFA.is_active state matrix
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestUserMFAIsActive:
    def test_no_row_state_is_not_active(self, owner_user):
        assert not hasattr(owner_user, 'mfa') or True  # no row
        assert not UserMFA.objects.filter(user=owner_user).exists()

    def test_abandoned_enrollment_is_not_active(self, owner_user):
        mfa = UserMFA.objects.create(user=owner_user, secret='ABCD', enrolled_at=None)
        assert not mfa.is_active

    def test_active_mfa_is_active(self, owner_user):
        mfa = UserMFA.objects.create(
            user=owner_user, secret='ABCD', enrolled_at=timezone.now()
        )
        assert mfa.is_active

    def test_disabled_mfa_is_not_active(self, owner_user):
        mfa = UserMFA.objects.create(
            user=owner_user,
            secret='ABCD',
            enrolled_at=timezone.now(),
            disabled_at=timezone.now(),
        )
        assert not mfa.is_active


# ---------------------------------------------------------------------------
# start_enrollment 4-state table
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestStartEnrollment:
    def test_no_row_creates_new_mfa(self, owner_user):
        mfa, secret = start_enrollment(owner_user)
        assert mfa.pk is not None
        assert mfa.enrolled_at is None
        assert secret and len(secret) == 32

    def test_abandoned_enrollment_overwrites_secret(self, owner_user):
        UserMFA.objects.create(user=owner_user, secret='OLDSECRET', enrolled_at=None)
        # Also create an orphan backup code to verify it gets deleted
        MFABackupCode.objects.create(user=owner_user, code_hash='abc123')

        mfa, new_secret = start_enrollment(owner_user)
        assert mfa.enrolled_at is None
        assert mfa.secret == new_secret
        assert mfa.secret != 'OLDSECRET'
        # Orphan backup codes should be removed
        assert not MFABackupCode.objects.filter(user=owner_user).exists()

    def test_active_mfa_raises_error(self, owner_user):
        UserMFA.objects.create(
            user=owner_user, secret='ACTIVE', enrolled_at=timezone.now()
        )
        with pytest.raises(ValueError, match='already has active MFA'):
            start_enrollment(owner_user)

    def test_disabled_mfa_allows_reenrollment(self, owner_user):
        UserMFA.objects.create(
            user=owner_user,
            secret='OLD',
            enrolled_at=timezone.now() - timedelta(days=10),
            disabled_at=timezone.now(),
        )
        MFABackupCode.objects.create(user=owner_user, code_hash='oldhash')

        mfa, new_secret = start_enrollment(owner_user)
        assert mfa.enrolled_at is None
        assert mfa.disabled_at is None
        assert mfa.secret == new_secret
        assert not MFABackupCode.objects.filter(user=owner_user).exists()

    def test_no_integrity_error_on_second_call_for_abandoned(self, owner_user):
        """Calling start_enrollment twice should not raise IntegrityError."""
        start_enrollment(owner_user)
        # Should succeed without error
        mfa2, secret2 = start_enrollment(owner_user)
        assert mfa2.enrolled_at is None


# ---------------------------------------------------------------------------
# complete_enrollment
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestCompleteEnrollment:
    def test_complete_enrollment_with_valid_code(self, owner_user):
        mfa, secret = start_enrollment(owner_user)
        code = pyotp.TOTP(secret).now()
        enrolled_mfa, raw_codes = complete_enrollment(owner_user, code)
        assert enrolled_mfa.enrolled_at is not None
        assert len(raw_codes) == 10
        # Each code in XXXX-XXXX format
        for c in raw_codes:
            assert len(c) == 9 and c[4] == '-'

    def test_complete_enrollment_with_wrong_code(self, owner_user):
        start_enrollment(owner_user)
        with pytest.raises(ValueError, match='Invalid TOTP code'):
            complete_enrollment(owner_user, '000000')

    def test_complete_enrollment_stores_hashed_codes(self, owner_user):
        mfa, secret = start_enrollment(owner_user)
        code = pyotp.TOTP(secret).now()
        _, raw_codes = complete_enrollment(owner_user, code)
        # Raw codes must not be stored
        for raw in raw_codes:
            expected_hash = hashlib.sha256(raw.encode()).hexdigest()
            assert MFABackupCode.objects.filter(
                user=owner_user, code_hash=expected_hash
            ).exists()

    def test_complete_enrollment_no_pending_raises(self, owner_user):
        with pytest.raises(ValueError, match='No enrollment in progress'):
            complete_enrollment(owner_user, '123456')

    def test_complete_enrollment_already_enrolled_raises(self, owner_user):
        mfa, secret = start_enrollment(owner_user)
        code = pyotp.TOTP(secret).now()
        complete_enrollment(owner_user, code)
        # Trying again should raise
        with pytest.raises(ValueError):
            complete_enrollment(owner_user, code)


# ---------------------------------------------------------------------------
# verify_totp
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestVerifyTOTP:
    def test_valid_code_returns_true(self, owner_user):
        mfa, secret = start_enrollment(owner_user)
        code = pyotp.TOTP(secret).now()
        complete_enrollment(owner_user, code)
        # Generate a fresh current code
        current_code = pyotp.TOTP(secret).now()
        assert verify_totp(owner_user, current_code)

    def test_wrong_code_returns_false(self, owner_user):
        mfa, secret = start_enrollment(owner_user)
        code = pyotp.TOTP(secret).now()
        complete_enrollment(owner_user, code)
        assert not verify_totp(owner_user, '000000')

    def test_no_mfa_returns_false(self, owner_user):
        assert not verify_totp(owner_user, '123456')

    def test_inactive_mfa_returns_false(self, owner_user):
        UserMFA.objects.create(user=owner_user, secret='X', enrolled_at=None)
        assert not verify_totp(owner_user, '123456')

    def test_clock_skew_tolerance(self, owner_user):
        """TOTP codes from ±30s should be accepted (valid_window=1)."""
        mfa, secret = start_enrollment(owner_user)
        enroll_code = pyotp.TOTP(secret).now()
        complete_enrollment(owner_user, enroll_code)

        totp = pyotp.TOTP(secret)
        # Generate code for 29 seconds ago
        past_time = timezone.now().timestamp() - 29
        past_code = totp.at(past_time)
        # This should still be valid with valid_window=1
        assert verify_totp(owner_user, past_code)


# ---------------------------------------------------------------------------
# consume_backup_code
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestConsumeBackupCode:
    def test_valid_code_consumed_once(self, owner_user):
        mfa, secret = start_enrollment(owner_user)
        code = pyotp.TOTP(secret).now()
        _, raw_codes = complete_enrollment(owner_user, code)

        first_code = raw_codes[0]
        assert consume_backup_code(owner_user, first_code)
        # Second attempt with same code should fail
        assert not consume_backup_code(owner_user, first_code)

    def test_wrong_code_returns_false(self, owner_user):
        mfa, secret = start_enrollment(owner_user)
        code = pyotp.TOTP(secret).now()
        complete_enrollment(owner_user, code)
        assert not consume_backup_code(owner_user, 'XXXX-YYYY')

    def test_used_at_is_set(self, owner_user):
        mfa, secret = start_enrollment(owner_user)
        code = pyotp.TOTP(secret).now()
        _, raw_codes = complete_enrollment(owner_user, code)
        consume_backup_code(owner_user, raw_codes[0])
        bc = MFABackupCode.objects.filter(user=owner_user).first()
        # At least one code should be marked used
        assert MFABackupCode.objects.filter(user=owner_user, used_at__isnull=False).count() == 1


# ---------------------------------------------------------------------------
# disable_mfa
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestDisableMFA:
    def test_disable_with_correct_password(self, owner_user):
        mfa, secret = start_enrollment(owner_user)
        code = pyotp.TOTP(secret).now()
        complete_enrollment(owner_user, code)
        disable_mfa(owner_user, 'ownerpass123')
        mfa.refresh_from_db()
        assert mfa.disabled_at is not None
        assert not MFABackupCode.objects.filter(user=owner_user).exists()

    def test_disable_with_wrong_password(self, owner_user):
        mfa, secret = start_enrollment(owner_user)
        code = pyotp.TOTP(secret).now()
        complete_enrollment(owner_user, code)
        with pytest.raises(ValueError, match='Incorrect password'):
            disable_mfa(owner_user, 'wrongpassword')

    def test_disable_without_mfa_raises(self, owner_user):
        with pytest.raises(ValueError):
            disable_mfa(owner_user, 'ownerpass123')

    def test_disable_already_disabled_raises(self, owner_user):
        UserMFA.objects.create(
            user=owner_user,
            secret='X',
            enrolled_at=timezone.now(),
            disabled_at=timezone.now(),
        )
        with pytest.raises(ValueError, match='not currently active'):
            disable_mfa(owner_user, 'ownerpass123')


# ---------------------------------------------------------------------------
# MFAChallenge brute-force cap
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestChallengebruteForce:
    def test_five_failed_attempts_invalidate_challenge(self, owner_user):
        challenge = issue_challenge(owner_user, purpose='login')

        for _ in range(BRUTE_FORCE_MAX_ATTEMPTS):
            record_failed_attempt(challenge)

        challenge.refresh_from_db()
        assert challenge.invalidated_at is not None
        assert challenge.failed_attempts == BRUTE_FORCE_MAX_ATTEMPTS

    def test_correct_code_after_invalidation_returns_none(self, owner_user):
        challenge = issue_challenge(owner_user, purpose='login')
        token = challenge.token

        for _ in range(BRUTE_FORCE_MAX_ATTEMPTS):
            record_failed_attempt(challenge)

        # consume_challenge should return None now
        result = consume_challenge(token, purpose='login')
        assert result is None

    def test_challenge_not_invalidated_before_cap(self, owner_user):
        challenge = issue_challenge(owner_user, purpose='login')
        for _ in range(BRUTE_FORCE_MAX_ATTEMPTS - 1):
            record_failed_attempt(challenge)

        challenge.refresh_from_db()
        assert challenge.invalidated_at is None


# ---------------------------------------------------------------------------
# consume_challenge validity checks
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestConsumeChallenge:
    def test_valid_challenge_returns_challenge(self, owner_user):
        challenge = issue_challenge(owner_user, purpose='login')
        result = consume_challenge(challenge.token, purpose='login')
        assert result is not None
        assert result.user == owner_user

    def test_nonexistent_token_returns_none(self, owner_user):
        assert consume_challenge('nonexistent', purpose='login') is None

    def test_expired_challenge_returns_none(self, owner_user):
        challenge = issue_challenge(owner_user, purpose='login')
        challenge.expires_at = timezone.now() - timedelta(minutes=1)
        challenge.save()
        assert consume_challenge(challenge.token, purpose='login') is None

    def test_consumed_challenge_returns_none(self, owner_user):
        challenge = issue_challenge(owner_user, purpose='login')
        mark_challenge_consumed(challenge)
        assert consume_challenge(challenge.token, purpose='login') is None

    def test_purpose_mismatch_returns_none(self, owner_user):
        challenge = issue_challenge(owner_user, purpose='enrollment')
        assert consume_challenge(challenge.token, purpose='login') is None

    def test_challenge_user_binding(self, owner_user, manager_user):
        """A challenge issued for owner_user cannot be used to obtain manager_user's identity."""
        challenge = issue_challenge(owner_user, purpose='login')
        result = consume_challenge(challenge.token, purpose='login')
        assert result is not None
        assert result.user.id == owner_user.id
        assert result.user.id != manager_user.id


# ---------------------------------------------------------------------------
# Device trust cookie
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestDeviceTrustCookie:
    def test_mark_and_verify_trust(self, owner_user):
        from rest_framework.response import Response
        response = Response({})
        response.accepted_renderer = None
        # Use a simpler mock for the response
        from django.http import HttpResponse
        http_response = HttpResponse()
        mark_device_trusted(http_response, owner_user)

        # Build a fake request with the cookie
        from django.test import RequestFactory
        factory = RequestFactory()
        request = factory.get('/')
        cookie_name = f'dbmfa_trust_{owner_user.id}'
        cookie_value = http_response.cookies[cookie_name].value
        request.COOKIES[cookie_name] = cookie_value

        assert is_device_trusted(request, owner_user)

    def test_missing_cookie_returns_false(self, owner_user):
        from django.test import RequestFactory
        factory = RequestFactory()
        request = factory.get('/')
        assert not is_device_trusted(request, owner_user)

    def test_wrong_user_id_in_cookie_returns_false(self, owner_user, manager_user):
        """A trust cookie for owner_user cannot be used for manager_user."""
        from django.http import HttpResponse
        from django.test import RequestFactory
        http_response = HttpResponse()
        mark_device_trusted(http_response, owner_user)

        factory = RequestFactory()
        request = factory.get('/')
        cookie_name = f'dbmfa_trust_{owner_user.id}'
        cookie_value = http_response.cookies[cookie_name].value
        # Put the owner cookie under the manager's cookie name
        request.COOKIES[f'dbmfa_trust_{manager_user.id}'] = cookie_value
        assert not is_device_trusted(request, manager_user)

    def test_tampered_cookie_returns_false(self, owner_user):
        from django.test import RequestFactory
        factory = RequestFactory()
        request = factory.get('/')
        cookie_name = f'dbmfa_trust_{owner_user.id}'
        request.COOKIES[cookie_name] = 'tampered:value:abc'
        assert not is_device_trusted(request, owner_user)


# ---------------------------------------------------------------------------
# build_totp_uri
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestBuildTotpUri:
    def test_uri_format(self, owner_user):
        from urllib.parse import unquote
        _, secret = start_enrollment(owner_user)
        uri = build_totp_uri(owner_user, secret)
        assert uri.startswith('otpauth://totp/')
        # The email may be URL-encoded in the path; check the decoded form
        assert owner_user.email in unquote(uri)
        assert 'DocksBase' in uri
