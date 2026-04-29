from django.test import TestCase
from django.contrib.auth import get_user_model
from django.db import IntegrityError
from apps.accounts.models import Marina
from apps.vessels.models import Vessel
from apps.boatyard.models import HaulOut, WorkOrder, Part, Tool, StorageSlot, LaunchRequest, Contractor
from apps.maintenance.models import Asset

User = get_user_model()


def make_marina():
    return Marina.objects.create(name='Test Marina')


def make_vessel(marina):
    return Vessel.objects.create(marina=marina, name='Test Vessel')


def make_user(marina, email='mgr@example.com'):
    return User.objects.create_user(email=email, password='pass', marina=marina)


class ModelEnrichmentTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.vessel = make_vessel(self.marina)

    def test_haul_out_notes_field(self):
        ho = HaulOut.objects.create(
            marina=self.marina, vessel=self.vessel,
            scheduled_at='2026-05-01T09:00:00Z', notes='Bring extra crew'
        )
        self.assertEqual(HaulOut.objects.get(pk=ho.pk).notes, 'Bring extra crew')

    def test_work_order_notes_field(self):
        wo = WorkOrder.objects.create(
            marina=self.marina, title='Fix engine', notes='Urgent repair'
        )
        self.assertEqual(WorkOrder.objects.get(pk=wo.pk).notes, 'Urgent repair')

    def test_tool_serial_and_location(self):
        t = Tool.objects.create(
            marina=self.marina, name='Torque Wrench',
            serial='TW-001', location='Bay A Shelf 2'
        )
        self.assertEqual(Tool.objects.get(pk=t.pk).serial, 'TW-001')
        self.assertEqual(Tool.objects.get(pk=t.pk).location, 'Bay A Shelf 2')

    def test_asset_notes_field(self):
        a = Asset.objects.create(marina=self.marina, name='Travelift A', notes='50T crane')
        self.assertEqual(Asset.objects.get(pk=a.pk).notes, '50T crane')


class StorageSlotTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.vessel = make_vessel(self.marina)

    def test_creates_with_tier(self):
        slot = StorageSlot.objects.create(
            marina=self.marina, lane='Lane 1', col='A', tier=1
        )
        self.assertEqual(slot.tier, 1)
        self.assertEqual(str(slot), 'Lane 1-A-T1')

    def test_unique_together_enforced(self):
        StorageSlot.objects.create(marina=self.marina, lane='Lane 1', col='A', tier=1)
        with self.assertRaises(IntegrityError):
            StorageSlot.objects.create(marina=self.marina, lane='Lane 1', col='A', tier=1)

    def test_different_tiers_same_lane_col_allowed(self):
        StorageSlot.objects.create(marina=self.marina, lane='Lane 1', col='A', tier=1)
        slot2 = StorageSlot.objects.create(marina=self.marina, lane='Lane 1', col='A', tier=2)
        self.assertEqual(slot2.tier, 2)

    def test_assign_vessel(self):
        slot = StorageSlot.objects.create(marina=self.marina, lane='Lane 1', col='A', tier=1)
        slot.vessel = self.vessel
        slot.save()
        self.assertEqual(StorageSlot.objects.get(pk=slot.pk).vessel, self.vessel)

    def test_cross_marina_vessel_rejected(self):
        other_marina = Marina.objects.create(name='Other Marina')
        other_vessel = Vessel.objects.create(marina=other_marina, name='Foreign Vessel')
        slot = StorageSlot(marina=self.marina, lane='Lane 2', col='A', tier=1, vessel=other_vessel)
        from django.core.exceptions import ValidationError
        with self.assertRaises(ValidationError):
            slot.full_clean()


class LaunchRequestTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.vessel = make_vessel(self.marina)

    def test_creates(self):
        lr = LaunchRequest.objects.create(
            marina=self.marina, vessel=self.vessel, status='pending'
        )
        self.assertEqual(lr.status, 'pending')

    def test_vessel_protect(self):
        LaunchRequest.objects.create(marina=self.marina, vessel=self.vessel)
        from django.db.models import ProtectedError
        with self.assertRaises(ProtectedError):
            self.vessel.delete()


from apps.boatyard.serializers import (
    HaulOutSerializer, StorageSlotSerializer, LaunchRequestSerializer,
    WorkOrderSerializer, PartSerializer, ToolSerializer, ContractorSerializer,
)


class SerializerTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.vessel = make_vessel(self.marina)

    def test_haul_out_serializer_has_vessel_name(self):
        ho = HaulOut.objects.create(
            marina=self.marina, vessel=self.vessel,
            scheduled_at='2026-05-01T09:00:00Z'
        )
        data = HaulOutSerializer(ho).data
        self.assertIn('vessel_name', data)
        self.assertEqual(data['vessel_name'], 'Test Vessel')

    def test_storage_slot_serializer_has_tier(self):
        slot = StorageSlot.objects.create(
            marina=self.marina, lane='Lane 1', col='A', tier=2
        )
        data = StorageSlotSerializer(slot).data
        self.assertIn('tier', data)
        self.assertEqual(data['tier'], 2)

    def test_launch_request_serializer_has_slot_label(self):
        slot = StorageSlot.objects.create(marina=self.marina, lane='Lane 1', col='B', tier=1)
        lr = LaunchRequest.objects.create(
            marina=self.marina, vessel=self.vessel, slot=slot
        )
        data = LaunchRequestSerializer(lr).data
        self.assertIn('slot_label', data)
        self.assertEqual(data['slot_label'], 'Lane 1-B-T1')

    def test_work_order_serializer_fields(self):
        wo = WorkOrder.objects.create(marina=self.marina, title='Fix engine')
        data = WorkOrderSerializer(wo).data
        self.assertIn('notes', data)
        self.assertIn('priority', data)

    def test_part_serializer_fields(self):
        p = Part.objects.create(marina=self.marina, name='Shackle', stock=10, par=5)
        data = PartSerializer(p).data
        self.assertIn('stock', data)
        self.assertIn('par', data)

    def test_tool_serializer_has_serial_location(self):
        t = Tool.objects.create(
            marina=self.marina, name='Multimeter',
            serial='MM-42', location='Tool Room'
        )
        data = ToolSerializer(t).data
        self.assertEqual(data['serial'], 'MM-42')
        self.assertEqual(data['location'], 'Tool Room')

    def test_contractor_serializer_fields(self):
        c = Contractor.objects.create(
            marina=self.marina, name='Hughes Marine',
            trade='Mechanics', access_start='2026-05-01'
        )
        data = ContractorSerializer(c).data
        self.assertIn('trade', data)
        self.assertIn('access_end', data)


from rest_framework.test import APIClient


class HaulOutViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.vessel = make_vessel(self.marina)
        self.user = make_user(self.marina, 'haul@example.com')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_list_scoped_to_marina(self):
        HaulOut.objects.create(marina=self.marina, vessel=self.vessel, scheduled_at='2026-05-01T09:00:00Z')
        other = Marina.objects.create(name='Other')
        other_vessel = Vessel.objects.create(marina=other, name='Other Vessel')
        HaulOut.objects.create(marina=other, vessel=other_vessel, scheduled_at='2026-05-01T09:00:00Z')
        resp = self.client.get('/api/v1/haul-outs/')
        self.assertEqual(resp.status_code, 200)
        data = resp.data.get('results', resp.data)
        self.assertEqual(len(data), 1)

    def test_patch_status(self):
        ho = HaulOut.objects.create(marina=self.marina, vessel=self.vessel, scheduled_at='2026-05-01T09:00:00Z')
        resp = self.client.patch(f'/api/v1/haul-outs/{ho.pk}/', {'status': 'completed'}, format='json')
        self.assertEqual(resp.status_code, 200)
        ho.refresh_from_db()
        self.assertEqual(ho.status, 'completed')


class StorageSlotViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.vessel = make_vessel(self.marina)
        self.user = make_user(self.marina, 'slot@example.com')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_create_slot(self):
        resp = self.client.post('/api/v1/storage-slots/', {
            'lane': 'Lane 1', 'col': 'A', 'tier': 1
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['tier'], 1)

    def test_assign_vessel(self):
        slot = StorageSlot.objects.create(marina=self.marina, lane='Lane 1', col='A', tier=1)
        resp = self.client.patch(f'/api/v1/storage-slots/{slot.pk}/', {'vessel': self.vessel.pk}, format='json')
        self.assertEqual(resp.status_code, 200)
        slot.refresh_from_db()
        self.assertEqual(slot.vessel, self.vessel)

    def test_clear_vessel(self):
        slot = StorageSlot.objects.create(marina=self.marina, lane='Lane 1', col='A', tier=1, vessel=self.vessel)
        resp = self.client.patch(f'/api/v1/storage-slots/{slot.pk}/', {'vessel': None}, format='json')
        self.assertEqual(resp.status_code, 200)
        slot.refresh_from_db()
        self.assertIsNone(slot.vessel)


class LaunchRequestViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.vessel = make_vessel(self.marina)
        self.user = make_user(self.marina, 'launch@example.com')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_create(self):
        resp = self.client.post('/api/v1/launch-requests/', {
            'vessel': self.vessel.pk, 'equipment': 'Forklift'
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['status'], 'pending')

    def test_status_transitions(self):
        lr = LaunchRequest.objects.create(marina=self.marina, vessel=self.vessel)
        for status in ['scheduled', 'launching', 'retrieved']:
            resp = self.client.patch(f'/api/v1/launch-requests/{lr.pk}/', {'status': status}, format='json')
            self.assertEqual(resp.status_code, 200)
        lr.refresh_from_db()
        self.assertEqual(lr.status, 'retrieved')


class WorkOrderViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina, 'wo@example.com')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_create(self):
        resp = self.client.post('/api/v1/work-orders/', {
            'title': 'Engine overhaul', 'priority': 'high'
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['status'], 'pending_auth')

    def test_authorise(self):
        wo = WorkOrder.objects.create(marina=self.marina, title='Fix keel')
        resp = self.client.patch(f'/api/v1/work-orders/{wo.pk}/', {'status': 'authorised'}, format='json')
        self.assertEqual(resp.status_code, 200)
        wo.refresh_from_db()
        self.assertEqual(wo.status, 'authorised')

    def test_list_scoped(self):
        WorkOrder.objects.create(marina=self.marina, title='WO A')
        other = Marina.objects.create(name='Other2')
        WorkOrder.objects.create(marina=other, title='WO B')
        resp = self.client.get('/api/v1/work-orders/')
        data = resp.data.get('results', resp.data)
        self.assertEqual(len(data), 1)


class PartViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina, 'parts@example.com')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_create(self):
        resp = self.client.post('/api/v1/parts/', {
            'name': 'Anchor Shackle', 'stock': 12, 'par': 5
        }, format='json')
        self.assertEqual(resp.status_code, 201)

    def test_list_scoped(self):
        Part.objects.create(marina=self.marina, name='Shackle')
        other = Marina.objects.create(name='Other3')
        Part.objects.create(marina=other, name='Other Shackle')
        resp = self.client.get('/api/v1/parts/')
        data = resp.data.get('results', resp.data)
        self.assertEqual(len(data), 1)


class ToolViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina, 'tools@example.com')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_create_with_serial(self):
        resp = self.client.post('/api/v1/tools/', {
            'name': 'Torque Wrench', 'serial': 'TW-99', 'location': 'Bay A'
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['serial'], 'TW-99')

    def test_check_out(self):
        tool = Tool.objects.create(marina=self.marina, name='Drill')
        resp = self.client.patch(f'/api/v1/tools/{tool.pk}/', {
            'status': 'checked_out', 'checked_out_to': 'J. Smith'
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        tool.refresh_from_db()
        self.assertEqual(tool.checked_out_to, 'J. Smith')

    def test_return_clears_checked_out_to(self):
        tool = Tool.objects.create(
            marina=self.marina, name='Drill',
            status='checked_out', checked_out_to='J. Smith'
        )
        resp = self.client.patch(f'/api/v1/tools/{tool.pk}/', {
            'status': 'available', 'checked_out_to': ''
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        tool.refresh_from_db()
        self.assertEqual(tool.checked_out_to, '')


class ContractorViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina, 'contractors@example.com')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_create(self):
        resp = self.client.post('/api/v1/contractors/', {
            'name': 'Hughes Marine', 'trade': 'Mechanics',
            'access_start': '2026-05-01'
        }, format='json')
        self.assertEqual(resp.status_code, 201)

    def test_delete(self):
        c = Contractor.objects.create(
            marina=self.marina, name='Hughes Marine', access_start='2026-05-01'
        )
        resp = self.client.delete(f'/api/v1/contractors/{c.pk}/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Contractor.objects.filter(pk=c.pk).exists())

    def test_list_scoped(self):
        Contractor.objects.create(marina=self.marina, name='Contractor A', access_start='2026-05-01')
        other = Marina.objects.create(name='Other4')
        Contractor.objects.create(marina=other, name='Contractor B', access_start='2026-05-01')
        resp = self.client.get('/api/v1/contractors/')
        data = resp.data.get('results', resp.data)
        self.assertEqual(len(data), 1)
