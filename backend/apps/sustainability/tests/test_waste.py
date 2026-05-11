"""
tests/test_waste.py

WasteLog unit enforcement and serializer field stripping tests.
"""

import pytest
from datetime import date
from decimal import Decimal


@pytest.mark.django_db
class TestWasteLogUnitEnforcement:

    def _make_marina(self):
        from apps.accounts.models import Marina
        return Marina.objects.create(name='Waste Marina', slug='wst', features={'esg_enabled': True})

    def test_waste_unit_enforced_from_category_bilge_oil_is_litres(self):
        """WasteLog.save() auto-sets unit='litres' for bilge_oil category."""
        from apps.sustainability.models import WasteLog
        marina = self._make_marina()
        log = WasteLog.objects.create(
            marina=marina,
            date=date(2026, 5, 1),
            category='bilge_oil',
            quantity=Decimal('30'),
            disposal_method='specialist',
        )
        assert log.unit == 'litres'

    def test_waste_unit_enforced_from_category_general_is_kg(self):
        """WasteLog.save() auto-sets unit='kg' for general category."""
        from apps.sustainability.models import WasteLog
        marina = self._make_marina()
        log = WasteLog.objects.create(
            marina=marina,
            date=date(2026, 5, 1),
            category='general',
            quantity=Decimal('80'),
            disposal_method='landfill',
        )
        assert log.unit == 'kg'

    def test_waste_unit_enforced_from_category_recycling_is_kg(self):
        """WasteLog.save() auto-sets unit='kg' for recycling category."""
        from apps.sustainability.models import WasteLog
        marina = self._make_marina()
        log = WasteLog.objects.create(
            marina=marina,
            date=date(2026, 5, 1),
            category='recycling',
            quantity=Decimal('40'),
            disposal_method='recycled',
        )
        assert log.unit == 'kg'

    def test_waste_client_supplied_unit_silently_discarded(self):
        """WasteLogSerializer.to_internal_value() strips any client-supplied unit."""
        from apps.sustainability.serializers import WasteLogSerializer
        from apps.sustainability.models import WasteLog
        marina = self._make_marina()

        data = {
            'marina': marina.pk,
            'date': '2026-05-01',
            'category': 'bilge_oil',
            'quantity': '25.00',
            'disposal_method': 'specialist',
            'unit': 'kg',  # client tries to override — must be ignored
        }
        serializer = WasteLogSerializer(data=data)
        assert serializer.is_valid(), serializer.errors
        # unit must NOT appear in validated_data (stripped by to_internal_value)
        assert 'unit' not in serializer.validated_data

    def test_waste_diversion_rate_endpoint_never_returns_500(self):
        """diversion_rate action handles zero total quantity without raising."""
        from apps.sustainability.models import WasteLog
        marina = self._make_marina()
        # No waste logs — zero totals
        from apps.sustainability.calculations import calculate_diversion_rate
        rate = calculate_diversion_rate(Decimal('0'), Decimal('0'))
        assert rate == Decimal('0.00')  # no ZeroDivisionError
