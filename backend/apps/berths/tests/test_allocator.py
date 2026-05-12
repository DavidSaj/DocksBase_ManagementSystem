import datetime
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.berths.models import Berth, Pier, OTAConnection
from apps.billing.models import ChargeableItem, TaxRate


def make_marina(**kwargs):
    return Marina.objects.create(name='Test Marina', **kwargs)


def _default_tax(marina):
    tax, _ = TaxRate.objects.get_or_create(
        marina=marina, name='Standard', defaults={'rate': '0.00', 'is_default': True}
    )
    return tax


def make_berth(marina, code, ota_connection=None, locked=False):
    pier, _ = Pier.objects.get_or_create(marina=marina, code='A', defaults={'label': 'A'})
    tier, _ = ChargeableItem.objects.get_or_create(
        marina=marina, name='Night',
        defaults={'category': 'berth', 'pricing_model': 'per_night', 'unit_price': 50,
                  'tax_category': _default_tax(marina)}
    )
    return Berth.objects.create(
        marina=marina, pier=pier, code=code, pricing_tier=tier,
        status='available', ota_connection=ota_connection, channel_locked=locked,
    )


def make_conn(marina, slug, target_pct=20, auto_allocate=False):
    return OTAConnection.objects.create(
        marina=marina, name=slug.title(), slug=slug,
        target_pct=target_pct, auto_allocate=auto_allocate,
    )


class RunSmartAllocatorTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.conn = make_conn(self.marina, 'mysea', target_pct=20)
        self.berths = [make_berth(self.marina, f'B{i}') for i in range(10)]

    def test_freed_berth_assigned_to_connection_when_under_target(self):
        from apps.berths.allocator import run_smart_allocator
        freed = self.berths[0]
        run_smart_allocator(self.marina, freed)
        freed.refresh_from_db()
        self.assertEqual(freed.ota_connection, self.conn)

    def test_freed_berth_stays_direct_when_at_target(self):
        from apps.berths.allocator import run_smart_allocator
        # Set 2 berths to mysea (20% of 10 = target met)
        self.berths[1].ota_connection = self.conn
        self.berths[1].save(update_fields=['ota_connection'])
        self.berths[2].ota_connection = self.conn
        self.berths[2].save(update_fields=['ota_connection'])
        freed = self.berths[0]
        run_smart_allocator(self.marina, freed)
        freed.refresh_from_db()
        self.assertIsNone(freed.ota_connection)

    def test_locked_berth_not_reassigned(self):
        from apps.berths.allocator import run_smart_allocator
        freed = make_berth(self.marina, 'LOCKED', ota_connection=self.conn, locked=True)
        run_smart_allocator(self.marina, freed)
        freed.refresh_from_db()
        # locked — allocator should not touch it
        self.assertEqual(freed.ota_connection, self.conn)

    def test_noop_when_no_connections(self):
        from apps.berths.allocator import run_smart_allocator
        self.conn.delete()
        freed = self.berths[0]
        run_smart_allocator(self.marina, freed)
        freed.refresh_from_db()
        self.assertIsNone(freed.ota_connection)

    def test_maintenance_berths_excluded_from_pool(self):
        from apps.berths.allocator import run_smart_allocator
        self.berths[8].status = 'maintenance'
        self.berths[8].save(update_fields=['status'])
        self.berths[9].status = 'maintenance'
        self.berths[9].save(update_fields=['status'])
        freed = self.berths[0]
        run_smart_allocator(self.marina, freed)
        freed.refresh_from_db()
        self.assertEqual(freed.ota_connection, self.conn)

    def test_freed_ota_berth_not_counted_against_itself(self):
        from apps.berths.allocator import run_smart_allocator
        # Assign all target slots already (2 of 10 = 20%)
        # Then free one of those mysea berths — it should NOT count itself,
        # so the allocator sees 1 < 2 target and re-assigns it back to mysea
        self.berths[1].ota_connection = self.conn
        self.berths[1].save(update_fields=['ota_connection'])
        self.berths[2].ota_connection = self.conn
        self.berths[2].save(update_fields=['ota_connection'])
        # Now free berths[2] — if freed berth counted itself, current=2 = target, so it would go direct
        # If excluded from count: current=1 < target=2, so it gets re-assigned to conn
        freed = self.berths[2]
        freed.ota_connection = None
        freed.save(update_fields=['ota_connection'])
        run_smart_allocator(self.marina, freed)
        freed.refresh_from_db()
        self.assertEqual(freed.ota_connection, self.conn)


class RebalanceDownTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.conn = make_conn(self.marina, 'mysea', target_pct=10)
        self.direct = [make_berth(self.marina, f'D{i}') for i in range(5)]
        self.ota = [make_berth(self.marina, f'M{i}', ota_connection=self.conn) for i in range(5)]

    def test_rebalance_flips_excess_unoccupied_to_direct(self):
        from apps.berths.allocator import rebalance_down
        rebalance_down(self.conn)
        count = Berth.objects.filter(marina=self.marina, ota_connection=self.conn).count()
        self.assertEqual(count, 1)  # 10% of 10 = 1

    def test_rebalance_leaves_occupied_berths_alone(self):
        from apps.berths.allocator import rebalance_down
        from apps.reservations.models import Booking
        for berth in self.ota[:3]:
            Booking.objects.create(
                marina=self.marina, berth=berth,
                check_in=datetime.date(2030, 1, 1), check_out=datetime.date(2030, 1, 5),
                nights=4, status='checked_in',
            )
        rebalance_down(self.conn)
        count = Berth.objects.filter(marina=self.marina, ota_connection=self.conn).count()
        self.assertEqual(count, 3)

    def test_rebalance_leaves_locked_berths_alone(self):
        from apps.berths.allocator import rebalance_down
        self.ota[0].channel_locked = True
        self.ota[0].save(update_fields=['channel_locked'])
        rebalance_down(self.conn)
        self.ota[0].refresh_from_db()
        self.assertEqual(self.ota[0].ota_connection, self.conn)


class BerthChannelLockTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.conn = make_conn(self.marina, 'mysea')
        self.user = User.objects.create_user(
            email='mgr@test.com', password='pass', marina=self.marina, role='manager'
        )
        self.berth = make_berth(self.marina, 'C1')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_channel_change_sets_lock(self):
        resp = self.client.patch(
            f'/api/v1/berths/{self.berth.pk}/',
            {'ota_connection': self.conn.pk},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.berth.refresh_from_db()
        self.assertEqual(self.berth.ota_connection, self.conn)
        self.assertTrue(self.berth.channel_locked)

    def test_explicit_unlock_clears_lock(self):
        self.berth.channel_locked = True
        self.berth.ota_connection = self.conn
        self.berth.save(update_fields=['channel_locked', 'ota_connection'])
        resp = self.client.patch(
            f'/api/v1/berths/{self.berth.pk}/',
            {'channel_locked': False},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.berth.refresh_from_db()
        self.assertFalse(self.berth.channel_locked)

    def test_non_channel_update_does_not_set_lock(self):
        resp = self.client.patch(
            f'/api/v1/berths/{self.berth.pk}/',
            {'status': 'maintenance'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.berth.refresh_from_db()
        self.assertFalse(self.berth.channel_locked)
