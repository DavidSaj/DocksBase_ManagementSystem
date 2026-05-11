# Boater Portal Redesign — Plan 1: Auth & Shell

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the member auth backend (magic link request/verify/refresh) and the frontend shell (UserContext, AppShell, BottomNav, LoginScreen, updated App.jsx routing) so subsequent plans can build tabs into a working app.

**Architecture:** New `PortalMemberAuthentication` auth class mirrors the existing `PortalTokenAuthentication` (guest) pattern. Member session tokens use salt `portal-member-v1`; refresh tokens use `portal-refresh-v1` (90-day rolling). The frontend `UserContext` parses the stored token to derive capabilities. `AppShell` wraps all authenticated content with the 5-tab bottom nav. Guest users (booking token) see no bottom nav — the existing checkin flow renders fullscreen inside `HomeTab`.

**Tech Stack:** Django (`django.core.signing`), Django REST Framework, React 18, CSS custom properties (no Tailwind), Vite/Vitest

---

## File Map

### Backend — new files
```
backend/apps/portal/member_auth_utils.py     ← token create/decode for member + refresh
backend/apps/portal/member_auth.py           ← PortalMemberUser + PortalMemberAuthentication
backend/apps/portal/member_auth_views.py     ← MemberMagicRequestView, VerifyView, RefreshView
backend/apps/portal/member_auth_urls.py      ← URL patterns for the three views
backend/apps/portal/tests/test_member_auth.py
```

### Backend — modified files
```
backend/apps/portal/urls.py                  ← include member_auth_urls
backend/config/urls.py                       ← (if member auth URLs not yet included via portal urls)
```

### Frontend — new files
```
portal/src/context/UserContext.jsx           ← capabilities hook, parses stored token
portal/src/components/shell/AppShell.jsx     ← content wrapper + bottom nav (members)
portal/src/components/shell/BottomNav.jsx    ← 5-tab nav bar with SVG icons
portal/src/screens/LoginScreen.jsx           ← email input + "Check your email" state
portal/src/screens/tabs/HomeTab.jsx          ← stub (guest: existing checkin; member: coming soon)
portal/src/screens/tabs/ServicesTab.jsx      ← stub
portal/src/screens/tabs/BookTab.jsx          ← stub
portal/src/screens/tabs/WalletTab.jsx        ← stub
portal/src/screens/tabs/AccountTab.jsx       ← stub
```

### Frontend — modified files
```
portal/src/App.jsx                           ← replace current routing with shell/login logic
portal/src/api.js                            ← add refresh token interceptor
portal/src/styles/portal.css                 ← add shell, nav, login, typography classes
portal/src/main.jsx                          ← wrap with UserContextProvider
```

---

## Task 1: Member auth utilities

**Files:**
- Create: `backend/apps/portal/member_auth_utils.py`
- Test: `backend/apps/portal/tests/test_member_auth.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/apps/portal/tests/test_member_auth.py
import pytest
from django.core import signing
from apps.portal.member_auth_utils import (
    make_member_magic_token, decode_member_magic_token,
    make_member_session_token, decode_member_session_token,
    make_refresh_token, decode_refresh_token,
)


def test_member_magic_token_roundtrip():
    token = make_member_magic_token(member_id=42, email='alice@test.com')
    payload = decode_member_magic_token(token)
    assert payload['member_id'] == 42
    assert payload['email'] == 'alice@test.com'


def test_member_session_token_roundtrip():
    token = make_member_session_token(member_id=42, marina_slug='portx', email='alice@test.com')
    payload = decode_member_session_token(token)
    assert payload['member_id'] == 42
    assert payload['marina_slug'] == 'portx'
    assert payload['email'] == 'alice@test.com'


def test_refresh_token_roundtrip():
    token = make_refresh_token(member_id=42, marina_slug='portx', email='alice@test.com')
    payload = decode_refresh_token(token)
    assert payload['member_id'] == 42


def test_bad_magic_token_raises():
    with pytest.raises(signing.BadSignature):
        decode_member_magic_token('not-a-valid-token')


def test_bad_session_token_raises():
    with pytest.raises(signing.BadSignature):
        decode_member_session_token('not-a-valid-token')
```

- [ ] **Step 2: Run to verify it fails**

