# Boater Portal Redesign — Plan 2: Home Tab

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Home Tab end-to-end: fix AppShell to hide the nav for guests, redesign the guest checkin flow (remove emojis, apply design system), build the `HomeTab` component that routes guest vs. member, add the backend `GET /portal/feed/` endpoint, and build the member home screen (compact header + QuickActions + DynamicFeed with card components).

**Architecture:** `HomeTab` is the single entry point. It reads `capabilities.isGuest` from `UserContext` to decide what to render. Guests see the existing checkin state machine (checklist → countdown → arrival → boarding pass) fullscreen without a bottom nav. Members see a compact navy header, a pinned QuickActions row, and a `DynamicFeed` that fetches `ActionableItem[]` from the backend. The feed is purely priority-sorted by the backend — no client-side sort. `BookingDashboard.jsx` is retired (its logic moves into `HomeTab`).

**Tech Stack:** Django REST Framework, React 18, CSS custom properties (portal.css), no Tailwind

---

## File Map

### Backend — new files
```
backend/apps/portal/feed_views.py        ← GET /portal/feed/ → ActionableItem[]
backend/apps/portal/tests/test_feed.py   ← feed endpoint tests
```

### Backend — modified
```
backend/apps/portal/urls.py              ← add feed URL
```

### Frontend — new files
```
portal/src/components/feed/QuickActions.jsx
portal/src/components/feed/DynamicFeed.jsx
portal/src/components/feed/cards/InvoiceCard.jsx
portal/src/components/feed/cards/VesselStatusCard.jsx
portal/src/components/feed/cards/InsuranceCard.jsx
```

### Frontend — modified files
```
portal/src/components/shell/AppShell.jsx                  ← hide nav for guests
portal/src/components/portal/ChecklistView.jsx            ← replace ✅/⬜ with SVGs
portal/src/components/portal/checklist/InsuranceItem.jsx  ← replace 📎 with SVG
portal/src/components/portal/checklist/WaiverItem.jsx     ← replace 📝 with SVG
portal/src/screens/tabs/HomeTab.jsx                       ← full impl (replaces stub)
portal/src/styles/portal.css                              ← new checkin + feed classes
```

### Frontend — retired
```
portal/src/screens/BookingDashboard.jsx  ← logic absorbed into HomeTab; delete file
```

---

## Task 1: Fix AppShell — hide bottom nav for guest sessions

Guests see the full-screen checkin flow. They must NOT see the bottom nav or the `padding-bottom` that clears it. `AppShell` currently renders nav for all users.

**Files:**
- Modify: `portal/src/components/shell/AppShell.jsx`

- [ ] **Step 1: Update AppShell to read capabilities**

Replace the full content of `portal/src/components/shell/AppShell.jsx`:

```jsx
// portal/src/components/shell/AppShell.jsx
import { useState } from 'react';
import { useUserContext } from '../../context/UserContext';
import BottomNav   from './BottomNav';
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
  const { capabilities } = useUserContext();
  const TabComponent = TAB_COMPONENTS[activeTab] || HomeTab;

  // Guests see the full-screen checkin flow — no shell chrome
  if (capabilities.isGuest) {
    return <HomeTab />;
  }

  return (
    <div className="p-shell">
      <TabComponent />
      <BottomNav activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/components/shell/AppShell.jsx
git commit -m "fix(portal): hide bottom nav for guest sessions in AppShell"
```

---

## Task 2: Add CSS classes for checkin redesign

Append new classes to `portal/src/styles/portal.css` for the redesigned checkin components and feed. Do NOT remove any existing classes.

**Files:**
- Modify: `portal/src/styles/portal.css`

- [ ] **Step 1: Append to portal.css**

Add the following block at the very end of `portal/src/styles/portal.css`:

```css
/* ============================================================
   PORTAL REDESIGN — Checkin components & Home Tab
   ============================================================ */

/* --- Checkin hero header --- */
.p-hero {
  background: var(--navy);
  padding: 20px 20px 16px;
  color: var(--cream);
}

.p-hero__title {
  font-family: 'Jost', sans-serif;
  font-size: 20px;
  font-weight: 700;
  color: var(--cream);
  margin: 0 0 4px;
}

.p-hero__subtitle {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 13px;
  color: rgba(245,240,230,0.6);
  margin: 0;
}

/* --- Check item (checklist row) --- */
.p-check-item {
  background: #fff;
  border-radius: 12px;
  padding: 16px;
  margin-bottom: 12px;
  box-shadow: var(--shadow);
}

.p-check-item__header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 0;
}

.p-check-item__header--open {
  margin-bottom: 16px;
}

.p-check-item__icon {
  width: 22px;
  height: 22px;
  flex-shrink: 0;
}

.p-check-item__icon--done {
  color: var(--green);
}

.p-check-item__icon--pending {
  color: rgba(0,0,0,0.25);
}

.p-check-item__label {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 15px;
  font-weight: 700;
  color: var(--text);
}

/* --- Countdown card --- */
.p-countdown-number {
  font-family: 'Cormorant Garamond', serif;
  font-size: 72px;
  font-weight: 700;
  color: var(--navy);
  line-height: 1;
}

/* --- Arrival button pulse --- */
@keyframes p-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.9; transform: scale(0.99); }
}

.p-arrive-btn {
  display: block;
  width: 100%;
  max-width: 400px;
  height: 80px;
  border-radius: 16px;
  background: var(--navy);
  color: var(--cream);
  border: none;
  font-family: 'Jost', sans-serif;
  font-size: 17px;
  font-weight: 700;
  letter-spacing: 0.3px;
  cursor: pointer;
  animation: p-pulse 2s ease-in-out infinite;
}

.p-arrive-btn:disabled {
  background: rgba(0,0,0,0.25);
  animation: none;
  cursor: wait;
}

/* --- Member home header --- */
.p-member-header {
  background: var(--navy);
  height: 56px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.p-member-header__marina {
  font-family: 'Jost', sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: var(--cream);
}

.p-member-header__name {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 13px;
  color: rgba(245,240,230,0.55);
}

/* --- Quick actions row --- */
.p-quick-actions {
  display: flex;
  gap: 12px;
  padding: 12px 16px;
  background: var(--bg);
}

.p-quick-btn {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 12px 6px;
  background: #fff;
  border: none;
  border-radius: 12px;
  box-shadow: var(--shadow);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.p-quick-btn svg {
  width: 20px;
  height: 20px;
  stroke: var(--navy);
  fill: none;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.p-quick-btn__label {
  font-family: 'Jost', sans-serif;
  font-size: 9px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text);
  text-align: center;
}

.p-quick-btn--disabled svg {
  stroke: rgba(0,0,0,0.2);
}

.p-quick-btn--disabled .p-quick-btn__label {
  color: rgba(0,0,0,0.25);
}

/* --- Feed --- */
.p-feed {
  padding: 4px 16px 32px;
  display: flex;
  flex-direction: column;
  gap: 0;
}

.p-feed__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  color: var(--muted);
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 14px;
  text-align: center;
}

/* --- Feed cards --- */
.p-feed-card {
  background: #fff;
  border-radius: 12px;
  box-shadow: var(--shadow);
  padding: 14px 16px;
  margin-bottom: 10px;
  border-left: 4px solid transparent;
}

.p-feed-card--red    { border-left-color: var(--red); }
.p-feed-card--orange { border-left-color: var(--orange); }
.p-feed-card--navy   { border-left-color: var(--navy); }
.p-feed-card--gold   { border-left-color: var(--gold); }
.p-feed-card--green  { border-left-color: var(--green); }

.p-feed-card__eyebrow {
  font-family: 'Jost', sans-serif;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--muted);
  margin: 0 0 4px;
}

.p-feed-card__title {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  margin: 0 0 2px;
}

.p-feed-card__sub {
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 13px;
  color: var(--muted);
  margin: 0 0 12px;
}

.p-feed-card__amount {
  font-family: 'Cormorant Garamond', serif;
  font-size: 26px;
  font-weight: 700;
  color: var(--text);
  margin: 0 0 12px;
}

/* --- Toast --- */
.p-toast {
  position: fixed;
  bottom: calc(72px + env(safe-area-inset-bottom));
  left: 50%;
  transform: translateX(-50%);
  background: var(--navy);
  color: var(--cream);
  font-family: 'IBM Plex Sans', sans-serif;
  font-size: 13px;
  padding: 8px 16px;
  border-radius: 20px;
  z-index: 200;
  pointer-events: none;
  white-space: nowrap;
}
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/styles/portal.css
git commit -m "feat(portal): CSS classes for checkin redesign and home feed"
```

---

## Task 3: Redesign checkin components — remove emojis, apply CSS classes

Replace inline styles and emojis across all four components. Keep all logic unchanged — only presentation changes.

**Files:**
- Modify: `portal/src/components/portal/ChecklistView.jsx`
- Modify: `portal/src/components/portal/checklist/InsuranceItem.jsx`
- Modify: `portal/src/components/portal/checklist/WaiverItem.jsx`

- [ ] **Step 1: Rewrite ChecklistView.jsx**

Replace the full file content:

