# Platform Admin — Backend Level 2 + Marina Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add consent-gated impersonation (soft gate, Break-Glass alerting, per-action audit middleware) and the impersonation banner in the marina frontend.

**Architecture:** New `support_access_granted_until` field on Marina gates support agents; admins can override with a reason that fires a fire-and-forget thread alert. `ImpersonationAuditMiddleware` decodes the JWT on every request and creates an `AuditLog` entry for each mutating call during a session. The marina frontend reads `is_safe_mode` from the JWT and shows an un-dismissable red banner.

**Tech Stack:** Django, DRF, simplejwt, Python threading, React + Vite (banner only)

---

## File Map

| Action | File |
|---|---|
| Modify | `apps/accounts/models.py` — add `support_access_granted_until` to `Marina` |
| Create | `apps/accounts/migrations/0020_marina_support_access_granted_until.py` |
| Modify | `apps/accounts/serializers.py` — expose field in `MarinaSerializer` |
| Modify | `apps/accounts/views.py` — add `GrantSupportAccessView` |
| Modify | `apps/accounts/marina_urls.py` — wire new endpoint |
| Modify | `apps/admin_portal/models.py` — add `impersonation_session_id` + `impersonator_user_id` to `AuditLog` |
| Create | `apps/admin_portal/migrations/0002_auditlog_impersonation_fields.py` |
| Modify | `apps/admin_portal/serializers.py` — expose `support_access_granted_until` in `MarinaDetailSerializer` |
| Create | `apps/admin_portal/middleware.py` — `ImpersonationAuditMiddleware` |
| Modify | `config/settings/base.py` — register middleware |
| Modify | `apps/admin_portal/views.py` — upgrade `AdminMarinaImpersonateView` (JWT claims, soft gate, Break-Glass) |
| Create | `apps/admin_portal/tests_impersonation.py` — new test module for Level 2 |
| Create | `frontend/src/components/layout/ImpersonationBanner.jsx` |
| Modify | `frontend/src/App.jsx` — mount banner |
| Modify | `frontend/src/screens/Settings.jsx` — consent toggle section |

---

### Task 1: Marina model — support_access_granted_until

**Files:**
- Modify: `apps/accounts/models.py`
- Create: `apps/accounts/migrations/0020_marina_support_access_granted_until.py`

- [ ] **Step 1: Write the failing test**

File: `apps/accounts/tests/test_accounts.py` — add at the bottom:

```python
class SupportAccessFieldTest(TestCase):
    def test_field_exists_and_defaults_null(self):
        marina = Marina.objects.create(name='Test')
        self.assertIsNone(marina.support_access_granted_until)

    def test_field_accepts_datetime(self):
        from django.utils import timezone
        import datetime
        marina = Marina.objects.create(name='Test2')
        future = timezone.now() + datetime.timedelta(hours=48)
        marina.support_access_granted_until = future
        marina.save()
        marina.refresh_from_db()
        self.assertIsNotNone(marina.support_access_granted_until)
```

- [ ] **Step 2: Run to verify FAIL**

```
cd backend
python manage.py test apps.accounts.tests.test_accounts.SupportAccessFieldTest --settings=config.settings.test
```

Expected: `AttributeError: type object 'Marina' has no attribute 'support_access_granted_until'`

- [ ] **Step 3: Add field to Marina model**

In `apps/accounts/models.py`, add after the `waiver_template_id` field (around line 68):

```python
support_access_granted_until = models.DateTimeField(null=True, blank=True)
```

- [ ] **Step 4: Create migration**

```
python manage.py makemigrations accounts --name marina_support_access_granted_until --settings=config.settings.dev
```

- [ ] **Step 5: Run tests to verify PASS**

