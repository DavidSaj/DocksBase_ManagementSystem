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
