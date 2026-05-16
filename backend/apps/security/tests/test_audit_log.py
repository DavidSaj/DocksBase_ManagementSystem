"""
Tests for Task 4: SecurityAuditLog — model, log_event service,
per-event-type payload correctness, and the owner-only AuditLogListView.

TDD order:
  1. Model + migration: row creation, ordering, owner viewset returns it.
  2. log_event service: request=None → no IP; synthesized request → ip+ua.
  3. Per-event-type payload tests: trigger each flow, assert event_type + payload.
  4. Viewset: owner sees, manager gets 403, paginated, newest first, max 100/page.
"""

import pyotp
import pytest
from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APIClient

from apps.accounts.models import Marina, User
from apps.security.models import (
    MFABackupCode,
    MarinaIPAllowlist,
    SecurityAuditLog,
    UserMFA,
)
from apps.security.services.audit import log_event


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def marina(db):
    return Marina.objects.create(name='Audit Test Marina')


@pytest.fixture
def owner_user(marina):
    return User.objects.create_user(
        email='audit_owner@test.com',
        password='ownerpass123',
        marina=marina,
        role='owner',
    )


@pytest.fixture
def manager_user(marina):
    return User.objects.create_user(
        email='audit_manager@test.com',
        password='managerpass123',
        marina=marina,
        role='manager',
    )


@pytest.fixture
def marina2(db):
    return Marina.objects.create(name='Other Marina')


@pytest.fixture
def owner_user2(marina2):
    return User.objects.create_user(
        email='other_owner@test.com',
        password='otherpass123',
        marina=marina2,
        role='owner',
    )


# ---------------------------------------------------------------------------
# 1. Model tests
# ---------------------------------------------------------------------------

class TestSecurityAuditLogModel:
    def test_create_row(self, db, marina, owner_user):
        log = SecurityAuditLog.objects.create(
            marina=marina,
            actor=owner_user,
            event_type='mfa_enrolled',
            payload={},
        )
        assert log.pk is not None
        assert log.marina == marina
        assert log.actor == owner_user
        assert log.event_type == 'mfa_enrolled'
        assert log.payload == {}
        assert log.ip_address is None
        assert log.user_agent == ''
        assert log.created_at is not None

    def test_default_ordering_newest_first(self, db, marina, owner_user):
        """Rows are returned newest-first by default."""
        from django.utils import timezone as tz
        import time
        log1 = SecurityAuditLog.objects.create(
            marina=marina, actor=owner_user, event_type='mfa_enrolled', payload={},
        )
        time.sleep(0.01)
        log2 = SecurityAuditLog.objects.create(
            marina=marina, actor=owner_user, event_type='mfa_disabled',
            payload={'disabled_via': 'self'},
        )
        logs = list(SecurityAuditLog.objects.filter(marina=marina))
        assert logs[0].pk == log2.pk  # newest first
        assert logs[1].pk == log1.pk

    def test_actor_null_when_user_deleted(self, db, marina):
        """actor is SET_NULL on user deletion."""
        user = User.objects.create_user(
            email='temp@test.com', password='pw', marina=marina, role='owner',
        )
        log = SecurityAuditLog.objects.create(
            marina=marina, actor=user, event_type='ip_blocked', payload={'path': '/foo/'},
        )
        user.delete()
        log.refresh_from_db()
        assert log.actor is None

    def test_all_event_choices_valid(self, db, marina, owner_user):
        """Every entry in EVENT_CHOICES can be persisted."""
        for code, _ in SecurityAuditLog.EVENT_CHOICES:
            log = SecurityAuditLog.objects.create(
                marina=marina, actor=owner_user, event_type=code, payload={},
            )
            assert log.event_type == code


# ---------------------------------------------------------------------------
# 2. log_event service tests
# ---------------------------------------------------------------------------

