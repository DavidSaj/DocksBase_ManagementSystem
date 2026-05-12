# Portal URL Routing & Auth Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the portal into explicit URL paths (`/{slug}/book` for the public booking wizard, `/{slug}/` for the authenticated member portal), add a two-tab login screen (instant guest login via Email + Booking ID, magic link for members), and wire a unified `request-link/` email endpoint that safely handles all member/guest combinations.

**Architecture:** React Router `<Routes>` replaces the if/else chain in `App.jsx`. A new `<PortalGate>` component owns the auth decision for the `/{slug}/*` path. Two new backend endpoints handle instant guest login and unified magic-link dispatch. Token prefixes (`m_` / `g_`) route to the correct existing verify endpoints.

**Tech Stack:** Django REST Framework (backend), React + React Router v6 (frontend), Django signing (`django.core.signing`), axios.

---

## File Map

**Backend — modify:**
- `backend/apps/portal/checkin_utils.py` — fix `make_magic_url()` to emit `g_` prefix
- `backend/apps/reservations/emails.py` — add "No link?" fallback instruction to confirmation email
- `backend/apps/portal/member_auth_views.py` — add `GuestInstantLoginView` and `UnifiedRequestLinkView`
- `backend/apps/portal/member_auth_urls.py` — register both new endpoints
- `backend/apps/portal/tests/conftest.py` — add `guest_booking_factory` fixture

**Backend — new test file:**
- `backend/apps/portal/tests/test_portal_routing_auth.py`

**Frontend — modify:**
- `portal/src/App.jsx` — replace if/else chain with `<Routes>`
- `portal/src/screens/LoginScreen.jsx` — two-tab layout (Guest instant + Member magic link)

**Frontend — create:**
- `portal/src/components/shell/PortalGate.jsx` — owns all auth-gate logic

**Frontend — delete:**
- `portal/src/screens/Magic.jsx` — logic absorbed into PortalGate

---

## Task 1: Fix `make_magic_url()` and add "No link?" to confirmation email

**Files:**
- Modify: `backend/apps/portal/checkin_utils.py`
- Modify: `backend/apps/reservations/emails.py`

- [ ] **Step 1: Update `make_magic_url()` to use the `g_` prefix**

In `backend/apps/portal/checkin_utils.py`, replace the function body:

```python
def make_magic_url(booking):
    token = make_magic_token(booking.id, booking.guest_email)
    base = getattr(settings, 'PORTAL_BASE_URL', 'https://book.docksbase.com')
    return f"{base}/{booking.marina.slug}?token=g_{token}"
```

- [ ] **Step 2: Add the "No link?" fallback line to `send_booking_confirmed_email()`**

In `backend/apps/reservations/emails.py`, the function already calls `make_magic_url(booking)` and derives `magic_url`. Add one line to the `_base(...)` call after `_btn(magic_url, "Open Boarding Pass →")`:

```python
_btn(magic_url, "Open Boarding Pass →") +
_p(
    f'No link? Visit <a href="{magic_url.split("?")[0]}" style="color:{_NAVY};">'
    f'{magic_url.split("?")[0]}</a> and enter your Booking ID '
    f'<strong>BK-{booking.pk}</strong> with your email address to sign in instantly.'
) +
_divider() +
```

Also add to the plain-text `message=` block, after `f"Open your boarding pass: {magic_url}\n\n"`:

```python
f"No link? Visit {magic_url.split('?')[0]} and enter Booking ID BK-{booking.pk} with your email.\n\n"
```

- [ ] **Step 3: Verify the existing magic link test still references `?token=g_`**

The test in `backend/apps/portal/tests/test_member_auth.py` checks `'member_token=' in django_mail.outbox[0].body` — that test is for the *member* magic request flow which is unchanged. No changes needed there.

Run:
```
cd backend && python -m pytest apps/portal/tests/test_member_auth.py -v
```
Expected: all existing tests PASS.

