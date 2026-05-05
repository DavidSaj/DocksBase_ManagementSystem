import datetime
from django.test import TestCase
from django.utils import timezone
from apps.accounts.models import Marina
from apps.berths.models import Berth, Pier
from apps.billing.models import ChargeableItem
from apps.reservations.models import Booking


def make_marina():
    return Marina.objects.create(name='Test Marina')


def make_berth(marina, code, channel='mysea'):
    pier, _ = Pier.objects.get_or_create(marina=marina, code='A', defaults={'label': 'A'})
    tier, _ = ChargeableItem.objects.get_or_create(
        marina=marina, name='Night',
        defaults={'category': 'berth', 'pricing_model': 'per_night', 'unit_price': 50}
    )
    return Berth.objects.create(
        marina=marina, pier=pier, code=code, pricing_tier=tier,
        status='available', sales_channel=channel
    )


class OutboundIcalTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.berth = make_berth(self.marina, 'A1', channel='mysea')

    def test_active_booking_appears_as_vevent(self):
        from apps.berths.ical import generate_mysea_ical
        booking = Booking.objects.create(
            marina=self.marina, berth=self.berth,
            check_in=datetime.date(2030, 7, 1),
            check_out=datetime.date(2030, 7, 5),
            nights=4, status='confirmed', booking_source='mysea',
            guest_name='J. Smith',
        )
        cal_str = generate_mysea_ical(self.marina)
        self.assertIn(b'VEVENT', cal_str)
        self.assertIn(b'20300701', cal_str)
        self.assertIn(b'DTSTAMP', cal_str)

    def test_direct_booking_excluded(self):
        from apps.berths.ical import generate_mysea_ical
        direct_berth = make_berth(self.marina, 'B1', channel='direct')
        Booking.objects.create(
            marina=self.marina, berth=direct_berth,
            check_in=datetime.date(2030, 7, 1),
            check_out=datetime.date(2030, 7, 5),
            nights=4, status='confirmed', booking_source='direct',
        )
        cal_str = generate_mysea_ical(self.marina)
        self.assertNotIn(b'VEVENT', cal_str)

    def test_cooldown_berth_generates_blocking_event(self):
        from apps.berths.ical import generate_mysea_ical
        self.berth.channel_cooldown_until = timezone.now() + datetime.timedelta(minutes=25)
        self.berth.save(update_fields=['channel_cooldown_until'])
        cal_str = generate_mysea_ical(self.marina)
        self.assertIn(b'VEVENT', cal_str)
        self.assertIn(b'cooldown', cal_str.lower())

    def test_ical_endpoint_returns_200(self):
        response = self.client.get(f'/api/v1/berths/ical/mysea.ics?marina={self.marina.slug}')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Content-Type'], 'text/calendar; charset=utf-8')
