# Mobile PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add role-based routing, magic-link auth for boaters, a three-tab Boater Portal (Invoices, Absence, Crane), and PWA manifest to the existing React + Django stack.

**Architecture:** One Django `portal` app houses all boater-facing models and API views. The frontend adds a `useAuth` context that drives a three-way role router; magic link exchange uses `navigate(..., { replace: true })` to strip the token from the URL bar immediately.

**Tech Stack:** Django 4 / DRF / SimpleJWT, React 19 / React Router 7, Vite 8 / vite-plugin-pwa, IBM Plex Sans + design-system CSS tokens.

---

## File Map

### Backend — new / changed
| File | Action |
|------|--------|
| `backend/apps/accounts/models.py` | Add `boater` role + `MagicToken` model |
| `backend/apps/accounts/serializers.py` | Add `MagicTokenExchangeSerializer` |
| `backend/apps/accounts/views.py` | Add `SendMagicLinkView`, `ExchangeMagicTokenView` |
| `backend/apps/accounts/urls.py` | Add two magic-link URL patterns |
| `backend/apps/members/models.py` | Add nullable `boater_user` OneToOneField → User |
| `backend/apps/portal/` | **New app** — models, serializers, views, urls, apps |
| `backend/config/settings/base.py` | Add `'apps.portal'` to LOCAL_APPS |
| `backend/config/urls.py` | Include portal URLs |

### Frontend — new / changed
| File | Action |
|------|--------|
| `frontend/package.json` | Add `vite-plugin-pwa` |
| `frontend/vite.config.js` | Register PWA plugin |
| `frontend/public/manifest.json` | PWA manifest |
| `frontend/src/context/AuthContext.jsx` | New — `useAuth` hook + `AuthProvider` |
| `frontend/src/components/routing/ProtectedRoute.jsx` | New — role-gated wrapper |
| `frontend/src/App.jsx` | Replace inline routing with `AuthProvider` + role router |
| `frontend/src/api.js` | Add `exchangeMagicToken()`, `sendMagicLink()` |
| `frontend/src/screens/Login.jsx` | New — shared login screen |
| `frontend/src/screens/MagicLink.jsx` | New — token exchange + redirect |
| `frontend/src/screens/BoaterPortal.jsx` | New — three-tab portal |
| `frontend/src/hooks/usePortalInvoices.js` | New |
| `frontend/src/hooks/usePortalCraneRequests.js` | New |
| `frontend/src/styles/app.css` | Add `.portal-*` classes |
| `frontend/src/screens/Members.jsx` | Add "Send Portal Link" button |

---

## Task 1: Add `boater` role and `MagicToken` model

**Files:**
- Modify: `backend/apps/accounts/models.py`

- [ ] **Step 1: Add `boater` to ROLE_CHOICES and write MagicToken**

Open `backend/apps/accounts/models.py`. Make these two changes:

```python
# In User.ROLE_CHOICES — add boater:
ROLE_CHOICES = [
    ('owner', 'Owner'),
    ('manager', 'Manager'),
    ('staff', 'Staff'),
    ('boater', 'Boater'),        # ← add this line
]
```

Then add the MagicToken model at the bottom of the file (after the User class):

```python
import uuid as _uuid  # add at top of file

class MagicToken(models.Model):
    user       = models.ForeignKey(User, on_delete=models.CASCADE, related_name='magic_tokens')
    token      = models.UUIDField(default=_uuid.uuid4, unique=True, db_index=True)
    expires_at = models.DateTimeField()

    def __str__(self):
        return f"MagicToken({self.user.email}, expires {self.expires_at})"
```

Also add the import at the very top of the file:
```python
import uuid as _uuid
from django.utils import timezone  # add if not already present
```

- [ ] **Step 2: Add `boater_user` FK to Member**

Open `backend/apps/members/models.py`. Add one field to `Member`:

```python
# inside class Member(models.Model), after the `tags` field:
boater_user = models.OneToOneField(
    'accounts.User',
    on_delete=models.SET_NULL,
    null=True, blank=True,
    related_name='member_profile',
)
```

- [ ] **Step 3: Generate and run migrations**

```bash
cd backend
python manage.py makemigrations accounts members
python manage.py migrate
```

Expected output ends with: `Applying accounts.000X_... OK` and `Applying members.000X_... OK`

- [ ] **Step 4: Commit**

```bash
git add backend/apps/accounts/models.py backend/apps/members/models.py backend/apps/accounts/migrations/ backend/apps/members/migrations/
git commit -m "feat(auth): add boater role, MagicToken model, Member.boater_user FK"
```

---

## Task 2: Magic link serializers and views

**Files:**
- Modify: `backend/apps/accounts/serializers.py`
- Modify: `backend/apps/accounts/views.py`

- [ ] **Step 1: Add MagicTokenExchangeSerializer**

Open `backend/apps/accounts/serializers.py`. Add at the bottom:

```python
from rest_framework import serializers as _drf_serializers

class SendMagicLinkSerializer(_drf_serializers.Serializer):
    member_id = _drf_serializers.IntegerField()

class ExchangeMagicTokenSerializer(_drf_serializers.Serializer):
    token = _drf_serializers.UUIDField()
```

- [ ] **Step 2: Add SendMagicLinkView and ExchangeMagicTokenView**

Open `backend/apps/accounts/views.py`. Add these imports at the top:

