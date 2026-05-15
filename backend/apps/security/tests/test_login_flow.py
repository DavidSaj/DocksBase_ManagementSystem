"""
Login flow tests covering Cases A/B/C/D from the spec, plus edge cases.

Case A — No MFA, no marina policy → JWT pair returned immediately.
Case B — Active MFA, no trust cookie → mfa_required + challenge token.
Case C — Active MFA, valid trust cookie → JWT pair (MFA skipped).
Case D — Marina requires MFA, user has none → mfa_enrollment_required + enrollment token.

Additional:
- Cross-user challenge swap: challenge for user A cannot mint JWT for user B.
- Brute-force cap: 5 wrong attempts invalidate the challenge; 6th with correct code → 401.
- Expired challenge → 401.
- Replay (already consumed challenge) → 401.
- Valid backup code via mfa-verify endpoint.
"""

import pyotp
import pytest
from django.urls import reverse
from rest_framework import status

from apps.security.models import MFAChallenge
from apps.security.services import mfa as mfa_service


LOGIN_URL = '/api/v1/auth/token/'
MFA_VERIFY_URL = '/api/v1/auth/token/mfa-verify/'
MFA_ENROLL_COMPLETE_URL = '/api/v1/auth/token/mfa-enroll-complete/'


# ---------------------------------------------------------------------------
# Case A: Normal login, no MFA
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestLoginCaseA:
    def test_login_returns_jwt_without_mfa(self, api_client, owner_user, marina):
        resp = api_client.post(LOGIN_URL, {
            'email': 'owner@test.com',
            'password': 'ownerpass123',
        })
        assert resp.status_code == status.HTTP_200_OK
        assert 'access' in resp.data
        assert 'refresh' in resp.data
        assert 'mfa_required' not in resp.data

    def test_login_no_marina_mfa_policy(self, api_client, owner_user, marina):
        """Regression: login works for users without MFA when marina has no policy."""
        marina.require_mfa_for_managers = False
        marina.save()
        resp = api_client.post(LOGIN_URL, {
            'email': 'owner@test.com',
            'password': 'ownerpass123',
        })
        assert resp.status_code == status.HTTP_200_OK
        assert 'access' in resp.data


# ---------------------------------------------------------------------------
# Case B: Active MFA, no trust cookie
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestLoginCaseB:
    def test_active_mfa_returns_challenge(self, api_client, owner_user, marina):
        mfa, secret = mfa_service.start_enrollment(owner_user)
        code = pyotp.TOTP(secret).now()
        mfa_service.complete_enrollment(owner_user, code)

        resp = api_client.post(LOGIN_URL, {
            'email': 'owner@test.com',
            'password': 'ownerpass123',
        })
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data.get('mfa_required') is True
        assert 'mfa_challenge_token' in resp.data
        assert 'access' not in resp.data
        assert 'refresh' not in resp.data

    def test_challenge_is_bound_to_user(self, api_client, owner_user, marina):
        mfa, secret = mfa_service.start_enrollment(owner_user)
        code = pyotp.TOTP(secret).now()
        mfa_service.complete_enrollment(owner_user, code)

        resp = api_client.post(LOGIN_URL, {
            'email': 'owner@test.com',
            'password': 'ownerpass123',
        })
        token = resp.data['mfa_challenge_token']
        challenge = MFAChallenge.objects.get(token=token)
        assert challenge.user_id == owner_user.id


# ---------------------------------------------------------------------------
# Case C: Active MFA + valid trust cookie
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestLoginCaseC:
    def test_valid_trust_cookie_skips_mfa(self, api_client, owner_user, marina):
        mfa, secret = mfa_service.start_enrollment(owner_user)
        code = pyotp.TOTP(secret).now()
        mfa_service.complete_enrollment(owner_user, code)

        # Build a valid trust cookie
        from django.http import HttpResponse
        from django.test import RequestFactory
        http_response = HttpResponse()
        mfa_service.mark_device_trusted(http_response, owner_user)
        cookie_name = f'dbmfa_trust_{owner_user.id}'
        cookie_value = http_response.cookies[cookie_name].value

        api_client.cookies[cookie_name] = cookie_value

        resp = api_client.post(LOGIN_URL, {
            'email': 'owner@test.com',
            'password': 'ownerpass123',
        })
        assert resp.status_code == status.HTTP_200_OK
        assert 'access' in resp.data
        assert 'mfa_required' not in resp.data