```
python manage.py test apps.accounts.tests.test_accounts.SupportAccessFieldTest --settings=config.settings.test
```

Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add apps/accounts/models.py apps/accounts/migrations/0020_marina_support_access_granted_until.py
git commit -m "feat(accounts): add support_access_granted_until to Marina"
```

---

### Task 2: AuditLog model — impersonation fields

**Files:**
- Modify: `apps/admin_portal/models.py`
- Create: `apps/admin_portal/migrations/0002_auditlog_impersonation_fields.py`

- [ ] **Step 1: Write the failing test**

File: `apps/admin_portal/tests.py` — add at top of file after imports:

```python
class AuditLogImpersonationFieldsTest(TestCase):
    def test_impersonation_fields_exist(self):
        marina = make_marina()
        admin = make_user(None, is_platform_admin=True)
        log = AuditLog.objects.create(
            admin_user=admin,
            action='test',
            target_marina=marina,
            impersonation_session_id='550e8400-e29b-41d4-a716-446655440000',
            impersonator_user_id=admin.pk,
        )
        self.assertEqual(str(log.impersonation_session_id), '550e8400-e29b-41d4-a716-446655440000')
        self.assertEqual(log.impersonator_user_id, admin.pk)
```

- [ ] **Step 2: Run to verify FAIL**

```
python manage.py test apps.admin_portal.tests.AuditLogImpersonationFieldsTest --settings=config.settings.test
```

Expected: `TypeError: AuditLog() got unexpected keyword arguments`

- [ ] **Step 3: Add fields to AuditLog**

In `apps/admin_portal/models.py`, update `AuditLog`:

```python
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
    impersonation_session_id = models.UUIDField(null=True, blank=True, db_index=True)
    impersonator_user_id = models.IntegerField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.admin_user} — {self.action} at {self.created_at}'
```

- [ ] **Step 4: Create migration**

```
python manage.py makemigrations admin_portal --name auditlog_impersonation_fields --settings=config.settings.dev
```

- [ ] **Step 5: Run tests to verify PASS**

```
python manage.py test apps.admin_portal.tests.AuditLogImpersonationFieldsTest --settings=config.settings.test
```

Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add apps/admin_portal/models.py apps/admin_portal/migrations/0002_auditlog_impersonation_fields.py
git commit -m "feat(admin_portal): add impersonation tracking fields to AuditLog"
```

---

### Task 3: GrantSupportAccessView

**Files:**
- Modify: `apps/accounts/views.py`
- Modify: `apps/accounts/marina_urls.py`
- Modify: `apps/accounts/serializers.py`

- [ ] **Step 1: Write failing tests**

Create `apps/accounts/tests/test_support_access.py`:

```python
import datetime
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from apps.accounts.models import Marina, User


def make_marina():
    return Marina.objects.create(name='Test Marina', status='active')


def make_user(marina, role='owner'):
    i = User.objects.count()
    return User.objects.create_user(
        email=f'u{i}@test.com', password='pass', marina=marina, role=role
    )


def auth(client, user):
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')


class GrantSupportAccessTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.owner = make_user(self.marina, 'owner')
        self.manager = make_user(self.marina, 'manager')
        self.client = APIClient()

    def test_owner_can_grant_access(self):
        auth(self.client, self.owner)
        resp = self.client.post('/api/v1/marina/grant-support-access/')
        self.assertEqual(resp.status_code, 200)
        self.marina.refresh_from_db()
        self.assertIsNotNone(self.marina.support_access_granted_until)
        # Should be ~48h from now
        diff = self.marina.support_access_granted_until - timezone.now()
        self.assertGreater(diff.total_seconds(), 47 * 3600)

    def test_manager_cannot_grant_access(self):
        auth(self.client, self.manager)
        resp = self.client.post('/api/v1/marina/grant-support-access/')
        self.assertEqual(resp.status_code, 403)

    def test_owner_can_revoke_access(self):
        self.marina.support_access_granted_until = timezone.now() + datetime.timedelta(hours=48)
        self.marina.save()
        auth(self.client, self.owner)
        resp = self.client.delete('/api/v1/marina/grant-support-access/')
        self.assertEqual(resp.status_code, 200)
        self.marina.refresh_from_db()
        self.assertIsNone(self.marina.support_access_granted_until)

    def test_unauthenticated_blocked(self):
        resp = self.client.post('/api/v1/marina/grant-support-access/')
        self.assertEqual(resp.status_code, 401)
```

