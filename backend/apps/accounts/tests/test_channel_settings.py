from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.berths.models import Berth, Pier
from apps.billing.models import ChargeableItem


def make_setup():
    marina = Marina.objects.create(name='Test Marina', auto_allocate_inventory=True, mysea_target_pct=50)
    user = User.objects.create_user(email='mgr@test.com', password='pass', marina=marina, role='manager')
    pier = Pier.objects.create(marina=marina, code='A', label='A')
    tier = ChargeableItem.objects.create(
        marina=marina, name='Night', category='berth', pricing_model='per_night', unit_price=50
    )
    berths = [
        Berth.objects.create(marina=marina, pier=pier, code=f'B{i}', pricing_tier=tier,
                              status='available', sales_channel='mysea')
        for i in range(4)
    ] + [
        Berth.objects.create(marina=marina, pier=pier, code=f'D{i}', pricing_tier=tier,
                              status='available', sales_channel='direct')
        for i in range(4)
    ]
    return marina, user, berths


class ChannelSettingsViewTest(TestCase):
    def setUp(self):
        self.marina, self.user, self.berths = make_setup()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_patch_updates_target(self):
        resp = self.client.patch('/api/v1/auth/marina/channel-settings/', {'mysea_target_pct': 25}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.marina.refresh_from_db()
        self.assertEqual(self.marina.mysea_target_pct, 25)

    def test_lowering_target_triggers_rebalance(self):
        # marina has 4 mysea out of 8 total = 50%. Lower to 0% → all should flip to direct
        resp = self.client.patch('/api/v1/auth/marina/channel-settings/', {'mysea_target_pct': 0}, format='json')
        self.assertEqual(resp.status_code, 200)
        mysea_count = Berth.objects.filter(marina=self.marina, sales_channel='mysea').count()
        self.assertEqual(mysea_count, 0)

    def test_invalid_pct_rejected(self):
        resp = self.client.patch('/api/v1/auth/marina/channel-settings/', {'mysea_target_pct': 150}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_raising_target_does_not_rebalance(self):
        from unittest.mock import patch as mock_patch
        with mock_patch('apps.berths.allocator.rebalance_down') as mock_rb:
            resp = self.client.patch(
                '/api/v1/auth/marina/channel-settings/',
                {'mysea_target_pct': 75},
                format='json',
            )
        self.assertEqual(resp.status_code, 200)
        mock_rb.assert_not_called()

    def test_boolean_pct_rejected(self):
        resp = self.client.patch('/api/v1/auth/marina/channel-settings/', {'mysea_target_pct': True}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_invalid_ical_url_rejected(self):
        resp = self.client.patch('/api/v1/auth/marina/channel-settings/', {'mysea_ical_url': 'not-a-url'}, format='json')
        self.assertEqual(resp.status_code, 400)
