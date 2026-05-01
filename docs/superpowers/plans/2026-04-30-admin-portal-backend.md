# Admin Portal — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Django backend for the DocksBase platform admin portal — covering tenant management, SaaS billing, impersonation with Safe Mode, audit logging, and global feature flags.

**Architecture:** A new `apps/admin_portal` Django app owns all platform-level models and views. Endpoints live at `/api/admin/` and are protected by `IsPlatformAdmin`. Safe Mode impersonation generates a special JWT with `is_safe_mode: true`; a global `IsSafeModeReadOnly` permission (added to DRF defaults) blocks all write operations when that claim is present — affecting every endpoint in the system automatically. Marina subscription metadata (`status`, `trial_ends`, `features` JSONField, etc.) is added directly to the existing `Marina` model.

**Tech Stack:** Django 6, DRF, SimpleJWT (custom claims), existing `apps.accounts` models

---

## File Map

| File | Action |
|---|---|
| `backend/apps/accounts/models.py` | Add `is_platform_admin`, `platform_role` to User; add `status`, `trial_ends`, `next_renewal`, `suspend_reason`, `features`, `mrr_override`, `max_staff` to Marina |
| `backend/apps/accounts/migrations/0006_admin_portal_fields.py` | Auto-generated |
| `backend/apps/accounts/serializers.py` | Add `is_platform_admin` to JWT claims via `get_token()` |
| `backend/apps/admin_portal/__init__.py` | Create (empty) |
| `backend/apps/admin_portal/apps.py` | AppConfig |
| `backend/apps/admin_portal/models.py` | `PlatformPayment`, `AuditLog`, `GlobalFeatureFlag` |
| `backend/apps/admin_portal/migrations/` | Auto-generated |
| `backend/apps/admin_portal/permissions.py` | `IsPlatformAdmin`, `IsSafeModeReadOnly` |
| `backend/apps/admin_portal/serializers.py` | All admin serializers |
| `backend/apps/admin_portal/views.py` | All admin views |
| `backend/apps/admin_portal/urls.py` | URL patterns under `/api/admin/` |
| `backend/apps/admin_portal/tests.py` | All tests |
| `backend/config/settings/base.py` | Add `apps.admin_portal` to `INSTALLED_APPS`; add `IsSafeModeReadOnly` to `DEFAULT_PERMISSION_CLASSES`; add `PLATFORM_FEE_RATE`, `PLAN_PRICES` |
| `backend/config/urls.py` | Add `path('api/admin/', include('apps.admin_portal.urls'))` |

---

### Task 1: Extend Marina + User models

**Files:**
- Modify: `backend/apps/accounts/models.py`
- Create: `backend/apps/accounts/migrations/0006_admin_portal_fields.py` (auto-generated)

- [ ] **Step 1: Add fields to Marina model**

In `backend/apps/accounts/models.py`, after the `stripe_account_id` field on `Marina`, add:

```python
    MARINA_STATUS_CHOICES = [
        ('active', 'Active'),
        ('trial', 'Trial'),
        ('suspended', 'Suspended'),
    ]
    status = models.CharField(max_length=20, choices=MARINA_STATUS_CHOICES, default='active')
    trial_ends = models.DateField(null=True, blank=True)
    next_renewal = models.DateField(null=True, blank=True)
    suspend_reason = models.TextField(blank=True)
    features = models.JSONField(default=dict)
    mrr_override = models.IntegerField(null=True, blank=True)
    max_staff = models.IntegerField(default=10)
```

- [ ] **Step 2: Add fields to User model**

In the same file, after `created_at` on `User`, add:

```python
    is_platform_admin = models.BooleanField(default=False)
    platform_role = models.CharField(
        max_length=20,
        choices=[('admin', 'Admin'), ('support', 'Support')],
        blank=True,
    )
```

- [ ] **Step 3: Generate and apply migration**

```bash
cd backend
python manage.py makemigrations accounts --settings=config.settings.dev
python manage.py migrate --settings=config.settings.dev
```

Expected: new migration created and applied with no errors.

- [ ] **Step 4: Verify system check**

