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
