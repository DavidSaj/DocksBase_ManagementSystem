from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, MarinaGroup, MarinaGroupMembership, MarinaGroupUserRole, User


def make_enterprise_setup():
    """Returns (group, [marina1, marina2], enterprise_admin_user)."""
    g = MarinaGroup.objects.create(name='Test Group', slug='test-group', max_marinas=3, base_currency='EUR')
    m1 = Marina.objects.create(name='Port Alpha', slug='port-alpha', total_berths=50, status='active', currency='EUR')
    m2 = Marina.objects.create(name='Port Beta', slug='port-beta', total_berths=30, status='active', currency='EUR')
    MarinaGroupMembership.objects.create(group=g, marina=m1)
    MarinaGroupMembership.objects.create(group=g, marina=m2)
    u = User.objects.create_user(email='ceo@group.com', password='pass')
    MarinaGroupUserRole.objects.create(group=g, user=u, role=MarinaGroupUserRole.Role.ADMIN)
    return g, [m1, m2], u


class MeViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.g, self.marinas, self.user = make_enterprise_setup()
        self.client.force_authenticate(self.user)

    def test_me_returns_groups(self):
        resp = self.client.get('/api/v1/enterprise/me/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data['groups']), 1)
        self.assertEqual(resp.data['groups'][0]['name'], 'Test Group')

    def test_me_unauthenticated(self):
        c = APIClient()
        resp = c.get('/api/v1/enterprise/me/')
        self.assertEqual(resp.status_code, 401)


class OverviewViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.g, self.marinas, self.user = make_enterprise_setup()
        self.client.force_authenticate(self.user)

    def test_overview_returns_marina_cards(self):
        resp = self.client.get(f'/api/v1/enterprise/groups/{self.g.pk}/overview/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('marinas', resp.data)
        self.assertEqual(len(resp.data['marinas']), 2)
        card = resp.data['marinas'][0]
        self.assertIn('name', card)
        self.assertIn('total_berths', card)
        self.assertIn('occupancy_pct', card)
        self.assertIn('revenue_this_month', card)
        self.assertIn('status', card)

    def test_overview_kpi_strip(self):
        resp = self.client.get(f'/api/v1/enterprise/groups/{self.g.pk}/overview/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('kpis', resp.data)
        kpis = resp.data['kpis']
        self.assertIn('total_berths', kpis)
        self.assertIn('total_active_bookings', kpis)
        self.assertIn('total_mrr', kpis)
        self.assertIn('total_outstanding', kpis)

    def test_overview_non_member_rejected(self):
        other = User.objects.create_user(email='outsider@x.com', password='pass')
        c = APIClient()
        c.force_authenticate(other)
        resp = c.get(f'/api/v1/enterprise/groups/{self.g.pk}/overview/')
        self.assertEqual(resp.status_code, 403)
