import datetime
from decimal import Decimal

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Marina, User
from apps.berths.models import Berth, Pier
from apps.billing.models import ChargeableItem, TaxRate
from apps.utilities.models import MeterReading, PendingUtilityCharge, SmartMeter


class PendingUtilityChargeTest(TestCase):
    def test_model_exists_with_required_fields(self):
        fields = {f.name for f in PendingUtilityCharge._meta.get_fields()}
        self.assertIn('member', fields)
        self.assertIn('marina', fields)
        self.assertIn('meter', fields)
        self.assertIn('meter_reading', fields)
        self.assertIn('kwh_delta', fields)
        self.assertIn('m3_delta', fields)
        self.assertIn('unit_price', fields)
        self.assertIn('amount', fields)
        self.assertIn('rollover', fields)
        self.assertIn('swept_to_invoice', fields)


class DockwalkListViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='DW Marina', slug='dw-marina')
        self.staff = User.objects.create_user(
            email='staff@dw-marina.com', password='test',
            marina=self.marina,
            role='staff',
        )
        self.pier = Pier.objects.create(marina=self.marina, label='A', code='A')
        self.berth = Berth.objects.create(
            marina=self.marina, pier=self.pier, code='A-01',
        )
        self.meter = SmartMeter.objects.create(
            marina=self.marina, berth=self.berth, vendor='rolec',
            meter_type='electricity', device_id='DEV001', is_active=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.staff)

    def test_dockwalk_list_returns_meters(self):
        response = self.client.get('/api/v1/utilities/dockwalk/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['meters']), 1)

    def test_dockwalk_list_excludes_inactive(self):
        self.meter.is_active = False
        self.meter.save()
        response = self.client.get('/api/v1/utilities/dockwalk/')
        self.assertEqual(len(response.data['meters']), 0)


class DockwalkReadingViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='DW Marina 2', slug='dw-marina-2')
        self.tax = TaxRate.objects.create(marina=self.marina, name='VAT', rate=0)
        self.chargeable = ChargeableItem.objects.create(
            marina=self.marina, name='Shore Power', category='utility',
            pricing_model='per_kwh', unit_price=Decimal('0.25'),
            tax_category=self.tax,
        )
        self.staff = User.objects.create_user(
            email='staff@dw2.com', password='test',
            marina=self.marina,
            role='staff',
        )
        self.pier = Pier.objects.create(marina=self.marina, label='B', code='B')
        self.berth = Berth.objects.create(
            marina=self.marina, pier=self.pier, code='B-01',
        )
        self.meter = SmartMeter.objects.create(
            marina=self.marina, berth=self.berth, vendor='rolec',
            meter_type='electricity', device_id='DEV002', is_active=True,
        )
        MeterReading.objects.create(
            meter=self.meter, reading_kwh=Decimal('1000.000'),
            recorded_at=timezone.now() - datetime.timedelta(hours=24),
            source='manual',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.staff)

    def test_reading_accepted_when_higher(self):
        response = self.client.post(
            f'/api/v1/utilities/dockwalk/{self.meter.id}/reading/',
            {'reading_kwh': '1050.000', 'rollover': False},
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(MeterReading.objects.filter(meter=self.meter).count(), 2)

    def test_reading_rejected_when_lower_without_rollover(self):
        response = self.client.post(
            f'/api/v1/utilities/dockwalk/{self.meter.id}/reading/',
            {'reading_kwh': '500.000', 'rollover': False},
            format='json',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('lower than last', response.data['detail'])

    def test_reading_accepted_with_rollover_flag(self):
        response = self.client.post(
            f'/api/v1/utilities/dockwalk/{self.meter.id}/reading/',
            {'reading_kwh': '50.000', 'rollover': True},
            format='json',
        )
        self.assertEqual(response.status_code, 201)
        reading = (
            MeterReading.objects.filter(meter=self.meter, source='manual')
            .order_by('-recorded_at')
            .first()
        )
        self.assertEqual(reading.reading_kwh, Decimal('50.000'))
