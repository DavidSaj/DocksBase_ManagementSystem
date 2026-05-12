import datetime
from django.test import TestCase
from django.utils import timezone
from apps.portal.checkin_serializers import PortalBookingSerializer
from apps.accounts.models import Marina
from apps.reservations.models import Booking
from apps.members.models import Member
from apps.utilities.models import WashToken
from apps.billing.models import ChargeableItem, TaxRate


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
