"""
tests/test_tasks.py

Scope 3 fuel dock aggregation and ledger idempotency tests.
"""

import pytest
from decimal import Decimal
from datetime import date, datetime, timezone as dt_timezone
from unittest.mock import patch, MagicMock


@pytest.mark.django_db
class TestScope3FuelDockAggregation:

    def _make_marina(self):
        from apps.accounts.models import Marina
        return Marina.objects.create(name='Fuel Marina', slug='fuel', features={'esg_enabled': True})

    def _make_factor(self, marina, fuel_type='diesel'):
        from apps.sustainability.models import EmissionFactor
        return EmissionFactor.objects.create(
            marina=marina, energy_type=fuel_type, kg_co2e_per_unit='2.51823',
            unit='litre', valid_from=date(2023, 1, 1), source='defra',
        )

    def _make_fuel_entry(self, marina, fuel_type='diesel', actual_litres=100, is_internal=False):
        from apps.fuel_dock.models import FuelDockEntry
        from django.utils import timezone
        return FuelDockEntry.objects.create(
            marina=marina,
            fuel_type=fuel_type,
            status='completed',
            actual_litres=Decimal(str(actual_litres)),
            is_internal_use=is_internal,
            completed_at=datetime(2026, 5, 1, 10, 0, tzinfo=dt_timezone.utc),
        )

    def test_scope3_excludes_internal_use_fuel_entries(self):
        from apps.sustainability.models import Scope3Record
        from apps.sustainability.tasks import calculate_scope3_fuel_dock_for_period
        marina = self._make_marina()
        self._make_factor(marina)

        # Internal use entry — should be excluded from Scope 3
        self._make_fuel_entry(marina, actual_litres=50, is_internal=True)
        # Customer entry — should be included
        self._make_fuel_entry(marina, actual_litres=100, is_internal=False)

        calculate_scope3_fuel_dock_for_period(marina, '2026-05')

        rec = Scope3Record.objects.get(marina=marina, period='2026-05', category='fuel_sold_vessels', fuel_type='diesel')
        # Only 100 litres (not 150)
        assert rec.quantity == Decimal('100.00')

    def test_scope3_null_actual_litres_excluded_from_aggregation(self):
        from apps.sustainability.models import Scope3Record
        from apps.sustainability.tasks import calculate_scope3_fuel_dock_for_period
        from apps.fuel_dock.models import FuelDockEntry
        from django.utils import timezone
        marina = self._make_marina()
        self._make_factor(marina)

        # Entry with null actual_litres (incomplete job)
        FuelDockEntry.objects.create(
            marina=marina, fuel_type='diesel', status='completed',
            actual_litres=None, is_internal_use=False,
            completed_at=datetime(2026, 5, 1, 10, 0, tzinfo=dt_timezone.utc),
        )
        # Complete entry
        self._make_fuel_entry(marina, actual_litres=200)

        calculate_scope3_fuel_dock_for_period(marina, '2026-05')

        rec = Scope3Record.objects.get(marina=marina, period='2026-05', category='fuel_sold_vessels', fuel_type='diesel')
        assert rec.quantity == Decimal('200.00')

    def test_ledger_roll_is_idempotent_for_same_period(self):
        """Running calculate_scope3_fuel_dock_for_period twice for the same period is safe (upsert)."""
        from apps.sustainability.models import Scope3Record
        from apps.sustainability.tasks import calculate_scope3_fuel_dock_for_period
        marina = self._make_marina()
        self._make_factor(marina)
        self._make_fuel_entry(marina, actual_litres=100)

        calculate_scope3_fuel_dock_for_period(marina, '2026-05')
        calculate_scope3_fuel_dock_for_period(marina, '2026-05')  # second run

        # Should still have exactly one record
        assert Scope3Record.objects.filter(
            marina=marina, period='2026-05', category='fuel_sold_vessels', fuel_type='diesel'
        ).count() == 1

    def test_scope2_manual_override_not_overwritten_by_nightly_task(self):
        """Manual Scope 2 records are never overwritten by roll_sustainability_ledger."""
        from apps.sustainability.models import Scope2Record
        marina = self._make_marina()
        Scope2Record.objects.create(
            marina=marina, period='2026-05',
            kwh_consumed=Decimal('1000'), kg_co2e_per_kwh_used=Decimal('0.23314'),
            co2e_kg=Decimal('233.14'), data_source='manual',
        )

        with patch('apps.sustainability.tasks.calculate_scope3_fuel_dock_for_period'):
            with patch('apps.sustainability.calculations.compute_ledger_row', return_value={
                'scope1_co2e_kg': Decimal('0'), 'scope2_co2e_kg': Decimal('233.14'),
                'scope3_co2e_kg': Decimal('0'), 'total_co2e_kg': Decimal('233.14'),
                'revenue_gbp': Decimal('0'), 'berth_nights': 0,
                'co2e_kg_per_gbp_revenue': None, 'co2e_kg_per_berth_night': None,
                'offset_co2e_kg': Decimal('0'), 'is_stale': False,
            }):
                from apps.sustainability.tasks import roll_sustainability_ledger
                roll_sustainability_ledger()

        # Manual Scope2Record must still be data_source='manual'
        rec = Scope2Record.objects.get(marina=marina, period='2026-05')
        assert rec.data_source == 'manual'