```jsx
// portal/src/components/portal/ChecklistView.jsx
import DimensionsForm from './checklist/DimensionsForm';
import WaiverItem     from './checklist/WaiverItem';
import InsuranceItem  from './checklist/InsuranceItem';

function CheckIcon({ done }) {
  if (done) {
    return (
      <svg className="p-check-item__icon p-check-item__icon--done" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>
        <polyline points="22 4 12 14.01 9 11.01"/>
      </svg>
    );
  }
  return (
    <svg className="p-check-item__icon p-check-item__icon--pending" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="3"/>
    </svg>
  );
}

function CheckItem({ label, done, children }) {
  return (
    <div className="p-check-item">
      <div className={`p-check-item__header${done ? '' : ' p-check-item__header--open'}`}>
        <CheckIcon done={done} />
        <span className="p-check-item__label">{label}</span>
      </div>
      {!done && children}
    </div>
  );
}

export default function ChecklistView({ booking, onUpdate }) {
  const dimsDone   = booking.boat_loa != null && booking.boat_beam != null && booking.boat_draft != null;
  const waiverDone = booking.waiver_signed;

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <div className="p-hero">
        <div className="p-hero__title">Pre-Arrival Checklist</div>
        <div className="p-hero__subtitle">Complete all required steps before arrival</div>
      </div>
      <div style={{ padding: '16px 16px 40px' }}>
        <CheckItem label="Vessel Dimensions" done={dimsDone}>
          <DimensionsForm booking={booking} onUpdate={onUpdate} />
        </CheckItem>
        <CheckItem label="Marina Waiver" done={waiverDone}>
          <WaiverItem booking={booking} onUpdate={onUpdate} />
        </CheckItem>
        <CheckItem label="Insurance Document (optional)" done={!!booking.insurance_doc}>
          <InsuranceItem booking={booking} onUpdate={onUpdate} />
        </CheckItem>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite InsuranceItem.jsx**

Replace the full file content:

```jsx
// portal/src/components/portal/checklist/InsuranceItem.jsx
import { useState } from 'react';
import api from '../../../api';

export default function InsuranceItem({ booking, onUpdate }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState(null);

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true); setError(null);
    const form = new FormData();
    form.append('file', file);
    try {
      await api.post(`/portal/checkin/bookings/${booking.id}/insurance/`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onUpdate();
    } catch {
      setError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 14, lineHeight: 1.6 }}>
        Optional: upload a copy of your vessel insurance certificate.
      </p>
      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <label className="p-btn p-btn--ghost" style={{ display: 'block', textAlign: 'center', lineHeight: '44px', cursor: uploading ? 'wait' : 'pointer' }}>
        <svg style={{ width: 14, height: 14, verticalAlign: 'middle', marginRight: 6, stroke: 'currentColor', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }} viewBox="0 0 24 24">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/>
        </svg>
        {uploading ? 'Uploading…' : 'Upload Insurance Certificate'}
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={handleFile} disabled={uploading} />
      </label>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite WaiverItem.jsx**

Replace the full file content:

```jsx
// portal/src/components/portal/checklist/WaiverItem.jsx
import { useState } from 'react';
import api from '../../../api';

export default function WaiverItem({ booking, onUpdate }) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  async function handleSign() {
    setLoading(true); setError(null);
    try {
      const res = await api.post(`/portal/checkin/bookings/${booking.id}/waiver/`);
      window.open(res.data.sign_url, '_blank', 'noopener,noreferrer');
      setTimeout(onUpdate, 3000);
    } catch {
      setError('Could not load the waiver. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 14, lineHeight: 1.6 }}>
        The marina requires a signed waiver before arrival. Tap below to open the waiver in a new tab. Return here once you have signed.
      </p>
      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 10 }}>{error}</p>}
      <button className="p-btn p-btn--primary" disabled={loading} onClick={handleSign}>
        <svg style={{ width: 14, height: 14, verticalAlign: 'middle', marginRight: 6, stroke: 'currentColor', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }} viewBox="0 0 24 24">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
        {loading ? 'Loading waiver…' : 'Sign Waiver'}
      </button>
      <button
        style={{ display: 'block', width: '100%', marginTop: 10, height: 44, background: 'transparent', border: 'none', fontSize: 14, color: 'rgba(0,0,0,0.4)', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}
        onClick={onUpdate}
      >
        I've already signed — refresh
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add portal/src/components/portal/ChecklistView.jsx \
        portal/src/components/portal/checklist/InsuranceItem.jsx \
        portal/src/components/portal/checklist/WaiverItem.jsx
git commit -m "feat(portal): redesign checkin components — replace emojis with SVGs, apply CSS classes"
```

---

## Task 4: HomeTab.jsx — full guest checkin implementation

Replace the stub `HomeTab.jsx` with a full implementation that absorbs `BookingDashboard`'s logic. Then delete `BookingDashboard.jsx`.

**Files:**
- Modify: `portal/src/screens/tabs/HomeTab.jsx`
- Delete: `portal/src/screens/BookingDashboard.jsx`

