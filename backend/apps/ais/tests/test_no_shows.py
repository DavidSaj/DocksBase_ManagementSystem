from datetime import date, datetime, time, timedelta, timezone as dt_tz
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from apps.accounts.models import Marina, User
from apps.ais.detect_events import detect_no_shows
from apps.ais.models import VesselPosition
from apps.reservations.models import Booking
from apps.vessels.models import Vessel


class NoShowDetectionTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='M', lat=Decimal('52.0'), lng=Decimal('1.0'),
        )
        self.user = User.objects.create_user(email='owner@m', password='x', marina=self.marina)
        self.vessel = Vessel.objects.create(marina=self.marina, name='V', mmsi='227111111')

    def _make_booking(self, eta_time=time(10, 0)):
        return Booking.objects.create(
            marina=self.marina, vessel=self.vessel,
            check_in=date.today(), check_out=date.today() + timedelta(days=1),
            status='confirmed', eta=eta_time,
        )

    @patch('apps.ais.detect_events.notify_no_show')
    def test_skips_when_vessel_never_transmitted(self, mock_notify):
        """Dark Transponder guard: no AIS history → no flag."""
        self._make_booking()
        with patch('apps.ais.detect_events._tz.now',
                   return_value=datetime.combine(date.today(), time(13, 0), tzinfo=dt_tz.utc)):
            detect_no_shows(self.marina, recipient=self.user)
        booking = Booking.objects.get()
        self.assertFalse(booking.ais_no_show_predicted)
        mock_notify.assert_not_called()

    @patch('apps.ais.detect_events.notify_no_show')
    def test_flags_when_history_exists_and_no_recent_contact(self, mock_notify):
        booking = self._make_booking()
        VesselPosition.objects.create(
            marina=self.marina, mmsi='227111111', vessel=self.vessel,
            lat=Decimal('45.0'), lng=Decimal('1.0'),
            reported_at=timezone.now() - timedelta(days=3),
        )
        with patch('apps.ais.detect_events._tz.now',
                   return_value=datetime.combine(date.today(), time(13, 0), tzinfo=dt_tz.utc)):
            detect_no_shows(self.marina, recipient=self.user)
        booking.refresh_from_db()
        self.assertTrue(booking.ais_no_show_predicted)
        mock_notify.assert_called_once()

    @patch('apps.ais.detect_events.notify_no_show')
    def test_skips_when_recent_contact_exists(self, mock_notify):
        booking = self._make_booking()
        mocked_now = datetime.combine(date.today(), time(13, 0), tzinfo=dt_tz.utc)
        # Recent relative to the mocked clock (12:30 on the same simulated day),
        # so the 1-hour liveness window catches it deterministically.
        VesselPosition.objects.create(
            marina=self.marina, mmsi='227111111', vessel=self.vessel,
            lat=Decimal('45.0'), lng=Decimal('1.0'),
            reported_at=mocked_now - timedelta(minutes=30),
        )
        with patch('apps.ais.detect_events._tz.now', return_value=mocked_now):
            detect_no_shows(self.marina, recipient=self.user)
        booking.refresh_from_db()
        self.assertFalse(booking.ais_no_show_predicted)
        mock_notify.assert_not_called()

    @patch('apps.ais.detect_events.notify_no_show')
    def test_skips_before_eta_minus_2h(self, mock_notify):
        self._make_booking(eta_time=time(18, 0))
        VesselPosition.objects.create(
            marina=self.marina, mmsi='227111111', vessel=self.vessel,
            lat=Decimal('45.0'), lng=Decimal('1.0'),
            reported_at=timezone.now() - timedelta(days=3),
        )
        # Now is 14:00, ETA is 18:00 → threshold 16:00 → too early.
        with patch('apps.ais.detect_events._tz.now',
                   return_value=datetime.combine(date.today(), time(14, 0), tzinfo=dt_tz.utc)):
            detect_no_shows(self.marina, recipient=self.user)
        mock_notify.assert_not_called()

    @patch('apps.ais.detect_events.notify_no_show')
    def test_idempotent_once_flagged(self, mock_notify):
        booking = self._make_booking()
        booking.ais_no_show_predicted = True
        booking.save(update_fields=['ais_no_show_predicted'])
        VesselPosition.objects.create(
            marina=self.marina, mmsi='227111111', vessel=self.vessel,
            lat=Decimal('45.0'), lng=Decimal('1.0'),
            reported_at=timezone.now() - timedelta(days=3),
        )
        with patch('apps.ais.detect_events._tz.now',
                   return_value=datetime.combine(date.today(), time(13, 0), tzinfo=dt_tz.utc)):
            detect_no_shows(self.marina, recipient=self.user)
        mock_notify.assert_not_called()
