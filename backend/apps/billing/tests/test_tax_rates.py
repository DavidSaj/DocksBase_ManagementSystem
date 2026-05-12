from decimal import Decimal
from django.test import TestCase
from apps.accounts.models import Marina
from apps.billing.models import TaxRate
from apps.billing.service import (
    create_tax_rate, set_default_tax_rate, delete_tax_rate, seed_default_tax_rates,
)


class TaxRateModelTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina')

    def test_create_tax_rate(self):
        tr = TaxRate.objects.create(
            marina=self.marina, name='Standard VAT', rate=Decimal('20.00'), is_default=True,
        )
        self.assertEqual(tr.name, 'Standard VAT')
        self.assertEqual(tr.rate, Decimal('20.00'))
        self.assertTrue(tr.is_default)
        self.assertFalse(tr.is_archived)

    def test_unique_name_per_marina(self):
        TaxRate.objects.create(marina=self.marina, name='Standard VAT', rate=Decimal('20.00'))
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            TaxRate.objects.create(marina=self.marina, name='Standard VAT', rate=Decimal('21.00'))


class TaxRateServiceTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Service Test Marina')

    def test_seed_creates_three_rates(self):
        rates = seed_default_tax_rates(self.marina)
        self.assertEqual(len(rates), 3)
        names = {r.name for r in rates}
        self.assertIn('Standard — 20.00%', names)
        self.assertIn('Zero Rated — 0.00%', names)
        self.assertIn('Exempt — 0.00%', names)

    def test_seed_is_idempotent(self):
        seed_default_tax_rates(self.marina)
        seed_default_tax_rates(self.marina)
        self.assertEqual(TaxRate.objects.filter(marina=self.marina).count(), 3)

    def test_seed_standard_is_default(self):
        seed_default_tax_rates(self.marina)
        default = TaxRate.objects.get(marina=self.marina, is_default=True)
        self.assertEqual(default.name, 'Standard — 20.00%')

    def test_create_tax_rate_clears_previous_default(self):
        seed_default_tax_rates(self.marina)
        new_rate = create_tax_rate(self.marina, name='Standard 2026 — 21.00%', rate=Decimal('21.00'), is_default=True)
        defaults = TaxRate.objects.filter(marina=self.marina, is_default=True)
        self.assertEqual(defaults.count(), 1)
        self.assertEqual(defaults.first().pk, new_rate.pk)

    def test_set_default_clears_others(self):
        seed_default_tax_rates(self.marina)
        zero = TaxRate.objects.get(marina=self.marina, name='Zero Rated — 0.00%')
        set_default_tax_rate(zero)
        self.assertTrue(TaxRate.objects.get(pk=zero.pk).is_default)
        others = TaxRate.objects.filter(marina=self.marina, is_default=True).exclude(pk=zero.pk)
        self.assertEqual(others.count(), 0)

    def test_delete_tax_rate_with_no_items(self):
        seed_default_tax_rates(self.marina)
        exempt = TaxRate.objects.get(marina=self.marina, name='Exempt — 0.00%')
        delete_tax_rate(exempt)
        self.assertFalse(TaxRate.objects.filter(pk=exempt.pk).exists())

    def test_delete_tax_rate_raises_if_items_assigned(self):
        from apps.billing.models import ChargeableItem
        seed_default_tax_rates(self.marina)
        standard = TaxRate.objects.get(marina=self.marina, name='Standard — 20.00%')
        ChargeableItem.objects.create(
            marina=self.marina, name='Test Slip', category='berth',
            pricing_model='per_night', unit_price=Decimal('50.00'),
            tax_category=standard,
        )
        with self.assertRaises(ValueError, msg='should raise when items assigned'):
            delete_tax_rate(standard)