- [ ] **Step 2: Run to verify FAIL**

```
python manage.py test apps.accounts.tests.test_support_access --settings=config.settings.test
```

Expected: `404` (endpoint doesn't exist yet)

- [ ] **Step 3: Add GrantSupportAccessView to views.py**

In `apps/accounts/views.py`, add at the bottom:

```python
import datetime as _dt
from django.utils import timezone as _tz


class GrantSupportAccessView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def _get_marina(self, request):
        if not request.user.marina:
            return None
        return request.user.marina

    def post(self, request):
        if request.user.role != 'owner':
            return Response({'detail': 'Only marina owners can grant support access.'}, status=status.HTTP_403_FORBIDDEN)
        marina = self._get_marina(request)
        if not marina:
            return Response({'detail': 'No marina found.'}, status=status.HTTP_400_BAD_REQUEST)
        marina.support_access_granted_until = _tz.now() + _dt.timedelta(hours=48)
        marina.save(update_fields=['support_access_granted_until'])
        return Response({
            'support_access_granted_until': marina.support_access_granted_until.isoformat(),
        })

    def delete(self, request):
        if request.user.role != 'owner':
            return Response({'detail': 'Only marina owners can revoke support access.'}, status=status.HTTP_403_FORBIDDEN)
        marina = self._get_marina(request)
        if not marina:
            return Response({'detail': 'No marina found.'}, status=status.HTTP_400_BAD_REQUEST)
        marina.support_access_granted_until = None
        marina.save(update_fields=['support_access_granted_until'])
        return Response({'support_access_granted_until': None})
```

- [ ] **Step 4: Register URL**

In `apps/accounts/marina_urls.py`:

```python
from django.urls import path
from .views import MarinaProfileView, MarinaUsersView, InviteUserView, UserDetailView, MarinaOverviewView, GrantSupportAccessView

urlpatterns = [
    path('profile/', MarinaProfileView.as_view(), name='marina_profile'),
    path('overview/', MarinaOverviewView.as_view(), name='marina_overview'),
    path('users/', MarinaUsersView.as_view(), name='marina_users'),
    path('users/invite/', InviteUserView.as_view(), name='invite_user'),
    path('users/<int:pk>/', UserDetailView.as_view(), name='user_detail'),
    path('grant-support-access/', GrantSupportAccessView.as_view(), name='grant_support_access'),
]
```

- [ ] **Step 5: Expose field in MarinaSerializer**

In `apps/accounts/serializers.py`, add `'support_access_granted_until'` to `MarinaSerializer.fields` and `read_only_fields`:

```python
fields = [
    # read-writable by the owner
    'name', 'address', 'lat', 'lng', 'timezone', 'contact_email', 'phone',
    'currency', 'vat_rate', 'vat_number', 'payment_terms', 'booking_mode',
    'total_berths', 'dry_storage_slots', 'max_loa', 'max_draft', 'fuel_berths',
    'operations_paused',
    # read-only: owner can see but not change
    'id', 'slug', 'status', 'plan', 'trial_ends', 'next_renewal', 'suspend_reason',
    'stripe_account_id', 'mrr_override', 'max_staff', 'features', 'onboarding',
    'created_at', 'support_access_granted_until',
]
read_only_fields = [
    'id', 'slug', 'status', 'plan', 'trial_ends', 'next_renewal', 'suspend_reason',
    'stripe_account_id', 'mrr_override', 'max_staff', 'onboarding',
    'created_at', 'support_access_granted_until',
]
```

- [ ] **Step 6: Run tests to verify PASS**

```
python manage.py test apps.accounts.tests.test_support_access --settings=config.settings.test
```

Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add apps/accounts/views.py apps/accounts/marina_urls.py apps/accounts/serializers.py apps/accounts/tests/test_support_access.py
git commit -m "feat(accounts): add GrantSupportAccessView — owner grant/revoke 48h consent"
```

---

### Task 4: ImpersonationAuditMiddleware

**Files:**
- Create: `apps/admin_portal/middleware.py`
- Modify: `config/settings/base.py`

- [ ] **Step 1: Write failing test**

Create `apps/admin_portal/tests_impersonation.py`:

```python
import uuid
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Marina, User
from apps.admin_portal.models import AuditLog


def make_marina(**kwargs):
    defaults = dict(name='Test Marina', status='active', currency='EUR')
    defaults.update(kwargs)
    return Marina.objects.create(**defaults)


def make_user(marina=None, is_platform_admin=False, role='owner', platform_role=''):
    i = User.objects.count()
    return User.objects.create_user(
        email=f'u{i}@test.com', password='pass',
        marina=marina, role=role,
        is_platform_admin=is_platform_admin,
        platform_role=platform_role,
    )


def _impersonation_token(target_user, impersonator_user, marina):
    session_id = str(uuid.uuid4())
    refresh = RefreshToken.for_user(target_user)
    refresh['is_safe_mode'] = True
    refresh['impersonated_marina'] = marina.name
    refresh['impersonated_marina_id'] = marina.pk
    refresh['impersonator_user_id'] = impersonator_user.pk
    refresh['impersonation_session_id'] = session_id
    refresh['role'] = target_user.role
    refresh['is_platform_admin'] = False
    return str(refresh.access_token), session_id


class ImpersonationAuditMiddlewareTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.owner = make_user(self.marina, role='owner')
        self.admin = make_user(None, is_platform_admin=True, platform_role='admin')
        self.client = APIClient()

    def test_post_during_impersonation_creates_audit_log(self):
        token, session_id = _impersonation_token(self.owner, self.admin, self.marina)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        # Hit any POST endpoint that exists
        self.client.post('/api/v1/marina/grant-support-access/')
        logs = AuditLog.objects.filter(impersonation_session_id=session_id)
        self.assertTrue(logs.exists())
        log = logs.first()
        self.assertEqual(log.impersonator_user_id, self.admin.pk)

    def test_get_during_impersonation_does_not_create_audit_log(self):
        token, session_id = _impersonation_token(self.owner, self.admin, self.marina)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        before = AuditLog.objects.filter(impersonation_session_id=session_id).count()
        self.client.get('/api/v1/marina/profile/')
        after = AuditLog.objects.filter(impersonation_session_id=session_id).count()
        self.assertEqual(before, after)

    def test_normal_token_does_not_create_impersonation_log(self):
        refresh = RefreshToken.for_user(self.owner)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
        before = AuditLog.objects.count()
        self.client.post('/api/v1/marina/grant-support-access/')
        after = AuditLog.objects.count()
        self.assertEqual(before, after)
```

- [ ] **Step 2: Run to verify FAIL**

```
python manage.py test apps.admin_portal.tests_impersonation.ImpersonationAuditMiddlewareTest --settings=config.settings.test
```

Expected: Tests fail — middleware doesn't exist yet.

- [ ] **Step 3: Create middleware**

Create `apps/admin_portal/middleware.py`:

```python
import base64
import json
import logging
import threading

logger = logging.getLogger(__name__)

_local = threading.local()


def get_impersonation_context():
    return getattr(_local, 'ctx', None)


def _parse_jwt_payload(request):
    auth = request.META.get('HTTP_AUTHORIZATION', '')
    if not auth.startswith('Bearer '):
        return {}
    parts = auth[7:].split('.')
    if len(parts) != 3:
        return {}
    padded = parts[1] + '=' * (4 - len(parts[1]) % 4)
    try:
        return json.loads(base64.urlsafe_b64decode(padded))
    except Exception:
        return {}


class ImpersonationAuditMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        payload = _parse_jwt_payload(request)
        is_impersonation = payload.get('is_safe_mode', False)

        if is_impersonation:
            _local.ctx = {
                'impersonator_user_id': payload.get('impersonator_user_id'),
                'impersonation_session_id': payload.get('impersonation_session_id'),
                'marina_id': payload.get('impersonated_marina_id'),
            }
        else:
            _local.ctx = None

        response = self.get_response(request)

        if is_impersonation and request.method in ('POST', 'PATCH', 'PUT', 'DELETE'):
            if 200 <= response.status_code < 300:
                try:
                    from apps.admin_portal.models import AuditLog
                    AuditLog.objects.create(
                        admin_user_id=payload.get('impersonator_user_id'),
                        action=f'impersonation:{request.method.lower()}:{request.path}',
                        target_marina_id=payload.get('impersonated_marina_id'),
                        impersonation_session_id=payload.get('impersonation_session_id'),
                        impersonator_user_id=payload.get('impersonator_user_id'),
                        detail={'status': response.status_code, 'path': request.path},
                    )
                except Exception as e:
                    logger.error('ImpersonationAuditMiddleware log failed: %s', e)

        _local.ctx = None
        return response
```

- [ ] **Step 4: Register in MIDDLEWARE**

In `config/settings/base.py`, add after `AuthenticationMiddleware`:

```python
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'csp.middleware.CSPMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'apps.accounts.middleware.TenantMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'apps.admin_portal.middleware.ImpersonationAuditMiddleware',  # ← add here
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]
```

- [ ] **Step 5: Run tests to verify PASS**

```
python manage.py test apps.admin_portal.tests_impersonation.ImpersonationAuditMiddlewareTest --settings=config.settings.test
```

Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add apps/admin_portal/middleware.py config/settings/base.py apps/admin_portal/tests_impersonation.py
git commit -m "feat(admin_portal): add ImpersonationAuditMiddleware — per-action logging during impersonation"
```