class TestLogEventService:
    def test_request_none_creates_row_no_ip(self, db, marina, owner_user):
        log_event(
            marina=marina,
            actor=owner_user,
            event_type='mfa_enrolled',
            payload={},
            request=None,
        )
        log = SecurityAuditLog.objects.get(marina=marina, event_type='mfa_enrolled')
        assert log.ip_address is None
        assert log.user_agent == ''

    def test_request_with_ip_and_ua(self, db, marina, owner_user):
        """Synthesized request → IP and UA captured."""
        from django.test import RequestFactory
        rf = RequestFactory()
        request = rf.get('/')
        request.META['REMOTE_ADDR'] = '203.0.113.55'
        request.META['HTTP_USER_AGENT'] = 'TestBrowser/1.0'

        log_event(
            marina=marina,
            actor=owner_user,
            event_type='ip_blocked',
            payload={'path': '/api/v1/berths/'},
            request=request,
        )
        log = SecurityAuditLog.objects.get(marina=marina, event_type='ip_blocked')
        assert log.ip_address == '203.0.113.55'
        assert log.user_agent == 'TestBrowser/1.0'

    def test_ua_truncated_to_500_chars(self, db, marina, owner_user):
        from django.test import RequestFactory
        rf = RequestFactory()
        request = rf.get('/')
        request.META['REMOTE_ADDR'] = '10.0.0.1'
        request.META['HTTP_USER_AGENT'] = 'X' * 600

        log_event(
            marina=marina,
            actor=owner_user,
            event_type='mfa_enrolled',
            payload={},
            request=request,
        )
        log = SecurityAuditLog.objects.get(marina=marina, event_type='mfa_enrolled')
        assert len(log.user_agent) == 500

    def test_payload_defaults_to_empty_dict(self, db, marina, owner_user):
        log_event(marina=marina, actor=owner_user, event_type='password_changed')
        log = SecurityAuditLog.objects.get(marina=marina, event_type='password_changed')
        assert log.payload == {}

    def test_actor_can_be_none(self, db, marina):
        log_event(marina=marina, actor=None, event_type='ip_blocked', payload={'path': '/'})
        log = SecurityAuditLog.objects.get(marina=marina, event_type='ip_blocked')
        assert log.actor is None


# ---------------------------------------------------------------------------
# 3. Per-event-type payload tests (end-to-end via APIClient)
# ---------------------------------------------------------------------------

class TestMfaEnrolledEvent:
    def test_settings_flow_mfa_enrolled(self, db, marina, owner_user, api_client):
        """complete-enrollment (Settings flow) writes mfa_enrolled {}."""
        api_client.force_authenticate(owner_user)
        # Start enrollment
        api_client.post('/api/v1/security/mfa/start-enrollment/')
        mfa = UserMFA.objects.get(user=owner_user)
        code = pyotp.TOTP(mfa.secret).now()
        api_client.post('/api/v1/security/mfa/complete-enrollment/', {'code': code})

        log = SecurityAuditLog.objects.get(marina=marina, event_type='mfa_enrolled')
        assert log.actor == owner_user
        assert log.payload == {}

    def test_login_case_d_mfa_enrolled(self, db, marina, api_client):
        """MFALoginEnrollCompleteView (Case D) writes mfa_enrolled {}."""
        from apps.security.models import MFAChallenge
        from apps.security.services import mfa as mfa_svc

        marina.require_mfa_for_managers = True
        marina.save()

        user = User.objects.create_user(
            email='case_d@test.com', password='pass', marina=marina, role='owner',
        )
        # Start enrollment so there's a pending UserMFA row
        _, secret = mfa_svc.start_enrollment(user)
        challenge = mfa_svc.issue_challenge(user, purpose='enrollment')
        code = pyotp.TOTP(secret).now()

        api_client.post('/api/v1/auth/token/mfa-enroll-complete/', {
            'mfa_enrollment_token': challenge.token,
            'code': code,
        })
        log = SecurityAuditLog.objects.get(marina=marina, event_type='mfa_enrolled')
        assert log.actor == user
        assert log.payload == {}


