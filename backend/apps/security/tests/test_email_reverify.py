"""
Task 3 — §test_email_reverify

Tests for periodic email re-verification (180/210-day thresholds).

Coverage:
- status_for() matrix: ok / warning / blocked per spec thresholds
- SMTP graceful degradation (marina with empty smtp_host → 'ok' even past 210d)
- EmailReverifyPermission blocks at 220d
- EmailReverifyPermission warns header at 200d (via X-Email-Reverify response header)
- Boater past 220d → permission lets through (boater carve-out per spec §Non-goals)
- /auth/reverify-email/request/ is reachable even when blocked (in EXEMPT_PATHS)
- /auth/reverify-email/request/ POST → 204 (generates token, sends email)
- /auth/reverify-email/confirm/ POST with valid token → 200, sets email_verified_at
- /auth/reverify-email/confirm/ POST with invalid token → 400
"""

import uuid
from datetime import timedelta
from unittest.mock import patch

import pytest
from django.test import RequestFactory
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.accounts.models import Marina, User, EmailVerification


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _user_with_marina(db, email='owner@sea.com', role='owner', smtp_host='smtp.example.com'):
    marina = Marina.objects.create(name='Test Marina', smtp_host=smtp_host)
    user = User.objects.create_user(
        email=email,
        password='pass123',
        marina=marina,
        role=role,
    )
    return user


def _set_email_verified_at(user, delta):
    """Set user.email_verified_at to now() - delta (in-DB and in-object)."""
    when = timezone.now() - delta
    User.objects.filter(pk=user.pk).update(email_verified_at=when)
    user.refresh_from_db()


# ---------------------------------------------------------------------------
# status_for() matrix
# ---------------------------------------------------------------------------

class TestStatusFor:
    """Unit tests for services.reverify.status_for()."""

    def _status(self, user):
        from apps.security.services.reverify import status_for
        return status_for(user)

    def test_fresh_user_is_ok(self, db):
        """A user verified < 180 days ago is 'ok'."""
        user = _user_with_marina(db)
        _set_email_verified_at(user, timedelta(days=10))
        assert self._status(user) == 'ok'

    def test_exactly_at_warn_threshold_is_warning(self, db):
        """A user at exactly 180 days is 'warning' (>= 180d)."""
        user = _user_with_marina(db)
        _set_email_verified_at(user, timedelta(days=180))
        assert self._status(user) == 'warning'

    def test_between_180_and_210_is_warning(self, db):
        """195 days → 'warning'."""
        user = _user_with_marina(db)
        _set_email_verified_at(user, timedelta(days=195))
        assert self._status(user) == 'warning'

    def test_exactly_at_block_threshold_is_blocked(self, db):
        """A user at exactly 210 days is 'blocked' (when SMTP is configured)."""
        user = _user_with_marina(db)
        _set_email_verified_at(user, timedelta(days=210))
        assert self._status(user) == 'blocked'

    def test_past_block_threshold_is_blocked(self, db):
        """220 days → 'blocked' when SMTP is configured."""
        user = _user_with_marina(db)
        _set_email_verified_at(user, timedelta(days=220))
        assert self._status(user) == 'blocked'

    def test_no_email_verified_at_falls_back_to_created_at(self, db):
        """When email_verified_at is None, created_at is used as base."""
        user = _user_with_marina(db)
        # email_verified_at is NULL; user was just created → 'ok'
        assert user.email_verified_at is None
        assert self._status(user) == 'ok'

    def test_both_null_is_ok_defensive(self, db):
        """Defensive: if email_verified_at is None and created_at is None → 'ok'."""
        user = _user_with_marina(db)
        # Force both to None — edge case for platform accounts
        User.objects.filter(pk=user.pk).update(email_verified_at=None)
        user.refresh_from_db()
        # created_at is auto_now_add so it's always set; just test the service
        # handles a hypothetical None gracefully
        from apps.security.services.reverify import status_for
        # Monkey-patch created_at to None to simulate the edge case
        user.email_verified_at = None
        user.created_at = None
        assert status_for(user) == 'ok'


# ---------------------------------------------------------------------------
# SMTP graceful degradation
# ---------------------------------------------------------------------------

