"""Tests for the refund feature (Refund model, service, endpoints, webhook)."""
import json
from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Marina, User
from apps.billing.models import Invoice, Refund


# ── Helpers ──────────────────────────────────────────────────────────────────

def _make_marina():
    return Marina.objects.create(name='Test Marina', currency='EUR', stripe_account_id='acct_test123')


def _make_user(marina, role='manager', email='mgr@test.com'):
    return User.objects.create_user(email=email, password='pass', marina=marina, role=role)


def _make_paid_invoice(marina, total='100.00', pi='pi_test123'):
    return Invoice.objects.create(
        marina=marina,
        invoice_number=f'INV-{pi}',
        status='paid',
        total=Decimal(total),
        subtotal=Decimal(total),
        stripe_payment_intent_id=pi,
        paid_at=timezone.now(),
    )


def _fake_stripe_refund(**overrides):
    """Build a MagicMock that behaves like a stripe.Refund response object."""
    base = {'id': 're_test123', 'status': 'succeeded', 'amount': 10000, 'payment_intent': 'pi_test123'}
    base.update(overrides)
    m = MagicMock()
    for k, v in base.items():
        setattr(m, k, v)
    # Dict-style access also works on stripe response objects in some paths.
    m.get = lambda key, default=None: base.get(key, default)
    return m


# ── Endpoint: POST /refunds/ ─────────────────────────────────────────────────

class RefundEndpointTests(TestCase):
    def setUp(self):
        self.marina = _make_marina()
        self.user = _make_user(self.marina, role='manager')
        self.invoice = _make_paid_invoice(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    @patch('apps.billing.stripe_service.stripe.Refund.create')
    def test_full_refund_happy_path_succeeded(self, mock_create):
        mock_create.return_value = _fake_stripe_refund()
        resp = self.client.post(
            '/api/v1/billing/refunds/',
            data={'invoice_id': self.invoice.id, 'reason': 'requested_by_customer'},
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['status'], 'succeeded')
        self.assertEqual(resp.data['amount_cents'], 10000)
        self.assertEqual(resp.data['stripe_refund_id'], 're_test123')
        row = Refund.objects.get(pk=resp.data['id'])
        self.assertEqual(row.status, Refund.Status.SUCCEEDED)
        self.assertIsNotNone(row.completed_at)

    @patch('apps.billing.stripe_service.stripe.Refund.create')
    def test_partial_refund(self, mock_create):
        mock_create.return_value = _fake_stripe_refund(amount=2500)
        resp = self.client.post(
            '/api/v1/billing/refunds/',
            data={'invoice_id': self.invoice.id, 'amount_cents': 2500, 'reason': 'duplicate'},
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['amount_cents'], 2500)
        # Stripe was asked to refund 2500c only.
        _, kwargs = mock_create.call_args
        self.assertEqual(kwargs['amount'], 2500)
        self.assertEqual(kwargs['reason'], 'duplicate')

    @patch('apps.billing.stripe_service.stripe.Refund.create')
    def test_cannot_refund_more_than_remaining(self, mock_create):
        resp = self.client.post(
            '/api/v1/billing/refunds/',
            data={'invoice_id': self.invoice.id, 'amount_cents': 999999},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('exceeds remaining', resp.data['detail'])
        mock_create.assert_not_called()

    def test_cannot_refund_unpaid_invoice(self):
        unpaid = Invoice.objects.create(
            marina=self.marina, invoice_number='INV-UNPAID', status='open',
            total=Decimal('50.00'), stripe_payment_intent_id='pi_x',
        )
        resp = self.client.post(
            '/api/v1/billing/refunds/',
            data={'invoice_id': unpaid.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('paid', resp.data['detail'].lower())

    @patch('apps.billing.stripe_service.stripe.Refund.create')
    def test_stripe_180_day_error_yields_manual_required(self, mock_create):
        import stripe as real_stripe
        err = real_stripe.error.InvalidRequestError(
            'Refund cannot be made because the charge is older than 180 days.',
            param='charge',
        )
        mock_create.side_effect = err
        resp = self.client.post(
            '/api/v1/billing/refunds/',
            data={'invoice_id': self.invoice.id, 'reason': 'requested_by_customer'},
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['status'], 'manual_required')
        self.assertIn('180', resp.data['notes'])

    @patch('apps.billing.stripe_service.stripe.Refund.create')
    def test_non_manager_user_gets_403(self, mock_create):
        staff = _make_user(self.marina, role='staff', email='staff@test.com')
        c = APIClient()
        c.force_authenticate(user=staff)
        resp = c.post(
            '/api/v1/billing/refunds/',
            data={'invoice_id': self.invoice.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 403)
        mock_create.assert_not_called()

    def test_offline_refund_records_succeeded_without_stripe(self):
        resp = self.client.post(
            '/api/v1/billing/refunds/',
            data={
                'invoice_id': self.invoice.id,
                'amount_cents': 5000,
                'reason': 'other',
                'offline': True,
                'notes': 'Paid by cheque #4242',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['status'], 'succeeded')
        self.assertEqual(resp.data['stripe_refund_id'], '')
        self.assertTrue(resp.data['is_offline'])


# ── Webhook ──────────────────────────────────────────────────────────────────

class RefundWebhookTests(TestCase):
    def setUp(self):
        self.marina = _make_marina()
        self.user = _make_user(self.marina)
        self.invoice = _make_paid_invoice(self.marina)
        # Pre-existing pending Refund row that should be updated by the webhook.
        self.refund = Refund.objects.create(
            marina=self.marina, invoice=self.invoice,
            stripe_payment_intent_id='pi_test123', stripe_refund_id='',
            amount_cents=10000, currency='eur', reason='other',
            status=Refund.Status.PENDING, requested_by=self.user,
        )

    @patch('apps.billing.stripe_service.stripe.Webhook.construct_event')
    def test_charge_refunded_event_updates_refund_row(self, mock_event):
        mock_event.return_value = {
            'type': 'charge.refunded',
            'data': {
                'object': {
                    'payment_intent': 'pi_test123',
                    'refunds': {
                        'data': [
                            {'id': 're_xyz', 'status': 'succeeded', 'payment_intent': 'pi_test123'}
                        ]
                    },
                }
            },
        }
        client = APIClient()
        resp = client.post(
            '/api/v1/billing/stripe/webhook/',
            data=json.dumps({}),
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='sig',
        )
        self.assertEqual(resp.status_code, 200)
        self.refund.refresh_from_db()
        self.assertEqual(self.refund.stripe_refund_id, 're_xyz')
        self.assertEqual(self.refund.status, Refund.Status.SUCCEEDED)
        self.assertIsNotNone(self.refund.completed_at)
