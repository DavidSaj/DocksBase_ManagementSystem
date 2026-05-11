# Services Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Services tab for the member portal with three active services (Crane Request, Extend Stay, Report an Issue) and stub rows for future features. All service backends use the new `PortalMemberAuthentication` system — never `IsBoater`.

**Architecture:** `ServicesTab.jsx` is a sub-screen router: null state shows the service list; tapping a row swaps in a full-screen sub-screen component. Three new backend views in `services_views.py` all authenticate via `PortalMemberAuthentication` (MemberBearer token). The existing `CraneRequestListCreateView` (IsBoater, Django User auth) is left untouched — a new member-auth endpoint is added alongside it.

**Tech Stack:** React, custom CSS (portal.css), Django REST Framework, PortalMemberAuthentication

**Auth constraint:** `PortalMemberUser` (from `member_auth.py`) has `member_id`, `marina_slug`, `email`, `pk` — it does NOT have `role`, `member_profile`, or `marina` attributes. All new views must look up `Member.objects.filter(id=request.user.member_id, marina__slug=request.user.marina_slug)` to get the member.

**Out of scope:** Photo upload in issue reporting (WorkOrder has no attachment field), electricity toggle, waitlist.

---

## File Map

**Create:**
- `backend/apps/portal/services_views.py` — 3 new views: PortalMemberCraneRequestView, PortalMemberBookingView, PortalMemberExtendStayView, PortalMemberIssueView
- `backend/apps/portal/tests/test_member_services.py` — all service endpoint tests
- `portal/src/screens/ReportIssueScreen.jsx` — new issue-report sub-screen

**Modify:**
- `portal/src/styles/portal.css` — append services CSS block
- `portal/src/screens/tabs/ServicesTab.jsx` — replace stub with full implementation
- `portal/src/screens/CraneRequestScreen.jsx` — remove inline styles + emojis, point to new endpoint
- `portal/src/screens/ExtendStayScreen.jsx` — remove inline styles, remove `booking` prop, load booking from API
- `backend/apps/portal/urls.py` — add 4 new URL patterns
- `backend/apps/portal/tests/conftest.py` — add `vessel_factory`, `berth_factory`, `booking_factory`

---

## Task 1: CSS — Services Tab Styles

**Files:**
- Modify: `portal/src/styles/portal.css`

- [ ] **Step 1: Append the services CSS block**

Find the end of the toast section in `portal.css` (after `.p-toast { ... }`), then append:

```css
/* ── Services Tab ─────────────────────────────────────────────────────── */
.p-service-list { padding: 16px 16px 96px; }

.p-service-section { margin-bottom: 28px; }

.p-service-section__header {
  font-size: 11px;
  font-weight: 700;
  color: rgba(0,0,0,0.4);
  text-transform: uppercase;
  letter-spacing: 0.6px;
  padding: 0 4px;
  margin-bottom: 10px;
}

.p-service-row {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 16px;
  background: #fff;
  border-radius: 12px;
  margin-bottom: 8px;
  box-shadow: var(--shadow);
  cursor: pointer;
  border: none;
  width: 100%;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.p-service-row:active { opacity: 0.75; }
.p-service-row--disabled { opacity: 0.45; cursor: default; pointer-events: none; }
.p-service-row__icon {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: var(--navy);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.p-service-row__icon svg {
  width: 20px;
  height: 20px;
  stroke: #fff;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.p-service-row__text { flex: 1; min-width: 0; }
.p-service-row__label { font-size: 15px; font-weight: 600; color: var(--navy); }
.p-service-row__sub { font-size: 12px; color: rgba(0,0,0,0.4); margin-top: 2px; }
.p-service-row__chevron {
  width: 18px;
  height: 18px;
  stroke: rgba(0,0,0,0.25);
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex-shrink: 0;
}
.p-service-row__badge {
  font-size: 10px;
  font-weight: 700;
  color: rgba(0,0,0,0.35);
  background: rgba(0,0,0,0.06);
  border-radius: 20px;
  padding: 2px 8px;
  flex-shrink: 0;
}

/* ── Sub-screens (full-screen overlays) ────────────────────────────────── */
.p-subscreen { min-height: 100vh; background: var(--bg); }
.p-subscreen__header {
  background: var(--navy);
  padding: 20px 20px 16px;
  color: #fff;
  display: flex;
  align-items: center;
  gap: 14px;
}
.p-subscreen__back {
  background: none;
  border: none;
  color: #fff;
  cursor: pointer;
  padding: 0;
  line-height: 1;
  display: flex;
  align-items: center;
  flex-shrink: 0;
}
.p-subscreen__back svg {
  width: 22px;
  height: 22px;
  stroke: #fff;
  fill: none;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.p-subscreen__title { font-size: 20px; font-weight: 700; line-height: 1.2; }
.p-subscreen__subtitle { font-size: 13px; opacity: 0.6; margin-top: 2px; }
.p-subscreen__body { padding: 16px 16px 48px; }

/* ── Form card (generic white card for service screens) ─────────────────── */
.p-form-card {
  background: #fff;
  border-radius: 14px;
  padding: 20px;
  margin-bottom: 12px;
  box-shadow: var(--shadow);
}

/* ── Form label ─────────────────────────────────────────────────────────── */
.p-form-label {
  display: block;
  font-size: 12px;
  font-weight: 700;
  color: rgba(0,0,0,0.45);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

/* ── Service option picker (crane service type selector) ─────────────────── */
.p-service-option {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1.5px solid #d0d6de;
  background: #fff;
  cursor: pointer;
  text-align: left;
  width: 100%;
  margin-bottom: 8px;
  transition: border 0.15s, background 0.15s;
}
.p-service-option:last-child { margin-bottom: 0; }
.p-service-option--selected {
  border: 2px solid var(--navy);
  background: rgba(12,31,61,0.04);
}
.p-service-option__icon {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.p-service-option__icon svg {
  width: 24px;
  height: 24px;
  stroke: var(--navy);
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.p-service-option__label { font-size: 15px; font-weight: 700; color: var(--navy); }
.p-service-option__desc { font-size: 13px; color: rgba(0,0,0,0.5); margin-top: 2px; }
.p-service-option__check { margin-left: auto; flex-shrink: 0; }
.p-service-option__check svg {
  width: 18px;
  height: 18px;
  stroke: var(--navy);
  fill: none;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* ── Status banners ─────────────────────────────────────────────────────── */
.p-banner {
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.4;
}
.p-banner--success { background: rgba(26,140,46,0.08); color: var(--green); }
.p-banner--error   { background: rgba(192,57,43,0.08); color: var(--red); }
.p-banner--info    { background: rgba(12,31,61,0.06); color: var(--navy); }

/* ── Success card (shared across all service sub-screens) ────────────────── */
.p-success-card { text-align: center; }
.p-success-card__icon { margin-bottom: 12px; display: flex; justify-content: center; }
.p-success-card__icon svg {
  width: 48px;
  height: 48px;
  stroke: var(--green);
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.p-success-card__title { font-size: 18px; font-weight: 700; color: var(--navy); margin-bottom: 8px; }
.p-success-card__body { font-size: 14px; color: rgba(0,0,0,0.55); line-height: 1.6; }
.p-success-card__ref {
  font-size: 13px;
  font-weight: 600;
  color: var(--navy);
  margin-top: 12px;
  padding: 8px 12px;
  background: rgba(12,31,61,0.06);
  border-radius: 6px;
  display: inline-block;
}

/* ── Native select fix: restore arrow removed by .p-input's -webkit-appearance:none ── */
select.p-input { -webkit-appearance: auto; appearance: auto; }
```