```
cd backend
pytest apps/portal/tests/test_member_auth.py -v
```
Expected: ImportError (module doesn't exist yet).

- [ ] **Step 3: Create the utilities module**

```python
# backend/apps/portal/member_auth_utils.py
from django.core import signing

MEMBER_MAGIC_SALT   = 'portal-member-magic-v1'
MEMBER_SESSION_SALT = 'portal-member-v1'
MEMBER_REFRESH_SALT = 'portal-refresh-v1'

MEMBER_MAGIC_MAX_AGE   = 60 * 60 * 24        # 24 hours to click the link
MEMBER_SESSION_MAX_AGE = 60 * 60             # 1 hour session token
MEMBER_REFRESH_MAX_AGE = 60 * 60 * 24 * 90  # 90 days rolling refresh


def make_member_magic_token(member_id, email):
    return signing.dumps(
        {'member_id': member_id, 'email': email},
        salt=MEMBER_MAGIC_SALT,
    )


def decode_member_magic_token(token):
    return signing.loads(token, salt=MEMBER_MAGIC_SALT, max_age=MEMBER_MAGIC_MAX_AGE)


def make_member_session_token(member_id, marina_slug, email):
    return signing.dumps(
        {'member_id': member_id, 'marina_slug': marina_slug, 'email': email, 'type': 'member'},
        salt=MEMBER_SESSION_SALT,
    )


def decode_member_session_token(token):
    return signing.loads(token, salt=MEMBER_SESSION_SALT, max_age=MEMBER_SESSION_MAX_AGE)


def make_refresh_token(member_id, marina_slug, email):
    return signing.dumps(
        {'member_id': member_id, 'marina_slug': marina_slug, 'email': email},
        salt=MEMBER_REFRESH_SALT,
    )


def decode_refresh_token(token):
    return signing.loads(token, salt=MEMBER_REFRESH_SALT, max_age=MEMBER_REFRESH_MAX_AGE)
```

- [ ] **Step 4: Run tests to verify they pass**

```
pytest apps/portal/tests/test_member_auth.py -v
```
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/portal/member_auth_utils.py backend/apps/portal/tests/test_member_auth.py
git commit -m "feat(portal): member auth token utilities"
```

---

## Task 2: PortalMemberAuthentication class

**Files:**
- Create: `backend/apps/portal/member_auth.py`
- Test: `backend/apps/portal/tests/test_member_auth.py` (extend)

- [ ] **Step 1: Add auth class tests**

Append to `backend/apps/portal/tests/test_member_auth.py`:

```python
from django.test import RequestFactory
from apps.portal.member_auth import PortalMemberAuthentication, PortalMemberUser
from apps.portal.member_auth_utils import make_member_session_token
from rest_framework.exceptions import AuthenticationFailed


def test_auth_class_returns_none_without_header():
    factory = RequestFactory()
    request = factory.get('/')
    auth = PortalMemberAuthentication()
    result = auth.authenticate(request)
    assert result is None


def test_auth_class_returns_user_with_valid_token():
    token = make_member_session_token(member_id=7, marina_slug='portx', email='bob@test.com')
    factory = RequestFactory()
    request = factory.get('/', HTTP_AUTHORIZATION=f'MemberBearer {token}')
    auth = PortalMemberAuthentication()
    user, _ = auth.authenticate(request)
    assert isinstance(user, PortalMemberUser)
    assert user.member_id == 7
    assert user.marina_slug == 'portx'


def test_auth_class_raises_on_bad_token():
    factory = RequestFactory()
    request = factory.get('/', HTTP_AUTHORIZATION='MemberBearer invalid-token')
    auth = PortalMemberAuthentication()
    with pytest.raises(AuthenticationFailed):
        auth.authenticate(request)
```

- [ ] **Step 2: Run to verify they fail**

```
pytest apps/portal/tests/test_member_auth.py -v
```
Expected: 3 new failures (ImportError).

- [ ] **Step 3: Create the auth class**

```python
# backend/apps/portal/member_auth.py
from django.core import signing
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from .member_auth_utils import decode_member_session_token


class PortalMemberUser:
    is_authenticated = True
    is_anonymous = False

    def __init__(self, member_id, marina_slug, email):
        self.member_id = member_id
        self.marina_slug = marina_slug
        self.email = email
        self.pk = member_id  # required by DRF throttling


class PortalMemberAuthentication(BaseAuthentication):
    """Authenticates member portal tokens (salt: portal-member-v1).

    Uses 'MemberBearer <token>' scheme to avoid collision with guest
    'Bearer <token>' tokens on the same api.js instance.
    """

    def authenticate(self, request):
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        if not auth_header.startswith('MemberBearer '):
            return None
        token = auth_header[13:]
        try:
            payload = decode_member_session_token(token)
        except signing.BadSignature:
            raise AuthenticationFailed('Invalid or expired member token.')
        return (
            PortalMemberUser(
                member_id=payload['member_id'],
                marina_slug=payload['marina_slug'],
                email=payload['email'],
            ),
            None,
        )

    def authenticate_header(self, request):
        return 'MemberBearer realm="portal"'
```

- [ ] **Step 4: Run tests to verify they pass**

```
pytest apps/portal/tests/test_member_auth.py -v
```
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/portal/member_auth.py backend/apps/portal/tests/test_member_auth.py
git commit -m "feat(portal): PortalMemberAuthentication class"
```

---

## Task 3: Update api.js to send MemberBearer header

The frontend needs to send `MemberBearer <token>` when the stored token is a member token, and `Bearer <token>` when it's a guest token. Member tokens include `"type":"member"` in their payload (base64 middle segment — we detect this by looking at the token type stored in localStorage).

**Files:**
- Modify: `portal/src/api.js`

- [ ] **Step 1: Update api.js interceptor**

Replace the current request interceptor in `portal/src/api.js`:

```js
import axios from 'axios';
import { detectTenant } from './context/TenantContext';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1',
});

api.interceptors.request.use(cfg => {
  const sessionToken = localStorage.getItem('portal_session_token');
  const tokenType    = localStorage.getItem('portal_token_type'); // 'guest' | 'member'

  if (sessionToken) {
    cfg.headers['Authorization'] =
      tokenType === 'member'
        ? `MemberBearer ${sessionToken}`
        : `Bearer ${sessionToken}`;
  }

  const marinaSlug = localStorage.getItem('portal_marina_slug');
  if (marinaSlug) {
    cfg.headers['X-Marina-Slug'] = marinaSlug;
  } else {
    const tenant = detectTenant();
    if (tenant?.slug) {
      cfg.headers['X-Marina-Slug'] = tenant.slug;
    } else if (tenant?.customDomain) {
      cfg.headers['X-Marina-Domain'] = tenant.customDomain;
    }
  }

  return cfg;
});

// Token refresh interceptor — fires on 401 for member sessions only
api.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config;
    const tokenType = localStorage.getItem('portal_token_type');
    if (
      err.response?.status === 401 &&
      tokenType === 'member' &&
      !original._retried
    ) {
      original._retried = true;
      const refreshToken = localStorage.getItem('portal_refresh_token');
      if (!refreshToken) return Promise.reject(err);
      try {
        const { data } = await axios.post(
          `${import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1'}/portal/auth/member-magic/refresh/`,
          { refresh_token: refreshToken },
        );
        localStorage.setItem('portal_session_token', data.session_token);
        localStorage.setItem('portal_refresh_token', data.refresh_token);
        original.headers['Authorization'] = `MemberBearer ${data.session_token}`;
        return api(original);
      } catch {
        // Refresh failed — clear session, caller will redirect to login
        localStorage.removeItem('portal_session_token');
        localStorage.removeItem('portal_refresh_token');
        localStorage.removeItem('portal_token_type');
        return Promise.reject(err);
      }
    }
    return Promise.reject(err);
  }
);

