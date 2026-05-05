import datetime
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.berths.models import Berth, Pier
from apps.billing.models import ChargeableItem


def make_marina(**kwargs):
    return Marina.objects.create(name='Test Marina', **kwargs)


def make_berth(marina, code, channel='direct'):
    pier, _ = Pier.objects.get_or_create(marina=marina, code='A', defaults={'label': 'A'})
    tier, _ = ChargeableItem.objects.get_or_create(
        marina=marina, name='Night', defaults={'category': 'berth', 'pricing_model': 'per_night', 'unit_price': 50}
    )
    return Berth.objects.create(
        marina=marina, pier=pier, code=code, pricing_tier=tier,
        status='available', sales_channel=channel
    )


class RunSmartAllocatorTest(TestCase):
    def setUp(self):
        self.marina = make_marina(auto_allocate_inventory=True, mysea_target_pct=20)
        # 10 berths all direct
        self.berths = [make_berth(self.marina, f'B{i}', channel='direct') for i in range(10)]

    def test_freed_berth_assigned_mysea_when_under_target(self):
        from apps.berths.allocator import run_smart_allocator
        # target=20% of 10 = 2 mysea. currently 0 mysea → freed berth should go to mysea
        freed = self.berths[0]
        run_smart_allocator(self.marina, freed)
        freed.refresh_from_db()
        self.assertEqual(freed.sales_channel, 'mysea')

    def test_freed_berth_stays_direct_when_at_target(self):
        from apps.berths.allocator import run_smart_allocator
        # Set 2 berths to mysea (20% of 10 = target met)
        self.berths[1].sales_channel = 'mysea'
        self.berths[1].save(update_fields=['sales_channel'])
        self.berths[2].sales_channel = 'mysea'
        self.berths[2].save(update_fields=['sales_channel'])
        freed = self.berths[0]
        run_smart_allocator(self.marina, freed)
        freed.refresh_from_db()
        self.assertEqual(freed.sales_channel, 'direct')

    def test_noop_when_auto_allocate_disabled(self):
        from apps.berths.allocator import run_smart_allocator
        self.marina.auto_allocate_inventory = False
        self.marina.save(update_fields=['auto_allocate_inventory'])
        freed = self.berths[0]
        run_smart_allocator(self.marina, freed)
        freed.refresh_from_db()
        self.assertEqual(freed.sales_channel, 'direct')  # unchanged

    def test_maintenance_berths_excluded_from_pool(self):
        from apps.berths.allocator import run_smart_allocator
        # 2 berths in maintenance → pool=8, target=20% of 8=2 mysea, current=0 → should allocate
        self.berths[8].status = 'maintenance'
        self.berths[8].save(update_fields=['status'])
        self.berths[9].status = 'maintenance'
        self.berths[9].save(update_fields=['status'])
        freed = self.berths[0]
        run_smart_allocator(self.marina, freed)
        freed.refresh_from_db()
        self.assertEqual(freed.sales_channel, 'mysea')

    def test_freed_mysea_berth_stays_mysea_when_at_target(self):
        from apps.berths.allocator import run_smart_allocator
        # Set exactly 2 berths to mysea (20% of 10 = 2 = target met).
        # One of them is freed (e.g. booking checked out). It should stay mysea,
        # not get flipped to direct — the freed berth itself must not be counted
        # in current_mysea when deciding its own destination.
        self.berths[1].sales_channel = 'mysea'
        self.berths[1].save(update_fields=['sales_channel'])
        freed = self.berths[2]
        freed.sales_channel = 'mysea'
        freed.save(update_fields=['sales_channel'])
        run_smart_allocator(self.marina, freed)
        freed.refresh_from_db()
        self.assertEqual(freed.sales_channel, 'mysea')


class RebalanceDownTest(TestCase):
    def setUp(self):
        self.marina = make_marina(auto_allocate_inventory=True, mysea_target_pct=10)
        # 10 berths, 5 already mysea (but target is only 10% = 1)
        self.direct = [make_berth(self.marina, f'D{i}', channel='direct') for i in range(5)]
        self.mysea = [make_berth(self.marina, f'M{i}', channel='mysea') for i in range(5)]

    def test_rebalance_flips_excess_unoccupied_mysea_to_direct(self):
        from apps.berths.allocator import rebalance_down
        rebalance_down(self.marina)
        mysea_count = Berth.objects.filter(marina=self.marina, sales_channel='mysea').count()
        self.assertEqual(mysea_count, 1)  # 10% of 10 = 1

    def test_rebalance_leaves_occupied_mysea_berths_alone(self):
        from apps.berths.allocator import rebalance_down
        from apps.reservations.models import Booking
        # Occupy 3 of the 5 mysea berths with active bookings
        for berth in self.mysea[:3]:
            Booking.objects.create(
                marina=self.marina, berth=berth,
                check_in=datetime.date(2030, 1, 1), check_out=datetime.date(2030, 1, 5),
                nights=4, status='checked_in',
            )
        rebalance_down(self.marina)
        # Target=1, but 3 are occupied → can only free 2 unoccupied ones → mysea still has 3
        mysea_count = Berth.objects.filter(marina=self.marina, sales_channel='mysea').count()
        self.assertEqual(mysea_count, 3)


class BerthCooldownTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = User.objects.create_user(
            email='staff@test.com', password='pass', marina=self.marina, role='manager'
        )
        self.berth = make_berth(self.marina, 'C1', channel='direct')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_channel_change_sets_cooldown(self):
        resp = self.client.patch(
            f'/api/v1/berths/{self.berth.pk}/',
            {'sales_channel': 'mysea'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.berth.refresh_from_db()
        self.assertEqual(self.berth.sales_channel, 'mysea')
        self.assertIsNotNone(self.berth.channel_cooldown_until)
        self.assertGreater(self.berth.channel_cooldown_until, timezone.now())

    def test_non_channel_update_does_not_set_cooldown(self):
        resp = self.client.patch(
            f'/api/v1/berths/{self.berth.pk}/',
            {'status': 'maintenance'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.berth.refresh_from_db()
        self.assertIsNone(self.berth.channel_cooldown_until)