class TestMfaDisabledEvent:
    def test_mfa_disabled_payload(self, db, marina, owner_user, api_client):
        """Disabling MFA writes mfa_disabled {disabled_via: 'self'}."""
        from apps.security.services import mfa as mfa_svc

        _, secret = mfa_svc.start_enrollment(owner_user)
        code = pyotp.TOTP(secret).now()
        mfa_svc.complete_enrollment(owner_user, code)

        api_client.force_authenticate(owner_user)
        api_client.post('/api/v1/security/mfa/disable/', {'password': 'ownerpass123'})

        log = SecurityAuditLog.objects.filter(marina=marina, event_type='mfa_disabled').first()
        assert log is not None
        assert log.payload == {'disabled_via': 'self'}


class TestMfaVerifyEvents:
    def _setup_mfa_user(self, marina, email='mfa_user@test.com'):
        """Helper: create a user with active MFA and return (user, secret)."""
        from apps.security.services import mfa as mfa_svc

        user = User.objects.create_user(
            email=email, password='pass123', marina=marina, role='owner',
        )
        _, secret = mfa_svc.start_enrollment(user)
        code = pyotp.TOTP(secret).now()
        mfa_svc.complete_enrollment(user, code)
        return user, secret

    def test_mfa_succeeded_totp(self, db, marina, api_client):
        from apps.security.services import mfa as mfa_svc

        user, secret = self._setup_mfa_user(marina)
        challenge = mfa_svc.issue_challenge(user, purpose='login')
        code = pyotp.TOTP(secret).now()

        resp = api_client.post('/api/v1/auth/token/mfa-verify/', {
            'mfa_challenge_token': challenge.token,
            'code': code,
        })
        assert resp.status_code == 200

        log = SecurityAuditLog.objects.filter(marina=marina, event_type='mfa_succeeded').first()
        assert log is not None
        assert log.payload == {'method': 'totp'}

    def test_mfa_failed_bad_code(self, db, marina, api_client):
        from apps.security.services import mfa as mfa_svc

        user, _ = self._setup_mfa_user(marina, email='fail_user@test.com')
        challenge = mfa_svc.issue_challenge(user, purpose='login')

        api_client.post('/api/v1/auth/token/mfa-verify/', {
            'mfa_challenge_token': challenge.token,
            'code': '000000',
        })

        log = SecurityAuditLog.objects.filter(marina=marina, event_type='mfa_failed').first()
        assert log is not None
        assert log.payload == {'reason': 'bad_code'}

    def test_mfa_failed_invalidated_challenge(self, db, marina, api_client):
        """6th attempt after 5 failures → invalidated_challenge reason."""
        from apps.security.services import mfa as mfa_svc

        user, secret = self._setup_mfa_user(marina, email='brute_user@test.com')
        challenge = mfa_svc.issue_challenge(user, purpose='login')

        # 5 bad attempts to invalidate the challenge
        for _ in range(5):
            api_client.post('/api/v1/auth/token/mfa-verify/', {
                'mfa_challenge_token': challenge.token,
                'code': '000000',
            })

        # 6th attempt (correct code, but challenge now invalidated)
        code = pyotp.TOTP(secret).now()
        api_client.post('/api/v1/auth/token/mfa-verify/', {
            'mfa_challenge_token': challenge.token,
            'code': code,
        })

        # Last mfa_failed event should have reason='invalidated_challenge'
        logs = list(SecurityAuditLog.objects.filter(
            marina=marina, event_type='mfa_failed',
        ).order_by('-created_at'))
        assert logs[0].payload == {'reason': 'invalidated_challenge'}

    def test_backup_code_used_event(self, db, marina, api_client):
        from apps.security.services import mfa as mfa_svc

        user, secret = self._setup_mfa_user(marina, email='backup_user@test.com')
        challenge = mfa_svc.issue_challenge(user, purpose='login')

        # Get a raw backup code (using the same generation logic)
        import hashlib
        # We need an actual raw code — generate a fresh set
        raw_codes = mfa_svc._generate_backup_codes(user)
        raw_code = raw_codes[0]

        challenge2 = mfa_svc.issue_challenge(user, purpose='login')
        resp = api_client.post('/api/v1/auth/token/mfa-verify/', {
            'mfa_challenge_token': challenge2.token,
            'code': raw_code,
        })
        assert resp.status_code == 200

        # mfa_succeeded with method=backup_code
        succeeded_log = SecurityAuditLog.objects.filter(
            marina=marina, event_type='mfa_succeeded',
        ).order_by('-created_at').first()
        assert succeeded_log.payload == {'method': 'backup_code'}

        # backup_code_used with remaining count
        used_log = SecurityAuditLog.objects.filter(
            marina=marina, event_type='backup_code_used',
        ).order_by('-created_at').first()
        assert used_log is not None
        remaining = MFABackupCode.objects.filter(user=user, used_at__isnull=True).count()
        assert used_log.payload == {'remaining': remaining}