export default api;
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/api.js
git commit -m "feat(portal): api.js MemberBearer header + 401 refresh interceptor"
```

---

## Task 4: Member auth views (Request + Verify + Refresh)

**Files:**
- Create: `backend/apps/portal/member_auth_views.py`
- Extend tests: `backend/apps/portal/tests/test_member_auth.py`

The Member model lives in `apps.members` (check the actual import path with `grep -r "class Member" backend/apps`). Substitute the correct import if different.

- [ ] **Step 1: Check the Member model location**

```bash
grep -r "class Member" backend/apps --include="*.py" -l
```
Note the file (likely `apps/members/models.py` or `apps/accounts/models.py`).

- [ ] **Step 2: Write integration tests**

Append to `backend/apps/portal/tests/test_member_auth.py`:

```python
import pytest
from django.urls import reverse
from django.test import Client
from django.core import mail


@pytest.mark.django_db
def test_member_magic_request_sends_email(member_factory):
    """Single member: magic link email dispatched."""
    member = member_factory(email='alice@test.com')
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/member-magic/request/',
        data={'email': 'alice@test.com'},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=member.marina.slug,
    )
    assert resp.status_code == 200
    assert len(mail.outbox) == 1
    assert 'alice@test.com' in mail.outbox[0].to


@pytest.mark.django_db
def test_member_magic_request_unknown_email_still_200(marina_factory):
    """Unknown email: 200 response (don't leak whether email exists)."""
    marina = marina_factory()
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/member-magic/request/',
        data={'email': 'nobody@test.com'},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=marina.slug,
    )
    assert resp.status_code == 200
    assert len(mail.outbox) == 0


@pytest.mark.django_db
def test_member_magic_verify_returns_tokens(member_factory):
    from apps.portal.member_auth_utils import make_member_magic_token
    member = member_factory(email='alice@test.com')
    token = make_member_magic_token(member_id=member.id, email='alice@test.com')
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/member-magic/verify/',
        data={'token': token},
        content_type='application/json',
    )
    assert resp.status_code == 200
    data = resp.json()
    assert 'session_token' in data
    assert 'refresh_token' in data
    assert data['marina_slug'] == member.marina.slug


@pytest.mark.django_db
def test_member_magic_refresh_returns_new_tokens(member_factory):
    from apps.portal.member_auth_utils import make_refresh_token
    member = member_factory(email='alice@test.com')
    refresh = make_refresh_token(
        member_id=member.id, marina_slug=member.marina.slug, email='alice@test.com'
    )
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/member-magic/refresh/',
        data={'refresh_token': refresh},
        content_type='application/json',
    )
    assert resp.status_code == 200
    data = resp.json()
    assert 'session_token' in data
    assert 'refresh_token' in data
```

Note: `member_factory` and `marina_factory` are pytest fixtures — add them to `backend/conftest.py` or a local `conftest.py` inside `tests/`. If the project uses `pytest-django` with `@pytest.mark.django_db`, ensure `pytest.ini` / `pyproject.toml` has `DJANGO_SETTINGS_MODULE = config.settings.dev`.

- [ ] **Step 3: Run to verify they fail**

```
pytest apps/portal/tests/test_member_auth.py -v -k "request or verify or refresh"
```
Expected: failures (views not wired).

- [ ] **Step 4: Create the views**

```python
# backend/apps/portal/member_auth_views.py
import logging

from django.conf import settings
from django.core import signing
from django.core.mail import send_mail

from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

# Adjust import to match actual Member model location
from apps.members.models import Member   # or apps.accounts.models

from .member_auth_utils import (
    decode_member_magic_token,
    decode_refresh_token,
    make_member_magic_token,
    make_member_session_token,
    make_refresh_token,
)

_log = logging.getLogger(__name__)


