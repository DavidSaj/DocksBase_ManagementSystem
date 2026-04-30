import json
from datetime import date, timedelta
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Marina, User
from apps.admin_portal.models import PlatformPayment, AuditLog, GlobalFeatureFlag


def make_marina(**kwargs):
    defaults = dict(name='Test Marina', currency='EUR', status='active')
    defaults.update(kwargs)
    return Marina.objects.create(**defaults)


def make_user(marina=None, is_platform_admin=False, role='owner', **kwargs):
    i = User.objects.count()
    u = User.objects.create_user(
        email=f'user{i}@test.com', password='pass',
        marina=marina, role=role,
        is_platform_admin=is_platform_admin,
        **kwargs
    )
    return u


def auth(client, user):
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')


# ── IsSafeModeReadOnly ────────────────────────────────────────────────────────

class SafeModePermissionTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.client = APIClient()

    def _safe_mode_token(self):
        refresh = RefreshToken.for_user(self.user)
        refresh['is_safe_mode'] = True
        return str(refresh.access_token)

    def test_safe_mode_blocks_post(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self._safe_mode_token()}')
        resp = self.client.post('/api/v1/bookings/', {})
        self.assertEqual(resp.status_code, 403)
        self.assertIn('Safe Mode', resp.json()['detail'])

    def test_safe_mode_allows_get(self):
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {self._safe_mode_token()}')
        resp = self.client.get('/api/v1/bookings/')
        self.assertNotEqual(resp.status_code, 403)

    def test_normal_token_not_blocked(self):
        auth(self.client, self.user)
        resp = self.client.get('/api/v1/bookings/')
        self.assertNotEqual(resp.status_code, 403)


# ── IsPlatformAdmin gate ──────────────────────────────────────────────────────

class PlatformAdminGateTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.regular = make_user(self.marina)
        self.admin = make_user(None, is_platform_admin=True)
        self.client = APIClient()

    def test_regular_user_cannot_access_admin_overview(self):
        auth(self.client, self.regular)
        resp = self.client.get('/api/admin/overview/')
        self.assertEqual(resp.status_code, 403)

    def test_platform_admin_can_access_admin_overview(self):
        auth(self.client, self.admin)
        resp = self.client.get('/api/admin/overview/')
        self.assertEqual(resp.status_code, 200)


# ── Overview endpoint ─────────────────────────────────────────────────────────

