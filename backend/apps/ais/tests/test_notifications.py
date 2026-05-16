from datetime import date, timedelta
from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone

from apps.accounts.models import Marina, User
from apps.ais.models import AISNotificationSent
from apps.ais.notifications import (
    on_duty_harbourmaster,
    notify_auto_checkin,
    notify_no_show,
)
from apps.notifications.models import Notification
from apps.reservations.models import Booking
from apps.staff.models import Shift, StaffMember
from apps.vessels.models import Vessel


WEEKDAY = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']


def _today_dow():
    return WEEKDAY[timezone.now().weekday()]


def _monday():
    today = timezone.now().date()
    return today - timedelta(days=today.weekday())


class OnDutyHarbourmasterTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='M', lat=Decimal('52.0'), lng=Decimal('1.0'),
        )

    def test_returns_harbourmaster_with_phone_on_active_shift(self):
        hm = StaffMember.objects.create(
            marina=self.marina, name='Harbour Bob', role='Harbourmaster', phone='+44700000001',
        )
        Shift.objects.create(
            marina=self.marina, staff_member=hm,
            week_start=_monday(), day=_today_dow(), is_off=False,
        )
        self.assertEqual(on_duty_harbourmaster(self.marina), hm)

    def test_returns_none_when_no_shift_today(self):
        self.assertIsNone(on_duty_harbourmaster(self.marina))

    def test_skips_staff_without_phone(self):
        hm = StaffMember.objects.create(
            marina=self.marina, name='Phoneless', role='Harbourmaster', phone='',
        )
        Shift.objects.create(
            marina=self.marina, staff_member=hm,
            week_start=_monday(), day=_today_dow(), is_off=False,
        )
        self.assertIsNone(on_duty_harbourmaster(self.marina))


class NotifyAutoCheckinTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='M', lat=Decimal('52.0'), lng=Decimal('1.0'),
        )
        self.user = User.objects.create_user(email='owner@m', marina=self.marina)
        self.vessel = Vessel.objects.create(marina=self.marina, name='Wanderer', mmsi='227111111')
        self.booking = Booking.objects.create(
            marina=self.marina, vessel=self.vessel,
            check_in=date.today(), check_out=date.today() + timedelta(days=1),
            status='checked_in',
        )

    @patch('apps.ais.notifications.notify_sms')
    def test_writes_in_app_and_sms_once(self, mock_sms):
        hm = StaffMember.objects.create(
            marina=self.marina, name='HM', role='Harbourmaster', phone='+44700000001',
        )
        Shift.objects.create(
            marina=self.marina, staff_member=hm,
            week_start=_monday(), day=_today_dow(), is_off=False,
        )
        notify_auto_checkin(self.booking, recipient=self.user)
        notify_auto_checkin(self.booking, recipient=self.user)  # idempotent SMS
        self.assertEqual(Notification.objects.filter(kind='ais_auto_checkin').count(), 2)
        self.assertEqual(mock_sms.call_count, 1)
        self.assertEqual(AISNotificationSent.objects.count(), 1)

    @patch('apps.ais.notifications.notify_sms')
    def test_no_harbourmaster_logs_warning_no_sms(self, mock_sms):
        notify_auto_checkin(self.booking, recipient=self.user)
        self.assertEqual(mock_sms.call_count, 0)
        self.assertEqual(Notification.objects.filter(kind='ais_auto_checkin').count(), 1)


class NotifyNoShowTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='M', lat=Decimal('52.0'), lng=Decimal('1.0'),
        )
        self.user = User.objects.create_user(email='owner@m', marina=self.marina)
        self.vessel = Vessel.objects.create(marina=self.marina, name='Wanderer', mmsi='227111111')
        self.booking = Booking.objects.create(
            marina=self.marina, vessel=self.vessel,
            check_in=date.today(), check_out=date.today() + timedelta(days=1),
            status='confirmed',
        )

    @patch('apps.ais.notifications.notify_sms')
    def test_no_show_is_in_app_only(self, mock_sms):
        notify_no_show(self.booking, recipient=self.user)
        self.assertEqual(mock_sms.call_count, 0)
        self.assertEqual(Notification.objects.filter(kind='ais_no_show_predicted').count(), 1)
