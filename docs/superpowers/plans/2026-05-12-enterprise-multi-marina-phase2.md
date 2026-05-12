# Enterprise Multi-Marina Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `marina-admin` enterprise portal (a standalone Vite+React app at port 5176) that lets enterprise admins view KPIs, financials, marinas, and staff across their group, then deep-link into any individual marina via SSO. Also adds the two missing backend endpoints (group settings, staff invite/remove) and fixes the missing icons in the admin app.

**Architecture:** Three independent workstreams land together: (1) two new Django APIView endpoints for settings and staff management; (2) a new `marina-admin/` Vite+React app with its own localStorage key namespace (`ma_access_token`, `ma_group`); (3) a one-line fix to the admin app's `Icon.jsx`. The `marina-admin` app reuses the same design-token CSS as the admin app (copy, not import). Its App.jsx is a three-state machine: unauthenticated → Login; authenticated but no group selected → GroupPicker; fully authenticated → main layout.

**Tech Stack:** Django REST Framework + SimpleJWT (backend); Vite + React 19 + axios (marina-admin frontend); same CSS design tokens as admin app.

---

## File Map

**New files:**
- `backend/apps/enterprise/tests/test_settings.py`
- `backend/apps/enterprise/tests/test_staff_endpoints.py`
- `marina-admin/package.json`
- `marina-admin/vite.config.js`
- `marina-admin/index.html`
- `marina-admin/src/main.jsx`
- `marina-admin/src/styles/tokens.css`
- `marina-admin/src/styles/app.css`
- `marina-admin/src/api.js`
- `marina-admin/src/App.jsx`
- `marina-admin/src/screens/Login.jsx`
- `marina-admin/src/screens/GroupPicker.jsx`
- `marina-admin/src/screens/Overview.jsx`
- `marina-admin/src/screens/Financials.jsx`
- `marina-admin/src/screens/Marinas.jsx`
- `marina-admin/src/screens/Staff.jsx`
- `marina-admin/src/screens/Settings.jsx`
- `marina-admin/src/components/layout/Sidebar.jsx`
- `marina-admin/src/components/layout/Topbar.jsx`
- `marina-admin/src/components/ui/Icon.jsx`

**Modified files:**
- `backend/apps/accounts/models.py` — add `vat_number` to `MarinaGroup`
- `backend/apps/enterprise/views.py` — add `GroupSettingsView`, `GroupStaffInviteView`, `GroupStaffRemoveView`
- `backend/apps/enterprise/urls.py` — wire new views
- `admin/src/components/ui/Icon.jsx` — add `layers` and `save` icon strings

---

## Task 1: Backend — `vat_number` on MarinaGroup + `/settings/` endpoint

**Files:**
- Modify: `backend/apps/accounts/models.py`
- Create: new migration (auto-generated)
- Create: `backend/apps/enterprise/tests/test_settings.py`
- Modify: `backend/apps/enterprise/views.py`
- Modify: `backend/apps/enterprise/urls.py`

- [ ] **Step 1: Add `vat_number` to MarinaGroup**

In `backend/apps/accounts/models.py`, find the `MarinaGroup` class (line ~232) and add `vat_number` after `billing_contact_email`:

```python
class MarinaGroup(models.Model):
    name                  = models.CharField(max_length=200)
    slug                  = models.SlugField(unique=True)
    max_marinas           = models.IntegerField(default=1)
    billing_contact_email = models.EmailField(blank=True)
    vat_number            = models.CharField(max_length=50, blank=True)
    stripe_customer_id    = models.CharField(max_length=64, blank=True)
    base_currency         = models.CharField(max_length=3, default='EUR')
    created_at            = models.DateTimeField(auto_now_add=True)
```

- [ ] **Step 2: Generate and run migration**

```bash
cd backend
python manage.py makemigrations accounts --name add_vat_number_to_marina_group
python manage.py migrate
```

Expected: `Migrations for 'accounts': ... 0XXX_add_vat_number_to_marina_group.py`

- [ ] **Step 3: Write failing tests for `/settings/`**

Create `backend/apps/enterprise/tests/test_settings.py`:

```python
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import MarinaGroup, MarinaGroupUserRole, User


def make_group_with_admin():
    g = MarinaGroup.objects.create(
        name='Test Group', slug='test-group', base_currency='EUR',
        billing_contact_email='billing@test.com', vat_number='FR12345',
    )
    u = User.objects.create_user(email='admin@test.com', password='pass')
    MarinaGroupUserRole.objects.create(group=g, user=u, role=MarinaGroupUserRole.Role.ADMIN)
    return g, u


class GroupSettingsViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.g, self.user = make_group_with_admin()
        self.client.force_authenticate(self.user)

    def test_get_settings_returns_all_fields(self):
        resp = self.client.get(f'/api/v1/enterprise/groups/{self.g.pk}/settings/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['name'], 'Test Group')
        self.assertEqual(resp.data['billing_contact_email'], 'billing@test.com')
        self.assertEqual(resp.data['vat_number'], 'FR12345')
        self.assertEqual(resp.data['base_currency'], 'EUR')

    def test_patch_updates_allowed_fields(self):
        resp = self.client.patch(
            f'/api/v1/enterprise/groups/{self.g.pk}/settings/',
            {'name': 'Renamed', 'vat_number': 'DE99999', 'billing_contact_email': 'new@test.com'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['name'], 'Renamed')
        self.assertEqual(resp.data['vat_number'], 'DE99999')
        self.g.refresh_from_db()
        self.assertEqual(self.g.name, 'Renamed')

    def test_patch_ignores_max_marinas(self):
        original = self.g.max_marinas
        self.client.patch(
            f'/api/v1/enterprise/groups/{self.g.pk}/settings/',
            {'max_marinas': 999},
            format='json',
        )
        self.g.refresh_from_db()
        self.assertEqual(self.g.max_marinas, original)

    def test_non_admin_get_rejected(self):
        other = User.objects.create_user(email='other@test.com', password='pass')
        c = APIClient()
        c.force_authenticate(other)
        resp = c.get(f'/api/v1/enterprise/groups/{self.g.pk}/settings/')
        self.assertEqual(resp.status_code, 403)

    def test_unauthenticated_rejected(self):
        c = APIClient()
        resp = c.get(f'/api/v1/enterprise/groups/{self.g.pk}/settings/')
        self.assertEqual(resp.status_code, 401)
```

