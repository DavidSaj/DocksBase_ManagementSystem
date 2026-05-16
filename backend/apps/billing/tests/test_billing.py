import datetime
from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import Marina, User
from apps.members.models import Member
from apps.berths.models import Pier, Berth
from apps.billing.models import ChargeableItem


# ── Helpers ────────────────────────────────────────────────────────────────────

def make_marina(stripe_account_id='acct_test123'):
    from apps.billing.service import seed_default_tax_rates
    marina = Marina.objects.create(
        name='Test Marina',
        stripe_account_id=stripe_account_id,
    )
    seed_default_tax_rates(marina)
    return marina


def make_item(marina, name='Test Berth', category='berth', pricing_model='per_night',
              unit_price='50.00', rate_name='Standard — 20.00%'):
    from apps.billing.models import TaxRate
    tax_cat = TaxRate.objects.get(marina=marina, name=rate_name)
    return ChargeableItem.objects.create(
        marina=marina, name=name, category=category,
        pricing_model=pricing_model, unit_price=Decimal(unit_price),
        tax_category=tax_cat,
    )


def make_user(marina, email='staff@test.com'):
    return User.objects.create_user(
        email=email, password='pass', marina=marina, role='manager'
    )


def make_member(marina, email='hans@boat.ch'):
    return Member.objects.create(marina=marina, name='Hans Müller', email=email)


# ── Tests ──────────────────────────────────────────────────────────────────────

from apps.billing.models import Invoice, InvoiceLineItem, Payment


class BillingModelTest(TestCase):
    def setUp(self):
        self.marina = make_marina()

    def test_invoice_required_fields(self):
        invoice = Invoice.objects.create(
            marina=self.marina,
            invoice_number='INV-2026-0001',
            status='draft',
            source_type='berth_booking',
            source_id='42',
        )
        invoice.refresh_from_db()
        self.assertEqual(invoice.invoice_number, 'INV-2026-0001')
        self.assertEqual(invoice.status, 'draft')
        self.assertEqual(invoice.source_id, '42')
        self.assertIsNone(invoice.member)
        self.assertEqual(invoice.subtotal, Decimal('0.00'))
        self.assertEqual(invoice.tax_total, Decimal('0.00'))
        self.assertEqual(invoice.total, Decimal('0.00'))
        self.assertIsNone(invoice.paid_at)
        self.assertEqual(invoice.stripe_checkout_session_id, '')
        self.assertEqual(invoice.stripe_payment_intent_id, '')

    def test_invoice_line_item_fields(self):
        invoice = Invoice.objects.create(
            marina=self.marina, invoice_number='INV-2026-0002',
            status='draft',
        )
        item = InvoiceLineItem.objects.create(
            invoice=invoice,
            description='Berth A1 — 3 nights @ 50/night',
            quantity=Decimal('1.00'),
            unit_price=Decimal('150.00'),
            total_price=Decimal('150.00'),
        )
        self.assertEqual(item.invoice, invoice)
        self.assertEqual(item.total_price, Decimal('150.00'))

    def test_payment_fields(self):
        invoice = Invoice.objects.create(
            marina=self.marina, invoice_number='INV-2026-0003',
            status='open',
        )
        payment = Payment.objects.create(
            invoice=invoice, method='cash', amount=Decimal('50.00'),
        )
        self.assertEqual(payment.method, 'cash')
        self.assertIsNotNone(payment.paid_at)
        self.assertIsNone(payment.recorded_by)


from apps.billing import service as billing_service


class InvoiceNumberTest(TestCase):
    def test_first_invoice_gets_formatted_number(self):
        marina = make_marina()
        inv = billing_service.create_invoice(marina, source_type='berth_booking', source_id='1')
        import re
        self.assertRegex(inv.invoice_number, r'^INV-\d{4}-\d{4}$')

    def test_second_invoice_increments(self):
        marina = make_marina()
        inv1 = billing_service.create_invoice(marina, source_type='berth_booking', source_id='1')
        inv2 = billing_service.create_invoice(marina, source_type='berth_booking', source_id='2')
        seq1 = int(inv1.invoice_number.split('-')[2])
        seq2 = int(inv2.invoice_number.split('-')[2])
        self.assertEqual(seq2, seq1 + 1)


class ServiceLayerTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)

    def test_create_invoice_snapshots_member(self):
        inv = billing_service.create_invoice(
            self.marina, member=self.member,
            source_type='berth_booking', source_id='10',
        )
        self.assertEqual(inv.status, 'draft')
        self.assertEqual(inv.member, self.member)
        self.assertEqual(inv.source_id, '10')

    def test_add_line_item_calculates_total_price(self):
        inv = billing_service.create_invoice(self.marina, source_type='berth_booking', source_id='11')
        item = billing_service.add_line_item(inv, 'Berth A1 — 3 nights', Decimal('1.00'), Decimal('150.00'))
        self.assertEqual(item.total_price, Decimal('150.00'))
        self.assertEqual(item.description, 'Berth A1 — 3 nights')

    def test_add_line_item_rejects_non_draft_invoice(self):
        inv = billing_service.create_invoice(self.marina, source_type='berth_booking', source_id='12')
        billing_service.add_line_item(inv, 'Item', Decimal('1'), Decimal('50'))
        billing_service.finalize_invoice(inv)
        with self.assertRaises(ValueError):
            billing_service.add_line_item(inv, 'Extra', Decimal('1'), Decimal('10'))

    def test_finalize_calculates_subtotal_tax_total(self):
        inv = billing_service.create_invoice(self.marina, source_type='berth_booking', source_id='13')
        billing_service.add_line_item(inv, 'Berth', Decimal('1'), Decimal('100.00'), tax_rate=Decimal('8.10'))
        billing_service.add_line_item(inv, 'Electricity', Decimal('1'), Decimal('20.00'), tax_rate=Decimal('0.00'))
        billing_service.finalize_invoice(inv)
        inv.refresh_from_db()
        self.assertEqual(inv.subtotal, Decimal('120.00'))
        # tax comes from per-line-item tax_rate: only the berth line has tax
        expected_tax = (Decimal('100.00') * Decimal('8.10') / 100).quantize(Decimal('0.01'))
        self.assertEqual(inv.tax_total, expected_tax)
        self.assertEqual(inv.total, inv.subtotal + inv.tax_total)
        self.assertEqual(inv.status, 'open')

    def test_finalize_rejects_non_draft(self):
        inv = billing_service.create_invoice(self.marina, source_type='berth_booking', source_id='14')
        billing_service.add_line_item(inv, 'Item', Decimal('1'), Decimal('50'))
        billing_service.finalize_invoice(inv)
        with self.assertRaises(ValueError):
            billing_service.finalize_invoice(inv)

    def test_mark_paid_manual_creates_payment_and_flips_status(self):
        inv = billing_service.create_invoice(self.marina, source_type='restaurant_order', source_id='99')
        billing_service.add_line_item(inv, 'Coffee', Decimal('2'), Decimal('4.00'))
        billing_service.finalize_invoice(inv)
        billing_service.mark_paid_manual(inv, 'cash')
        inv.refresh_from_db()
        self.assertEqual(inv.status, 'paid')
        self.assertIsNotNone(inv.paid_at)
        self.assertEqual(inv.payments.count(), 1)
        self.assertEqual(inv.payments.first().method, 'cash')

    def test_mark_paid_manual_rejects_invalid_method(self):
        inv = billing_service.create_invoice(self.marina, source_type='restaurant_order', source_id='100')
        billing_service.add_line_item(inv, 'Beer', Decimal('1'), Decimal('5.00'))
        billing_service.finalize_invoice(inv)
        with self.assertRaises(ValueError):
            billing_service.mark_paid_manual(inv, 'bitcoin')

    def test_void_open_invoice(self):
        inv = billing_service.create_invoice(self.marina, source_type='berth_booking', source_id='15')
        billing_service.add_line_item(inv, 'Item', Decimal('1'), Decimal('50'))
        billing_service.finalize_invoice(inv)
        billing_service.void_invoice(inv)
        inv.refresh_from_db()
        self.assertEqual(inv.status, 'void')

    def test_void_paid_invoice_raises(self):
        inv = billing_service.create_invoice(self.marina, source_type='restaurant_order', source_id='101')
        billing_service.add_line_item(inv, 'Pasta', Decimal('1'), Decimal('18.00'))
        billing_service.finalize_invoice(inv)
        billing_service.mark_paid_manual(inv, 'cash')
        with self.assertRaises(ValueError):
            billing_service.void_invoice(inv)

    def test_zero_vat_rate_graceful(self):
        marina = Marina.objects.create(name='Zero VAT Marina', vat_rate=Decimal('0.00'))
        inv = billing_service.create_invoice(marina, source_type='berth_booking', source_id='16')
        billing_service.add_line_item(inv, 'Berth', Decimal('1'), Decimal('100.00'))
        billing_service.finalize_invoice(inv)
        inv.refresh_from_db()
        self.assertEqual(inv.tax_total, Decimal('0.00'))
        self.assertEqual(inv.total, Decimal('100.00'))


