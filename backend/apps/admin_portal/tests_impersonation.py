import uuid
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Marina, User
from apps.admin_portal.models import AuditLog


def make_marina(**kwargs):
    defaults = dict(name='Test Marina', status='active', currency='EUR')
    defaults.update(kwargs)
    return Marina.objects.create(**defaults)


def make_user(marina=None, is_platform_admin=False, role='owner', platform_role=''):
    i = User.objects.count()
    return User.objects.create_user(
        email=f'u{i}@test.com', password='pass',
        marina=marina, role=role,
        is_platform_admin=is_platform_admin,
        platform_role=platform_role,
    )


def _impersonation_token(target_user, impersonator_user, marina):
    session_id = str(uuid.uuid4())
    refresh = RefreshToken.for_user(target_user)
    refresh['is_safe_mode'] = True
    refresh['impersonated_marina'] = marina.name
    refresh['impersonated_marina_id'] = marina.pk
    refresh['impersonator_user_id'] = impersonator_user.pk
    refresh['impersonation_session_id'] = session_id
    refresh['role'] = target_user.role
    refresh['is_platform_admin'] = False
    return str(refresh.access_token), session_id


class ImpersonationAuditMiddlewareTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.owner = make_user(self.marina, role='owner')
        self.admin = make_user(None, is_platform_admin=True, platform_role='admin')
        self.client = APIClient()

    def test_post_during_impersonation_creates_audit_log(self):
        token, session_id = _impersonation_token(self.owner, self.admin, self.marina)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        # Hit any POST endpoint that exists
        self.client.post('/api/v1/marina/grant-support-access/')
        logs = AuditLog.objects.filter(impersonation_session_id=session_id)
        self.assertTrue(logs.exists())
        log = logs.first()
        self.assertEqual(log.impersonator_user_id, self.admin.pk)

    def test_get_during_impersonation_does_not_create_audit_log(self):
        token, session_id = _impersonation_token(self.owner, self.admin, self.marina)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        before = AuditLog.objects.filter(impersonation_session_id=session_id).count()
        self.client.get('/api/v1/marina/profile/')
        after = AuditLog.objects.filter(impersonation_session_id=session_id).count()
        self.assertEqual(before, after)

    def test_failed_post_during_impersonation_does_not_create_audit_log(self):
        token, session_id = _impersonation_token(self.owner, self.admin, self.marina)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        before = AuditLog.objects.filter(impersonation_session_id=session_id).count()
        # POST as manager (wrong role) — will return 403
        manager_marina = make_marina(name='Other Marina')
        manager = make_user(manager_marina, role='manager')
        token2, session_id2 = _impersonation_token(manager, self.admin, manager_marina)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token2}')
        resp = self.client.post('/api/v1/marina/grant-support-access/')
        self.assertEqual(resp.status_code, 403)
        after = AuditLog.objects.filter(impersonation_session_id=session_id2).count()
        self.assertEqual(before, after)

    def test_normal_token_does_not_create_impersonation_log(self):
        refresh = RefreshToken.for_user(self.owner)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
        before = AuditLog.objects.count()
        self.client.post('/api/v1/marina/grant-support-access/')
        after = AuditLog.objects.count()
        self.assertEqual(before, after)


import datetime
from django.utils import timezone


class ImpersonateViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.owner = make_user(self.marina, role='owner')
        self.support = make_user(None, is_platform_admin=True, platform_role='support')
        self.admin = make_user(None, is_platform_admin=True, platform_role='admin')
        self.client = APIClient()

    def _auth(self, user):
        refresh = RefreshToken.for_user(user)
        refresh['is_platform_admin'] = user.is_platform_admin
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

    def test_support_blocked_without_consent(self):
        self._auth(self.support)
        resp = self.client.post(f'/api/v1/admin/marinas/{self.marina.pk}/impersonate/')
        self.assertEqual(resp.status_code, 403)
        self.assertIn('not granted support access', resp.json()['detail'])

    def test_support_can_impersonate_with_valid_consent(self):
        self.marina.support_access_granted_until = timezone.now() + datetime.timedelta(hours=24)
        self.marina.save()
        self._auth(self.support)
        resp = self.client.post(f'/api/v1/admin/marinas/{self.marina.pk}/impersonate/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('access', resp.json())

    def test_support_blocked_with_expired_consent(self):
        self.marina.support_access_granted_until = timezone.now() - datetime.timedelta(hours=1)
        self.marina.save()
        self._auth(self.support)
        resp = self.client.post(f'/api/v1/admin/marinas/{self.marina.pk}/impersonate/')
        self.assertEqual(resp.status_code, 403)

    def test_admin_can_override_without_consent_with_reason(self):
        self._auth(self.admin)
        resp = self.client.post(
            f'/api/v1/admin/marinas/{self.marina.pk}/impersonate/',
            {'bypass_reason': 'Emergency invoice issue'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        log = AuditLog.objects.get(action='impersonate_override')
        self.assertEqual(log.detail['bypass_reason'], 'Emergency invoice issue')

    def test_admin_override_requires_reason(self):
        self._auth(self.admin)
        resp = self.client.post(f'/api/v1/admin/marinas/{self.marina.pk}/impersonate/', {}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('bypass_reason', resp.json()['detail'])

    def test_jwt_contains_impersonator_user_id(self):
        self.marina.support_access_granted_until = timezone.now() + datetime.timedelta(hours=24)
        self.marina.save()
        self._auth(self.support)
        resp = self.client.post(f'/api/v1/admin/marinas/{self.marina.pk}/impersonate/')
        import base64, json
        token = resp.json()['access']
        padded = token.split('.')[1] + '=='
        payload = json.loads(base64.urlsafe_b64decode(padded))
        self.assertEqual(payload['impersonator_user_id'], self.support.pk)
        self.assertTrue(payload['is_safe_mode'])
        self.assertFalse(payload['is_platform_admin'])
