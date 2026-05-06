"""
Channel settings are now managed via the OTAConnection viewset.
This file tests that the old /auth/marina/channel-settings/ endpoint is gone
and that the new OTA viewset correctly handles target_pct updates + rebalance.
"""
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.berths.models import Berth, Pier, OTAConnection
from apps.billing.models import ChargeableItem


def make_setup(target_pct=50):
    marina = Marina.objects.create(name='Test Marina')
    user = User.objects.create_user(email='mgr@test.com', password='pass', marina=marina, role='manager')
    pier = Pier.objects.create(marina=marina, code='A', label='A')
    tier = ChargeableItem.objects.create(
        marina=marina, name='Night', category='berth', pricing_model='per_night', unit_price=50
    )
    conn = OTAConnection.objects.create(marina=marina, name='mySea', slug='mysea', target_pct=target_pct)
    ota_berths = [
        Berth.objects.create(marina=marina, pier=pier, code=f'M{i}', pricing_tier=tier,
                              status='available', ota_connection=conn)
        for i in range(4)
    ]
    direct_berths = [
        Berth.objects.create(marina=marina, pier=pier, code=f'D{i}', pricing_tier=tier,
                              status='available', ota_connection=None)
        for i in range(4)
    ]
    return marina, user, conn, ota_berths + direct_berths


class OTAViewsetRebalanceTest(TestCase):
    def setUp(self):
        self.marina, self.user, self.conn, self.berths = make_setup(target_pct=50)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_old_channel_settings_endpoint_gone(self):
        resp = self.client.patch('/api/v1/auth/marina/channel-settings/', {}, format='json')
        self.assertEqual(resp.status_code, 404)

    def test_patch_target_pct_via_viewset(self):
        resp = self.client.patch(f'/api/v1/ota-connections/{self.conn.pk}/', {'target_pct': 25}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.conn.refresh_from_db()
        self.assertEqual(self.conn.target_pct, 25)

    def test_rebalance_action_flips_excess_berths(self):
        # marina has 4 OTA out of 8 = 50%. Lower to 0% then rebalance
        self.conn.target_pct = 0
        self.conn.save(update_fields=['target_pct'])
        resp = self.client.post(f'/api/v1/ota-connections/{self.conn.pk}/rebalance/')
        self.assertEqual(resp.status_code, 200)
        ota_count = Berth.objects.filter(marina=self.marina, ota_connection=self.conn).count()
        self.assertEqual(ota_count, 0)
