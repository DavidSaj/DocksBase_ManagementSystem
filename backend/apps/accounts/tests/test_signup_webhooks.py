import json
from unittest.mock import patch
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User, EmailVerification


def _marina_with_owner(stripe_customer_id='cus_test', status='pending_payment'):
    marina = Marina.objects.create(
        name='Test Marina',
        status=status,
        stripe_customer_id=stripe_customer_id,
        stripe_subscription_id='sub_test',
    )
    User.objects.create_user(
        email='owner@example.com',
        password='x',
        marina=marina,
        role='owner',
        is_active=False,
    )
    return marina


class SignupWebhookTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    @patch('apps.billing.views._stripe_svc.stripe.Webhook.construct_event')
    @patch('apps.billing.views._send_verification_email')
    def test_subscription_updated_active_activates_marina(self, mock_email, mock_construct):
        marina = _marina_with_owner()
        mock_construct.return_value = {
            'type': 'customer.subscription.updated',
            'data': {'object': {
                'customer':   'cus_test',
                'status':     'active',
                'trial_end':  1893456000,
            }},
        }

        resp = self.client.post(
            '/api/v1/billing/stripe/webhook/',
            data=b'payload',
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='sig_test',
        )

        self.assertEqual(resp.status_code, 200)
        marina.refresh_from_db()
        self.assertEqual(marina.status, 'trial')
        self.assertIsNotNone(marina.trial_ends)
        mock_email.assert_called_once()

    @patch('apps.billing.views._stripe_svc.stripe.Webhook.construct_event')
    def test_subscription_deleted_suspends_marina(self, mock_construct):
        marina = _marina_with_owner(status='trial')
        mock_construct.return_value = {
            'type': 'customer.subscription.deleted',
            'data': {'object': {'customer': 'cus_test'}},
        }

        resp = self.client.post(
            '/api/v1/billing/stripe/webhook/',
            data=b'payload',
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='sig_test',
        )

        self.assertEqual(resp.status_code, 200)
        marina.refresh_from_db()
        self.assertEqual(marina.status, 'suspended')

    @patch('apps.billing.views._stripe_svc.stripe.Webhook.construct_event')
    @patch('apps.billing.views._send_payment_failed_email')
    def test_invoice_payment_failed_emails_owner(self, mock_email, mock_construct):
        marina = _marina_with_owner(status='trial')
        mock_construct.return_value = {
            'type': 'invoice.payment_failed',
            'data': {'object': {'customer': 'cus_test'}},
        }

        resp = self.client.post(
            '/api/v1/billing/stripe/webhook/',
            data=b'payload',
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='sig_test',
        )

        self.assertEqual(resp.status_code, 200)
        mock_email.assert_called_once()