- [ ] **Step 4: Run to confirm failure**

```bash
cd backend
python manage.py test apps.enterprise.tests.test_settings -v 2
```

Expected: 5 errors (URL not found yet).

- [ ] **Step 5: Add `GroupSettingsView` to `backend/apps/enterprise/views.py`**

Append after `GroupExchangeTokenView`:

```python
class GroupSettingsView(APIView):
    permission_classes = [IsAuthenticated, IsGroupAdmin]

    def _data(self, group):
        return {
            'id':                     group.id,
            'name':                   group.name,
            'billing_contact_email':  group.billing_contact_email,
            'vat_number':             group.vat_number,
            'base_currency':          group.base_currency,
        }

    def get(self, request, pk):
        group = get_object_or_404(MarinaGroup, pk=pk)
        return Response(self._data(group))

    def patch(self, request, pk):
        group = get_object_or_404(MarinaGroup, pk=pk)
        allowed = {'name', 'billing_contact_email', 'vat_number', 'base_currency'}
        for field in allowed & set(request.data.keys()):
            setattr(group, field, request.data[field])
        group.save()
        return Response(self._data(group))
```

- [ ] **Step 6: Wire URL in `backend/apps/enterprise/urls.py`**

Replace the file contents:

```python
from django.urls import path
from .views import (
    MeView, GroupOverviewView, GroupFinancialsView,
    GroupStaffView, GroupExchangeTokenView, GroupSettingsView,
)

urlpatterns = [
    path('me/',                                         MeView.as_view(),                name='enterprise_me'),
    path('groups/<int:pk>/overview/',                   GroupOverviewView.as_view(),      name='enterprise_overview'),
    path('groups/<int:pk>/financials/',                 GroupFinancialsView.as_view(),    name='enterprise_financials'),
    path('groups/<int:pk>/staff/',                      GroupStaffView.as_view(),         name='enterprise_staff'),
    path('groups/<int:pk>/settings/',                   GroupSettingsView.as_view(),      name='enterprise_settings'),
    path('groups/<int:pk>/exchange_token/',             GroupExchangeTokenView.as_view(), name='enterprise_exchange_token'),
]
```

- [ ] **Step 7: Run tests and confirm all pass**

```bash
cd backend
python manage.py test apps.enterprise.tests.test_settings -v 2
```

Expected: `5 tests ... OK`

- [ ] **Step 8: Commit**

```bash
git add backend/apps/accounts/models.py \
        backend/apps/accounts/migrations/ \
        backend/apps/enterprise/views.py \
        backend/apps/enterprise/urls.py \
        backend/apps/enterprise/tests/test_settings.py
git commit -m "feat(enterprise): add vat_number to MarinaGroup and group settings endpoint"
```

---

## Task 2: Backend — staff invite and remove endpoints

**Files:**
- Create: `backend/apps/enterprise/tests/test_staff_endpoints.py`
- Modify: `backend/apps/enterprise/views.py`
- Modify: `backend/apps/enterprise/urls.py`

- [ ] **Step 1: Write failing tests**

Create `backend/apps/enterprise/tests/test_staff_endpoints.py`:

```python
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, MarinaGroup, MarinaGroupMembership, MarinaGroupUserRole, User


def make_setup():
    g = MarinaGroup.objects.create(name='Group', slug='group', base_currency='EUR')
    m = Marina.objects.create(name='Port A', slug='port-a', total_berths=50, status='active', currency='EUR')
    MarinaGroupMembership.objects.create(group=g, marina=m)
    admin = User.objects.create_user(email='admin@test.com', password='pass')
    MarinaGroupUserRole.objects.create(group=g, user=admin, role=MarinaGroupUserRole.Role.ADMIN)
    return g, m, admin


class StaffInviteTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.g, self.m, self.admin = make_setup()
        self.client.force_authenticate(self.admin)

    def test_invite_creates_new_user(self):
        resp = self.client.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/staff/invite/',
            {'email': 'new@marina.com', 'marina_id': self.m.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 201)
        u = User.objects.get(email='new@marina.com')
        self.assertEqual(u.marina_id, self.m.id)
        self.assertEqual(u.role, 'manager')
        self.assertTrue(u.is_active)

    def test_invite_reactivates_inactive_user(self):
        existing = User.objects.create_user(email='old@marina.com', password='pass', is_active=False)
        resp = self.client.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/staff/invite/',
            {'email': 'old@marina.com', 'marina_id': self.m.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        existing.refresh_from_db()
        self.assertTrue(existing.is_active)

    def test_invite_marina_not_in_group_returns_400(self):
        other = Marina.objects.create(name='Other', slug='other', status='active', currency='EUR')
        resp = self.client.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/staff/invite/',
            {'email': 'x@x.com', 'marina_id': other.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_invite_missing_fields_returns_400(self):
        resp = self.client.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/staff/invite/',
            {'email': 'x@x.com'},
            format='json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_invite_non_admin_rejected(self):
        other = User.objects.create_user(email='other@test.com', password='pass')
        c = APIClient()
        c.force_authenticate(other)
        resp = c.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/staff/invite/',
            {'email': 'x@x.com', 'marina_id': self.m.id},
            format='json',
        )
        self.assertEqual(resp.status_code, 403)


class StaffRemoveTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.g, self.m, self.admin = make_setup()
        self.client.force_authenticate(self.admin)
        self.staff_user = User.objects.create_user(
            email='staff@marina.com', password='pass', role='manager', is_active=True
        )
        self.staff_user.marina = self.m
        self.staff_user.save()

    def test_remove_deactivates_user(self):
        resp = self.client.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/staff/{self.staff_user.pk}/remove/',
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.staff_user.refresh_from_db()
        self.assertFalse(self.staff_user.is_active)

    def test_remove_user_not_in_group_returns_400(self):
        outsider = User.objects.create_user(email='out@test.com', password='pass', is_active=True)
        resp = self.client.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/staff/{outsider.pk}/remove/',
            format='json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_remove_non_admin_rejected(self):
        other = User.objects.create_user(email='other@test.com', password='pass')
        c = APIClient()
        c.force_authenticate(other)
        resp = c.post(
            f'/api/v1/enterprise/groups/{self.g.pk}/staff/{self.staff_user.pk}/remove/',
            format='json',
        )
        self.assertEqual(resp.status_code, 403)
```