class TestIPAllowlistEvents:
    def test_ip_allowlist_added(self, db, marina, owner_user, api_client):
        api_client.force_authenticate(owner_user)
        resp = api_client.post('/api/v1/security/ip-allowlist/', {
            'cidr': '127.0.0.1/32',
            'label': 'localhost',
        }, REMOTE_ADDR='127.0.0.1')
        assert resp.status_code == 201

        log = SecurityAuditLog.objects.filter(marina=marina, event_type='ip_allowlist_added').first()
        assert log is not None
        assert log.payload['cidr'] == '127.0.0.1/32'
        assert log.payload['label'] == 'localhost'

    def test_ip_allowlist_removed(self, db, marina, owner_user, api_client):
        entry = MarinaIPAllowlist.objects.create(
            marina=marina, cidr='10.0.0.0/8', label='VPN', created_by=owner_user,
        )
        api_client.force_authenticate(owner_user)
        resp = api_client.delete(f'/api/v1/security/ip-allowlist/{entry.pk}/')
        assert resp.status_code == 204

        log = SecurityAuditLog.objects.filter(marina=marina, event_type='ip_allowlist_removed').first()
        assert log is not None
        assert log.payload['cidr'] == '10.0.0.0/8'
        assert log.payload['label'] == 'VPN'

    def test_ip_blocked_event(self, db, marina, owner_user):
        """Non-matching IP on non-empty allowlist triggers ip_blocked audit event."""
        from apps.security.permissions import IPAllowlistPermission
        from django.test import RequestFactory

        MarinaIPAllowlist.objects.create(
            marina=marina, cidr='10.0.0.0/8', label='Internal', created_by=owner_user,
        )
        rf = RequestFactory()
        request = rf.get('/api/v1/berths/', REMOTE_ADDR='203.0.113.99')
        request.user = owner_user

        perm = IPAllowlistPermission()
        result = perm.has_permission(request, None)
        assert result is False

        log = SecurityAuditLog.objects.filter(marina=marina, event_type='ip_blocked').first()
        assert log is not None
        assert log.payload.get('path') == '/api/v1/berths/'
        assert log.ip_address == '203.0.113.99'


