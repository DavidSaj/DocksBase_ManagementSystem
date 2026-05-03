# Subdomain Multi-Tenant Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement wildcard subdomain routing so each marina's boater portal lives at `[slug].docksbase.com` (dev: `[slug].lvh.me:5173`), fully isolated from the manager dashboard at `app.docksbase.com`.

**Architecture:** The Marina model gains a unique `slug` field. A Django `TenantMiddleware` reads an `X-Marina-Slug` request header sent by the frontend and attaches `request.tenant` (a `Marina` instance) to every request. The React frontend detects the subdomain at boot, routes to either the manager dashboard (subdomain `app`) or the boater portal (any other subdomain), and injects the slug into all API calls via an Axios interceptor.

**Tech Stack:** Django 6, DRF, django-cors-headers, React 19, Vite 8, Axios, lvh.me (dev wildcard DNS)

---

## How lvh.me Works in Development

`*.lvh.me` is a public DNS wildcard that resolves every subdomain to `127.0.0.1`. No `/etc/hosts` editing required.

| URL | What it hits |
|---|---|
| `http://app.lvh.me:5173` | Vite dev server → manager dashboard |
| `http://frauzanger.lvh.me:5173` | Vite dev server → boater portal (slug = `frauzanger`) |
| `http://localhost:8000/api/v1/` | Django dev server |

The frontend (at `frauzanger.lvh.me:5173`) calls Django at `http://localhost:8000/api/v1/` and sends `X-Marina-Slug: frauzanger` so Django knows which tenant to load.

---

## File Map

**Create:**
- `backend/apps/accounts/middleware.py` — `TenantMiddleware` class
- `backend/apps/accounts/tests/test_middleware.py` — middleware unit tests
- `backend/apps/portal/views.py` — public `MarinaPublicView` (no auth)
- `backend/apps/portal/urls.py` — URL patterns for public portal endpoints
- `frontend/src/context/TenantContext.jsx` — subdomain detection + tenant context
- `frontend/src/portal/PortalApp.jsx` — boater portal route shell

**Modify:**
- `backend/apps/accounts/models.py:16-58` — add `slug` field + auto-populate in `save()`
- `backend/config/settings/base.py:57-67` — add `TenantMiddleware` to MIDDLEWARE + `CORS_ALLOW_HEADERS`
- `backend/config/settings/dev.py` — ALLOWED_HOSTS + CORS regex for lvh.me
- `backend/config/urls.py` — mount public portal URLs at `/api/v1/public/`
- `frontend/vite.config.js` — add `server.allowedHosts` for lvh.me
- `frontend/src/api.js` — interceptor to inject `X-Marina-Slug` header
- `frontend/src/App.jsx` — subdomain detection, split routes for manager vs. portal

---

## Task 1: Add slug field to Marina model

**Files:**
- Modify: `backend/apps/accounts/models.py`
- Test: `backend/apps/accounts/tests/test_marina_slug.py` (create this file)

- [ ] **Step 1: Write the failing test**

Create `backend/apps/accounts/tests/test_marina_slug.py`:

```python
from django.test import TestCase
from apps.accounts.models import Marina


class MarinaSlugTest(TestCase):
    def test_slug_auto_populated_from_name(self):
        marina = Marina.objects.create(name='Frau Zanger Marina')
        self.assertEqual(marina.slug, 'frau-zanger-marina')

    def test_slug_unique_collision_gets_suffix(self):
        Marina.objects.create(name='Blue Cove')
        duplicate = Marina.objects.create(name='Blue Cove')
        self.assertEqual(duplicate.slug, 'blue-cove-1')

    def test_existing_slug_not_overwritten_on_save(self):
        marina = Marina.objects.create(name='Old Name', slug='my-custom-slug')
        marina.name = 'New Name'
        marina.save()
        marina.refresh_from_db()
        self.assertEqual(marina.slug, 'my-custom-slug')

    def test_slug_field_is_unique(self):
        from django.db import IntegrityError
        Marina.objects.create(name='Alpha', slug='alpha')
        with self.assertRaises(IntegrityError):
            Marina.objects.create(name='Beta', slug='alpha')
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd DocksBase_ManagementSystem/backend
python manage.py test apps.accounts.tests.test_marina_slug --settings=config.settings.dev -v 2
```