- [ ] **Step 1: Replace HomeTab.jsx**

```jsx
// portal/src/screens/tabs/HomeTab.jsx
import { useState, useEffect } from 'react';
import api from '../../api';
import { useUserContext } from '../../context/UserContext';
import { deriveState } from '../../utils/deriveState';
import ChecklistView from '../../components/portal/ChecklistView';
import CountdownView from '../../components/portal/CountdownView';
import ArrivalView   from '../../components/portal/ArrivalView';
import WalletCard    from '../../components/portal/WalletCard';
import InstallBanner from '../../components/portal/InstallBanner';
import ExtendStayScreen  from '../ExtendStayScreen';
import CraneRequestScreen from '../CraneRequestScreen';
import MemberHomeScreen from './MemberHomeScreen';

// --- Guest checkin flow ---

function GuestCheckinFlow() {
  const bookingId = localStorage.getItem('portal_booking_id');
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [subScreen, setSubScreen] = useState(null);

  function reload() {
    if (!bookingId) {
      setError('No booking session found.');
      setLoading(false);
      return;
    }
    api.get(`/portal/checkin/bookings/${bookingId}/`)
      .then(r => setBooking(r.data))
      .catch(() => setError('Could not load your booking. Please use the link from your email.'))
      .finally(() => setLoading(false));
  }

  useEffect(reload, [bookingId]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 15, fontFamily: 'IBM Plex Sans, sans-serif' }}>Loading your booking…</div>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)' }}>
        <div style={{ textAlign: 'center', padding: 32 }}>
          <svg style={{ width: 48, height: 48, marginBottom: 16, stroke: 'rgba(0,0,0,0.2)', fill: 'none', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }} viewBox="0 0 24 24">
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 11a1 1 0 01-1-1V7a1 1 0 012 0v5a1 1 0 01-1 1zm0 3a1 1 0 110 2 1 1 0 010-2z"/>
          </svg>
          <div style={{ fontSize: 15, color: 'rgba(0,0,0,0.5)', fontFamily: 'IBM Plex Sans, sans-serif' }}>{error || 'Booking not found.'}</div>
        </div>
      </div>
    );
  }

  if (subScreen === 'extend-stay') {
    return <ExtendStayScreen booking={booking} onBack={() => setSubScreen(null)} />;
  }
  if (subScreen === 'crane-request') {
    return <CraneRequestScreen booking={booking} onBack={() => setSubScreen(null)} />;
  }

  const state = deriveState(booking);

  return (
    <>
      {state === 'wallet' && (
        <>
          <WalletCard booking={booking} />
          <div style={{ padding: '0 16px 32px' }}>
            <button className="p-btn p-btn--outline" style={{ marginBottom: 10 }} onClick={() => setSubScreen('extend-stay')}>
              Extend stay
            </button>
            <button className="p-btn p-btn--outline" onClick={() => setSubScreen('crane-request')}>
              Request crane / lift
            </button>
          </div>
        </>
      )}
      {state === 'arrival'   && <ArrivalView booking={booking} onCheckedIn={reload} />}
      {state === 'countdown' && <CountdownView booking={booking} />}
      {state === 'checklist' && (
        <>
          <ChecklistView booking={booking} onUpdate={reload} />
          <div style={{ padding: '0 16px 32px' }}>
            <button className="p-btn p-btn--outline" onClick={() => setSubScreen('crane-request')}>
              Request crane / lift
            </button>
          </div>
        </>
      )}
      <InstallBanner />
    </>
  );
}

// --- Main HomeTab ---

export default function HomeTab() {
  const { capabilities } = useUserContext();
  if (capabilities.isGuest) return <GuestCheckinFlow />;
  return <MemberHomeScreen />;
}
```

Note: `MemberHomeScreen` is imported from `./MemberHomeScreen` — create that file as a stub for now:

```jsx
// portal/src/screens/tabs/MemberHomeScreen.jsx
export default function MemberHomeScreen() {
  return <div className="p-tab-stub">Member home — coming in Tasks 6–8</div>;
}
```

- [ ] **Step 2: Delete BookingDashboard.jsx**

```bash
git rm portal/src/screens/BookingDashboard.jsx
```

- [ ] **Step 3: Commit**

```bash
git add portal/src/screens/tabs/HomeTab.jsx portal/src/screens/tabs/MemberHomeScreen.jsx
git commit -m "feat(portal): HomeTab — guest checkin flow, retire BookingDashboard"
```

---

## Task 5: Backend DynamicFeed endpoint

**Files:**
- Create: `backend/apps/portal/feed_views.py`
- Create: `backend/apps/portal/tests/test_feed.py`
- Modify: `backend/apps/portal/urls.py`

- [ ] **Step 1: Write failing tests**