- [ ] **Step 4: Commit**

```bash
git add backend/apps/portal/checkin_utils.py backend/apps/reservations/emails.py
git commit -m "fix(portal): g_ prefix in make_magic_url, add booking-id fallback to confirmation email"
```

---

## Task 2: Add `guest_booking_factory` fixture to test conftest

**Files:**
- Modify: `backend/apps/portal/tests/conftest.py`

The existing `booking_factory` fixture creates bookings linked to a vessel+member. The guest-instant endpoint uses `guest_email` on a booking with no member. We need a separate fixture.

- [ ] **Step 1: Add the fixture**

Append to `backend/apps/portal/tests/conftest.py`:

```python
@pytest.fixture
def guest_booking_factory():
    from apps.reservations.models import Booking
    import datetime as _dt

    _counter = [0]

    def _make(marina, **kwargs):
        _counter[0] += 1
        n = _counter[0]
        today = _dt.date.today()
        defaults = {
            'marina':      marina,
            'check_in':    today,
            'check_out':   today + _dt.timedelta(days=3),
            'status':      'confirmed',
            'guest_name':  f'Guest {n}',
            'guest_email': f'guest{n}@test.com',
        }
        defaults.update(kwargs)
        return Booking.objects.create(**defaults)

    return _make
```

- [ ] **Step 2: Verify fixture is importable**

```
cd backend && python -m pytest apps/portal/tests/ --collect-only -q 2>&1 | head -20
```
Expected: no import errors.

- [ ] **Step 3: Commit**

```bash
git add backend/apps/portal/tests/conftest.py
git commit -m "test(portal): add guest_booking_factory fixture"
```

---

## Task 3: Backend — `POST /portal/auth/guest-instant/`

**Files:**
- Modify: `backend/apps/portal/member_auth_views.py`
- Modify: `backend/apps/portal/member_auth_urls.py`
- Create: `backend/apps/portal/tests/test_portal_routing_auth.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/apps/portal/tests/test_portal_routing_auth.py`:

