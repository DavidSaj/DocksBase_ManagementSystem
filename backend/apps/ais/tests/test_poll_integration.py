from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from apps.accounts.models import Marina, User
from apps.ais.adapters.base import AISReading
from apps.ais.tasks import poll_ais_for_marina
from apps.reservations.models import Booking
from apps.vessels.models import Vessel


SQUARE = [[51.99, 0.99], [51.99, 1.01], [52.01, 1.01], [52.01, 0.99]]


class PollTaskPhase2Tests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='M', lat=Decimal('52.0'), lng=Decimal('1.0'),
            marinetraffic_api_key='test',
            ais_poll_radius_nm=10,
            basin_polygon=SQUARE,
        )
        self.user = User.objects.create_user(email='owner@m', password='x', marina=self.marina)
        self.vessel = Vessel.objects.create(marina=self.marina, name='V', mmsi='227111111')
        self.booking = Booking.objects.create(
            marina=self.marina, vessel=self.vessel,
            check_in=date.today(), check_out=date.today() + timedelta(days=1),
            status='confirmed',
        )

    def _reading(self, lat, lng):
        return AISReading(
            mmsi='227111111',
            lat=Decimal(str(lat)),
            lng=Decimal(str(lng)),
            speed_kn=Decimal('5'), course_deg=0, heading_deg=0,
            nav_status='UnderwayUsingEngine',
            reported_at=timezone.now(),
        )

    @patch('apps.ais.tasks.MarineTrafficAdapter')
    @patch('apps.ais.detect_events.notify_auto_checkin')
    def test_first_sighting_inside_basin_flips_booking(self, mock_notify, mock_adapter):
        mock_adapter.return_value.fetch_positions.return_value = [self._reading(52.0, 1.0)]
        poll_ais_for_marina(self.marina.id)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, 'checked_in')
        mock_notify.assert_called_once()

    @patch('apps.ais.tasks.MarineTrafficAdapter')
    @patch('apps.ais.detect_events.notify_auto_checkin')
    def test_outside_basin_no_event(self, mock_notify, mock_adapter):
        mock_adapter.return_value.fetch_positions.return_value = [self._reading(52.5, 1.5)]
        poll_ais_for_marina(self.marina.id)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, 'confirmed')
        mock_notify.assert_not_called()
