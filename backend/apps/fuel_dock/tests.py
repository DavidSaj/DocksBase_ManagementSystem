from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.berths.models import Pier, Berth
from apps.members.models import Member
from apps.vessels.models import Vessel
from apps.billing.models import Invoice
from .models import FuelDockEntry


def make_marina():
    return Marina.objects.create(name='Test Marina')


def make_user(marina):
    return User.objects.create_user(email='staff@test.com', password='pass', marina=marina)


class FuelDockBillingTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user   = make_user(self.marina)
        self.member = Member.objects.create(marina=self.marina, name='L. Nakamura', phone='+353 87 100 0000')
        self.vessel = Vessel.objects.create(marina=self.marina, name='Ocean Star', owner=self.member)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _create_entry(self, **kwargs):
        defaults = dict(marina=self.marina, fuel_type='diesel', status='service', fuel_berth='FD-1')
        defaults.update(kwargs)
        return FuelDockEntry.objects.create(**defaults)

    def test_member_completion_creates_fuel_invoice(self):
        entry = self._create_entry(vessel=self.vessel, member=self.member)
        resp = self.client.patch(f'/api/v1/fuel-dock/queue/{entry.id}/', {
            'status':          'completed',
            'actual_litres':   '100.00',
            'price_per_litre': '1.95',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        entry.refresh_from_db()
        self.assertEqual(entry.status, 'completed')
        self.assertAlmostEqual(float(entry.total_amount), 195.0)
        self.assertIsNotNone(entry.invoice)
        self.assertEqual(entry.invoice.source_type, 'fuel_dock')
        self.assertAlmostEqual(float(entry.invoice.total), 195.0)
        self.assertFalse(entry.pos_paid)

    def test_stranger_completion_sets_pos_paid_no_invoice(self):
        entry = self._create_entry(guest_description='White Sailboat', guest_phone='+353 87 999 0000')
        resp = self.client.patch(f'/api/v1/fuel-dock/queue/{entry.id}/', {
            'status':          'completed',
            'actual_litres':   '50.00',
            'price_per_litre': '2.10',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        entry.refresh_from_db()
        self.assertTrue(entry.pos_paid)
        self.assertIsNone(entry.invoice)

    def test_invalid_status_transition_rejected(self):
        entry = self._create_entry(guest_description='Mystery Boat', status='waiting')
        resp = self.client.patch(f'/api/v1/fuel-dock/queue/{entry.id}/', {
            'status': 'completed',
        }, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_state_machine_advances_in_order(self):
        entry = self._create_entry(guest_description='Test Boat', status='waiting')
        for expected_status in ['next', 'service', 'completed']:
            patch_data = {'status': expected_status}
            if expected_status == 'completed':
                patch_data['actual_litres']   = '20.00'
                patch_data['price_per_litre'] = '1.80'
            resp = self.client.patch(f'/api/v1/fuel-dock/queue/{entry.id}/', patch_data, format='json')
            self.assertEqual(resp.status_code, 200, f'Failed advancing to {expected_status}')
            entry.refresh_from_db()
            self.assertEqual(entry.status, expected_status)


class FuelDockQuickSaleTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user   = make_user(self.marina)
        self.member = Member.objects.create(marina=self.marina, name='T. Berg', phone='+353 87 200 0000')
        self.vessel = Vessel.objects.create(marina=self.marina, name='Sea Whisper', owner=self.member)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_quicksale_guest_sets_pos_paid(self):
        resp = self.client.post('/api/v1/fuel-dock/queue/', {
            'status':          'completed',
            'fuel_type':       'diesel',
            'actual_litres':   '30.00',
            'price_per_litre': '1.42',
            'guest_description': 'Red sloop',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        entry = FuelDockEntry.objects.get(pk=resp.data['id'])
        self.assertEqual(entry.status, 'completed')
        self.assertAlmostEqual(float(entry.total_amount), 42.6)
        self.assertTrue(entry.pos_paid)
        self.assertIsNone(entry.invoice)
        self.assertIsNotNone(entry.completed_at)

    def test_quicksale_member_creates_invoice(self):
        resp = self.client.post('/api/v1/fuel-dock/queue/', {
            'status':          'completed',
            'fuel_type':       'petrol',
            'actual_litres':   '20.00',
            'price_per_litre': '1.55',
            'member':          self.member.id,
            'vessel':          self.vessel.id,
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        entry = FuelDockEntry.objects.get(pk=resp.data['id'])
        self.assertEqual(entry.status, 'completed')
        self.assertAlmostEqual(float(entry.total_amount), 31.0)
        self.assertFalse(entry.pos_paid)
        self.assertIsNotNone(entry.invoice)
        self.assertEqual(entry.invoice.source_type, 'fuel_dock')
