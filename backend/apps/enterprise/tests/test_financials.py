from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, MarinaGroup, MarinaGroupMembership, MarinaGroupUserRole, User
from apps.billing.models import Invoice


def make_enterprise_setup():
    g = MarinaGroup.objects.create(name='Test Group', slug='test-grp', max_marinas=3, base_currency='EUR')
    m1 = Marina.objects.create(name='Port Alpha', slug='pa', currency='EUR', status='active')
    m2 = Marina.objects.create(name='Port Beta', slug='pb', currency='EUR', status='active')
    MarinaGroupMembership.objects.create(group=g, marina=m1)
    MarinaGroupMembership.objects.create(group=g, marina=m2)
    u = User.objects.create_user(email='cfo@group.com', password='pass')
    MarinaGroupUserRole.objects.create(group=g, user=u, role=MarinaGroupUserRole.Role.ADMIN)
    return g, m1, m2, u


class FinancialsViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.g, self.m1, self.m2, self.user = make_enterprise_setup()
        self.client.force_authenticate(self.user)

    def test_financials_returns_required_keys(self):
        resp = self.client.get(f'/api/v1/enterprise/groups/{self.g.pk}/financials/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('base_currency', resp.data)
        self.assertIn('paid_this_month', resp.data)
        self.assertIn('outstanding', resp.data)
        self.assertIn('mrr', resp.data)
        self.assertIn('monthly_revenue', resp.data)
        self.assertIn('missing_fx', resp.data)

    def test_financials_aggregates_same_currency(self):
        from django.utils import timezone
        period = f'{timezone.now().year}-{timezone.now().month:02d}'
        Invoice.objects.create(marina=self.m1, invoice_number='INV-001', status='paid',
                               billing_period=period, total='100.00', subtotal='100.00')
        Invoice.objects.create(marina=self.m2, invoice_number='INV-002', status='paid',
                               billing_period=period, total='200.00', subtotal='200.00')
        resp = self.client.get(f'/api/v1/enterprise/groups/{self.g.pk}/financials/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['base_currency'], 'EUR')
        self.assertAlmostEqual(float(resp.data['paid_this_month']), 300.0, places=1)

    def test_financials_outstanding(self):
        Invoice.objects.create(marina=self.m1, invoice_number='INV-003', status='unpaid',
                               total='500.00', subtotal='500.00')
        resp = self.client.get(f'/api/v1/enterprise/groups/{self.g.pk}/financials/')
        self.assertAlmostEqual(float(resp.data['outstanding']), 500.0, places=1)

    def test_monthly_revenue_has_12_entries(self):
        resp = self.client.get(f'/api/v1/enterprise/groups/{self.g.pk}/financials/')
        self.assertEqual(len(resp.data['monthly_revenue']), 12)

    def test_non_member_rejected(self):
        other = User.objects.create_user(email='outsider@x.com', password='pass')
        c = APIClient()
        c.force_authenticate(other)
        resp = c.get(f'/api/v1/enterprise/groups/{self.g.pk}/financials/')
        self.assertEqual(resp.status_code, 403)

    def test_missing_fx_tracked(self):
        from apps.accounting.models import ExchangeRate
        # Create a marina with GBP currency (no ExchangeRate exists)
        m3 = Marina.objects.create(name='Port GBP', slug='pgbp', currency='GBP', status='active')
        from apps.accounts.models import MarinaGroupMembership
        MarinaGroupMembership.objects.create(group=self.g, marina=m3)
        # Update group max_marinas to allow 3
        self.g.max_marinas = 3
        self.g.save()

        from django.utils import timezone
        period = f'{timezone.now().year}-{timezone.now().month:02d}'
        Invoice.objects.create(marina=m3, invoice_number='INV-GBP', status='paid',
                               billing_period=period, total='100.00', subtotal='100.00')
        resp = self.client.get(f'/api/v1/enterprise/groups/{self.g.pk}/financials/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('GBP', resp.data['missing_fx'])
