"""
Tests for the accounting & tax export pipeline + Stripe payout webhook.

Spec: docs/superpowers/specs/2026-05-15-accounting-tax-export-design.md
"""

from __future__ import annotations

import csv
import datetime
import io
import json
from decimal import Decimal
from unittest.mock import patch, MagicMock

from django.test import TestCase
from django.urls import reverse, NoReverseMatch
from rest_framework.test import APIClient

from apps.accounting.exports import generic, qbo, xero, tax_summary, get_generator
from apps.accounting.models import ExportJob, GLCodeMapping, Payout, PayoutLine, TaxCode
from apps.accounts.models import Marina, User
from apps.billing.models import Invoice, InvoiceLineItem, TaxRate, ChargeableItem
from apps.members.models import Member
from apps.reservations.models import Booking
from apps.berths.models import Pier, Berth

from . import _fixtures as fx


# ---------------------------------------------------------------------------
# 1. Generic CSV golden test.
# ---------------------------------------------------------------------------

class GenericCSVGoldenTest(TestCase):
    def setUp(self):
        self.ctx = fx.build_fixture()

    def test_export_generic_csv_golden(self):
        marina = self.ctx['marina']
        job = ExportJob.objects.create(
            marina=marina, format=ExportJob.Format.GENERIC_CSV,
            start_date=datetime.date(2026, 4, 1),
            end_date=datetime.date(2026, 4, 30),
        )
        generic.generate(job)
        job.refresh_from_db()
        self.assertEqual(job.status, ExportJob.Status.COMPLETED)
        self.assertTrue(bool(job.file))
        self.assertEqual(job.row_count, 6)  # 5 invoices + 1 credit-note line

        with job.file.open('rb') as fh:
            content = fh.read().decode('utf-8')

        rows = list(csv.reader(io.StringIO(content)))
        self.assertEqual(rows[0], [
            'date', 'invoice_number', 'customer', 'category', 'gl_code',
            'subtotal', 'tax', 'total', 'payment_method', 'payout_id',
        ])

        # Build the *exact* expected rows.
        expected = [
            # date, inv-number, customer, category, gl_code, subtotal, tax, total, payment_method, payout_id
            ['2026-04-01', 'INV-2026-0001', 'Alice Skipper', 'berth',       '4100', '300.00', '24.00',  '324.00', 'stripe', ''],
            ['2026-04-02', 'INV-2026-0002', 'Alice Skipper', 'utility',     '4200', '25.00',  '5.00',   '30.00',  'stripe', ''],
            ['2026-04-03', 'INV-2026-0003', 'Alice Skipper', 'retail',      '4300', '10.00',  '2.00',   '12.00',  'stripe', ''],
            ['2026-04-04', 'INV-2026-0004', 'Alice Skipper', 'service',     '4400', '30.00',  '6.00',   '36.00',  'stripe', ''],
            ['2026-04-05', 'INV-2026-0005', 'Alice Skipper', 'booking_fee', '4500', '10.00',  '0.00',   '10.00',  'stripe', ''],
            ['2026-04-06', 'CN-2026-0001',  'Alice Skipper', 'retail',      '4300', '10.00',  '2.00',   '12.00',  '',       ''],
        ]
        self.assertEqual(rows[1:], expected)

    def test_qbo_export_format_columns(self):
        marina = self.ctx['marina']
        job = ExportJob.objects.create(
            marina=marina, format=ExportJob.Format.QBO_CSV,
            start_date=datetime.date(2026, 4, 1),
            end_date=datetime.date(2026, 4, 30),
        )
        qbo.generate(job)
        job.refresh_from_db()
        self.assertEqual(job.status, ExportJob.Status.COMPLETED)
        with job.file.open('rb') as fh:
            content = fh.read().decode('utf-8')
        header = next(csv.reader(io.StringIO(content)))
        self.assertEqual(header, [
            'InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Terms',
            'Location', 'Memo',
            'Item(Product/Service)', 'ItemDescription', 'ItemQuantity',
            'ItemRate', 'ItemAmount', 'ItemTaxCode', 'ItemTaxAmount',
            'Currency',
        ])
        # Tax code should resolve via TaxCode.external_qbo_code.
        body_rows = list(csv.reader(io.StringIO(content)))[1:]
        codes = [r[12] for r in body_rows]
        self.assertIn('VAT20', codes)
        self.assertIn('TRANSIENT8', codes)


# ---------------------------------------------------------------------------
# 2. Sync vs. async boundary: 31 days sync, 32 days async.
# ---------------------------------------------------------------------------