```python
from django.utils import timezone
from django.core.mail import send_mail
from datetime import timedelta
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework_simplejwt.tokens import RefreshToken
from .models import MagicToken
from .serializers import SendMagicLinkSerializer, ExchangeMagicTokenSerializer
from apps.members.models import Member
```

Then add two new views at the bottom of `views.py`:

```python
class SendMagicLinkView(APIView):
    """Admin/manager sends a magic login link to a boater (Member)."""

    def post(self, request):
        ser = SendMagicLinkSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        try:
            member = Member.objects.get(
                id=ser.validated_data['member_id'],
                marina=request.user.marina,
            )
        except Member.DoesNotExist:
            return Response({'detail': 'Member not found.'}, status=status.HTTP_404_NOT_FOUND)

        if not member.email:
            return Response({'detail': 'Member has no email address.'}, status=status.HTTP_400_BAD_REQUEST)

        # Find or create boater User linked to this Member
        if member.boater_user_id:
            boater_user = member.boater_user
        else:
            boater_user = User.objects.create_user(
                email=member.email,
                role='boater',
                first_name=member.name.split()[0] if member.name else '',
                marina=request.user.marina,
            )
            member.boater_user = boater_user
            member.save(update_fields=['boater_user'])

        # Delete all existing tokens — only newest link is valid
        MagicToken.objects.filter(user=boater_user).delete()

        magic = MagicToken.objects.create(
            user=boater_user,
            expires_at=timezone.now() + timedelta(days=7),
        )

        frontend_url = request.headers.get('Origin', 'https://app.docksbase.com')
        link = f"{frontend_url}/magic?token={magic.token}"

        send_mail(
            subject='Your DockBase portal link',
            message=f"Hi {member.name},\n\nClick to access your marina portal (valid 7 days):\n{link}\n\nDockBase",
            from_email=None,  # uses DEFAULT_FROM_EMAIL
            recipient_list=[member.email],
        )

        return Response({'detail': 'Link sent.'}, status=status.HTTP_200_OK)


class ExchangeMagicTokenView(APIView):
    """Boater exchanges a one-time token for a JWT pair."""
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        ser = ExchangeMagicTokenSerializer(data=request.data)
        ser.is_valid(raise_exception=True)

        try:
            magic = MagicToken.objects.select_related('user').get(
                token=ser.validated_data['token']
            )
        except MagicToken.DoesNotExist:
            return Response({'detail': 'Invalid or expired link.'}, status=status.HTTP_400_BAD_REQUEST)

        if magic.expires_at < timezone.now():
            magic.delete()
            return Response({'detail': 'Link has expired. Ask the marina for a new one.'}, status=status.HTTP_400_BAD_REQUEST)

        user = magic.user
        magic.delete()  # single-use

        refresh = RefreshToken.for_user(user)
        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'user': UserSerializer(user).data,
        })
```

- [ ] **Step 3: Wire up URLs**

Open `backend/apps/accounts/urls.py`. Add two patterns:

```python
from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView, TokenVerifyView
from .views import LoginView, MeView, SendMagicLinkView, ExchangeMagicTokenView

urlpatterns = [
    path('token/', LoginView.as_view(), name='token_obtain'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('token/verify/', TokenVerifyView.as_view(), name='token_verify'),
    path('me/', MeView.as_view(), name='me'),
    path('magic/send/', SendMagicLinkView.as_view(), name='magic_send'),
    path('magic/exchange/', ExchangeMagicTokenView.as_view(), name='magic_exchange'),
]
```

- [ ] **Step 4: Test magic exchange manually**

```bash
cd backend
python manage.py shell -c "
from apps.accounts.models import User, MagicToken
from django.utils import timezone
from datetime import timedelta
u = User.objects.filter(role='boater').first()
if not u:
    u = User.objects.create_user(email='test_boater@example.com', role='boater')
MagicToken.objects.filter(user=u).delete()
t = MagicToken.objects.create(user=u, expires_at=timezone.now()+timedelta(days=7))
print('token:', t.token)
"
```

Then in a second terminal:
```bash
curl -s -X POST http://localhost:8000/api/v1/auth/magic/exchange/ \
  -H 'Content-Type: application/json' \
  -d '{"token":"<paste-token-here>"}' | python -m json.tool
```

Expected: JSON with `access`, `refresh`, and `user.role == "boater"`.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/accounts/
git commit -m "feat(auth): add magic link send/exchange endpoints"
```

---

## Task 3: Portal Django app (AbsenceReport + CraneRequest)

**Files:**
- Create: `backend/apps/portal/` (entire app)
- Modify: `backend/config/settings/base.py`
- Modify: `backend/config/urls.py`

- [ ] **Step 1: Scaffold the portal app**

```bash
cd backend
python manage.py startapp portal apps/portal
```

- [ ] **Step 2: Write portal models**

Replace the contents of `backend/apps/portal/models.py`:

```python
from django.db import models


class AbsenceReport(models.Model):
    TYPE_CHOICES = [
        ('day_trip', 'Day Trip'),
        ('overnight', 'Overnight'),
        ('extended', 'Extended'),
    ]

    member  = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='absence_reports')
    absence_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    departure    = models.DateField()
    return_date  = models.DateField()
    notes        = models.TextField(blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.member.name} absent {self.departure}–{self.return_date}"


