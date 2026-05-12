from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import MarinaGroup, MarinaGroupUserRole, User


def make_group_with_admin():
    g = MarinaGroup.objects.create(
        name='Test Group', slug='test-group', base_currency='EUR',
        billing_contact_email='billing@test.com', vat_number='FR12345',
    )
    u = User.objects.create_user(email='admin@test.com', password='pass')
    MarinaGroupUserRole.objects.create(group=g, user=u, role=MarinaGroupUserRole.Role.ADMIN)
    return g, u


class GroupSettingsViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.g, self.user = make_group_with_admin()
        self.client.force_authenticate(self.user)

    def test_get_settings_returns_all_fields(self):
        resp = self.client.get(f'/api/v1/enterprise/groups/{self.g.pk}/settings/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['name'], 'Test Group')
        self.assertEqual(resp.data['billing_contact_email'], 'billing@test.com')
        self.assertEqual(resp.data['vat_number'], 'FR12345')
        self.assertEqual(resp.data['base_currency'], 'EUR')

    def test_patch_updates_allowed_fields(self):
        resp = self.client.patch(
            f'/api/v1/enterprise/groups/{self.g.pk}/settings/',
            {'name': 'Renamed', 'vat_number': 'DE99999', 'billing_contact_email': 'new@test.com'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['name'], 'Renamed')
        self.assertEqual(resp.data['vat_number'], 'DE99999')
        self.g.refresh_from_db()
        self.assertEqual(self.g.name, 'Renamed')

    def test_patch_ignores_max_marinas(self):
        original = self.g.max_marinas
        self.client.patch(
            f'/api/v1/enterprise/groups/{self.g.pk}/settings/',
            {'max_marinas': 999},
            format='json',
        )
        self.g.refresh_from_db()
        self.assertEqual(self.g.max_marinas, original)

    def test_non_admin_get_rejected(self):
        other = User.objects.create_user(email='other@test.com', password='pass')
        c = APIClient()
        c.force_authenticate(other)
        resp = c.get(f'/api/v1/enterprise/groups/{self.g.pk}/settings/')
        self.assertEqual(resp.status_code, 403)

    def test_unauthenticated_rejected(self):
        c = APIClient()
        resp = c.get(f'/api/v1/enterprise/groups/{self.g.pk}/settings/')
        self.assertEqual(resp.status_code, 401)
