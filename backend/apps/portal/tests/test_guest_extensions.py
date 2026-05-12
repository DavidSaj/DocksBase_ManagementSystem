import datetime
from django.test import TestCase
from django.utils import timezone
from django.urls import reverse
from rest_framework.test import APIClient
from apps.portal.checkin_serializers import PortalBookingSerializer
from apps.accounts.models import Marina
from apps.reservations.models import Booking
from apps.members.models import Member
from apps.utilities.models import WashToken
from apps.billing.models import ChargeableItem, TaxRate
from apps.berths.models import Amenity


class WashTokenSerializerTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina', slug='test-m')
        self.tax = TaxRate.objects.create(marina=self.marina, name='VAT', rate=0)
        self.chargeable = ChargeableItem.objects.create(
            marina=self.marina,
            name='Shower Token',
            category='service',
            pricing_model='flat_fee',
            unit_price=2,
            tax_category=self.tax,
        )
        self.member = Member.objects.create(marina=self.marina, name='Test Boater', email='boater@test.com')
        self.booking = Booking.objects.create(
            marina=self.marina,
            check_in=datetime.date.today(),
            check_out=datetime.date.today() + datetime.timedelta(days=2),
            status='checked_in',
            self_checked_in=True,
            guest_name='Test Boater',
            guest_email='boater@test.com',
        )
        self.token = WashToken.objects.create(
            marina=self.marina,
            member=self.member,
            facility='shower',
            token_code='ABC123',
            status='issued',
            expires_at=timezone.now() + datetime.timedelta(days=1),
            chargeable_item=self.chargeable,
        )

    def test_wash_tokens_field_present(self):
        serializer = PortalBookingSerializer(self.booking)
        data = serializer.data
        self.assertIn('wash_tokens', data)

    def test_wash_tokens_is_list(self):
        serializer = PortalBookingSerializer(self.booking)
        data = serializer.data
        self.assertIsInstance(data['wash_tokens'], list)


class GuestMapViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Map Marina', slug='map-marina')
        self.client = APIClient()
        self.client.defaults['HTTP_X_MARINA_SLUG'] = 'map-marina'
        Amenity.objects.create(
            marina=self.marina,
            type='toilets',
            label='Main Restroom',
            canvas_x=10.5,
            canvas_y=20.3,
            scale=1.0,
            rotation=0,
        )

    def test_map_returns_amenities(self):
        response = self.client.get('/api/v1/portal/checkin/map/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('amenities', response.data)
        self.assertEqual(len(response.data['amenities']), 1)
        self.assertIn('canvas_x', response.data['amenities'][0])
        self.assertIn('canvas_y', response.data['amenities'][0])
        self.assertIn('type', response.data['amenities'][0])
        self.assertIn('label', response.data['amenities'][0])

    def test_map_returns_app_config(self):
        self.marina.app_config = {'brand_color': '#336699'}
        self.marina.save()
        response = self.client.get('/api/v1/portal/checkin/map/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('app_config', response.data)
        self.assertEqual(response.data['app_config']['brand_color'], '#336699')

    def test_map_requires_header(self):
        client_no_header = APIClient()
        response = client_no_header.get('/api/v1/portal/checkin/map/')
        self.assertEqual(response.status_code, 400)
        self.assertIn('error', response.data)