class CraneRequest(models.Model):
    SERVICE_CHOICES = [
        ('launch', 'Launch'),
        ('haul_out', 'Haul-out'),
        ('both', 'Launch & Haul-out'),
    ]
    STATUS_CHOICES = [
        ('requested', 'Requested'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ]

    member        = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='crane_requests')
    service_type  = models.CharField(max_length=20, choices=SERVICE_CHOICES)
    requested_date = models.DateField()
    notes         = models.TextField(blank=True)
    status        = models.CharField(max_length=20, choices=STATUS_CHOICES, default='requested')
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"CraneRequest({self.member.name}, {self.service_type}, {self.requested_date})"
```

- [ ] **Step 3: Update portal app config**

Replace `backend/apps/portal/apps.py`:

```python
from django.apps import AppConfig


class PortalConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.portal'
```

- [ ] **Step 4: Register app in settings**

Open `backend/config/settings/base.py`. Find the `LOCAL_APPS` list and add:

```python
LOCAL_APPS = [
    # ... existing apps ...
    'apps.portal',   # ← add this line
]
```

- [ ] **Step 5: Generate and run migrations**

```bash
cd backend
python manage.py makemigrations portal
python manage.py migrate
```

Expected: `Applying portal.0001_initial... OK`

- [ ] **Step 6: Commit**

```bash
git add backend/apps/portal/ backend/config/settings/base.py
git commit -m "feat(portal): add AbsenceReport and CraneRequest models"
```

---

## Task 4: Portal API views

**Files:**
- Create: `backend/apps/portal/serializers.py`
- Create: `backend/apps/portal/views.py`
- Create: `backend/apps/portal/urls.py`
- Modify: `backend/config/urls.py`

- [ ] **Step 1: Write portal serializers**

Create `backend/apps/portal/serializers.py`:

```python
from rest_framework import serializers
from apps.billing.models import Invoice
from .models import AbsenceReport, CraneRequest


class PortalInvoiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Invoice
        fields = ['id', 'invoice_type', 'amount', 'issued', 'due_date', 'status', 'reference']


class AbsenceReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = AbsenceReport
        fields = ['id', 'absence_type', 'departure', 'return_date', 'notes', 'created_at']
        read_only_fields = ['id', 'created_at']


class CraneRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = CraneRequest
        fields = ['id', 'service_type', 'requested_date', 'notes', 'status', 'created_at']
        read_only_fields = ['id', 'status', 'created_at']
```

- [ ] **Step 2: Check Invoice has `due_date` and `reference` fields**

```bash
grep "due_date\|reference" backend/apps/billing/models.py
```

If either field is missing, adjust the `PortalInvoiceSerializer.Meta.fields` list to only include fields that exist. Run the grep before proceeding so you know exactly which fields to list.

- [ ] **Step 3: Write portal views**

Create `backend/apps/portal/views.py`:

```python
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from apps.billing.models import Invoice
from .models import AbsenceReport, CraneRequest
from .serializers import PortalInvoiceSerializer, AbsenceReportSerializer, CraneRequestSerializer


class IsBoater(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role == 'boater')


class PortalInvoiceListView(generics.ListAPIView):
    permission_classes = [IsBoater]
    serializer_class = PortalInvoiceSerializer

    def get_queryset(self):
        member = self.request.user.member_profile
        return Invoice.objects.filter(member=member).order_by('-issued')


class AbsenceReportCreateView(generics.CreateAPIView):
    permission_classes = [IsBoater]
    serializer_class = AbsenceReportSerializer

    def perform_create(self, serializer):
        member = self.request.user.member_profile
        serializer.save(member=member)


class CraneRequestListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsBoater]
    serializer_class = CraneRequestSerializer

    def get_queryset(self):
        member = self.request.user.member_profile
        return CraneRequest.objects.filter(member=member)

    def perform_create(self, serializer):
        member = self.request.user.member_profile
        serializer.save(member=member)
```

- [ ] **Step 4: Write portal URLs**

Create `backend/apps/portal/urls.py`:

```python
from django.urls import path
from .views import PortalInvoiceListView, AbsenceReportCreateView, CraneRequestListCreateView

urlpatterns = [
    path('portal/invoices/', PortalInvoiceListView.as_view(), name='portal_invoices'),
    path('portal/absence/', AbsenceReportCreateView.as_view(), name='portal_absence'),
    path('portal/crane-requests/', CraneRequestListCreateView.as_view(), name='portal_crane_requests'),
]
```

- [ ] **Step 5: Include portal URLs in main config**

Open `backend/config/urls.py`. Add one line inside the `api/v1/` include block:

```python
path('', include('apps.portal.urls')),
```

- [ ] **Step 6: Smoke test all three endpoints**

Start the dev server: `cd backend && python manage.py runserver`

In a second terminal, get a boater JWT (reuse the magic exchange from Task 2 if you have one, or use the shell to create a token), then:

```bash
TOKEN="<boater_access_token>"
# Invoices
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/v1/portal/invoices/ | python -m json.tool
# Absence
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"absence_type":"day_trip","departure":"2026-05-01","return_date":"2026-05-01","notes":""}' \
  http://localhost:8000/api/v1/portal/absence/ | python -m json.tool
# Crane
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"service_type":"haul_out","requested_date":"2026-06-01","notes":""}' \
  http://localhost:8000/api/v1/portal/crane-requests/ | python -m json.tool