- [ ] **Step 2: Run to confirm failure**

```bash
cd backend
python manage.py test apps.enterprise.tests.test_staff_endpoints -v 2
```

Expected: 8 errors (URLs not found).

- [ ] **Step 3: Add `GroupStaffInviteView` and `GroupStaffRemoveView` to `backend/apps/enterprise/views.py`**

Append after `GroupSettingsView`:

```python
class GroupStaffInviteView(APIView):
    permission_classes = [IsAuthenticated, IsGroupAdmin]

    def post(self, request, pk):
        group = get_object_or_404(MarinaGroup, pk=pk)
        email = request.data.get('email', '').strip().lower()
        marina_id = request.data.get('marina_id')
        if not email or not marina_id:
            return Response(
                {'detail': 'email and marina_id are required.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        if not group.memberships.filter(marina_id=marina_id).exists():
            return Response(
                {'detail': 'Marina not in group.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        marina = get_object_or_404(Marina, pk=marina_id)
        user, created = User.objects.get_or_create(
            email=email,
            defaults={'marina': marina, 'role': 'manager', 'is_active': True},
        )
        if not created and not user.is_active:
            user.marina = marina
            user.role = 'manager'
            user.is_active = True
            user.save()
        response_status = http_status.HTTP_201_CREATED if created else http_status.HTTP_200_OK
        return Response(
            {'id': user.id, 'email': user.email, 'marina_id': marina.id, 'marina_name': marina.name},
            status=response_status,
        )


class GroupStaffRemoveView(APIView):
    permission_classes = [IsAuthenticated, IsGroupAdmin]

    def post(self, request, pk, user_id):
        group = get_object_or_404(MarinaGroup, pk=pk)
        user = get_object_or_404(User, pk=user_id)
        marina_ids = list(group.memberships.values_list('marina_id', flat=True))
        if user.marina_id not in marina_ids:
            return Response(
                {'detail': 'User not in this group.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        user.is_active = False
        user.save()
        return Response({'detail': 'Staff removed.'})
```

Also add `User` to the imports at the top of `views.py`:

```python
from apps.accounts.models import MarinaGroup, MarinaGroupUserRole, Marina, User
```

- [ ] **Step 4: Update URL file**

Replace `backend/apps/enterprise/urls.py` contents:

```python
from django.urls import path
from .views import (
    MeView, GroupOverviewView, GroupFinancialsView,
    GroupStaffView, GroupStaffInviteView, GroupStaffRemoveView,
    GroupExchangeTokenView, GroupSettingsView,
)

urlpatterns = [
    path('me/',                                                      MeView.as_view(),                name='enterprise_me'),
    path('groups/<int:pk>/overview/',                                GroupOverviewView.as_view(),      name='enterprise_overview'),
    path('groups/<int:pk>/financials/',                              GroupFinancialsView.as_view(),    name='enterprise_financials'),
    path('groups/<int:pk>/staff/',                                   GroupStaffView.as_view(),         name='enterprise_staff'),
    path('groups/<int:pk>/staff/invite/',                            GroupStaffInviteView.as_view(),   name='enterprise_staff_invite'),
    path('groups/<int:pk>/staff/<int:user_id>/remove/',              GroupStaffRemoveView.as_view(),   name='enterprise_staff_remove'),
    path('groups/<int:pk>/settings/',                                GroupSettingsView.as_view(),      name='enterprise_settings'),
    path('groups/<int:pk>/exchange_token/',                          GroupExchangeTokenView.as_view(), name='enterprise_exchange_token'),
]
```

- [ ] **Step 5: Run all enterprise tests**

```bash
cd backend
python manage.py test apps.enterprise -v 2
```

Expected: all tests pass (includes existing 25 + new 13 = 38 total or similar).

- [ ] **Step 6: Commit**

```bash
git add backend/apps/enterprise/views.py \
        backend/apps/enterprise/urls.py \
        backend/apps/enterprise/tests/test_staff_endpoints.py
git commit -m "feat(enterprise): add staff invite and remove endpoints"
```

---

## Task 3: Fix admin Icon.jsx + scaffold `marina-admin/` directory

**Files:**
- Modify: `admin/src/components/ui/Icon.jsx`
- Create: `marina-admin/package.json`, `marina-admin/vite.config.js`, `marina-admin/index.html`
- Create: `marina-admin/src/main.jsx`, `marina-admin/src/styles/tokens.css`, `marina-admin/src/styles/app.css`
- Create: `marina-admin/src/components/ui/Icon.jsx`

- [ ] **Step 1: Add missing icons to admin's Icon.jsx**

In `admin/src/components/ui/Icon.jsx`, add `layers` and `save` to the `icons` object (after the last entry, before the closing `}`):

```javascript
  layers:  `<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>`,
  save:    `<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>`,
```

- [ ] **Step 2: Verify admin Groups screen renders without icon errors**

Start the admin dev server (`npm run dev` in `admin/`) and navigate to the Groups screen. The empty state should show a layers icon (not a blank square). Stop the dev server.

- [ ] **Step 3: Create `marina-admin/package.json`**

```json
{
  "name": "docksbase-marina-admin",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite --port 5176",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "axios": "^1.15.2",
    "react": "^19.2.5",
    "react-dom": "^19.2.5"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^6.0.1",
    "vite": "^8.0.10"
  }
}
```

- [ ] **Step 4: Create `marina-admin/vite.config.js`**

```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5176,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
});
```