---

### Task 5: Upgrade AdminMarinaImpersonateView

**Files:**
- Modify: `apps/admin_portal/views.py`
- Modify: `apps/admin_portal/serializers.py` — expose `support_access_granted_until` in `MarinaDetailSerializer`

- [ ] **Step 1: Write failing tests**

In `apps/admin_portal/tests_impersonation.py`, add:

```python
import datetime
from django.utils import timezone


class ImpersonateViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.owner = make_user(self.marina, role='owner')
        self.support = make_user(None, is_platform_admin=True, platform_role='support')
        self.admin = make_user(None, is_platform_admin=True, platform_role='admin')
        self.client = APIClient()

    def _auth(self, user):
        refresh = RefreshToken.for_user(user)
        refresh['is_platform_admin'] = user.is_platform_admin
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')

    def test_support_blocked_without_consent(self):
        self._auth(self.support)
        resp = self.client.post(f'/api/admin/marinas/{self.marina.pk}/impersonate/')
        self.assertEqual(resp.status_code, 403)
        self.assertIn('not granted support access', resp.json()['detail'])

    def test_support_can_impersonate_with_valid_consent(self):
        self.marina.support_access_granted_until = timezone.now() + datetime.timedelta(hours=24)
        self.marina.save()
        self._auth(self.support)
        resp = self.client.post(f'/api/admin/marinas/{self.marina.pk}/impersonate/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('access', resp.json())

    def test_support_blocked_with_expired_consent(self):
        self.marina.support_access_granted_until = timezone.now() - datetime.timedelta(hours=1)
        self.marina.save()
        self._auth(self.support)
        resp = self.client.post(f'/api/admin/marinas/{self.marina.pk}/impersonate/')
        self.assertEqual(resp.status_code, 403)

    def test_admin_can_override_without_consent_with_reason(self):
        self._auth(self.admin)
        resp = self.client.post(
            f'/api/admin/marinas/{self.marina.pk}/impersonate/',
            {'bypass_reason': 'Emergency invoice issue'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        log = AuditLog.objects.get(action='impersonate_override')
        self.assertEqual(log.detail['bypass_reason'], 'Emergency invoice issue')

    def test_admin_override_requires_reason(self):
        self._auth(self.admin)
        resp = self.client.post(f'/api/admin/marinas/{self.marina.pk}/impersonate/', {}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('bypass_reason', resp.json()['detail'])

    def test_jwt_contains_impersonator_user_id(self):
        self.marina.support_access_granted_until = timezone.now() + datetime.timedelta(hours=24)
        self.marina.save()
        self._auth(self.support)
        resp = self.client.post(f'/api/admin/marinas/{self.marina.pk}/impersonate/')
        import base64, json
        token = resp.json()['access']
        padded = token.split('.')[1] + '=='
        payload = json.loads(base64.urlsafe_b64decode(padded))
        self.assertEqual(payload['impersonator_user_id'], self.support.pk)
        self.assertTrue(payload['is_safe_mode'])
        self.assertFalse(payload['is_platform_admin'])
```