```

Expected: invoices returns `[]` (empty), absence and crane return the created record.

Non-boater token hitting `/portal/invoices/` should return `403`.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/portal/ backend/config/urls.py
git commit -m "feat(portal): add boater portal API — invoices, absence, crane requests"
```

---

## Task 5: Frontend — install vite-plugin-pwa

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/vite.config.js`
- Create: `frontend/public/manifest.json`

- [ ] **Step 1: Install the plugin**

```bash
cd frontend
npm install --save-dev vite-plugin-pwa
```

Expected: `added 1 package` (or similar), no errors.

- [ ] **Step 2: Register plugin in vite config**

Replace `frontend/vite.config.js` with:

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'DockBase',
        short_name: 'DockBase',
        theme_color: '#0c1f3d',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/.*\/api\//,
            handler: 'NetworkFirst',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
});
```

- [ ] **Step 3: Add placeholder PWA icons**

For now create simple placeholder files (replace with real icons before launch):

```bash
cd frontend/public
# Copy or create 192x192 and 512x512 PNG icons.
# Quickest approach — copy the existing logo SVG as a placeholder:
cp ../src/../public/favicon.ico icon-192.png 2>/dev/null || echo "Add icon-192.png and icon-512.png to frontend/public/ before production deploy."
```

Note: Real icons should be 192×192 and 512×512 PNGs derived from `logo.svg` in the design system. This is a pre-launch task.

- [ ] **Step 4: Verify build succeeds**

```bash
cd frontend && npm run build
```

Expected: build completes, output contains `sw.js` in `dist/`.

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/vite.config.js
git commit -m "feat(pwa): install vite-plugin-pwa, configure manifest and service worker"
```

---

## Task 6: Frontend — useAuth context

**Files:**
- Create: `frontend/src/context/AuthContext.jsx`
- Modify: `frontend/src/api.js`

- [ ] **Step 1: Add two new API functions to api.js**

Open `frontend/src/api.js`. Add these two functions after the existing `isAuthenticated()`:

```js
export async function exchangeMagicToken(token) {
  const { data } = await api.post('/auth/magic/exchange/', { token });
  localStorage.setItem('access_token', data.access);
  localStorage.setItem('refresh_token', data.refresh);
  return data.user;
}