from apps.reservations.models import Booking


def make_berth(marina, price=Decimal('50.00')):
    pier = Pier.objects.create(marina=marina, code='A', label='Pier A')
    tier = make_item(marina, name='Berth Night', unit_price=str(price))
    return Berth.objects.create(
        marina=marina, pier=pier, code='A1',
        pricing_tier=tier, status='available',
    )


class SignalReceiverTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)
        self.berth = make_berth(self.marina)

    def test_berth_booking_invoice_paid_confirms_booking(self):
        booking = Booking.objects.create(
            marina=self.marina,
            berth=self.berth,
            check_in=datetime.date(2026, 6, 1),
            check_out=datetime.date(2026, 6, 4),
            status='awaiting_payment',
        )
        inv = billing_service.create_invoice(
            self.marina, member=self.member,
            source_type='berth_booking', source_id=str(booking.id),
        )
        billing_service.add_line_item(inv, 'Berth', Decimal('1'), Decimal('150.00'))
        billing_service.finalize_invoice(inv)
        billing_service.mark_paid_manual(inv, 'cash')
        booking.refresh_from_db()
        self.assertEqual(booking.status, 'confirmed')

    def test_restaurant_invoice_paid_does_not_touch_bookings(self):
        booking = Booking.objects.create(
            marina=self.marina,
            berth=self.berth,
            check_in=datetime.date(2026, 6, 1),
            check_out=datetime.date(2026, 6, 4),
            status='awaiting_payment',
        )
        inv = billing_service.create_invoice(
            self.marina, source_type='restaurant_order', source_id=str(booking.id),
        )
        billing_service.add_line_item(inv, 'Coffee', Decimal('1'), Decimal('4.00'))
        billing_service.finalize_invoice(inv)
        billing_service.mark_paid_manual(inv, 'cash')
        booking.refresh_from_db()
        self.assertEqual(booking.status, 'awaiting_payment')


import json


class StripeCheckoutSessionTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)

    @patch('apps.billing.stripe_service.stripe')
    def test_create_checkout_session_stores_session_id_and_returns_url(self, mock_stripe):
        mock_session = MagicMock()
        mock_session.id = 'cs_test_abc123'
        mock_session.url = 'https://checkout.stripe.com/pay/cs_test_abc123'
        mock_stripe.checkout.Session.create.return_value = mock_session

        inv = billing_service.create_invoice(
            self.marina, member=self.member,
            source_type='berth_booking', source_id='20',
            due_date=datetime.date(2026, 7, 1),
        )
        billing_service.add_line_item(inv, 'Berth A1 — 3 nights', Decimal('1'), Decimal('150.00'))
        billing_service.finalize_invoice(inv)
        url = billing_service.create_stripe_checkout_session(inv)

        inv.refresh_from_db()
        self.assertEqual(inv.stripe_checkout_session_id, 'cs_test_abc123')
        self.assertEqual(url, 'https://checkout.stripe.com/pay/cs_test_abc123')

    def test_create_checkout_session_rejects_draft_invoice(self):
        inv = billing_service.create_invoice(
            self.marina, source_type='berth_booking', source_id='21',
        )
        with self.assertRaises(ValueError):
            billing_service.create_stripe_checkout_session(inv)


class InvoiceIssuedEmailTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)

    def _open_invoice(self):
        inv = billing_service.create_invoice(
            self.marina, member=self.member,
            source_type='berth_booking', source_id='99',
            due_date=datetime.date(2026, 7, 1),
        )
        billing_service.add_line_item(inv, 'Berth A1', Decimal('1'), Decimal('120.00'))
        billing_service.finalize_invoice(inv)
        return inv

    @patch('apps.billing.stripe_service.stripe')
    def test_issued_email_contains_stripe_payment_link(self, mock_stripe):
        from django.core import mail
        from apps.billing.emails import send_invoice_issued_email

        mock_session = MagicMock()
        mock_session.id = 'cs_test_pay_link'
        mock_session.url = 'https://checkout.stripe.com/pay/cs_test_pay_link'
        mock_stripe.checkout.Session.create.return_value = mock_session

        inv = self._open_invoice()
        mail.outbox = []
        send_invoice_issued_email(inv)

        self.assertEqual(len(mail.outbox), 1)
        msg = mail.outbox[0]
        self.assertEqual(msg.to, [self.member.email])
        self.assertIn('https://checkout.stripe.com/pay/cs_test_pay_link', msg.body)
        inv.refresh_from_db()
        self.assertEqual(inv.stripe_checkout_session_id, 'cs_test_pay_link')

    def test_issued_email_falls_back_when_marina_not_connected(self):
        from django.core import mail
        from apps.billing.emails import send_invoice_issued_email

        self.marina.stripe_account_id = ''
        self.marina.save(update_fields=['stripe_account_id'])

        inv = self._open_invoice()
        mail.outbox = []
        send_invoice_issued_email(inv)

        self.assertEqual(len(mail.outbox), 1)
        body = mail.outbox[0].body
        self.assertNotIn('checkout.stripe.com', body)
        self.assertIn('view and pay the invoice from your account', body)


class StripeWebhookViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)
        self.client = APIClient()
        self.berth = make_berth(self.marina)

    def _open_invoice(self, source_type='berth_booking', source_id='30', session_id='cs_test_xyz'):
        inv = billing_service.create_invoice(
            self.marina, member=self.member,
            source_type=source_type, source_id=source_id,
        )
        billing_service.add_line_item(inv, 'Berth', Decimal('1'), Decimal('200.00'))
        billing_service.finalize_invoice(inv)
        inv.stripe_checkout_session_id = session_id
        inv.save(update_fields=['stripe_checkout_session_id'])
        return inv

    @patch('apps.billing.stripe_service.stripe')
    @patch('apps.billing.views.threading')
    def test_completed_marks_invoice_paid_and_starts_pdf_thread(self, mock_threading, mock_stripe):
        mock_threading.Thread.return_value = MagicMock()
        inv = self._open_invoice()
        mock_stripe.Webhook.construct_event.return_value = {
            'type': 'checkout.session.completed',
            'data': {'object': {
                'id': 'cs_test_xyz',
                'payment_intent': 'pi_test_123',
                'metadata': {'invoice_id': str(inv.id)},
            }}
        }
        resp = self.client.post(
            '/api/v1/billing/stripe/webhook/',
            data=b'{}', content_type='application/json',
            HTTP_STRIPE_SIGNATURE='t=1,v1=fakesig',
        )
        self.assertEqual(resp.status_code, 200)
        inv.refresh_from_db()
        self.assertEqual(inv.status, 'paid')
        self.assertEqual(inv.stripe_payment_intent_id, 'pi_test_123')
        self.assertIsNotNone(inv.paid_at)
        mock_threading.Thread.assert_called_once()

    @patch('apps.billing.stripe_service.stripe')
    def test_expired_clears_checkout_session_id(self, mock_stripe):
        inv = self._open_invoice()
        mock_stripe.Webhook.construct_event.return_value = {
            'type': 'checkout.session.expired',
            'data': {'object': {
                'id': 'cs_test_xyz',
                'metadata': {'invoice_id': str(inv.id)},
            }}
        }
        resp = self.client.post(
            '/api/v1/billing/stripe/webhook/',
            data=b'{}', content_type='application/json',
            HTTP_STRIPE_SIGNATURE='t=1,v1=fakesig',
        )
        self.assertEqual(resp.status_code, 200)
        inv.refresh_from_db()
        self.assertEqual(inv.stripe_checkout_session_id, '')
        self.assertEqual(inv.status, 'open')

    @patch('apps.billing.stripe_service.stripe')
    def test_invalid_signature_returns_400(self, mock_stripe):
        class FakeSignatureError(Exception):
            pass
        mock_stripe.error.SignatureVerificationError = FakeSignatureError
        mock_stripe.Webhook.construct_event.side_effect = FakeSignatureError('bad sig')
        resp = self.client.post(
            '/api/v1/billing/stripe/webhook/',
            data=b'{}', content_type='application/json',
            HTTP_STRIPE_SIGNATURE='bad',
        )
        self.assertEqual(resp.status_code, 400)


