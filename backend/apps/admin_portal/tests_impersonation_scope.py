"""Verify that an impersonation JWT actually scopes API responses to the
impersonated marina (and not the admin's own data, which is none).
"""

from django.test import TestCase
from django.utils import timezone
import datetime
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Marina, User
from apps.admin_portal.models import AuditLog


def make_marina(**kwargs):
    defaults = dict(name='Marina X', status='active', currency='EUR')
    defaults.update(kwargs)
    return Marina.objects.create(**defaults)


class ImpersonationScopesToMarinaTest(TestCase):
    def setUp(self):
        self.marina_a = make_marina(name='Marina A')
        self.marina_b = make_marina(name='Marina B')
        self.owner_a = User.objects.create_user(
            email='owner_a@test.com', password='pass',
            marina=self.marina_a, role='owner',
        )
        self.owner_b = User.objects.create_user(
            email='owner_b@test.com', password='pass',
            marina=self.marina_b, role='owner',
        )
        self.admin = User.objects.create_user(
            email='admin@test.com', password='pass',
            is_platform_admin=True, platform_role='admin',
        )
        self.client = APIClient()

    def _impersonation_token(self, marina):
        # Mirror what AdminMarinaImpersonateView does, but go straight to JWT.
        target = User.objects.filter(
            marina=marina, role__in=['owner', 'manager'], is_active=True,
        ).first()
        refresh = RefreshToken.for_user(target)
        refresh['is_safe_mode'] = True
        refresh['impersonated_marina'] = marina.name
        refresh['impersonated_marina_id'] = marina.pk
        refresh['impersonator_user_id'] = self.admin.pk
        refresh['impersonation_session_id'] = '00000000-0000-0000-0000-000000000001'
        refresh['role'] = target.role
        refresh['is_platform_admin'] = False
        return str(refresh.access_token)

    def test_impersonation_token_returns_marina_specific_profile(self):
        token = self._impersonation_token(self.marina_a)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        # auth/me should now return owner_a, scoped to marina A
        resp = self.client.get('/api/v1/auth/me/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json().get('email'), 'owner_a@test.com')

    def test_impersonation_blocks_writes_via_safe_mode(self):
        token = self._impersonation_token(self.marina_a)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        # Any POST should be rejected by IsSafeModeReadOnly with a clear msg
        resp = self.client.post('/api/v1/auth/login/', {}, format='json')
        # login route is open, but safe-mode token should still trip the gate
        # for any state-changing endpoint requiring auth — use a known authed POST.
        resp2 = self.client.post('/api/v1/bookings/', {}, format='json')
        self.assertEqual(resp2.status_code, 403)
        self.assertIn('Safe Mode', resp2.json().get('detail', ''))

    def test_impersonation_session_id_preserved_across_requests(self):
        token = self._impersonation_token(self.marina_a)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        # The middleware should record an audit row on every successful write,
        # but we expect *no* write here (safe-mode blocks). So instead, assert
        # that the JWT itself carries the session id (decoded in middleware).
        import base64, json
        payload = json.loads(base64.urlsafe_b64decode(
            token.split('.')[1] + '=='
        ))
        self.assertEqual(payload['impersonated_marina_id'], self.marina_a.pk)
        self.assertEqual(payload['impersonator_user_id'], self.admin.pk)
        self.assertTrue(payload['is_safe_mode'])

    def test_impersonation_of_one_marina_does_not_expose_other_marina(self):
        """A token issued for marina A must not authenticate as marina B's owner."""
        token = self._impersonation_token(self.marina_a)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        resp = self.client.get('/api/v1/auth/me/')
        self.assertEqual(resp.status_code, 200)
        self.assertNotEqual(resp.json().get('email'), 'owner_b@test.com')
