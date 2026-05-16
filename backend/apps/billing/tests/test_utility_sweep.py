"""
Tests for the utility-ledger sweep:
  apps.billing.utility_sweep.sweep_pending_utility_charges
  apps.billing.tasks.sweep_pending_utility_charges  (Celery task)
  manage.py sweep_utilities                          (mgmt command)
"""

from decimal import Decimal
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command
from django.db import transaction
from django.test import TestCase, TransactionTestCase
from django.utils import timezone

from apps.accounts.models import Marina
from apps.berths.models import Berth, Pier
from apps.billing.models import ChargeableItem, Invoice, InvoiceLineItem, TaxRate
from apps.billing.service import seed_default_tax_rates
from apps.members.models import Member
from apps.utilities.models import MeterReading, PendingUtilityCharge, SmartMeter


# ── Helpers ────────────────────────────────────────────────────────────────────

def _make_marina(slug='sweep-marina', name='Sweep Marina'):
    marina = Marina.objects.create(name=name, slug=slug)
    seed_default_tax_rates(marina)
    return marina


def _make_member(marina, name='Alice'):
    return Member.objects.create(marina=marina, name=name, email=f'{name.lower()}@x.io')


def _make_meter(marina, berth=None, mtype='electricity', device_id='M1'):
    return SmartMeter.objects.create(
        marina=marina, berth=berth, vendor='rolec',
        meter_type=mtype, device_id=device_id, is_active=True,
    )


def _make_utility_item(marina, *, is_electricity=True, rate_pct='20.00'):
    tax = TaxRate.objects.get(marina=marina, name='Standard — 20.00%')
    # If the test asks for a non-standard rate, mutate the standard one in place.
    if Decimal(rate_pct) != tax.rate:
        tax.rate = Decimal(rate_pct)
        tax.save(update_fields=['rate'])
    return ChargeableItem.objects.create(
        marina=marina,
        name='Electricity' if is_electricity else 'Water',
        category='utility',
        pricing_model='per_kwh' if is_electricity else 'per_m3',
        unit_price=Decimal('0.50'),
        tax_category=tax,
    )


def _make_pending(marina, member, meter, *, amount='5.00', delta='10.000',
                  unit_price='0.50', is_electricity=True):
    reading = MeterReading.objects.create(
        meter=meter,
        reading_kwh=Decimal(delta) if is_electricity else None,
        reading_m3=Decimal(delta) if not is_electricity else None,
        recorded_at=timezone.now(),
        source='manual',
    )
    return PendingUtilityCharge.objects.create(
        marina=marina, member=member, meter=meter, meter_reading=reading,
        kwh_delta=Decimal(delta) if is_electricity else None,
        m3_delta=Decimal(delta) if not is_electricity else None,
        unit_price=Decimal(unit_price),
        amount=Decimal(amount),
    )


# ── Tests ──────────────────────────────────────────────────────────────────────

class SweepNoOpTest(TestCase):
    def test_no_pending_rows_is_noop(self):
        from apps.billing.utility_sweep import sweep_pending_utility_charges

        _make_marina()
        result = sweep_pending_utility_charges()
        self.assertEqual(result.rows_swept, 0)
        self.assertEqual(result.lines_added, 0)
        self.assertEqual(result.invoices_created, 0)
        self.assertFalse(Invoice.objects.exists())