class TestSMTPGracefulDegradation:
    """
    When the marina has no smtp_host, the permission should degrade gracefully
    and never hard-block users (they can't receive the reverify email).
    """

    def _status(self, user):
        from apps.security.services.reverify import status_for
        return status_for(user)

    def test_no_smtp_host_past_block_is_ok(self, db):
        """Marina with empty smtp_host → 'ok' even past 210 days."""
        user = _user_with_marina(db, smtp_host='')  # no SMTP
        _set_email_verified_at(user, timedelta(days=220))
        assert self._status(user) == 'ok'

    def test_no_marina_past_block_is_ok(self, db):
        """User with no marina (platform admin) → 'ok' past 210 days."""
        user = User.objects.create_user(
            email='admin@platform.com',
            password='pass123',
            marina=None,
            role='owner',
        )
        User.objects.filter(pk=user.pk).update(email_verified_at=timezone.now() - timedelta(days=220))
        user.refresh_from_db()
        assert self._status(user) == 'ok'

    def test_with_smtp_past_block_is_blocked(self, db):
        """Marina WITH smtp_host → 'blocked' past 210 days (non-degraded path)."""
        user = _user_with_marina(db, smtp_host='smtp.example.com')
        _set_email_verified_at(user, timedelta(days=220))
        assert self._status(user) == 'blocked'


# ---------------------------------------------------------------------------
# EmailReverifyPermission (DRF permission class)
# ---------------------------------------------------------------------------

class TestEmailReverifyPermission:

    def _perm(self):
        from apps.security.permissions import EmailReverifyPermission
        return EmailReverifyPermission()

    def _make_request(self, user, path='/api/v1/berths/'):
        factory = RequestFactory()
        raw = factory.get(path)
        raw.user = user
        return raw

    def test_blocked_user_denied(self, db):
        """A user 220 days past verification is denied by the permission."""
        user = _user_with_marina(db)
        _set_email_verified_at(user, timedelta(days=220))
        request = self._make_request(user)
        assert self._perm().has_permission(request, None) is False

    def test_ok_user_allowed(self, db):
        """A fresh user is allowed through."""
        user = _user_with_marina(db)
        _set_email_verified_at(user, timedelta(days=10))
        request = self._make_request(user)
        assert self._perm().has_permission(request, None) is True

    def test_warning_user_allowed(self, db):
        """A warning-state user is still allowed through (not blocked)."""
        user = _user_with_marina(db)
        _set_email_verified_at(user, timedelta(days=200))
        request = self._make_request(user)
        assert self._perm().has_permission(request, None) is True

    def test_anonymous_allowed(self, db):
        """Anonymous users pass — IsAuthenticated handles 401."""
        from django.contrib.auth.models import AnonymousUser
        factory = RequestFactory()
        raw = factory.get('/api/v1/berths/')
        raw.user = AnonymousUser()
        assert self._perm().has_permission(raw, None) is True

    def test_boater_past_block_threshold_allowed(self, db):
        """Boater past 220 days → still allowed (boater carve-out per spec §Non-goals)."""
        user = _user_with_marina(db, role='boater')
        _set_email_verified_at(user, timedelta(days=220))
        request = self._make_request(user)
        assert self._perm().has_permission(request, None) is True

    def test_exempt_paths_allowed_even_when_blocked(self, db):
        """Blocked users can still access exempt paths (e.g. reverify request)."""
        user = _user_with_marina(db)
        _set_email_verified_at(user, timedelta(days=220))
        for path in [
            '/api/v1/auth/reverify-email/request/',
            '/api/v1/auth/reverify-email/confirm/',
            '/api/v1/auth/token/',
            '/api/v1/auth/me/',
        ]:
            request = self._make_request(user, path=path)
            assert self._perm().has_permission(request, None) is True, (
                f'Exempt path {path} should be allowed even for blocked users'
            )


# ---------------------------------------------------------------------------
# X-Email-Reverify: warning header (via middleware)
# ---------------------------------------------------------------------------

class TestEmailReverifyWarningHeader:
    """
    At 200 days (warning state), the X-Email-Reverify: warning header should
    appear in the response. The permission allows the request; the middleware
    adds the header.
    """

    @pytest.mark.django_db
    def test_warning_header_set_at_200d(self):
        """Response to a warning-state user has X-Email-Reverify: warning."""
        user = _user_with_marina(None, smtp_host='smtp.example.com')
        _set_email_verified_at(user, timedelta(days=200))

        client = APIClient()
        client.force_authenticate(user=user)
        # Whoami-IP is a simple authenticated endpoint we can hit safely
        resp = client.get('/api/v1/security/whoami-ip/')
        assert resp.status_code == status.HTTP_200_OK
        assert resp.get('X-Email-Reverify') == 'warning', (
            'Warning-state users must receive X-Email-Reverify: warning header'
        )

    @pytest.mark.django_db
    def test_no_warning_header_for_fresh_user(self):
        """Fresh user (< 180d) does not receive the warning header."""
        user = _user_with_marina(None, smtp_host='smtp.example.com')
        _set_email_verified_at(user, timedelta(days=10))

        client = APIClient()
        client.force_authenticate(user=user)
        resp = client.get('/api/v1/security/whoami-ip/')
        assert resp.status_code == status.HTTP_200_OK
        assert 'X-Email-Reverify' not in resp, (
            'Fresh users must not receive the X-Email-Reverify header'
        )

    @pytest.mark.django_db
    def test_no_warning_header_for_boater_in_warning_state(self):
        """Boaters are exempt — even in warning state, no header."""
        user = _user_with_marina(None, role='boater', smtp_host='smtp.example.com')
        _set_email_verified_at(user, timedelta(days=200))

        client = APIClient()
        client.force_authenticate(user=user)
        resp = client.get('/api/v1/security/whoami-ip/')
        assert resp.status_code == status.HTTP_200_OK
        # Boaters are exempt — no header expected
        assert resp.get('X-Email-Reverify') != 'warning'