```python
# backend/apps/portal/tests/test_feed.py
import pytest
from django.test import Client
from apps.portal.member_auth_utils import make_member_session_token


@pytest.mark.django_db
def test_feed_requires_auth():
    client = Client()
    resp = client.get('/api/v1/portal/feed/')
    assert resp.status_code in (401, 403)


@pytest.mark.django_db
def test_feed_returns_list(member_factory):
    member = member_factory()
    token = make_member_session_token(
        member_id=member.id, marina_slug=member.marina.slug, email=member.email
    )
    client = Client()
    resp = client.get(
        '/api/v1/portal/feed/',
        HTTP_AUTHORIZATION=f'MemberBearer {token}',
        HTTP_X_MARINA_SLUG=member.marina.slug,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert isinstance(data, list)


@pytest.mark.django_db
def test_feed_includes_overdue_invoice(member_factory, invoice_factory):
    import datetime
    member = member_factory()
    invoice_factory(
        member=member,
        marina=member.marina,
        status='unpaid',
        due_date=datetime.date.today() - datetime.timedelta(days=5),
    )
    token = make_member_session_token(
        member_id=member.id, marina_slug=member.marina.slug, email=member.email
    )
    client = Client()
    resp = client.get(
        '/api/v1/portal/feed/',
        HTTP_AUTHORIZATION=f'MemberBearer {token}',
        HTTP_X_MARINA_SLUG=member.marina.slug,
    )
    data = resp.json()
    types = [item['type'] for item in data]
    assert 'invoice_overdue' in types


@pytest.mark.django_db
def test_feed_sorted_by_priority(member_factory, invoice_factory):
    """Overdue invoices (priority 10) must appear before vessel status (priority 20)."""
    import datetime
    member = member_factory()
    invoice_factory(
        member=member,
        marina=member.marina,
        status='unpaid',
        due_date=datetime.date.today() - datetime.timedelta(days=1),
    )
    token = make_member_session_token(
        member_id=member.id, marina_slug=member.marina.slug, email=member.email
    )
    client = Client()
    resp = client.get(
        '/api/v1/portal/feed/',
        HTTP_AUTHORIZATION=f'MemberBearer {token}',
        HTTP_X_MARINA_SLUG=member.marina.slug,
    )
    data = resp.json()
    priorities = [item['priority'] for item in data]
    assert priorities == sorted(priorities)
```

Add `invoice_factory` fixture to `backend/apps/portal/tests/conftest.py`:

```python
# Append to backend/apps/portal/tests/conftest.py
import datetime as _dt

@pytest.fixture
def invoice_factory():
    from apps.billing.models import Invoice

    def make(member, marina, status='unpaid', due_date=None, total='100.00'):
        return Invoice.objects.create(
            member=member,
            marina=marina,
            status=status,
            due_date=due_date or (_dt.date.today() + _dt.timedelta(days=30)),
            total=total,
            subtotal=total,
            tax_total='0.00',
        )
    return make
```

- [ ] **Step 2: Run to verify they fail**

```
cd backend && pytest apps/portal/tests/test_feed.py -v
```
Expected: test_feed_requires_auth and test_feed_returns_list fail (URL not wired).

- [ ] **Step 3: Create feed_views.py**

```python
# backend/apps/portal/feed_views.py
import datetime
import logging

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.billing.models import Invoice
from apps.members.models import Member
from apps.vessels.models import Vessel
from .member_auth import PortalMemberAuthentication

_log = logging.getLogger(__name__)


def _build_items(member):
    """Return a list of ActionableItem dicts, unsorted."""
    today = datetime.date.today()
    items = []

    # --- Overdue / open invoices ---
    invoices = Invoice.objects.filter(
        member=member,
        marina=member.marina,
        status__in=['unpaid', 'open'],
    ).order_by('due_date')

    for inv in invoices:
        is_overdue = inv.due_date and inv.due_date < today
        items.append({
            'type':     'invoice_overdue' if is_overdue else 'invoice_open',
            'priority': 10 if is_overdue else 15,
            'id':       inv.id,
            'label':    f'Invoice #{inv.invoice_number or inv.id}',
            'amount':   str(inv.total),
            'due_date': str(inv.due_date) if inv.due_date else None,
            'overdue':  is_overdue,
        })

    # --- Vessel status (always shown if vessel on file) ---
    vessel = Vessel.objects.filter(owner=member, marina=member.marina).first()
    if vessel:
        items.append({
            'type':     'vessel_status',
            'priority': 20,
            'id':       vessel.id,
            'label':    vessel.name or 'Your vessel',
            'loa':      str(vessel.loa) if vessel.loa else None,
            'beam':     str(vessel.beam) if vessel.beam else None,
        })

    # --- Insurance alert (if member.insurance_status is warning) ---
    if member.insurance_status in ('due_soon', 'expired', 'missing'):
        items.append({
            'type':     'insurance_alert',
            'priority': 10 if member.insurance_status in ('expired', 'missing') else 15,
            'label':    'Insurance',
            'status':   member.insurance_status,
        })

    return items


class FeedView(APIView):
    authentication_classes = [PortalMemberAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        try:
            member = Member.objects.select_related('marina').get(
                pk=request.user.member_id,
                marina__slug=request.user.marina_slug,
            )
        except Member.DoesNotExist:
            return Response({'detail': 'Member not found.'}, status=404)

        items = _build_items(member)
        items.sort(key=lambda x: x['priority'])
        return Response(items)
```