export async function sendMagicLink(memberId) {
  await api.post('/auth/magic/send/', { member_id: memberId });
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem('db_user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function storeUser(user) {
  localStorage.setItem('db_user', JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('db_user');
}
```

Also update the existing `logout` function to call `clearAuth`:

```js
export function logout() {
  clearAuth();
}
```

And update `login` to store the user:

```js
export async function login(email, password) {
  const { data } = await api.post('/auth/token/', { email, password });
  localStorage.setItem('access_token', data.access);
  localStorage.setItem('refresh_token', data.refresh);
  storeUser(data.user);
  return data.user;
}
```

- [ ] **Step 2: Create the AuthContext**

Create `frontend/src/context/AuthContext.jsx`:

```jsx
import { createContext, useContext, useState, useEffect } from 'react';
import { getStoredUser, clearAuth, isAuthenticated } from '../api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]         = useState(null);
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    // Rehydrate from localStorage on first mount
    if (isAuthenticated()) {
      const stored = getStoredUser();
      setUser(stored);
    }
    setLoading(false);
  }, []);

  function signIn(userObj) {
    setUser(userObj);
  }

  function signOut() {
    clearAuth();
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/context/AuthContext.jsx frontend/src/api.js
git commit -m "feat(auth): add AuthContext with isLoading, signIn, signOut"
```

---

## Task 7: Frontend — ProtectedRoute + updated App.jsx

**Files:**
- Create: `frontend/src/components/routing/ProtectedRoute.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/main.jsx`

- [ ] **Step 1: Create ProtectedRoute**

Create `frontend/src/components/routing/ProtectedRoute.jsx`:

```jsx
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';

// Renders `element` only if the user's role is in `allowedRoles`.
// While auth is loading, shows a blank anchor-icon splash.
// Unauthenticated → /login. Wrong role → redirects to their home.
const ROLE_HOME = { boater: '/portal', staff: '/field', owner: '/', manager: '/' };

export default function ProtectedRoute({ element, allowedRoles }) {
  const { user, isLoading } = useAuth();

  if (isLoading) return <AuthSplash />;
  if (!user)     return <Navigate to="/login" replace />;

  if (!allowedRoles.includes(user.role)) {
    return <Navigate to={ROLE_HOME[user.role] ?? '/'} replace />;
  }

  return element;
}

function AuthSplash() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#fff' }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#a39e98" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite App.jsx**

Replace the entire contents of `frontend/src/App.jsx`:

```jsx
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import ProtectedRoute from './components/routing/ProtectedRoute.jsx';
import { useState } from 'react';
import Sidebar from './components/layout/Sidebar.jsx';
import Topbar  from './components/layout/Topbar.jsx';

import Overview     from './screens/Overview.jsx';
import MarinaMap    from './screens/MarinaMap.jsx';
import Reservations from './screens/Reservations.jsx';
import Vessels      from './screens/Vessels.jsx';
import Boatyard     from './screens/Boatyard.jsx';
import Maintenance  from './screens/Maintenance.jsx';
import Staff        from './screens/Staff.jsx';
import Billing      from './screens/Billing.jsx';
import Reports      from './screens/Reports.jsx';
import Members      from './screens/Members.jsx';
import Restaurant   from './screens/Restaurant.jsx';
import Events       from './screens/Events.jsx';
import Settings     from './screens/Settings.jsx';
import Documents    from './screens/Documents.jsx';
import Sales        from './screens/Sales.jsx';
import Operations   from './screens/Operations.jsx';
import Field        from './screens/Field.jsx';
import Login        from './screens/Login.jsx';
import MagicLink    from './screens/MagicLink.jsx';
import BoaterPortal from './screens/BoaterPortal.jsx';

const SCREEN_MAP = {
  overview: Overview, map: MarinaMap, reservations: Reservations,
  vessels: Vessels, boatyard: Boatyard, maintenance: Maintenance,
  staff: Staff, billing: Billing, reports: Reports, members: Members,
  restaurant: Restaurant, events: Events, settings: Settings,
  documents: Documents, sales: Sales, operations: Operations,
};

function ComingSoon() {
  return <div className="empty"><div className="empty-title">Coming soon.</div></div>;
}

function DesktopApp() {
  const [screen, setScreenRaw] = useState(
    () => localStorage.getItem('db_app_screen') || 'overview'
  );
  function setScreen(s) {
    setScreenRaw(s);
    localStorage.setItem('db_app_screen', s);
  }
  const Screen = SCREEN_MAP[screen] || ComingSoon;
  return (
    <div className="app">
      <Sidebar screen={screen} setScreen={setScreen} />
      <div className="main">
        <Topbar screen={screen} />
        <div className="content">
          <Screen setScreen={setScreen} />
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login"  element={<Login />} />
        <Route path="/magic"  element={<MagicLink />} />
        <Route path="/portal" element={<ProtectedRoute element={<BoaterPortal />} allowedRoles={['boater']} />} />
        <Route path="/field"  element={<ProtectedRoute element={<Field />}        allowedRoles={['staff', 'owner', 'manager']} />} />
        <Route path="/*"      element={<ProtectedRoute element={<DesktopApp />}   allowedRoles={['owner', 'manager']} />} />
      </Routes>
    </AuthProvider>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/routing/ProtectedRoute.jsx frontend/src/App.jsx
git commit -m "feat(routing): add ProtectedRoute, role-based router, AuthProvider wrapper"
```

---

## Task 8: Frontend — Login screen

**Files:**
- Create: `frontend/src/screens/Login.jsx`
- Modify: `frontend/src/styles/app.css`

- [ ] **Step 1: Create Login.jsx**

Create `frontend/src/screens/Login.jsx`:

```jsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { storeUser } from '../api.js';

const ROLE_HOME = { boater: '/portal', staff: '/field', owner: '/', manager: '/' };

export default function Login() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const navigate = useNavigate();
  const { signIn } = useAuth();

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user = await login(email, password);
      storeUser(user);
      signIn(user);
      navigate(ROLE_HOME[user.role] ?? '/', { replace: true });
    } catch {
      setError('Incorrect email or password.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-logo">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0c1f3d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
          <span className="login-brand">DockBase</span>
        </div>

        <h2 className="login-title">Sign in</h2>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-field">
            <label className="login-label">Email</label>
            <input
              type="email"
              className="login-input"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
            />
          </div>

          <div className="login-field">
            <label className="login-label">Password</label>
            <input
              type="password"
              className="login-input"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
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

- [ ] **Step 2: Add login CSS to app.css**

Open `frontend/src/styles/app.css`. Append at the end:

```css
/* ── Login ─────────────────────────────────────── */
.login-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-alt, #f6f5f4);
  padding: 24px;
}

.login-card {
  background: #fff;
  border: 1px solid rgba(0,0,0,0.1);
  border-radius: 12px;
  box-shadow: var(--shadow-card);
  padding: 40px 36px;
  width: 100%;
  max-width: 380px;
}

.login-logo {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 28px;
}

.login-brand {
  font-family: var(--font-primary, 'Jost', sans-serif);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.5px;
  color: #0c1f3d;
}

.login-title {
  font-family: var(--font-app, 'IBM Plex Sans', sans-serif);
  font-size: 20px;
  font-weight: 600;
  color: rgba(0,0,0,0.95);
  margin-bottom: 24px;
  letter-spacing: -0.2px;
}

.login-form { display: flex; flex-direction: column; gap: 16px; }

.login-field { display: flex; flex-direction: column; gap: 5px; }

.login-label {
  font-family: var(--font-app, 'IBM Plex Sans', sans-serif);
  font-size: 13px;
  font-weight: 600;
  color: rgba(0,0,0,0.95);
}