class TestEmailReverifiedEvent:
    def test_email_reverified_payload(self, db, marina, owner_user, api_client):
        """Confirming a re-verify email writes email_reverified with previous_verified_at."""
        from apps.accounts.models import EmailVerification

        # Set a known previous verified_at
        previous_dt = timezone.now() - timezone.timedelta(days=100)
        owner_user.email_verified_at = previous_dt
        owner_user.save(update_fields=['email_verified_at'])

        ev = EmailVerification.objects.create(user=owner_user)

        resp = api_client.post('/api/v1/auth/reverify-email/confirm/', {'token': str(ev.token)})
        assert resp.status_code == 200

        log = SecurityAuditLog.objects.filter(marina=marina, event_type='email_reverified').first()
        assert log is not None
        assert 'previous_verified_at' in log.payload
        # Should contain the ISO string of the previous datetime
        assert log.payload['previous_verified_at'] is not None

    def test_email_reverified_payload_null_previous(self, db, marina, owner_user, api_client):
        """If email_verified_at was None before, payload previous_verified_at is None."""
        from apps.accounts.models import EmailVerification

        owner_user.email_verified_at = None
        owner_user.save(update_fields=['email_verified_at'])

        ev = EmailVerification.objects.create(user=owner_user)
        api_client.post('/api/v1/auth/reverify-email/confirm/', {'token': str(ev.token)})

        log = SecurityAuditLog.objects.filter(marina=marina, event_type='email_reverified').first()
        assert log is not None
        assert log.payload['previous_verified_at'] is None


class TestNoRawSecretsInPayloads:
    """Ensure no event payload contains raw codes, passwords, or challenge tokens."""

    def test_mfa_enrolled_payload_empty(self, db, marina, owner_user):
        log_event(marina=marina, actor=owner_user, event_type='mfa_enrolled', payload={})
        log = SecurityAuditLog.objects.get(marina=marina, event_type='mfa_enrolled')
        assert 'secret' not in log.payload
        assert 'code' not in log.payload
        assert 'token' not in log.payload

    def test_mfa_failed_payload_has_no_code(self, db, marina, owner_user):
        log_event(
            marina=marina, actor=owner_user, event_type='mfa_failed',
            payload={'reason': 'bad_code'},
        )
        log = SecurityAuditLog.objects.get(marina=marina, event_type='mfa_failed')
        assert 'code' not in log.payload
        assert 'password' not in log.payload

    def test_backup_code_used_payload_has_no_raw_code(self, db, marina, owner_user):
        log_event(
            marina=marina, actor=owner_user, event_type='backup_code_used',
            payload={'remaining': 9},
        )
        log = SecurityAuditLog.objects.get(marina=marina, event_type='backup_code_used')
        assert 'code' not in log.payload
        assert 'hash' not in log.payload


# ---------------------------------------------------------------------------
# 4. Viewset tests
# ---------------------------------------------------------------------------

class TestAuditLogListView:
    def _url(self):
        return '/api/v1/security/audit/'

    def test_owner_sees_own_marina_events(self, db, marina, owner_user, api_client):
        log_event(marina=marina, actor=owner_user, event_type='mfa_enrolled', payload={})
        api_client.force_authenticate(owner_user)
        resp = api_client.get(self._url())
        assert resp.status_code == 200
        assert resp.data['count'] == 1
        assert resp.data['results'][0]['event_type'] == 'mfa_enrolled'

    def test_owner_does_not_see_other_marina_events(
        self, db, marina, owner_user, marina2, owner_user2, api_client
    ):
        log_event(marina=marina2, actor=owner_user2, event_type='mfa_enrolled', payload={})
        api_client.force_authenticate(owner_user)
        resp = api_client.get(self._url())
        assert resp.status_code == 200
        assert resp.data['count'] == 0

    def test_manager_gets_403(self, db, manager_user, api_client):
        api_client.force_authenticate(manager_user)
        resp = api_client.get(self._url())
        assert resp.status_code == 403

    def test_anonymous_gets_401(self, db, api_client):
        resp = api_client.get(self._url())
        assert resp.status_code == 401

    def test_paginated_newest_first(self, db, marina, owner_user, api_client):
        """Multiple events returned newest-first."""
        import time
        for i in range(3):
            log_event(marina=marina, actor=owner_user, event_type='ip_blocked',
                      payload={'path': f'/api/v1/berths/{i}/'})
            time.sleep(0.01)
        # Add a 4th of different type to identify ordering
        log_event(marina=marina, actor=owner_user, event_type='mfa_enrolled', payload={})

        api_client.force_authenticate(owner_user)
        resp = api_client.get(self._url())
        assert resp.status_code == 200
        results = resp.data['results']
        # Newest first: mfa_enrolled should be first
        assert results[0]['event_type'] == 'mfa_enrolled'

    def test_max_100_per_page(self, db, marina, owner_user, api_client):
        """Page size is capped at 100."""
        for i in range(120):
            SecurityAuditLog.objects.create(
                marina=marina, actor=owner_user,
                event_type='ip_blocked', payload={'path': '/test/'},
            )
        api_client.force_authenticate(owner_user)
        resp = api_client.get(self._url())
        assert resp.status_code == 200
        assert len(resp.data['results']) == 100
        assert resp.data['count'] == 120

    def test_results_include_expected_fields(self, db, marina, owner_user, api_client):
        log_event(
            marina=marina, actor=owner_user, event_type='mfa_enrolled', payload={},
        )
        api_client.force_authenticate(owner_user)
        resp = api_client.get(self._url())
        result = resp.data['results'][0]
        assert 'id' in result
        assert 'event_type' in result
        assert 'payload' in result
        assert 'actor_email' in result
        assert 'ip_address' in result
        assert 'user_agent' in result
        assert 'created_at' in result
        assert result['actor_email'] == owner_user.email


