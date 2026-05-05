from unittest.mock import patch, MagicMock
from django.test import TestCase
from django.core.signing import TimestampSigner
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User


def _pending_marina(email='owner@example.com'):
    marina = Marina.objects.create(
        name='Test Marina',
        status='pending_payment',
        stripe_subscription_id='sub_test_resume',
    )
    User.objects.create_user(email=email, password='x', marina=marina, role='owner', is_active=False)
    return marina


class ResumeViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.signer = TimestampSigner()

    @patch('apps.accounts.views.stripe')
    def test_valid_token_returns_client_secret(self, mock_stripe):
        marina = _pending_marina()
        si = MagicMock(client_secret='seti_resume_secret')
        mock_stripe.Subscription.retrieve.return_value = MagicMock(pending_setup_intent=si)

        token = self.signer.sign(str(marina.id))
        resp = self.client.post('/api/v1/auth/onboarding/resume/', {'token': token}, format='json')

        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['client_secret'], 'seti_resume_secret')
        self.assertEqual(resp.data['marina_name'], 'Test Marina')

    def test_invalid_token_returns_400(self):
        resp = self.client.post('/api/v1/auth/onboarding/resume/', {'token': 'garbage'}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_expired_token_returns_400(self):
        marina = _pending_marina(email='exp@example.com')
        token = self.signer.sign(str(marina.id))

        with patch('apps.accounts.views.TimestampSigner') as MockSigner:
            from django.core.signing import SignatureExpired
            MockSigner.return_value.unsign.side_effect = SignatureExpired('expired')
            resp = self.client.post('/api/v1/auth/onboarding/resume/', {'token': token}, format='json')

        self.assertEqual(resp.status_code, 400)

    def test_token_for_active_marina_returns_400(self):
        marina = Marina.objects.create(name='Active Marina', status='active', stripe_subscription_id='sub_x')
        User.objects.create_user(email='active@example.com', password='x', marina=marina, role='owner')
        token = self.signer.sign(str(marina.id))
        resp = self.client.post('/api/v1/auth/onboarding/resume/', {'token': token}, format='json')
        self.assertEqual(resp.status_code, 400)