class MemberMagicRequestView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        marina_slug = request.META.get('HTTP_X_MARINA_SLUG', '')

        if not email or not marina_slug:
            return Response({'detail': 'email and X-Marina-Slug required.'}, status=400)

        members = list(
            Member.objects.filter(email__iexact=email, marina__slug=marina_slug)
            .select_related('marina')
        )

        if len(members) == 0:
            # Deliberate no-op — don't leak whether email exists
            return Response({'detail': 'If that email is on file, a link has been sent.'})

        if len(members) == 1:
            member = members[0]
            token = make_member_magic_token(member_id=member.id, email=member.email)
            magic_url = (
                f"{getattr(settings, 'PORTAL_BASE_URL', 'https://book.docksbase.com')}"
                f"/{member.marina.slug}?member_token={token}"
            )
            send_mail(
                subject=f'Your sign-in link — {member.marina.name}',
                message=(
                    f'Hi {member.first_name or "there"},\n\n'
                    f'Click the link below to sign in to your member portal:\n\n'
                    f'{magic_url}\n\n'
                    f'This link expires in 24 hours.\n\n'
                    f'— {member.marina.name}'
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[member.email],
                fail_silently=True,
            )
            _log.info('MemberMagicRequest: sent link to member_id=%s', member.id)
        else:
            # Multiple members share this email — send a profile-picker email
            _log.info('MemberMagicRequest: %d profiles for email=%s, sending picker', len(members), email)
            links = []
            for m in members:
                token = make_member_magic_token(member_id=m.id, email=m.email)
                url = (
                    f"{getattr(settings, 'PORTAL_BASE_URL', 'https://book.docksbase.com')}"
                    f"/{m.marina.slug}?member_token={token}"
                )
                links.append(f"  • {m.first_name or m.email}: {url}")
            send_mail(
                subject=f'Select your profile — {members[0].marina.name}',
                message=(
                    f'Multiple member profiles are associated with {email}.\n\n'
                    f'Tap your name to sign in:\n\n'
                    + '\n'.join(links) +
                    '\n\nEach link expires in 24 hours.'
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[email],
                fail_silently=True,
            )

        return Response({'detail': 'If that email is on file, a link has been sent.'})


class MemberMagicVerifyView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        token = request.data.get('token', '')
        if not token:
            return Response({'detail': 'token required.'}, status=400)

        try:
            payload = decode_member_magic_token(token)
        except signing.BadSignature:
            return Response({'detail': 'Invalid or expired link.'}, status=401)

        try:
            member = Member.objects.select_related('marina').get(
                pk=payload['member_id'],
                email=payload['email'],
            )
        except Member.DoesNotExist:
            return Response({'detail': 'Member not found.'}, status=401)

        session_token = make_member_session_token(
            member_id=member.id,
            marina_slug=member.marina.slug,
            email=member.email,
        )
        refresh_token = make_refresh_token(
            member_id=member.id,
            marina_slug=member.marina.slug,
            email=member.email,
        )
        return Response({
            'session_token': session_token,
            'refresh_token': refresh_token,
            'member_id': member.id,
            'marina_slug': member.marina.slug,
        })


class MemberMagicRefreshView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        token = request.data.get('refresh_token', '')
        if not token:
            return Response({'detail': 'refresh_token required.'}, status=400)

        try:
            payload = decode_refresh_token(token)
        except signing.BadSignature:
            return Response({'detail': 'Refresh token invalid or expired.'}, status=401)

        try:
            member = Member.objects.select_related('marina').get(
                pk=payload['member_id'],
                email=payload['email'],
            )
        except Member.DoesNotExist:
            return Response({'detail': 'Member not found.'}, status=401)

        # Issue new rolling tokens
        session_token = make_member_session_token(
            member_id=member.id,
            marina_slug=member.marina.slug,
            email=member.email,
        )
        new_refresh = make_refresh_token(
            member_id=member.id,
            marina_slug=member.marina.slug,
            email=member.email,
        )
        return Response({
            'session_token': session_token,
            'refresh_token': new_refresh,
        })
```

- [ ] **Step 5: Create URL patterns**

```python
# backend/apps/portal/member_auth_urls.py
from django.urls import path
from .member_auth_views import (
    MemberMagicRequestView,
    MemberMagicVerifyView,
    MemberMagicRefreshView,
)

urlpatterns = [
    path('portal/auth/member-magic/request/', MemberMagicRequestView.as_view(), name='member_magic_request'),
    path('portal/auth/member-magic/verify/',  MemberMagicVerifyView.as_view(),  name='member_magic_verify'),
    path('portal/auth/member-magic/refresh/', MemberMagicRefreshView.as_view(), name='member_magic_refresh'),
]
```

- [ ] **Step 6: Wire into the main URL config**

Open `backend/apps/portal/urls.py` and add at the top of `urlpatterns`:

```python
# At the top of backend/apps/portal/urls.py, add this import
from .member_auth_urls import urlpatterns as member_auth_urls

# Then extend urlpatterns:
urlpatterns = member_auth_urls + [
    # ... existing patterns ...
]
```

Or if portal URLs are included from `backend/config/urls.py` via `include('apps.portal.urls')`, just import and extend inside `apps/portal/urls.py`.

- [ ] **Step 7: Run tests**

```
pytest apps/portal/tests/test_member_auth.py -v
```
Expected: all pass. Fix any `Member` import path mismatches before continuing.

- [ ] **Step 8: Commit**

```bash
git add backend/apps/portal/member_auth_views.py \
        backend/apps/portal/member_auth_urls.py \
        backend/apps/portal/tests/test_member_auth.py \
        backend/apps/portal/urls.py
git commit -m "feat(portal): member magic link request/verify/refresh endpoints"
```

---

## Task 5: UserContext — capabilities from stored token

**Files:**
- Create: `portal/src/context/UserContext.jsx`

The token payload is a base64-encoded JSON in the middle segment (standard Django signing.dumps format: `payload.timestamp.signature`). We read `portal_token_type` from localStorage to know whether to parse as guest or member.

- [ ] **Step 1: Create UserContext**

```jsx
// portal/src/context/UserContext.jsx
import { createContext, useContext, useMemo } from 'react';

const UserContext = createContext(null);

function parseTokenPayload(token) {
  try {
    // Django signing format: base64(payload):timestamp:signature
    const segment = token.split(':')[0];
    return JSON.parse(atob(segment));
  } catch {
    return null;
  }
}

function buildCapabilities(tokenType, payload) {
  if (!payload) return {};
  if (tokenType === 'member') {
    return {
      isGuest:                false,
      isMember:               true,
      canViewBookingCheckin:  false,
      canViewFullLedger:      true,
      canViewLoyalty:         true,
      canBookServices:        true,
      canManageVessel:        true,
      canAccessGates:         true,
      canViewMarketplace:     true,
      canSublet:              false, // coming soon
    };
  }
  // guest token
  return {
    isGuest:                true,
    isMember:               false,
    canViewBookingCheckin:  true,
    canViewFullLedger:      false,
    canViewLoyalty:         false,
    canBookServices:        false,
    canManageVessel:        false,
    canAccessGates:         false,
    canViewMarketplace:     false,
    canSublet:              false,
  };
}

export function UserContextProvider({ children }) {
  const value = useMemo(() => {
    const sessionToken = localStorage.getItem('portal_session_token');
    const tokenType    = localStorage.getItem('portal_token_type'); // 'guest' | 'member'
    const marinaSlug   = localStorage.getItem('portal_marina_slug');

    if (!sessionToken) {
      return { user: null, capabilities: {}, marinaSlug };
    }

    const payload = parseTokenPayload(sessionToken);
    const capabilities = buildCapabilities(tokenType, payload);

    const user = tokenType === 'member'
      ? { type: 'member', memberId: payload?.member_id, email: payload?.email }
      : { type: 'guest',  bookingId: payload?.booking_id, email: payload?.boater_email };

    return { user, capabilities, marinaSlug };
  }, []); // recalculated only on mount; call refreshUserContext() after login

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUserContext() {
  return useContext(UserContext);
}
```

- [ ] **Step 2: Wrap main.jsx**

Edit `portal/src/main.jsx` to add the provider:

```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { TenantProvider } from './context/TenantContext';
import { UserContextProvider } from './context/UserContext';
import App from './App';
import './styles/portal.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <TenantProvider>
        <UserContextProvider>
          <App />
        </UserContextProvider>
      </TenantProvider>
    </BrowserRouter>
  </StrictMode>
);
```

(Adjust to match the current `main.jsx` structure — wrap `<App />` without changing other providers.)

- [ ] **Step 3: Commit**

```bash
git add portal/src/context/UserContext.jsx portal/src/main.jsx
git commit -m "feat(portal): UserContext with capabilities"
```

---

## Task 6: CSS design system additions

**Files:**
- Modify: `portal/src/styles/portal.css`

Add all new CSS classes needed by the shell and login. Do not remove existing classes — they are still used by checkin components until Plan 2 redesigns them.

- [ ] **Step 1: Append to portal.css**

Add the following block at the end of `portal/src/styles/portal.css`:

```css
/* ============================================================
   PORTAL REDESIGN — Shell, Nav, Login
   ============================================================ */

/* --- Typography --- */
.p-display {
  font-family: 'Cormorant Garamond', serif;
  font-weight: 600;
}

.p-label {
  font-family: 'Jost', sans-serif;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--muted, rgba(0,0,0,0.45));
}

.p-body {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 14px;
  color: var(--text, #1a1a1a);
  line-height: 1.5;
}

/* --- Tokens --- */
:root {
  --navy:   #0c1f3d;
  --gold:   #b8965a;
  --cream:  #f5f0e6;
  --bg:     #f4f3f0;
  --text:   #1a1a1a;
  --muted:  rgba(0,0,0,0.45);
  --red:    #c0392b;
  --orange: #dd5b00;
  --green:  #1a8c2e;
  --shadow: 0 1px 4px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.05);
}

/* --- AppShell --- */
.p-shell {
  min-height: 100vh;
  background: var(--bg);
  padding-bottom: calc(64px + env(safe-area-inset-bottom));
}

/* --- Bottom Nav --- */
.p-bottom-nav {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: calc(64px + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  background: #fff;
  border-top: 1px solid rgba(0,0,0,0.08);
  box-shadow: 0 -2px 12px rgba(0,0,0,0.06);
  display: flex;
  align-items: stretch;
  z-index: 100;
}

.p-nav-tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 8px 0 0;
  -webkit-tap-highlight-color: transparent;
  position: relative;
}

.p-nav-tab.active::after {
  content: '';
  position: absolute;
  top: 0;
  left: 16px;
  right: 16px;
  height: 3px;
  background: var(--gold);
  border-radius: 0 0 3px 3px;
}

.p-nav-tab svg {
  width: 22px;
  height: 22px;
  stroke: currentColor;
  fill: none;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.p-nav-tab .p-nav-label {
  font-family: 'Jost', sans-serif;
  font-size: 10px;
  font-weight: 500;
  color: var(--muted);
  letter-spacing: 0.3px;
}

.p-nav-tab.active .p-nav-label {
  font-weight: 700;
  color: var(--navy);
}

.p-nav-tab.active svg {
  color: var(--navy);
}

/* --- Card --- */
.p-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: var(--shadow);
  padding: 16px;
  margin-bottom: 12px;
}

.p-card--accent-red    { border-left: 4px solid var(--red); }
.p-card--accent-orange { border-left: 4px solid var(--orange); }
.p-card--accent-gold   { border-left: 4px solid var(--gold); }
.p-card--accent-green  { border-left: 4px solid var(--green); }
.p-card--accent-navy   { border-left: 4px solid var(--navy); }

/* --- Buttons --- */
.p-btn {
  display: block;
  width: 100%;
  padding: 14px 0;
  border-radius: 6px;
  font-family: 'Jost', sans-serif;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 0.3px;
  cursor: pointer;
  border: none;
  min-height: 44px;
  transition: opacity 0.15s;
}

.p-btn:disabled { opacity: 0.45; cursor: default; }

.p-btn--primary {
  background: var(--navy);
  color: #fff;
}

.p-btn--gold {
  background: var(--gold);
  color: #fff;
}

.p-btn--outline {
  background: transparent;
  color: var(--navy);
  border: 1.5px solid var(--navy);
}

.p-btn--ghost {
  background: transparent;
  color: var(--muted);
  border: 1.5px solid rgba(0,0,0,0.15);
}

/* --- Input --- */
.p-input {
  width: 100%;
  padding: 12px 14px;
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 16px;
  border: 1.5px solid rgba(0,0,0,0.15);
  border-radius: 6px;
  box-sizing: border-box;
  outline: none;
  background: #fff;
  color: var(--text);
  -webkit-appearance: none;
}

.p-input:focus {
  border-color: var(--navy);
}

/* --- Login screen --- */
.p-login {
  min-height: 100vh;
  background: var(--navy);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 24px;
}

.p-login__logo {
  width: 64px;
  height: 64px;
  border-radius: 12px;
  object-fit: cover;
  margin-bottom: 24px;
}

.p-login__marina-name {
  font-family: 'Jost', sans-serif;
  font-size: 22px;
  font-weight: 700;
  color: var(--cream);
  letter-spacing: 0.5px;
  margin-bottom: 8px;
  text-align: center;
}

.p-login__tagline {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 14px;
  color: rgba(255,255,255,0.55);
  margin-bottom: 40px;
  text-align: center;
}

.p-login__card {
  width: 100%;
  max-width: 360px;
  background: #fff;
  border-radius: 16px;
  padding: 28px 24px;
}

.p-login__card h2 {
  font-family: 'Jost', sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: var(--navy);
  margin: 0 0 6px;
}

.p-login__card p {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 13px;
  color: var(--muted);
  margin: 0 0 20px;
  line-height: 1.5;
}

/* --- Stub tab content --- */
.p-tab-stub {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 60vh;
  color: var(--muted);
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 15px;
}
```

- [ ] **Step 2: Verify Google Fonts are loaded**

Check `portal/index.html` — it must include IBM Plex Sans, Cormorant Garamond, and Jost. Add if missing:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=Jost:wght@400;500;600;700&display=swap" rel="stylesheet">
```

- [ ] **Step 3: Commit**

```bash
git add portal/src/styles/portal.css portal/index.html
git commit -m "feat(portal): design system CSS classes (shell, nav, login, cards, buttons)"
```

---

## Task 7: BottomNav component

**Files:**
- Create: `portal/src/components/shell/BottomNav.jsx`

- [ ] **Step 1: Create BottomNav**

```jsx
// portal/src/components/shell/BottomNav.jsx

const TABS = [
  {
    id: 'home',
    label: 'Home',
    icon: (
      <svg viewBox="0 0 24 24"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>
    ),
  },
  {
    id: 'services',
    label: 'Services',
    icon: (
      <svg viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>
    ),
  },
  {
    id: 'book',
    label: 'Book',
    icon: (
      <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
    ),
  },
  {
    id: 'wallet',
    label: 'Wallet',
    icon: (
      <svg viewBox="0 0 24 24"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
    ),
  },
  {
    id: 'account',
    label: 'Account',
    icon: (
      <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
    ),
  },
];

export default function BottomNav({ activeTab, onTabChange }) {
  return (
    <nav className="p-bottom-nav" role="navigation" aria-label="Main navigation">
      {TABS.map(tab => (
        <button
          key={tab.id}
          className={`p-nav-tab${activeTab === tab.id ? ' active' : ''}`}
          onClick={() => onTabChange(tab.id)}
          aria-label={tab.label}
          aria-current={activeTab === tab.id ? 'page' : undefined}
        >
          {tab.icon}
          <span className="p-nav-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/components/shell/BottomNav.jsx
git commit -m "feat(portal): BottomNav with 5 SVG icon tabs"
```

---

## Task 8: AppShell component

**Files:**
- Create: `portal/src/components/shell/AppShell.jsx`

- [ ] **Step 1: Create AppShell**

```jsx
// portal/src/components/shell/AppShell.jsx
import { useState } from 'react';
import BottomNav from './BottomNav';
import HomeTab     from '../../screens/tabs/HomeTab';
import ServicesTab from '../../screens/tabs/ServicesTab';
import BookTab     from '../../screens/tabs/BookTab';
import WalletTab   from '../../screens/tabs/WalletTab';
import AccountTab  from '../../screens/tabs/AccountTab';

const TAB_COMPONENTS = {
  home:     HomeTab,
  services: ServicesTab,
  book:     BookTab,
  wallet:   WalletTab,
  account:  AccountTab,
};

export default function AppShell({ initialTab = 'home' }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const TabComponent = TAB_COMPONENTS[activeTab] || HomeTab;

  return (
    <div className="p-shell">
      <TabComponent />
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
```

- [ ] **Step 2: Create stub tab files**

Create each stub so imports resolve:

```jsx
// portal/src/screens/tabs/HomeTab.jsx
export default function HomeTab() {
  return <div className="p-tab-stub">Home — coming in Plan 2</div>;
}
```

```jsx
// portal/src/screens/tabs/ServicesTab.jsx
export default function ServicesTab() {
  return <div className="p-tab-stub">Services — coming in Plan 3</div>;
}
```

```jsx
// portal/src/screens/tabs/BookTab.jsx
export default function BookTab() {
  return <div className="p-tab-stub">Book — coming in Plan 5</div>;
}
```

```jsx
// portal/src/screens/tabs/WalletTab.jsx
export default function WalletTab() {
  return <div className="p-tab-stub">Wallet — coming in Plan 4</div>;
}
```

```jsx
// portal/src/screens/tabs/AccountTab.jsx
export default function AccountTab() {
  return <div className="p-tab-stub">Account — coming in Plan 4</div>;
}
```

- [ ] **Step 3: Commit**

```bash
git add portal/src/components/shell/AppShell.jsx portal/src/screens/tabs/
git commit -m "feat(portal): AppShell + stub tab screens"
```

---

## Task 9: LoginScreen component

**Files:**
- Create: `portal/src/screens/LoginScreen.jsx`

- [ ] **Step 1: Create LoginScreen**

```jsx
// portal/src/screens/LoginScreen.jsx
import { useState } from 'react';
import api from '../api';

// 'idle' | 'submitting' | 'sent' | 'error'

export default function LoginScreen({ marina }) {
  const [email, setEmail]   = useState('');
  const [state, setState]   = useState('idle');
  const [error, setError]   = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setState('submitting');
    setError('');
    try {
      await api.post('/portal/auth/member-magic/request/', { email });
      setState('sent');
    } catch {
      setError('Something went wrong. Please try again.');
      setState('error');
    }
  }

  const logoUrl = marina?.logo_url;

  return (
    <div className="p-login">
      {logoUrl && <img src={logoUrl} alt={marina.name} className="p-login__logo" />}
      <div className="p-login__marina-name">{marina?.name || 'Boater Portal'}</div>
      <div className="p-login__tagline">Member sign-in</div>

      <div className="p-login__card">
        {state === 'sent' ? (
          <>
            <h2>Check your email</h2>
            <p>
              We sent a sign-in link to <strong>{email}</strong>. The link
              expires in 24 hours.
            </p>
            <button
              className="p-btn p-btn--ghost"
              style={{ marginTop: 8 }}
              onClick={() => setState('idle')}
            >
              Use a different email
            </button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <h2>Sign in</h2>
            <p>Enter your email and we'll send you a secure sign-in link — no password needed.</p>

            <label className="p-label" htmlFor="email-input">Email address</label>
            <input
              id="email-input"
              type="email"
              className="p-input"
              style={{ marginTop: 4, marginBottom: 16 }}
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
              autoComplete="email"
            />

            {error && (
              <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              className="p-btn p-btn--primary"
              disabled={state === 'submitting' || !email}
            >
              {state === 'submitting' ? 'Sending…' : 'Send me a link'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/screens/LoginScreen.jsx
git commit -m "feat(portal): LoginScreen — email magic link entry"
```

---

## Task 10: Update App.jsx routing

Replace the current routing logic with shell/login/guest-checkin routing.

**Files:**
- Modify: `portal/src/App.jsx`

- [ ] **Step 1: Update App.jsx**

```jsx
// portal/src/App.jsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTenant } from './context/TenantContext';
import Magic from './screens/Magic';
import LoginScreen   from './screens/LoginScreen';
import AppShell      from './components/shell/AppShell';
import BookingConfirmed from './screens/BookingConfirmed';
import BookingRequest    from './screens/BookingRequest';
import BookingRequestSent from './screens/BookingRequestSent';
import BookingWizard     from './screens/BookingWizard';
import api from './api';

const BOOKING_RESULT = /\/booking\/(\d+)\/(confirmed|cancelled)$/;

async function exchangeMemberToken(rawToken) {
  const { data } = await api.post('/portal/auth/member-magic/verify/', { token: rawToken });
  localStorage.setItem('portal_session_token', data.session_token);
  localStorage.setItem('portal_refresh_token', data.refresh_token);
  localStorage.setItem('portal_token_type',    'member');
  localStorage.setItem('portal_marina_slug',   data.marina_slug);
  // Force a page reload so UserContext re-parses the new token
  window.location.replace(window.location.pathname);
}

export default function App() {
  const [params]    = useSearchParams();
  const { marina, isLoading, tenantSlug, customDomain } = useTenant();
  const [submitted, setSubmitted] = useState(false);

  // --- Guest magic link (booking confirmation) ---
  if (params.get('token')) return <Magic />;

  // --- Member magic link click ---
  const memberToken = params.get('member_token');
  if (memberToken) {
    exchangeMemberToken(memberToken).catch(() => {
      window.location.replace(window.location.pathname);
    });
    return (
      <div className="p-login">
        <div className="p-login__tagline" style={{ color: 'rgba(255,255,255,0.7)' }}>
          Signing you in…
        </div>
      </div>
    );
  }

  // --- Stripe result redirect ---
  const resultMatch = window.location.pathname.match(BOOKING_RESULT);
  if (resultMatch) {
    const cancelled = resultMatch[2] === 'cancelled';
    return <BookingConfirmed marina={marina} bookingId={resultMatch[1]} cancelled={cancelled} />;
  }

  // --- Authenticated shell (guest or member) ---
  const sessionToken = localStorage.getItem('portal_session_token');
  if (sessionToken) {
    const tokenType = localStorage.getItem('portal_token_type');
    if (tokenType === 'member') {
      return <AppShell initialTab="home" />;
    }
    // Guest booking session — render shell with HomeTab in guest mode
    return <AppShell initialTab="home" />;
  }

  // --- Unauthenticated ---
  if (isLoading) {
    return (
      <div className="p-login" style={{ justifyContent: 'center' }}>
        <div style={{ color: 'rgba(255,255,255,0.5)', fontFamily: 'IBM Plex Sans, sans-serif' }}>
          Loading…
        </div>
      </div>
    );
  }

  if (!marina) {
    const id = tenantSlug || customDomain || 'this marina';
    return (
      <div className="p-login">
        <div className="p-login__marina-name" style={{ color: 'var(--cream)' }}>
          Marina &quot;{id}&quot; not found.
        </div>
      </div>
    );
  }

  // Booking-only marina (no member portal) — show booking wizard / request form
  if (marina.booking_mode === 'manual_approval') {
    if (submitted) return <BookingRequestSent marina={marina} />;
    return <BookingRequest marina={marina} onSubmitted={() => setSubmitted(true)} />;
  }

  // Show login screen for member marina
  // If the marina has a booking wizard *and* a member portal, show login by default;
  // a "Book without account" link can be added in a later plan.
  return <LoginScreen marina={marina} />;
}
```

Note: `exchangeMemberToken` triggers `window.location.replace` to force `UserContext` to re-read localStorage. This is intentional — it avoids prop-drilling a refresh callback.

- [ ] **Step 2: Also update Magic.jsx to set portal_token_type = 'guest'**

Open `portal/src/screens/Magic.jsx`. After the successful auth and localStorage stores, add:

```js
localStorage.setItem('portal_token_type', 'guest');
```

Find the line where `portal_session_token` is stored and add the type line directly below it.

- [ ] **Step 3: Run dev server and smoke-test**

```bash
cd portal
npm run dev
```

- Visit `http://localhost:5176/{your-test-marina-slug}`
- Expect: LoginScreen with navy background, marina name, email form
- Visit with a valid guest magic link `?token=...` — expect existing checkin flow
- Visit with `?member_token=invalid` — expect redirect back to login (no crash)

- [ ] **Step 4: Commit**

```bash
git add portal/src/App.jsx portal/src/screens/Magic.jsx
git commit -m "feat(portal): App.jsx — member/guest routing, LoginScreen wired"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Covered in this plan? |
|---|---|
| 2.1 Guest magic link flow | No change needed (existing Magic.jsx); only added `portal_token_type='guest'` |
| 2.1 Member magic link flow | Tasks 1–4 (backend) + Task 10 (frontend exchange) |
| 2.1 90-day rolling refresh | Task 1 (utils), Task 4 (refresh endpoint), Task 3 (api.js interceptor) |
| 2.1 Multi-profile picker | Task 4 (MemberMagicRequestView, multiple members branch) |
| 2.2 UserContext + capabilities | Task 5 |
| 2.3 Login screen | Task 9 |
| 3.1 AppShell | Task 8 |
| 3.1 Guest mode — no bottom nav | Handled: guests render AppShell but HomeTab (Plan 2) will render fullscreen without nav; AppShell always renders nav in this plan — **gap**: plan 2 must conditionally hide nav for guests |
| 3.2 Bottom nav | Task 7 |
| 3.3 Design system CSS | Task 6 |
| 3.4 URL structure | Task 10 |

**Gap noted:** The spec says guests do NOT see the bottom nav. In this plan, `AppShell` always renders the nav. Plan 2 must update `AppShell` to read `capabilities.isGuest` from `UserContext` and skip the nav (rendering the guest checkin fullscreen without nav wrapper). This is explicitly called out so Plan 2 handles it correctly.

**Placeholder scan:** No TBD or TODO left. Member model import path is explicitly flagged for the implementer to verify (Task 4, Step 1).

**Type consistency:** `portal_token_type` key used consistently across `api.js`, `UserContext.jsx`, `App.jsx`, and `Magic.jsx`.
