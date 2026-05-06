import json
from unittest.mock import patch, MagicMock
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User


VALID_PAYLOAD = {
    'plan_price_id':  'price_starter_test',
    'marina_name':    'Harbour View Marina',
    'address':        '1 Dock Street, Falmouth',
    'lat':            50.152,
    'lng':            -5.065,
    'phone':          '+44 1234 567890',
    'contact_email':  'harbour@example.com',
    'vat_number':     'GB123456789',
    'currency':       'GBP',
    'first_name':     'David',
    'last_name':      'Smith',
    'email':          'david@example.com',
    'password':       'securepass1',
}


class DraftAccountViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    @patch('apps.accounts.views.stripe')
    @patch('apps.accounts.serializers.PLAN_PRICE_IDS', {'starter': 'price_starter_test', 'professional': 'price_pro_test', 'enterprise': 'price_ent_test'})
    def test_creates_pending_marina_and_returns_client_secret(self, mock_stripe):
        mock_stripe.Customer.create.return_value = MagicMock(id='cus_test123')
        si = MagicMock(client_secret='seti_test_secret')
        sub = MagicMock(id='sub_test123', pending_setup_intent=si)
        mock_stripe.Subscription.create.return_value = sub

        resp = self.client.post('/api/v1/auth/onboarding/draft/', VALID_PAYLOAD, format='json')

        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['client_secret'], 'seti_test_secret')

        marina = Marina.objects.get(name='Harbour View Marina')
        self.assertEqual(marina.status, 'pending_payment')
        self.assertEqual(marina.stripe_customer_id, 'cus_test123')
        self.assertEqual(marina.stripe_subscription_id, 'sub_test123')

        user = User.objects.get(email='david@example.com')
        self.assertFalse(user.is_active)
        self.assertEqual(user.role, 'owner')
        self.assertEqual(user.marina, marina)

    @patch('apps.accounts.views.stripe')
    @patch('apps.accounts.serializers.PLAN_PRICE_IDS', {'starter': 'price_starter_test'})
    def test_idempotent_for_pending_payment_email(self, mock_stripe):
        """Second call with same email returns existing client_secret without creating duplicates."""
        si = MagicMock(client_secret='seti_existing_secret')
        existing_sub = MagicMock(id='sub_existing', pending_setup_intent=si)
        mock_stripe.Customer.create.return_value = MagicMock(id='cus_test123')
        mock_stripe.Subscription.create.return_value = MagicMock(id='sub_existing', pending_setup_intent=si)
        mock_stripe.Subscription.retrieve.return_value = existing_sub

        # First call
        self.client.post('/api/v1/auth/onboarding/draft/', VALID_PAYLOAD, format='json')
        marina_count = Marina.objects.count()

        # Second call — same email
        resp = self.client.post('/api/v1/auth/onboarding/draft/', VALID_PAYLOAD, format='json')

        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['client_secret'], 'seti_existing_secret')
        self.assertEqual(Marina.objects.count(), marina_count)  # no new marina

    def test_returns_400_for_already_active_email(self):
        marina = Marina.objects.create(name='Old Marina', status='active')
        User.objects.create_user(email='david@example.com', password='x', marina=marina, role='owner', is_active=True)

        resp = self.client.post('/api/v1/auth/onboarding/draft/', VALID_PAYLOAD, format='json')

        self.assertEqual(resp.status_code, 400)
        self.assertIn('email', resp.data)

    @patch('apps.accounts.views.stripe')
    def test_returns_400_for_unknown_price_id(self, mock_stripe):
        payload = {**VALID_PAYLOAD, 'plan_price_id': 'price_unknown'}
        resp = self.client.post('/api/v1/auth/onboarding/draft/', payload, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('plan_price_id', resp.data)