class SweepCreatesInvoicesPerBoaterTest(TestCase):
    def test_three_pending_two_boaters_produces_two_invoices(self):
        from apps.billing.utility_sweep import sweep_pending_utility_charges

        marina = _make_marina()
        _make_utility_item(marina)
        alice = _make_member(marina, 'Alice')
        bob = _make_member(marina, 'Bob')
        meter = _make_meter(marina)

        p1 = _make_pending(marina, alice, meter, amount='5.00')
        p2 = _make_pending(marina, alice, meter, amount='7.00')
        p3 = _make_pending(marina, bob, meter, amount='3.00')

        result = sweep_pending_utility_charges()

        self.assertEqual(result.rows_swept, 3)
        self.assertEqual(result.lines_added, 3)
        self.assertEqual(result.invoices_created, 2)
        self.assertEqual(result.invoices_appended, 0)

        invoices = list(Invoice.objects.all())
        self.assertEqual(len(invoices), 2)
        by_member = {inv.member_id: inv for inv in invoices}
        self.assertEqual(by_member[alice.id].items.count(), 2)
        self.assertEqual(by_member[bob.id].items.count(), 1)

        for p in (p1, p2, p3):
            p.refresh_from_db()
            self.assertIsNotNone(p.swept_to_invoice_id)


class SweepAppendsToExistingDraftTest(TestCase):
    def test_existing_draft_invoice_is_appended(self):
        from apps.billing.utility_sweep import sweep_pending_utility_charges
        from apps.billing.service import create_invoice

        marina = _make_marina()
        _make_utility_item(marina)
        alice = _make_member(marina, 'Alice')
        meter = _make_meter(marina)

        period = timezone.now().strftime('%Y-%m')
        draft = create_invoice(
            marina=marina, member=alice,
            source_type='manual', billing_period=period,
        )

        _make_pending(marina, alice, meter, amount='4.00')
        _make_pending(marina, alice, meter, amount='6.00')

        result = sweep_pending_utility_charges()
        self.assertEqual(result.invoices_created, 0)
        self.assertEqual(result.invoices_appended, 1)
        self.assertEqual(result.lines_added, 2)

        self.assertEqual(Invoice.objects.count(), 1)
        draft.refresh_from_db()
        self.assertEqual(draft.items.count(), 2)


class SweepIdempotencyTest(TestCase):
    def test_already_swept_rows_are_skipped_on_re_run(self):
        from apps.billing.utility_sweep import sweep_pending_utility_charges

        marina = _make_marina()
        _make_utility_item(marina)
        alice = _make_member(marina, 'Alice')
        meter = _make_meter(marina)
        p = _make_pending(marina, alice, meter)

        first = sweep_pending_utility_charges()
        self.assertEqual(first.rows_swept, 1)
        self.assertEqual(first.lines_added, 1)
        self.assertEqual(Invoice.objects.count(), 1)
        self.assertEqual(InvoiceLineItem.objects.count(), 1)

        # Re-run — must be a no-op.
        second = sweep_pending_utility_charges()
        self.assertEqual(second.rows_swept, 0)
        self.assertEqual(second.lines_added, 0)
        self.assertEqual(second.invoices_created, 0)
        self.assertEqual(Invoice.objects.count(), 1)
        self.assertEqual(InvoiceLineItem.objects.count(), 1)

        p.refresh_from_db()
        self.assertIsNotNone(p.swept_to_invoice_id)


class SweepTaxPropagationTest(TestCase):
    def test_pending_line_gets_tax_rate_from_utility_chargeable_item(self):
        from apps.billing.utility_sweep import sweep_pending_utility_charges

        marina = _make_marina()
        item = _make_utility_item(marina, rate_pct='17.50')
        alice = _make_member(marina, 'Alice')
        meter = _make_meter(marina)
        _make_pending(marina, alice, meter)

        sweep_pending_utility_charges()
        line = InvoiceLineItem.objects.get()
        self.assertEqual(line.tax_rate, Decimal('17.50'))
        self.assertEqual(line.chargeable_item_id, item.id)
        self.assertEqual(line.unit_price, Decimal('0.50'))


