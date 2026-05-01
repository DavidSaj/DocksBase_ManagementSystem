import datetime
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.members.models import Member
from apps.vessels.models import Vessel
from apps.reservations.models import Booking
from apps.berths.models import Pier, Berth
from .models import CraneRequest


def make_marina():
    return Marina.objects.create(name='Test Marina', contact_email='marina@test.com')

def make_staff(marina):
    return User.objects.create_user(email='staff@test.com', password='pass', marina=marina, role='staff')

def make_member(marina):
    return Member.objects.create(marina=marina, name='J. Sailor', email='j@sailor.com')

def make_boater(marina, member):
    user = User.objects.create_user(email='boater@test.com', password='pass', marina=marina, role='boater')
    member.boater_user = user
    member.save()
    return user


class CraneStaffListTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.staff  = make_staff(self.marina)
        self.member = make_member(self.marina)
        CraneRequest.objects.create(member=self.member, service_type='haul_out', requested_date='2026-06-01', status='requested')
        CraneRequest.objects.create(member=self.member, service_type='launch',   requested_date='2026-06-02', status='approved')
        self.client = APIClient()
        self.client.force_authenticate(user=self.staff)

    def test_staff_can_list_all_crane_requests(self):
        resp = self.client.get('/api/v1/portal/crane-requests/staff/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 2)

    def test_staff_can_filter_by_status(self):
        resp = self.client.get('/api/v1/portal/crane-requests/staff/?status=requested')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 1)

    def test_staff_can_approve(self):
        req = CraneRequest.objects.filter(status='requested').first()
        resp = self.client.patch(f'/api/v1/portal/crane-requests/{req.id}/staff-update/', {'status': 'approved'}, format='json')
        self.assertEqual(resp.status_code, 200)
        req.refresh_from_db()
        self.assertEqual(req.status, 'approved')

    def test_staff_can_reject(self):
        req = CraneRequest.objects.filter(status='requested').first()
        resp = self.client.patch(f'/api/v1/portal/crane-requests/{req.id}/staff-update/', {'status': 'rejected'}, format='json')
        self.assertEqual(resp.status_code, 200)
        req.refresh_from_db()
        self.assertEqual(req.status, 'rejected')

    def test_boater_cannot_access_staff_list(self):
        boater = User.objects.create_user(email='boater@test.com', password='pass', marina=self.marina, role='boater')
        self.client.force_authenticate(user=boater)
        resp = self.client.get('/api/v1/portal/crane-requests/staff/')
        self.assertEqual(resp.status_code, 403)

    def test_staff_from_other_marina_sees_nothing(self):
        other_marina = Marina.objects.create(name='Other Marina')
        other_staff = User.objects.create_user(email='other@test.com', password='pass', marina=other_marina, role='staff')
        self.client.force_authenticate(user=other_staff)
        resp = self.client.get('/api/v1/portal/crane-requests/staff/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 0)


class PortalBerthTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)
        self.boater = make_boater(self.marina, self.member)
        self.vessel = Vessel.objects.create(marina=self.marina, name='Blue Wave', owner=self.member)
        pier = Pier.objects.create(marina=self.marina, code='A', label='Pier A')
        berth = Berth.objects.create(marina=self.marina, pier=pier, code='A1', status='available')
        self.booking = Booking.objects.create(
            marina=self.marina, berth=berth, vessel=self.vessel,
            booking_type='transient', check_in='2026-06-01', check_out='2026-06-07',
            nights=6, status='checked_in',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.boater)

    def test_boater_sees_active_booking(self):
        resp = self.client.get('/api/v1/portal/berth/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['berth_code'], 'A1')
        self.assertEqual(data[0]['pier_label'], 'Pier A')
        self.assertEqual(data[0]['status'], 'checked_in')

    def test_boater_sees_empty_when_no_bookings(self):
        self.booking.delete()
        resp = self.client.get('/api/v1/portal/berth/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json(), [])

    def test_staff_cannot_access_berth_portal(self):
        staff = make_staff(self.marina)
        self.client.force_authenticate(user=staff)
        resp = self.client.get('/api/v1/portal/berth/')
        self.assertEqual(resp.status_code, 403)
