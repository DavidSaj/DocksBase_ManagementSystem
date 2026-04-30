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
