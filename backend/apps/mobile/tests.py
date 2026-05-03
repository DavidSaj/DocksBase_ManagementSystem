from decimal import Decimal
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.members.models import Member
from apps.billing.models import Invoice


def make_marina(name='Test Marina'):
    return Marina.objects.create(name=name)


def make_open_invoice(marina, member, total):
    count = Invoice.objects.count()
    return Invoice.objects.create(
        marina=marina, member=member,
        invoice_number=f'INV-{count + 1:04d}',
        status='open', subtotal=total, total=total, source_type='berth',
    )


class MyAccountViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.boater_user = User.objects.create_user(
            email='boater@test.com', password='pass',
            marina=self.marina, role='boater',
        )
        self.member = Member.objects.create(
            marina=self.marina, name='Hans', email='boater@test.com',
            boater_user=self.boater_user,
        )
        self.client = APIClient()

    def test_returns_account_data_for_boater(self):
        make_open_invoice(self.marina, self.member, Decimal('500.00'))
        self.client.force_authenticate(user=self.boater_user)
        resp = self.client.get('/api/v1/mobile/my-account/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data['member']['name'], 'Hans')
        self.assertEqual(data['summary']['total_outstanding'], '500.00')

    def test_403_for_staff_user_without_member_profile(self):
        staff = User.objects.create_user(
            email='staff@test.com', password='pass',
            marina=self.marina, role='manager',
        )
        self.client.force_authenticate(user=staff)
        resp = self.client.get('/api/v1/mobile/my-account/')
        self.assertEqual(resp.status_code, 403)

    def test_401_for_unauthenticated(self):
        resp = self.client.get('/api/v1/mobile/my-account/')
        self.assertEqual(resp.status_code, 401)


class ActivatePortalViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.boater_user = User.objects.create_user(
            email='boater@test.com', password=None,
            marina=self.marina, role='boater', is_active=False,
        )
        Member.objects.create(
            marina=self.marina, name='Hans',
            boater_user=self.boater_user,
        )
        self.client = APIClient()

    def _make_token(self):
        from django.contrib.auth.tokens import default_token_generator
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode
        uid = urlsafe_base64_encode(force_bytes(self.boater_user.pk))
        token = default_token_generator.make_token(self.boater_user)
        return uid, token

    def test_valid_token_activates_user_and_returns_jwt(self):
        uid, token = self._make_token()
        resp = self.client.post('/api/v1/mobile/activate/', {
            'uid': uid, 'token': token, 'password': 'NewPass123!',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('access', resp.json())
        self.assertIn('refresh', resp.json())
        self.boater_user.refresh_from_db()
        self.assertTrue(self.boater_user.is_active)
        self.assertTrue(self.boater_user.check_password('NewPass123!'))

    def test_invalid_token_returns_400(self):
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode
        uid = urlsafe_base64_encode(force_bytes(self.boater_user.pk))
        resp = self.client.post('/api/v1/mobile/activate/', {
            'uid': uid, 'token': 'invalid-token', 'password': 'Pass123!',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.boater_user.refresh_from_db()
        self.assertFalse(self.boater_user.is_active)

    def test_missing_fields_returns_400(self):
        resp = self.client.post('/api/v1/mobile/activate/', {}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_already_active_user_returns_400(self):
        uid, token = self._make_token()
        # First activation
        self.client.post('/api/v1/mobile/activate/', {
            'uid': uid, 'token': token, 'password': 'NewPass123!',
        }, format='json')
        # Second attempt with same token
        resp = self.client.post('/api/v1/mobile/activate/', {
            'uid': uid, 'token': token, 'password': 'AnotherPass123!',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
