import datetime
from unittest.mock import patch
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina
from apps.reservations.models import Booking


class PublicBookingCreateTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina', slug='test-marina', booking_mode='manual_approval')
        self.client = APIClient()
        self.url = '/api/v1/public/bookings/'
        today = datetime.date.today()
        self.payload = {
            'check_in': str(today + datetime.timedelta(days=30)),
            'check_out': str(today + datetime.timedelta(days=37)),
            'guest_name': 'J. Sailor',
            'guest_email': 'sailor@example.com',
            'boat_loa': 12.5,
            'boat_beam': 4.2,
            'boat_draft': 1.8,
        }

    def _post(self, payload=None, slug='test-marina'):
        return self.client.post(
            self.url,
            payload or self.payload,
            format='json',
            HTTP_X_MARINA_SLUG=slug,
        )

    @patch('apps.portal.public_booking_views.send_booking_request_boater_email')
    @patch('apps.portal.public_booking_views.send_booking_request_manager_email')
    def test_creates_pending_approval_booking(self, mock_mgr, mock_boater):
        resp = self._post()
        self.assertEqual(resp.status_code, 201)
        booking = Booking.objects.get(pk=resp.data['booking_id'])
        self.assertEqual(booking.status, 'pending_approval')
        self.assertIsNone(booking.berth)
        self.assertEqual(booking.booking_type, 'transient')
        self.assertEqual(booking.marina, self.marina)
        mock_boater.assert_called_once_with(booking)
        mock_mgr.assert_called_once_with(booking)

    @patch('apps.portal.public_booking_views.send_booking_request_boater_email')
    @patch('apps.portal.public_booking_views.send_booking_request_manager_email')
    def test_returns_booking_id_and_message(self, mock_mgr, mock_boater):
        resp = self._post()
        self.assertEqual(resp.status_code, 201)
        self.assertIn('booking_id', resp.data)
        self.assertIn('message', resp.data)

    def test_missing_field_returns_400(self):
        payload = {**self.payload}
        del payload['guest_email']
        resp = self._post(payload)
        self.assertEqual(resp.status_code, 400)
        self.assertIn('guest_email', resp.data)

    def test_check_in_not_before_check_out_returns_400(self):
        payload = {**self.payload, 'check_in': '2026-07-22', 'check_out': '2026-07-15'}
        resp = self._post(payload)
        self.assertEqual(resp.status_code, 400)

    def test_unknown_marina_slug_returns_404(self):
        resp = self._post(slug='nonexistent-marina')
        self.assertEqual(resp.status_code, 404)

    def test_no_slug_header_returns_400_or_404(self):
        resp = self.client.post(self.url, self.payload, format='json')
        self.assertIn(resp.status_code, [400, 404])

    def test_check_in_in_past_returns_400(self):
        payload = {**self.payload, 'check_in': '2020-01-01', 'check_out': '2020-01-08'}
        resp = self._post(payload)
        self.assertEqual(resp.status_code, 400)