- [ ] **Step 2: Run to verify FAIL**

```
python manage.py test apps.admin_portal.tests_impersonation.ImpersonateViewTest --settings=config.settings.test
```

Expected: Multiple failures — soft gate logic not yet implemented.

- [ ] **Step 3: Add Break-Glass alert helper and upgrade view**

In `apps/admin_portal/views.py`, add after the imports:

```python
import threading
import uuid as _uuid
import logging
_logger = logging.getLogger(__name__)


def _dispatch_break_glass_alerts(marina_email, marina_name, admin_email, bypass_reason):
    import datetime
    import requests
    from django.core.mail import send_mail
    from django.conf import settings as _s

    timestamp = datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')

    try:
        send_mail(
            subject='DocksBase Emergency Support Access',
            message=(
                f'A DocksBase support agent has accessed your marina via Emergency Override.\n\n'
                f'Marina: {marina_name}\n'
                f'Accessed by: {admin_email}\n'
                f'Time: {timestamp}\n'
                f'Justification: {bypass_reason}\n\n'
                f'If this was unexpected, contact support@docksbase.com immediately.'
            ),
            from_email='security@docksbase.com',
            recipient_list=[marina_email],
            fail_silently=False,
        )
    except Exception as e:
        _logger.error('Break-glass email failed: %s', e)

    webhook_url = getattr(_s, 'SECURITY_SLACK_WEBHOOK_URL', '')
    if webhook_url:
        try:
            requests.post(
                webhook_url,
                json={
                    'text': (
                        f':rotating_light: *Break-Glass Override*\n'
                        f'`{admin_email}` accessed *{marina_name}* without consent.\n'
                        f'Time: {timestamp} | Reason: {bypass_reason}'
                    )
                },
                timeout=3,
            )
        except Exception as e:
            _logger.error('Break-glass Slack alert failed: %s', e)
```

