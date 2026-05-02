from decimal import Decimal
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.members.models import Member
from apps.billing.models import Invoice, AccountPayment, PaymentAllocation


def make_marina(name='Test Marina'):
    return Marina.objects.create(name=name)


def make_user(marina):
    return User.objects.create_user(email='staff@test.com', password='pass', marina=marina, role='manager')


def make_member(marina, name='Hans', email='hans@test.com'):
    return Member.objects.create(marina=marina, name=name, email=email)


def make_open_invoice(marina, member, total, source_type='berth'):
    count = Invoice.objects.filter(marina=marina).count()
    return Invoice.objects.create(
        marina=marina, member=member,
        invoice_number=f'INV-{count + 1:04d}',
        status='open', subtotal=total, total=total,
        source_type=source_type,
    )


class AccountListViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_returns_only_members_with_outstanding_balance(self):
        m1 = make_member(self.marina, 'Alice', 'alice@test.com')
        m2 = make_member(self.marina, 'Bob', 'bob@test.com')
        make_open_invoice(self.marina, m1, Decimal('100.00'))
        resp = self.client.get('/api/v1/billing/accounts/')
        self.assertEqual(resp.status_code, 200)
        names = [r['name'] for r in resp.json()['results']]
        self.assertIn('Alice', names)
        self.assertNotIn('Bob', names)

    def test_show_all_includes_zero_balance_members(self):
        make_member(self.marina, 'Zero', 'zero@test.com')
        resp = self.client.get('/api/v1/billing/accounts/', {'show_all': 'true'})
        self.assertEqual(resp.status_code, 200)
        names = [r['name'] for r in resp.json()['results']]
        self.assertIn('Zero', names)

    def test_search_filters_by_name_case_insensitive(self):
        make_member(self.marina, 'Hans Müller', 'hans@test.com')
        make_member(self.marina, 'Maria Schmidt', 'maria@test.com')
        resp = self.client.get('/api/v1/billing/accounts/', {'search': 'hans', 'show_all': 'true'})
        names = [r['name'] for r in resp.json()['results']]
        self.assertIn('Hans Müller', names)
        self.assertNotIn('Maria Schmidt', names)

    def test_response_includes_required_fields(self):
        m = make_member(self.marina)
        make_open_invoice(self.marina, m, Decimal('500.00'))
        resp = self.client.get('/api/v1/billing/accounts/')
        row = resp.json()['results'][0]
        for field in ('member_id', 'name', 'member_type', 'total_outstanding',
                      'credit_on_account', 'open_invoice_count', 'portal_active'):
            self.assertIn(field, row)

    def test_scoped_to_requesting_marina(self):
        other = make_marina('Other Marina')
        foreign_member = make_member(other, 'Foreigner', 'f@test.com')
        make_open_invoice(other, foreign_member, Decimal('999.00'))
        resp = self.client.get('/api/v1/billing/accounts/')
        names = [r['name'] for r in resp.json()['results']]
        self.assertNotIn('Foreigner', names)

    def test_requires_authentication(self):
        self.client.logout()
        resp = self.client.get('/api/v1/billing/accounts/')
        self.assertEqual(resp.status_code, 401)


class AccountDetailViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.member = make_member(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_returns_correct_structure(self):
        make_open_invoice(self.marina, self.member, Decimal('500.00'), 'berth')
        resp = self.client.get(f'/api/v1/billing/accounts/{self.member.pk}/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('member', data)
        self.assertIn('summary', data)
        self.assertIn('open_invoices', data)

    def test_total_outstanding_reflects_partial_allocations(self):
        inv = make_open_invoice(self.marina, self.member, Decimal('500.00'))
        payment = AccountPayment.objects.create(
            marina=self.marina, member=self.member,
            amount=Decimal('300.00'), method='cash',
        )
        PaymentAllocation.objects.create(
            payment=payment, invoice=inv, allocated_amount=Decimal('300.00')
        )
        resp = self.client.get(f'/api/v1/billing/accounts/{self.member.pk}/')
        data = resp.json()
        self.assertEqual(data['summary']['total_outstanding'], '200.00')
        self.assertEqual(data['open_invoices'][0]['amount_paid_so_far'], '300.00')

    def test_by_category_aggregation(self):
        make_open_invoice(self.marina, self.member, Decimal('400.00'), 'berth')
        make_open_invoice(self.marina, self.member, Decimal('100.00'), 'fuel_dock')
        resp = self.client.get(f'/api/v1/billing/accounts/{self.member.pk}/')
        cats = resp.json()['summary']['by_category']
        self.assertEqual(cats['berth'], '400.00')
        self.assertEqual(cats['fuel'], '100.00')

    def test_404_for_member_in_different_marina(self):
        other = make_marina('Other')
        foreign = make_member(other, 'Foreigner', 'f@test.com')
        resp = self.client.get(f'/api/v1/billing/accounts/{foreign.pk}/')
        self.assertEqual(resp.status_code, 404)
