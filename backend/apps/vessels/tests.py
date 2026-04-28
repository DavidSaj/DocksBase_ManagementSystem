from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.members.models import Member
from .models import Vessel, InsuranceRecord, SafetyEquipment, VesselCertificate


def make_marina():
    return Marina.objects.create(name='Test Marina')


def make_user(marina):
    return User.objects.create_user(
        email='staff@test.com', password='pass', marina=marina, role='manager'
    )


def make_vessel(marina, member=None):
    return Vessel.objects.create(marina=marina, name='Blue Wave', owner=member)


class VesselCRUDTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.member = Member.objects.create(marina=self.marina, name='Alice')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_create_vessel(self):
        resp = self.client.post('/api/v1/vessels/', {
            'name': 'Sunrise',
            'vessel_type': 'sail',
            'loa': '11.5',
            'owner': self.member.id,
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['name'], 'Sunrise')

    def test_list_scoped_to_marina(self):
        other = Marina.objects.create(name='Other Marina')
        Vessel.objects.create(marina=other, name='Outsider')
        Vessel.objects.create(marina=self.marina, name='Insider')
        resp = self.client.get('/api/v1/vessels/')
        data = resp.json().get('results', resp.json())
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['name'], 'Insider')

    def test_update_vessel(self):
        v = make_vessel(self.marina)
        resp = self.client.patch(f'/api/v1/vessels/{v.id}/', {'beam': '3.5'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(float(resp.json()['beam']), 3.5)


class VesselInsuranceTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.vessel = make_vessel(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_get_auto_creates_record(self):
        self.assertFalse(InsuranceRecord.objects.filter(vessel=self.vessel).exists())
        resp = self.client.get(f'/api/v1/vessels/{self.vessel.id}/insurance/')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(InsuranceRecord.objects.filter(vessel=self.vessel).exists())

    def test_put_updates_fields(self):
        resp = self.client.put(f'/api/v1/vessels/{self.vessel.id}/insurance/', {
            'insurer': 'Allianz Marine',
            'policy_no': 'POL-001',
            'expires': '2027-01-01',
            'status': 'valid',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['insurer'], 'Allianz Marine')


class VesselSafetyTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.vessel = make_vessel(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_get_auto_creates_record(self):
        self.assertFalse(SafetyEquipment.objects.filter(vessel=self.vessel).exists())
        resp = self.client.get(f'/api/v1/vessels/{self.vessel.id}/safety/')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(SafetyEquipment.objects.filter(vessel=self.vessel).exists())

    def test_put_updates_fields(self):
        resp = self.client.put(f'/api/v1/vessels/{self.vessel.id}/safety/', {
            'flares_exp': '2026-12-31',
            'life_raft_exp': '2027-06-01',
            'epirb_exp': '2027-01-01',
            'extinguisher_exp': '2026-09-01',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['flares_exp'], '2026-12-31')


class VesselCertificateTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.vessel = make_vessel(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_create_cert(self):
        resp = self.client.post(f'/api/v1/vessels/{self.vessel.id}/certificates/', {
            'cert_type': 'ssr',
            'name': 'Small Ships Register',
            'expires': '2028-03-01',
            'status': 'valid',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['cert_type'], 'ssr')

    def test_list_scoped_to_vessel(self):
        other = Vessel.objects.create(marina=self.marina, name='Other Vessel')
        VesselCertificate.objects.create(
            marina=self.marina, vessel=other,
            cert_type='registration', name='Reg', status='valid',
        )
        VesselCertificate.objects.create(
            marina=self.marina, vessel=self.vessel,
            cert_type='ssr', name='SSR', status='valid',
        )
        resp = self.client.get(f'/api/v1/vessels/{self.vessel.id}/certificates/')
        data = resp.json().get('results', resp.json())
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['cert_type'], 'ssr')

    def test_update_cert(self):
        cert = VesselCertificate.objects.create(
            marina=self.marina, vessel=self.vessel,
            cert_type='ssr', name='SSR', status='valid',
        )
        resp = self.client.put(
            f'/api/v1/vessels/{self.vessel.id}/certificates/{cert.id}/',
            {'cert_type': 'ssr', 'name': 'SSR Updated', 'status': 'due_soon'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['status'], 'due_soon')