class _AuthClientMixin:
    def _make_user_client(self, marina):
        user = User.objects.create_user(
            email=f'staff-{marina.pk}@example.com',
            password='pw', role='owner', marina=marina,
        )
        client = APIClient()
        client.force_authenticate(user)
        return client


class SyncAsyncBoundaryTest(TestCase, _AuthClientMixin):
    def setUp(self):
        ctx = fx.build_fixture()
        self.marina = ctx['marina']
        self.client = self._make_user_client(self.marina)

    def _post(self, start, end):
        return self.client.post(
            '/api/v1/accounting/exports/',
            data={'format': 'generic_csv',
                  'start_date': start.isoformat(),
                  'end_date': end.isoformat(),
                  'category_filter': []},
            format='json',
        )

    def test_export_sync_for_31d_async_for_32d(self):
        start = datetime.date(2026, 4, 1)

        # 31-day span (inclusive of both endpoints) — must run synchronously.
        resp = self._post(start, start + datetime.timedelta(days=31))
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.data['status'], 'completed')
        self.assertIsNotNone(resp.data['file_url'])

        # 32-day span — must stay queued.
        resp = self._post(start, start + datetime.timedelta(days=32))
        self.assertEqual(resp.status_code, 201, resp.content)
        self.assertEqual(resp.data['status'], 'queued')
        self.assertIsNone(resp.data['file_url'])

    def test_no_multi_period_preset(self):
        """Locked decision #3: no rolling-12mo / YTD presets in v1."""
        for preset in ('rolling_12_months', 'ytd', 'last_12_months'):
            resp = self.client.post(
                '/api/v1/accounting/exports/',
                data={'format': 'generic_csv', 'preset': preset},
                format='json',
            )
            self.assertIn(resp.status_code, (400, 415))  # missing required fields


# ---------------------------------------------------------------------------
# 3. Payout webhook: paid event creates Payout + linked invoices.
# ---------------------------------------------------------------------------

class PayoutWebhookTest(TestCase):
    def setUp(self):
        ctx = fx.build_fixture()
        self.marina = ctx['marina']
        self.client = APIClient()

    def _stripe_event_for_payout(self):
        return {
            'type': 'payout.paid',
            'account': self.marina.stripe_account_id,
            'data': {
                'object': {
                    'id': 'po_test_1',
                    'amount': 33000,      # 330.00 in cents
                    'currency': 'eur',
                    'status': 'paid',
                    'arrival_date': int(
                        datetime.datetime(2026, 4, 10, tzinfo=datetime.timezone.utc).timestamp()
                    ),
                    'created': int(
                        datetime.datetime(2026, 4, 9, tzinfo=datetime.timezone.utc).timestamp()
                    ),
                    'destination': self.marina.stripe_account_id,
                },
            },
        }

    def _make_balance_txns(self):
        # Two charge transactions matching the first two invoices in fixture.
        def make_txn(txn_id, txn_type, amount, pi_id, charge_id):
            txn = MagicMock()
            txn.id = txn_id
            txn.type = txn_type
            txn.amount = amount
            txn.fee = 100
            txn.net = amount - 100
            txn.currency = 'eur'
            txn.description = ''
            txn.created = int(
                datetime.datetime(2026, 4, 9, tzinfo=datetime.timezone.utc).timestamp()
            )
            src = MagicMock()
            src.id = charge_id
            src.payment_intent = pi_id
            txn.source = src
            txn.get = lambda key, default=None: getattr(txn, key, default)
            return txn
        return [
            make_txn('txn_1', 'charge', 32400, 'pi_test_0', 'ch_1'),  # 324.00 berth
            make_txn('txn_2', 'charge', 3000,  'pi_test_1', 'ch_2'),  # 30.00 utility
        ]

    def test_payout_webhook_upserts_and_links_charges(self):
        event = self._stripe_event_for_payout()
        fake_iter = MagicMock()
        fake_iter.auto_paging_iter.return_value = iter(self._make_balance_txns())

        with patch('apps.billing.views._stripe_svc') as mock_svc:
            mock_svc.stripe.Webhook.construct_event.return_value = event
            mock_svc.stripe.BalanceTransaction.list.return_value = fake_iter
            resp = self.client.post(
                '/api/v1/billing/stripe/connect-webhook/',
                data=json.dumps(event),
                content_type='application/json',
                HTTP_STRIPE_SIGNATURE='test-sig',
            )

        self.assertEqual(resp.status_code, 200, resp.content)
        po = Payout.objects.get(marina=self.marina, stripe_payout_id='po_test_1')
        self.assertEqual(po.status, 'paid')
        self.assertEqual(po.amount, Decimal('330.00'))
        self.assertEqual(po.lines.count(), 2)
        linked_invoices = [pl.invoice_id for pl in po.lines.all() if pl.invoice_id]
        self.assertEqual(len(linked_invoices), 2)

        # Replay must be idempotent (same Payout, lines rebuilt).
        fake_iter2 = MagicMock()
        fake_iter2.auto_paging_iter.return_value = iter(self._make_balance_txns())
        with patch('apps.billing.views._stripe_svc') as mock_svc:
            mock_svc.stripe.Webhook.construct_event.return_value = event
            mock_svc.stripe.BalanceTransaction.list.return_value = fake_iter2
            self.client.post(
                '/api/v1/billing/stripe/connect-webhook/',
                data=json.dumps(event),
                content_type='application/json',
                HTTP_STRIPE_SIGNATURE='test-sig',
            )
        self.assertEqual(Payout.objects.filter(stripe_payout_id='po_test_1').count(), 1)
        self.assertEqual(po.lines.count(), 2)


