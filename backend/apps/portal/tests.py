import datetime
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.members.models import Member
from apps.vessels.models import Vessel, VesselCertificate
from apps.reservations.models import Booking
from apps.berths.models import Pier, Berth
from .models import CraneRequest


def make_marina():
    return Marina.objects.create(name='Test Marina', contact_email='marina@test.com')

def make_staff(marina):
    return User.objects.create_user(email='staff@test.com', password='pass', marina=marina, role='staff')

def make_member(marina):
    return Member.objects.create(marina=marina, name='J. Sailor', email='j@sailor.com')


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
