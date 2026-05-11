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
        resp = self.client.post('/api/v1/auth/verify-email/', {'token': str(self.ev.token)}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('access', resp.data)
        self.assertIn('refresh', resp.data)
        self.assertIn('user', resp.data)
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_active)

    def test_verify_deletes_token_after_use(self):
        self.client.post('/api/v1/auth/verify-email/', {'token': str(self.ev.token)}, format='json')
        self.assertFalse(EmailVerification.objects.filter(pk=self.ev.pk).exists())

    def test_verify_invalid_token_returns_400(self):
        resp = self.client.post('/api/v1/auth/verify-email/', {'token': '00000000-0000-0000-0000-000000000000'}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['detail'], 'Invalid or expired link.')

    def test_verify_expired_token_returns_400(self):
        from django.utils import timezone as tz
        EmailVerification.objects.filter(pk=self.ev.pk).update(
            created_at=tz.now() - datetime.timedelta(hours=25)
        )
        resp = self.client.post('/api/v1/auth/verify-email/', {'token': str(self.ev.token)}, format='json')
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
        # Returns 200 (not 429) intentionally — same response for rate-limited and unknown
        # emails to prevent enumeration attacks
        self.assertEqual(resp.status_code, 200)

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


class OnboardingViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='owner@test.com', password='pass',
            marina=self.marina, role='owner'
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_get_onboarding_returns_dict(self):
        resp = self.client.get('/api/v1/auth/marina/onboarding/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('draw_map', resp.data)
        self.assertIn('set_pricing', resp.data)
        self.assertIn('connect_bank', resp.data)
        self.assertIn('invite_staff', resp.data)

    def test_patch_draw_map_and_set_pricing(self):
        resp = self.client.patch('/api/v1/auth/marina/onboarding/', {
            'draw_map': True,
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp.data['draw_map'])

    def test_patch_connect_bank_rejected(self):
        resp = self.client.patch('/api/v1/auth/marina/onboarding/', {
            'connect_bank': True,
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_patch_invite_staff_rejected(self):
        resp = self.client.patch('/api/v1/auth/marina/onboarding/', {
            'invite_staff': True,
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_invite_staff_signal_fires_when_second_user_added(self):
        User.objects.create_user(
            email='staff@test.com', password='pass',
            marina=self.marina, role='staff', is_active=True
        )
        self.marina.refresh_from_db()
        self.assertTrue(self.marina.onboarding.get('invite_staff'))

    def test_invite_staff_signal_does_not_fire_for_boater(self):
        User.objects.create_user(
            email='boater@test.com', password='pass',
            marina=self.marina, role='boater', is_active=True
        )
        self.marina.refresh_from_db()
        self.assertFalse(self.marina.onboarding.get('invite_staff'))

    def test_invite_staff_signal_preserves_other_keys_when_onboarding_empty(self):
        self.marina.onboarding = {}
        self.marina.save(update_fields=['onboarding'])
        User.objects.create_user(
            email='staff2@test.com', password='pass',
            marina=self.marina, role='staff', is_active=True
        )
        self.marina.refresh_from_db()
        onboarding = self.marina.onboarding
        self.assertTrue(onboarding.get('invite_staff'))
        self.assertIn('draw_map', onboarding)
        self.assertIn('set_pricing', onboarding)
        self.assertIn('connect_bank', onboarding)


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

    def test_unverified_user_wrong_password_returns_standard_auth_error(self):
        resp = self.client.post('/api/v1/auth/token/', {
            'email': 'unverified@test.com',
            'password': 'wrongpass',
        }, format='json')
        self.assertEqual(resp.status_code, 401)
        self.assertNotEqual(resp.data.get('code'), 'email_not_verified')


class SupportAccessFieldTest(TestCase):
    def test_field_exists_and_defaults_null(self):
        marina = Marina.objects.create(name='Test')
        self.assertIsNone(marina.support_access_granted_until)

    def test_field_accepts_datetime(self):
        from django.utils import timezone
        import datetime
        marina = Marina.objects.create(name='Test2')
        future = timezone.now() + datetime.timedelta(hours=48)
        marina.support_access_granted_until = future
        marina.save()
        marina.refresh_from_db()
        self.assertIsNotNone(marina.support_access_granted_until)


class MarinaDropboxSignFieldsTest(TestCase):
    def test_fields_exist_and_default_blank(self):
        m = Marina.objects.create(name='Test', slug='test-ds-fields')
        self.assertEqual(m.dropboxsign_api_key, '')
        self.assertEqual(m.dropboxsign_client_id, '')


class DropboxSignSettingsViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina = Marina.objects.create(name='Test Marina DS', slug='test-ds-settings-view')
        # Create a manager user for this marina
        self.user = User.objects.create_user(
            email='mgr-ds@test.com',
            password='pw',
            marina=self.marina,
            role='manager',
            is_active=True,
        )
        self.client.force_authenticate(user=self.user)

    def test_get_returns_masked_key_and_client_id(self):
        self.marina.dropboxsign_api_key = 'sk_live_abc123456789'
        self.marina.dropboxsign_client_id = 'client_xyz'
        self.marina.save()
        resp = self.client.get('/api/v1/marina/integrations/dropbox-sign/')
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn('sk_live_abc123456789', str(resp.data))
        self.assertEqual(resp.data['api_key_tail'], '6789')
        self.assertEqual(resp.data['client_id'], 'client_xyz')
        self.assertTrue(resp.data['connected'])

    def test_get_returns_not_connected_when_empty(self):
        resp = self.client.get('/api/v1/marina/integrations/dropbox-sign/')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data['connected'])
        self.assertEqual(resp.data['api_key_tail'], '')

    def test_patch_saves_credentials(self):
        resp = self.client.patch(
            '/api/v1/marina/integrations/dropbox-sign/',
            {'api_key': 'sk_live_newkey', 'client_id': 'new_client'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.marina.refresh_from_db()
        self.assertEqual(self.marina.dropboxsign_api_key, 'sk_live_newkey')
        self.assertEqual(self.marina.dropboxsign_client_id, 'new_client')

    def test_patch_empty_strings_clears_integration(self):
        self.marina.dropboxsign_api_key = 'old_key'
        self.marina.dropboxsign_client_id = 'old_client'
        self.marina.save()
        resp = self.client.patch(
            '/api/v1/marina/integrations/dropbox-sign/',
            {'api_key': '', 'client_id': ''},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.marina.refresh_from_db()
        self.assertEqual(self.marina.dropboxsign_api_key, '')
        self.assertFalse(resp.data['connected'])