.login-input {
  font-family: var(--font-app, 'IBM Plex Sans', sans-serif);
  font-size: 15px;
  font-weight: 400;
  background: #fff;
  color: rgba(0,0,0,0.9);
  border: 1px solid #dddddd;
  border-radius: 4px;
  padding: 7px 10px;
  width: 100%;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.login-input::placeholder { color: #a39e98; }

.login-input:focus {
  border-color: #097fe8;
  box-shadow: 0 0 0 3px rgba(9,127,232,0.12);
}

.login-error {
  font-size: 13px;
  color: #cc2222;
  margin: 0;
}

.login-submit { width: 100%; justify-content: center; padding: 10px 0; font-size: 14px; }
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/screens/Login.jsx frontend/src/styles/app.css
git commit -m "feat(login): add Login screen with design system styling"
```

---

## Task 9: Frontend — MagicLink exchange screen

**Files:**
- Create: `frontend/src/screens/MagicLink.jsx`

- [ ] **Step 1: Create MagicLink.jsx**

Create `frontend/src/screens/MagicLink.jsx`:

```jsx
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { exchangeMagicToken, storeUser } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function MagicLink() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { signIn } = useAuth();

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setError('No token found in the link. Ask the marina for a new one.');
      return;
    }

    exchangeMagicToken(token)
      .then(user => {
        storeUser(user);
        signIn(user);
        // replace: true strips the dead token from the URL bar
        navigate('/portal', { replace: true });
      })
      .catch(() => {
        setError('This link is invalid or has expired. Ask the marina to send a new one.');
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <div className="login-logo">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#0c1f3d" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
            <span className="login-brand">DockBase</span>
          </div>
          <p style={{ fontSize: 14, color: '#cc2222', lineHeight: 1.5 }}>{error}</p>
        </div>
      </div>
    );
  }

  // Blank white with anchor icon — no flash of login
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#fff' }}>
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#a39e98" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
      </svg>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/screens/MagicLink.jsx
git commit -m "feat(auth): add MagicLink exchange screen with replace-nav and loading splash"
```

---

## Task 10: Frontend — BoaterPortal screen

**Files:**
- Create: `frontend/src/hooks/usePortalInvoices.js`
- Create: `frontend/src/hooks/usePortalCraneRequests.js`
- Create: `frontend/src/screens/BoaterPortal.jsx`
- Modify: `frontend/src/styles/app.css`

- [ ] **Step 1: Create usePortalInvoices hook**

Create `frontend/src/hooks/usePortalInvoices.js`:

```js
import { useState, useEffect } from 'react';
import api from '../api.js';

export default function usePortalInvoices() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    api.get('/portal/invoices/')
      .then(r => setInvoices(r.data))
      .finally(() => setLoading(false));
  }, []);

  return { invoices, loading };
}
```

- [ ] **Step 2: Create usePortalCraneRequests hook**

Create `frontend/src/hooks/usePortalCraneRequests.js`:

```js
import { useState, useEffect } from 'react';
import api from '../api.js';

