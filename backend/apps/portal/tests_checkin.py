import datetime
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.berths.models import Pier, Berth
from apps.billing.models import ChargeableItem
from apps.reservations.models import Booking


def make_marina(timezone='UTC'):
    return Marina.objects.create(name='Test Marina', slug='test-marina', timezone=timezone)


def make_booking(marina, check_in=None, check_out=None):
    pier = Pier.objects.create(marina=marina, code='A', label='Pier A')
    tier = ChargeableItem.objects.create(
        marina=marina, name='Berth Night', category='berth',
        pricing_model='per_night', unit_price=50,
    )
    berth = Berth.objects.create(marina=marina, pier=pier, code='A1', pricing_tier=tier, status='available')
    today = datetime.date.today()
    return Booking.objects.create(
        marina=marina,
        berth=berth,
        check_in=check_in or today,
        check_out=check_out or today + datetime.timedelta(days=3),
        guest_name='J. Sailor',
        guest_email='boater@test.com',
    )


class BookingPortalFieldsTest(TestCase):
    def test_portal_fields_exist(self):
        marina = make_marina()
        booking = make_booking(marina)
        # All new fields should exist with correct defaults
        self.assertIsNone(booking.boat_draft)
        self.assertIsNone(booking.waiver_envelope_id)
        self.assertFalse(booking.waiver_signed)
        self.assertFalse(booking.pre_cleared)
        self.assertFalse(booking.self_checked_in)
        self.assertIsNone(booking.self_checked_in_at)