```python
import datetime
import pytest
from django.test import Client


@pytest.mark.django_db
def test_guest_instant_success(guest_booking_factory, marina_factory):
    marina = marina_factory()
    today = datetime.date.today()
    booking = guest_booking_factory(
        marina,
        check_in=today,
        check_out=today + datetime.timedelta(days=3),
        guest_email='skipper@test.com',
    )
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/guest-instant/',
        data={'email': 'skipper@test.com', 'booking_reference': f'BK-{booking.pk}'},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=marina.slug,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert 'token' in data
    assert data['booking_id'] == booking.pk
    assert data['marina_slug'] == marina.slug


@pytest.mark.django_db
def test_guest_instant_case_insensitive_email(guest_booking_factory, marina_factory):
    marina = marina_factory()
    today = datetime.date.today()
    booking = guest_booking_factory(marina, guest_email='Skipper@Test.com')
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/guest-instant/',
        data={'email': 'skipper@test.com', 'booking_reference': f'BK-{booking.pk}'},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=marina.slug,
    )
    assert resp.status_code == 200


@pytest.mark.django_db
def test_guest_instant_wrong_email_returns_401(guest_booking_factory, marina_factory):
    marina = marina_factory()
    booking = guest_booking_factory(marina, guest_email='real@test.com')
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/guest-instant/',
        data={'email': 'wrong@test.com', 'booking_reference': f'BK-{booking.pk}'},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=marina.slug,
    )
    assert resp.status_code == 401


@pytest.mark.django_db
def test_guest_instant_invalid_ref_format_returns_401(guest_booking_factory, marina_factory):
    marina = marina_factory()
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/guest-instant/',
        data={'email': 'guest@test.com', 'booking_reference': 'NOTAREF'},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=marina.slug,
    )
    assert resp.status_code == 401


@pytest.mark.django_db
def test_guest_instant_member_email_gets_scoped_guest_token(
    guest_booking_factory, member_factory
):
    """Member email + booking ref always issues a guest-scoped token, not member access."""
    member = member_factory()
    booking = guest_booking_factory(member.marina, guest_email=member.email)
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/guest-instant/',
        data={'email': member.email, 'booking_reference': f'BK-{booking.pk}'},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=member.marina.slug,
    )
    assert resp.status_code == 200
    # Token must decode as a guest portal token (not a member session token)
    from apps.portal.checkin_utils import decode_portal_token
    data = resp.json()
    payload = decode_portal_token(data['token'])
    assert payload['booking_id'] == booking.pk
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd backend && python -m pytest apps/portal/tests/test_portal_routing_auth.py -v 2>&1 | head -30
```
Expected: FAIL — `404 Not Found` (endpoint doesn't exist yet).

- [ ] **Step 3: Add `GuestInstantLoginView` to `member_auth_views.py`**

Add at the bottom of `backend/apps/portal/member_auth_views.py`:

```python
from apps.reservations.models import Booking
from .checkin_utils import make_portal_token


class GuestInstantLoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        email       = (request.data.get('email') or '').strip().lower()
        ref         = (request.data.get('booking_reference') or '').strip().upper()
        marina_slug = request.META.get('HTTP_X_MARINA_SLUG', '')

        if not email or not ref or not marina_slug:
            return Response(
                {'detail': 'email, booking_reference, and X-Marina-Slug required.'},
                status=400,
            )

        if ref.startswith('BK-'):
            ref = ref[3:]
        try:
            booking_pk = int(ref)
        except ValueError:
            return Response({'detail': 'No booking found.'}, status=401)

        try:
            booking = Booking.objects.select_related('marina').get(
                pk=booking_pk,
                guest_email__iexact=email,
                marina__slug=marina_slug,
            )
        except Booking.DoesNotExist:
            return Response({'detail': 'No booking found.'}, status=401)

        session_token = make_portal_token(
            booking_id=booking.id,
            marina_slug=booking.marina.slug,
            boater_email=booking.guest_email,
        )
        return Response({
            'token': session_token,
            'booking_id': booking.id,
            'marina_slug': booking.marina.slug,
        })
```

- [ ] **Step 4: Register the endpoint in `member_auth_urls.py`**

```python
from .member_auth_views import (
    MemberMagicRefreshView,
    MemberMagicRequestView,
    MemberMagicVerifyView,
    GuestInstantLoginView,
)

urlpatterns = [
    path('portal/auth/member-magic/request/', MemberMagicRequestView.as_view(), name='member_magic_request'),
    path('portal/auth/member-magic/verify/',  MemberMagicVerifyView.as_view(),  name='member_magic_verify'),
    path('portal/auth/member-magic/refresh/', MemberMagicRefreshView.as_view(), name='member_magic_refresh'),
    path('portal/auth/guest-instant/',        GuestInstantLoginView.as_view(),  name='guest_instant'),
]
```

- [ ] **Step 5: Run tests to verify they pass**

```
cd backend && python -m pytest apps/portal/tests/test_portal_routing_auth.py -v
```
Expected: all 5 guest-instant tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/portal/member_auth_views.py backend/apps/portal/member_auth_urls.py backend/apps/portal/tests/test_portal_routing_auth.py
git commit -m "feat(portal): POST /portal/auth/guest-instant/ — instant login via email + booking ID"
```

---

## Task 4: Backend — `POST /portal/auth/request-link/`

**Files:**
- Modify: `backend/apps/portal/member_auth_views.py`
- Modify: `backend/apps/portal/member_auth_urls.py`
- Modify: `backend/apps/portal/tests/test_portal_routing_auth.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/apps/portal/tests/test_portal_routing_auth.py`:

```python
from django.core import mail as django_mail


@pytest.mark.django_db
def test_request_link_member_only_sends_member_link(member_factory):
    member = member_factory()
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/request-link/',
        data={'email': member.email},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=member.marina.slug,
    )
    assert resp.status_code == 200
    assert len(django_mail.outbox) == 1
    body = django_mail.outbox[0].body
    assert '?token=m_' in body
    assert '?token=g_' not in body


