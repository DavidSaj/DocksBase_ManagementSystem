import uuid
import datetime
from django.test import TestCase
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import IntegrityError
from rest_framework.test import APIClient
from apps.accounts.models import Marina, EmailVerification
from apps.accounts.emails import send_verification_email, send_welcome_email

User = get_user_model()


class OperationsPausedTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='mgr@example.com', password='pass', marina=self.marina
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_operations_paused_default_false(self):
        self.assertFalse(self.marina.operations_paused)

    def test_patch_operations_paused_persists(self):
        resp = self.client.patch(
            '/api/v1/marina/profile/', {'operations_paused': True}, format='json'
        )
        self.assertEqual(resp.status_code, 200)
        self.marina.refresh_from_db()
        self.assertTrue(self.marina.operations_paused)

    def test_patch_operations_paused_clears(self):
        self.marina.operations_paused = True
        self.marina.save()
        resp = self.client.patch(
            '/api/v1/marina/profile/', {'operations_paused': False}, format='json'
        )
        self.assertEqual(resp.status_code, 200)
        self.marina.refresh_from_db()
        self.assertFalse(self.marina.operations_paused)


class EmailVerificationModelTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='owner@test.com', password='pass',
            marina=self.marina, is_active=False
        )

    def test_email_verification_created(self):
        ev = EmailVerification.objects.create(user=self.user)
        self.assertIsNotNone(ev.token)
        self.assertIsInstance(ev.token, uuid.UUID)

    def test_email_verification_one_to_one(self):
        EmailVerification.objects.create(user=self.user)
        with self.assertRaises(IntegrityError):
            EmailVerification.objects.create(user=self.user)

    def test_marina_onboarding_default(self):
        marina = Marina.objects.create(name='New Marina')
        self.assertEqual(marina.onboarding, {
            'draw_map': False,
            'set_pricing': False,
            'connect_bank': False,
            'invite_staff': False,
        })


class EmailStubTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='stub@test.com', password='pass', marina=self.marina
        )

    def test_send_verification_email_does_not_raise(self):
        token = uuid.uuid4()
        send_verification_email(self.user, token)

    def test_send_welcome_email_does_not_raise(self):
        send_welcome_email(self.user)


class SignupViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_signup_creates_marina_and_user(self):
        resp = self.client.post('/api/v1/auth/signup/', {
            'first_name': 'Anna', 'last_name': 'Schmidt',
            'email': 'anna@marina.com', 'password': 'securepass123',
            'marina_name': 'Port de Vidy',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertIn('detail', resp.data)

        user = User.objects.get(email='anna@marina.com')
        self.assertFalse(user.is_active)
        self.assertEqual(user.role, 'owner')
        self.assertEqual(user.first_name, 'Anna')

        marina = user.marina
        self.assertEqual(marina.name, 'Port de Vidy')
        self.assertEqual(marina.status, 'trial')
        self.assertEqual(marina.plan, 'professional')
        self.assertIsNotNone(marina.trial_ends)
        self.assertEqual(marina.trial_ends, datetime.date.today() + datetime.timedelta(days=30))

    def test_signup_creates_email_verification_token(self):
        resp = self.client.post('/api/v1/auth/signup/', {
            'first_name': 'Anna', 'last_name': 'Schmidt',
            'email': 'anna2@marina.com', 'password': 'securepass123',
            'marina_name': 'Test Port',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        user = User.objects.get(email='anna2@marina.com')
        self.assertTrue(hasattr(user, 'email_verification'))

    def test_signup_duplicate_email_returns_400(self):
        User.objects.create_user(email='taken@marina.com', password='pass')
        resp = self.client.post('/api/v1/auth/signup/', {
            'first_name': 'Bob', 'last_name': 'Jones',
            'email': 'taken@marina.com', 'password': 'pass2',
            'marina_name': 'Another Port',
        }, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('email', resp.data)

    def test_signup_requires_all_fields(self):
        resp = self.client.post('/api/v1/auth/signup/', {
            'email': 'incomplete@marina.com',
        }, format='json')
        self.assertEqual(resp.status_code, 400)


class VerifyEmailViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='verify@test.com', password='pass',
            marina=self.marina, is_active=False
        )
        self.ev = EmailVerification.objects.create(user=self.user)

    def test_verify_activates_user_and_returns_jwt(self):
        resp = self.client.get(f'/api/v1/auth/verify-email/?token={self.ev.token}')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('access', resp.data)
        self.assertIn('refresh', resp.data)
        self.assertIn('user', resp.data)
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_active)

    def test_verify_deletes_token_after_use(self):
        self.client.get(f'/api/v1/auth/verify-email/?token={self.ev.token}')
        self.assertFalse(EmailVerification.objects.filter(pk=self.ev.pk).exists())

    def test_verify_invalid_token_returns_400(self):
        resp = self.client.get('/api/v1/auth/verify-email/?token=00000000-0000-0000-0000-000000000000')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['detail'], 'Invalid or expired link.')

    def test_verify_expired_token_returns_400(self):
        from django.utils import timezone as tz
        EmailVerification.objects.filter(pk=self.ev.pk).update(
            created_at=tz.now() - datetime.timedelta(hours=25)
        )
        resp = self.client.get(f'/api/v1/auth/verify-email/?token={self.ev.token}')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['detail'], 'Invalid or expired link.')


class ResendVerificationViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='resend@test.com', password='pass',
            marina=self.marina, is_active=False
        )
        EmailVerification.objects.create(user=self.user)
        cache.clear()

    def tearDown(self):
        cache.clear()

    def test_resend_creates_new_token(self):
        old_ev = self.user.email_verification
        old_token = old_ev.token
        resp = self.client.post('/api/v1/auth/resend-verification/', {
            'email': 'resend@test.com',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        new_ev = EmailVerification.objects.get(user=self.user)
        self.assertNotEqual(new_ev.token, old_token)

    def test_resend_rate_limit_60s(self):
        self.client.post('/api/v1/auth/resend-verification/', {'email': 'resend@test.com'}, format='json')
        resp = self.client.post('/api/v1/auth/resend-verification/', {'email': 'resend@test.com'}, format='json')
        self.assertEqual(resp.status_code, 429)

    def test_resend_unknown_email_returns_200(self):
        resp = self.client.post('/api/v1/auth/resend-verification/', {
            'email': 'nobody@nowhere.com',
        }, format='json')
        self.assertEqual(resp.status_code, 200)

    def test_resend_already_active_returns_200(self):
        self.user.is_active = True
        self.user.save()
        resp = self.client.post('/api/v1/auth/resend-verification/', {
            'email': 'resend@test.com',
        }, format='json')
        self.assertEqual(resp.status_code, 200)


class LoginUnverifiedTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='unverified@test.com', password='rightpass',
            marina=self.marina, is_active=False
        )

    def test_unverified_login_returns_email_not_verified_code(self):
        resp = self.client.post('/api/v1/auth/token/', {
            'email': 'unverified@test.com',
            'password': 'rightpass',
        }, format='json')
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.data.get('code'), 'email_not_verified')

    def test_wrong_password_does_not_return_email_not_verified(self):
        active_user = User.objects.create_user(
            email='active@test.com', password='correct',
            marina=self.marina, is_active=True
        )
        resp = self.client.post('/api/v1/auth/token/', {
            'email': 'active@test.com',
            'password': 'wrong',
        }, format='json')
        self.assertEqual(resp.status_code, 401)
        self.assertNotEqual(resp.data.get('code'), 'email_not_verified')

    def test_unverified_user_wrong_password_still_returns_email_not_verified(self):
        resp = self.client.post('/api/v1/auth/token/', {
            'email': 'unverified@test.com',
            'password': 'wrongpass',
        }, format='json')
        self.assertEqual(resp.status_code, 401)
        self.assertEqual(resp.data.get('code'), 'email_not_verified')
