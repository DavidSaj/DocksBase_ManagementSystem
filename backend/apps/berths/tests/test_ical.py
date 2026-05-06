import datetime
from django.test import TestCase
from django.utils import timezone
from apps.accounts.models import Marina
from apps.berths.models import Berth, Pier, OTAConnection
from apps.billing.models import ChargeableItem
from apps.reservations.models import Booking


def make_marina():
    return Marina.objects.create(name='Test Marina')


def make_conn(marina):
    return OTAConnection.objects.create(marina=marina, name='mySea', slug='mysea')


def make_berth(marina, code, connection=None):
    pier, _ = Pier.objects.get_or_create(marina=marina, code='A', defaults={'label': 'A'})
    tier, _ = ChargeableItem.objects.get_or_create(
        marina=marina, name='Night',
        defaults={'category': 'berth', 'pricing_model': 'per_night', 'unit_price': 50}
    )
    return Berth.objects.create(
        marina=marina, pier=pier, code=code, pricing_tier=tier,
        status='available', ota_connection=connection,
    )


class OutboundIcalTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.conn = make_conn(self.marina)
        self.berth = make_berth(self.marina, 'A1', connection=self.conn)

    def test_active_booking_appears_as_vevent(self):
        from apps.berths.ical import generate_ota_ical
        Booking.objects.create(
            marina=self.marina, berth=self.berth,
            check_in=datetime.date(2030, 7, 1),
            check_out=datetime.date(2030, 7, 5),
            nights=4, status='confirmed', booking_source=self.conn.slug,
            guest_name='J. Smith',
        )
        cal_str = generate_ota_ical(self.conn)
        self.assertIn(b'VEVENT', cal_str)
        self.assertIn(b'20300701', cal_str)
        self.assertIn(b'DTSTAMP', cal_str)

    def test_direct_booking_excluded(self):
        from apps.berths.ical import generate_ota_ical
        direct_berth = make_berth(self.marina, 'B1', connection=None)
        Booking.objects.create(
            marina=self.marina, berth=direct_berth,
            check_in=datetime.date(2030, 7, 1),
            check_out=datetime.date(2030, 7, 5),
            nights=4, status='confirmed', booking_source='direct',
        )
        cal_str = generate_ota_ical(self.conn)
        self.assertNotIn(b'VEVENT', cal_str)

    def test_ical_endpoint_returns_200(self):
        response = self.client.get(f'/api/v1/berths/ical/{self.conn.outbound_token}.ics')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'text/calendar; charset=utf-8')