```bash
python manage.py check --settings=config.settings.dev
```

Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 5: Commit**

```bash
git add backend/apps/accounts/models.py backend/apps/accounts/migrations/
git commit -m "feat(admin-portal): extend Marina + User with subscription and platform-admin fields"
```

---

### Task 2: Create admin_portal app + models

**Files:**
- Create: `backend/apps/admin_portal/__init__.py`
- Create: `backend/apps/admin_portal/apps.py`
- Create: `backend/apps/admin_portal/models.py`
- Create: `backend/apps/admin_portal/migrations/0001_initial.py` (auto-generated)

- [ ] **Step 1: Create app skeleton**

```bash
cd backend
python manage.py startapp admin_portal apps/admin_portal --settings=config.settings.dev
```

- [ ] **Step 2: Write models.py**

Replace the generated `backend/apps/admin_portal/models.py` with:

```python
from django.db import models


class PlatformPayment(models.Model):
    """Monthly SaaS subscription payment from a marina to the platform."""
    STATUS_CHOICES = [
        ('paid', 'Paid'),
        ('due', 'Due'),
        ('overdue', 'Overdue'),
    ]
    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='platform_payments'
    )
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='due')
    method = models.CharField(max_length=50, default='Card')
    period_start = models.DateField()
    paid_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.marina.name} — {self.period_start} ({self.status})'


class AuditLog(models.Model):
    """Record of every action performed in the platform admin portal."""
    admin_user = models.ForeignKey(
        'accounts.User', on_delete=models.SET_NULL, null=True, related_name='audit_logs'
    )
    action = models.CharField(max_length=100)
    target_marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.SET_NULL, null=True, blank=True, related_name='audit_logs'
    )
    detail = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.admin_user} — {self.action} at {self.created_at}'


class GlobalFeatureFlag(models.Model):
    """Master on/off switch for a platform feature across all marinas."""
    name = models.CharField(max_length=100, unique=True)
    enabled = models.BooleanField(default=True)
    updated_by = models.ForeignKey(
        'accounts.User', on_delete=models.SET_NULL, null=True, blank=True
    )
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.name} — {"on" if self.enabled else "off"}'
```

- [ ] **Step 3: Update apps.py**

Replace `backend/apps/admin_portal/apps.py` with:

```python
from django.apps import AppConfig


class AdminPortalConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.admin_portal'
    label = 'admin_portal'
```

- [ ] **Step 4: Add to INSTALLED_APPS and generate migration**

In `backend/config/settings/base.py`, add `'apps.admin_portal'` to `LOCAL_APPS`.

Then run:

```bash
cd backend
python manage.py makemigrations admin_portal --settings=config.settings.dev
python manage.py migrate --settings=config.settings.dev
python manage.py check --settings=config.settings.dev
```

Expected: migration created and applied, system check clean.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/admin_portal/ backend/config/settings/base.py
git commit -m "feat(admin-portal): create admin_portal app with PlatformPayment, AuditLog, GlobalFeatureFlag models"
```

---

### Task 3: Permissions, JWT claims, settings constants

**Files:**
- Create: `backend/apps/admin_portal/permissions.py`
- Modify: `backend/apps/accounts/serializers.py`
- Modify: `backend/config/settings/base.py`

- [ ] **Step 1: Create permissions.py**

Create `backend/apps/admin_portal/permissions.py`:

```python
from rest_framework.permissions import BasePermission, SAFE_METHODS


class IsPlatformAdmin(BasePermission):
    """Allows access only to users with is_platform_admin=True."""

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and request.user.is_platform_admin
        )


class IsSafeModeReadOnly(BasePermission):
    """
    When a JWT contains is_safe_mode=True, only GET/HEAD/OPTIONS are permitted.
    Blocks POST/PATCH/PUT/DELETE and returns 403 with a clear message.
    Added to DRF DEFAULT_PERMISSION_CLASSES so it applies to every view.
    """
    message = 'Action blocked: Safe Mode is active.'

    def has_permission(self, request, view):
        token = request.auth
        if token and token.get('is_safe_mode'):
            return request.method in SAFE_METHODS
        return True