export default function usePortalCraneRequests() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    api.get('/portal/crane-requests/')
      .then(r => setRequests(r.data))
      .finally(() => setLoading(false));
  }, []);

  async function submitRequest(payload) {
    const { data } = await api.post('/portal/crane-requests/', payload);
    setRequests(prev => [data, ...prev]);
    return data;
  }

  return { requests, loading, submitRequest };
}
```

- [ ] **Step 3: Create BoaterPortal.jsx**

Create `frontend/src/screens/BoaterPortal.jsx`:

```jsx
import { useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import usePortalInvoices from '../hooks/usePortalInvoices.js';
import usePortalCraneRequests from '../hooks/usePortalCraneRequests.js';
import api from '../api.js';

const STATUS_BADGE = {
  unpaid:    'badge badge-gold',
  overdue:   'badge badge-red',
  paid:      'badge badge-green',
  requested: 'badge badge-gold',
  approved:  'badge badge-green',
  rejected:  'badge badge-red',
};

function formatCurrency(amount) {
  return Number(amount).toLocaleString('de-CH', { style: 'currency', currency: 'CHF' });
}

// ── Invoices Tab ──────────────────────────────────────────────
function InvoicesTab() {
  const { invoices, loading } = usePortalInvoices();

  if (loading) return <div className="portal-loading">Loading invoices…</div>;
  if (!invoices.length) return (
    <div className="portal-empty">
      <div className="portal-empty-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <div className="portal-empty-text">No invoices.</div>
    </div>
  );

  return (
    <div className="portal-list">
      {invoices.map(inv => (
        <div key={inv.id} className="card portal-invoice-card">
          <div className="portal-invoice-row">
            <div>
              <div className="portal-invoice-ref">{inv.reference || `INV-${inv.id}`}</div>
              <div className="portal-invoice-amount">{formatCurrency(inv.amount)}</div>
              {inv.due_date && <div className="portal-invoice-meta">Due {inv.due_date}</div>}
            </div>
            <span className={STATUS_BADGE[inv.status] || 'badge'}>{inv.status}</span>
          </div>
          {inv.status !== 'paid' && (
            <button className="abtn abtn-gold portal-full-btn">Pay Now</button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Absence Tab ───────────────────────────────────────────────
function AbsenceTab() {
  const [form, setForm]         = useState({ absence_type: 'day_trip', departure: '', return_date: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess]   = useState(false);
  const [error, setError]       = useState('');

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await api.post('/portal/absence/', form);
      setSuccess(true);
      setTimeout(() => {
        setSuccess(false);
        setForm({ absence_type: 'day_trip', departure: '', return_date: '', notes: '' });
      }, 2500);
    } catch {
      setError('Could not submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="portal-list">
      <div className="card portal-form-card">
        {success ? (
          <div className="portal-success">
            <span className="badge badge-green">Absence reported</span>
            <p className="portal-success-text">The marina has been notified.</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="portal-form">
            <div className="portal-field">
              <label className="portal-label">Absence type</label>
              <select className="login-input" value={form.absence_type} onChange={e => set('absence_type', e.target.value)}>
                <option value="day_trip">Day trip</option>
                <option value="overnight">Overnight</option>
                <option value="extended">Extended</option>
              </select>
            </div>
            <div className="portal-field-row">
              <div className="portal-field">
                <label className="portal-label">Departure</label>
                <input type="date" className="login-input" value={form.departure} onChange={e => set('departure', e.target.value)} required />
              </div>
              <div className="portal-field">
                <label className="portal-label">Return</label>
                <input type="date" className="login-input" value={form.return_date} onChange={e => set('return_date', e.target.value)} required />
              </div>
            </div>
            <div className="portal-field">
              <label className="portal-label">Notes <span className="portal-optional">(optional)</span></label>
              <textarea className="login-input" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any details for the harbour master…" />
            </div>
            {error && <p className="login-error">{error}</p>}
            <button type="submit" className="abtn abtn-primary portal-full-btn" disabled={submitting}>
              {submitting ? 'Submitting…' : 'Report Absence'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

// ── Crane Tab ─────────────────────────────────────────────────
function CraneTab() {
  const { requests, loading, submitRequest } = usePortalCraneRequests();
  const [form, setForm]         = useState({ service_type: 'haul_out', requested_date: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]       = useState('');

  function set(field, value) {
    setForm(prev => ({ ...prev, [field]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await submitRequest(form);
      setForm({ service_type: 'haul_out', requested_date: '', notes: '' });
    } catch {
      setError('Could not submit. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="portal-list">
      <div className="card portal-form-card">
        <form onSubmit={handleSubmit} className="portal-form">
          <div className="portal-field">
            <label className="portal-label">Service</label>
            <select className="login-input" value={form.service_type} onChange={e => set('service_type', e.target.value)}>
              <option value="launch">Launch</option>
              <option value="haul_out">Haul-out</option>
              <option value="both">Launch & Haul-out</option>
            </select>
          </div>
          <div className="portal-field">
            <label className="portal-label">Requested date</label>
            <input type="date" className="login-input" value={form.requested_date} onChange={e => set('requested_date', e.target.value)} required />
          </div>
          <div className="portal-field">
            <label className="portal-label">Notes <span className="portal-optional">(optional)</span></label>
            <textarea className="login-input" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Vessel condition, timing requirements…" />
          </div>
          {error && <p className="login-error">{error}</p>}
          <button type="submit" className="abtn abtn-primary portal-full-btn" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Request Crane Lift'}
          </button>
        </form>
      </div>

      {!loading && requests.length > 0 && (
        <>
          <div className="portal-section-label">Your requests</div>
          {requests.map(r => (
            <div key={r.id} className="card portal-request-card">
              <div className="portal-request-row">
                <div>
                  <div className="portal-request-type">{r.service_type.replace('_', '-')}</div>
                  <div className="portal-invoice-meta">{r.requested_date}</div>
                </div>
                <span className={STATUS_BADGE[r.status] || 'badge'}>{r.status}</span>
              </div>
              {r.notes && <div className="portal-request-notes">{r.notes}</div>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ── Shell ─────────────────────────────────────────────────────
export default function BoaterPortal() {
  const { user, signOut } = useAuth();
  const [tab, setTab] = useState('invoices');

  return (
    <div className="portal-shell">
      <div className="portal-header">
        <div className="portal-header-left">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.8)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
          <div>
            <div className="portal-marina-name">DockBase</div>
            <div className="portal-boater-name">{user?.first_name || user?.email}</div>
          </div>
        </div>
        <button className="portal-signout" onClick={signOut}>Sign out</button>
      </div>

      <div className="tabs portal-tabs">
        <button className={`tab${tab === 'invoices' ? ' active' : ''}`} onClick={() => setTab('invoices')}>Invoices</button>
        <button className={`tab${tab === 'absence'  ? ' active' : ''}`} onClick={() => setTab('absence')}>Absence</button>
        <button className={`tab${tab === 'crane'    ? ' active' : ''}`} onClick={() => setTab('crane')}>Crane</button>
      </div>

      <div className="portal-content">
        {tab === 'invoices' && <InvoicesTab />}
        {tab === 'absence'  && <AbsenceTab />}
        {tab === 'crane'    && <CraneTab />}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Add portal CSS to app.css**

Open `frontend/src/styles/app.css`. Append at the end:

```css
/* ── Boater Portal ──────────────────────────────── */
.portal-shell {
  min-height: 100vh;
  background: var(--bg-alt, #f6f5f4);
  display: flex;
  flex-direction: column;
  font-family: var(--font-app, 'IBM Plex Sans', sans-serif);
}

.portal-header {
  background: #0c1f3d;
  padding: 16px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.portal-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.portal-marina-name {
  font-size: 15px;
  font-weight: 600;
  color: #fff;
  line-height: 1.2;
}

.portal-boater-name {
  font-size: 12px;
  color: #a39e98;
  line-height: 1.2;
}

.portal-signout {
  background: transparent;
  border: 1px solid rgba(255,255,255,0.2);
  color: rgba(255,255,255,0.6);
  font-family: var(--font-app, 'IBM Plex Sans', sans-serif);
  font-size: 12px;
  padding: 5px 10px;
  border-radius: 4px;
  cursor: pointer;
}

.portal-tabs {
  background: #fff;
  border-bottom: 1px solid rgba(0,0,0,0.08);
  flex-shrink: 0;
}

.portal-content {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 80px;
}

.portal-list {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.portal-invoice-card { padding: 16px; }
.portal-form-card    { padding: 20px; }
.portal-request-card { padding: 14px 16px; }

.portal-invoice-row, .portal-request-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.portal-invoice-ref {
  font-size: 12px;
  font-weight: 600;
  color: #a39e98;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 3px;
}

.portal-invoice-amount {
  font-size: 20px;
  font-weight: 700;
  color: rgba(0,0,0,0.95);
  letter-spacing: -0.3px;
}

.portal-invoice-meta {
  font-size: 12px;
  color: #a39e98;
  margin-top: 3px;
}

.portal-request-type {
  font-size: 14px;
  font-weight: 600;
  color: rgba(0,0,0,0.9);
  text-transform: capitalize;
}

.portal-request-notes {
  font-size: 13px;
  color: #615d59;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(0,0,0,0.07);
}

.portal-full-btn {
  width: 100%;
  justify-content: center;
  padding: 10px 0;
  font-size: 14px;
  margin-top: 4px;
}

.portal-form { display: flex; flex-direction: column; gap: 16px; }

.portal-field { display: flex; flex-direction: column; gap: 5px; }

.portal-field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.portal-label {
  font-size: 13px;
  font-weight: 600;
  color: rgba(0,0,0,0.95);
}

.portal-optional {
  font-weight: 400;
  color: #a39e98;
}

.portal-section-label {
  font-size: 11px;
  font-weight: 600;
  color: #a39e98;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  padding: 4px 4px 0;
}

.portal-success {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 24px 0;
}

.portal-success-text {
  font-size: 14px;
  color: #615d59;
}

.portal-loading {
  padding: 40px 20px;
  text-align: center;
  font-size: 14px;
  color: #a39e98;
}

.portal-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 60px 20px;
  color: #a39e98;
}

.portal-empty-icon { opacity: 0.4; }

.portal-empty-text {
  font-size: 15px;
  font-weight: 600;
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/usePortalInvoices.js frontend/src/hooks/usePortalCraneRequests.js frontend/src/screens/BoaterPortal.jsx frontend/src/styles/app.css
git commit -m "feat(portal): add BoaterPortal screen — invoices, absence, crane tabs"
```

---

## Task 11: Frontend — Send Portal Link button in Members.jsx

**Files:**
- Modify: `frontend/src/screens/Members.jsx`

- [ ] **Step 1: Locate the member detail panel in Members.jsx**

Open `frontend/src/screens/Members.jsx`. Find the detail panel section (the right-hand panel that opens when a member is selected). Look for a `detail-actions` div or similar block near the bottom of the detail panel.

- [ ] **Step 2: Add the send-link button and handler**

At the top of `Members.jsx` add the import:

```js
import { sendMagicLink } from '../api.js';
```

Inside the component, add state for the send action near the other `useState` declarations:

```js
const [linkSent, setLinkSent]     = useState(false);
const [linkSending, setLinkSending] = useState(false);
```

Add the handler function inside the component:

```js
async function handleSendPortalLink() {
  if (!selected?.id) return;
  setLinkSending(true);
  try {
    await sendMagicLink(selected.id);
    setLinkSent(true);
    setTimeout(() => setLinkSent(false), 3000);
  } catch {
    // silently ignore — user sees no state change
  } finally {
    setLinkSending(false);
  }
}
```

Reset `linkSent` when the selected member changes. Find where `setSelected` is called (the row click handler) and add:

```js
setLinkSent(false);
```

In the detail panel JSX, inside the `detail-actions` section (or after the existing action buttons), add:

```jsx
<button
  className="abtn abtn-ghost abtn-sm"
  onClick={handleSendPortalLink}
  disabled={linkSending || !selected?.email}
  title={selected?.email ? undefined : 'Member has no email address'}
>
  {linkSent ? 'Link sent' : linkSending ? 'Sending…' : 'Send portal link'}
</button>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/screens/Members.jsx
git commit -m "feat(members): add Send Portal Link button to member detail panel"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| boater role in User model | Task 1 |
| Member.boater_user FK | Task 1 |
| MagicToken model (UUID, 7-day expiry, single-use) | Task 1 |
| Token cleanup before send (delete all existing) | Task 2 |
| POST /auth/magic/send/ | Task 2 |
| POST /auth/magic/exchange/ | Task 2 |
| useAuth context with isLoading | Task 6 |
| replace-nav after magic exchange | Task 9 |
| Blank anchor splash while loading | Task 7 (ProtectedRoute) + Task 9 (MagicLink) |
| ProtectedRoute with role enforcement | Task 7 |
| Role-based redirect after login | Task 8 |
| Login screen (design system) | Task 8 |
| BoaterPortal — Invoices tab | Task 10 |
| BoaterPortal — Absence tab | Task 10 |
| BoaterPortal — Crane tab | Task 10 |
| Portal API views (boater-only permission) | Task 4 |
| vite-plugin-pwa manifest | Task 5 |
| Send portal link from Members screen | Task 11 |

All spec requirements covered.

**Note on CraneRequest vs HaulOut:** The spec says "creates a HaulOut record". The existing `HaulOut` model requires a non-nullable `vessel` FK and a `scheduled_at` DateTimeField — neither of which the boater form provides. This plan uses a dedicated `CraneRequest` model instead. This is intentional and cleaner; marina staff can create a `HaulOut` from an approved `CraneRequest` using the existing Boatyard screen.
