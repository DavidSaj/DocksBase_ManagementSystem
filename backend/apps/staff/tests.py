from datetime import date, timedelta
from io import BytesIO
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import Marina
from apps.staff.models import Certification, Shift, StaffMember

User = get_user_model()


def make_marina():
    return Marina.objects.create(name='Test Marina')


def make_user(marina, email='admin@marina.com', role='manager'):
    return User.objects.create_user(email=email, password='pass', marina=marina, role=role)


def make_staff(marina, name='John Doe'):
    return StaffMember.objects.create(marina=marina, name=name, role='Dockhand')


def make_cert(marina, staff, name='First Aid', days_until_expiry=60):
    expires = date.today() + timedelta(days=days_until_expiry)
    return Certification.objects.create(
        marina=marina, staff_member=staff, name=name, expires=expires
    )


class StaffInviteTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    @patch('apps.staff.views.send_mail')
    def test_invite_creates_user_and_staff(self, mock_mail):
        resp = self.client.post('/api/v1/staff/invite/', {
            'name': 'Jane Smith', 'email': 'jane@marina.com', 'role': 'staff',
        })
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(StaffMember.objects.filter(email='jane@marina.com').count(), 1)
        self.assertTrue(User.objects.filter(email='jane@marina.com').exists())

    @patch('apps.staff.views.send_mail')
    def test_invite_user_is_inactive(self, mock_mail):
        self.client.post('/api/v1/staff/invite/', {
            'name': 'Jane Smith', 'email': 'jane@marina.com', 'role': 'staff',
        })
        invited_user = User.objects.get(email='jane@marina.com')
        self.assertFalse(invited_user.is_active)

    @patch('apps.staff.views.send_mail')
    def test_invite_sends_email(self, mock_mail):
        self.client.post('/api/v1/staff/invite/', {
            'name': 'Jane Smith', 'email': 'jane@marina.com', 'role': 'staff',
        })
        self.assertTrue(mock_mail.called)
        call_kwargs = mock_mail.call_args
        self.assertIn('jane@marina.com', call_kwargs[1].get('recipient_list', []) or call_kwargs[0][3])

    @patch('apps.staff.views.send_mail')
    def test_invite_duplicate_email_returns_400(self, mock_mail):
        User.objects.create_user(email='taken@marina.com', password='x', marina=self.marina)
        resp = self.client.post('/api/v1/staff/invite/', {
            'name': 'Bob', 'email': 'taken@marina.com', 'role': 'staff',
        })
        self.assertEqual(resp.status_code, 400)


class StaffTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.other_marina = make_marina()
        self.user = make_user(self.marina)
        self.staff = make_staff(self.marina)
        make_staff(self.other_marina, name='Other Marina Staff')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_list_scoped_to_marina(self):
        resp = self.client.get('/api/v1/staff/')
        self.assertEqual(resp.status_code, 200)
        names = [s['name'] for s in (resp.data.get('results') or resp.data)]
        self.assertIn('John Doe', names)
        self.assertNotIn('Other Marina Staff', names)

    def test_patch_updates_fields(self):
        resp = self.client.patch(f'/api/v1/staff/{self.staff.id}/', {'phone': '555-1234'})
        self.assertEqual(resp.status_code, 200)
        self.staff.refresh_from_db()
        self.assertEqual(self.staff.phone, '555-1234')

    def test_deactivate_cascades_to_linked_user(self):
        linked_user = User.objects.create_user(email='linked@marina.com', password='x', marina=self.marina, is_active=True)
        self.staff.user = linked_user
        self.staff.save()
        resp = self.client.patch(f'/api/v1/staff/{self.staff.id}/', {'is_active': False})
        self.assertEqual(resp.status_code, 200)
        linked_user.refresh_from_db()
        self.assertFalse(linked_user.is_active)


class ShiftTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.staff = make_staff(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.week = '2026-04-28'

    def test_create_shift(self):
        resp = self.client.post('/api/v1/shifts/', {
            'staff_member': self.staff.id,
            'week_start': self.week,
            'day': 'mon',
            'start_time': '08:00:00',
            'end_time': '16:00:00',
            'department': 'Dock',
            'is_off': False,
        })
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(Shift.objects.filter(marina=self.marina).count(), 1)

    def test_create_off_day_no_times_required(self):
        resp = self.client.post('/api/v1/shifts/', {
            'staff_member': self.staff.id,
            'week_start': self.week,
            'day': 'tue',
            'is_off': True,
        })
        self.assertEqual(resp.status_code, 201)

    def test_create_non_off_day_requires_times(self):
        resp = self.client.post('/api/v1/shifts/', {
            'staff_member': self.staff.id,
            'week_start': self.week,
            'day': 'wed',
            'is_off': False,
        })
        self.assertEqual(resp.status_code, 400)

    def test_filter_by_week_start(self):
        Shift.objects.create(marina=self.marina, staff_member=self.staff, week_start='2026-04-28', day='mon', is_off=True)
        Shift.objects.create(marina=self.marina, staff_member=self.staff, week_start='2026-05-05', day='mon', is_off=True)
        resp = self.client.get('/api/v1/shifts/', {'week_start': '2026-04-28'})
        results = resp.data.get('results') or resp.data
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]['week_start'], '2026-04-28')

    def test_patch_updates_shift(self):
        shift = Shift.objects.create(marina=self.marina, staff_member=self.staff, week_start=self.week, day='fri', is_off=True)
        resp = self.client.patch(f'/api/v1/shifts/{shift.id}/', {'department': 'Fuel'})
        self.assertEqual(resp.status_code, 200)

    def test_delete_shift(self):
        shift = Shift.objects.create(marina=self.marina, staff_member=self.staff, week_start=self.week, day='sat', is_off=True)
        resp = self.client.delete(f'/api/v1/shifts/{shift.id}/')
        self.assertEqual(resp.status_code, 204)
        self.assertEqual(Shift.objects.count(), 0)


class CertificationTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.staff = make_staff(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_create_cert_without_pdf(self):
        resp = self.client.post('/api/v1/certifications/', {
            'staff_member': self.staff.id,
            'name': 'VHF Radio',
            'issuing_body': 'RYA',
            'issued': '2025-01-15',
            'expires': '2030-01-15',
        })
        self.assertEqual(resp.status_code, 201)
        self.assertIsNone(resp.data['pdf_file'])

    def test_create_cert_with_pdf(self):
        pdf = SimpleUploadedFile('cert.pdf', b'%PDF-fake', content_type='application/pdf')
        resp = self.client.post('/api/v1/certifications/', {
            'staff_member': self.staff.id,
            'name': 'First Aid',
            'pdf_file': pdf,
        }, format='multipart')
        self.assertEqual(resp.status_code, 201)
        self.assertIsNotNone(resp.data['pdf_file'])

    def test_get_scoped_to_marina(self):
        other_marina = make_marina()
        other_staff = make_staff(other_marina, name='Other')
        Certification.objects.create(marina=self.marina, staff_member=self.staff, name='Mine')
        Certification.objects.create(marina=other_marina, staff_member=other_staff, name='Theirs')
        resp = self.client.get('/api/v1/certifications/')
        names = [c['name'] for c in (resp.data.get('results') or resp.data)]
        self.assertIn('Mine', names)
        self.assertNotIn('Theirs', names)

    def test_status_defaults_to_valid(self):
        resp = self.client.post('/api/v1/certifications/', {
            'staff_member': self.staff.id,
            'name': 'CPR',
        })
        self.assertEqual(resp.data['status'], 'valid')

    def test_patch_cert_replaces_pdf(self):
        cert = Certification.objects.create(marina=self.marina, staff_member=self.staff, name='Old')
        new_pdf = SimpleUploadedFile('new.pdf', b'%PDF-new', content_type='application/pdf')
        resp = self.client.patch(f'/api/v1/certifications/{cert.id}/', {'pdf_file': new_pdf}, format='multipart')
        self.assertEqual(resp.status_code, 200)
        self.assertIsNotNone(resp.data['pdf_file'])


class CertExpiryCommandTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.staff = make_staff(self.marina)

    def test_command_marks_expired(self):
        cert = Certification.objects.create(
            marina=self.marina, staff_member=self.staff, name='Expired Cert',
            expires=date.today() - timedelta(days=1), status='valid',
        )
        from django.core.management import call_command
        call_command('check_document_expiry', verbosity=0)
        cert.refresh_from_db()
        self.assertEqual(cert.status, 'expired')

    def test_command_marks_due_soon(self):
        cert = Certification.objects.create(
            marina=self.marina, staff_member=self.staff, name='Due Soon Cert',
            expires=date.today() + timedelta(days=15), status='valid',
        )
        from django.core.management import call_command
        call_command('check_document_expiry', verbosity=0)
        cert.refresh_from_db()
        self.assertEqual(cert.status, 'due_soon')

    def test_command_leaves_valid_alone(self):
        cert = Certification.objects.create(
            marina=self.marina, staff_member=self.staff, name='Valid Cert',
            expires=date.today() + timedelta(days=60), status='valid',
        )
        from django.core.management import call_command
        call_command('check_document_expiry', verbosity=0)
        cert.refresh_from_db()
        self.assertEqual(cert.status, 'valid')