Expected: FAIL — `slug` field does not exist on the Marina model.

- [ ] **Step 3: Add slug field to Marina model**

In `backend/apps/accounts/models.py`, find the `Marina` class (starts around line 16). Add the import at the top and the field + save override:

At the top of the file, add if not already present:
```python
from django.utils.text import slugify
```

Inside the `Marina` class, add the field after the existing fields (before `class Meta` or the end of the class):
```python
    slug = models.SlugField(max_length=100, unique=True, blank=True)
```

Add or extend the `save()` method on `Marina`:
```python
    def save(self, *args, **kwargs):
        if not self.slug:
            base = slugify(self.name)
            slug = base
            n = 1
            while Marina.objects.filter(slug=slug).exclude(pk=self.pk).exists():
                slug = f'{base}-{n}'
                n += 1
            self.slug = slug
        super().save(*args, **kwargs)
```

- [ ] **Step 4: Create and run the migration**

```bash
python manage.py makemigrations accounts --name add_marina_slug --settings=config.settings.dev
python manage.py migrate --settings=config.settings.dev
```

Expected: New migration file created and applied. No errors.

- [ ] **Step 5: Run tests to verify they pass**

```bash
python manage.py test apps.accounts.tests.test_marina_slug --settings=config.settings.dev -v 2
```

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/accounts/models.py backend/apps/accounts/migrations/ backend/apps/accounts/tests/test_marina_slug.py
git commit -m "feat: add slug field to Marina model with auto-population"
```

---

## Task 2: Create TenantMiddleware

**Files:**
- Create: `backend/apps/accounts/middleware.py`
- Create: `backend/apps/accounts/tests/test_middleware.py`

- [ ] **Step 1: Write the failing test**

Create `backend/apps/accounts/tests/test_middleware.py`:

```python
from django.test import TestCase, RequestFactory
from django.http import JsonResponse
from apps.accounts.models import Marina
from apps.accounts.middleware import TenantMiddleware


class TenantMiddlewareTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina', slug='test-marina')
        self.factory = RequestFactory()

        def dummy_view(request):
            return JsonResponse({'ok': True})

        self.middleware = TenantMiddleware(dummy_view)

    def test_attaches_tenant_when_slug_header_present(self):
        request = self.factory.get('/api/v1/public/marina/', HTTP_X_MARINA_SLUG='test-marina')
        self.middleware(request)
        self.assertEqual(request.tenant, self.marina)

    def test_sets_tenant_none_when_no_header(self):
        request = self.factory.get('/api/v1/public/marina/')
        self.middleware(request)
        self.assertIsNone(request.tenant)

    def test_returns_404_json_for_unknown_slug(self):
        request = self.factory.get('/api/v1/public/marina/', HTTP_X_MARINA_SLUG='nonexistent')
        response = self.middleware(request)
        self.assertEqual(response.status_code, 404)
        self.assertIn('error', response.json())

    def test_empty_slug_header_sets_tenant_none(self):
        request = self.factory.get('/api/v1/public/marina/', HTTP_X_MARINA_SLUG='')
        self.middleware(request)
        self.assertIsNone(request.tenant)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python manage.py test apps.accounts.tests.test_middleware --settings=config.settings.dev -v 2
```

Expected: FAIL — `cannot import name 'TenantMiddleware'`.

- [ ] **Step 3: Create the middleware**

Create `backend/apps/accounts/middleware.py`:

```python
from django.http import JsonResponse
from apps.accounts.models import Marina


class TenantMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        slug = request.META.get('HTTP_X_MARINA_SLUG', '').strip()
        if not slug:
            request.tenant = None
            return self.get_response(request)

        try:
            request.tenant = Marina.objects.get(slug=slug)
        except Marina.DoesNotExist:
            return JsonResponse({'error': f"Marina '{slug}' not found."}, status=404)

        return self.get_response(request)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python manage.py test apps.accounts.tests.test_middleware --settings=config.settings.dev -v 2
```

Expected: 4 tests PASS.

- [ ] **Step 5: Wire TenantMiddleware into settings**

In `backend/config/settings/base.py`, add `TenantMiddleware` to the MIDDLEWARE list. It must go **after** `CorsMiddleware` (so CORS headers are already handled) and **before** `CommonMiddleware`:

```python
MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'csp.middleware.CSPMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'apps.accounts.middleware.TenantMiddleware',   # <-- add this line
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]
```

Also add `CORS_ALLOW_HEADERS` to `base.py` so `X-Marina-Slug` is not blocked by CORS preflight. Add this anywhere in `base.py` (e.g., after the `REST_FRAMEWORK` block):

```python
from corsheaders.defaults import default_headers

CORS_ALLOW_HEADERS = list(default_headers) + [
    'X-Marina-Slug',
]
```

- [ ] **Step 6: Run existing tests to confirm no regression**

```bash
python manage.py test apps.accounts --settings=config.settings.dev -v 1
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/accounts/middleware.py backend/apps/accounts/tests/test_middleware.py backend/config/settings/base.py
git commit -m "feat: add TenantMiddleware to resolve marina from X-Marina-Slug header"
```

---

## Task 3: Update dev settings for lvh.me

**Files:**
- Modify: `backend/config/settings/dev.py`

No tests for this task — it's configuration. Verify manually.

- [ ] **Step 1: Update ALLOWED_HOSTS and CORS in dev.py**

Replace the entire contents of `backend/config/settings/dev.py` with:

```python
import os as _os
if _os.environ.get('DJANGO_ENV') == 'production':
    raise RuntimeError('Dev settings must not be used in production. Set DJANGO_SETTINGS_MODULE to config.settings.prod')

from .base import *
import re

DEBUG = True

ALLOWED_HOSTS = ['localhost', '127.0.0.1', '.lvh.me']

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}

# Allow both localhost:5173 origins and any *.lvh.me:5173 origins
CORS_ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
]

CORS_ALLOWED_ORIGIN_REGEXES = [
    r'^http://[a-z0-9\-]+\.lvh\.me(:\d+)?$',
]

EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'

STRIPE_SECRET_KEY = 'sk_test_placeholder'
STRIPE_WEBHOOK_SECRET = 'whsec_placeholder'
```

- [ ] **Step 2: Restart Django dev server and verify**

```bash
python manage.py runserver --settings=config.settings.dev
```

Then in a browser or curl, confirm `http://localhost:8000/api/v1/auth/token/` still responds (401 or 400 — not a 400 ALLOWED_HOSTS error).

- [ ] **Step 3: Commit**

```bash
git add backend/config/settings/dev.py
git commit -m "feat: allow lvh.me origins and hosts in dev settings for subdomain routing"
```

---

## Task 4: Create public marina endpoint

**Files:**
- Create: `backend/apps/portal/views.py`
- Create: `backend/apps/portal/urls.py`
- Modify: `backend/config/urls.py`
- Test: `backend/apps/portal/tests/test_public_views.py` (create dirs + file)

- [ ] **Step 1: Write the failing test**

Create the directory structure if needed:
```bash
mkdir -p backend/apps/portal/tests
touch backend/apps/portal/__init__.py
touch backend/apps/portal/tests/__init__.py
```

Create `backend/apps/portal/tests/test_public_views.py`:

```python
from django.test import TestCase
from django.urls import reverse
from apps.accounts.models import Marina


class MarinaPublicViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='Blue Cove Marina',
            slug='blue-cove',
            contact_email='info@bluecove.com',
            timezone='Europe/Paris',
            currency='EUR',
        )

    def test_returns_public_marina_data(self):
        response = self.client.get(
            '/api/v1/public/marina/',
            HTTP_X_MARINA_SLUG='blue-cove',
        )
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data['slug'], 'blue-cove')
        self.assertEqual(data['name'], 'Blue Cove Marina')
        self.assertEqual(data['timezone'], 'Europe/Paris')
        self.assertEqual(data['currency'], 'EUR')
        # Does NOT expose internal fields
        self.assertNotIn('stripe_account_id', data)
        self.assertNotIn('vat_number', data)

    def test_returns_404_for_unknown_slug(self):
        response = self.client.get(
            '/api/v1/public/marina/',
            HTTP_X_MARINA_SLUG='nonexistent',
        )
        self.assertEqual(response.status_code, 404)

    def test_returns_400_when_no_slug_header(self):
        response = self.client.get('/api/v1/public/marina/')
        self.assertEqual(response.status_code, 400)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python manage.py test apps.portal.tests.test_public_views --settings=config.settings.dev -v 2
```

Expected: FAIL — URL not found or view does not exist.

- [ ] **Step 3: Create the public view**

Create `backend/apps/portal/views.py`:

```python
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import AllowAny


class MarinaPublicView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        if request.tenant is None:
            return Response({'error': 'X-Marina-Slug header is required.'}, status=400)
        marina = request.tenant
        return Response({
            'id': marina.id,
            'name': marina.name,
            'slug': marina.slug,
            'timezone': marina.timezone,
            'currency': marina.currency,
            'contact_email': marina.contact_email,
            'phone': marina.phone,
            'booking_mode': marina.booking_mode,
        })
```

- [ ] **Step 4: Create the public URL patterns**

Create `backend/apps/portal/urls.py`:

```python
from django.urls import path
from apps.portal.views import MarinaPublicView

urlpatterns = [
    path('marina/', MarinaPublicView.as_view(), name='public-marina'),
]
```

- [ ] **Step 5: Mount the URLs in the main config**

In `backend/config/urls.py`, add the public portal include alongside the existing patterns:

```python
path('api/v1/public/', include('apps.portal.urls')),
```

The full urlpatterns list should now include this entry. Find the existing `urlpatterns` list and add it — place it near the other `api/v1/` entries.

- [ ] **Step 6: Run tests to verify they pass**

```bash
python manage.py test apps.portal.tests.test_public_views --settings=config.settings.dev -v 2
```

Expected: 3 tests PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/portal/ backend/config/urls.py
git commit -m "feat: add public marina endpoint at /api/v1/public/marina/"
```

---

## Task 5: Update Vite config for lvh.me dev

**Files:**
- Modify: `frontend/vite.config.js`

- [ ] **Step 1: Add allowedHosts to Vite dev server config**

Open `frontend/vite.config.js`. Find the `export default defineConfig({...})` block and add a `server` key (or merge into an existing one if it exists):

```js
server: {
  host: true,
  allowedHosts: ['.lvh.me', 'localhost'],
},
```

The complete file should look like (keeping all existing plugins/aliases):

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({ /* existing PWA config */ }),
  ],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    host: true,
    allowedHosts: ['.lvh.me', 'localhost'],
  },
})
```

Do not remove any existing plugin options — only add the `server` block.

- [ ] **Step 2: Start Vite and verify lvh.me works**

```bash
cd DocksBase_ManagementSystem/frontend
npm run dev
```

Then open `http://app.lvh.me:5173` in the browser. Expected: the app loads (login page). Open `http://frauzanger.lvh.me:5173` — app also loads (same login page for now; routing split happens in Task 7).

If Vite shows a "Blocked request" error, confirm `allowedHosts` was saved correctly.

- [ ] **Step 3: Commit**

```bash
git add frontend/vite.config.js
git commit -m "feat: allow lvh.me hosts in Vite dev server for subdomain routing"
```

---

## Task 6: Create TenantContext

**Files:**
- Create: `frontend/src/context/TenantContext.jsx`

- [ ] **Step 1: Create TenantContext**

Create `frontend/src/context/TenantContext.jsx`:

