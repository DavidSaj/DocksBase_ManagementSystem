# Enterprise Multi-Marina — Phase 1: Backend + Admin Portal

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the enterprise group backend (APIs, migration, SSO handoff) and add a Groups tab to the DocksBase admin portal with enterprise badge on the Marinas list.

**Architecture:** New `MarinaGroup` fields land in one migration. All admin-facing group APIs are added to `apps/admin_portal/` following existing APIView patterns. All enterprise-console-facing APIs live in a new `apps/enterprise/` app. The admin portal gets one new screen (`Groups.jsx`) and a minor update to `Marinas.jsx`.

**Tech Stack:** Django, DRF, SimpleJWT, pytest/Django TestCase, React + Vite (admin portal only for frontend tasks)

---

## File Map

**New files:**
- `backend/apps/enterprise/` — new Django app (console-facing APIs)
  - `__init__.py`
  - `apps.py`
  - `permissions.py`
  - `serializers.py`
  - `views.py`
  - `urls.py`
  - `tests/` — `__init__.py`, `test_group_apis.py`, `test_exchange_token.py`, `test_financials.py`
- `backend/apps/accounts/migrations/XXXX_marinagroup_additions.py` — auto-generated

**Modified files:**
- `backend/apps/accounts/models.py` — add 4 fields to `MarinaGroup`
- `backend/apps/admin_portal/views.py` — add 5 group management views
- `backend/apps/admin_portal/serializers.py` — add `MarinaGroupSerializer`
- `backend/apps/admin_portal/urls.py` — wire group endpoints
- `backend/config/urls.py` — register `enterprise/` app URLs
- `backend/config/settings/base.py` — add `apps.enterprise` to `INSTALLED_APPS`
- `admin/src/screens/Marinas.jsx` — enterprise badge + group sub-line
- `admin/src/App.jsx` (or router file) — add Groups route
- `admin/src/components/layout/Sidebar.jsx` — add Groups nav item

---

## Task 1: MarinaGroup model additions + migration

**Files:**
- Modify: `backend/apps/accounts/models.py`
- Create: migration (auto-generated)

- [ ] **Step 1: Add four fields to `MarinaGroup`**

In `backend/apps/accounts/models.py`, find the `MarinaGroup` class (line ~232) and update it:

```python
class MarinaGroup(models.Model):
    name                  = models.CharField(max_length=200)
    slug                  = models.SlugField(unique=True)
    max_marinas           = models.IntegerField(default=1)
    billing_contact_email = models.EmailField(blank=True)
    stripe_customer_id    = models.CharField(max_length=64, blank=True)
    base_currency         = models.CharField(max_length=3, default='EUR')
    created_at            = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name
```

- [ ] **Step 2: Generate migration**

```bash
cd DocksBase_ManagementSystem/backend
python manage.py makemigrations accounts --name marinagroup_additions
```

Expected: `Migrations for 'accounts': apps/accounts/migrations/XXXX_marinagroup_additions.py`

- [ ] **Step 3: Apply migration**

```bash
python manage.py migrate
```

Expected: `OK`

- [ ] **Step 4: Write tests**

Create `backend/apps/accounts/tests/test_marina_group.py`:

```python
from django.test import TestCase
from apps.accounts.models import MarinaGroup, MarinaGroupMembership, Marina


class MarinaGroupFieldsTest(TestCase):
    def test_default_fields(self):
        g = MarinaGroup.objects.create(name='Test Group', slug='test-group')
        self.assertEqual(g.max_marinas, 1)
        self.assertEqual(g.base_currency, 'EUR')
        self.assertEqual(g.billing_contact_email, '')
        self.assertEqual(g.stripe_customer_id, '')

    def test_custom_fields(self):
        g = MarinaGroup.objects.create(
            name='Big Group', slug='big-group',
            max_marinas=5, base_currency='GBP',
            billing_contact_email='billing@big.com',
        )
        self.assertEqual(g.max_marinas, 5)
        self.assertEqual(g.base_currency, 'GBP')
```

- [ ] **Step 5: Run tests**

```bash
python manage.py test apps.accounts.tests.test_marina_group -v 2
```

Expected: `OK` (2 tests passed)

- [ ] **Step 6: Commit**

```bash
git add apps/accounts/models.py apps/accounts/migrations/ apps/accounts/tests/test_marina_group.py
git commit -m "feat(enterprise): add MarinaGroup fields max_marinas, base_currency, billing_contact_email, stripe_customer_id"
```

---

## Task 2: Admin portal — MarinaGroup CRUD APIs

**Files:**
- Modify: `backend/apps/admin_portal/serializers.py`
- Modify: `backend/apps/admin_portal/views.py`
- Modify: `backend/apps/admin_portal/urls.py`

These views use `IsPlatformAdmin` — only David's admin users can call them.

- [ ] **Step 1: Write failing tests**

Create `backend/apps/admin_portal/tests/test_groups.py`:

```python
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, MarinaGroup, MarinaGroupMembership, User


def make_admin():
    m = Marina.objects.create(name='Admin Marina', slug='admin-marina')
    u = User.objects.create_user(email='admin@docksbase.com', password='pass', marina=m)
    u.is_platform_admin = True
    u.save()
    return u


class AdminGroupCRUDTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = make_admin()
        self.client.force_authenticate(self.admin)

    def test_create_group(self):
        resp = self.client.post('/api/v1/admin/groups/', {
            'name': 'Adriatic Ports',
            'slug': 'adriatic-ports',
            'max_marinas': 3,
            'base_currency': 'EUR',
            'billing_contact_email': 'billing@adriatic.com',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['name'], 'Adriatic Ports')
        self.assertEqual(resp.data['max_marinas'], 3)

    def test_list_groups(self):
        MarinaGroup.objects.create(name='G1', slug='g1')
        MarinaGroup.objects.create(name='G2', slug='g2')
        resp = self.client.get('/api/v1/admin/groups/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 2)

    def test_patch_group(self):
        g = MarinaGroup.objects.create(name='Old Name', slug='old-name', max_marinas=1)
        resp = self.client.patch(f'/api/v1/admin/groups/{g.pk}/', {'max_marinas': 5}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['max_marinas'], 5)

    def test_add_marina_to_group(self):
        g = MarinaGroup.objects.create(name='G', slug='g', max_marinas=2)
        m = Marina.objects.create(name='Port A', slug='port-a')
        resp = self.client.post(f'/api/v1/admin/groups/{g.pk}/add_marina/', {'marina_id': m.pk}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(MarinaGroupMembership.objects.filter(group=g, marina=m).exists())

    def test_add_marina_enforces_limit(self):
        g = MarinaGroup.objects.create(name='G', slug='g', max_marinas=1)
        m1 = Marina.objects.create(name='Port A', slug='port-a')
        m2 = Marina.objects.create(name='Port B', slug='port-b')
        MarinaGroupMembership.objects.create(group=g, marina=m1)
        resp = self.client.post(f'/api/v1/admin/groups/{g.pk}/add_marina/', {'marina_id': m2.pk}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('limit', resp.data['detail'].lower())

    def test_remove_marina_from_group(self):
        g = MarinaGroup.objects.create(name='G', slug='g')
        m = Marina.objects.create(name='Port A', slug='port-a')
        MarinaGroupMembership.objects.create(group=g, marina=m)
        resp = self.client.post(f'/api/v1/admin/groups/{g.pk}/remove_marina/', {'marina_id': m.pk}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(MarinaGroupMembership.objects.filter(group=g, marina=m).exists())

    def test_set_group_admin(self):
        g = MarinaGroup.objects.create(name='G', slug='g')
        u = User.objects.create_user(email='enterprise@owner.com', password='pass')
        resp = self.client.post(f'/api/v1/admin/groups/{g.pk}/set_admin/', {'email': 'enterprise@owner.com'}, format='json')
        self.assertEqual(resp.status_code, 200)
        from apps.accounts.models import MarinaGroupUserRole
        self.assertTrue(MarinaGroupUserRole.objects.filter(group=g, user=u, role='admin').exists())

    def test_unauthorized_access_rejected(self):
        non_admin = User.objects.create_user(email='regular@user.com', password='pass')
        c = APIClient()
        c.force_authenticate(non_admin)
        resp = c.get('/api/v1/admin/groups/')
        self.assertEqual(resp.status_code, 403)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python manage.py test apps.admin_portal.tests.test_groups -v 2
```

Expected: errors about missing URL/view (not 404s from bad logic)

- [ ] **Step 3: Add `MarinaGroupSerializer` to admin serializers**

Append to `backend/apps/admin_portal/serializers.py`:

```python
from apps.accounts.models import MarinaGroup, MarinaGroupMembership


class MarinaGroupMemberSerializer(serializers.ModelSerializer):
    group_name = serializers.CharField(source='group.name', read_only=True)

    class Meta:
        model = MarinaGroupMembership
        fields = ['id', 'marina_id', 'group_name']


class MarinaGroupSerializer(serializers.ModelSerializer):
    marina_count = serializers.SerializerMethodField()
    marinas = serializers.SerializerMethodField()

    class Meta:
        model = MarinaGroup
        fields = [
            'id', 'name', 'slug', 'max_marinas', 'base_currency',
            'billing_contact_email', 'stripe_customer_id',
            'marina_count', 'marinas', 'created_at',
        ]
        read_only_fields = ['id', 'marina_count', 'marinas', 'created_at']

    def get_marina_count(self, obj):
        return obj.memberships.count()

    def get_marinas(self, obj):
        return [
            {'id': m.marina.id, 'name': m.marina.name, 'slug': m.marina.slug}
            for m in obj.memberships.select_related('marina').all()
        ]
```

- [ ] **Step 4: Add group views to admin portal**

Append to `backend/apps/admin_portal/views.py`:

```python
from apps.accounts.models import MarinaGroup, MarinaGroupMembership, MarinaGroupUserRole
from .serializers import MarinaGroupSerializer


class AdminGroupListView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        qs = MarinaGroup.objects.all().order_by('-created_at')
        return Response(MarinaGroupSerializer(qs, many=True).data)

    def post(self, request):
        ser = MarinaGroupSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data, status=http_status.HTTP_201_CREATED)


class AdminGroupDetailView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request, pk):
        g = get_object_or_404(MarinaGroup, pk=pk)
        return Response(MarinaGroupSerializer(g).data)

    def patch(self, request, pk):
        g = get_object_or_404(MarinaGroup, pk=pk)
        ser = MarinaGroupSerializer(g, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)

    def delete(self, request, pk):
        g = get_object_or_404(MarinaGroup, pk=pk)
        g.delete()
        return Response(status=http_status.HTTP_204_NO_CONTENT)


class AdminGroupAddMarinaView(APIView):
    permission_classes = [IsPlatformAdmin]

    def post(self, request, pk):
        g = get_object_or_404(MarinaGroup, pk=pk)
        marina_id = request.data.get('marina_id')
        marina = get_object_or_404(Marina, pk=marina_id)
        if g.memberships.count() >= g.max_marinas:
            return Response(
                {'detail': f'Marina limit ({g.max_marinas}) reached for this group.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        MarinaGroupMembership.objects.get_or_create(group=g, marina=marina)
        return Response(MarinaGroupSerializer(g).data)


class AdminGroupRemoveMarinaView(APIView):
    permission_classes = [IsPlatformAdmin]

    def post(self, request, pk):
        g = get_object_or_404(MarinaGroup, pk=pk)
        marina_id = request.data.get('marina_id')
        marina = get_object_or_404(Marina, pk=marina_id)
        MarinaGroupMembership.objects.filter(group=g, marina=marina).delete()
        return Response(MarinaGroupSerializer(g).data)


class AdminGroupSetAdminView(APIView):
    permission_classes = [IsPlatformAdmin]

    def post(self, request, pk):
        g = get_object_or_404(MarinaGroup, pk=pk)
        email = request.data.get('email', '').strip()
        if not email:
            return Response({'detail': 'email is required.'}, status=http_status.HTTP_400_BAD_REQUEST)
        user = get_object_or_404(User, email=email)
        MarinaGroupUserRole.objects.update_or_create(
            group=g, user=user,
            defaults={'role': MarinaGroupUserRole.Role.ADMIN},
        )
        return Response({'detail': f'{email} set as admin for {g.name}.'})
```

- [ ] **Step 5: Wire URLs**

In `backend/apps/admin_portal/urls.py`, add these imports and URL patterns:

```python
from .views import (
    # ... existing imports ...
    AdminGroupListView, AdminGroupDetailView,
    AdminGroupAddMarinaView, AdminGroupRemoveMarinaView, AdminGroupSetAdminView,
)

urlpatterns = [
    # ... existing patterns ...
    path('groups/',                                  AdminGroupListView.as_view(),         name='admin_group_list'),
    path('groups/<int:pk>/',                         AdminGroupDetailView.as_view(),       name='admin_group_detail'),
    path('groups/<int:pk>/add_marina/',              AdminGroupAddMarinaView.as_view(),    name='admin_group_add_marina'),
    path('groups/<int:pk>/remove_marina/',           AdminGroupRemoveMarinaView.as_view(), name='admin_group_remove_marina'),
    path('groups/<int:pk>/set_admin/',               AdminGroupSetAdminView.as_view(),     name='admin_group_set_admin'),
]
```

- [ ] **Step 6: Run tests**

```bash
python manage.py test apps.admin_portal.tests.test_groups -v 2
```

Expected: all 8 tests pass

- [ ] **Step 7: Commit**

```bash
git add apps/admin_portal/serializers.py apps/admin_portal/views.py apps/admin_portal/urls.py apps/admin_portal/tests/
git commit -m "feat(enterprise): admin portal group management APIs"
```

---

## Task 3: Enterprise console app scaffold

**Files:**
- Create: `backend/apps/enterprise/__init__.py`
- Create: `backend/apps/enterprise/apps.py`
- Create: `backend/apps/enterprise/permissions.py`
- Create: `backend/config/settings/base.py` (modify INSTALLED_APPS)
- Create: `backend/config/urls.py` (modify)

- [ ] **Step 1: Create app skeleton**

```bash
cd backend
python manage.py startapp enterprise apps/enterprise
```

- [ ] **Step 2: Update `apps.py`**

```python
# backend/apps/enterprise/apps.py
from django.apps import AppConfig

class EnterpriseConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.enterprise'
```

- [ ] **Step 3: Add to INSTALLED_APPS**

In `backend/config/settings/base.py`, add `'apps.enterprise'` to the `INSTALLED_APPS` list alongside the other apps.

- [ ] **Step 4: Create `permissions.py`**

```python
# backend/apps/enterprise/permissions.py
from rest_framework.permissions import BasePermission
from apps.accounts.models import MarinaGroupUserRole


class IsGroupAdmin(BasePermission):
    """
    Request must include `group_pk` URL kwarg.
    User must have MarinaGroupUserRole.admin for that group.
    """
    def has_permission(self, request, view):
        if not request.user or not request.user.is_authenticated:
            return False
        group_pk = view.kwargs.get('group_pk') or view.kwargs.get('pk')
        return MarinaGroupUserRole.objects.filter(
            user=request.user,
            group_id=group_pk,
            role=MarinaGroupUserRole.Role.ADMIN,
        ).exists()
```

- [ ] **Step 5: Create empty `views.py`, `serializers.py`, `urls.py`**

```python
# backend/apps/enterprise/views.py
# (populated in later tasks)
```

```python
# backend/apps/enterprise/serializers.py
# (populated in later tasks)
```

```python
# backend/apps/enterprise/urls.py
from django.urls import path
urlpatterns = []
```

- [ ] **Step 6: Register in `config/urls.py`**

In `backend/config/urls.py`, add inside the `api/v1/` include block:

```python
path('enterprise/', include('apps.enterprise.urls')),
```

- [ ] **Step 7: Commit**

```bash
git add apps/enterprise/ config/settings/base.py config/urls.py
git commit -m "feat(enterprise): scaffold enterprise app"
```

---

## Task 4: Enterprise console — `me/` and `overview/` endpoints

**Files:**
- Modify: `backend/apps/enterprise/serializers.py`
- Modify: `backend/apps/enterprise/views.py`
- Modify: `backend/apps/enterprise/urls.py`
- Create: `backend/apps/enterprise/tests/__init__.py`
- Create: `backend/apps/enterprise/tests/test_group_apis.py`

- [ ] **Step 1: Write failing tests**

Create `backend/apps/enterprise/tests/__init__.py` (empty).

Create `backend/apps/enterprise/tests/test_group_apis.py`:

```python
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, MarinaGroup, MarinaGroupMembership, MarinaGroupUserRole, User


def make_enterprise_setup():
    """Returns (group, [marina1, marina2], enterprise_admin_user)."""
    g = MarinaGroup.objects.create(name='Test Group', slug='test-group', max_marinas=3, base_currency='EUR')
    m1 = Marina.objects.create(name='Port Alpha', slug='port-alpha', total_berths=50, status='active', currency='EUR')
    m2 = Marina.objects.create(name='Port Beta', slug='port-beta', total_berths=30, status='active', currency='EUR')
    MarinaGroupMembership.objects.create(group=g, marina=m1)
    MarinaGroupMembership.objects.create(group=g, marina=m2)
    u = User.objects.create_user(email='ceo@group.com', password='pass')
    MarinaGroupUserRole.objects.create(group=g, user=u, role=MarinaGroupUserRole.Role.ADMIN)
    return g, [m1, m2], u


class MeViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.g, self.marinas, self.user = make_enterprise_setup()
        self.client.force_authenticate(self.user)

    def test_me_returns_groups(self):
        resp = self.client.get('/api/v1/enterprise/me/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data['groups']), 1)
        self.assertEqual(resp.data['groups'][0]['name'], 'Test Group')

    def test_me_unauthenticated(self):
        c = APIClient()
        resp = c.get('/api/v1/enterprise/me/')
        self.assertEqual(resp.status_code, 401)


class OverviewViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.g, self.marinas, self.user = make_enterprise_setup()
        self.client.force_authenticate(self.user)

    def test_overview_returns_marina_cards(self):
        resp = self.client.get(f'/api/v1/enterprise/groups/{self.g.pk}/overview/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('marinas', resp.data)
        self.assertEqual(len(resp.data['marinas']), 2)
        card = resp.data['marinas'][0]
        self.assertIn('name', card)
        self.assertIn('total_berths', card)
        self.assertIn('occupancy_pct', card)
        self.assertIn('revenue_this_month', card)
        self.assertIn('status', card)

    def test_overview_kpi_strip(self):
        resp = self.client.get(f'/api/v1/enterprise/groups/{self.g.pk}/overview/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('kpis', resp.data)
        kpis = resp.data['kpis']
        self.assertIn('total_berths', kpis)
        self.assertIn('total_active_bookings', kpis)
        self.assertIn('total_mrr', kpis)
        self.assertIn('total_outstanding', kpis)

    def test_overview_non_member_rejected(self):
        other = User.objects.create_user(email='outsider@x.com', password='pass')
        c = APIClient()
        c.force_authenticate(other)
        resp = c.get(f'/api/v1/enterprise/groups/{self.g.pk}/overview/')
        self.assertEqual(resp.status_code, 403)
```