```

- [ ] **Step 2: Add `is_platform_admin` to JWT claims**

In `backend/apps/accounts/serializers.py`, find `DocksBaseTokenSerializer` (currently at line ~31):

```python
class DocksBaseTokenSerializer(TokenObtainPairSerializer):
    def validate(self, attrs):
        data = super().validate(attrs)
        data['user'] = UserSerializer(self.user).data
        return data
```

Replace with:

```python
class DocksBaseTokenSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        token['is_platform_admin'] = user.is_platform_admin
        token['role'] = user.role
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        data['user'] = UserSerializer(self.user).data
        return data
```

- [ ] **Step 3: Add constants + global permission to settings**

In `backend/config/settings/base.py`, add after `DEFAULT_FROM_EMAIL`:

```python
PLAN_PRICES = {
    'starter': 149,
    'professional': 349,
    'enterprise': 899,
}

PLATFORM_FEE_RATE = '0.01'  # 1% of GMV
```

In the same file, update `REST_FRAMEWORK['DEFAULT_PERMISSION_CLASSES']`:

```python
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': (
        'rest_framework_simplejwt.authentication.JWTAuthentication',
    ),
    'DEFAULT_PERMISSION_CLASSES': (
        'rest_framework.permissions.IsAuthenticated',
        'apps.admin_portal.permissions.IsSafeModeReadOnly',
    ),
    'DEFAULT_FILTER_BACKENDS': (
        'django_filters.rest_framework.DjangoFilterBackend',
        'rest_framework.filters.SearchFilter',
        'rest_framework.filters.OrderingFilter',
    ),
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.PageNumberPagination',
    'PAGE_SIZE': 100,
}
```

- [ ] **Step 4: System check**

```bash
cd backend
python manage.py check --settings=config.settings.dev
```

Expected: no issues.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/admin_portal/permissions.py backend/apps/accounts/serializers.py backend/config/settings/base.py
git commit -m "feat(admin-portal): IsPlatformAdmin + IsSafeModeReadOnly permissions; is_platform_admin in JWT claims"
```

---

### Task 4: Write tests — red phase (overview, marinas, impersonate)

**Files:**
- Create: `backend/apps/admin_portal/tests.py`

- [ ] **Step 1: Write tests**

Create `backend/apps/admin_portal/tests.py`:

```python
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
python manage.py test apps.admin_portal --settings=config.settings.dev -v 2 2>&1 | tail -20
```

Expected: tests fail with 404 (URLs not yet registered) or import errors. That is correct for the red phase.

- [ ] **Step 3: Commit**

```bash
git add backend/apps/admin_portal/tests.py
git commit -m "test(admin-portal): red phase — overview, marina CRUD, actions, impersonate"
```

---

### Task 5: Write tests — red phase (finance, payments, global flags, audit)

**Files:**
- Modify: `backend/apps/admin_portal/tests.py`

- [ ] **Step 1: Append finance + flag + audit tests**

Append to `backend/apps/admin_portal/tests.py`:

```python
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
```

- [ ] **Step 2: Run to confirm all new tests fail as expected**

```bash
cd backend
python manage.py test apps.admin_portal --settings=config.settings.dev -v 2 2>&1 | grep -E "FAIL|ERROR|OK" | tail -10
```

Expected: all fail (views/URLs not implemented yet).

- [ ] **Step 3: Commit**

```bash
git add backend/apps/admin_portal/tests.py
git commit -m "test(admin-portal): red phase — finance, payments, feature flags, audit log"
```

---

### Task 6: Serializers

**Files:**
- Create: `backend/apps/admin_portal/serializers.py`

- [ ] **Step 1: Create serializers.py**

Create `backend/apps/admin_portal/serializers.py`:

