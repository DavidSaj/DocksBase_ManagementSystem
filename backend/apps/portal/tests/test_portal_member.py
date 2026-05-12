import datetime
from django.test import TestCase
from rest_framework.test import APIClient
from django.core import signing
from apps.accounts.models import Marina
from apps.members.models import Member


def _make_member_token(member_id, marina_slug, email):
    payload = {'member_id': member_id, 'marina_slug': marina_slug, 'email': email}
    return signing.dumps(payload, salt='portal-member-v1')


class PortalGateViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='Gate Marina', slug='gate-marina',
            wallet_gate_codes=[{'label': 'Main Gate', 'pin': '1234'}],
        )
        self.member = Member.objects.create(marina=self.marina, name='Test Member', email='m@test.com')
        token = _make_member_token(self.member.id, 'gate-marina', 'm@test.com')
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'MemberBearer {token}')

    def test_gate_returns_codes(self):
        response = self.client.get('/api/v1/portal/member/gate/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('gate_codes', response.data)
        self.assertEqual(response.data['gate_codes'][0]['pin'], '1234')


class PortalUtilitiesViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='Util Marina', slug='util-marina',
            app_config={'enable_utilities': True},
        )
        self.member = Member.objects.create(marina=self.marina, name='Util Member', email='u@test.com')
        token = _make_member_token(self.member.id, 'util-marina', 'u@test.com')
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'MemberBearer {token}')

    def test_utilities_returns_200_when_enabled(self):
        response = self.client.get('/api/v1/portal/member/utilities/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('meters', response.data)

    def test_utilities_returns_403_when_disabled(self):
        self.marina.app_config = {'enable_utilities': False}
        self.marina.save()
        response = self.client.get('/api/v1/portal/member/utilities/')
        self.assertEqual(response.status_code, 403)


class PortalWorkOrderViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='WO Marina', slug='wo-marina',
            app_config={'enable_boatyard': True},
        )
        self.member = Member.objects.create(marina=self.marina, name='WO Member', email='wo@test.com')
        token = _make_member_token(self.member.id, 'wo-marina', 'wo@test.com')
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'MemberBearer {token}')

    def test_submit_work_order(self):
        response = self.client.post('/api/v1/portal/member/work-orders/', {
            'description': 'Engine making noise',
            'urgency': 'routine',
        }, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertIn('ref', response.data)

    def test_work_order_blocked_when_feature_disabled(self):
        self.marina.app_config = {'enable_boatyard': False}
        self.marina.save()
        response = self.client.post('/api/v1/portal/member/work-orders/', {
            'description': 'Engine making noise',
            'urgency': 'routine',
        }, format='json')
        self.assertEqual(response.status_code, 403)


class PortalDocumentViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='Doc Marina', slug='doc-marina',
            app_config={'enable_documents': True},
        )
        self.member = Member.objects.create(marina=self.marina, name='Doc Member', email='doc@test.com')
        token = _make_member_token(self.member.id, 'doc-marina', 'doc@test.com')
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'MemberBearer {token}')

    def test_documents_list_returns_200_when_enabled(self):
        response = self.client.get('/api/v1/portal/member/documents/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('documents', response.data)

    def test_documents_blocked_when_disabled(self):
        self.marina.app_config = {'enable_documents': False}
        self.marina.save()
        response = self.client.get('/api/v1/portal/member/documents/')
        self.assertEqual(response.status_code, 403)