- [ ] **Step 4: Add URL**

In `backend/apps/portal/urls.py`, add the feed URL. First import:

```python
from .feed_views import FeedView
```

Then add to `urlpatterns`:

```python
path('portal/feed/', FeedView.as_view(), name='portal_feed'),
```

- [ ] **Step 5: Run tests**

```
cd backend && pytest apps/portal/tests/test_feed.py -v
```
Expected: all 4 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/portal/feed_views.py \
        backend/apps/portal/tests/test_feed.py \
        backend/apps/portal/tests/conftest.py \
        backend/apps/portal/urls.py
git commit -m "feat(portal): DynamicFeed endpoint GET /portal/feed/"
```

---

## Task 6: Feed card components

**Files:**
- Create: `portal/src/components/feed/cards/InvoiceCard.jsx`
- Create: `portal/src/components/feed/cards/VesselStatusCard.jsx`
- Create: `portal/src/components/feed/cards/InsuranceCard.jsx`

- [ ] **Step 1: Create InvoiceCard.jsx**

```jsx
// portal/src/components/feed/cards/InvoiceCard.jsx
import api from '../../../api';

function formatAmount(amount) {
  if (!amount) return '—';
  return `€${parseFloat(amount).toFixed(2)}`;
}

export default function InvoiceCard({ item }) {
  const isOverdue = item.overdue;
  const accent    = isOverdue ? 'red' : 'orange';

  async function handlePay() {
    // Navigate to wallet tab for payment — fire a custom event
    window.dispatchEvent(new CustomEvent('portal:navigate', { detail: { tab: 'wallet' } }));
  }

  return (
    <div className={`p-feed-card p-feed-card--${accent}`}>
      <p className="p-feed-card__eyebrow">{isOverdue ? 'Overdue' : 'Payment due'}</p>
      <p className="p-feed-card__title">{item.label}</p>
      {item.due_date && (
        <p className="p-feed-card__sub">Due {item.due_date}</p>
      )}
      <p className="p-feed-card__amount">{formatAmount(item.amount)}</p>
      <button className="p-btn p-btn--gold" onClick={handlePay}>
        Pay now
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create VesselStatusCard.jsx**

```jsx
// portal/src/components/feed/cards/VesselStatusCard.jsx
export default function VesselStatusCard({ item }) {
  return (
    <div className="p-feed-card p-feed-card--navy">
      <p className="p-feed-card__eyebrow">Your vessel</p>
      <p className="p-feed-card__title">{item.label}</p>
      {(item.loa || item.beam) && (
        <p className="p-feed-card__sub">
          {[item.loa && `LOA ${item.loa}m`, item.beam && `Beam ${item.beam}m`].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create InsuranceCard.jsx**

```jsx
// portal/src/components/feed/cards/InsuranceCard.jsx
const STATUS_COPY = {
  due_soon: { label: 'Due soon',   accent: 'orange', msg: 'Your insurance expires soon. Upload a new certificate.' },
  expired:  { label: 'Expired',    accent: 'red',    msg: 'Your insurance has expired. Please update your certificate.' },
  missing:  { label: 'Missing',    accent: 'red',    msg: 'No insurance certificate on file. Please upload one.' },
};

export default function InsuranceCard({ item }) {
  const cfg = STATUS_COPY[item.status] || STATUS_COPY['missing'];
  return (
    <div className={`p-feed-card p-feed-card--${cfg.accent}`}>
      <p className="p-feed-card__eyebrow">Insurance · {cfg.label}</p>
      <p className="p-feed-card__title">Vessel Insurance</p>
      <p className="p-feed-card__sub">{cfg.msg}</p>
      <button
        className="p-btn p-btn--outline"
        onClick={() => window.dispatchEvent(new CustomEvent('portal:navigate', { detail: { tab: 'account' } }))}
      >
        Update in Account
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add portal/src/components/feed/cards/
git commit -m "feat(portal): feed card components (InvoiceCard, VesselStatusCard, InsuranceCard)"
```

---

## Task 7: QuickActions component

**Files:**
- Create: `portal/src/components/feed/QuickActions.jsx`

- [ ] **Step 1: Create QuickActions.jsx**

```jsx
// portal/src/components/feed/QuickActions.jsx
import { useState } from 'react';

function QuickBtn({ label, icon, onTap, disabled }) {
  return (
    <button
      className={`p-quick-btn${disabled ? ' p-quick-btn--disabled' : ''}`}
      onClick={disabled ? undefined : onTap}
      aria-label={label}
    >
      {icon}
      <span className="p-quick-btn__label">{label}</span>
    </button>
  );
}

function Toast({ message }) {
  if (!message) return null;
  return <div className="p-toast">{message}</div>;
}

export default function QuickActions({ wallet }) {
  const [toast, setToast] = useState('');

  function copyTo(value, label) {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      setToast(`${label} copied`);
      setTimeout(() => setToast(''), 2000);
    });
  }

  const wifiPassword       = wallet?.wifi_password;
  const gateCode           = wallet?.gate_codes?.[0]?.pin;
  const harbourMasterPhone = wallet?.harbour_master_phone;

  return (
    <>
      <div className="p-quick-actions">
        <QuickBtn
          label="WiFi"
          disabled={!wifiPassword}
          onTap={() => copyTo(wifiPassword, 'WiFi password')}
          icon={
            <svg viewBox="0 0 24 24"><path d="M5 12.55a11 11 0 0114.08 0"/><path d="M1.42 9a16 16 0 0121.16 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>
          }
        />
        <QuickBtn
          label="Gate"
          disabled={!gateCode}
          onTap={() => copyTo(gateCode, 'Gate code')}
          icon={
            <svg viewBox="0 0 24 24"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
          }
        />
        <QuickBtn
          label="Call HM"
          disabled={!harbourMasterPhone}
          onTap={() => { if (harbourMasterPhone) window.location.href = `tel:${harbourMasterPhone}`; }}
          icon={
            <svg viewBox="0 0 24 24"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.68 9.7a19.79 19.79 0 01-3.07-8.67A2 2 0 012.58 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.91 8.56a16 16 0 006.29 6.29l1.93-1.92a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>
          }
        />
        <QuickBtn
          label="VHF"
          disabled={!wallet?.vhf_channel}
          onTap={() => copyTo(wallet?.vhf_channel, 'VHF channel')}
          icon={
            <svg viewBox="0 0 24 24"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 010 7.07"/><path d="M19.07 4.93a10 10 0 010 14.14"/></svg>
          }
        />
      </div>
      <Toast message={toast} />
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/components/feed/QuickActions.jsx
git commit -m "feat(portal): QuickActions row (WiFi, Gate, Call HM, VHF)"
```

---

## Task 8: DynamicFeed component + MemberHomeScreen

**Files:**
- Create: `portal/src/components/feed/DynamicFeed.jsx`
- Modify: `portal/src/screens/tabs/MemberHomeScreen.jsx` (full implementation, replaces stub)

- [ ] **Step 1: Create DynamicFeed.jsx**

```jsx
// portal/src/components/feed/DynamicFeed.jsx
import { useState, useEffect } from 'react';
import api from '../../api';
import InvoiceCard     from './cards/InvoiceCard';
import VesselStatusCard from './cards/VesselStatusCard';
import InsuranceCard   from './cards/InsuranceCard';

const CARD_MAP = {
  invoice_overdue: InvoiceCard,
  invoice_open:    InvoiceCard,
  vessel_status:   VesselStatusCard,
  insurance_alert: InsuranceCard,
};

export default function DynamicFeed() {
  const [items, setItems]   = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/portal/feed/')
      .then(r => setItems(r.data))
      .catch(() => {}) // silently fail — feed is supplementary
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="p-feed">
        {[1, 2].map(i => (
          <div key={i} className="p-feed-card" style={{ height: 80, opacity: 0.3, background: '#e0e0e0', border: 'none' }} />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="p-feed">
        <div className="p-feed__empty">
          All clear — nothing needs your attention right now.
        </div>
      </div>
    );
  }

  return (
    <div className="p-feed">
      {items.map((item, i) => {
        const Card = CARD_MAP[item.type];
        if (!Card) return null;
        return <Card key={`${item.type}-${item.id || i}`} item={item} />;
      })}
    </div>
  );
}
```

- [ ] **Step 2: Create full MemberHomeScreen.jsx**

```jsx
// portal/src/screens/tabs/MemberHomeScreen.jsx
import { useState, useEffect } from 'react';
import { useUserContext } from '../../context/UserContext';
import { useTenant } from '../../context/TenantContext';
import api from '../../api';
import QuickActions from '../../components/feed/QuickActions';
import DynamicFeed  from '../../components/feed/DynamicFeed';

export default function MemberHomeScreen() {
  const { user }     = useUserContext();
  const { marina }   = useTenant();
  const [wallet, setWallet] = useState(null);

  // Fetch marina wallet info (WiFi, gate codes, VHF)
  // The existing PortalBerthView gives us booking/berth data, but wallet info
  // is on the marina model. We fetch it from MarinaPublicView.
  useEffect(() => {
    api.get('/portal/marina/')
      .then(r => setWallet(r.data))
      .catch(() => {});
  }, []);

  const memberName = user?.email?.split('@')[0] || '';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 16 }}>
      <div className="p-member-header">
        <span className="p-member-header__marina">{marina?.name || 'My Marina'}</span>
        <span className="p-member-header__name">{memberName}</span>
      </div>
      <QuickActions wallet={wallet} />
      <DynamicFeed />
    </div>
  );
}
```

**Note on wallet data:** `GET /portal/marina/` returns the marina public view (name, slug, contact info). It does NOT currently return WiFi/gate codes — that's only exposed to authenticated checkin guests via `marina_wallet`. For Plan 2, `QuickActions` will show disabled state for WiFi/Gate/VHF since wallet data isn't exposed to member sessions yet. A follow-up in Plan 3/4 can add a `GET /portal/member/wallet/` endpoint. For now pass `wallet={null}` to show all buttons in disabled state — the component already handles this gracefully.

Actually, simplify: don't fetch wallet in MemberHomeScreen for now. Pass `wallet={null}` directly — all QuickActions buttons show as disabled until the wallet endpoint is built in a later plan.

Replace the `MemberHomeScreen` useEffect with:

```jsx
// portal/src/screens/tabs/MemberHomeScreen.jsx
import { useUserContext } from '../../context/UserContext';
import { useTenant } from '../../context/TenantContext';
import QuickActions from '../../components/feed/QuickActions';
import DynamicFeed  from '../../components/feed/DynamicFeed';

export default function MemberHomeScreen() {
  const { user }   = useUserContext();
  const { marina } = useTenant();
  const memberName = user?.email?.split('@')[0] || '';

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', paddingBottom: 16 }}>
      <div className="p-member-header">
        <span className="p-member-header__marina">{marina?.name || 'My Marina'}</span>
        <span className="p-member-header__name">{memberName}</span>
      </div>
      <QuickActions wallet={null} />
      <DynamicFeed />
    </div>
  );
}
```

- [ ] **Step 3: Wire the portal:navigate event in AppShell**

The `InvoiceCard` and `InsuranceCard` dispatch `portal:navigate` custom events to switch tabs. `AppShell` must listen for this. Update `AppShell.jsx` to add:

```jsx
useEffect(() => {
  function handleNav(e) { setActiveTab(e.detail.tab); }
  window.addEventListener('portal:navigate', handleNav);
  return () => window.removeEventListener('portal:navigate', handleNav);
}, []);
```

Add this `useEffect` to `AppShell.jsx` (after the existing useState/useUserContext calls). Import `useEffect` alongside `useState`.

- [ ] **Step 4: Commit**

```bash
git add portal/src/components/feed/DynamicFeed.jsx \
        portal/src/screens/tabs/MemberHomeScreen.jsx \
        portal/src/components/shell/AppShell.jsx
git commit -m "feat(portal): DynamicFeed + MemberHomeScreen — member home tab complete"
```

---

## Self-Review

**Spec coverage check:**

| Spec section | Task |
|---|---|
| 3.1 Guest mode — no bottom nav | Task 1 (AppShell hides nav for guests) |
| 4.1 Guest mode — existing checkin state machine | Task 4 (HomeTab GuestCheckinFlow) |
| 4.1 Remove emojis, apply design system to checkin | Tasks 2+3 |
| 4.2 Member mode compact header | Task 8 (MemberHomeScreen p-member-header) |
| 4.2 Quick Actions row | Task 7 |
| 4.2 DynamicFeed — fetches GET /portal/feed/ | Tasks 5+8 |
| 4.2 Backend feed sorted by priority | Task 5 (FeedView sorts items) |
| 4.2 InvoiceCard, VesselStatusCard | Task 6 |
| Feed: invoice_overdue priority 10 | Task 5 |
| Feed: vessel_status priority 20 | Task 5 |
| BookingDashboard retired | Task 4 (`git rm`) |

**Known gap for later plans:** `QuickActions` WiFi/Gate/VHF buttons are disabled in Plan 2 because member wallet data isn't exposed via the member API yet. Plan 4 (Wallet & Account) adds `GET /portal/member/wallet/` and wires it up.

**portal:navigate event:** `InvoiceCard` and `InsuranceCard` dispatch this custom event to switch tabs. `AppShell` listens for it in Task 8 Step 3. Implementer must verify this wiring is in place.