# ---------------------------------------------------------------------------
# Case D: Marina requires MFA, user has none
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestLoginCaseD:
    def test_marina_requires_mfa_returns_enrollment_payload(self, api_client, owner_user, marina):
        marina.require_mfa_for_managers = True
        marina.save()

        resp = api_client.post(LOGIN_URL, {
            'email': 'owner@test.com',
            'password': 'ownerpass123',
        })
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data.get('mfa_enrollment_required') is True
        assert 'mfa_enrollment_token' in resp.data
        assert 'mfa_secret' in resp.data
        assert 'mfa_qr_uri' in resp.data
        assert 'access' not in resp.data

    def test_marina_policy_applies_to_managers(self, api_client, manager_user, marina):
        marina.require_mfa_for_managers = True
        marina.save()

        resp = api_client.post(LOGIN_URL, {
            'email': 'manager@test.com',
            'password': 'managerpass123',
        })
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data.get('mfa_enrollment_required') is True

    def test_marina_policy_does_not_apply_to_boaters(self, api_client, boater_user, marina):
        marina.require_mfa_for_managers = True
        marina.save()

        resp = api_client.post(LOGIN_URL, {
            'email': 'boater@test.com',
            'password': 'boaterpass123',
        })
        assert resp.status_code == status.HTTP_200_OK
        assert 'access' in resp.data
        assert 'mfa_enrollment_required' not in resp.data


# ---------------------------------------------------------------------------
# mfa-verify endpoint
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestMFAVerify:
    def _enroll_user(self, user):
        mfa, secret = mfa_service.start_enrollment(user)
        code = pyotp.TOTP(secret).now()
        mfa_service.complete_enrollment(user, code)
        return secret

    def test_valid_totp_issues_jwt(self, api_client, owner_user, marina):
        secret = self._enroll_user(owner_user)
        challenge = mfa_service.issue_challenge(owner_user, purpose='login')
        code = pyotp.TOTP(secret).now()

        resp = api_client.post(MFA_VERIFY_URL, {
            'mfa_challenge_token': challenge.token,
            'code': code,
        })
        assert resp.status_code == status.HTTP_200_OK
        assert 'access' in resp.data
        assert 'refresh' in resp.data

    def test_valid_backup_code_issues_jwt(self, api_client, owner_user, marina):
        mfa, secret = mfa_service.start_enrollment(owner_user)
        enroll_code = pyotp.TOTP(secret).now()
        _, raw_codes = mfa_service.complete_enrollment(owner_user, enroll_code)

        challenge = mfa_service.issue_challenge(owner_user, purpose='login')
        resp = api_client.post(MFA_VERIFY_URL, {
            'mfa_challenge_token': challenge.token,
            'code': raw_codes[0],
        })
        assert resp.status_code == status.HTTP_200_OK
        assert 'access' in resp.data

    def test_expired_challenge_returns_401(self, api_client, owner_user, marina):
        from django.utils import timezone
        from datetime import timedelta
        self._enroll_user(owner_user)
        challenge = mfa_service.issue_challenge(owner_user, purpose='login')
        challenge.expires_at = timezone.now() - timedelta(minutes=1)
        challenge.save()

        secret_obj = owner_user.mfa
        code = pyotp.TOTP(secret_obj.secret).now()
        resp = api_client.post(MFA_VERIFY_URL, {
            'mfa_challenge_token': challenge.token,
            'code': code,
        })
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED

    def test_replay_returns_401(self, api_client, owner_user, marina):
        secret = self._enroll_user(owner_user)
        challenge = mfa_service.issue_challenge(owner_user, purpose='login')
        code = pyotp.TOTP(secret).now()

        # First attempt succeeds
        resp1 = api_client.post(MFA_VERIFY_URL, {
            'mfa_challenge_token': challenge.token,
            'code': code,
        })
        assert resp1.status_code == status.HTTP_200_OK

        # Replay same token
        resp2 = api_client.post(MFA_VERIFY_URL, {
            'mfa_challenge_token': challenge.token,
            'code': code,
        })
        assert resp2.status_code == status.HTTP_401_UNAUTHORIZED

    def test_brute_force_cap_blocks_correct_code(self, api_client, owner_user, marina):
        """After 5 wrong attempts, even the correct code is rejected."""
        secret = self._enroll_user(owner_user)
        challenge = mfa_service.issue_challenge(owner_user, purpose='login')

        # Send 5 wrong codes
        for _ in range(mfa_service.BRUTE_FORCE_MAX_ATTEMPTS):
            api_client.post(MFA_VERIFY_URL, {
                'mfa_challenge_token': challenge.token,
                'code': '000000',
            })

        # Now try with correct code — must still fail
        code = pyotp.TOTP(secret).now()
        resp = api_client.post(MFA_VERIFY_URL, {
            'mfa_challenge_token': challenge.token,
            'code': code,
        })
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED

        # Verify challenge is actually invalidated
        challenge.refresh_from_db()
        assert challenge.invalidated_at is not None

    def test_cross_user_challenge_swap_rejected(self, api_client, owner_user, manager_user, marina):
        """
        A challenge issued for owner_user cannot be used to get a JWT for
        manager_user. The bound user is always derived from challenge.user.
        """
        owner_secret = self._enroll_user(owner_user)
        # Enroll manager too
        mfa, mgr_secret = mfa_service.start_enrollment(manager_user)
        enroll_code = pyotp.TOTP(mgr_secret).now()
        mfa_service.complete_enrollment(manager_user, enroll_code)

        # Get a challenge for the owner
        owner_challenge = mfa_service.issue_challenge(owner_user, purpose='login')
        code = pyotp.TOTP(owner_secret).now()

        resp = api_client.post(MFA_VERIFY_URL, {
            'mfa_challenge_token': owner_challenge.token,
            'code': code,
        })
        assert resp.status_code == status.HTTP_200_OK

        # Decode the returned token to verify it's for owner_user, not manager_user
        # JWT stores user_id as string (simplejwt default) or int depending on config
        from rest_framework_simplejwt.tokens import AccessToken
        access_token = AccessToken(resp.data['access'])
        token_user_id = int(access_token['user_id'])
        assert token_user_id == owner_user.id
        assert token_user_id != manager_user.id

    def test_trust_device_cookie_is_set(self, api_client, owner_user, marina):
        secret = self._enroll_user(owner_user)
        challenge = mfa_service.issue_challenge(owner_user, purpose='login')
        code = pyotp.TOTP(secret).now()

        resp = api_client.post(MFA_VERIFY_URL, {
            'mfa_challenge_token': challenge.token,
            'code': code,
            'trust_device': True,
        })
        assert resp.status_code == status.HTTP_200_OK
        assert f'dbmfa_trust_{owner_user.id}' in resp.cookies

    def test_wrong_purpose_challenge_rejected(self, api_client, owner_user, marina):
        secret = self._enroll_user(owner_user)
        # Issue an enrollment challenge, not a login challenge
        challenge = mfa_service.issue_challenge(owner_user, purpose='enrollment')
        code = pyotp.TOTP(secret).now()

        resp = api_client.post(MFA_VERIFY_URL, {
            'mfa_challenge_token': challenge.token,
            'code': code,
        })
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED


# ---------------------------------------------------------------------------
# mfa-enroll-complete endpoint (login-time forced enrollment)
# ---------------------------------------------------------------------------

@pytest.mark.django_db
class TestMFALoginEnrollComplete:
    def test_enroll_complete_issues_jwt_and_backup_codes(self, api_client, owner_user, marina):
        marina.require_mfa_for_managers = True
        marina.save()

        # Trigger Case D to get the enrollment token and secret
        resp = api_client.post(LOGIN_URL, {
            'email': 'owner@test.com',
            'password': 'ownerpass123',
        })
        assert resp.status_code == status.HTTP_200_OK
        assert resp.data.get('mfa_enrollment_required') is True

        enrollment_token = resp.data['mfa_enrollment_token']
        secret = resp.data['mfa_secret']
        code = pyotp.TOTP(secret).now()

        enroll_resp = api_client.post(MFA_ENROLL_COMPLETE_URL, {
            'mfa_enrollment_token': enrollment_token,
            'code': code,
        })
        assert enroll_resp.status_code == status.HTTP_200_OK
        assert 'access' in enroll_resp.data
        assert 'refresh' in enroll_resp.data
        assert 'backup_codes' in enroll_resp.data
        assert len(enroll_resp.data['backup_codes']) == 10

    def test_wrong_purpose_enrollment_token_rejected(self, api_client, owner_user, marina):
        mfa, secret = mfa_service.start_enrollment(owner_user)
        code = pyotp.TOTP(secret).now()
        mfa_service.complete_enrollment(owner_user, code)

        # Issue a *login* challenge and try to use it as enrollment token
        login_challenge = mfa_service.issue_challenge(owner_user, purpose='login')

        # Start new enrollment so there's a pending secret
        mfa_service.disable_mfa(owner_user, 'ownerpass123')
        mfa_service.start_enrollment(owner_user)

        new_code = pyotp.TOTP(secret).now()
        resp = api_client.post(MFA_ENROLL_COMPLETE_URL, {
            'mfa_enrollment_token': login_challenge.token,
            'code': new_code,
        })
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED
