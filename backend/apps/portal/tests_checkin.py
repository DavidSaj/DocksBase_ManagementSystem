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


from django.urls import reverse


class MagicAuthViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina = make_marina()
        self.booking = make_booking(self.marina)

    def test_valid_token_returns_session_token_and_booking_id(self):
        token = make_magic_token(self.booking.id, self.booking.guest_email)
        resp = self.client.post('/api/v1/portal/checkin/auth/magic/', {'token': token}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('token', resp.data)
        self.assertEqual(resp.data['booking_id'], self.booking.id)
        self.assertEqual(resp.data['marina_slug'], self.marina.slug)

    def test_invalid_token_returns_401(self):
        resp = self.client.post('/api/v1/portal/checkin/auth/magic/', {'token': 'bad'}, format='json')
        self.assertEqual(resp.status_code, 401)

    def test_missing_token_returns_400(self):
        resp = self.client.post('/api/v1/portal/checkin/auth/magic/', {}, format='json')
        self.assertEqual(resp.status_code, 400)


class PortalBookingGetViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina = make_marina()
        self.booking = make_booking(self.marina)
        session_token = make_portal_token(
            booking_id=self.booking.id,
            marina_slug=self.marina.slug,
            boater_email=self.booking.guest_email,
        )
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {session_token}')

    def test_get_booking_returns_200(self):
        resp = self.client.get(f'/api/v1/portal/checkin/bookings/{self.booking.id}/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('is_arrival_day', resp.data)
        self.assertIn('pre_cleared', resp.data)

    def test_cannot_get_another_booking(self):
        other_marina = make_marina()
        other_booking = make_booking(other_marina)
        resp = self.client.get(f'/api/v1/portal/checkin/bookings/{other_booking.id}/')
        self.assertEqual(resp.status_code, 403)

    def test_unauthenticated_returns_401(self):
        self.client.credentials()
        resp = self.client.get(f'/api/v1/portal/checkin/bookings/{self.booking.id}/')
        self.assertEqual(resp.status_code, 401)


class PatchDimensionsViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina = make_marina()
        self.booking = make_booking(self.marina)
        session_token = make_portal_token(
            booking_id=self.booking.id,
            marina_slug=self.marina.slug,
            boater_email=self.booking.guest_email,
        )
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {session_token}')

    def test_patch_saves_dimensions(self):
        resp = self.client.patch(
            f'/api/v1/portal/checkin/bookings/{self.booking.id}/dimensions/',
            {'boat_loa': '12.5', 'boat_beam': '4.2', 'boat_draft': '1.8'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertEqual(float(self.booking.boat_loa), 12.5)
        self.assertEqual(float(self.booking.boat_draft), 1.8)

    def test_patch_with_complete_dimensions_and_signed_waiver_sets_pre_cleared(self):
        self.booking.waiver_signed = True
        self.booking.save()
        resp = self.client.patch(
            f'/api/v1/portal/checkin/bookings/{self.booking.id}/dimensions/',
            {'boat_loa': '12.5', 'boat_beam': '4.2', 'boat_draft': '1.8'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertTrue(self.booking.pre_cleared)

    def test_patch_without_waiver_does_not_set_pre_cleared(self):
        resp = self.client.patch(
            f'/api/v1/portal/checkin/bookings/{self.booking.id}/dimensions/',
            {'boat_loa': '12.5', 'boat_beam': '4.2', 'boat_draft': '1.8'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertFalse(self.booking.pre_cleared)


class SelfCheckinViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina = make_marina()
        today = datetime.date.today()
        self.booking = make_booking(self.marina, check_in=today, check_out=today + datetime.timedelta(days=2))
        self.booking.pre_cleared = True
        self.booking.save()
        session_token = make_portal_token(
            booking_id=self.booking.id,
            marina_slug=self.marina.slug,
            boater_email=self.booking.guest_email,
        )
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {session_token}')

    def test_self_checkin_sets_flags(self):
        resp = self.client.post(f'/api/v1/portal/checkin/bookings/{self.booking.id}/self-checkin/')
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertTrue(self.booking.self_checked_in)
        self.assertEqual(self.booking.status, 'checked_in')
        self.assertIsNotNone(self.booking.self_checked_in_at)

    def test_self_checkin_not_pre_cleared_returns_400(self):
        self.booking.pre_cleared = False
        self.booking.save()
        resp = self.client.post(f'/api/v1/portal/checkin/bookings/{self.booking.id}/self-checkin/')
        self.assertEqual(resp.status_code, 400)

    def test_self_checkin_idempotent(self):
        self.booking.self_checked_in = True
        self.booking.save()
        resp = self.client.post(f'/api/v1/portal/checkin/bookings/{self.booking.id}/self-checkin/')
        self.assertEqual(resp.status_code, 200)


from unittest.mock import patch, MagicMock
import json


class WaiverViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina = make_marina()
        self.marina.waiver_template_id = 'tmpl_abc123'
        self.marina.save()
        self.booking = make_booking(self.marina)
        session_token = make_portal_token(
            booking_id=self.booking.id,
            marina_slug=self.marina.slug,
            boater_email=self.booking.guest_email,
        )
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {session_token}')

    @patch('apps.portal.checkin_views.get_sign_url')
    def test_waiver_view_returns_sign_url(self, mock_get_sign_url):
        mock_get_sign_url.return_value = ('env_abc', 'https://sign.hellosign.com/...')
        resp = self.client.post(f'/api/v1/portal/checkin/bookings/{self.booking.id}/waiver/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('sign_url', resp.data)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.waiver_envelope_id, 'env_abc')

    @patch('apps.portal.checkin_views.get_existing_sign_url')
    def test_waiver_view_idempotent_when_envelope_exists(self, mock_get_existing):
        self.booking.waiver_envelope_id = 'existing_env'
        self.booking.save()
        mock_get_existing.return_value = 'https://sign.hellosign.com/existing'
        resp = self.client.post(f'/api/v1/portal/checkin/bookings/{self.booking.id}/waiver/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('sign_url', resp.data)
        self.assertEqual(resp.data['sign_url'], 'https://sign.hellosign.com/existing')

    def test_waiver_view_400_when_no_template(self):
        self.marina.waiver_template_id = None
        self.marina.save()
        resp = self.client.post(f'/api/v1/portal/checkin/bookings/{self.booking.id}/waiver/')
        self.assertEqual(resp.status_code, 400)


class DropboxSignWebhookTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina = make_marina()
        self.booking = make_booking(self.marina)
        self.booking.waiver_envelope_id = 'env_xyz'
        self.booking.boat_loa = 10
        self.booking.boat_beam = 3
        self.booking.boat_draft = 1.5
        self.booking.save()

    def _make_payload(self, event_type, booking_id):
        return json.dumps({
            'event': {
                'event_type': event_type,
                'event_time': '1649948325',
                'event_hash': 'ignored-in-tests',
            },
            'signature_request': {
                'signature_request_id': 'env_xyz',
                'metadata': {'booking_id': str(booking_id)},
            },
        })

    @patch('apps.portal.checkin_views.is_valid_dropbox_sign_request', return_value=True)
    def test_webhook_sets_waiver_signed_and_pre_cleared(self, _mock):
        payload = self._make_payload('signature_request_all_signed', self.booking.id)
        resp = self.client.post(
            '/api/v1/portal/checkin/webhooks/dropbox-sign/',
            data=payload,
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertTrue(self.booking.waiver_signed)
        self.assertTrue(self.booking.pre_cleared)

    @patch('apps.portal.checkin_views.is_valid_dropbox_sign_request', return_value=False)
    def test_webhook_rejects_invalid_hmac(self, _mock):
        payload = self._make_payload('signature_request_all_signed', self.booking.id)
        resp = self.client.post(
            '/api/v1/portal/checkin/webhooks/dropbox-sign/',
            data=payload,
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)

    @patch('apps.portal.checkin_views.is_valid_dropbox_sign_request', return_value=True)
    def test_webhook_ignores_other_event_types(self, _mock):
        payload = self._make_payload('signature_request_viewed', self.booking.id)
        resp = self.client.post(
            '/api/v1/portal/checkin/webhooks/dropbox-sign/',
            data=payload,
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertFalse(self.booking.waiver_signed)