```jsx
import { createContext, useContext, useEffect, useState } from 'react'
import api from '../api'

const TenantContext = createContext(null)

function getSubdomain() {
  const hostname = window.location.hostname
  // hostname examples:
  //   'app.lvh.me'        → subdomain 'app'   → manager
  //   'frauzanger.lvh.me' → subdomain 'frauzanger' → portal
  //   'localhost'          → no subdomain → manager (dev fallback)
  const parts = hostname.split('.')
  if (parts.length <= 1) return null   // plain 'localhost'
  const sub = parts[0]
  if (sub === 'app' || sub === 'www') return null
  return sub
}

export function TenantProvider({ children }) {
  const tenantSlug = getSubdomain()
  const [marina, setMarina] = useState(null)
  const [isLoading, setIsLoading] = useState(!!tenantSlug)

  useEffect(() => {
    if (!tenantSlug) return
    api.get('/public/marina/', { headers: { 'X-Marina-Slug': tenantSlug } })
      .then(res => setMarina(res.data))
      .catch(() => setMarina(null))
      .finally(() => setIsLoading(false))
  }, [tenantSlug])

  return (
    <TenantContext.Provider value={{ tenantSlug, marina, isLoading }}>
      {children}
    </TenantContext.Provider>
  )
}

export function useTenant() {
  return useContext(TenantContext)
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/context/TenantContext.jsx
git commit -m "feat: add TenantContext with subdomain detection"
```

---

## Task 7: Update API client to inject X-Marina-Slug header

**Files:**
- Modify: `frontend/src/api.js`

The Axios instance in `api.js` already has a request interceptor that attaches the JWT token. We need to add a second interceptor that reads `tenantSlug` from the URL and injects `X-Marina-Slug` when present.