- [ ] **Step 2: Run to verify they fail**

```bash
python manage.py test apps.enterprise.tests.test_group_apis -v 2
```

Expected: errors about missing URLs

- [ ] **Step 3: Add serializers**

```python
# backend/apps/enterprise/serializers.py
from rest_framework import serializers
from apps.accounts.models import MarinaGroup, MarinaGroupUserRole
from django.db.models import Sum
from decimal import Decimal


class GroupSummarySerializer(serializers.ModelSerializer):
    marina_count = serializers.SerializerMethodField()

    class Meta:
        model = MarinaGroup
        fields = ['id', 'name', 'slug', 'base_currency', 'marina_count', 'max_marinas']

    def get_marina_count(self, obj):
        return obj.memberships.count()


def _active_bookings_count(marina):
    return marina.bookings.filter(
        status__in=['confirmed', 'pending', 'checked_in', 'awaiting_payment', 'pending_payment']
    ).count()


def _revenue_this_month(marina):
    from django.utils import timezone
    from apps.billing.models import Invoice
    now = timezone.now()
    period = f'{now.year}-{now.month:02d}'
    total = Invoice.objects.filter(
        marina=marina, status='paid', billing_period=period
    ).aggregate(t=Sum('total'))['t']
    return str(total or Decimal('0.00'))


def build_marina_card(marina):
    active = _active_bookings_count(marina)
    occupancy = round(active / marina.total_berths * 100, 1) if marina.total_berths else 0
    return {
        'id':                marina.id,
        'name':              marina.name,
        'slug':              marina.slug,
        'status':            marina.status,
        'total_berths':      marina.total_berths,
        'active_bookings':   active,
        'occupancy_pct':     occupancy,
        'revenue_this_month': _revenue_this_month(marina),
        'currency':          marina.currency,
    }
```

- [ ] **Step 4: Add `MeView` and `GroupOverviewView`**

```python
# backend/apps/enterprise/views.py
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status as http_status
from django.shortcuts import get_object_or_404
from django.db.models import Sum
from decimal import Decimal

from apps.accounts.models import MarinaGroup, MarinaGroupUserRole
from apps.billing.models import Invoice
from .permissions import IsGroupAdmin
from .serializers import GroupSummarySerializer, build_marina_card


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        roles = MarinaGroupUserRole.objects.filter(
            user=request.user
        ).select_related('group')
        groups = [r.group for r in roles]
        return Response({'groups': GroupSummarySerializer(groups, many=True).data})


class GroupOverviewView(APIView):
    permission_classes = [IsGroupAdmin]

    def get(self, request, pk):
        group = get_object_or_404(MarinaGroup, pk=pk)
        marinas = [m.marina for m in group.memberships.select_related('marina').all()]
        cards = [build_marina_card(m) for m in marinas]

        total_berths = sum(m.total_berths for m in marinas)
        total_active = sum(c['active_bookings'] for c in cards)
        total_outstanding = Invoice.objects.filter(
            marina__in=marinas, status__in=['unpaid', 'open']
        ).aggregate(t=Sum('total'))['t'] or Decimal('0')

        from config.plans import PLAN_MONTHLY_PRICES
        total_mrr = sum(
            PLAN_MONTHLY_PRICES.get(m.plan, 0) for m in marinas
        )

        return Response({
            'kpis': {
                'total_berths': total_berths,
                'total_active_bookings': total_active,
                'total_mrr': total_mrr,
                'total_outstanding': str(total_outstanding),
            },
            'marinas': cards,
        })
```

- [ ] **Step 5: Wire URLs**

```python
# backend/apps/enterprise/urls.py
from django.urls import path
from .views import MeView, GroupOverviewView

urlpatterns = [
    path('me/',                             MeView.as_view(),          name='enterprise_me'),
    path('groups/<int:pk>/overview/',       GroupOverviewView.as_view(), name='enterprise_overview'),
]
```

- [ ] **Step 6: Run tests**

```bash
python manage.py test apps.enterprise.tests.test_group_apis -v 2
```

Expected: all 6 tests pass

- [ ] **Step 7: Commit**

```bash
git add apps/enterprise/
git commit -m "feat(enterprise): me/ and overview/ endpoints"
```

---

## Task 5: Enterprise console — `financials/` endpoint

**Files:**
- Modify: `backend/apps/enterprise/views.py`
- Modify: `backend/apps/enterprise/urls.py`
- Create: `backend/apps/enterprise/tests/test_financials.py`

- [ ] **Step 1: Write failing tests**

Create `backend/apps/enterprise/tests/test_financials.py`:

```python
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, MarinaGroup, MarinaGroupMembership, MarinaGroupUserRole, User
from apps.billing.models import Invoice


def make_enterprise_setup():
    g = MarinaGroup.objects.create(name='Test Group', slug='test-grp', max_marinas=3, base_currency='EUR')
    m1 = Marina.objects.create(name='Port Alpha', slug='pa', currency='EUR', status='active')
    m2 = Marina.objects.create(name='Port Beta', slug='pb', currency='EUR', status='active')
    MarinaGroupMembership.objects.create(group=g, marina=m1)
    MarinaGroupMembership.objects.create(group=g, marina=m2)
    u = User.objects.create_user(email='cfo@group.com', password='pass')
    MarinaGroupUserRole.objects.create(group=g, user=u, role=MarinaGroupUserRole.Role.ADMIN)
    return g, m1, m2, u


class FinancialsViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.g, self.m1, self.m2, self.user = make_enterprise_setup()
        self.client.force_authenticate(self.user)

    def test_financials_returns_required_keys(self):
        resp = self.client.get(f'/api/v1/enterprise/groups/{self.g.pk}/financials/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('base_currency', resp.data)
        self.assertIn('paid_this_month', resp.data)
        self.assertIn('outstanding', resp.data)
        self.assertIn('mrr', resp.data)
        self.assertIn('monthly_revenue', resp.data)
        self.assertIn('missing_fx', resp.data)

    def test_financials_aggregates_same_currency(self):
        from django.utils import timezone
        period = f'{timezone.now().year}-{timezone.now().month:02d}'
        Invoice.objects.create(marina=self.m1, invoice_number='INV-001', status='paid',
                               billing_period=period, total='100.00', subtotal='100.00')
        Invoice.objects.create(marina=self.m2, invoice_number='INV-002', status='paid',
                               billing_period=period, total='200.00', subtotal='200.00')
        resp = self.client.get(f'/api/v1/enterprise/groups/{self.g.pk}/financials/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['base_currency'], 'EUR')
        self.assertAlmostEqual(float(resp.data['paid_this_month']), 300.0, places=1)

    def test_financials_outstanding(self):
        Invoice.objects.create(marina=self.m1, invoice_number='INV-003', status='unpaid',
                               total='500.00', subtotal='500.00')
        resp = self.client.get(f'/api/v1/enterprise/groups/{self.g.pk}/financials/')
        self.assertAlmostEqual(float(resp.data['outstanding']), 500.0, places=1)

    def test_monthly_revenue_has_12_entries(self):
        resp = self.client.get(f'/api/v1/enterprise/groups/{self.g.pk}/financials/')
        self.assertEqual(len(resp.data['monthly_revenue']), 12)

    def test_non_member_rejected(self):
        other = User.objects.create_user(email='outsider@x.com', password='pass')
        c = APIClient()
        c.force_authenticate(other)
        resp = c.get(f'/api/v1/enterprise/groups/{self.g.pk}/financials/')
        self.assertEqual(resp.status_code, 403)
```