Replace the existing `AdminMarinaImpersonateView` class entirely:

```python
class AdminMarinaImpersonateView(APIView):
    permission_classes = [IsPlatformAdmin]

    def post(self, request, pk):
        from django.utils import timezone as _tz
        marina = get_object_or_404(Marina, pk=pk)

        target_user = User.objects.filter(
            marina=marina, role__in=['owner', 'manager'], is_active=True
        ).first()
        if not target_user:
            return Response(
                {'detail': 'No active owner or manager found for this marina.'},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        platform_role = getattr(request.user, 'platform_role', '')
        consent_valid = (
            marina.support_access_granted_until is not None
            and marina.support_access_granted_until > _tz.now()
        )
        is_override = False

        if platform_role == 'support' and not consent_valid:
            return Response(
                {'detail': 'This marina has not granted support access.'},
                status=http_status.HTTP_403_FORBIDDEN,
            )

        if platform_role == 'admin' and not consent_valid:
            bypass_reason = request.data.get('bypass_reason', '').strip()
            if not bypass_reason:
                return Response(
                    {'detail': 'bypass_reason is required when overriding consent.'},
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
            is_override = True

        session_id = str(_uuid.uuid4())
        refresh = RefreshToken.for_user(target_user)
        refresh['is_safe_mode'] = True
        refresh['impersonated_marina'] = marina.name
        refresh['impersonated_marina_id'] = marina.pk
        refresh['impersonator_user_id'] = request.user.pk
        refresh['impersonation_session_id'] = session_id
        refresh['role'] = target_user.role
        refresh['is_platform_admin'] = False

        action = 'impersonate_override' if is_override else 'impersonate'
        detail = {'target_user': target_user.email, 'session_id': session_id}
        if is_override:
            detail['bypass_reason'] = bypass_reason
        _log(request.user, action, marina, **detail)

        if is_override:
            threading.Thread(
                target=_dispatch_break_glass_alerts,
                args=(marina.contact_email, marina.name, request.user.email, bypass_reason),
                daemon=True,
            ).start()

        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'marina_name': marina.name,
            'user_email': target_user.email,
            'session_id': session_id,
        })
```