# ---------------------------------------------------------------------------
# 5. api_keys wiring tests
# ---------------------------------------------------------------------------

class TestApiKeyAuditEvents:
    def test_api_key_created_logs_event(self, db, marina, owner_user, api_client):
        api_client.force_authenticate(owner_user)
        resp = api_client.post('/api/v1/api-keys/', {'name': 'Test Key'})
        assert resp.status_code == 201

        log = SecurityAuditLog.objects.filter(marina=marina, event_type='api_key_created').first()
        assert log is not None
        assert log.payload['name'] == 'Test Key'
        assert 'key_prefix' in log.payload
        # Confirm no raw key in payload
        assert 'key' not in log.payload or log.payload.get('key') is None

    def test_api_key_revoked_logs_event(self, db, marina, owner_user, api_client):
        api_client.force_authenticate(owner_user)
        create_resp = api_client.post('/api/v1/api-keys/', {'name': 'Revoke Me'})
        key_id = create_resp.data['id']

        api_client.post(f'/api/v1/api-keys/{key_id}/revoke/')

        log = SecurityAuditLog.objects.filter(marina=marina, event_type='api_key_revoked').first()
        assert log is not None
        assert log.payload['name'] == 'Revoke Me'

    def test_api_key_deleted_logs_event(self, db, marina, owner_user, api_client):
        api_client.force_authenticate(owner_user)
        create_resp = api_client.post('/api/v1/api-keys/', {'name': 'Delete Me'})
        key_id = create_resp.data['id']

        api_client.delete(f'/api/v1/api-keys/{key_id}/')

        log = SecurityAuditLog.objects.filter(marina=marina, event_type='api_key_deleted').first()
        assert log is not None
        assert log.payload['name'] == 'Delete Me'

    def test_api_key_revoke_idempotent_no_duplicate_audit(self, db, marina, owner_user, api_client):
        """Revoking an already-revoked key doesn't create a second audit event."""
        api_client.force_authenticate(owner_user)
        create_resp = api_client.post('/api/v1/api-keys/', {'name': 'Already Revoked'})
        key_id = create_resp.data['id']

        api_client.post(f'/api/v1/api-keys/{key_id}/revoke/')
        api_client.post(f'/api/v1/api-keys/{key_id}/revoke/')  # idempotent

        count = SecurityAuditLog.objects.filter(marina=marina, event_type='api_key_revoked').count()
        assert count == 1