@pytest.mark.django_db
def test_request_link_guest_only_sends_guest_link(guest_booking_factory, marina_factory):
    marina = marina_factory()
    booking = guest_booking_factory(marina, guest_email='visitor@test.com')
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/request-link/',
        data={'email': 'visitor@test.com'},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=marina.slug,
    )
    assert resp.status_code == 200
    assert len(django_mail.outbox) == 1
    body = django_mail.outbox[0].body
    assert '?token=g_' in body
    assert '?token=m_' not in body


@pytest.mark.django_db
def test_request_link_multiple_bookings_lists_all(guest_booking_factory, marina_factory):
    import datetime
    marina = marina_factory()
    today = datetime.date.today()
    b1 = guest_booking_factory(marina, guest_email='visitor@test.com',
                                check_in=today, check_out=today + datetime.timedelta(days=2))
    b2 = guest_booking_factory(marina, guest_email='visitor@test.com',
                                check_in=today + datetime.timedelta(days=30),
                                check_out=today + datetime.timedelta(days=33))
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/request-link/',
        data={'email': 'visitor@test.com'},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=marina.slug,
    )
    assert resp.status_code == 200
    body = django_mail.outbox[0].body
    # Both booking links present
    assert f'BK-{b1.pk}' in body
    assert f'BK-{b2.pk}' in body


@pytest.mark.django_db
def test_request_link_member_and_booking_sends_both(member_factory, guest_booking_factory):
    member = member_factory()
    booking = guest_booking_factory(member.marina, guest_email=member.email)
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/request-link/',
        data={'email': member.email},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=member.marina.slug,
    )
    assert resp.status_code == 200
    body = django_mail.outbox[0].body
    assert '?token=m_' in body
    assert '?token=g_' in body


@pytest.mark.django_db
def test_request_link_unknown_email_returns_200_no_email(marina_factory):
    marina = marina_factory()
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/request-link/',
        data={'email': 'nobody@test.com'},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=marina.slug,
    )
    assert resp.status_code == 200
    assert len(django_mail.outbox) == 0


@pytest.mark.django_db
def test_request_link_excludes_past_bookings(guest_booking_factory, marina_factory):
    """Bookings where check_out < today must not generate a link."""
    import datetime
    marina = marina_factory()
    yesterday = datetime.date.today() - datetime.timedelta(days=1)
    guest_booking_factory(
        marina, guest_email='oldguest@test.com',
        check_in=yesterday - datetime.timedelta(days=3),
        check_out=yesterday,
    )
    client = Client()
    resp = client.post(
        '/api/v1/portal/auth/request-link/',
        data={'email': 'oldguest@test.com'},
        content_type='application/json',
        HTTP_X_MARINA_SLUG=marina.slug,
    )
    assert resp.status_code == 200
    assert len(django_mail.outbox) == 0
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd backend && python -m pytest apps/portal/tests/test_portal_routing_auth.py -k "request_link" -v 2>&1 | head -30
```
Expected: FAIL — 404 (endpoint doesn't exist yet).

- [ ] **Step 3: Add `UnifiedRequestLinkView` to `member_auth_views.py`**

Add at the bottom of `backend/apps/portal/member_auth_views.py` (the `Booking` and `make_portal_token` imports already added in Task 3):

```python
import datetime as _dt
from .checkin_utils import make_magic_token