We cannot import `useTenant()` in `api.js` (hooks can't be used outside React). Instead, read the subdomain directly from `window.location.hostname` — same logic as `TenantContext`.

- [ ] **Step 1: Add tenant header injection to api.js**

Open `frontend/src/api.js`. Find the existing request interceptor. Add the tenant slug injection inside the **same** interceptor, after the auth token attachment:

```js
// At the top of api.js, add this helper:
function getTenantSlug() {
  const parts = window.location.hostname.split('.')
  if (parts.length <= 1) return null
  const sub = parts[0]
  if (sub === 'app' || sub === 'www') return null
  return sub
}
```

Then inside the existing request interceptor (the one that adds `Authorization`), add:

```js
const slug = getTenantSlug()
if (slug) {
  config.headers['X-Marina-Slug'] = slug
}
```

The final interceptor should look like:

```js
api.interceptors.request.use(config => {
  const token = localStorage.getItem('access_token')
  if (token) {
    config.headers['Authorization'] = `Bearer ${token}`
  }
  const slug = getTenantSlug()
  if (slug) {
    config.headers['X-Marina-Slug'] = slug
  }
  return config
})
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api.js
git commit -m "feat: inject X-Marina-Slug header into all API requests from tenant subdomains"
```

---

## Task 8: Create PortalApp shell

**Files:**
- Create: `frontend/src/portal/PortalApp.jsx`

This is the root component for the boater portal. For MVP it shows marina name and a "coming soon" message. Full booking UI is a separate feature.

- [ ] **Step 1: Create the portal shell**

Create `frontend/src/portal/PortalApp.jsx`:

```jsx
import { useTenant } from '../context/TenantContext'

export default function PortalApp() {
  const { marina, isLoading, tenantSlug } = useTenant()

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <p>Loading...</p>
      </div>
    )
  }

  if (!marina) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <p>Marina "{tenantSlug}" not found.</p>
      </div>
    )
  }

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 600, margin: '80px auto', textAlign: 'center' }}>
      <h1>{marina.name}</h1>
      <p>Online booking coming soon.</p>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/portal/PortalApp.jsx
git commit -m "feat: add PortalApp shell for boater-facing subdomain"
```

---

## Task 9: Update App.jsx for subdomain routing

**Files:**
- Modify: `frontend/src/App.jsx`

This is the key routing split. `App.jsx` currently renders the full manager dashboard for all hostnames. We need it to detect whether we're on a tenant subdomain and render `PortalApp` instead.

- [ ] **Step 1: Read the current App.jsx**

Open `frontend/src/App.jsx` and locate:
1. All existing imports at the top
2. The component return / route structure
3. Where `<BrowserRouter>` or route tree starts

- [ ] **Step 2: Modify App.jsx to split on subdomain**

Add these imports at the top of App.jsx (after existing imports):

```jsx
import { TenantProvider } from './context/TenantContext'
import PortalApp from './portal/PortalApp'
```

Add this helper near the top of the file (outside the component):

```jsx
function getTenantSlug() {
  const parts = window.location.hostname.split('.')
  if (parts.length <= 1) return null
  const sub = parts[0]
  if (sub === 'app' || sub === 'www') return null
  return sub
}
```

Then in the `App` component's return, wrap the entire existing JSX in the conditional:

```jsx
export default function App() {
  const tenantSlug = getTenantSlug()

  if (tenantSlug) {
    return (
      <TenantProvider>
        <PortalApp />
      </TenantProvider>
    )
  }

  // --- existing manager dashboard JSX below, unchanged ---
  return (
    // ... all existing routes/providers stay exactly as they were
  )
}
```

Do not modify any of the existing manager dashboard routes, context providers, or components.

- [ ] **Step 3: Verify routing manually**

With both `npm run dev` (frontend) and `python manage.py runserver --settings=config.settings.dev` (backend) running:

1. Open `http://app.lvh.me:5173` → should show login page (manager dashboard, unchanged)
2. Open `http://frauzanger.lvh.me:5173` → should show "Marina 'frauzanger' not found." (because no marina with that slug exists yet)
3. In Django shell, create a test marina:
   ```bash
   python manage.py shell --settings=config.settings.dev
   ```
   ```python
   from apps.accounts.models import Marina
   Marina.objects.create(name='Frau Zanger Marina', slug='frauzanger')
   ```
4. Refresh `http://frauzanger.lvh.me:5173` → should show "Frau Zanger Marina / Online booking coming soon."

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat: split App.jsx routing — tenant subdomains render PortalApp, app subdomain renders manager dashboard"
```

---

## Self-Review

### Spec Coverage

| Requirement | Task |
|---|---|
| Slug field on Marina, auto-populated from name | Task 1 |
| TenantMiddleware reads `X-Marina-Slug` header | Task 2 |
| `request.tenant` attached to every request | Task 2 |
| 404 JSON response for unknown slug | Task 2 |
| ALLOWED_HOSTS includes `.lvh.me` | Task 3 |
| CORS regex allows `*.lvh.me` | Task 3 |
| `X-Marina-Slug` allowed by CORS preflight | Task 2 (Step 5) |
| Public marina endpoint (no auth) | Task 4 |
| Vite accepts lvh.me hosts | Task 5 |
| Frontend subdomain detection | Task 6 + Task 9 |
| `tenantSlug` provided via Context to portal components | Task 6 |
| API calls include slug header | Task 7 |
| Separate route tree for boater portal | Task 8 + Task 9 |
| `app` subdomain → manager dashboard | Task 9 |
| Dev setup with lvh.me | Tasks 3, 5 |

### Placeholder Scan

No TBD/TODO items. Every step has complete code.

### Type Consistency

- `getTenantSlug()` is defined separately in `api.js` and `TenantContext.jsx` (and `App.jsx`) — intentional duplication to avoid circular imports. Both implementations are identical.
- `request.tenant` is a `Marina` model instance (or `None`) — consistent across middleware test and public view.
- `X-Marina-Slug` header name is spelled identically in middleware (`HTTP_X_MARINA_SLUG` via Django's META format), CORS config, API interceptor, and TenantContext fetch call.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-03-subdomain-multi-tenant.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
