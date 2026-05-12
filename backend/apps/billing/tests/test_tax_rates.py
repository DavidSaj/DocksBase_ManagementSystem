from decimal import Decimal
from django.test import TestCase
from apps.accounts.models import Marina
from apps.billing.models import TaxRate


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