class UnifiedRequestLinkView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        email       = (request.data.get('email') or '').strip().lower()
        marina_slug = request.META.get('HTTP_X_MARINA_SLUG', '')
        SILENT      = Response({'detail': 'If an account exists, a secure link has been sent.'})

        if not email or not marina_slug:
            return Response({'detail': 'email and X-Marina-Slug required.'}, status=400)

        base  = getattr(settings, 'PORTAL_BASE_URL', 'https://book.docksbase.com')
        today = _dt.date.today()

        members = list(
            Member.objects.filter(email__iexact=email, marina__slug=marina_slug)
            .select_related('marina')
        )
        bookings = list(
            Booking.objects.filter(
                guest_email__iexact=email,
                marina__slug=marina_slug,
                check_out__gte=today,
            ).select_related('marina').order_by('check_in')
        )

        if not members and not bookings:
            return SILENT

        marina_name  = (members[0].marina if members else bookings[0].marina).name
        member_lines = []
        guest_lines  = []

        for m in members:
            token = make_member_magic_token(member_id=m.id, email=m.email)
            url   = f"{base}/{m.marina.slug}?token=m_{token}"
            label = m.name or m.email
            member_lines.append(f"Member Dashboard ({label}): {url}")

        for bk in bookings:
            token = make_magic_token(bk.id, bk.guest_email)
            url   = f"{base}/{bk.marina.slug}?token=g_{token}"
            guest_lines.append(
                f"BK-{bk.pk} ({bk.check_in} → {bk.check_out}): {url}"
            )

        all_lines = member_lines + guest_lines
        body = (
            f"Secure sign-in links for {email} at {marina_name}:\n\n"
            + '\n'.join(all_lines)
            + "\n\nEach link expires in 72 hours."
        )

        send_mail(
            subject=f'Your sign-in link — {marina_name}',
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[email],
            fail_silently=True,
        )
        return SILENT
```

- [ ] **Step 4: Register the endpoint in `member_auth_urls.py`**

```python
from .member_auth_views import (
    MemberMagicRefreshView,
    MemberMagicRequestView,
    MemberMagicVerifyView,
    GuestInstantLoginView,
    UnifiedRequestLinkView,
)

urlpatterns = [
    path('portal/auth/member-magic/request/', MemberMagicRequestView.as_view(), name='member_magic_request'),
    path('portal/auth/member-magic/verify/',  MemberMagicVerifyView.as_view(),  name='member_magic_verify'),
    path('portal/auth/member-magic/refresh/', MemberMagicRefreshView.as_view(), name='member_magic_refresh'),
    path('portal/auth/guest-instant/',        GuestInstantLoginView.as_view(),  name='guest_instant'),
    path('portal/auth/request-link/',         UnifiedRequestLinkView.as_view(), name='request_link'),
]
```

- [ ] **Step 5: Run all portal auth tests**

```
cd backend && python -m pytest apps/portal/tests/test_portal_routing_auth.py apps/portal/tests/test_member_auth.py -v
```
Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/portal/member_auth_views.py backend/apps/portal/member_auth_urls.py backend/apps/portal/tests/test_portal_routing_auth.py
git commit -m "feat(portal): POST /portal/auth/request-link/ — unified member+guest magic link dispatch"
```

---

## Task 5: Frontend — React Router `<Routes>` + `<PortalGate>`

**Files:**
- Modify: `portal/src/App.jsx`
- Create: `portal/src/components/shell/PortalGate.jsx`
- Delete: `portal/src/screens/Magic.jsx`

- [ ] **Step 1: Create `PortalGate.jsx`**

Create `portal/src/components/shell/PortalGate.jsx`:

```jsx
import { useState, useEffect } from 'react';
import { useTenant } from '../../context/TenantContext';
import api from '../../api';
import AppShell from './AppShell';
import LoginScreen from '../../screens/LoginScreen';

export default function PortalGate() {
  const { marina, isLoading, tenantSlug } = useTenant();
  const [state, setState] = useState('idle'); // 'idle' | 'verifying' | 'error'
  const [tokenError, setTokenError] = useState(null);

  const params    = new URLSearchParams(window.location.search);
  const rawToken  = params.get('token');

  useEffect(() => {
    if (!rawToken) return;
    setState('verifying');

    const isMember = rawToken.startsWith('m_');
    const token    = rawToken.slice(2);
    const endpoint = isMember
      ? '/portal/auth/member-magic/verify/'
      : '/portal/checkin/auth/magic/';

    api.post(endpoint, { token })
      .then(res => {
        const data = res.data;
        if (isMember) {
          localStorage.setItem('portal_session_token', data.session_token);
          localStorage.setItem('portal_refresh_token', data.refresh_token);
          localStorage.setItem('portal_token_type',    'member');
          localStorage.setItem('portal_marina_slug',   data.marina_slug);
        } else {
          localStorage.setItem('portal_session_token', data.token);
          localStorage.setItem('portal_token_type',    'guest');
          localStorage.setItem('portal_booking_id',    String(data.booking_id));
          localStorage.setItem('portal_marina_slug',   data.marina_slug);
        }
        const slug = tenantSlug || data.marina_slug;
        window.location.replace(`/${slug}/`);
      })
      .catch(() => {
        setTokenError('This link has expired or is invalid.');
        setState('error');
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (state === 'verifying') {
    return (
      <div className="p-login" style={{ justifyContent: 'center' }}>
        <div style={{ color: 'rgba(255,255,255,0.7)', fontFamily: 'IBM Plex Sans, sans-serif' }}>
          Signing you in…
        </div>
      </div>
    );
  }

  const sessionToken = localStorage.getItem('portal_session_token');
  if (sessionToken && state !== 'error') return <AppShell initialTab="home" />;

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
    return (
      <div className="p-login">
        <div className="p-login__marina-name" style={{ color: 'var(--cream)' }}>
          Marina not found.
        </div>
      </div>
    );
  }

  return <LoginScreen marina={marina} tokenError={tokenError} />;
}
```

- [ ] **Step 2: Rewrite `App.jsx` with `<Routes>`**

Replace the entire contents of `portal/src/App.jsx`:

```jsx
import { Routes, Route, useParams } from 'react-router-dom';
import { useTenant } from './context/TenantContext';
import PortalGate     from './components/shell/PortalGate';
import BookingWizard  from './screens/BookingWizard';
import BookingConfirmed from './screens/BookingConfirmed';

function BookingWizardPage() {
  const { marina } = useTenant();
  if (!marina) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 15 }}>Loading…</div>
      </div>
    );
  }
  return <BookingWizard marina={marina} />;
}

function BookingConfirmedPage({ cancelled }) {
  const { id }     = useParams();
  const { marina } = useTenant();
  return <BookingConfirmed marina={marina} bookingId={id} cancelled={cancelled} />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/:slug/book"                      element={<BookingWizardPage />} />
      <Route path="/:slug/booking/:id/confirmed"     element={<BookingConfirmedPage cancelled={false} />} />
      <Route path="/:slug/booking/:id/cancelled"     element={<BookingConfirmedPage cancelled={true} />} />
      <Route path="/:slug/*"                         element={<PortalGate />} />
    </Routes>
  );
}
```

- [ ] **Step 3: Delete `Magic.jsx`**

```bash
rm portal/src/screens/Magic.jsx
```

- [ ] **Step 4: Verify the dev server starts without errors**

```bash
cd portal && npm run dev
```
Expected: server starts, no import errors in terminal.

Open `http://localhost:5173/<your-dev-slug>/` — should reach PortalGate (either AppShell if session exists, or LoginScreen).

Open `http://localhost:5173/<your-dev-slug>/book` — should reach BookingWizard.

- [ ] **Step 5: Commit**

```bash
git add portal/src/App.jsx portal/src/components/shell/PortalGate.jsx
git rm portal/src/screens/Magic.jsx
git commit -m "feat(portal): React Router routes + PortalGate — split /book from member portal"
```

---

## Task 6: Frontend — Two-tab `<LoginScreen>`

