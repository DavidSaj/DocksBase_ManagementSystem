"""
tests/test_emission_factors.py

EmissionFactor deletion guard tests.
"""

import pytest
from decimal import Decimal
from datetime import date


@pytest.mark.django_db
class TestEmissionFactorDeletion:

    def _make_marina(self):
        from apps.accounts.models import Marina
        return Marina.objects.create(name='Factor Marina', slug='fac', features={'esg_enabled': True})

    def _make_factor(self, marina, energy_type='diesel'):
        from apps.sustainability.models import EmissionFactor
        return EmissionFactor.objects.create(
            marina=marina,
            energy_type=energy_type,
            kg_co2e_per_unit=Decimal('2.51823'),
            unit='litre',
            valid_from=date(2023, 1, 1),
            source='defra',
        )

    def _make_scope1_record(self, marina, factor):
        from apps.sustainability.models import Scope1Record
        from datetime import date
        return Scope1Record.objects.create(
            marina=marina,
            date=date(2026, 5, 1),
            source='manual',
            fuel_type='diesel',
            quantity=Decimal('100'),
            emission_factor=factor,
            co2e_kg=Decimal('251.82'),
            unit='litre',
        )

    def _make_mock_user(self, marina):
        from unittest.mock import MagicMock
        user = MagicMock(is_authenticated=True)
        user.marina = marina
        return user

    def test_delete_referenced_factor_returns_409(self):
        """Deleting an EmissionFactor referenced by a Scope1Record returns HTTP 409."""
        from rest_framework.test import APIRequestFactory, force_authenticate
        from apps.sustainability.views import EmissionFactorViewSet
        marina = self._make_marina()
        factor = self._make_factor(marina)
        self._make_scope1_record(marina, factor)

        factory = APIRequestFactory()
        request = factory.delete(f'/fake/{factor.pk}/')
        force_authenticate(request, user=self._make_mock_user(marina))

        view = EmissionFactorViewSet.as_view({'delete': 'destroy'})
        response = view(request, pk=factor.pk)
        assert response.status_code == 409

    def test_delete_unreferenced_factor_succeeds(self):
        """Deleting an EmissionFactor with no referencing records returns HTTP 204."""
        from rest_framework.test import APIRequestFactory, force_authenticate
        from apps.sustainability.views import EmissionFactorViewSet
        marina = self._make_marina()
        factor = self._make_factor(marina, energy_type='hvo')

        factory = APIRequestFactory()
        request = factory.delete(f'/fake/{factor.pk}/')
        force_authenticate(request, user=self._make_mock_user(marina))

        view = EmissionFactorViewSet.as_view({'delete': 'destroy'})
        response = view(request, pk=factor.pk)
        assert response.status_code == 204
