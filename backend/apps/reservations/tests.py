import datetime
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.berths.models import Pier, Berth
from apps.members.models import Member
from apps.vessels.models import Vessel
from .models import Booking, BookingRequest


def make_marina():
    return Marina.objects.create(name='Test Marina')


def make_user(marina):
    return User.objects.create_user(email='staff@test.com', password='pass', marina=marina, role='manager')


def make_berth(marina, price=50):
    pier = Pier.objects.create(marina=marina, code='A', label='Pier A')
    return Berth.objects.create(
        marina=marina, pier=pier, code='A1', price_per_night=price, status='available'
    )


class BookingAmountAutoCalcTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user   = make_user(self.marina)
        self.berth  = make_berth(self.marina, price=50)
        self.member = Member.objects.create(marina=self.marina, name='A. Smith')
        self.vessel = Vessel.objects.create(marina=self.marina, name='Blue Wave', owner=self.member)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_amount_and_nights_calculated_on_create(self):
        resp = self.client.post('/api/v1/bookings/', {
            'berth':        self.berth.id,
            'vessel':       self.vessel.id,
            'booking_type': 'transient',
            'check_in':     '2026-06-01',
            'check_out':    '2026-06-04',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data['nights'], 3)
        self.assertEqual(float(data['amount']), 150.0)


class BookingRequestConvertTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user   = make_user(self.marina)
        self.berth  = make_berth(self.marina, price=50)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_convert_stranger_creates_member_vessel_booking(self):
        req = BookingRequest.objects.create(
            marina=self.marina,
            berth=self.berth,
            booking_type='transient',
            start_date=datetime.date(2026, 6, 1),
            end_date=datetime.date(2026, 6, 3),
            guest_name='J. Doe',
            guest_phone='+353 87 100 0000',
            guest_email='j@example.com',
            guest_vessel='Blue Horizon',
            guest_loa=12,
        )
        resp = self.client.post(f'/api/v1/booking-requests/{req.id}/convert/')
        self.assertEqual(resp.status_code, 200)
        req.refresh_from_db()
        self.assertEqual(req.status, 'approved')
        self.assertIsNotNone(req.booking)
        self.assertIsNotNone(req.member)
        self.assertIsNotNone(req.vessel)
        self.assertEqual(req.booking.nights, 2)
        self.assertEqual(float(req.booking.amount), 100.0)
        self.assertEqual(req.member.name, 'J. Doe')
        self.assertEqual(req.vessel.name, 'Blue Horizon')

    def test_convert_is_idempotent(self):
        req = BookingRequest.objects.create(
            marina=self.marina,
            berth=self.berth,
            booking_type='transient',
            start_date=datetime.date(2026, 6, 1),
            end_date=datetime.date(2026, 6, 2),
            guest_name='K. Oduya',
            guest_vessel='Pelican',
        )
        resp1 = self.client.post(f'/api/v1/booking-requests/{req.id}/convert/')
        resp2 = self.client.post(f'/api/v1/booking-requests/{req.id}/convert/')
        self.assertEqual(resp1.status_code, 200)
        self.assertEqual(resp2.status_code, 200)
        self.assertEqual(resp1.json()['id'], resp2.json()['id'])
        self.assertEqual(Booking.objects.filter(marina=self.marina).count(), 1)

    def test_convert_relational_request_skips_profile_creation(self):
        member = Member.objects.create(marina=self.marina, name='G. Ferreira')
        vessel = Vessel.objects.create(marina=self.marina, name='Sunrise II', owner=member)
        req = BookingRequest.objects.create(
            marina=self.marina,
            berth=self.berth,
            booking_type='seasonal',
            start_date=datetime.date(2026, 6, 1),
            end_date=datetime.date(2026, 6, 8),
            member=member,
            vessel=vessel,
        )
        resp = self.client.post(f'/api/v1/booking-requests/{req.id}/convert/')
        self.assertEqual(resp.status_code, 200)
        req.refresh_from_db()
        self.assertEqual(req.member, member)
        self.assertEqual(req.vessel, vessel)