**Files:**
- Modify: `portal/src/screens/LoginScreen.jsx`

The login screen gets two tabs. Tab 1 (default): instant guest login via Email + Booking ID. Tab 2: member magic link. The component accepts an optional `tokenError` prop from `PortalGate` to show an expired-link message above the tabs.

- [ ] **Step 1: Replace `LoginScreen.jsx`**

```jsx
import { useState } from 'react';
import api from '../api';

export default function LoginScreen({ marina, tokenError }) {
  const [tab, setTab] = useState('guest'); // 'guest' | 'member'

  // Guest tab state
  const [gEmail, setGEmail]   = useState('');
  const [gRef,   setGRef]     = useState('');
  const [gState, setGState]   = useState('idle'); // 'idle' | 'submitting' | 'error'
  const [gError, setGError]   = useState('');

  // Member tab state
  const [mEmail, setMEmail]   = useState('');
  const [mState, setMState]   = useState('idle'); // 'idle' | 'submitting' | 'sent'
  const [mError, setMError]   = useState('');

  async function handleGuestSubmit(e) {
    e.preventDefault();
    setGState('submitting');
    setGError('');
    try {
      const res = await api.post('/portal/auth/guest-instant/', {
        email: gEmail,
        booking_reference: gRef.trim().toUpperCase(),
      });
      const data = res.data;
      localStorage.setItem('portal_session_token', data.token);
      localStorage.setItem('portal_token_type',    'guest');
      localStorage.setItem('portal_booking_id',    String(data.booking_id));
      localStorage.setItem('portal_marina_slug',   data.marina_slug);
      window.location.reload();
    } catch {
      setGError('No booking found for that email and reference. Check your confirmation email for your Booking ID (e.g. BK-1042).');
      setGState('error');
    }
  }

  async function handleMemberSubmit(e) {
    e.preventDefault();
    setMState('submitting');
    setMError('');
    try {
      await api.post('/portal/auth/request-link/', { email: mEmail });
      setMState('sent');
    } catch {
      setMError('Something went wrong. Please try again.');
      setMState('idle');
    }
  }

  const logoUrl = marina?.logo_url;

  return (
    <div className="p-login">
      {logoUrl && <img src={logoUrl} alt={marina.name} className="p-login__logo" />}
      <div className="p-login__marina-name">{marina?.name || 'Boater Portal'}</div>

      <div className="p-login__card">
        {tokenError && (
          <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 16, padding: '8px 12px', background: 'rgba(192,57,43,0.08)', borderRadius: 6 }}>
            {tokenError}
          </div>
        )}

        <div style={{ display: 'flex', borderBottom: '1px solid rgba(0,0,0,0.1)', marginBottom: 20 }}>
          {[['guest', 'I have a Booking'], ['member', 'Marina Member']].map(([t, label]) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              style={{
                flex: 1,
                padding: '8px 4px',
                fontSize: 13,
                fontWeight: tab === t ? 700 : 400,
                color: tab === t ? 'var(--navy)' : 'rgba(0,0,0,0.45)',
                background: 'none',
                border: 'none',
                borderBottom: tab === t ? '2px solid var(--navy)' : '2px solid transparent',
                marginBottom: -1,
                cursor: 'pointer',
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'guest' && (
          <form onSubmit={handleGuestSubmit}>
            <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginTop: 0, marginBottom: 16 }}>
              Enter the email you booked with and your Booking ID from your confirmation email (e.g. BK-1042).
            </p>
            <label className="p-label" htmlFor="g-email">Email address</label>
            <input
              id="g-email"
              type="email"
              className="p-input"
              style={{ marginTop: 4, marginBottom: 12 }}
              value={gEmail}
              onChange={e => setGEmail(e.target.value)}
              placeholder="you@example.com"
              required
              autoFocus
              autoComplete="email"
            />
            <label className="p-label" htmlFor="g-ref">Booking ID</label>
            <input
              id="g-ref"
              type="text"
              className="p-input"
              style={{ marginTop: 4, marginBottom: 16 }}
              value={gRef}
              onChange={e => setGRef(e.target.value)}
              placeholder="BK-1042"
              required
              autoComplete="off"
            />
            {(gState === 'error') && (
              <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{gError}</div>
            )}
            <button
              type="submit"
              className="p-btn p-btn--primary"
              disabled={gState === 'submitting' || !gEmail || !gRef}
            >
              {gState === 'submitting' ? 'Looking up…' : 'View Boarding Pass'}
            </button>
          </form>
        )}

        {tab === 'member' && (
          <>
            {mState === 'sent' ? (
              <>
                <h2>Check your email</h2>
                <p>If an account exists for <strong>{mEmail}</strong>, a secure link has been sent. The link expires in 24 hours.</p>
                <button className="p-btn p-btn--ghost" style={{ marginTop: 8 }} onClick={() => setMState('idle')}>
                  Use a different email
                </button>
              </>
            ) : (
              <form onSubmit={handleMemberSubmit}>
                <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginTop: 0, marginBottom: 16 }}>
                  Enter your email and we'll send you a secure sign-in link — no password needed.
                </p>
                <label className="p-label" htmlFor="m-email">Email address</label>
                <input
                  id="m-email"
                  type="email"
                  className="p-input"
                  style={{ marginTop: 4, marginBottom: 16 }}
                  value={mEmail}
                  onChange={e => setMEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                />
                {mError && (
                  <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{mError}</div>
                )}
                <button
                  type="submit"
                  className="p-btn p-btn--primary"
                  disabled={mState === 'submitting' || !mEmail}
                >
                  {mState === 'submitting' ? 'Sending…' : 'Send Secure Link'}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Smoke-test both tabs in the browser**

With the dev server running (`cd portal && npm run dev`):

1. Navigate to `http://localhost:5173/<slug>/` — confirm the two-tab login screen appears
2. Tab 1 "I have a Booking": enter a real guest email + `BK-<id>` from a test booking → confirm redirect into AppShell
3. Tab 2 "Marina Member": enter a member email → confirm "Check your email" success state
4. Tab 1 with wrong ref: confirm red error message appears