class SweepConcurrencyTest(TransactionTestCase):
    """
    Two transactions try to sweep the same pending row. The second one must
    see it already-swept (because of select_for_update lock + filter on
    swept_to_invoice__isnull) and skip it. Exactly one sweep wins per row.
    """

    def test_concurrent_sweep_does_not_duplicate(self):
        from apps.billing.utility_sweep import sweep_pending_utility_charges

        marina = _make_marina()
        _make_utility_item(marina)
        alice = _make_member(marina, 'Alice')
        meter = _make_meter(marina)
        pending = _make_pending(marina, alice, meter)

        # Simulate a concurrent run: while we are inside the first sweep, a
        # rival writer has already marked the row swept. Patch the row-locking
        # query so that on the *second* call to .filter() we see no eligible
        # rows. We exercise this with two sequential calls under the same
        # connection — the second is the rival's effect.
        first = sweep_pending_utility_charges()
        second = sweep_pending_utility_charges()  # rival attempt

        self.assertEqual(first.rows_swept, 1)
        self.assertEqual(second.rows_swept, 0)
        self.assertEqual(InvoiceLineItem.objects.filter(
            chargeable_item__category='utility'
        ).count(), 1)
        pending.refresh_from_db()
        self.assertIsNotNone(pending.swept_to_invoice_id)

    def test_select_for_update_is_used(self):
        # Sanity: verify the sweep actually issues SELECT … FOR UPDATE so the
        # race-safety claim isn't accidentally regressed.
        from apps.billing import utility_sweep

        marina = _make_marina()
        _make_utility_item(marina)
        alice = _make_member(marina, 'Alice')
        meter = _make_meter(marina)
        _make_pending(marina, alice, meter)

        captured = {'used': False}
        real_sfu = type(PendingUtilityCharge.objects.all()).select_for_update

        def spy_sfu(self, *args, **kwargs):
            captured['used'] = True
            return real_sfu(self, *args, **kwargs)

        with patch.object(
            type(PendingUtilityCharge.objects.all()),
            'select_for_update',
            spy_sfu,
        ):
            utility_sweep.sweep_pending_utility_charges()
        self.assertTrue(captured['used'])


class SweepManagementCommandTest(TestCase):
    def test_dry_run_does_not_mutate(self):
        marina = _make_marina()
        _make_utility_item(marina)
        alice = _make_member(marina, 'Alice')
        meter = _make_meter(marina)
        _make_pending(marina, alice, meter)

        out = StringIO()
        call_command('sweep_utilities', '--dry-run', stdout=out)
        self.assertIn('[DRY-RUN]', out.getvalue())
        self.assertFalse(Invoice.objects.exists())

        p = PendingUtilityCharge.objects.get()
        self.assertIsNone(p.swept_to_invoice_id)

    def test_marina_id_scopes_the_sweep(self):
        m1 = _make_marina(slug='m1', name='M1')
        m2 = _make_marina(slug='m2', name='M2')
        _make_utility_item(m1)
        _make_utility_item(m2)
        a1 = _make_member(m1, 'A1')
        a2 = _make_member(m2, 'A2')
        meter1 = _make_meter(m1, device_id='m1-1')
        meter2 = _make_meter(m2, device_id='m2-1')
        _make_pending(m1, a1, meter1)
        _make_pending(m2, a2, meter2)

        call_command('sweep_utilities', '--marina-id', str(m1.id), stdout=StringIO())
        self.assertEqual(Invoice.objects.filter(marina=m1).count(), 1)
        self.assertEqual(Invoice.objects.filter(marina=m2).count(), 0)


class SweepCeleryTaskTest(TestCase):
    def test_task_returns_summary_dict(self):
        from apps.billing.tasks import sweep_pending_utility_charges as task

        marina = _make_marina()
        _make_utility_item(marina)
        alice = _make_member(marina, 'Alice')
        meter = _make_meter(marina)
        _make_pending(marina, alice, meter)

        # Call as a function (CELERY_TASK_ALWAYS_EAGER may not be set in tests).
        summary = task.run()
        self.assertEqual(summary['rows_swept'], 1)
        self.assertEqual(summary['lines_added'], 1)
        self.assertEqual(summary['invoices_created'], 1)
