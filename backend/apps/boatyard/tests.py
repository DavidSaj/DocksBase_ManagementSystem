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
            scheduled_at='2026-05-01 09:00:00', notes='Bring extra crew'
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
            scheduled_at='2026-05-01 09:00:00'
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