class AdminOverviewTest(TestCase):
    def setUp(self):
        self.admin = make_user(None, is_platform_admin=True)
        self.client = APIClient()
        auth(self.client, self.admin)
        self.m1 = make_marina(name='Active1', plan='professional', status='active')
        self.m2 = make_marina(name='Active2', plan='starter', status='active')
        self.m3 = make_marina(name='Trial1', status='trial', trial_ends=date.today() + timedelta(days=5))
        self.m4 = make_marina(name='Suspended1', status='suspended', suspend_reason='Overdue')

    def test_overview_mrr_sums_active_plans(self):
        resp = self.client.get('/api/admin/overview/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        # professional=349 + starter=149 = 498
        self.assertEqual(data['mrr'], 498)

    def test_overview_counts(self):
        resp = self.client.get('/api/admin/overview/')
        data = resp.json()
        self.assertEqual(data['active_marinas'], 2)
        self.assertEqual(data['trial_marinas'], 1)

    def test_overview_alerts_contain_trials_ending_soon(self):
        resp = self.client.get('/api/admin/overview/')
        data = resp.json()
        names = [m['name'] for m in data['alerts']['trials_ending_soon']]
        self.assertIn('Trial1', names)

    def test_overview_alerts_contain_suspended(self):
        resp = self.client.get('/api/admin/overview/')
        data = resp.json()
        names = [m['name'] for m in data['alerts']['suspended']]
        self.assertIn('Suspended1', names)

    def test_overview_recent_signups(self):
        resp = self.client.get('/api/admin/overview/')
        data = resp.json()
        self.assertIn('recent_signups', data)
        self.assertGreater(len(data['recent_signups']), 0)


# ── Marina list / detail ──────────────────────────────────────────────────────

class AdminMarinaListTest(TestCase):
    def setUp(self):
        self.admin = make_user(None, is_platform_admin=True)
        self.client = APIClient()
        auth(self.client, self.admin)
        self.m1 = make_marina(name='Alpha', status='active')
        self.m2 = make_marina(name='Beta', status='trial')

    def test_list_returns_all_marinas(self):
        resp = self.client.get('/api/admin/marinas/')
        self.assertEqual(resp.status_code, 200)
        names = [m['name'] for m in resp.json()]
        self.assertIn('Alpha', names)
        self.assertIn('Beta', names)

    def test_filter_by_status(self):
        resp = self.client.get('/api/admin/marinas/?status=trial')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['name'], 'Beta')

    def test_detail_returns_feature_toggles(self):
        self.m1.features = {'restaurant': True, 'boatyard': False}
        self.m1.save()
        resp = self.client.get(f'/api/admin/marinas/{self.m1.id}/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['features']['restaurant'], True)

    def test_detail_returns_staff_list(self):
        make_user(self.m1, role='manager')
        make_user(self.m1, role='staff')
        resp = self.client.get(f'/api/admin/marinas/{self.m1.id}/')
        self.assertEqual(len(resp.json()['staff']), 2)


# ── Marina actions ────────────────────────────────────────────────────────────

class AdminMarinaActionsTest(TestCase):
    def setUp(self):
        self.admin = make_user(None, is_platform_admin=True)
        self.client = APIClient()
        auth(self.client, self.admin)
        self.marina = make_marina(status='active')

    def test_suspend_marina(self):
        resp = self.client.post(
            f'/api/admin/marinas/{self.marina.id}/suspend/',
            {'reason': 'Payment overdue'}
        )
        self.assertEqual(resp.status_code, 200)
        self.marina.refresh_from_db()
        self.assertEqual(self.marina.status, 'suspended')
        self.assertEqual(self.marina.suspend_reason, 'Payment overdue')

    def test_suspend_creates_audit_log(self):
        self.client.post(f'/api/admin/marinas/{self.marina.id}/suspend/', {'reason': 'Test'})
        self.assertTrue(AuditLog.objects.filter(action='suspend_marina', target_marina=self.marina).exists())

    def test_reinstate_marina(self):
        self.marina.status = 'suspended'
        self.marina.suspend_reason = 'Old reason'
        self.marina.save()
        resp = self.client.post(f'/api/admin/marinas/{self.marina.id}/reinstate/')
        self.assertEqual(resp.status_code, 200)
        self.marina.refresh_from_db()
        self.assertEqual(self.marina.status, 'active')
        self.assertEqual(self.marina.suspend_reason, '')

    def test_convert_trial_to_active(self):
        self.marina.status = 'trial'
        self.marina.save()
        resp = self.client.post(f'/api/admin/marinas/{self.marina.id}/convert/')
        self.assertEqual(resp.status_code, 200)
        self.marina.refresh_from_db()
        self.assertEqual(self.marina.status, 'active')

    def test_convert_non_trial_returns_400(self):
        # self.marina has status='active' from setUp
        resp = self.client.post(f'/api/admin/marinas/{self.marina.id}/convert/')
        self.assertEqual(resp.status_code, 400)

    def test_update_features_toggle(self):
        resp = self.client.patch(
            f'/api/admin/marinas/{self.marina.id}/',
            {'features': {'restaurant': False, 'boatyard': True}},
            format='json'
        )
        self.assertEqual(resp.status_code, 200)
        self.marina.refresh_from_db()
        self.assertFalse(self.marina.features['restaurant'])


# ── Impersonation ─────────────────────────────────────────────────────────────

class AdminImpersonateTest(TestCase):
    def setUp(self):
        self.admin = make_user(None, is_platform_admin=True)
        self.client = APIClient()
        auth(self.client, self.admin)
        self.marina = make_marina()
        self.owner = make_user(self.marina, role='owner')

    def test_impersonate_returns_safe_mode_token(self):
        resp = self.client.post(f'/api/admin/marinas/{self.marina.id}/impersonate/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('access', data)
        self.assertIn('marina_name', data)

    def test_impersonate_token_has_safe_mode_claim(self):
        import jwt as pyjwt
        resp = self.client.post(f'/api/admin/marinas/{self.marina.id}/impersonate/')
        token = resp.json()['access']
        payload = pyjwt.decode(token, options={'verify_signature': False})
        self.assertTrue(payload['is_safe_mode'])

    def test_impersonate_creates_audit_log(self):
        self.client.post(f'/api/admin/marinas/{self.marina.id}/impersonate/')
        self.assertTrue(AuditLog.objects.filter(action='impersonate', target_marina=self.marina).exists())

    def test_impersonate_no_owner_returns_404(self):
        empty_marina = make_marina(name='Empty')
        resp = self.client.post(f'/api/admin/marinas/{empty_marina.id}/impersonate/')
        self.assertEqual(resp.status_code, 404)


# ── Finance / Payments ────────────────────────────────────────────────────────

class AdminFinanceTest(TestCase):
    def setUp(self):
        self.admin = make_user(None, is_platform_admin=True)
        self.client = APIClient()
        auth(self.client, self.admin)
        self.marina = make_marina(plan='professional', status='active')
        PlatformPayment.objects.create(
            marina=self.marina, amount=349, status='paid',
            period_start=date.today().replace(day=1)
        )
        PlatformPayment.objects.create(
            marina=self.marina, amount=349, status='overdue',
            period_start=(date.today().replace(day=1) - timedelta(days=32)).replace(day=1)
        )

    def test_payments_list(self):
        resp = self.client.get('/api/admin/payments/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 2)

    def test_payments_filter_by_status(self):
        resp = self.client.get('/api/admin/payments/?status=overdue')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 1)
        self.assertEqual(resp.json()[0]['status'], 'overdue')

    def test_finance_overview(self):
        resp = self.client.get('/api/admin/finance/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('mrr', data)
        self.assertIn('arr', data)
        self.assertIn('revenue_by_plan', data)
        self.assertIn('payments', data)


# ── Global Feature Flags ──────────────────────────────────────────────────────

class GlobalFeatureFlagTest(TestCase):
    def setUp(self):
        self.admin = make_user(None, is_platform_admin=True)
        self.client = APIClient()
        auth(self.client, self.admin)
        GlobalFeatureFlag.objects.create(name='boatyard', enabled=True)
        GlobalFeatureFlag.objects.create(name='restaurant', enabled=False)

    def test_list_flags(self):
        resp = self.client.get('/api/admin/feature-flags/')
        self.assertEqual(resp.status_code, 200)
        names = [f['name'] for f in resp.json()]
        self.assertIn('boatyard', names)

    def test_toggle_flag(self):
        resp = self.client.patch('/api/admin/feature-flags/boatyard/', {'enabled': False})
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(GlobalFeatureFlag.objects.get(name='boatyard').enabled)

    def test_toggle_creates_audit_log(self):
        self.client.patch('/api/admin/feature-flags/boatyard/', {'enabled': False})
        self.assertTrue(AuditLog.objects.filter(action='toggle_global_flag').exists())


# ── Audit Log ─────────────────────────────────────────────────────────────────

class AuditLogTest(TestCase):
    def setUp(self):
        self.admin = make_user(None, is_platform_admin=True)
        self.client = APIClient()
        auth(self.client, self.admin)
        self.marina = make_marina()
        AuditLog.objects.create(admin_user=self.admin, action='suspend_marina', target_marina=self.marina)
        AuditLog.objects.create(admin_user=self.admin, action='impersonate', target_marina=self.marina)

    def test_audit_log_list(self):
        resp = self.client.get('/api/admin/audit-logs/')
        self.assertEqual(resp.status_code, 200)
        actions = [e['action'] for e in resp.json()]
        self.assertIn('suspend_marina', actions)
        self.assertIn('impersonate', actions)

    def test_audit_log_filter_by_marina(self):
        other = make_marina(name='Other')
        AuditLog.objects.create(admin_user=self.admin, action='reinstate_marina', target_marina=other)
        resp = self.client.get(f'/api/admin/audit-logs/?marina={self.marina.id}')
        data = resp.json()
        self.assertEqual(len(data), 2)

    def test_audit_log_is_read_only(self):
        resp = self.client.post('/api/admin/audit-logs/', {'action': 'hack'})
        self.assertEqual(resp.status_code, 405)