```python
from rest_framework import serializers
from apps.accounts.models import Marina, User
from .models import PlatformPayment, AuditLog, GlobalFeatureFlag


PLAN_PRICES = {'starter': 149, 'professional': 349, 'enterprise': 899}


class StaffUserSerializer(serializers.ModelSerializer):
    name = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ['id', 'email', 'name', 'role', 'is_active', 'created_at']

    def get_name(self, obj):
        return f'{obj.first_name} {obj.last_name}'.strip() or obj.email


class MarinaListSerializer(serializers.ModelSerializer):
    mrr = serializers.SerializerMethodField()
    user_count = serializers.SerializerMethodField()

    class Meta:
        model = Marina
        fields = [
            'id', 'name', 'contact_email', 'timezone', 'plan', 'status',
            'total_berths', 'mrr', 'user_count',
            'trial_ends', 'next_renewal', 'suspend_reason',
            'stripe_account_id', 'features', 'mrr_override', 'max_staff',
            'created_at',
        ]

    def get_mrr(self, obj):
        return obj.mrr_override or PLAN_PRICES.get(obj.plan, 0)

    def get_user_count(self, obj):
        return obj.users.filter(is_active=True).count()


class MarinaDetailSerializer(MarinaListSerializer):
    staff = serializers.SerializerMethodField()
    active_bookings = serializers.SerializerMethodField()

    class Meta(MarinaListSerializer.Meta):
        fields = MarinaListSerializer.Meta.fields + ['staff', 'active_bookings', 'address', 'phone', 'currency']

    def get_staff(self, obj):
        users = obj.users.filter(role__in=['owner', 'manager', 'staff']).order_by('role')
        return StaffUserSerializer(users, many=True).data

    def get_active_bookings(self, obj):
        return obj.bookings.filter(
            status__in=['confirmed', 'pending', 'checked_in', 'awaiting_payment', 'pending_payment']
        ).count()


class MarinaUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = Marina
        fields = ['plan', 'status', 'trial_ends', 'next_renewal', 'suspend_reason',
                  'features', 'mrr_override', 'max_staff', 'name', 'contact_email']


class PlatformPaymentSerializer(serializers.ModelSerializer):
    marina_name = serializers.CharField(source='marina.name', read_only=True)

    class Meta:
        model = PlatformPayment
        fields = ['id', 'marina', 'marina_name', 'amount', 'status', 'method',
                  'period_start', 'paid_at', 'created_at']


class AuditLogSerializer(serializers.ModelSerializer):
    admin_email = serializers.CharField(source='admin_user.email', read_only=True, default=None)
    marina_name = serializers.CharField(source='target_marina.name', read_only=True, default=None)

    class Meta:
        model = AuditLog
        fields = ['id', 'admin_email', 'action', 'marina_name', 'detail', 'created_at']


class GlobalFeatureFlagSerializer(serializers.ModelSerializer):
    class Meta:
        model = GlobalFeatureFlag
        fields = ['name', 'enabled', 'updated_at']
        read_only_fields = ['updated_at']
```

- [ ] **Step 2: Verify no import errors**

```bash
cd backend
python manage.py check --settings=config.settings.dev
```

Expected: no issues.

- [ ] **Step 3: Commit**

```bash
git add backend/apps/admin_portal/serializers.py
git commit -m "feat(admin-portal): admin serializers"
```

---

### Task 7: Views — overview, marinas, actions

**Files:**
- Create: `backend/apps/admin_portal/views.py`

- [ ] **Step 1: Create views.py**

Create `backend/apps/admin_portal/views.py`:

```python
import datetime
from decimal import Decimal
from django.conf import settings
from django.db.models import Sum, Count, Q
from django.shortcuts import get_object_or_404
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status as http_status
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Marina, User
from apps.billing.models import Invoice
from .models import PlatformPayment, AuditLog, GlobalFeatureFlag
from .permissions import IsPlatformAdmin
from .serializers import (
    MarinaListSerializer, MarinaDetailSerializer, MarinaUpdateSerializer,
    PlatformPaymentSerializer, AuditLogSerializer, GlobalFeatureFlagSerializer,
)

PLAN_PRICES = getattr(settings, 'PLAN_PRICES', {'starter': 149, 'professional': 349, 'enterprise': 899})


def _mrr_for(marina):
    return marina.mrr_override or PLAN_PRICES.get(marina.plan, 0)


def _log(admin_user, action, marina=None, **detail):
    AuditLog.objects.create(
        admin_user=admin_user,
        action=action,
        target_marina=marina,
        detail=detail,
    )


# ── Overview ──────────────────────────────────────────────────────────────────

class AdminOverviewView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        marinas = Marina.objects.all()
        active = marinas.filter(status='active')
        trial = marinas.filter(status='trial')
        suspended = marinas.filter(status='suspended')

        mrr = sum(_mrr_for(m) for m in active)

        today = datetime.date.today()
        trial_ending_soon = trial.filter(
            trial_ends__lte=today + datetime.timedelta(days=14),
            trial_ends__gte=today,
        )
        overdue_payments = PlatformPayment.objects.filter(
            status='overdue'
        ).select_related('marina')

        gmv = Invoice.objects.filter(status='paid').aggregate(
            total=Sum('total')
        )['total'] or Decimal('0')

        recent_signups = marinas.order_by('-created_at')[:5]

        return Response({
            'mrr': mrr,
            'arr': mrr * 12,
            'active_marinas': active.count(),
            'trial_marinas': trial.count(),
            'total_berths': active.aggregate(t=Sum('total_berths'))['t'] or 0,
            'gmv': str(gmv),
            'alerts': {
                'overdue_payments': PlatformPaymentSerializer(overdue_payments, many=True).data,
                'trials_ending_soon': MarinaListSerializer(trial_ending_soon, many=True).data,
                'suspended': MarinaListSerializer(suspended, many=True).data,
            },
            'recent_signups': MarinaListSerializer(recent_signups, many=True).data,
        })


# ── Marinas ───────────────────────────────────────────────────────────────────

class AdminMarinaListView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        qs = Marina.objects.all().order_by('-created_at')
        status_filter = request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        search = request.query_params.get('search')
        if search:
            qs = qs.filter(Q(name__icontains=search) | Q(address__icontains=search))
        return Response(MarinaListSerializer(qs, many=True).data)


class AdminMarinaDetailView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request, pk):
        marina = get_object_or_404(Marina, pk=pk)
        return Response(MarinaDetailSerializer(marina).data)

    def patch(self, request, pk):
        marina = get_object_or_404(Marina, pk=pk)
        ser = MarinaUpdateSerializer(marina, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        _log(request.user, 'update_marina', marina, changes=list(request.data.keys()))
        return Response(MarinaDetailSerializer(marina).data)


class AdminMarinaSuspendView(APIView):
    permission_classes = [IsPlatformAdmin]

    def post(self, request, pk):
        marina = get_object_or_404(Marina, pk=pk)
        reason = request.data.get('reason', '')
        marina.status = 'suspended'
        marina.suspend_reason = reason
        marina.save(update_fields=['status', 'suspend_reason'])
        _log(request.user, 'suspend_marina', marina, reason=reason)
        return Response(MarinaDetailSerializer(marina).data)


class AdminMarinaReinstateView(APIView):
    permission_classes = [IsPlatformAdmin]

    def post(self, request, pk):
        marina = get_object_or_404(Marina, pk=pk)
        marina.status = 'active'
        marina.suspend_reason = ''
        marina.save(update_fields=['status', 'suspend_reason'])
        _log(request.user, 'reinstate_marina', marina)
        return Response(MarinaDetailSerializer(marina).data)


class AdminMarinaConvertView(APIView):
    """Convert a trial marina to active (paid)."""
    permission_classes = [IsPlatformAdmin]

    def post(self, request, pk):
        marina = get_object_or_404(Marina, pk=pk)
        marina.status = 'active'
        marina.trial_ends = None
        today = datetime.date.today()
        marina.next_renewal = today.replace(
            month=(today.month % 12) + 1,
            day=1,
        ) if today.month < 12 else today.replace(year=today.year + 1, month=1, day=1)
        marina.save(update_fields=['status', 'trial_ends', 'next_renewal'])
        _log(request.user, 'convert_trial', marina)
        return Response(MarinaDetailSerializer(marina).data)


class AdminMarinaImpersonateView(APIView):
    """Generate a Safe Mode JWT for the marina's owner/manager."""
    permission_classes = [IsPlatformAdmin]

    def post(self, request, pk):
        marina = get_object_or_404(Marina, pk=pk)
        target_user = User.objects.filter(
            marina=marina, role__in=['owner', 'manager'], is_active=True
        ).first()
        if not target_user:
            return Response(
                {'detail': 'No active owner or manager found for this marina.'},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        refresh = RefreshToken.for_user(target_user)
        refresh['is_safe_mode'] = True
        refresh['impersonated_marina'] = marina.name
        refresh['role'] = target_user.role
        refresh['is_platform_admin'] = False

        _log(request.user, 'impersonate', marina, target_user=target_user.email)

        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'marina_name': marina.name,
            'user_email': target_user.email,
        })


class AdminMarinaResetPasswordView(APIView):
    """Trigger a password reset email for a marina staff user."""
    permission_classes = [IsPlatformAdmin]

    def post(self, request, pk):
        marina = get_object_or_404(Marina, pk=pk)
        user_id = request.data.get('user_id')
        target = get_object_or_404(User, pk=user_id, marina=marina)

        new_password = User.objects.make_random_password(length=16)
        target.set_password(new_password)
        target.save(update_fields=['password'])

        _log(request.user, 'reset_password', marina, target_user=target.email)

        return Response({
            'detail': f'Password reset for {target.email}.',
            'temporary_password': new_password,
        })


# ── Finance ───────────────────────────────────────────────────────────────────

class AdminFinanceView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        active = Marina.objects.filter(status='active')
        mrr = sum(_mrr_for(m) for m in active)
        active_count = active.count()

        plan_breakdown = {}
        for m in active:
            p = m.plan
            rev = _mrr_for(m)
            if p not in plan_breakdown:
                plan_breakdown[p] = {'plan': p, 'count': 0, 'revenue': 0}
            plan_breakdown[p]['count'] += 1
            plan_breakdown[p]['revenue'] += rev

        payments = PlatformPayment.objects.select_related('marina').order_by('-created_at')[:50]

        revenue_by_marina = [
            {'name': m.name, 'plan': m.plan, 'mrr': _mrr_for(m)}
            for m in active.order_by('-total_berths')
        ]

        return Response({
            'mrr': mrr,
            'arr': mrr * 12,
            'avg_revenue_per_account': round(mrr / active_count, 2) if active_count else 0,
            'revenue_by_plan': list(plan_breakdown.values()),
            'revenue_by_marina': revenue_by_marina,
            'payments': PlatformPaymentSerializer(payments, many=True).data,
        })


# ── Payments ──────────────────────────────────────────────────────────────────

class AdminPaymentListView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        qs = PlatformPayment.objects.select_related('marina').order_by('-created_at')
        status_filter = request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        return Response(PlatformPaymentSerializer(qs, many=True).data)


# ── Subscriptions ─────────────────────────────────────────────────────────────

class AdminSubscriptionsView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        all_marinas = Marina.objects.all()

        plan_summary = {}
        for m in all_marinas.filter(status='active'):
            p = m.plan
            if p not in plan_summary:
                plan_summary[p] = {'plan': p, 'count': 0, 'revenue': 0}
            plan_summary[p]['count'] += 1
            plan_summary[p]['revenue'] += _mrr_for(m)

        return Response({
            'plan_summary': list(plan_summary.values()),
            'active': MarinaListSerializer(all_marinas.filter(status='active'), many=True).data,
            'trial': MarinaListSerializer(all_marinas.filter(status='trial'), many=True).data,
            'suspended': MarinaListSerializer(all_marinas.filter(status='suspended'), many=True).data,
        })


# ── Global Feature Flags ──────────────────────────────────────────────────────

class AdminFeatureFlagListView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        flags = GlobalFeatureFlag.objects.all()
        return Response(GlobalFeatureFlagSerializer(flags, many=True).data)


class AdminFeatureFlagDetailView(APIView):
    permission_classes = [IsPlatformAdmin]

    def patch(self, request, name):
        flag, _ = GlobalFeatureFlag.objects.get_or_create(name=name)
        enabled = request.data.get('enabled')
        if enabled is None:
            return Response({'detail': 'enabled field required.'}, status=http_status.HTTP_400_BAD_REQUEST)
        flag.enabled = bool(enabled)
        flag.updated_by = request.user
        flag.save(update_fields=['enabled', 'updated_by', 'updated_at'])
        _log(request.user, 'toggle_global_flag', detail={'flag': name, 'enabled': flag.enabled})
        return Response(GlobalFeatureFlagSerializer(flag).data)


# ── Audit Log ─────────────────────────────────────────────────────────────────

class AdminAuditLogView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        qs = AuditLog.objects.select_related('admin_user', 'target_marina').order_by('-created_at')
        marina_id = request.query_params.get('marina')
        if marina_id:
            qs = qs.filter(target_marina_id=marina_id)
        return Response(AuditLogSerializer(qs[:200], many=True).data)
```

