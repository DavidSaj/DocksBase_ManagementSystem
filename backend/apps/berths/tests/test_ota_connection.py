from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from apps.accounts.models import Marina, User
from apps.berths.models import OTAConnection


def make_setup():
    marina = Marina.objects.create(name='Test Marina')
    user = User.objects.create_user(email='mgr@test.com', password='pass', marina=marina, role='manager')
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return marina, user, client


class OTAConnectionCRUDTest(TestCase):
    def setUp(self):
        self.marina, self.user, self.client = make_setup()

    def test_create_connection(self):
        resp = self.client.post('/api/v1/ota-connections/', {
            'name': 'mySea', 'inbound_ical_url': 'https://example.com/cal.ics'
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['slug'], 'mysea')
        self.assertIn('outbound_token', resp.data)

    def test_list_connections_scoped_to_marina(self):
        OTAConnection.objects.create(marina=self.marina, name='A', slug='a')
        other = Marina.objects.create(name='Other Marina')
        OTAConnection.objects.create(marina=other, name='B', slug='b')
        resp = self.client.get('/api/v1/ota-connections/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 1)

    def test_delete_connection(self):
        conn = OTAConnection.objects.create(marina=self.marina, name='A', slug='a')
        resp = self.client.delete(f'/api/v1/ota-connections/{conn.pk}/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(OTAConnection.objects.filter(pk=conn.pk).exists())

    def test_patch_target_pct(self):
        conn = OTAConnection.objects.create(marina=self.marina, name='A', slug='a')
        resp = self.client.patch(f'/api/v1/ota-connections/{conn.pk}/', {'target_pct': 30}, format='json')
        self.assertEqual(resp.status_code, 200)
        conn.refresh_from_db()
        self.assertEqual(conn.target_pct, 30)

    def test_duplicate_slug_rejected(self):
        OTAConnection.objects.create(marina=self.marina, name='A', slug='a')
        resp = self.client.post('/api/v1/ota-connections/', {'name': 'A2'}, format='json')
        self.assertEqual(resp.status_code, 400)