# ---------------------------------------------------------------------------
# 4. Tax-exempt precedence in line-item creation.
# ---------------------------------------------------------------------------

class TaxExemptPrecedenceTest(TestCase):
    def setUp(self):
        self.marina = fx.make_marina(name='Precedence Marina')
        self.taxes = fx.seed_basic_taxes(self.marina)
        self.items = fx.seed_chargeable_items(self.marina, self.taxes)

        # Member is tax-exempt — Booking override must still take priority.
        self.member = Member.objects.create(
            marina=self.marina, name='Exempt Member', tax_exempt=True,
        )

        pier = Pier.objects.create(marina=self.marina, code='A', label='Pier A')
        berth = Berth.objects.create(
            marina=self.marina, pier=pier, code='A1', pricing_tier=self.items['berth'],
        )
        self.booking = Booking.objects.create(
            marina=self.marina, berth=berth,
            check_in=datetime.date(2026, 4, 10),
            check_out=datetime.date(2026, 4, 12),
            status='confirmed', booking_type='transient',
            tax_exempt_override=True,
        )

    def test_tax_exempt_override_takes_precedence(self):
        from apps.billing import service as billing_service
        # Item carries 20% standard tax; member is exempt; booking override = True.
        item = self.items['utility']  # tax_category=standard 20%
        invoice = billing_service.create_invoice(
            marina=self.marina, member=self.member, source_type='booking',
            source_id=str(self.booking.pk),
        )
        invoice.booking = self.booking
        invoice.save(update_fields=['booking'])

        line = billing_service.add_line_item(
            invoice=invoice,
            description='Shore Power',
            quantity=Decimal('1'),
            unit_price=Decimal('25.00'),
            tax_rate=Decimal('20.00'),  # caller-supplied, should be overridden.
            chargeable_item=item,
        )
        self.assertEqual(line.tax_rate, Decimal('0.00'))

        # Sanity: with override off and member.tax_exempt=False, the rate flows through.
        self.booking.tax_exempt_override = False
        self.booking.save(update_fields=['tax_exempt_override'])
        self.member.tax_exempt = False
        self.member.save(update_fields=['tax_exempt'])

        invoice2 = billing_service.create_invoice(
            marina=self.marina, member=self.member, source_type='booking',
            source_id=str(self.booking.pk),
        )
        invoice2.booking = self.booking
        invoice2.save(update_fields=['booking'])
        line2 = billing_service.add_line_item(
            invoice=invoice2,
            description='Shore Power',
            quantity=Decimal('1'),
            unit_price=Decimal('25.00'),
            tax_rate=Decimal('20.00'),
            chargeable_item=item,
        )
        self.assertEqual(line2.tax_rate, Decimal('20.00'))


# ---------------------------------------------------------------------------
# 5. Endpoint surface sanity — no multi-period preset (locked decision).
# ---------------------------------------------------------------------------

class NoMultiPeriodPresetTest(TestCase):
    """Spec locked decision #3: phase 1 has no rolling 12mo or YTD endpoint/param."""

    def test_no_multi_period_endpoints_registered(self):
        from django.urls import get_resolver
        resolver = get_resolver()
        all_patterns = []

        def walk(urlpatterns, prefix=''):
            for p in urlpatterns:
                if hasattr(p, 'url_patterns'):
                    walk(p.url_patterns, prefix + str(p.pattern))
                else:
                    all_patterns.append(prefix + str(p.pattern))

        walk(resolver.url_patterns)
        joined = '\n'.join(all_patterns).lower()
        for forbidden in ('rolling_12', 'rolling-12', 'ytd', 'year-to-date'):
            self.assertNotIn(forbidden, joined,
                             f'Found forbidden multi-period preset: {forbidden}')