- [ ] **Step 2: Verify CSS compiles without errors**

Run the dev server: `cd portal && npm run dev`

Check the browser console for CSS parsing errors. The new rules should load without warnings.

- [ ] **Step 3: Commit**

```bash
git add portal/src/styles/portal.css
git commit -m "style(portal): add services tab and sub-screen CSS"
```

---

## Task 2: ServicesTab — List and Sub-Screen Router

**Files:**
- Modify: `portal/src/screens/tabs/ServicesTab.jsx`

- [ ] **Step 1: Replace the stub with full implementation**

Replace the entire content of `portal/src/screens/tabs/ServicesTab.jsx`:

```jsx
// portal/src/screens/tabs/ServicesTab.jsx
import { useState } from 'react';
import CraneRequestScreen from '../CraneRequestScreen';
import ExtendStayScreen from '../ExtendStayScreen';
import ReportIssueScreen from '../ReportIssueScreen';

function ChevronIcon() {
  return (
    <svg className="p-service-row__chevron" viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function CraneIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <line x1="12" y1="2" x2="12" y2="22" />
      <path d="M12 2l8 6H4l8-6z" />
      <line x1="4" y1="8" x2="20" y2="8" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

const SERVICES = [
  { id: 'crane',  label: 'Crane / Lift Request', sub: 'Request a hoist service from the harbour team', Icon: CraneIcon },
  { id: 'extend', label: 'Extend Stay',           sub: 'Request additional nights at your berth',       Icon: CalendarIcon },
  { id: 'issue',  label: 'Report an Issue',       sub: 'Berth, facility or vessel problem',             Icon: AlertIcon },
];

const STUBS = [
  { label: 'Maintenance Request', sub: 'Coming soon' },
  { label: 'Activities',          sub: 'Coming soon' },
];

export default function ServicesTab() {
  const [active, setActive] = useState(null);

  if (active === 'crane')  return <CraneRequestScreen onBack={() => setActive(null)} />;
  if (active === 'extend') return <ExtendStayScreen   onBack={() => setActive(null)} />;
  if (active === 'issue')  return <ReportIssueScreen  onBack={() => setActive(null)} />;

  return (
    <div className="p-service-list">
      <div className="p-service-section">
        <div className="p-service-section__header">Services</div>
        {SERVICES.map(({ id, label, sub, Icon }) => (
          <button key={id} className="p-service-row" onClick={() => setActive(id)}>
            <div className="p-service-row__icon"><Icon /></div>
            <div className="p-service-row__text">
              <div className="p-service-row__label">{label}</div>
              <div className="p-service-row__sub">{sub}</div>
            </div>
            <ChevronIcon />
          </button>
        ))}
      </div>
      <div className="p-service-section">
        <div className="p-service-section__header">Coming soon</div>
        {STUBS.map(({ label, sub }) => (
          <div key={label} className="p-service-row p-service-row--disabled" aria-disabled="true">
            <div className="p-service-row__text">
              <div className="p-service-row__label">{label}</div>
              <div className="p-service-row__sub">{sub}</div>
            </div>
            <span className="p-service-row__badge">Soon</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the Services tab renders**

With `npm run dev` running, open the app, log in as a member, tap the Services tab. Expect: list with 3 active rows (Crane/Lift Request, Extend Stay, Report an Issue) and 2 greyed-out rows. Tapping a row shows the stub sub-screen (will be blank or error until implemented — that's expected).

- [ ] **Step 3: Commit**

```bash
git add portal/src/screens/tabs/ServicesTab.jsx
git commit -m "feat(portal): services tab shell with sub-screen routing"
```

---

## Task 3: CraneRequestScreen Redesign

**Files:**
- Modify: `portal/src/screens/CraneRequestScreen.jsx`

**Context:** The current file has 172 lines with all styling as inline JS objects (HDR, CARD, BTN_PRIMARY, etc.) and emojis (⬇️, ⬆️, ↕️, ✅, ✓). The screen previously took `booking` and `onBack` props. In the member portal context it only needs `onBack`. The API endpoint changes from `/portal/crane-requests/` (IsBoater) to `/portal/member/crane-requests/` (PortalMemberAuthentication). The field name changes from `preferred_date` to `requested_date` to match the model.

- [ ] **Step 1: Rewrite CraneRequestScreen.jsx**

Replace the entire file:

```jsx
// portal/src/screens/CraneRequestScreen.jsx
import { useState } from 'react';
import api from '../api';

