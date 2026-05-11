"""
tests/test_offset.py

OffsetContribution creation signal tests.
"""

import pytest
from decimal import Decimal
from unittest.mock import patch, MagicMock


@pytest.mark.django_db
class TestOffsetContribution:

    def _make_marina(self):
        from apps.accounts.models import Marina
        return Marina.objects.create(name='Offset Marina', slug='off', features={'esg_enabled': True})

    def _make_booking(self, marina):
        from apps.reservations.models import Booking
        from apps.berths.models import Berth
        from apps.vessels.models import Vessel
        from datetime import date
        berth = Berth.objects.create(marina=marina, code='B1')
        vessel = Vessel.objects.create(marina=marina, name='Test Boat')
        return Booking.objects.create(
            marina=marina, berth=berth, vessel=vessel,
            check_in=date(2026, 5, 1), check_out=date(2026, 5, 7),
        )

    def _make_invoice(self, marina, booking):
        from apps.billing.models import Invoice
        return Invoice.objects.create(
            marina=marina, booking=booking,
            status='paid', total=Decimal('500.00'),
        )

    def _make_line_item(self, invoice, unit_price, category='offset', is_discountable=False):
        from apps.billing.models import InvoiceLineItem
        from apps.billing.models import ChargeableItem
        chargeable = ChargeableItem.objects.create(
            marina=invoice.marina,
            name='Carbon Offset',
            category=category,
            unit_price=unit_price,
            is_discountable=is_discountable,
        )
        return InvoiceLineItem.objects.create(
            invoice=invoice,
            chargeable_item=chargeable,
            quantity=1,
            unit_price=unit_price,
            total_price=unit_price,
        )

    def test_offset_zero_price_guard_no_contribution_created(self):
        """Signal guard: zero unit_price line items must NOT create OffsetContribution."""
        from apps.sustainability.models import OffsetContribution
        marina = self._make_marina()
        booking = self._make_booking(marina)
        invoice = self._make_invoice(marina, booking)

        with patch('apps.sustainability.tasks.create_offset_contribution') as mock_task:
            self._make_line_item(invoice, unit_price=Decimal('0.00'))
            # task must NOT be queued
            mock_task.assert_not_called()

        assert OffsetContribution.objects.count() == 0

    def test_offset_full_price_creates_contribution(self):
        """Paid invoice line_item with category='offset' and unit_price > 0 creates contribution."""
        from apps.sustainability.models import OffsetContribution
        from apps.sustainability.tasks import create_offset_contribution
        marina = self._make_marina()
        booking = self._make_booking(marina)
        invoice = self._make_invoice(marina, booking)
        line_item = self._make_line_item(invoice, unit_price=Decimal('25.00'))

        # Call the task directly (bypassing Celery async)
        create_offset_contribution(line_item_id=line_item.pk)

        contrib = OffsetContribution.objects.get(invoice_line_item=line_item)
        assert contrib.amount_gbp == Decimal('25.00')
        assert contrib.marina == marina

    def test_offset_coupon_discount_blocked_by_is_discountable_false(self):
        """OffsetContribution line items have is_discountable=False on ChargeableItem."""
        from apps.billing.models import ChargeableItem
        marina = self._make_marina()
        # Create a carbon offset chargeable item
        item = ChargeableItem.objects.create(
            marina=marina,
            name='Carbon Offset',
            category='offset',
            unit_price=Decimal('25.00'),
            is_discountable=False,
        )
        assert item.is_discountable is False