- [ ] **Step 2: Run to verify they fail**

```bash
python manage.py test apps.enterprise.tests.test_financials -v 2
```

Expected: URL not found errors

- [ ] **Step 3: Implement `GroupFinancialsView`**

Append to `backend/apps/enterprise/views.py`:

```python
import datetime


class GroupFinancialsView(APIView):
    permission_classes = [IsGroupAdmin]

    def get(self, request, pk):
        from apps.accounting.models import ExchangeRate

        group = get_object_or_404(MarinaGroup, pk=pk)
        marinas = [m.marina for m in group.memberships.select_related('marina').all()]
        base_currency = group.base_currency
        today = datetime.date.today()
        missing_fx = []

        def to_base(amount, from_currency):
            if from_currency == base_currency:
                return amount
            rate = ExchangeRate.objects.filter(
                from_currency=from_currency,
                to_currency=base_currency,
            ).order_by('-id').first()
            if not rate:
                if from_currency not in missing_fx:
                    missing_fx.append(from_currency)
                return None
            return amount * rate.rate

        # Paid this month
        from django.utils import timezone as _tz
        now = _tz.now()
        period = f'{now.year}-{now.month:02d}'
        paid_total = Decimal('0')
        for marina in marinas:
            raw = Invoice.objects.filter(
                marina=marina, status='paid', billing_period=period
            ).aggregate(t=Sum('total'))['t'] or Decimal('0')
            converted = to_base(raw, marina.currency)
            if converted is not None:
                paid_total += converted

        # Outstanding
        outstanding_total = Decimal('0')
        for marina in marinas:
            raw = Invoice.objects.filter(
                marina=marina, status__in=['unpaid', 'open']
            ).aggregate(t=Sum('total'))['t'] or Decimal('0')
            converted = to_base(raw, marina.currency)
            if converted is not None:
                outstanding_total += converted

        # MRR (plan-based, same as admin portal)
        from config.plans import PLAN_MONTHLY_PRICES
        mrr = sum(PLAN_MONTHLY_PRICES.get(m.plan, 0) for m in marinas)

        # Monthly revenue — 12 months rolling, one entry per month
        monthly_revenue = []
        for i in range(11, -1, -1):
            # walk back i months from current
            month_date = (today.replace(day=1) - datetime.timedelta(days=1))
            if i > 0:
                d = today
                for _ in range(i):
                    d = (d.replace(day=1) - datetime.timedelta(days=1))
                month_date = d
            else:
                month_date = today
            bp = f'{month_date.year}-{month_date.month:02d}'
            month_total = Decimal('0')
            by_marina = []
            for marina in marinas:
                raw = Invoice.objects.filter(
                    marina=marina, status='paid', billing_period=bp
                ).aggregate(t=Sum('total'))['t'] or Decimal('0')
                converted = to_base(raw, marina.currency)
                val = converted if converted is not None else Decimal('0')
                month_total += val
                by_marina.append({'marina_id': marina.id, 'marina_name': marina.name, 'amount': str(val)})
            monthly_revenue.append({'period': bp, 'total': str(month_total), 'by_marina': by_marina})

        return Response({
            'base_currency':   base_currency,
            'paid_this_month': str(paid_total),
            'outstanding':     str(outstanding_total),
            'mrr':             mrr,
            'monthly_revenue': monthly_revenue,
            'missing_fx':      missing_fx,
        })
```

- [ ] **Step 4: Wire URL**

In `backend/apps/enterprise/urls.py`:

```python
from django.urls import path
from .views import MeView, GroupOverviewView, GroupFinancialsView

urlpatterns = [
    path('me/',                              MeView.as_view(),             name='enterprise_me'),
    path('groups/<int:pk>/overview/',        GroupOverviewView.as_view(),   name='enterprise_overview'),
    path('groups/<int:pk>/financials/',      GroupFinancialsView.as_view(), name='enterprise_financials'),
]
```

- [ ] **Step 5: Run tests**

```bash
python manage.py test apps.enterprise.tests.test_financials -v 2
```

Expected: all 5 tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/enterprise/
git commit -m "feat(enterprise): group financials endpoint with multi-currency FX conversion"
```

---

## Task 6: Enterprise console — `staff/` and `exchange_token/` endpoints

**Files:**
- Modify: `backend/apps/enterprise/views.py`
- Modify: `backend/apps/enterprise/urls.py`
- Create: `backend/apps/enterprise/tests/test_exchange_token.py`

- [ ] **Step 1: Write failing tests**

Create `backend/apps/enterprise/tests/test_exchange_token.py`:

```python
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, MarinaGroup, MarinaGroupMembership, MarinaGroupUserRole, User


def make_setup():
    g = MarinaGroup.objects.create(name='G', slug='g', max_marinas=2)
    m = Marina.objects.create(name='Port A', slug='port-a')
    MarinaGroupMembership.objects.create(group=g, marina=m)
    u = User.objects.create_user(email='boss@group.com', password='pass')
    MarinaGroupUserRole.objects.create(group=g, user=u, role=MarinaGroupUserRole.Role.ADMIN)
    # A marina-level manager for staff tests
    staff = User.objects.create_user(email='mgr@port-a.com', password='pass',
                                     marina=m, role='manager', first_name='Jack', last_name='Smith')
    return g, m, u, staff


class ExchangeTokenTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.g, self.m, self.user, self.staff = make_setup()
        self.client.force_authenticate(self.user)

    def test_exchange_token_returns_access_token(self):
        resp = self.client.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/exchange_token/',
            {'marina_id': self.m.pk}, format='json'
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn('access', resp.data)
        self.assertIn('marina_slug', resp.data)

    def test_exchange_token_rejects_non_member_marina(self):
        other_marina = Marina.objects.create(name='Other', slug='other')
        resp = self.client.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/exchange_token/',
            {'marina_id': other_marina.pk}, format='json'
        )
        self.assertEqual(resp.status_code, 400)

    def test_exchange_token_requires_group_admin(self):
        outsider = User.objects.create_user(email='x@x.com', password='pass')
        c = APIClient()
        c.force_authenticate(outsider)
        resp = c.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/exchange_token/',
            {'marina_id': self.m.pk}, format='json'
        )
        self.assertEqual(resp.status_code, 403)


class StaffViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.g, self.m, self.user, self.staff = make_setup()
        self.client.force_authenticate(self.user)

    def test_staff_lists_marina_managers(self):
        resp = self.client.get(f'/api/v1/enterprise/groups/{self.g.pk}/staff/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data), 1)
        self.assertEqual(resp.data[0]['email'], 'mgr@port-a.com')
        self.assertIn('marina_name', resp.data[0])
```

- [ ] **Step 2: Run to verify they fail**

```bash
python manage.py test apps.enterprise.tests.test_exchange_token -v 2
```

Expected: URL not found errors

- [ ] **Step 3: Implement views**

Append to `backend/apps/enterprise/views.py`:

```python
from rest_framework_simplejwt.tokens import RefreshToken


class GroupStaffView(APIView):
    permission_classes = [IsGroupAdmin]

    def get(self, request, pk):
        group = get_object_or_404(MarinaGroup, pk=pk)
        marinas = [m.marina for m in group.memberships.select_related('marina').all()]
        staff = []
        for marina in marinas:
            managers = marina.users.filter(
                role__in=['owner', 'manager'], is_active=True
            ).values('id', 'email', 'first_name', 'last_name', 'role')
            for m in managers:
                staff.append({
                    **m,
                    'name': f"{m['first_name']} {m['last_name']}".strip() or m['email'],
                    'marina_id': marina.id,
                    'marina_name': marina.name,
                })
        return Response(staff)


class GroupExchangeTokenView(APIView):
    permission_classes = [IsGroupAdmin]

    def post(self, request, pk):
        group = get_object_or_404(MarinaGroup, pk=pk)
        marina_id = request.data.get('marina_id')
        if not marina_id:
            return Response({'detail': 'marina_id is required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        is_member = group.memberships.filter(marina_id=marina_id).exists()
        if not is_member:
            return Response(
                {'detail': 'Marina is not a member of this group.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        marina = get_object_or_404(Marina, pk=marina_id)

        # Issue a scoped JWT: the token carries the marina context so the
        # marina frontend permission classes see a normal marina-scoped session.
        # We mint against the enterprise admin's own user record.
        import datetime as _dt
        refresh = RefreshToken.for_user(request.user)
        refresh['scoped_marina_id'] = marina_id
        refresh['scoped_marina_slug'] = marina.slug
        refresh['is_enterprise_sso'] = True
        # Short-lived: 60 seconds for the handoff, then the marina frontend
        # exchanges it for a normal session.
        access = refresh.access_token
        access.set_exp(lifetime=_dt.timedelta(seconds=60))

        return Response({
            'access': str(access),
            'marina_slug': marina.slug,
        })
```

- [ ] **Step 4: Wire URLs**

```python
# backend/apps/enterprise/urls.py
from django.urls import path
from .views import MeView, GroupOverviewView, GroupFinancialsView, GroupStaffView, GroupExchangeTokenView

urlpatterns = [
    path('me/',                                  MeView.as_view(),                name='enterprise_me'),
    path('groups/<int:pk>/overview/',            GroupOverviewView.as_view(),      name='enterprise_overview'),
    path('groups/<int:pk>/financials/',          GroupFinancialsView.as_view(),    name='enterprise_financials'),
    path('groups/<int:pk>/staff/',               GroupStaffView.as_view(),         name='enterprise_staff'),
    path('groups/<int:pk>/exchange_token/',      GroupExchangeTokenView.as_view(), name='enterprise_exchange_token'),
]
```

- [ ] **Step 5: Run tests**

```bash
python manage.py test apps.enterprise.tests -v 2
```

Expected: all tests pass across all test files in `apps.enterprise`

- [ ] **Step 6: Commit**

```bash
git add apps/enterprise/
git commit -m "feat(enterprise): staff list and SSO exchange_token endpoints"
```

---

## Task 7: Admin portal — Groups.jsx screen

**Files:**
- Create: `admin/src/screens/Groups.jsx`

The pattern to follow is exactly `admin/src/screens/Marinas.jsx` — table on the left, detail panel on the right, same CSS classes.

- [ ] **Step 1: Create `Groups.jsx`**

Create `admin/src/screens/Groups.jsx`:

```jsx
import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';
import Ic from '../components/ui/Icon.jsx';

function GroupDetailPanel({ group, onClose, onUpdate, allMarinas }) {
  const [acting, setActing] = useState(false);
  const [addMarinaId, setAddMarinaId] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [editing, setEditing] = useState({});

  if (!group) return (
    <div className="detail-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: 300, color: 'rgba(0,0,0,0.28)', gap: 8 }}>
      <Ic n="layers" s={28} c="rgba(0,0,0,0.15)" />
      <div style={{ fontSize: 12 }}>Select a group to view details</div>
    </div>
  );

  async function handleSave() {
    if (!Object.keys(editing).length) return;
    setActing(true);
    try {
      const { data } = await api.patch(`admin/groups/${group.id}/`, editing);
      onUpdate(data);
      setEditing({});
    } catch { /* ignore */ } finally { setActing(false); }
  }

  async function handleAddMarina() {
    if (!addMarinaId) return;
    setActing(true);
    try {
      const { data } = await api.post(`admin/groups/${group.id}/add_marina/`, { marina_id: parseInt(addMarinaId) });
      onUpdate(data);
      setAddMarinaId('');
    } catch (e) {
      window.alert(e.response?.data?.detail || 'Failed to add marina');
    } finally { setActing(false); }
  }

  async function handleRemoveMarina(marinaId) {
    setActing(true);
    try {
      const { data } = await api.post(`admin/groups/${group.id}/remove_marina/`, { marina_id: marinaId });
      onUpdate(data);
    } catch { /* ignore */ } finally { setActing(false); }
  }

  async function handleSetAdmin() {
    if (!adminEmail.trim()) return;
    setActing(true);
    try {
      await api.post(`admin/groups/${group.id}/set_admin/`, { email: adminEmail.trim() });
      setAdminEmail('');
      window.alert('Admin assigned.');
    } catch (e) {
      window.alert(e.response?.data?.detail || 'Failed to set admin');
    } finally { setActing(false); }
  }

  const availableMarinas = allMarinas.filter(m => !group.marinas?.some(gm => gm.id === m.id));
  const val = (field) => editing[field] !== undefined ? editing[field] : group[field];
  const set = (field, value) => setEditing(prev => ({ ...prev, [field]: value }));

  return (
    <div className="detail-panel">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div className="detail-panel-title">{group.name}</div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} style={{ padding: '4px 8px' }}>
          <Ic n="x" s={12} />
        </button>
      </div>

      {[
        ['Name',            'name',                  'text'],
        ['Billing email',   'billing_contact_email', 'email'],
        ['Base currency',   'base_currency',         'text'],
        ['Marina limit',    'max_marinas',            'number'],
      ].map(([label, field, type]) => (
        <div key={field} className="detail-row">
          <span className="detail-key">{label}</span>
          <input
            type={type}
            value={val(field) ?? ''}
            onChange={e => set(field, type === 'number' ? parseInt(e.target.value) : e.target.value)}
            style={{ fontSize: 12, width: 140, padding: '2px 6px' }}
          />
        </div>
      ))}

      {Object.keys(editing).length > 0 && (
        <button type="button" className="btn btn-primary btn-sm" disabled={acting} onClick={handleSave} style={{ marginTop: 8, gap: 6 }}>
          <Ic n="save" s={11} /> Save changes
        </button>
      )}

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(0,0,0,0.07)' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          Marinas ({group.marina_count} / {group.max_marinas})
        </div>
        {group.marinas?.map(m => (
          <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, fontSize: 12 }}>
            <span>{m.name}</span>
            <button type="button" className="btn btn-ghost btn-sm" disabled={acting} onClick={() => handleRemoveMarina(m.id)} style={{ padding: '2px 6px', fontSize: 11 }}>
              Remove
            </button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          <select value={addMarinaId} onChange={e => setAddMarinaId(e.target.value)} style={{ fontSize: 12, flex: 1 }}>
            <option value="">Add marina…</option>
            {availableMarinas.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <button type="button" className="btn btn-primary btn-sm" disabled={acting || !addMarinaId} onClick={handleAddMarina}>
            Add
          </button>
        </div>
      </div>

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid rgba(0,0,0,0.07)' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          Enterprise Admin
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            type="email"
            placeholder="user@example.com"
            value={adminEmail}
            onChange={e => setAdminEmail(e.target.value)}
            style={{ fontSize: 12, flex: 1 }}
          />
          <button type="button" className="btn btn-primary btn-sm" disabled={acting || !adminEmail.trim()} onClick={handleSetAdmin}>
            Assign
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Groups() {
  const [groups, setGroups] = useState([]);
  const [allMarinas, setAllMarinas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const [newGroup, setNewGroup] = useState({ name: '', slug: '', billing_contact_email: '', max_marinas: 1, base_currency: 'EUR' });

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get('admin/groups/'),
      api.get('admin/marinas/'),
    ]).then(([g, m]) => {
      setGroups(g.data);
      setAllMarinas(m.data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function handleUpdate(updated) {
    setGroups(prev => prev.map(g => g.id === updated.id ? updated : g));
    setSelected(updated);
  }

  async function handleCreate() {
    try {
      const { data } = await api.post('admin/groups/', newGroup);
      setGroups(prev => [data, ...prev]);
      setCreating(false);
      setNewGroup({ name: '', slug: '', billing_contact_email: '', max_marinas: 1, base_currency: 'EUR' });
    } catch (e) {
      window.alert(e.response?.data?.detail || 'Failed to create group');
    }
  }

  return (
    <div>
      <div className="sec-hdr">
        <div className="sec-hdr-title">Groups <span style={{ fontWeight: 400, color: 'rgba(0,0,0,0.35)' }}>({groups.length})</span></div>
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setCreating(c => !c)}>
          <Ic n="plus" s={12} /> New Group
        </button>
      </div>

      {creating && (
        <div className="card" style={{ marginBottom: 16, padding: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {[['Name', 'name', 'text'], ['Slug', 'slug', 'text'], ['Billing email', 'billing_contact_email', 'email'], ['Marina limit', 'max_marinas', 'number'], ['Base currency', 'base_currency', 'text']].map(([label, field, type]) => (
              <label key={field} style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {label}
                <input type={type} value={newGroup[field]} onChange={e => setNewGroup(p => ({ ...p, [field]: type === 'number' ? parseInt(e.target.value) : e.target.value }))} style={{ fontSize: 12 }} />
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleCreate}>Create</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="grid-b" style={{ alignItems: 'start' }}>
        <div>
          <div className="card">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Group</th>
                  <th>Marinas</th>
                  <th>Base currency</th>
                  <th>Billing contact</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                ) : groups.length === 0 ? (
                  <tr><td colSpan={5} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No groups yet.</td></tr>
                ) : groups.map(g => (
                  <tr key={g.id} className={selected?.id === g.id ? 'selected' : ''} onClick={() => setSelected(selected?.id === g.id ? null : g)}>
                    <td><div className="tbl-name">{g.name}</div><div className="tbl-sub">{g.slug}</div></td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{g.marina_count} / {g.max_marinas}</td>
                    <td>{g.base_currency}</td>
                    <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.55)' }}>{g.billing_contact_email || '—'}</td>
                    <td style={{ color: 'rgba(0,0,0,0.45)', fontSize: 11 }}>{new Date(g.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <GroupDetailPanel
          group={selected}
          onClose={() => setSelected(null)}
          onUpdate={handleUpdate}
          allMarinas={allMarinas}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add admin/src/screens/Groups.jsx
git commit -m "feat(enterprise): Groups screen in admin portal"
```

---

## Task 8: Admin portal — wire Groups into sidebar and router

**Files:**
- Modify: `admin/src/App.jsx`
- Modify: `admin/src/components/layout/Sidebar.jsx`

- [ ] **Step 1: Add Groups to `App.jsx` SCREENS map**

In `admin/src/App.jsx`, add the import and register the screen:

```jsx
import Groups from './screens/Groups.jsx';

const SCREENS = {
  overview: Overview, marinas: Marinas, subscriptions: Subscriptions,
  finance: Finance, settings: Settings,
  'feature-flags': FeatureFlags, 'audit-log': AuditLog,
  groups: Groups,   // ← add this line
};
```

- [ ] **Step 2: Add Groups to `Sidebar.jsx` NAV**

In `admin/src/components/layout/Sidebar.jsx`, add `groups` to the Platform group:

```js
const NAV = [
  { group: 'Platform', items: [
    { id: 'overview',      icon: 'grid',         label: 'Overview' },
    { id: 'marinas',       icon: 'anchor',       label: 'Marinas' },
    { id: 'groups',        icon: 'layers',       label: 'Groups' },    // ← add
    { id: 'subscriptions', icon: 'tag',          label: 'Subscriptions' },
  ]},
  // ... rest unchanged
];
```

- [ ] **Step 3: Commit**

```bash
git add admin/src/App.jsx admin/src/components/layout/Sidebar.jsx
git commit -m "feat(enterprise): add Groups nav item to admin portal"
```

---

## Task 9: Admin portal — enterprise badge on Marinas list

**Files:**
- Modify: `backend/apps/admin_portal/serializers.py` — add `group_name` to `MarinaListSerializer`
- Modify: `admin/src/screens/Marinas.jsx` — render badge + sub-line

- [ ] **Step 1: Add group data to `MarinaListSerializer`**

In `backend/apps/admin_portal/serializers.py`, update `MarinaListSerializer`:

```python
from apps.accounts.models import Marina, User, MarinaGroupMembership

class MarinaListSerializer(serializers.ModelSerializer):
    mrr = serializers.SerializerMethodField()
    user_count = serializers.SerializerMethodField()
    group_name = serializers.SerializerMethodField()

    class Meta:
        model = Marina
        fields = [
            'id', 'name', 'contact_email', 'timezone', 'plan', 'status',
            'total_berths', 'mrr', 'user_count',
            'trial_ends', 'next_renewal', 'suspend_reason',
            'stripe_account_id', 'features', 'mrr_override', 'max_staff',
            'created_at', 'group_name',
        ]

    def get_mrr(self, obj):
        return obj.mrr_override or PLAN_PRICES.get(obj.plan, 0)

    def get_user_count(self, obj):
        return obj.users.filter(is_active=True).count()

    def get_group_name(self, obj):
        membership = obj.group_memberships.select_related('group').first()
        return membership.group.name if membership else None
```

- [ ] **Step 2: Update `Marinas.jsx` — plan column and marina name sub-line**

In `admin/src/screens/Marinas.jsx`, find the table row render (around line 257). Update the marina name cell and plan cell:

```jsx
<td>
  <div className="tbl-name">{m.name}</div>
  {m.group_name && (
    <div className="tbl-sub" style={{ color: 'rgba(180,140,0,0.8)' }}>{m.group_name}</div>
  )}
</td>
```

For the plan cell (find `<PlanBadge plan={m.plan} />`), replace with:

```jsx
<td>
  {m.group_name
    ? <span className="badge badge-gold">Enterprise</span>
    : <PlanBadge plan={m.plan} />}
</td>
```

- [ ] **Step 3: Run the backend tests to make sure nothing regressed**

```bash
python manage.py test apps.admin_portal -v 2
```

Expected: all existing tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/admin_portal/serializers.py admin/src/screens/Marinas.jsx
git commit -m "feat(enterprise): enterprise badge and group name on Marinas list"
```

---

## Task 10: Marina frontend — handle `sso_token` on load

The marina frontend needs to intercept the `sso_token` URL param, store the JWT, and remove the param from the URL. Without this, the "Open marina" button in Phase 2 would land users on the login screen.

**Files:**
- Modify: `frontend/src/main.jsx` or `frontend/src/App.jsx` — whichever runs first on load

- [ ] **Step 1: Find the frontend entry point**

```bash
grep -r "localStorage\|setToken\|jwt\|access" frontend/src/api.js --include="*.js" -l
```

Open `frontend/src/api.js` to find the token key used for auth (e.g. `'access_token'`, `'db_token'`).

- [ ] **Step 2: Check the token key**

Open `frontend/src/api.js` and note the key used to store the JWT in localStorage. It will look like:
```js
localStorage.setItem('some_key', token)
```

- [ ] **Step 3: Add SSO token intercept to the frontend App**

Open `frontend/src/App.jsx`. At the top of the component (before any auth check), add this block. Replace `'YOUR_TOKEN_KEY'` with the actual key found in Step 2:

```jsx
// SSO handoff — enterprise admin arriving via "Open marina" deep link
useEffect(() => {
  const params = new URLSearchParams(window.location.search);
  const ssoToken = params.get('sso_token');
  if (ssoToken) {
    localStorage.setItem('YOUR_TOKEN_KEY', ssoToken);
    params.delete('sso_token');
    const newSearch = params.toString();
    const newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '');
    window.history.replaceState({}, '', newUrl);
    window.location.reload(); // trigger normal auth flow with the new token
  }
}, []);
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat(enterprise): handle sso_token URL param for enterprise SSO handoff"
```

---

## Task 11: Full test run + verification

- [ ] **Step 1: Run the full backend test suite**

```bash
cd backend
python manage.py test apps.accounts apps.admin_portal apps.enterprise -v 2
```

Expected: all tests pass, 0 failures

- [ ] **Step 2: Start the admin portal dev server and manually verify**

```bash
cd admin && npm run dev
```

Open the admin portal. Verify:
- "Groups" appears in the Platform section of the sidebar
- Groups tab loads with the table and "New Group" button
- Creating a group works: fill in name, slug, billing email, limit, currency → Create
- Adding a marina to the group works via the detail panel dropdown
- Setting an enterprise admin by email works
- Marinas tab still loads correctly
- A marina that was added to a group shows gold "Enterprise" badge (not the plan badge) and the group name as a sub-line

- [ ] **Step 3: Final commit if any minor fixes were needed**

```bash
git add -p
git commit -m "fix(enterprise): phase 1 manual test fixes"
```
