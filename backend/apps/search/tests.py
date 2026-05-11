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