- [ ] **Step 2: Commit**

```bash
git add backend/apps/admin_portal/views.py
git commit -m "feat(admin-portal): all admin views"
```

---

### Task 8: URLs + wire everything up

**Files:**
- Create: `backend/apps/admin_portal/urls.py`
- Modify: `backend/config/urls.py`

- [ ] **Step 1: Create urls.py**

Create `backend/apps/admin_portal/urls.py`:

```python
from django.urls import path
from .views import (
    AdminOverviewView,
    AdminMarinaListView, AdminMarinaDetailView,
    AdminMarinaSuspendView, AdminMarinaReinstateView,
    AdminMarinaConvertView, AdminMarinaImpersonateView,
    AdminMarinaResetPasswordView,
    AdminFinanceView, AdminPaymentListView,
    AdminSubscriptionsView,
    AdminFeatureFlagListView, AdminFeatureFlagDetailView,
    AdminAuditLogView,
)

urlpatterns = [
    path('overview/',                                  AdminOverviewView.as_view(),            name='admin_overview'),
    path('marinas/',                                   AdminMarinaListView.as_view(),          name='admin_marina_list'),
    path('marinas/<int:pk>/',                          AdminMarinaDetailView.as_view(),        name='admin_marina_detail'),
    path('marinas/<int:pk>/suspend/',                  AdminMarinaSuspendView.as_view(),       name='admin_marina_suspend'),
    path('marinas/<int:pk>/reinstate/',                AdminMarinaReinstateView.as_view(),     name='admin_marina_reinstate'),
    path('marinas/<int:pk>/convert/',                  AdminMarinaConvertView.as_view(),       name='admin_marina_convert'),
    path('marinas/<int:pk>/impersonate/',              AdminMarinaImpersonateView.as_view(),   name='admin_marina_impersonate'),
    path('marinas/<int:pk>/reset-password/',           AdminMarinaResetPasswordView.as_view(), name='admin_marina_reset_password'),
    path('finance/',                                   AdminFinanceView.as_view(),             name='admin_finance'),
    path('payments/',                                  AdminPaymentListView.as_view(),         name='admin_payments'),
    path('subscriptions/',                             AdminSubscriptionsView.as_view(),       name='admin_subscriptions'),
    path('feature-flags/',                             AdminFeatureFlagListView.as_view(),     name='admin_feature_flags'),
    path('feature-flags/<str:name>/',                  AdminFeatureFlagDetailView.as_view(),   name='admin_feature_flag_detail'),
    path('audit-logs/',                                AdminAuditLogView.as_view(),            name='admin_audit_logs'),
]
```

