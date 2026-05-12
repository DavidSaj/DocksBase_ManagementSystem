import datetime
from django.test import TestCase
from apps.accounts.models import Marina
from apps.billing.models import Invoice, ChargeableItem
from apps.reservations.models import Booking


def _marina():
    return Marina.objects.create(name='Test Marina')


class InvoiceBookingFKTest(TestCase):
    def test_invoice_booking_fk_is_nullable(self):
        marina = _marina()
        inv = Invoice.objects.create(marina=marina, invoice_number='INV-2026-0001')
        self.assertIsNone(inv.booking)

    def test_invoice_booking_fk_can_be_set(self):
        marina = _marina()
        booking = Booking.objects.create(
            marina=marina,
            check_in=datetime.date(2026, 7, 15),
            check_out=datetime.date(2026, 7, 22),
            status='awaiting_payment',
            booking_type='transient',
        )
        inv = Invoice.objects.create(marina=marina, invoice_number='INV-2026-0001', booking=booking)
        inv.refresh_from_db()
        self.assertEqual(inv.booking_id, booking.id)

    def test_invoice_booking_set_null_on_booking_delete(self):
        marina = _marina()
        booking = Booking.objects.create(
            marina=marina,
            check_in=datetime.date(2026, 7, 15),
            check_out=datetime.date(2026, 7, 22),
            status='awaiting_payment',
            booking_type='transient',
        )
        inv = Invoice.objects.create(marina=marina, invoice_number='INV-2026-0001', booking=booking)
        booking.delete()
        inv.refresh_from_db()
        self.assertIsNone(inv.booking)

    def test_booking_fee_category_choice_exists(self):
        from apps.billing.service import seed_default_tax_rates
        from apps.billing.models import TaxRate
        marina = _marina()
        seed_default_tax_rates(marina)
        tax_cat = TaxRate.objects.get(marina=marina, name='Standard — 20.00%')
        item = ChargeableItem.objects.create(
            marina=marina,
            name='Harbour Dues',
            category='booking_fee',
            pricing_model='flat_fee',
            unit_price='25.00',
            tax_category=tax_cat,
        )
        self.assertEqual(item.category, 'booking_fee')
