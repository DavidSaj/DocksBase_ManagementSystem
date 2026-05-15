from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from apps.accounts.models import Marina, User
from apps.ais.detect_events import on_basin_enter, on_basin_exit
from apps.ais.models import VesselPosition
from apps.reservations.models import Booking
from apps.vessels.models import Vessel


class BasinEnterTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='M', lat=Decimal('52.0'), lng=Decimal('1.0'),
        )
        self.user = User.objects.create_user(email='owner@m', password='x', marina=self.marina)
        self.vessel = Vessel.objects.create(marina=self.marina, name='V1', mmsi='227111111')
        self.position = VesselPosition.objects.create(
            marina=self.marina, mmsi='227111111', vessel=self.vessel,
            lat=Decimal('52.0'), lng=Decimal('1.0'),
            reported_at=timezone.now(), in_basin=True,
        )
        self.booking = Booking.objects.create(
            marina=self.marina, vessel=self.vessel,
            check_in=date.today(), check_out=date.today() + timedelta(days=1),
            status='confirmed',
        )

    @patch('apps.ais.detect_events.notify_auto_checkin')
    def test_flips_confirmed_to_checked_in(self, mock_notify):
        on_basin_enter(self.position, recipient=self.user)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, 'checked_in')
        self.assertIsNotNone(self.booking.self_checked_in_at)
        mock_notify.assert_called_once()

    @patch('apps.ais.detect_events.notify_auto_checkin')
    def test_no_op_when_no_eligible_booking(self, mock_notify):
        self.booking.status = 'checked_in'
        self.booking.save(update_fields=['status'])
        on_basin_enter(self.position, recipient=self.user)
        mock_notify.assert_not_called()

    @patch('apps.ais.detect_events.notify_auto_checkin')
    def test_skips_when_multiple_matching_bookings(self, mock_notify):
        Booking.objects.create(
            marina=self.marina, vessel=self.vessel,
            check_in=date.today(), check_out=date.today() + timedelta(days=2),
            status='confirmed',
        )
        on_basin_enter(self.position, recipient=self.user)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, 'confirmed')
        mock_notify.assert_not_called()

    @patch('apps.ais.detect_events.notify_auto_checkin')
    def test_clears_no_show_flag_on_arrival(self, mock_notify):
        self.booking.ais_no_show_predicted = True
        self.booking.save(update_fields=['ais_no_show_predicted'])
        on_basin_enter(self.position, recipient=self.user)
        self.booking.refresh_from_db()
        self.assertFalse(self.booking.ais_no_show_predicted)


class BasinExitTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='M', lat=Decimal('52.0'), lng=Decimal('1.0'),
        )
        self.user = User.objects.create_user(email='owner@m', password='x', marina=self.marina)
        self.vessel = Vessel.objects.create(marina=self.marina, name='V1', mmsi='227111111')
        self.position = VesselPosition.objects.create(
            marina=self.marina, mmsi='227111111', vessel=self.vessel,
            lat=Decimal('60.0'), lng=Decimal('1.0'),
            reported_at=timezone.now(), in_basin=False,
        )
        self.booking = Booking.objects.create(
            marina=self.marina, vessel=self.vessel,
            check_in=date.today() - timedelta(days=1),
            check_out=date.today(),
            status='checked_in',
        )

    @patch('apps.ais.detect_events.notify_auto_checkout')
    def test_flips_checked_in_to_checked_out(self, mock_notify):
        on_basin_exit(self.position, recipient=self.user)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, 'checked_out')
        mock_notify.assert_called_once()