- [ ] **Step 2: Register in config/urls.py**

In `backend/config/urls.py`, add inside the `urlpatterns` list (at the top level, NOT inside `api/v1/`):

```python
path('api/admin/', include('apps.admin_portal.urls')),
```

Full updated file:

```python
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/admin/', include('apps.admin_portal.urls')),
    path('api/v1/', include([
        path('auth/', include('apps.accounts.urls')),
        path('', include('apps.berths.urls')),
        path('', include('apps.reservations.urls')),
        path('', include('apps.vessels.urls')),
        path('', include('apps.members.urls')),
        path('', include('apps.billing.urls')),
        path('', include('apps.maintenance.urls')),
        path('', include('apps.staff.urls')),
        path('', include('apps.boatyard.urls')),
        path('', include('apps.documents.urls')),
        path('', include('apps.restaurant.urls')),
        path('', include('apps.events.urls')),
        path('', include('apps.sales.urls')),
        path('', include('apps.reports.urls')),
        path('', include('apps.fuel_dock.urls')),
        path('marina/', include('apps.accounts.marina_urls')),
        path('', include('apps.portal.urls')),
    ])),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
```

- [ ] **Step 3: Run all admin_portal tests**

```bash
cd backend
python manage.py test apps.admin_portal --settings=config.settings.dev -v 2
```

