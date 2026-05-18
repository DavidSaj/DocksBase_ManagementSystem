from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.vessels.models import Vessel
from apps.members.models import Member


class SearchViewTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='mgr@test.com', password='pass', marina=self.marina, role='manager'
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.vessel = Vessel.objects.create(marina=self.marina, name='Lady Katherine', reg='UK123')
        self.member = Member.objects.create(marina=self.marina, name='John Smith', email='john@test.com')

        from apps.search.index_helpers import upsert
        upsert(marina=self.marina, target_model='vessel', target_id=self.vessel.pk,
               search_text=self.vessel.name, display_label=self.vessel.name,
               display_sub='', screen='vessels', link_id=self.vessel.pk)
        upsert(marina=self.marina, target_model='member', target_id=self.member.pk,
               search_text=self.member.name, display_label=self.member.name,
               display_sub=self.member.email or '', screen='members', link_id=self.member.pk)

    def test_requires_auth(self):
        c = APIClient()
        r = c.get('/api/v1/search/?q=lady')
        self.assertEqual(r.status_code, 401)

    def test_vessel_found(self):
        r = self.client.get('/api/v1/search/?q=lady')
        self.assertEqual(r.status_code, 200)
        labels = [item['label'] for item in r.json()]
        self.assertIn('Lady Katherine', labels)

    def test_member_found(self):
        r = self.client.get('/api/v1/search/?q=john')
        self.assertEqual(r.status_code, 200)
        labels = [item['label'] for item in r.json()]
        self.assertIn('John Smith', labels)

    def test_other_marina_not_returned(self):
        other = Marina.objects.create(name='Other Marina')
        Vessel.objects.create(marina=other, name='Secret Vessel', reg='XX999')
        # Intentionally NOT adding 'Secret Vessel' to the index
        r = self.client.get('/api/v1/search/?q=secret')
        self.assertEqual(r.status_code, 200)
        labels = [item['label'] for item in r.json()]
        self.assertNotIn('Secret Vessel', labels)

    def test_empty_query_returns_empty(self):
        r = self.client.get('/api/v1/search/?q=')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json(), [])

    def test_result_has_required_fields(self):
        r = self.client.get('/api/v1/search/?q=lady')
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertTrue(len(data) > 0)
        item = data[0]
        for field in ('type', 'id', 'label', 'sub', 'screen', 'link_id'):
            self.assertIn(field, item)


class MultiFieldSearchTests(TestCase):
    """
    Verifies signals.py concatenates multiple fields into search_text so the
    Harbour Master can find entities by email/reg/owner-name/invoice-amount, etc.
    """

    def setUp(self):
        self.marina = Marina.objects.create(name='Multi Marina')
        self.user = User.objects.create_user(
            email='hm@multi.com', password='pass', marina=self.marina, role='manager',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_member_searchable_by_email(self):
        Member.objects.create(
            marina=self.marina, name='Alice Carpenter',
            email='unique.zenithfox@example.org', phone='+353871234567',
        )
        r = self.client.get('/api/v1/search/?q=zenithfox')
        self.assertEqual(r.status_code, 200)
        labels = [it['label'] for it in r.json()]
        self.assertIn('Alice Carpenter', labels)

    def test_member_searchable_by_phone(self):
        Member.objects.create(
            marina=self.marina, name='Bob Phoneman',
            email='bob@example.org', phone='+353871234567',
        )
        r = self.client.get('/api/v1/search/?q=871234567')
        self.assertEqual(r.status_code, 200)
        labels = [it['label'] for it in r.json()]
        self.assertIn('Bob Phoneman', labels)

    def test_vessel_searchable_by_registration(self):
        Vessel.objects.create(marina=self.marina, name='Dawn Treader', reg='RX-99-ABCXYZ')
        r = self.client.get('/api/v1/search/?q=ABCXYZ')
        self.assertEqual(r.status_code, 200)
        labels = [it['label'] for it in r.json()]
        self.assertIn('Dawn Treader', labels)

    def test_vessel_searchable_by_owner_name(self):
        owner = Member.objects.create(
            marina=self.marina, name='Quentin Overlord', email='q@example.org',
        )
        Vessel.objects.create(
            marina=self.marina, name='Silver Streak', reg='AA1', owner=owner,
        )
        r = self.client.get('/api/v1/search/?q=Overlord')
        self.assertEqual(r.status_code, 200)
        labels = [it['label'] for it in r.json()]
        self.assertIn('Silver Streak', labels)

    def test_invoice_searchable_by_member_name(self):
        from apps.billing.models import Invoice
        member = Member.objects.create(
            marina=self.marina, name='Cornelius Funkmaster', email='c@example.org',
        )
        Invoice.objects.create(
            marina=self.marina, member=member, invoice_number='INV-77777',
            subtotal=100, tax_total=0, total=100, status='unpaid',
        )
        r = self.client.get('/api/v1/search/?q=Funkmaster')
        self.assertEqual(r.status_code, 200)
        items = r.json()
        invoice_labels = [it['label'] for it in items if it['type'] == 'invoice']
        self.assertIn('INV-77777', invoice_labels)

    def test_invoice_searchable_by_number(self):
        from apps.billing.models import Invoice
        Invoice.objects.create(
            marina=self.marina, invoice_number='INV-ABC-12345',
            subtotal=50, tax_total=0, total=50, status='unpaid',
        )
        r = self.client.get('/api/v1/search/?q=ABC-12345')
        self.assertEqual(r.status_code, 200)
        labels = [it['label'] for it in r.json()]
        self.assertIn('INV-ABC-12345', labels)
