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


from apps.billing.service import add_line_item_from_catalog, create_invoice, finalize_invoice
from apps.billing.models import ChargeableItem, InvoiceLineItem


class SnapshotTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Snapshot Marina')
        seed_default_tax_rates(self.marina)
        self.standard = TaxRate.objects.get(marina=self.marina, name='Standard — 20.00%')
        self.zero = TaxRate.objects.get(marina=self.marina, name='Zero Rated — 0.00%')

    def _make_item(self, name, rate_obj, unit_price='100.00'):
        return ChargeableItem.objects.create(
            marina=self.marina, name=name, category='berth',
            pricing_model='per_night', unit_price=Decimal(unit_price),
            tax_category=rate_obj,
        )

    def test_snapshot_captures_rate_from_tax_category(self):
        item = self._make_item('Test Slip', self.standard)
        invoice = create_invoice(marina=self.marina)
        add_line_item_from_catalog(invoice, item, quantity=1)
        line = invoice.items.first()
        self.assertEqual(line.tax_rate, Decimal('20.00'))

    def test_snapshot_zero_rate(self):
        item = self._make_item('Zero Slip', self.zero)
        invoice = create_invoice(marina=self.marina)
        add_line_item_from_catalog(invoice, item, quantity=1)
        line = invoice.items.first()
        self.assertEqual(line.tax_rate, Decimal('0.00'))

    def test_finalize_sums_per_line_tax(self):
        standard_item = self._make_item('Slip', self.standard, '100.00')
        zero_item = self._make_item('Book', self.zero, '20.00')
        invoice = create_invoice(marina=self.marina)
        add_line_item_from_catalog(invoice, standard_item, quantity=1)
        add_line_item_from_catalog(invoice, zero_item, quantity=1)
        finalize_invoice(invoice)
        invoice.refresh_from_db()
        self.assertEqual(invoice.subtotal, Decimal('120.00'))
        self.assertEqual(invoice.tax_total, Decimal('20.00'))   # 20% of 100, 0% of 20
        self.assertEqual(invoice.total, Decimal('140.00'))

    def test_create_invoice_has_no_vat_rate_field(self):
        invoice = create_invoice(marina=self.marina)
        self.assertFalse(hasattr(invoice, 'vat_rate'))


from rest_framework.test import APIClient
from apps.accounts.models import User


class TaxRateAPITest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='API Test Marina')
        seed_default_tax_rates(self.marina)
        self.user = User.objects.create_user(
            email='mgr@marina.test', password='pass', marina=self.marina, role='manager',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_list_returns_non_archived(self):
        archived = TaxRate.objects.get(marina=self.marina, name='Exempt — 0.00%')
        archived.is_archived = True
        archived.save()
        resp = self.client.get('/api/v1/billing/tax-rates/')
        self.assertEqual(resp.status_code, 200)
        names = [r['name'] for r in resp.json()]
        self.assertNotIn('Exempt — 0.00%', names)
        self.assertIn('Standard — 20.00%', names)

    def test_create_new_rate(self):
        resp = self.client.post('/api/v1/billing/tax-rates/', {
            'name': 'Reduced Rate — 5.00%', 'rate': '5.00',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(TaxRate.objects.filter(marina=self.marina, name='Reduced Rate — 5.00%').exists())

    def test_archive(self):
        exempt = TaxRate.objects.get(marina=self.marina, name='Exempt — 0.00%')
        resp = self.client.post(f'/api/v1/billing/tax-rates/{exempt.pk}/archive/')
        self.assertEqual(resp.status_code, 200)
        exempt.refresh_from_db()
        self.assertTrue(exempt.is_archived)

    def test_delete_unused_rate(self):
        exempt = TaxRate.objects.get(marina=self.marina, name='Exempt — 0.00%')
        resp = self.client.delete(f'/api/v1/billing/tax-rates/{exempt.pk}/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(TaxRate.objects.filter(pk=exempt.pk).exists())

    def test_delete_in_use_rate_returns_409(self):
        from apps.billing.models import ChargeableItem
        standard = TaxRate.objects.get(marina=self.marina, name='Standard — 20.00%')
        ChargeableItem.objects.create(
            marina=self.marina, name='Test Slip', category='berth',
            pricing_model='per_night', unit_price=Decimal('50.00'),
            tax_category=standard,
        )
        resp = self.client.delete(f'/api/v1/billing/tax-rates/{standard.pk}/')
        self.assertEqual(resp.status_code, 409)

    def test_set_default(self):
        zero = TaxRate.objects.get(marina=self.marina, name='Zero Rated — 0.00%')
        resp = self.client.post(f'/api/v1/billing/tax-rates/{zero.pk}/set-default/')
        self.assertEqual(resp.status_code, 200)
        zero.refresh_from_db()
        self.assertTrue(zero.is_default)
        standard = TaxRate.objects.get(marina=self.marina, name='Standard — 20.00%')
        self.assertFalse(standard.is_default)