# ---------------------------------------------------------------------------
# Reverify endpoints
# ---------------------------------------------------------------------------

class TestReverifyEndpoints:

    @pytest.mark.django_db
    def test_reverify_request_endpoint_reachable_when_blocked(self):
        """
        POST /api/v1/auth/reverify-email/request/ is in EXEMPT_PATHS.
        A blocked user (220d) can POST to it without getting 403.
        """
        user = _user_with_marina(None, smtp_host='smtp.example.com')
        _set_email_verified_at(user, timedelta(days=220))

        client = APIClient()
        client.force_authenticate(user=user)

        with patch('apps.accounts.emails.send_verification_email') as mock_send:
            resp = client.post('/api/v1/auth/reverify-email/request/')

        # Must not be blocked (403) — the path is exempt
        assert resp.status_code not in (status.HTTP_403_FORBIDDEN,), (
            'Blocked users must be able to reach reverify-email/request/ (EXEMPT_PATHS)'
        )
        assert resp.status_code == status.HTTP_204_NO_CONTENT

    @pytest.mark.django_db
    def test_reverify_request_sends_email(self):
        """POST /api/v1/auth/reverify-email/request/ generates token and sends email."""
        user = _user_with_marina(None, smtp_host='smtp.example.com')
        _set_email_verified_at(user, timedelta(days=200))

        client = APIClient()
        client.force_authenticate(user=user)

        with patch('apps.accounts.emails.send_verification_email') as mock_send:
            resp = client.post('/api/v1/auth/reverify-email/request/')

        assert resp.status_code == status.HTTP_204_NO_CONTENT
        mock_send.assert_called_once()
        called_user, called_token = mock_send.call_args[0]
        assert called_user == user

    @pytest.mark.django_db
    def test_reverify_request_unauthenticated_returns_401(self):
        """Unauthenticated POST to reverify-email/request/ → 401."""
        client = APIClient()
        resp = client.post('/api/v1/auth/reverify-email/request/')
        assert resp.status_code == status.HTTP_401_UNAUTHORIZED

    @pytest.mark.django_db
    def test_reverify_confirm_valid_token_sets_email_verified_at(self):
        """Valid token → 200, user.email_verified_at is updated."""
        user = _user_with_marina(None, smtp_host='smtp.example.com')
        ev = EmailVerification.objects.create(user=user)

        client = APIClient()
        resp = client.post(
            '/api/v1/auth/reverify-email/confirm/',
            {'token': str(ev.token)},
            format='json',
        )
        assert resp.status_code == status.HTTP_200_OK

        user.refresh_from_db()
        assert user.email_verified_at is not None

        # Token should be consumed/deleted
        assert not EmailVerification.objects.filter(token=ev.token).exists()

    @pytest.mark.django_db
    def test_reverify_confirm_invalid_token_returns_400(self):
        """Invalid token → 400."""
        client = APIClient()
        resp = client.post(
            '/api/v1/auth/reverify-email/confirm/',
            {'token': str(uuid.uuid4())},
            format='json',
        )
        assert resp.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.django_db
    def test_reverify_confirm_missing_token_returns_400(self):
        """Missing token body → 400."""
        client = APIClient()
        resp = client.post('/api/v1/auth/reverify-email/confirm/', {}, format='json')
        assert resp.status_code == status.HTTP_400_BAD_REQUEST

    @pytest.mark.django_db
    def test_reverify_confirm_sets_status_to_ok(self):
        """After confirming, status_for() returns 'ok' (age reset)."""
        user = _user_with_marina(None, smtp_host='smtp.example.com')
        _set_email_verified_at(user, timedelta(days=220))
        ev = EmailVerification.objects.create(user=user)

        client = APIClient()
        resp = client.post(
            '/api/v1/auth/reverify-email/confirm/',
            {'token': str(ev.token)},
            format='json',
        )
        assert resp.status_code == status.HTTP_200_OK

        user.refresh_from_db()
        from apps.security.services.reverify import status_for
        assert status_for(user) == 'ok'