- [ ] **Step 4: Expose support_access_granted_until in MarinaDetailSerializer**

In `apps/admin_portal/serializers.py`, find `MarinaDetailSerializer` and add `'support_access_granted_until'` to its fields list. If it uses `fields = '__all__'`, add an explicit `read_only_fields = ['support_access_granted_until']`.

- [ ] **Step 5: Run tests to verify PASS**

```
python manage.py test apps.admin_portal.tests_impersonation.ImpersonateViewTest --settings=config.settings.test
```

Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add apps/admin_portal/views.py apps/admin_portal/serializers.py
git commit -m "feat(admin_portal): soft gate impersonation — consent check, JWT impersonator claims, Break-Glass thread alerts"
```

---

### Task 6: Marina frontend — consent toggle in Settings

**Files:**
- Modify: `frontend/src/screens/Settings.jsx`

- [ ] **Step 1: Find the right section in Settings.jsx**

Open `frontend/src/screens/Settings.jsx`. Find the section where plan/billing info is displayed (search for `plan` or `status`). The consent toggle will go in a new "DocksBase Support Access" section at the bottom of the page, after the existing sections.

- [ ] **Step 2: Add consent toggle component**

Add this section at the appropriate place in `Settings.jsx` (before the final closing fragment/div of the main content):

```jsx
function SupportAccessSection() {
  const { marina } = useMarina();
  const [grantedUntil, setGrantedUntil] = useState(marina?.support_access_granted_until || null);
  const [loading, setLoading] = useState(false);

  const isActive = grantedUntil && new Date(grantedUntil) > new Date();

  async function handleGrant() {
    setLoading(true);
    try {
      const { data } = await api.post('/marina/grant-support-access/');
      setGrantedUntil(data.support_access_granted_until);
    } finally {
      setLoading(false);
    }
  }

  async function handleRevoke() {
    setLoading(true);
    try {
      await api.delete('/marina/grant-support-access/');
      setGrantedUntil(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <h3>DocksBase Support Access</h3>
        <p className="settings-section-desc">
          Allow DocksBase support agents to access your account for troubleshooting.
          Access automatically expires after 48 hours.
        </p>
      </div>
      <div className="settings-row" style={{ alignItems: 'center', gap: 12 }}>
        <Toggle on={isActive} onChange={isActive ? handleRevoke : handleGrant} />
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {isActive
            ? `Access granted — expires ${formatDate(grantedUntil)}`
            : 'Support access not granted'}
        </span>
        {loading && <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Saving…</span>}
      </div>
    </section>
  );
}
```

Add `<SupportAccessSection />` at the bottom of the page's JSX, inside the existing layout.

Add `useState` to the existing import if it isn't already imported.

- [ ] **Step 3: Manual test**

Start the dev server (`npm run dev` in `frontend/`). Log in as an owner. Navigate to Settings. Confirm the "DocksBase Support Access" section appears. Toggle it on — confirm the expiry time appears. Toggle it off — confirm it clears. Check the network tab that the correct endpoints are called.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screens/Settings.jsx
git commit -m "feat(frontend): add DocksBase support access consent toggle in Settings"
```

---

### Task 7: Impersonation Banner

**Files:**
- Create: `frontend/src/components/layout/ImpersonationBanner.jsx`
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Create banner component**

Create `frontend/src/components/layout/ImpersonationBanner.jsx`:

```jsx
import { clearAuth } from '../../api.js';

function decodeJwtPayload(token) {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part));
  } catch {
    return {};
  }
}

export default function ImpersonationBanner() {
  const token = localStorage.getItem('access_token');
  if (!token) return null;

  const payload = decodeJwtPayload(token);
  if (!payload.is_safe_mode) return null;

  const adminUrl = import.meta.env.VITE_ADMIN_URL || 'http://localhost:5174';

  function exitSession() {
    clearAuth();
    window.location.href = adminUrl;
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999,
      background: '#DC2626', color: '#fff',
      padding: '8px 20px',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontSize: 13, fontWeight: 600,
      boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    }}>
      <span>⚠ IMPERSONATING {payload.impersonated_marina} — ALL ACTIONS ARE AUDITED</span>
      <button
        onClick={exitSession}
        style={{
          background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)',
          color: '#fff', padding: '4px 14px', borderRadius: 4, cursor: 'pointer',
          fontSize: 12, fontWeight: 600,
        }}
      >
        Exit Session
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Mount banner in App.jsx**

In `frontend/src/App.jsx`:

1. Add import at the top:
```jsx
import ImpersonationBanner from './components/layout/ImpersonationBanner.jsx';
```

2. Inside `DesktopApp`, before the `<AnimatePresence>` block, add:
```jsx
const token = localStorage.getItem('access_token');
const isSafeMode = (() => {
  try {
    if (!token) return false;
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(part)).is_safe_mode === true;
  } catch { return false; }
})();
```

3. Render the banner before all other content:
```jsx
return (
  <>
    <ImpersonationBanner />
    <AnimatePresence>
      {showWelcome && (
        <WelcomeScreen name={user?.first_name} onDone={dismissWelcome} />
      )}
    </AnimatePresence>
    <div className="app" style={isSafeMode ? { paddingTop: 36 } : {}}>
      <Sidebar screen={screen} setScreen={setScreen} />
      <div className="main">
        <Topbar screen={screen} />
        <div className="content">
          <ScreenErrorBoundary key={screen} setScreen={setScreen}>
            <Screen setScreen={setScreen} />
          </ScreenErrorBoundary>
        </div>
      </div>
      <SetupGuide setScreen={setScreen} />
    </div>
  </>
);
```

- [ ] **Step 3: Add VITE_ADMIN_URL to .env.local**

In `frontend/.env.local` (create if absent):
```
VITE_ADMIN_URL=http://localhost:5174
```

- [ ] **Step 4: Manual test**

Use the Django shell to get an impersonation JWT with `is_safe_mode=True` for a test marina:

```python
from rest_framework_simplejwt.tokens import RefreshToken
from apps.accounts.models import User
u = User.objects.filter(role='owner').first()
r = RefreshToken.for_user(u)
r['is_safe_mode'] = True
r['impersonated_marina'] = 'Test Marina'
print(str(r.access_token))
```

Paste the token into localStorage (`access_token`) in the browser console. Refresh the page. Confirm:
- Red banner appears at top with marina name
- App content is pushed down (not overlapped)
- "Exit Session" clears localStorage and redirects to `localhost:5174`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/layout/ImpersonationBanner.jsx frontend/src/App.jsx frontend/src/.env.local
git commit -m "feat(frontend): add impersonation banner — sticky red bar with exit session during safe mode"
```

---

### Task 8: Run full test suite

- [ ] **Step 1: Run all admin_portal and accounts tests**

```
python manage.py test apps.admin_portal apps.accounts --settings=config.settings.test -v 2
```

Expected: All tests pass. If any fail, fix before proceeding.

- [ ] **Step 2: Commit any fixes**

```bash
git add -p
git commit -m "fix: resolve any test failures after full suite run"
```