- [ ] **Step 5: Create `marina-admin/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>DocksBase Enterprise</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600&family=Cormorant+Garamond:wght@600&family=Jost:wght@300;600&display=swap" rel="stylesheet">
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Create `marina-admin/src/styles/tokens.css`**

(Identical to admin's tokens.css — copy it verbatim.)

```css
:root {
  --navy:  #0c1f3d;
  --navy2: #162d52;
  --navy3: #1e3d6e;
  --gold:  #b8965a;
  --gold2: #d4b07a;
  --teal:  #1a6b6e;
  --teal2: #2a9d99;
  --cream: #f5f0e6;
  --bg:    #f4f3f0;
  --bg2:   #eceae6;
  --white: #ffffff;
  --red:    #c0392b;
  --orange: #dd5b00;
  --green:  #1a8c2e;
  --blue:   #0075de;
  --border:  1px solid rgba(0,0,0,0.08);
  --border2: 1px solid rgba(0,0,0,0.13);
  --shadow:  0 1px 4px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.05);
  --shadow2: 0 2px 8px rgba(0,0,0,0.07), 0 8px 32px rgba(0,0,0,0.07);
  --sidebar-w: 220px;
  --topbar-h:  52px;
  --font:       'IBM Plex Sans', -apple-system, system-ui, sans-serif;
  --font-serif: 'Cormorant Garamond', Georgia, serif;
  --font-brand: 'Jost', -apple-system, system-ui, sans-serif;
}
```

- [ ] **Step 7: Create `marina-admin/src/styles/app.css`**

Copy `admin/src/styles/app.css` verbatim — all CSS classes are identical. No changes needed. The app.css file is at `admin/src/styles/app.css`; copy its full contents.

- [ ] **Step 8: Create `marina-admin/src/main.jsx`**

```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 9: Create `marina-admin/src/components/ui/Icon.jsx`**

Same icon map as admin, already including `layers` and `save`:

```jsx
const icons = {
  grid:           `<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>`,
  users:          `<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>`,
  dollar:         `<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>`,
  settings:       `<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>`,
  chart:          `<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/>`,
  search:         `<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>`,
  anchor:         `<circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="22"/><line x1="5" y1="12" x2="19" y2="12"/><path d="M5 12 Q3 18 7 20"/><path d="M19 12 Q21 18 17 20"/><path d="M7 20 Q12 23 17 20"/>`,
  'log-out':      `<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>`,
  'log-in':       `<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/>`,
  plus:           `<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`,
  x:              `<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>`,
  save:           `<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>`,
  bell:           `<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>`,
  'alert-tri':    `<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`,
};

export default function Ic({ n, s = 14, c = 'currentColor' }) {
  return (
    <svg className="icon" width={s} height={s} viewBox="0 0 24 24" fill="none"
      stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: icons[n] || '' }}
    />
  );
}
```

- [ ] **Step 10: Install dependencies**

```bash
cd marina-admin
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 11: Commit**

```bash
git add admin/src/components/ui/Icon.jsx marina-admin/
git commit -m "feat(marina-admin): scaffold app + fix admin icon missing layers and save"
```

---

## Task 4: `api.js` + `App.jsx` + `Login.jsx` + `GroupPicker.jsx`

**Files:**
- Create: `marina-admin/src/api.js`
- Create: `marina-admin/src/App.jsx`
- Create: `marina-admin/src/screens/Login.jsx`
- Create: `marina-admin/src/screens/GroupPicker.jsx`

- [ ] **Step 1: Create `marina-admin/src/api.js`**

```javascript
import axios from 'axios';

const api = axios.create({ baseURL: '/api/v1/' });

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('ma_access_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  r => r,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('ma_access_token');
      localStorage.removeItem('ma_group');
      window.location.reload();
    }
    return Promise.reject(err);
  }
);

export function isAuthenticated() {
  return !!localStorage.getItem('ma_access_token');
}

export function getStoredGroup() {
  try { return JSON.parse(localStorage.getItem('ma_group')); } catch { return null; }
}

export function logout() {
  localStorage.removeItem('ma_access_token');
  localStorage.removeItem('ma_group');
  localStorage.removeItem('ma_screen');
}

export default api;
```

- [ ] **Step 2: Create `marina-admin/src/screens/Login.jsx`**

```jsx
import { useState } from 'react';
import api from '../api.js';

