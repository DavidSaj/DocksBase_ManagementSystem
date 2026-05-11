import datetime
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from apps.accounts.models import Marina, User


def make_marina():
    return Marina.objects.create(name='Test Marina', status='active')


def make_user(marina, role='owner'):
    i = User.objects.count()
    return User.objects.create_user(
        email=f'u{i}@test.com', password='pass', marina=marina, role=role
    )


def auth(client, user):
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')


class GrantSupportAccessTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.owner = make_user(self.marina, 'owner')
        self.manager = make_user(self.marina, 'manager')
        self.client = APIClient()

    def test_owner_can_grant_access(self):
        auth(self.client, self.owner)
        resp = self.client.post('/api/v1/marina/grant-support-access/')
        self.assertEqual(resp.status_code, 200)
        self.marina.refresh_from_db()
        self.assertIsNotNone(self.marina.support_access_granted_until)
        diff = self.marina.support_access_granted_until - timezone.now()
        self.assertGreater(diff.total_seconds(), 47 * 3600)

    def test_manager_cannot_grant_access(self):
        auth(self.client, self.manager)
        resp = self.client.post('/api/v1/marina/grant-support-access/')
        self.assertEqual(resp.status_code, 403)

    def test_owner_can_revoke_access(self):
        self.marina.support_access_granted_until = timezone.now() + datetime.timedelta(hours=48)
        self.marina.save()
        auth(self.client, self.owner)
        resp = self.client.delete('/api/v1/marina/grant-support-access/')
        self.assertEqual(resp.status_code, 200)
        self.marina.refresh_from_db()
        self.assertIsNone(self.marina.support_access_granted_until)

    def test_unauthenticated_blocked(self):
        resp = self.client.post('/api/v1/marina/grant-support-access/')
        self.assertEqual(resp.status_code, 401)