- [ ] **Step 3: Commit**

```bash
git add portal/src/screens/LoginScreen.jsx
git commit -m "feat(portal): two-tab login — instant guest boarding pass + member magic link"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| `/{slug}/book` → BookingWizard | Task 5 |
| `/{slug}/` → PortalGate (auth gate) | Task 5 |
| `/{slug}?token=m_...` → member verify, redirect | Task 5 |
| `/{slug}?token=g_...` → guest verify, redirect | Task 5 |
| `/{slug}/booking/:id/confirmed` route | Task 5 |
| Delete `Magic.jsx` | Task 5 |
| `POST /portal/auth/guest-instant/` | Task 3 |
| Strips `BK-` prefix, looks up by pk + email | Task 3 |
| Always issues `g_` token regardless of member status | Task 3 |
| `POST /portal/auth/request-link/` | Task 4 |
| Uses `.filter()` not `.get()` | Task 4 |
| Decision table: member only, guest only, multi-booking, both | Task 4 |
| Unknown email: silent 200, no email sent | Task 4 |
| Past bookings excluded (`check_out__gte=today`) | Task 4 |
| `make_magic_url()` emits `g_` prefix | Task 1 |
| Confirmation email "No link?" fallback line | Task 1 |
| Two-tab LoginScreen | Task 6 |
| Guest tab: Email + Booking ID, instant session | Task 6 |
| Member tab: Email only, magic link | Task 6 |
| `tokenError` prop shown above tabs | Task 6 |

All requirements covered. No placeholders. Types consistent throughout (e.g. `make_portal_token` used in Task 3 view matches import from `checkin_utils`, `make_magic_token` used in Task 4 view is imported from same module).