class BillingAPITest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)
        self.user = make_user(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_invoice_list_returns_marina_invoices_only(self):
        billing_service.create_invoice(self.marina, source_type='berth_booking', source_id='40')
        other_marina = Marina.objects.create(name='Other Marina')
        billing_service.create_invoice(other_marina, source_type='berth_booking', source_id='41')
        resp = self.client.get('/api/v1/billing/invoices/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 1)

    def test_mark_paid_cash_sets_paid_status(self):
        inv = billing_service.create_invoice(self.marina, source_type='restaurant_order', source_id='50')
        billing_service.add_line_item(inv, 'Burger', Decimal('1'), Decimal('16.00'))
        billing_service.finalize_invoice(inv)
        resp = self.client.patch(
            f'/api/v1/billing/invoices/{inv.id}/mark-paid/',
            {'method': 'cash'}, format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['status'], 'paid')

    def test_mark_paid_invalid_method_returns_400(self):
        inv = billing_service.create_invoice(self.marina, source_type='restaurant_order', source_id='51')
        billing_service.add_line_item(inv, 'Coffee', Decimal('1'), Decimal('4.00'))
        billing_service.finalize_invoice(inv)
        resp = self.client.patch(
            f'/api/v1/billing/invoices/{inv.id}/mark-paid/',
            {'method': 'bitcoin'}, format='json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_from_order_creates_invoice_with_line_items(self):
        from apps.restaurant.models import RestTable, MenuItem, Order, OrderItem
        table = RestTable.objects.create(marina=self.marina, number=1, capacity=4)
        menu_item = MenuItem.objects.create(
            marina=self.marina, section='mains', name='Cheeseburger',
            price=Decimal('16.00'), prep_time=15,
        )
        order = Order.objects.create(marina=self.marina, table=table, covers=2)
        OrderItem.objects.create(order=order, menu_item=menu_item, quantity=2)

        resp = self.client.post(
            '/api/v1/billing/invoices/from-order/',
            {'order_id': order.id}, format='json',
        )
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data['source_type'], 'restaurant_order')
        self.assertEqual(data['status'], 'open')
        self.assertEqual(len(data['items']), 1)
        self.assertEqual(Decimal(data['subtotal']), Decimal('32.00'))


class PDFServiceTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)

    @patch('apps.billing.pdf_service.HTML')
    @patch('apps.billing.pdf_service.default_storage')
    @patch('apps.billing.pdf_service.EmailMessage')
    def test_generate_stores_pdf_and_emails_member(self, mock_email_cls, mock_storage, mock_html):
        mock_html.return_value.write_pdf.return_value = b'%PDF-1.4 fake'
        mock_storage.save.return_value = 'invoices/1/INV-2026-0001.pdf'

        inv = billing_service.create_invoice(
            self.marina, member=self.member,
            source_type='berth_booking', source_id='70',
        )
        billing_service.add_line_item(inv, 'Berth', Decimal('1'), Decimal('200.00'))
        billing_service.finalize_invoice(inv)
        inv.status = 'paid'
        inv.save(update_fields=['status'])

        from apps.billing.pdf_service import _generate_store_and_email_pdf
        _generate_store_and_email_pdf(inv.id)

        inv.refresh_from_db()
        self.assertTrue(bool(inv.pdf_document))
        mock_email_cls.assert_called_once()
        mock_email_cls.return_value.send.assert_called_once()

    @patch('apps.billing.pdf_service.HTML')
    @patch('apps.billing.pdf_service.default_storage')
    @patch('apps.billing.pdf_service.EmailMessage')
    def test_no_email_when_no_member(self, mock_email_cls, mock_storage, mock_html):
        mock_html.return_value.write_pdf.return_value = b'%PDF-1.4 fake'
        mock_storage.save.return_value = 'invoices/1/INV-2026-0002.pdf'

        inv = billing_service.create_invoice(
            self.marina, member=None,
            source_type='restaurant_order', source_id='71',
        )
        billing_service.add_line_item(inv, 'Coffee', Decimal('1'), Decimal('4.00'))
        billing_service.finalize_invoice(inv)
        inv.status = 'paid'
        inv.save(update_fields=['status'])

        from apps.billing.pdf_service import _generate_store_and_email_pdf
        _generate_store_and_email_pdf(inv.id)

        mock_email_cls.assert_not_called()


# ── ChargeableItem berth assignment ───────────────────────────────────────────

class ChargeableItemBerthAssignmentTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        pier = Pier.objects.create(marina=self.marina, code='A', label='Pier A')
        self.tier_a = make_item(self.marina, name='Standard Rate', unit_price='50.00')
        self.tier_b = make_item(self.marina, name='Premium Rate', unit_price='80.00')
        self.berth1 = Berth.objects.create(marina=self.marina, pier=pier, code='A1', pricing_tier=self.tier_a)
        self.berth2 = Berth.objects.create(marina=self.marina, pier=pier, code='A2', pricing_tier=self.tier_a)
        self.berth3 = Berth.objects.create(marina=self.marina, pier=pier, code='A3', pricing_tier=self.tier_b)

    def test_get_item_includes_assigned_berths(self):
        resp = self.client.get(f'/api/v1/billing/service-catalog/{self.tier_a.id}/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('assigned_berths', data)
        assigned_ids = [b['id'] for b in data['assigned_berths']]
        self.assertIn(self.berth1.id, assigned_ids)
        self.assertIn(self.berth2.id, assigned_ids)
        self.assertNotIn(self.berth3.id, assigned_ids)

    def test_assigned_berths_includes_code(self):
        resp = self.client.get(f'/api/v1/billing/service-catalog/{self.tier_a.id}/')
        berth = resp.json()['assigned_berths'][0]
        self.assertIn('code', berth)

    def test_patch_berth_ids_assigns_berths_to_tier(self):
        resp = self.client.patch(
            f'/api/v1/billing/service-catalog/{self.tier_b.id}/',
            {'berth_ids': [self.berth1.id, self.berth3.id]},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.berth1.refresh_from_db()
        self.berth3.refresh_from_db()
        self.assertEqual(self.berth1.pricing_tier_id, self.tier_b.id)
        self.assertEqual(self.berth3.pricing_tier_id, self.tier_b.id)

    def test_patch_berth_ids_does_not_unassign_excluded_berths(self):
        # berth2 is on tier_a; patching tier_a with only berth1 should leave berth2 unchanged
        self.client.patch(
            f'/api/v1/billing/service-catalog/{self.tier_a.id}/',
            {'berth_ids': [self.berth1.id]},
            format='json',
        )
        self.berth2.refresh_from_db()
        self.assertEqual(self.berth2.pricing_tier_id, self.tier_a.id)

    def test_patch_berth_ids_restricted_to_own_marina(self):
        from apps.billing.service import seed_default_tax_rates
        other_marina = Marina.objects.create(name='Other Marina')
        seed_default_tax_rates(other_marina)
        other_pier = Pier.objects.create(marina=other_marina, code='B', label='Pier B')
        other_tier = make_item(other_marina, name='Other Rate', unit_price='60.00')
        other_berth = Berth.objects.create(
            marina=other_marina, pier=other_pier, code='B1', pricing_tier=other_tier
        )
        self.client.patch(
            f'/api/v1/billing/service-catalog/{self.tier_a.id}/',
            {'berth_ids': [other_berth.id]},
            format='json',
        )
        other_berth.refresh_from_db()
        self.assertNotEqual(other_berth.pricing_tier_id, self.tier_a.id)
