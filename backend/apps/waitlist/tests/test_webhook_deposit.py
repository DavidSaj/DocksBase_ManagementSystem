"""Integration test for the Stripe webhook branch that flips a waitlist
entry's deposit to ``paid`` on ``payment_intent.succeeded``.
"""
from __future__ import annotations

import json
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import Marina
from apps.waitlist.models import WaitlistEntry


def _entry(marina):
    return WaitlistEntry.objects.create(
        marina=marina,
        applicant_name='Webhook Test',
        applicant_email='webhook@example.com',
        vessel_loa_m=Decimal('11.0'),
        vessel_beam_m=Decimal('3.5'),
        vessel_draft_m=Decimal('1.5'),
        pref_min_loa_m=Decimal('10.0'),
        pref_max_loa_m=Decimal('13.0'),
        deposit_amount_cents=7500,
        deposit_state='unpaid',
    )


def _event(entry_id, *, pi_id='pi_wl_deposit'):
    return {
        'type': 'payment_intent.succeeded',
        'data': {
            'object': {
                'id': pi_id,
                'metadata': {
                    'kind': 'waitlist_deposit',
                    'entry_id': str(entry_id),
                },
            }
        },
    }


class StripeWebhookWaitlistDepositTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina = Marina.objects.create(
            name='WL Marina', currency='EUR',
            waitlist_enabled=True, waitlist_deposit_cents=7500,
            max_waitlist_declines=3,
        )
        self.entry = _entry(self.marina)

    @patch('apps.billing.stripe_service.stripe')
    def test_webhook_payment_intent_waitlist_deposit_flips_state(self, mock_stripe):
        # Capture pre-paid priority (includes the +10y unpaid offset)
        self.entry.refresh_priority()
        self.entry.save(update_fields=['priority_score'])
        unpaid_priority = float(self.entry.priority_score)

        mock_stripe.Webhook.construct_event.return_value = _event(self.entry.id)
        resp = self.client.post(
            '/api/v1/billing/stripe/webhook/',
            data=json.dumps({}),
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='sig',
        )
        self.assertEqual(resp.status_code, 200)
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.deposit_state, 'paid')
        self.assertEqual(self.entry.deposit_payment_intent_id, 'pi_wl_deposit')
        self.assertIsNotNone(self.entry.deposit_paid_at)
        # priority_score recomputed: paid drops the +10y unpaid offset.
        paid_priority = float(self.entry.priority_score)
        self.assertLess(paid_priority, unpaid_priority)

    @patch('apps.billing.stripe_service.stripe')
    def test_webhook_waitlist_deposit_is_idempotent(self, mock_stripe):
        # Pre-mark paid
        self.entry.deposit_state = 'paid'
        self.entry.deposit_payment_intent_id = 'pi_first'
        self.entry.save(update_fields=['deposit_state', 'deposit_payment_intent_id'])

        mock_stripe.Webhook.construct_event.return_value = _event(
            self.entry.id, pi_id='pi_second',
        )
        resp = self.client.post(
            '/api/v1/billing/stripe/webhook/',
            data=json.dumps({}),
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='sig',
        )
        self.assertEqual(resp.status_code, 200)
        self.entry.refresh_from_db()
        # Original pi_id retained — idempotent no-op.
        self.assertEqual(self.entry.deposit_state, 'paid')
        self.assertEqual(self.entry.deposit_payment_intent_id, 'pi_first')

    @patch('apps.billing.stripe_service.stripe')
    def test_webhook_waitlist_deposit_via_connect_endpoint(self, mock_stripe):
        """The deposit PI is created on the Connect account, so Stripe will
        deliver the event to the connect-webhook endpoint."""
        mock_stripe.Webhook.construct_event.return_value = _event(self.entry.id)
        resp = self.client.post(
            '/api/v1/billing/stripe/connect-webhook/',
            data=json.dumps({}),
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='sig',
        )
        self.assertEqual(resp.status_code, 200)
        self.entry.refresh_from_db()
        self.assertEqual(self.entry.deposit_state, 'paid')
