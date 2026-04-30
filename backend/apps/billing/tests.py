import datetime
from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import Marina, User
from apps.members.models import Member


# ── Helpers ────────────────────────────────────────────────────────────────────

def make_marina(vat_rate='8.10', stripe_account_id='acct_test123'):
    return Marina.objects.create(
        name='Test Marina',
        vat_rate=Decimal(vat_rate),
        stripe_account_id=stripe_account_id,
    )


def make_user(marina, email='staff@test.com'):
    return User.objects.create_user(
        email=email, password='pass', marina=marina, role='manager'
    )


def make_member(marina, email='hans@boat.ch'):
    return Member.objects.create(marina=marina, name='Hans Müller', email=email)


# ── Tests ──────────────────────────────────────────────────────────────────────

class MarinaFieldsTest(TestCase):
    def test_vat_rate_and_stripe_account_id_exist(self):
        marina = Marina.objects.create(
            name='Marina A', vat_rate=Decimal('7.70'), stripe_account_id='acct_abc'
        )
        marina.refresh_from_db()
        self.assertEqual(marina.vat_rate, Decimal('7.70'))
        self.assertEqual(marina.stripe_account_id, 'acct_abc')

    def test_vat_rate_defaults_to_zero(self):
        marina = Marina.objects.create(name='Marina B')
        self.assertEqual(marina.vat_rate, Decimal('0.00'))

    def test_stripe_account_id_defaults_blank(self):
        marina = Marina.objects.create(name='Marina C')
        self.assertEqual(marina.stripe_account_id, '')


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
            vat_rate=Decimal('8.10'),
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
            status='draft', vat_rate=Decimal('8.10'),
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
            status='open', vat_rate=Decimal('0.00'),
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

    def test_create_invoice_snapshots_vat_rate_and_member(self):
        inv = billing_service.create_invoice(
            self.marina, member=self.member,
            source_type='berth_booking', source_id='10',
        )
        self.assertEqual(inv.vat_rate, self.marina.vat_rate)
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
        billing_service.add_line_item(inv, 'Berth', Decimal('1'), Decimal('100.00'))
        billing_service.add_line_item(inv, 'Electricity', Decimal('1'), Decimal('20.00'))
        billing_service.finalize_invoice(inv)
        inv.refresh_from_db()
        self.assertEqual(inv.subtotal, Decimal('120.00'))
        # vat_rate is 8.10 (from make_marina)
        expected_tax = (Decimal('120.00') * Decimal('8.10') / 100).quantize(Decimal('0.01'))
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


from apps.berths.models import Pier, Berth
from apps.reservations.models import Booking


def make_berth(marina, price=Decimal('50.00')):
    pier = Pier.objects.create(marina=marina, code='A', label='Pier A')
    return Berth.objects.create(
        marina=marina, pier=pier, code='A1',
        price_per_night=price, status='available',
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
