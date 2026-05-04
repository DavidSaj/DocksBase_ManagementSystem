import datetime
import itertools
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina
from apps.berths.models import Pier, Berth
from apps.billing.models import ChargeableItem
from apps.reservations.models import Booking
from apps.portal.checkin_utils import (
    evaluate_pre_cleared,
    make_magic_token, decode_magic_token,
    make_portal_token, decode_portal_token,
    make_magic_url,
)
from django.core import signing

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


class MarinaWalletFieldsTest(TestCase):
    def test_wallet_fields_exist(self):
        marina = make_marina()
        self.assertIsNone(marina.wallet_wifi_network)
        self.assertIsNone(marina.wallet_wifi_password)
        self.assertEqual(marina.wallet_gate_codes, [])
        self.assertIsNone(marina.wallet_harbour_master_phone)
        self.assertIsNone(marina.wallet_vhf_channel)
        self.assertIsNone(marina.wallet_office_hours)
        self.assertIsNone(marina.waiver_template_id)


class EvaluatePreClearedTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.booking = make_booking(self.marina)

    def test_not_cleared_without_waiver(self):
        self.booking.boat_loa = 10
        self.booking.boat_beam = 3
        self.booking.boat_draft = 1.5
        self.booking.save()
        evaluate_pre_cleared(self.booking)
        self.booking.refresh_from_db()
        self.assertFalse(self.booking.pre_cleared)

    def test_not_cleared_without_dimensions(self):
        self.booking.waiver_signed = True
        self.booking.save()
        evaluate_pre_cleared(self.booking)
        self.booking.refresh_from_db()
        self.assertFalse(self.booking.pre_cleared)

    def test_not_cleared_with_partial_dimensions(self):
        self.booking.waiver_signed = True
        self.booking.boat_loa = 10
        self.booking.boat_beam = 3
        # boat_draft is None
        self.booking.save()
        evaluate_pre_cleared(self.booking)
        self.booking.refresh_from_db()
        self.assertFalse(self.booking.pre_cleared)

    def test_cleared_when_waiver_and_all_dimensions_complete(self):
        self.booking.waiver_signed = True
        self.booking.boat_loa = 10
        self.booking.boat_beam = 3
        self.booking.boat_draft = 1.5
        self.booking.save()
        evaluate_pre_cleared(self.booking)
        self.booking.refresh_from_db()
        self.assertTrue(self.booking.pre_cleared)

    def test_idempotent_when_already_cleared(self):
        self.booking.waiver_signed = True
        self.booking.boat_loa = 10
        self.booking.boat_beam = 3
        self.booking.boat_draft = 1.5
        self.booking.pre_cleared = True
        self.booking.save()
        evaluate_pre_cleared(self.booking)  # should not error
        self.booking.refresh_from_db()
        self.assertTrue(self.booking.pre_cleared)


class PortalAuthTokenTest(TestCase):
    def test_magic_token_round_trip(self):
        token = make_magic_token(booking_id=42, boater_email='b@test.com')
        payload = decode_magic_token(token)
        self.assertEqual(payload['booking_id'], 42)
        self.assertEqual(payload['boater_email'], 'b@test.com')

    def test_magic_token_invalid_raises(self):
        with self.assertRaises(signing.BadSignature):
            decode_magic_token('not-a-valid-token')

    def test_portal_token_round_trip(self):
        token = make_portal_token(booking_id=7, marina_slug='harbor', boater_email='b@test.com')
        payload = decode_portal_token(token)
        self.assertEqual(payload['booking_id'], 7)
        self.assertEqual(payload['marina_slug'], 'harbor')
        self.assertEqual(payload['boater_email'], 'b@test.com')

    def test_portal_token_invalid_raises(self):
        with self.assertRaises(signing.BadSignature):
            decode_portal_token('tampered-token')

    def test_make_magic_url_contains_token_and_slug(self):
        marina = make_marina()
        booking = make_booking(marina)
        url = make_magic_url(booking)
        self.assertIn('token=', url)
        self.assertIn(marina.slug, url)


from apps.portal.checkin_auth import PortalTokenAuthentication, PortalUser
from rest_framework.test import APIRequestFactory
from rest_framework.exceptions import AuthenticationFailed


class PortalTokenAuthTest(TestCase):
    def setUp(self):
        self.auth = PortalTokenAuthentication()
        self.factory = APIRequestFactory()

    def _request_with_token(self, token):
        request = self.factory.get('/')
        request.META['HTTP_AUTHORIZATION'] = f'Bearer {token}'
        return request

    def test_valid_token_returns_portal_user(self):
        token = make_portal_token(booking_id=5, marina_slug='harbor', boater_email='b@test.com')
        request = self._request_with_token(token)
        user, _ = self.auth.authenticate(request)
        self.assertIsInstance(user, PortalUser)
        self.assertEqual(user.booking_id, 5)
        self.assertEqual(user.marina_slug, 'harbor')
        self.assertTrue(user.is_authenticated)

    def test_invalid_token_raises_authentication_failed(self):
        request = self._request_with_token('bad-token')
        with self.assertRaises(AuthenticationFailed):
            self.auth.authenticate(request)

    def test_missing_header_returns_none(self):
        request = self.factory.get('/')
        result = self.auth.authenticate(request)
        self.assertIsNone(result)


from apps.portal.checkin_serializers import PortalBookingSerializer


class PortalBookingSerializerTest(TestCase):
    def test_is_arrival_day_true_when_checkin_today(self):
        marina = make_marina()
        booking = make_booking(marina, check_in=datetime.date.today())
        data = PortalBookingSerializer(booking).data
        self.assertTrue(data['is_arrival_day'])

    def test_is_arrival_day_false_when_checkin_future(self):
        marina = make_marina()
        future = datetime.date.today() + datetime.timedelta(days=5)
        booking = make_booking(marina, check_in=future, check_out=future + datetime.timedelta(days=2))
        data = PortalBookingSerializer(booking).data
        self.assertFalse(data['is_arrival_day'])

    def test_marina_wallet_absent_before_checkin(self):
        marina = make_marina()
        booking = make_booking(marina)
        data = PortalBookingSerializer(booking).data
        self.assertIsNone(data['marina_wallet'])

    def test_marina_wallet_present_after_self_checkin(self):
        marina = make_marina()
        marina.wallet_wifi_network = 'HarborGuest'
        marina.wallet_wifi_password = 'anchor123'
        marina.wallet_gate_codes = [{'label': 'Main Gate', 'pin': '4321'}]
        marina.save()
        booking = make_booking(marina)
        booking.self_checked_in = True
        booking.save()
        data = PortalBookingSerializer(booking).data
        self.assertIsNotNone(data['marina_wallet'])
        self.assertEqual(data['marina_wallet']['wifi_network'], 'HarborGuest')
        self.assertEqual(data['marina_wallet']['gate_codes'][0]['pin'], '4321')