function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function LaunchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function HaulOutIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

function BothIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="18 15 12 9 6 15" />
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

const SERVICE_OPTIONS = [
  { value: 'launch',   label: 'Launch',   Icon: LaunchIcon,  desc: 'Put your vessel in the water' },
  { value: 'haul_out', label: 'Haul-Out', Icon: HaulOutIcon, desc: 'Lift your vessel out of the water' },
  { value: 'both',     label: 'Both',     Icon: BothIcon,    desc: 'Haul-out and re-launch' },
];

function todayPlusOne() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export default function CraneRequestScreen({ onBack }) {
  const [serviceType, setServiceType] = useState('');
  const [requestedDate, setRequestedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState('idle'); // 'idle' | 'submitting' | 'success' | 'error'
  const [errorMsg, setErrorMsg] = useState('');

  const minDate = todayPlusOne();

  async function handleSubmit(e) {
    e.preventDefault();
    if (!serviceType || !requestedDate) return;
    setStatus('submitting');
    setErrorMsg('');
    try {
      await api.post('/portal/member/crane-requests/', {
        service_type: serviceType,
        requested_date: requestedDate,
        notes: notes.trim() || undefined,
      });
      setStatus('success');
    } catch (err) {
      setErrorMsg(err?.response?.data?.detail || 'Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  return (
    <div className="p-subscreen">
      <div className="p-subscreen__header">
        <button className="p-subscreen__back" onClick={onBack} aria-label="Back">
          <ArrowLeftIcon />
        </button>
        <div>
          <div className="p-subscreen__title">Crane / Lift Request</div>
          <div className="p-subscreen__subtitle">Request a hoist service from the harbour team</div>
        </div>
      </div>

      <div className="p-subscreen__body">
        {status === 'success' ? (
          <div className="p-form-card p-success-card">
            <div className="p-success-card__icon"><CheckCircleIcon /></div>
            <div className="p-success-card__title">Request submitted</div>
            <div className="p-success-card__body">
              The harbour team will contact you to confirm the time.
            </div>
            <button
              className="p-btn p-btn--outline"
              style={{ marginTop: 20 }}
              onClick={onBack}
            >
              Back to Services
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="p-form-card">
              <label className="p-form-label">Service type</label>
              {SERVICE_OPTIONS.map(({ value, label, Icon, desc }) => {
                const selected = serviceType === value;
                return (
                  <button
                    key={value}
                    type="button"
                    className={`p-service-option${selected ? ' p-service-option--selected' : ''}`}
                    onClick={() => setServiceType(value)}
                  >
                    <div className="p-service-option__icon"><Icon /></div>
                    <div>
                      <div className="p-service-option__label">{label}</div>
                      <div className="p-service-option__desc">{desc}</div>
                    </div>
                    {selected && <div className="p-service-option__check"><CheckIcon /></div>}
                  </button>
                );
              })}
            </div>

            <div className="p-form-card">
              <label className="p-form-label" htmlFor="crane-date">Preferred date</label>
              <input
                id="crane-date"
                type="date"
                className="p-input"
                value={requestedDate}
                min={minDate}
                onChange={e => setRequestedDate(e.target.value)}
                required
              />
            </div>

            <div className="p-form-card">
              <label className="p-form-label" htmlFor="crane-notes">Notes (optional)</label>
              <textarea
                id="crane-notes"
                className="p-input"
                style={{ minHeight: 80, resize: 'vertical' }}
                placeholder="e.g. hull inspection needed, preferred time of day…"
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
            </div>

            {status === 'error' && errorMsg && (
              <div className="p-banner p-banner--error">{errorMsg}</div>
            )}

            <button
              type="submit"
              className="p-btn p-btn--primary"
              disabled={!serviceType || !requestedDate || status === 'submitting'}
            >
              {status === 'submitting' ? 'Submitting…' : 'Submit request'}
            </button>
            <button
              type="button"
              className="p-btn p-btn--outline"
              style={{ marginTop: 8 }}
              onClick={onBack}
            >
              Cancel
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the crane screen renders in the browser**

Tap Crane / Lift Request in the services list. Expect: navy header with back arrow, three service-type option buttons (Launch, Haul-Out, Both) with SVG icons, date picker, notes textarea. No emojis. No inline styles.

- [ ] **Step 3: Commit**

```bash
git add portal/src/screens/CraneRequestScreen.jsx
git commit -m "refactor(portal): crane request screen — CSS classes + SVG icons + member auth endpoint"
```

---

## Task 4: Backend — PortalMemberCraneRequestView

**Files:**
- Create: `backend/apps/portal/services_views.py`
- Create: `backend/apps/portal/tests/test_member_services.py`
- Modify: `backend/apps/portal/urls.py`
- Modify: `backend/apps/portal/tests/conftest.py`

- [ ] **Step 1: Write the failing tests**

Create `backend/apps/portal/tests/test_member_services.py`:

```python
# backend/apps/portal/tests/test_member_services.py
import pytest
import datetime as dt
from django.test import Client
from apps.portal.member_auth_utils import make_member_session_token


def _auth_headers(member):
    token = make_member_session_token(
        member_id=member.id,
        marina_slug=member.marina.slug,
        email=member.email,
    )
    return {
        'HTTP_AUTHORIZATION': f'MemberBearer {token}',
        'HTTP_X_MARINA_SLUG': member.marina.slug,
    }


# ── Crane Request ──────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_crane_requires_auth():
    client = Client()
    resp = client.post(
        '/api/v1/portal/member/crane-requests/',
        {},
        content_type='application/json',
    )
    assert resp.status_code in (401, 403)


@pytest.mark.django_db
def test_crane_creates_record(member_factory):
    member = member_factory()
    tomorrow = (dt.date.today() + dt.timedelta(days=1)).isoformat()
    resp = Client().post(
        '/api/v1/portal/member/crane-requests/',
        {'service_type': 'launch', 'requested_date': tomorrow},
        content_type='application/json',
        **_auth_headers(member),
    )
    assert resp.status_code == 201
    assert resp.json()['status'] == 'requested'


@pytest.mark.django_db
def test_crane_rejects_invalid_service_type(member_factory):
    member = member_factory()
    tomorrow = (dt.date.today() + dt.timedelta(days=1)).isoformat()
    resp = Client().post(
        '/api/v1/portal/member/crane-requests/',
        {'service_type': 'invalid', 'requested_date': tomorrow},
        content_type='application/json',
        **_auth_headers(member),
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_crane_rejects_missing_date(member_factory):
    member = member_factory()
    resp = Client().post(
        '/api/v1/portal/member/crane-requests/',
        {'service_type': 'launch'},
        content_type='application/json',
        **_auth_headers(member),
    )
    assert resp.status_code == 400
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd backend && python -m pytest apps/portal/tests/test_member_services.py -v
```

Expected: 3 failures (404 or ImportError — endpoint doesn't exist yet). The auth test (`test_crane_requires_auth`) may pass or fail depending on 404 behaviour — that's fine.

- [ ] **Step 3: Create services_views.py with PortalMemberCraneRequestView**

Create `backend/apps/portal/services_views.py`:

```python
# backend/apps/portal/services_views.py
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status as http_status
from rest_framework.permissions import IsAuthenticated

from apps.members.models import Member
from apps.reservations.models import Booking
from apps.boatyard.models import WorkOrder

from .member_auth import PortalMemberAuthentication
from .models import CraneRequest


def _get_member(request):
    """Return Member for the authenticated PortalMemberUser, scoped to marina."""
    return (
        Member.objects
        .filter(id=request.user.member_id, marina__slug=request.user.marina_slug)
        .select_related('marina')
        .first()
    )


class PortalMemberCraneRequestView(APIView):
    authentication_classes = [PortalMemberAuthentication]
    permission_classes = [IsAuthenticated]

    VALID_SERVICE_TYPES = {'launch', 'haul_out', 'both'}

    def post(self, request):
        member = _get_member(request)
        if member is None:
            return Response(
                {'detail': 'Member not found.'},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        service_type = request.data.get('service_type', '')
        requested_date = request.data.get('requested_date', '')
        notes = request.data.get('notes', '').strip()

        if service_type not in self.VALID_SERVICE_TYPES:
            return Response(
                {'detail': 'Invalid service_type.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        if not requested_date:
            return Response(
                {'detail': 'requested_date is required.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        crane_req = CraneRequest.objects.create(
            member=member,
            service_type=service_type,
            requested_date=requested_date,
            notes=notes,
        )
        return Response(
            {'id': crane_req.id, 'status': crane_req.status},
            status=http_status.HTTP_201_CREATED,
        )
```

- [ ] **Step 4: Register the URL**

In `backend/apps/portal/urls.py`, add the import and path:

```python
from .services_views import PortalMemberCraneRequestView

# Add to urlpatterns list:
path('portal/member/crane-requests/', PortalMemberCraneRequestView.as_view(), name='portal_member_crane_requests'),
```

Final `urls.py` should look like:

```python
from django.urls import path

from .feed_views import FeedView
from .member_auth_urls import urlpatterns as member_auth_urls
from .services_views import PortalMemberCraneRequestView
from .views import (
    PortalInvoiceListView, AbsenceReportCreateView, CraneRequestListCreateView,
    CraneRequestStaffListView, CraneRequestStaffDetailView,
    PortalBerthView, PortalVesselView, PortalInvoicePayView,
)

urlpatterns = member_auth_urls + [
    path('portal/feed/',                                   FeedView.as_view(),                    name='portal_feed'),
    path('portal/invoices/',                               PortalInvoiceListView.as_view(),       name='portal_invoices'),
    path('portal/invoices/<int:pk>/pay/',                  PortalInvoicePayView.as_view(),         name='portal_invoice_pay'),
    path('portal/absence/',                                AbsenceReportCreateView.as_view(),      name='portal_absence'),
    path('portal/crane-requests/',                         CraneRequestListCreateView.as_view(),   name='portal_crane_requests'),
    path('portal/crane-requests/staff/',                   CraneRequestStaffListView.as_view(),    name='portal_crane_staff_list'),
    path('portal/crane-requests/<int:pk>/staff-update/',   CraneRequestStaffDetailView.as_view(),  name='portal_crane_staff_detail'),
    path('portal/berth/',                                  PortalBerthView.as_view(),              name='portal_berth'),
    path('portal/vessel/',                                 PortalVesselView.as_view(),             name='portal_vessel'),
    # Member service endpoints (PortalMemberAuthentication)
    path('portal/member/crane-requests/',                  PortalMemberCraneRequestView.as_view(), name='portal_member_crane_requests'),
]
```

- [ ] **Step 5: Run tests to verify they pass**

```
cd backend && python -m pytest apps/portal/tests/test_member_services.py -v
```

Expected: 4/4 pass.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/portal/services_views.py \
        backend/apps/portal/tests/test_member_services.py \
        backend/apps/portal/urls.py
git commit -m "feat(portal): PortalMemberCraneRequestView with member auth"
```

---

## Task 5: ExtendStayScreen Redesign

**Files:**
- Modify: `portal/src/screens/ExtendStayScreen.jsx`

**Context:** Current file is 197 lines with all inline styles and a `booking` prop. In the member portal, the screen must load the member's booking from `GET /portal/member/booking/` on mount. Availability check changes from the public berths endpoint to `GET /portal/member/extend-stay/?new_check_out=DATE`. Extension creation changes from `POST /public/bookings/` to `POST /portal/member/extend-stay/`.

- [ ] **Step 1: Rewrite ExtendStayScreen.jsx**

Replace the entire file:

```jsx
// portal/src/screens/ExtendStayScreen.jsx
import { useState, useEffect } from 'react';
import api from '../api';

function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export default function ExtendStayScreen({ onBack }) {
  const [booking, setBooking] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [newCheckOut, setNewCheckOut] = useState('');
  // 'idle' | 'checking' | 'available' | 'unavailable' | 'submitting' | 'success' | 'error'
  const [status, setStatus] = useState('idle');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    api.get('/portal/member/booking/')
      .then(r => {
        setBooking(r.data);
        setNewCheckOut(addDays(r.data.check_out, 1));
      })
      .catch(() => setLoadError('Could not load your current booking. Please try again.'));
  }, []);

  async function handleCheck(e) {
    e.preventDefault();
    if (!newCheckOut) return;
    setStatus('checking');
    setErrorMsg('');
    try {
      const res = await api.get('/portal/member/extend-stay/', {
        params: { new_check_out: newCheckOut },
      });
      setStatus(res.data.available ? 'available' : 'unavailable');
    } catch {
      setStatus('unavailable');
    }
  }

  async function handleConfirm() {
    setStatus('submitting');
    try {
      await api.post('/portal/member/extend-stay/', { new_check_out: newCheckOut });
      setStatus('success');
    } catch (err) {
      setErrorMsg(err?.response?.data?.detail || 'Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  return (
    <div className="p-subscreen">
      <div className="p-subscreen__header">
        <button className="p-subscreen__back" onClick={onBack} aria-label="Back">
          <ArrowLeftIcon />
        </button>
        <div>
          <div className="p-subscreen__title">Extend Stay</div>
          <div className="p-subscreen__subtitle">Request additional nights at your berth</div>
        </div>
      </div>

      <div className="p-subscreen__body">
        {loadError && <div className="p-banner p-banner--error">{loadError}</div>}

        {!booking && !loadError && (
          <div className="p-feed__empty">Loading booking…</div>
        )}

        {booking && status === 'success' && (
          <div className="p-form-card p-success-card">
            <div className="p-success-card__icon"><CheckCircleIcon /></div>
            <div className="p-success-card__title">Extension requested</div>
            <div className="p-success-card__body">
              The marina will confirm your extended stay by email.
            </div>
            <button
              className="p-btn p-btn--outline"
              style={{ marginTop: 20 }}
              onClick={onBack}
            >
              Back to Services
            </button>
          </div>
        )}

        {booking && status !== 'success' && (
          <div className="p-form-card">
            <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy)', marginBottom: 14 }}>
              Current check-out:{' '}
              <span style={{ fontWeight: 400 }}>{booking.check_out}</span>
            </p>

            <form onSubmit={handleCheck}>
              <label className="p-form-label" htmlFor="extend-date">
                New check-out date
              </label>
              <input
                id="extend-date"
                type="date"
                className="p-input"
                style={{ marginBottom: 14 }}
                value={newCheckOut}
                min={addDays(booking.check_out, 1)}
                onChange={e => { setNewCheckOut(e.target.value); setStatus('idle'); }}
                required
              />

              {(status === 'idle' || status === 'error') && (
                <button type="submit" className="p-btn p-btn--primary" disabled={!newCheckOut}>
                  Check availability
                </button>
              )}

              {status === 'checking' && (
                <div className="p-feed__empty">Checking availability…</div>
              )}
            </form>

            {status === 'available' && (
              <>
                <div className="p-banner p-banner--success" style={{ marginTop: 14 }}>
                  Your berth is free — you can extend your stay.
                </div>
                <button
                  className="p-btn p-btn--primary"
                  style={{ background: 'var(--green)' }}
                  onClick={handleConfirm}
                >
                  Confirm extension
                </button>
                <button
                  className="p-btn p-btn--outline"
                  style={{ marginTop: 8 }}
                  onClick={() => setStatus('idle')}
                >
                  Change dates
                </button>
              </>
            )}

            {status === 'unavailable' && (
              <>
                <div className="p-banner p-banner--error" style={{ marginTop: 14 }}>
                  Sorry, your berth isn't available for those dates. Please contact the marina.
                </div>
                <button
                  className="p-btn p-btn--outline"
                  onClick={() => setStatus('idle')}
                >
                  Try different dates
                </button>
              </>
            )}

            {status === 'submitting' && (
              <div className="p-feed__empty">Submitting request…</div>
            )}

            {status === 'error' && errorMsg && (
              <div className="p-banner p-banner--error" style={{ marginTop: 8 }}>
                {errorMsg}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the screen renders**

Tap Extend Stay in the services list. Expect: navy header, loading state ("Loading booking…"), then error banner (until backend is built in Task 6 — that's expected). No emojis. No inline styles beyond the two minimal `style` props above.

- [ ] **Step 3: Commit**

```bash
git add portal/src/screens/ExtendStayScreen.jsx
git commit -m "refactor(portal): extend stay screen — CSS classes + member auth endpoints"
```

---

## Task 6: Backend — PortalMemberBookingView + PortalMemberExtendStayView

**Files:**
- Modify: `backend/apps/portal/services_views.py`
- Modify: `backend/apps/portal/tests/test_member_services.py`
- Modify: `backend/apps/portal/urls.py`
- Modify: `backend/apps/portal/tests/conftest.py`

- [ ] **Step 1: Add test fixtures to conftest.py**

Add `vessel_factory`, `berth_factory`, and `booking_factory` at the end of `backend/apps/portal/tests/conftest.py`:

```python
@pytest.fixture
def vessel_factory():
    from apps.vessels.models import Vessel

    _counter = [0]

    def _make(member, **kwargs):
        _counter[0] += 1
        n = _counter[0]
        defaults = {
            'marina': member.marina,
            'name': f'Test Vessel {n}',
            'owner': member,
        }
        defaults.update(kwargs)
        return Vessel.objects.create(**defaults)

    return _make


@pytest.fixture
def berth_factory():
    from apps.berths.models import Berth

    _counter = [0]

    def _make(marina, **kwargs):
        _counter[0] += 1
        n = _counter[0]
        defaults = {
            'marina': marina,
            'code': f'B{n}',
        }
        defaults.update(kwargs)
        return Berth.objects.create(**defaults)

    return _make


@pytest.fixture
def booking_factory(vessel_factory, berth_factory):
    from apps.reservations.models import Booking
    import datetime as _dt

    def _make(member, **kwargs):
        vessel = kwargs.pop('vessel', vessel_factory(member))
        berth  = kwargs.pop('berth', berth_factory(member.marina))
        today  = _dt.date.today()
        defaults = {
            'marina':    member.marina,
            'vessel':    vessel,
            'berth':     berth,
            'check_in':  today - _dt.timedelta(days=2),
            'check_out': today + _dt.timedelta(days=5),
            'status':    'checked_in',
        }
        defaults.update(kwargs)
        return Booking.objects.create(**defaults)

    return _make
```

- [ ] **Step 2: Write failing extend stay tests**

Append to `backend/apps/portal/tests/test_member_services.py`:

```python
# ── Extend Stay ────────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_booking_view_returns_current_booking(member_factory, booking_factory):
    member = member_factory()
    booking_factory(member)
    resp = Client().get(
        '/api/v1/portal/member/booking/',
        **_auth_headers(member),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert 'check_out' in data
    assert 'berth_id' in data


@pytest.mark.django_db
def test_booking_view_404_when_no_booking(member_factory):
    member = member_factory()
    resp = Client().get(
        '/api/v1/portal/member/booking/',
        **_auth_headers(member),
    )
    assert resp.status_code == 404


@pytest.mark.django_db
def test_extend_stay_check_available(member_factory, booking_factory):
    member = member_factory()
    booking = booking_factory(member)
    new_check_out = (booking.check_out + __import__('datetime').timedelta(days=3)).isoformat()
    resp = Client().get(
        f'/api/v1/portal/member/extend-stay/?new_check_out={new_check_out}',
        **_auth_headers(member),
    )
    assert resp.status_code == 200
    assert resp.json()['available'] is True


@pytest.mark.django_db
def test_extend_stay_check_unavailable(member_factory, booking_factory):
    import datetime as _dt
    member = member_factory()
    booking = booking_factory(member)
    new_check_out = (booking.check_out + _dt.timedelta(days=3)).isoformat()
    # Create a conflicting booking on the same berth
    member2 = member_factory.__wrapped__(marina=member.marina) if hasattr(member_factory, '__wrapped__') else None
    from apps.reservations.models import Booking as B
    B.objects.create(
        marina=member.marina,
        berth=booking.berth,
        check_in=booking.check_out,
        check_out=new_check_out,
        status='confirmed',
    )
    resp = Client().get(
        f'/api/v1/portal/member/extend-stay/?new_check_out={new_check_out}',
        **_auth_headers(member),
    )
    assert resp.status_code == 200
    assert resp.json()['available'] is False


@pytest.mark.django_db
def test_extend_stay_post_creates_booking(member_factory, booking_factory):
    import datetime as _dt
    member = member_factory()
    booking = booking_factory(member)
    new_check_out = (booking.check_out + _dt.timedelta(days=3)).isoformat()
    resp = Client().post(
        '/api/v1/portal/member/extend-stay/',
        {'new_check_out': new_check_out},
        content_type='application/json',
        **_auth_headers(member),
    )
    assert resp.status_code == 201
    assert 'id' in resp.json()


@pytest.mark.django_db
def test_extend_stay_post_409_on_conflict(member_factory, booking_factory):
    import datetime as _dt
    member = member_factory()
    booking = booking_factory(member)
    new_check_out = (booking.check_out + _dt.timedelta(days=3)).isoformat()
    from apps.reservations.models import Booking as B
    B.objects.create(
        marina=member.marina,
        berth=booking.berth,
        check_in=booking.check_out,
        check_out=new_check_out,
        status='confirmed',
    )
    resp = Client().post(
        '/api/v1/portal/member/extend-stay/',
        {'new_check_out': new_check_out},
        content_type='application/json',
        **_auth_headers(member),
    )
    assert resp.status_code == 409
```

- [ ] **Step 3: Run tests to verify they fail**

```
cd backend && python -m pytest apps/portal/tests/test_member_services.py::test_booking_view_returns_current_booking -v
```

Expected: FAIL (endpoint does not exist).

- [ ] **Step 4: Add PortalMemberBookingView and PortalMemberExtendStayView to services_views.py**

Append to `backend/apps/portal/services_views.py` (after `PortalMemberCraneRequestView`):

```python
import datetime as dt


class PortalMemberBookingView(APIView):
    authentication_classes = [PortalMemberAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        member = _get_member(request)
        if member is None:
            return Response({'detail': 'Member not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        booking = (
            Booking.objects
            .filter(
                vessel__owner=member,
                marina=member.marina,
                status__in=['checked_in', 'pending', 'confirmed'],
            )
            .select_related('berth')
            .order_by('-check_in')
            .first()
        )
        if booking is None:
            return Response({'detail': 'No active booking found.'}, status=http_status.HTTP_404_NOT_FOUND)

        return Response({
            'id':         booking.id,
            'berth_id':   booking.berth_id,
            'berth_name': booking.berth.code if booking.berth else '',
            'check_in':   str(booking.check_in),
            'check_out':  str(booking.check_out),
        })


class PortalMemberExtendStayView(APIView):
    authentication_classes = [PortalMemberAuthentication]
    permission_classes = [IsAuthenticated]

    def _active_booking(self, member):
        return (
            Booking.objects
            .filter(
                vessel__owner=member,
                marina=member.marina,
                status__in=['checked_in', 'pending', 'confirmed'],
            )
            .select_related('berth', 'vessel')
            .order_by('-check_in')
            .first()
        )

    def _has_conflict(self, booking, new_check_out):
        return Booking.objects.filter(
            berth=booking.berth,
            status__in=['pending', 'confirmed', 'checked_in'],
            check_in__lt=new_check_out,
            check_out__gt=str(booking.check_out),
        ).exclude(id=booking.id).exists()

    def get(self, request):
        member = _get_member(request)
        if member is None:
            return Response({'detail': 'Member not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        booking = self._active_booking(member)
        if booking is None:
            return Response({'detail': 'No active booking found.'}, status=http_status.HTTP_404_NOT_FOUND)
        if booking.berth is None:
            return Response({'detail': 'No berth assigned.'}, status=http_status.HTTP_400_BAD_REQUEST)

        new_check_out = request.query_params.get('new_check_out', '')
        if not new_check_out:
            return Response({'detail': 'new_check_out is required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        return Response({'available': not self._has_conflict(booking, new_check_out)})

    def post(self, request):
        member = _get_member(request)
        if member is None:
            return Response({'detail': 'Member not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        booking = self._active_booking(member)
        if booking is None:
            return Response({'detail': 'No active booking found.'}, status=http_status.HTTP_404_NOT_FOUND)
        if booking.berth is None:
            return Response({'detail': 'No berth assigned.'}, status=http_status.HTTP_400_BAD_REQUEST)

        new_check_out = request.data.get('new_check_out', '')
        if not new_check_out:
            return Response({'detail': 'new_check_out is required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        try:
            check_out_date = dt.date.fromisoformat(new_check_out)
        except ValueError:
            return Response({'detail': 'Invalid date format.'}, status=http_status.HTTP_400_BAD_REQUEST)

        if self._has_conflict(booking, new_check_out):
            return Response(
                {'detail': 'Berth not available for these dates.'},
                status=http_status.HTTP_409_CONFLICT,
            )

        nights = (check_out_date - booking.check_out).days
        new_booking = Booking.objects.create(
            marina=member.marina,
            berth=booking.berth,
            vessel=booking.vessel,
            check_in=booking.check_out,
            check_out=new_check_out,
            nights=nights,
            status='pending',
            booking_source='portal_member',
        )
        return Response({'id': new_booking.id}, status=http_status.HTTP_201_CREATED)
```

- [ ] **Step 5: Register extend stay URLs**

In `backend/apps/portal/urls.py`, update the import and add the paths:

```python
from .services_views import (
    PortalMemberCraneRequestView,
    PortalMemberBookingView,
    PortalMemberExtendStayView,
)

# Add to urlpatterns:
path('portal/member/booking/',      PortalMemberBookingView.as_view(),     name='portal_member_booking'),
path('portal/member/extend-stay/',  PortalMemberExtendStayView.as_view(),  name='portal_member_extend_stay'),
```

- [ ] **Step 6: Run all service tests**

```
cd backend && python -m pytest apps/portal/tests/test_member_services.py -v
```

Expected: All tests pass (the conflict test creates a conflicting booking manually). If `test_extend_stay_check_unavailable` fails due to `member_factory.__wrapped__` access, simplify: instead of creating a second member, just create the conflicting booking directly as shown in the test code.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/portal/services_views.py \
        backend/apps/portal/tests/test_member_services.py \
        backend/apps/portal/tests/conftest.py \
        backend/apps/portal/urls.py
git commit -m "feat(portal): PortalMemberBookingView + PortalMemberExtendStayView"
```

---

## Task 7: ReportIssueScreen

**Files:**
- Create: `portal/src/screens/ReportIssueScreen.jsx`

- [ ] **Step 1: Create ReportIssueScreen.jsx**

```jsx
// portal/src/screens/ReportIssueScreen.jsx
import { useState } from 'react';
import api from '../api';

function ArrowLeftIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function CheckCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

const CATEGORIES = [
  { value: 'berth',    label: 'Berth / Pontoon' },
  { value: 'facility', label: 'Facility (shower, toilet, electricity)' },
  { value: 'vessel',   label: 'Vessel Issue' },
  { value: 'other',    label: 'Other' },
];

export default function ReportIssueScreen({ onBack }) {
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('idle'); // 'idle' | 'submitting' | 'success' | 'error'
  const [ref, setRef] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    if (!category || !description.trim()) return;
    setStatus('submitting');
    setErrorMsg('');
    try {
      const res = await api.post('/portal/member/issues/', {
        category,
        description: description.trim(),
      });
      setRef(res.data.ref ?? '');
      setStatus('success');
    } catch (err) {
      setErrorMsg(err?.response?.data?.detail || 'Something went wrong. Please try again.');
      setStatus('error');
    }
  }

  return (
    <div className="p-subscreen">
      <div className="p-subscreen__header">
        <button className="p-subscreen__back" onClick={onBack} aria-label="Back">
          <ArrowLeftIcon />
        </button>
        <div>
          <div className="p-subscreen__title">Report an Issue</div>
          <div className="p-subscreen__subtitle">Let the harbour team know about a problem</div>
        </div>
      </div>

      <div className="p-subscreen__body">
        {status === 'success' ? (
          <div className="p-form-card p-success-card">
            <div className="p-success-card__icon"><CheckCircleIcon /></div>
            <div className="p-success-card__title">Issue reported</div>
            <div className="p-success-card__body">
              The harbour team has been notified and will be in touch.
            </div>
            {ref && <div className="p-success-card__ref">Reference: {ref}</div>}
            <button
              className="p-btn p-btn--outline"
              style={{ marginTop: 20 }}
              onClick={onBack}
            >
              Back to Services
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="p-form-card">
              <label className="p-form-label" htmlFor="issue-category">Category</label>
              <select
                id="issue-category"
                className="p-input"
                value={category}
                onChange={e => setCategory(e.target.value)}
                required
              >
                <option value="">Select a category…</option>
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div className="p-form-card">
              <label className="p-form-label" htmlFor="issue-desc">Description</label>
              <textarea
                id="issue-desc"
                className="p-input"
                style={{ minHeight: 120, resize: 'vertical' }}
                placeholder="Describe the problem…"
                value={description}
                onChange={e => setDescription(e.target.value)}
                required
              />
            </div>

            {status === 'error' && errorMsg && (
              <div className="p-banner p-banner--error">{errorMsg}</div>
            )}

            <button
              type="submit"
              className="p-btn p-btn--primary"
              disabled={!category || !description.trim() || status === 'submitting'}
            >
              {status === 'submitting' ? 'Submitting…' : 'Submit report'}
            </button>
            <button
              type="button"
              className="p-btn p-btn--outline"
              style={{ marginTop: 8 }}
              onClick={onBack}
            >
              Cancel
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the screen renders**

Tap Report an Issue in the services list. Expect: navy header with back arrow, category select dropdown (with native select arrow visible — CSS fix in Task 1 restores it for `select.p-input`), description textarea, Submit and Cancel buttons.

- [ ] **Step 3: Commit**

```bash
git add portal/src/screens/ReportIssueScreen.jsx
git commit -m "feat(portal): report issue screen"
```

---

## Task 8: Backend — PortalMemberIssueView

**Files:**
- Modify: `backend/apps/portal/services_views.py`
- Modify: `backend/apps/portal/tests/test_member_services.py`
- Modify: `backend/apps/portal/urls.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/apps/portal/tests/test_member_services.py`:

```python
# ── Report Issue ───────────────────────────────────────────────────────────

@pytest.mark.django_db
def test_issue_requires_auth():
    resp = Client().post(
        '/api/v1/portal/member/issues/',
        {},
        content_type='application/json',
    )
    assert resp.status_code in (401, 403)


@pytest.mark.django_db
def test_issue_creates_work_order(member_factory):
    member = member_factory()
    resp = Client().post(
        '/api/v1/portal/member/issues/',
        {'category': 'berth', 'description': 'Cleat is broken.'},
        content_type='application/json',
        **_auth_headers(member),
    )
    assert resp.status_code == 201
    data = resp.json()
    assert data['ref'].startswith('WO-')


@pytest.mark.django_db
def test_issue_rejects_invalid_category(member_factory):
    member = member_factory()
    resp = Client().post(
        '/api/v1/portal/member/issues/',
        {'category': 'not_a_category', 'description': 'Something broke.'},
        content_type='application/json',
        **_auth_headers(member),
    )
    assert resp.status_code == 400


@pytest.mark.django_db
def test_issue_rejects_empty_description(member_factory):
    member = member_factory()
    resp = Client().post(
        '/api/v1/portal/member/issues/',
        {'category': 'facility', 'description': '   '},
        content_type='application/json',
        **_auth_headers(member),
    )
    assert resp.status_code == 400
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd backend && python -m pytest apps/portal/tests/test_member_services.py::test_issue_creates_work_order -v
```

Expected: FAIL (endpoint does not exist).

- [ ] **Step 3: Add PortalMemberIssueView to services_views.py**

Append to `backend/apps/portal/services_views.py`:

```python
class PortalMemberIssueView(APIView):
    authentication_classes = [PortalMemberAuthentication]
    permission_classes = [IsAuthenticated]

    VALID_CATEGORIES = {'berth', 'facility', 'vessel', 'other'}
    CATEGORY_TITLES = {
        'berth':    'Berth / Pontoon issue reported by member',
        'facility': 'Facility issue reported by member',
        'vessel':   'Vessel issue reported by member',
        'other':    'Issue reported by member',
    }

    def post(self, request):
        member = _get_member(request)
        if member is None:
            return Response({'detail': 'Member not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        category = request.data.get('category', '')
        description = request.data.get('description', '').strip()

        if category not in self.VALID_CATEGORIES:
            return Response({'detail': 'Invalid category.'}, status=http_status.HTTP_400_BAD_REQUEST)
        if not description:
            return Response({'detail': 'description is required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        work_order = WorkOrder.objects.create(
            marina=member.marina,
            title=self.CATEGORY_TITLES[category],
            category=category,
            description=description,
            status='pending_auth',
        )
        return Response({'ref': f'WO-{work_order.id}'}, status=http_status.HTTP_201_CREATED)
```

- [ ] **Step 4: Register the URL**

In `backend/apps/portal/urls.py`, update the import and add the path:

```python
from .services_views import (
    PortalMemberCraneRequestView,
    PortalMemberBookingView,
    PortalMemberExtendStayView,
    PortalMemberIssueView,
)

# Add to urlpatterns:
path('portal/member/issues/', PortalMemberIssueView.as_view(), name='portal_member_issues'),
```

Final `urlpatterns` member section:

```python
    # Member service endpoints (PortalMemberAuthentication)
    path('portal/member/crane-requests/', PortalMemberCraneRequestView.as_view(), name='portal_member_crane_requests'),
    path('portal/member/booking/',        PortalMemberBookingView.as_view(),       name='portal_member_booking'),
    path('portal/member/extend-stay/',    PortalMemberExtendStayView.as_view(),    name='portal_member_extend_stay'),
    path('portal/member/issues/',         PortalMemberIssueView.as_view(),         name='portal_member_issues'),
```

- [ ] **Step 5: Run full test suite**

```
cd backend && python -m pytest apps/portal/tests/test_member_services.py -v
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/portal/services_views.py \
        backend/apps/portal/tests/test_member_services.py \
        backend/apps/portal/urls.py
git commit -m "feat(portal): PortalMemberIssueView — creates WorkOrder from member report"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] ServicesTab with list navigation — Task 2
- [x] CraneRequestScreen redesigned (no emojis, CSS classes) — Task 3
- [x] Crane backend uses PortalMemberAuthentication — Task 4
- [x] ExtendStayScreen redesigned, loads booking from API — Task 5
- [x] Berth-specific availability check (not public berths endpoint) — Task 6
- [x] Extension creates new Booking, 409 on conflict — Task 6
- [x] ReportIssueScreen with category + description — Task 7
- [x] Issue backend creates WorkOrder, returns WO reference — Task 8
- [x] Stub rows for future services — Task 2
- [x] All new backends use PortalMemberAuthentication, not IsBoater — Tasks 4, 6, 8

**Placeholder scan:** None found. All steps contain actual code.

**Type consistency:**
- `_get_member(request)` used in all views consistently
- `requested_date` in both CraneRequestScreen and PortalMemberCraneRequestView
- `new_check_out` in both ExtendStayScreen and PortalMemberExtendStayView
- `ref` in both ReportIssueScreen and PortalMemberIssueView response