export default function Login({ onLogin }) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data } = await api.post('auth/token/', { email, password });
      localStorage.setItem('ma_access_token', data.access);
      onLogin();
    } catch {
      setError('Invalid email or password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-logo">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#0c1f3d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="22"/>
            <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
          </svg>
          <span className="login-brand">DocksBase Enterprise</span>
        </div>
        <h2 className="login-title">Sign in</h2>
        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label className="login-label">Email</label>
            <input type="email" className="login-input" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
          </div>
          <div className="login-field">
            <label className="login-label">Password</label>
            <input type="password" className="login-input" value={password} onChange={e => setPassword(e.target.value)} required />
          </div>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="abtn abtn-primary login-submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `marina-admin/src/screens/GroupPicker.jsx`**

```jsx
import { useState, useEffect } from 'react';
import api, { logout } from '../api.js';

export default function GroupPicker({ onSelect }) {
  const [groups, setGroups]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    api.get('enterprise/me/')
      .then(r => {
        const gs = r.data.groups;
        setGroups(gs);
        if (gs.length === 1) {
          localStorage.setItem('ma_group', JSON.stringify(gs[0]));
          onSelect(gs[0]);
        }
      })
      .catch(() => setError('Could not load groups. Check that your account has enterprise access.'))
      .finally(() => setLoading(false));
  }, []);

  function handleSelect(g) {
    localStorage.setItem('ma_group', JSON.stringify(g));
    onSelect(g);
  }

  if (loading) return (
    <div className="login-shell">
      <div className="login-card" style={{ textAlign: 'center', color: 'rgba(0,0,0,0.4)' }}>Loading…</div>
    </div>
  );

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-logo">
          <span className="login-brand">DocksBase Enterprise</span>
        </div>
        {error ? (
          <>
            <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 16 }}>{error}</p>
            <button className="abtn abtn-primary" style={{ width: '100%' }} onClick={() => { logout(); window.location.reload(); }}>
              Sign out
            </button>
          </>
        ) : groups.length === 0 ? (
          <>
            <p style={{ color: 'rgba(0,0,0,0.5)', fontSize: 13, marginBottom: 16, textAlign: 'center' }}>
              Your account has no enterprise groups.
            </p>
            <button className="abtn abtn-primary" style={{ width: '100%' }} onClick={() => { logout(); window.location.reload(); }}>
              Sign out
            </button>
          </>
        ) : (
          <>
            <h2 className="login-title" style={{ fontSize: 16 }}>Select a group</h2>
            {groups.map(g => (
              <button key={g.id} className="btn btn-ghost" onClick={() => handleSelect(g)}
                style={{ width: '100%', justifyContent: 'space-between', marginBottom: 8, padding: '10px 14px' }}>
                <span style={{ fontWeight: 600 }}>{g.name}</span>
                <span style={{ fontSize: 11, opacity: 0.5 }}>{g.marina_count} marina{g.marina_count !== 1 ? 's' : ''}</span>
              </button>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create `marina-admin/src/App.jsx`**

```jsx
import { useState } from 'react';
import { isAuthenticated, getStoredGroup, logout } from './api.js';
import Login       from './screens/Login.jsx';
import GroupPicker from './screens/GroupPicker.jsx';
import Sidebar     from './components/layout/Sidebar.jsx';
import Topbar      from './components/layout/Topbar.jsx';
import Overview    from './screens/Overview.jsx';
import Financials  from './screens/Financials.jsx';
import Marinas     from './screens/Marinas.jsx';
import Staff       from './screens/Staff.jsx';
import Settings    from './screens/Settings.jsx';

const SCREENS = {
  overview:   Overview,
  financials: Financials,
  marinas:    Marinas,
  staff:      Staff,
  settings:   Settings,
};

export default function App() {
  const [authed, setAuthed] = useState(() => isAuthenticated());
  const [group,  setGroup]  = useState(() => getStoredGroup());
  const [screen, setScreenRaw] = useState(
    () => localStorage.getItem('ma_screen') || 'overview'
  );

  function setScreen(s) {
    setScreenRaw(s);
    localStorage.setItem('ma_screen', s);
  }

  function handleLogout() {
    logout();
    setAuthed(false);
    setGroup(null);
  }

  if (!authed) return <Login onLogin={() => setAuthed(true)} />;
  if (!group)  return <GroupPicker onSelect={g => setGroup(g)} />;

  const Screen = SCREENS[screen] || Overview;
  return (
    <div className="app">
      <Sidebar screen={screen} setScreen={setScreen} onLogout={handleLogout} group={group} />
      <div className="main">
        <Topbar screen={screen} group={group} />
        <div className="content">
          <Screen group={group} setScreen={setScreen} />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Start dev server and confirm login screen renders**

```bash
cd marina-admin
npm run dev
```

Open `http://localhost:5176`. Expected: login screen with "DocksBase Enterprise" brand and email/password form.

Stop dev server.

- [ ] **Step 6: Commit**

```bash
git add marina-admin/src/api.js marina-admin/src/App.jsx \
        marina-admin/src/screens/Login.jsx marina-admin/src/screens/GroupPicker.jsx
git commit -m "feat(marina-admin): auth flow — login, group picker, app shell"
```

---

## Task 5: Sidebar + Topbar components

**Files:**
- Create: `marina-admin/src/components/layout/Sidebar.jsx`
- Create: `marina-admin/src/components/layout/Topbar.jsx`

- [ ] **Step 1: Create `marina-admin/src/components/layout/Sidebar.jsx`**

```jsx
import Ic from '../ui/Icon.jsx';

const NAV = [
  { id: 'overview',   icon: 'grid',     label: 'Overview' },
  { id: 'financials', icon: 'dollar',   label: 'Financials' },
  { id: 'marinas',    icon: 'anchor',   label: 'Marinas' },
  { id: 'staff',      icon: 'users',    label: 'Staff' },
  { id: 'settings',   icon: 'settings', label: 'Settings' },
];

export default function Sidebar({ screen, setScreen, onLogout, group }) {
  return (
    <aside className="sb">
      <div className="sb-logo">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.9)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="22"/>
          <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
        </svg>
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1, gap: 3 }}>
          <span style={{ fontFamily: 'var(--font-brand)', fontWeight: 600, fontSize: 11, letterSpacing: 3, textTransform: 'uppercase', color: '#fff' }}>DOCKS</span>
          <span style={{ fontFamily: 'var(--font-brand)', fontWeight: 300, fontSize: 11, letterSpacing: 3, color: 'var(--gold)' }}>Base</span>
        </div>
      </div>

      {group && (
        <div className="sb-env">
          <div className="sb-env-label">Enterprise</div>
          <div className="sb-env-desc">{group.name}</div>
        </div>
      )}

      <div className="sb-section">
        {NAV.map(item => (
          <div
            key={item.id}
            className={`sb-item${screen === item.id ? ' active' : ''}`}
            onClick={() => setScreen(item.id)}
          >
            <Ic n={item.icon} s={14} />
            {item.label}
          </div>
        ))}
      </div>

      <div className="sb-bottom">
        <div className="sb-item" onClick={onLogout}>
          <Ic n="log-out" s={14} />
          Sign out
        </div>
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Create `marina-admin/src/components/layout/Topbar.jsx`**

```jsx
const TITLE_MAP = {
  overview: 'Overview', financials: 'Financials', marinas: 'Marinas',
  staff: 'Staff', settings: 'Settings',
};

export default function Topbar({ screen, group }) {
  const now = new Date();
  const days   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateStr = `${days[now.getDay()]} ${now.getDate()} ${months[now.getMonth()]} ${now.getFullYear()}`;

  return (
    <div className="topbar">
      <div className="topbar-breadcrumb">
        <span>Enterprise</span>
        {group && <><span style={{ opacity: 0.4 }}> / </span><span style={{ opacity: 0.55 }}>{group.name}</span></>}
        <span style={{ opacity: 0.4 }}> / </span>
        <b>{TITLE_MAP[screen] || screen}</b>
      </div>
      <div className="topbar-actions">
        <div className="topbar-date">{dateStr}</div>
        {group && (
          <span style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', background: 'var(--bg)', padding: '3px 8px', borderRadius: 9999, border: 'var(--border2)' }}>
            {group.base_currency} · {group.marina_count} marina{group.marina_count !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Start dev server and confirm main shell renders after login**

```bash
cd marina-admin
npm run dev
```

With backend running and an enterprise user, log in and confirm: sidebar appears with navy background, 5 nav items, group name in the env chip, topbar shows breadcrumb. Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add marina-admin/src/components/layout/Sidebar.jsx \
        marina-admin/src/components/layout/Topbar.jsx
git commit -m "feat(marina-admin): sidebar and topbar layout components"
```

---

## Task 6: Overview screen

**Files:**
- Create: `marina-admin/src/screens/Overview.jsx`

- [ ] **Step 1: Create `marina-admin/src/screens/Overview.jsx`**

```jsx
import { useState, useEffect } from 'react';
import api from '../api.js';
import Ic from '../components/ui/Icon.jsx';

function MarinaCard({ card, onOpen, loading }) {
  const oColor = card.occupancy_pct >= 80 ? 'var(--red)' : card.occupancy_pct >= 50 ? 'var(--orange)' : 'var(--green)';
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2 }}>{card.name}</div>
          <span className={`badge badge-${card.status === 'active' ? 'green' : 'gray'}`}>{card.status}</span>
        </div>
        <button className="btn btn-primary btn-sm" disabled={loading} onClick={onOpen} style={{ gap: 5 }}>
          <Ic n="log-in" s={11} /> Open
        </button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.38)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Occupancy</div>
          <div style={{ fontWeight: 700, fontSize: 18, color: oColor }}>{card.occupancy_pct}%</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.38)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Active / Berths</div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{card.active_bookings} / {card.total_berths}</div>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.38)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>Revenue MTD</div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>{card.currency} {parseFloat(card.revenue_this_month).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
      </div>
    </div>
  );
}

export default function Overview({ group }) {
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [ssoLoading, setSsoLoading] = useState(null);

  useEffect(() => {
    api.get(`enterprise/groups/${group.id}/overview/`)
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [group.id]);

  async function handleOpen(card) {
    setSsoLoading(card.id);
    try {
      const { data: td } = await api.post(`enterprise/groups/${group.id}/exchange_token/`, { marina_id: card.id });
      const marinaUrl = import.meta.env.VITE_MARINA_URL || 'http://localhost:5173';
      window.open(`${marinaUrl}?sso_token=${td.access}`, '_blank');
    } catch (e) {
      window.alert(e.response?.data?.detail || 'Failed to open marina.');
    } finally {
      setSsoLoading(null);
    }
  }

  if (loading) return <div className="empty"><div className="empty-title">Loading…</div></div>;
  if (!data)   return null;

  const { kpis, marinas } = data;

  return (
    <div>
      <div className="sec-hdr">
        <div className="sec-hdr-title">Overview</div>
      </div>

      <div className="grid-4" style={{ marginBottom: 24 }}>
        {[
          { label: 'Total Berths',     val: kpis.total_berths.toLocaleString(),                               icon: 'anchor' },
          { label: 'Active Bookings',  val: kpis.total_active_bookings.toLocaleString(),                      icon: 'users'  },
          { label: 'MRR',              val: `${group.base_currency} ${Number(kpis.total_mrr).toLocaleString()}`, icon: 'dollar' },
          { label: 'Outstanding',      val: `${group.base_currency} ${parseFloat(kpis.total_outstanding).toLocaleString(undefined, { maximumFractionDigits: 0 })}`, icon: 'alert-tri' },
        ].map(k => (
          <div key={k.label} className="card stat-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div className="stat-label">{k.label}</div>
              <div style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(0,0,0,0.4)' }}>
                <Ic n={k.icon} s={13} />
              </div>
            </div>
            <div className="stat-val">{k.val}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(270px, 1fr))', gap: 14 }}>
        {marinas.map(card => (
          <MarinaCard
            key={card.id}
            card={card}
            loading={ssoLoading === card.id}
            onOpen={() => handleOpen(card)}
          />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Start dev server and verify Overview renders with real data**

```bash
cd marina-admin
npm run dev
```

Log in as an enterprise admin, confirm: 4 KPI cards appear at top, marina cards appear below with occupancy, berths, revenue MTD, and "Open" button. Stop dev server.

- [ ] **Step 3: Commit**

```bash
git add marina-admin/src/screens/Overview.jsx
git commit -m "feat(marina-admin): overview screen with KPI strip and marina cards"
```

---

## Task 7: Financials screen

**Files:**
- Create: `marina-admin/src/screens/Financials.jsx`

- [ ] **Step 1: Create `marina-admin/src/screens/Financials.jsx`**

```jsx
import { useState, useEffect } from 'react';
import api from '../api.js';

function RevenueChart({ data, currency }) {
  if (!data || data.length === 0) return null;
  const maxTotal = Math.max(...data.map(m => parseFloat(m.total)));
  if (maxTotal === 0) return (
    <div style={{ color: 'rgba(0,0,0,0.35)', fontSize: 12, padding: '20px 0', textAlign: 'center' }}>
      No revenue data yet.
    </div>
  );
  return (
    <div>
      <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 140, marginBottom: 6 }}>
        {data.map((month) => {
          const pct = (parseFloat(month.total) / maxTotal) * 100;
          return (
            <div key={month.period} style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
              <div
                title={`${month.period}: ${currency} ${parseFloat(month.total).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                style={{
                  height: `${pct}%`,
                  minHeight: parseFloat(month.total) > 0 ? 3 : 0,
                  background: 'var(--navy2)',
                  borderRadius: '3px 3px 0 0',
                  transition: 'height 0.3s',
                }}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', gap: 3 }}>
        {data.map(month => (
          <div key={month.period} style={{ flex: 1, fontSize: 9, color: 'rgba(0,0,0,0.35)', textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }}>
            {month.period.slice(5)}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Financials({ group }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`enterprise/groups/${group.id}/financials/`)
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [group.id]);

  if (loading) return <div className="empty"><div className="empty-title">Loading…</div></div>;
  if (!data)   return null;

  const fmt = v => parseFloat(v).toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <div>
      <div className="sec-hdr">
        <div className="sec-hdr-title">
          Financials
          <span style={{ fontWeight: 400, fontSize: 12, color: 'rgba(0,0,0,0.38)', marginLeft: 6 }}>{data.base_currency}</span>
        </div>
      </div>

      {data.missing_fx && data.missing_fx.length > 0 && (
        <div style={{ marginBottom: 16, padding: '10px 14px', background: '#fff8e1', borderRadius: 6, fontSize: 12, color: '#795548', border: '1px solid rgba(180,130,0,0.2)' }}>
          Missing exchange rates for: {data.missing_fx.join(', ')}. Those amounts are excluded from totals.
        </div>
      )}

      <div className="grid-4" style={{ marginBottom: 24 }}>
        {[
          { label: 'Paid This Month', val: `${data.base_currency} ${fmt(data.paid_this_month)}` },
          { label: 'Outstanding',     val: `${data.base_currency} ${fmt(data.outstanding)}` },
          { label: 'MRR',             val: `${data.base_currency} ${fmt(data.mrr)}` },
        ].map(k => (
          <div key={k.label} className="card stat-card">
            <div className="stat-label">{k.label}</div>
            <div className="stat-val" style={{ fontSize: 22 }}>{k.val}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 16 }}>Revenue — 12 months</div>
        <RevenueChart data={data.monthly_revenue} currency={data.base_currency} />
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Period</th>
              <th style={{ textAlign: 'right' }}>Total ({data.base_currency})</th>
            </tr>
          </thead>
          <tbody>
            {[...data.monthly_revenue].reverse().map(month => (
              <tr key={month.period}>
                <td>{month.period}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {fmt(month.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Start dev server and verify Financials renders**

Navigate to Financials in the marina-admin. Confirm: 3 KPI cards, bar chart (all navy bars matching revenue, with month labels), and table of 12 months in reverse chronological order. Stop dev server.

- [ ] **Step 3: Commit**

```bash
git add marina-admin/src/screens/Financials.jsx
git commit -m "feat(marina-admin): financials screen with KPIs, bar chart, and monthly table"
```

---

## Task 8: Marinas screen

**Files:**
- Create: `marina-admin/src/screens/Marinas.jsx`

- [ ] **Step 1: Create `marina-admin/src/screens/Marinas.jsx`**

```jsx
import { useState, useEffect } from 'react';
import api from '../api.js';
import Ic from '../components/ui/Icon.jsx';

export default function Marinas({ group }) {
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(true);
  const [ssoLoading, setSsoLoading] = useState(null);

  useEffect(() => {
    api.get(`enterprise/groups/${group.id}/overview/`)
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [group.id]);

  async function handleOpen(card) {
    setSsoLoading(card.id);
    try {
      const { data: td } = await api.post(`enterprise/groups/${group.id}/exchange_token/`, { marina_id: card.id });
      const marinaUrl = import.meta.env.VITE_MARINA_URL || 'http://localhost:5173';
      window.open(`${marinaUrl}?sso_token=${td.access}`, '_blank');
    } catch (e) {
      window.alert(e.response?.data?.detail || 'Failed to open marina.');
    } finally {
      setSsoLoading(null);
    }
  }

  if (loading) return <div className="empty"><div className="empty-title">Loading…</div></div>;
  if (!data)   return null;

  const { marinas } = data;
  const fmt = v => parseFloat(v).toLocaleString(undefined, { maximumFractionDigits: 0 });

  return (
    <div>
      <div className="sec-hdr">
        <div className="sec-hdr-title">
          Marinas <span style={{ fontWeight: 400, color: 'rgba(0,0,0,0.35)' }}>({marinas.length})</span>
        </div>
      </div>
      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Marina</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Occupancy</th>
              <th style={{ textAlign: 'right' }}>Active / Berths</th>
              <th style={{ textAlign: 'right' }}>Revenue MTD</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {marinas.length === 0 ? (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No marinas in group.</td></tr>
            ) : marinas.map(card => (
              <tr key={card.id}>
                <td><div className="tbl-name">{card.name}</div></td>
                <td><span className={`badge badge-${card.status === 'active' ? 'green' : 'gray'}`}>{card.status}</span></td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                  <span style={{ fontWeight: 600, color: card.occupancy_pct >= 80 ? 'var(--red)' : card.occupancy_pct >= 50 ? 'var(--orange)' : 'var(--green)' }}>
                    {card.occupancy_pct}%
                  </span>
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{card.active_bookings} / {card.total_berths}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{card.currency} {fmt(card.revenue_this_month)}</td>
                <td>
                  <button
                    className="btn btn-primary btn-sm"
                    disabled={ssoLoading === card.id}
                    onClick={() => handleOpen(card)}
                    style={{ gap: 5 }}
                  >
                    <Ic n="log-in" s={11} /> Open
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Start dev server and verify Marinas screen**

Navigate to Marinas. Confirm: table shows all group marinas with status, occupancy (colour-coded), active/berths, revenue MTD, and an "Open" button per row. Click "Open" — confirm it opens the marina frontend with a `?sso_token=` param in the URL. Stop dev server.

- [ ] **Step 3: Commit**

```bash
git add marina-admin/src/screens/Marinas.jsx
git commit -m "feat(marina-admin): marinas screen with table and SSO deep-link"
```

---

## Task 9: Staff screen

**Files:**
- Create: `marina-admin/src/screens/Staff.jsx`

- [ ] **Step 1: Create `marina-admin/src/screens/Staff.jsx`**

```jsx
import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';
import Ic from '../components/ui/Icon.jsx';

export default function Staff({ group }) {
  const [staff, setStaff]           = useState([]);
  const [marinas, setMarinas]       = useState([]);
  const [loading, setLoading]       = useState(true);
  const [acting, setActing]         = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteMarinaId, setInviteMarinaId] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get(`enterprise/groups/${group.id}/staff/`),
      api.get(`enterprise/groups/${group.id}/overview/`),
    ]).then(([s, o]) => {
      setStaff(s.data);
      setMarinas(o.data.marinas);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [group.id]);

  useEffect(() => { load(); }, [load]);

  async function handleInvite(e) {
    e.preventDefault();
    if (!inviteEmail || !inviteMarinaId) return;
    setActing(true);
    try {
      await api.post(`enterprise/groups/${group.id}/staff/invite/`, {
        email: inviteEmail,
        marina_id: parseInt(inviteMarinaId),
      });
      setInviteEmail('');
      setInviteMarinaId('');
      load();
    } catch (err) {
      window.alert(err.response?.data?.detail || 'Failed to invite staff.');
    } finally {
      setActing(false);
    }
  }

  async function handleRemove(userId) {
    if (!window.confirm('Remove this staff member?')) return;
    setActing(true);
    try {
      await api.post(`enterprise/groups/${group.id}/staff/${userId}/remove/`);
      load();
    } catch (err) {
      window.alert(err.response?.data?.detail || 'Failed to remove staff.');
    } finally {
      setActing(false);
    }
  }

  return (
    <div>
      <div className="sec-hdr">
        <div className="sec-hdr-title">Staff</div>
      </div>

      <div className="card" style={{ marginBottom: 16, padding: 18 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Invite staff member</div>
        <form onSubmit={handleInvite} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            Email
            <input
              type="email"
              value={inviteEmail}
              onChange={e => setInviteEmail(e.target.value)}
              placeholder="staff@marina.com"
              required
              style={{ fontSize: 12, minWidth: 200 }}
            />
          </label>
          <label style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 4 }}>
            Marina
            <select
              value={inviteMarinaId}
              onChange={e => setInviteMarinaId(e.target.value)}
              required
              style={{ fontSize: 12 }}
            >
              <option value="">Select marina…</option>
              {marinas.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <button type="submit" className="btn btn-primary btn-sm" disabled={acting} style={{ gap: 6 }}>
            <Ic n="plus" s={12} /> Invite
          </button>
        </form>
      </div>

      <div className="card">
        <table className="tbl">
          <thead>
            <tr>
              <th>Name / Email</th>
              <th>Marina</th>
              <th>Role</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
            ) : staff.length === 0 ? (
              <tr><td colSpan={4} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>No staff yet.</td></tr>
            ) : staff.map(s => (
              <tr key={s.id}>
                <td>
                  <div className="tbl-name">{s.name}</div>
                  <div className="tbl-sub">{s.email}</div>
                </td>
                <td style={{ fontSize: 12 }}>{s.marina_name}</td>
                <td><span className="badge badge-gray">{s.role}</span></td>
                <td>
                  <button
                    className="btn btn-ghost btn-sm"
                    disabled={acting}
                    onClick={() => handleRemove(s.id)}
                    style={{ color: 'var(--red)', borderColor: 'rgba(192,57,43,0.2)' }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Start dev server and verify Staff screen**

Navigate to Staff. Confirm: invite form shows email input + marina dropdown. Submit with a new email address — the staff member should appear in the table. Click Remove and confirm it disappears. Stop dev server.

- [ ] **Step 3: Commit**

```bash
git add marina-admin/src/screens/Staff.jsx
git commit -m "feat(marina-admin): staff screen with invite and remove"
```

---

## Task 10: Settings screen

**Files:**
- Create: `marina-admin/src/screens/Settings.jsx`

- [ ] **Step 1: Create `marina-admin/src/screens/Settings.jsx`**

```jsx
import { useState, useEffect } from 'react';
import api from '../api.js';
import Ic from '../components/ui/Icon.jsx';

export default function Settings({ group }) {
  const [settings, setSettings] = useState(null);
  const [editing, setEditing]   = useState({});
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [saved, setSaved]       = useState(false);

  useEffect(() => {
    api.get(`enterprise/groups/${group.id}/settings/`)
      .then(r => setSettings(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [group.id]);

  async function handleSave(e) {
    e.preventDefault();
    if (!Object.keys(editing).length) return;
    setSaving(true);
    try {
      const { data } = await api.patch(`enterprise/groups/${group.id}/settings/`, editing);
      setSettings(data);
      setEditing({});
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      window.alert(err.response?.data?.detail || 'Failed to save settings.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="empty"><div className="empty-title">Loading…</div></div>;
  if (!settings) return null;

  const val   = field => editing[field] !== undefined ? editing[field] : (settings[field] ?? '');
  const set   = field => e => setEditing(prev => ({ ...prev, [field]: e.target.value }));
  const dirty = Object.keys(editing).length > 0;

  return (
    <div>
      <div className="sec-hdr">
        <div className="sec-hdr-title">Settings</div>
      </div>

      <div className="card" style={{ maxWidth: 480, padding: 24 }}>
        <form onSubmit={handleSave}>
          {[
            ['Group name',      'name',                   'text'],
            ['Billing email',   'billing_contact_email',  'email'],
            ['VAT number',      'vat_number',             'text'],
            ['Base currency',   'base_currency',          'text'],
          ].map(([label, field, type]) => (
            <div key={field} style={{ marginBottom: 18 }}>
              <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 5, color: 'rgba(0,0,0,0.6)' }}>
                {label}
              </label>
              <input
                type={type}
                value={val(field)}
                onChange={set(field)}
                style={{ width: '100%', fontSize: 13 }}
              />
            </div>
          ))}
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 8 }}>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={saving || !dirty}
              style={{ gap: 6 }}
            >
              <Ic n="save" s={13} /> Save changes
            </button>
            {saved && (
              <span style={{ fontSize: 12, color: 'var(--green)' }}>Saved.</span>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Start dev server and verify Settings screen**

Navigate to Settings. Confirm: four fields pre-populated from the group's settings. Edit the group name, click Save — the topbar group name does NOT update (it's stored in localStorage), but the settings response shows the new name. Stop dev server.

- [ ] **Step 3: Run full backend test suite one final time**

```bash
cd backend
python manage.py test apps.enterprise -v 2
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add marina-admin/src/screens/Settings.jsx
git commit -m "feat(marina-admin): settings screen for group self-service editing"
```