Expected: all tests pass. If `test_impersonate_token_has_safe_mode_claim` fails because `PyJWT` is not installed, install it:

```bash
pip install PyJWT
echo "PyJWT>=2.8,<3.0" >> requirements.txt
```

Then re-run. Expected: all pass.

- [ ] **Step 4: Run full test suite**

```bash
python manage.py test --settings=config.settings.dev 2>&1 | tail -3
```

Expected: `OK` with no failures.

- [ ] **Step 5: System check**

```bash
python manage.py check --settings=config.settings.dev
```

Expected: no issues.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/admin_portal/urls.py backend/config/urls.py backend/requirements.txt
git commit -m "feat(admin-portal): wire URLs; full test suite green"
```

---

### Task 9: Make the test admin user a platform admin

**Files:**
- No code changes — management command only

- [ ] **Step 1: Grant platform admin to the dev superuser**

```bash
cd backend
python manage.py shell --settings=config.settings.dev -c "
from apps.accounts.models import User
u = User.objects.get(email='admin@email.com')
u.is_platform_admin = True
u.platform_role = 'admin'
u.save(update_fields=['is_platform_admin', 'platform_role'])
print('Done — is_platform_admin:', u.is_platform_admin)
"
```

Expected: `Done — is_platform_admin: True`

- [ ] **Step 2: Smoke test the overview endpoint**

```bash
# Get a token first
TOKEN=$(curl -s -X POST http://localhost:8000/api/v1/auth/token/ \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@email.com","password":"testpass123"}' | python -c "import sys,json; print(json.load(sys.stdin)['access'])")

# Hit the overview
curl -s http://localhost:8000/api/admin/overview/ \
  -H "Authorization: Bearer $TOKEN" | python -m json.tool
```

Expected: JSON response with `mrr`, `active_marinas`, `alerts`, etc.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat(admin-portal): backend complete — overview, marinas, finance, safe mode, audit, feature flags"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| is_platform_admin on User | Task 1 |
| Marina subscription fields (status, trial_ends, suspend_reason, features) | Task 1 |
| IsPlatformAdmin permission | Task 3 |
| IsSafeModeReadOnly — blocks writes globally | Task 3 |
| is_safe_mode in JWT claims | Task 7 (ImpersonateView) |
| JWT includes is_platform_admin | Task 3 |
| PlatformPayment model | Task 2 |
| AuditLog model | Task 2 |
| GlobalFeatureFlag model | Task 2 |
| Overview endpoint (MRR, counts, GMV, alerts) | Task 7 |
| Marina list + filter by status + search | Task 7 |
| Marina detail with staff list + active bookings | Task 7 |
| Marina PATCH (features toggle, plan, limits) | Task 7 |
| Suspend + reinstate + convert actions | Task 7 |
| Impersonate → safe-mode JWT | Task 7 |
| Password reset for staff user | Task 7 |
| Finance endpoint | Task 7 |
| Payments list + filter | Task 7 |
| Subscriptions breakdown | Task 7 |
| Global feature flags list + toggle | Task 7 |
| Audit log list + filter by marina | Task 7 |
| URLs registered at /api/admin/ | Task 8 |
| Full test suite green | Task 8 |
| Superadmin users with platform_role | Task 1 (model); frontend Plan 2 |
| Plan config / grandfathered price (mrr_override) | Task 1 + serializers |
| Churn rate | Overview returns 0; requires historical data for computation — deferred to Plan 2 or a future plan |

**No placeholders found.**
