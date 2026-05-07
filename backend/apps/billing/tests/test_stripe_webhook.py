import datetime
import json
from unittest.mock import patch, MagicMock
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina
from apps.billing.models import Invoice
from apps.berths.models import Pier, Berth
from apps.billing.models import ChargeableItem
from apps.reservations.models import Booking


def _setup():
    marina = Marina.objects.create(name='Test Marina')
    tier = ChargeableItem.objects.create(
        marina=marina, name='Berth Night', category='berth',
        pricing_model='per_night', unit_price=100,
    )
    pier = Pier.objects.create(marina=marina, code='A', label='Pier A')
    berth = Berth.objects.create(marina=marina, pier=pier, code='A1', pricing_tier=tier)
    booking = Booking.objects.create(
        marina=marina,
        berth=berth,
        check_in=datetime.date(2026, 7, 15),
        check_out=datetime.date(2026, 7, 22),
        status='awaiting_payment',
        booking_type='transient',
        guest_name='J. Sailor',
        guest_email='sailor@example.com',
    )
    invoice = Invoice.objects.create(
        marina=marina,
        invoice_number='INV-2026-0001',
        status='open',
        booking=booking,
    )
    return marina, booking, invoice, berth


def _make_stripe_event(event_type, invoice_id):
    return {
        'type': event_type,
        'data': {
            'object': {
                'metadata': {'invoice_id': str(invoice_id)},
                'payment_intent': 'pi_test',
            }
        }
    }


def _sync_thread_mock():
    """
    Builds a mock for `threading` whose Thread(...).start() calls the target
    synchronously in the test thread. This keeps assertions deterministic
    without time.sleep.
    """
    mock_threading = MagicMock()

    def make_thread(**kwargs):
        thread = MagicMock()
        target = kwargs.get('target')
        args = kwargs.get('args', ())
        thread.start = lambda: target(*args) if target else None
        return thread

    mock_threading.Thread = MagicMock(side_effect=lambda **kw: make_thread(**kw))
    return mock_threading


class StripeWebhookBookingTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina, self.booking, self.invoice, self.berth = _setup()

    @patch('apps.billing.views.send_booking_confirmed_email')
    @patch('apps.billing.views._generate_store_and_email_pdf')
    @patch('apps.billing.stripe_service.stripe')
    def test_checkout_completed_confirms_booking_and_sends_magic_link(
        self, mock_stripe, mock_pdf, mock_email
    ):
        mock_stripe.Webhook.construct_event.return_value = _make_stripe_event(
            'checkout.session.completed', self.invoice.id
        )
        with patch('apps.billing.views.threading', _sync_thread_mock()):
            resp = self.client.post(
                '/api/v1/billing/stripe/webhook/',
                data=json.dumps({}),
                content_type='application/json',
                HTTP_STRIPE_SIGNATURE='sig',
            )
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, 'confirmed')
        mock_email.assert_called_once()
        called_booking = mock_email.call_args[0][0]
        self.assertEqual(called_booking.pk, self.booking.pk)

    @patch('apps.billing.stripe_service.stripe')
    def test_checkout_expired_cancels_booking_and_releases_berth(self, mock_stripe):
        mock_stripe.Webhook.construct_event.return_value = _make_stripe_event(
            'checkout.session.expired', self.invoice.id
        )
        resp = self.client.post(
            '/api/v1/billing/stripe/webhook/',
            data=json.dumps({}),
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='sig',
        )
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, 'cancelled')
        self.assertIsNone(self.booking.berth)

    @patch('apps.billing.views.send_booking_confirmed_email')
    @patch('apps.billing.views._generate_store_and_email_pdf')
    @patch('apps.billing.stripe_service.stripe')
    def test_checkout_completed_without_booking_fk_still_marks_invoice_paid(
        self, mock_stripe, mock_pdf, mock_email
    ):
        invoice_no_booking = Invoice.objects.create(
            marina=self.marina,
            invoice_number='INV-2026-0002',
            status='open',
        )
        mock_stripe.Webhook.construct_event.return_value = _make_stripe_event(
            'checkout.session.completed', invoice_no_booking.id
        )
        with patch('apps.billing.views.threading', _sync_thread_mock()):
            resp = self.client.post(
                '/api/v1/billing/stripe/webhook/',
                data=json.dumps({}),
                content_type='application/json',
                HTTP_STRIPE_SIGNATURE='sig',
            )
        self.assertEqual(resp.status_code, 200)
        invoice_no_booking.refresh_from_db()
        self.assertEqual(invoice_no_booking.status, 'paid')
        mock_email.assert_not_called()


class StripeConnectPaymentIntentWebhookTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina, self.booking, self.invoice, self.berth = _setup()
        self.marina.stripe_account_id = 'acct_test'
        self.marina.save(update_fields=['stripe_account_id'])

    def _make_pi_event(self, invoice_id):
        return {
            'type': 'payment_intent.succeeded',
            'data': {
                'object': {
                    'id': 'pi_test_connect',
                    'metadata': {'invoice_id': str(invoice_id)},
                }
            }
        }

    @patch('apps.billing.views.send_booking_confirmed_email')
    @patch('apps.billing.views._generate_store_and_email_pdf')
    @patch('apps.billing.stripe_service.stripe')
    def test_payment_intent_succeeded_marks_invoice_paid(
        self, mock_stripe, mock_pdf, mock_email
    ):
        mock_stripe.Webhook.construct_event.return_value = self._make_pi_event(
            self.invoice.id
        )
        with patch('apps.billing.views.threading', _sync_thread_mock()):
            resp = self.client.post(
                '/api/v1/billing/stripe/connect-webhook/',
                data=json.dumps({}),
                content_type='application/json',
                HTTP_STRIPE_SIGNATURE='sig',
            )
        self.assertEqual(resp.status_code, 200)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, 'paid')
        self.assertEqual(self.invoice.stripe_payment_intent_id, 'pi_test_connect')
        self.assertIsNotNone(self.invoice.paid_at)

    @patch('apps.billing.stripe_service.stripe')
    def test_payment_intent_succeeded_is_idempotent(self, mock_stripe):
        self.invoice.status = 'paid'
        self.invoice.save(update_fields=['status'])
        mock_stripe.Webhook.construct_event.return_value = self._make_pi_event(
            self.invoice.id
        )
        resp = self.client.post(
            '/api/v1/billing/stripe/connect-webhook/',
            data=json.dumps({}),
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='sig',
        )
        self.assertEqual(resp.status_code, 200)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, 'paid')
