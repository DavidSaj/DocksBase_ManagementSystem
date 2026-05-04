import datetime
import itertools
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina
from apps.berths.models import Pier, Berth
from apps.billing.models import ChargeableItem
from apps.reservations.models import Booking

_marina_counter = itertools.count(1)


def make_marina(timezone='UTC'):
    n = next(_marina_counter)
    return Marina.objects.create(name='Test Marina', slug=f'test-marina-{n}', timezone=timezone)


def make_booking(marina, check_in=None, check_out=None):
    pier, _ = Pier.objects.get_or_create(marina=marina, code='A', defaults={'label': 'Pier A'})
    tier, _ = ChargeableItem.objects.get_or_create(
        marina=marina, name='Berth Night',
        defaults={'category': 'berth', 'pricing_model': 'per_night', 'unit_price': 50},
    )
    berth, _ = Berth.objects.get_or_create(marina=marina, pier=pier, code='A1', defaults={'pricing_tier': tier, 'status': 'available'})
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
        self.assertFalse(booking.insurance_doc)
