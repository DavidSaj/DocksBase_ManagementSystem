# Boater Portal Redesign — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the complete role-based PWA experience — a full-screen Guest Boarding Pass (replacing WalletCard), a 4-tab Member shell with gate key, utilities, extended services, and account management, plus the Dockwalk field app screen and the Harbor Master Mobile Configurator in the admin dashboard.

**Architecture:** `AppShell.jsx` branches on `capabilities.isGuest` vs `capabilities.isMember`. Guests get `BoardingPass.jsx` — no tab bar. Members get `MemberShell.jsx` with a 4-tab `BottomNav` that reads `appConfig` from `TenantContext` to conditionally hide toggleable tabs. Brand color is applied as `--color-primary` CSS variable on mount. All new components follow the existing `p-` CSS class prefix pattern.

**Tech Stack:** React 18, Vite, React Router DOM, Lucide SVG icons, IBM Plex Sans, existing `portal.css` + `app.css` CSS variables, existing `api.js` Axios instance with `MemberBearer` auth header.

**Prerequisite:** The backend plan (`2026-05-12-boater-portal-backend.md`) must be complete and deployed before wiring live API calls. Frontend can be built with mock data first and wired in the final tasks.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `portal/src/context/TenantContext.jsx` | Modify | Expose `appConfig` from tenant config response |
| `portal/src/components/shell/AppShell.jsx` | Modify | Branch: guest → BoardingPass, member → MemberShell |
| `portal/src/components/shell/BottomNav.jsx` | Modify | Accept `tabs` prop instead of hardcoded list |
| `portal/src/components/shell/BoardingPass.jsx` | Create | Full guest boarding pass (5 sections) |
| `portal/src/components/shell/MemberShell.jsx` | Create | 4-tab member shell |
| `portal/src/screens/tabs/MemberHomeTab.jsx` | Create | Gate key card + alert strip |
| `portal/src/screens/tabs/UtilitiesTab.jsx` | Create | Dockwalk meter dashboard |
| `portal/src/screens/tabs/ServicesTab.jsx` | Modify | Add work order row |
| `portal/src/screens/WorkOrderScreen.jsx` | Create | Submit work order form |
| `portal/src/screens/tabs/AccountTab.jsx` | Replace | Ledger + Document Vault + Settings |
| `portal/src/screens/tabs/HomeTab.jsx` | Modify | Remove MemberHomeScreen import, use MemberHomeTab |
| `portal/src/styles/portal.css` | Modify | Add boarding pass styles + `--color-primary` support |
| `portal/src/api.js` | Modify | Add member API helper functions |
| `frontend/src/screens/field/DockwalkFlow.jsx` | Create | Rapid meter-entry flow for staff field app |
| `frontend/src/screens/settings/MobileConfigTab.jsx` | Create | Harbor Master brand/toggle/content configurator |

---

### Task 1: Expose `appConfig` from TenantContext

**Files:**
- Modify: `portal/src/context/TenantContext.jsx`

- [ ] **Step 1: Read the current TenantContext**

Read `portal/src/context/TenantContext.jsx` to understand the current shape before editing.

- [ ] **Step 2: Update TenantContext to expose appConfig**

The tenant config response now includes `app_config`. Expose it via context:

```jsx
// portal/src/context/TenantContext.jsx
import { createContext, useContext, useState, useEffect } from 'react';
import axios from 'axios';

const TenantContext = createContext(null);

export function TenantProvider({ slug, children }) {
  const [marina, setMarina]     = useState(null);
  const [appConfig, setAppConfig] = useState({});
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    if (!slug) return;
    axios.get(`/api/v1/marina/public/`, { headers: { 'X-Marina-Slug': slug } })
      .then(r => {
        setMarina(r.data);
        setAppConfig(r.data.app_config || {});
      })
      .finally(() => setLoading(false));
  }, [slug]);

  return (
    <TenantContext.Provider value={{ marina, appConfig, loading }}>
      {children}
    </TenantContext.Provider>
  );
}

export function useTenant() {
  return useContext(TenantContext);
}
```

> **Note:** Preserve the existing fetch URL and header pattern. Only add `appConfig` extraction from the response and expose it in context.

- [ ] **Step 3: Verify app still loads**

Run `npm run dev` in `portal/` and confirm the marina name still renders on the booking wizard screen.

- [ ] **Step 4: Commit**

```
git add portal/src/context/TenantContext.jsx
git commit -m "feat(portal): expose appConfig from tenant context"
```

---

### Task 2: Add `--color-primary` CSS variable support

**Files:**
- Modify: `portal/src/styles/portal.css`
- Modify: `portal/src/components/shell/AppShell.jsx`

- [ ] **Step 1: Add CSS variable to portal.css**

Add at the top of `portal/src/styles/portal.css` (before existing rules):

```css
:root {
  --color-primary: #0c1f3d;
}

/* Override primary buttons and active tab indicator with brand color */
.p-nav-tab.active {
  color: var(--color-primary);
}

.p-nav-tab.active svg {
  stroke: var(--color-primary);
}
```

- [ ] **Step 2: Apply brand color from appConfig in AppShell**

In `portal/src/components/shell/AppShell.jsx`, import `useTenant` and apply the CSS variable on mount:

```jsx
import { useEffect } from 'react';
import { useTenant } from '../../context/TenantContext';

export default function AppShell({ initialTab = 'home' }) {
  const { appConfig } = useTenant();

  useEffect(() => {
    if (appConfig?.brand_color) {
      document.documentElement.style.setProperty('--color-primary', appConfig.brand_color);
    }
  }, [appConfig?.brand_color]);

  // ... rest of component unchanged
}
```

- [ ] **Step 3: Commit**

```
git add portal/src/styles/portal.css portal/src/components/shell/AppShell.jsx
git commit -m "feat(portal): apply brand color from appConfig as CSS variable"
```

---

### Task 3: Role-aware BottomNav (accepts `tabs` prop)

**Files:**
- Modify: `portal/src/components/shell/BottomNav.jsx`

- [ ] **Step 1: Update BottomNav to accept a `tabs` prop**

```jsx
// portal/src/components/shell/BottomNav.jsx

// Icon components — keep all existing icons, add new ones below
function HomeIcon()     { return <svg viewBox="0 0 24 24"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H5a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>; }
function ZapIcon()      { return <svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>; }
function WrenchIcon()   { return <svg viewBox="0 0 24 24"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>; }
function UserIcon()     { return <svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>; }
function CalendarIcon() { return <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>; }

const ICONS = {
  home:      <HomeIcon />,
  utilities: <ZapIcon />,
  services:  <WrenchIcon />,
  account:   <UserIcon />,
  book:      <CalendarIcon />,
};

export default function BottomNav({ tabs, activeTab, onTabChange }) {
  return (
    <nav className="p-bottom-nav" role="navigation" aria-label="Main navigation">
      {tabs.map(tab => (
        <button
          key={tab.id}
          className={`p-nav-tab${activeTab === tab.id ? ' active' : ''}`}
          onClick={() => onTabChange(tab.id)}
          aria-label={tab.label}
          aria-current={activeTab === tab.id ? 'page' : undefined}
        >
          {ICONS[tab.id] || <HomeIcon />}
          <span className="p-nav-label">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
```

- [ ] **Step 2: Update AppShell to pass tabs prop**

In `portal/src/components/shell/AppShell.jsx`, build the tabs array and pass it:

```jsx
// Temporary: keep existing behaviour for non-member shell
const DEFAULT_TABS = [
  { id: 'home',     label: 'Home' },
  { id: 'services', label: 'Services' },
  { id: 'book',     label: 'Book' },
  { id: 'wallet',   label: 'Wallet' },
  { id: 'account',  label: 'Account' },
];

// In render:
<BottomNav tabs={DEFAULT_TABS} activeTab={activeTab} onTabChange={setActiveTab} />
```

- [ ] **Step 3: Verify existing member home still renders**

Run dev server, log in as a member, confirm the 5-tab bar still appears and switching tabs works.

- [ ] **Step 4: Commit**

```
git add portal/src/components/shell/BottomNav.jsx portal/src/components/shell/AppShell.jsx
git commit -m "refactor(portal): BottomNav accepts tabs prop instead of hardcoded list"
```

---

### Task 4: BoardingPass.jsx — Slip + Access sections

**Files:**
- Create: `portal/src/components/shell/BoardingPass.jsx`
- Modify: `portal/src/styles/portal.css`

- [ ] **Step 1: Create BoardingPass with Slip and Access sections**

```jsx
// portal/src/components/shell/BoardingPass.jsx
import { useState } from 'react';
import { useTenant } from '../../context/TenantContext';

function CopyBtn({ value, label }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <button className="p-bp-copy-btn" onClick={copy} type="button">
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function AccessRow({ label, value, copyable = true }) {
  if (!value) return null;
  return (
    <div className="p-bp-access-row">
      <div>
        <div className="p-bp-access-label">{label}</div>
        <div className="p-bp-access-value">{value}</div>
      </div>
      {copyable && <CopyBtn value={value} label={label} />}
    </div>
  );
}

function WashTokenRow({ token }) {
  const expires = new Date(token.expires_at);
  const now     = new Date();
  const hoursLeft = Math.ceil((expires - now) / 3600000);
  const expiryText = hoursLeft < 24
    ? `Expires in ${hoursLeft}h`
    : `Valid until ${expires.toLocaleDateString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`;

  return (
    <div className="p-bp-access-row">
      <div>
        <div className="p-bp-access-label">{token.facility === 'shower' ? 'Shower Code' : 'Laundry Code'}</div>
        <div className="p-bp-access-value">{token.token_code}</div>
        <div className="p-bp-access-expiry">{expiryText}</div>
      </div>
      <CopyBtn value={token.token_code} label="Code" />
    </div>
  );
}

export default function BoardingPass({ booking }) {
  const { marina, appConfig } = useTenant();
  const w = booking.marina_wallet;
  const washTokens = booking.wash_tokens || [];

  return (
    <div className="p-bp-root">
      {/* Header */}
      <div className="p-bp-header">
        {appConfig?.logo_url
          ? <img src={appConfig.logo_url} alt={marina?.name} className="p-bp-logo" />
          : <span className="p-bp-marina-name">{marina?.name || w?.marina_name}</span>
        }
        <button className="p-bp-gear" aria-label="Settings" type="button">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
        </button>
      </div>

      <div className="p-bp-scroll">
        {/* Section 1 — Slip */}
        <div className="p-bp-section">
          <div className="p-bp-section-label">Your Berth</div>
          <div className="p-bp-berth-code">
            {[booking.berth_pier, booking.berth_code].filter(Boolean).join(' · ') || 'Pending assignment'}
          </div>
          <div className="p-bp-dates">
            <span>{booking.check_in}</span>
            <span className="p-bp-dates-arrow">→</span>
            <span>{booking.check_out}</span>
          </div>
        </div>

        {/* Section 2 — Access */}
        {w && (
          <div className="p-bp-section">
            <div className="p-bp-section-label">Access &amp; WiFi</div>
            {w.gate_codes?.map((g, i) => (
              <AccessRow key={i} label={g.label || 'Gate PIN'} value={g.pin} />
            ))}
            <AccessRow label="WiFi Network"  value={w.wifi_network} copyable={false} />
            <AccessRow label="WiFi Password" value={w.wifi_password} />
            {washTokens.map((t, i) => <WashTokenRow key={i} token={t} />)}
          </div>
        )}

        {/* Sections 3–5 added in later tasks */}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add boarding pass styles to portal.css**

```css
/* ── Boarding Pass ──────────────────────────────────────────────── */
.p-bp-root       { min-height: 100vh; background: #f4f6f8; display: flex; flex-direction: column; }
.p-bp-header     { background: var(--color-primary); padding: 16px 20px; display: flex; align-items: center; justify-content: space-between; }
.p-bp-logo       { height: 32px; object-fit: contain; }
.p-bp-marina-name { color: #fff; font-size: 18px; font-weight: 700; font-family: var(--font-app); }
.p-bp-gear       { background: none; border: none; cursor: pointer; padding: 4px; }
.p-bp-gear svg   { width: 22px; height: 22px; stroke: rgba(255,255,255,0.7); fill: none; stroke-width: 2; }
.p-bp-scroll     { flex: 1; overflow-y: auto; padding: 16px 16px 40px; }
.p-bp-section    { background: #fff; border-radius: 12px; padding: 16px; margin-bottom: 12px; box-shadow: var(--shadow-card); }
.p-bp-section-label { font-size: 11px; font-weight: 700; color: rgba(0,0,0,0.4); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
.p-bp-berth-code { font-size: 32px; font-weight: 800; color: var(--color-primary); line-height: 1; margin-bottom: 8px; }
.p-bp-dates      { font-size: 14px; color: rgba(0,0,0,0.55); display: flex; gap: 8px; align-items: center; }
.p-bp-dates-arrow { color: rgba(0,0,0,0.3); }
.p-bp-access-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,0.06); }
.p-bp-access-row:last-child { border-bottom: none; }
.p-bp-access-label { font-size: 11px; font-weight: 700; color: rgba(0,0,0,0.4); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 2px; }
.p-bp-access-value { font-size: 18px; font-weight: 700; color: #1a2d4a; font-family: 'IBM Plex Mono', monospace; }
.p-bp-access-expiry { font-size: 12px; color: rgba(0,0,0,0.4); margin-top: 2px; }
.p-bp-copy-btn   { background: #f4f6f8; border: none; border-radius: 8px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; color: #1a2d4a; font-family: var(--font-app); transition: background 0.15s; }
.p-bp-copy-btn:active { background: #e2e8f0; }
```

- [ ] **Step 3: Commit**

```
git add portal/src/components/shell/BoardingPass.jsx portal/src/styles/portal.css
git commit -m "feat(portal): BoardingPass slip and access sections"
```

---

### Task 5: BoardingPass.jsx — Map section

**Files:**
- Modify: `portal/src/components/shell/BoardingPass.jsx`

- [ ] **Step 1: Add map fetch and Map section to BoardingPass**

Add a `useEffect` to fetch map data, and render the map section after the Access section. Append to the existing `BoardingPass.jsx`:

```jsx
// At the top, add:
import { useState, useEffect } from 'react';
import api from '../../api';

// Inside the component, before return:
const [mapData, setMapData] = useState(null);

useEffect(() => {
  api.get('/portal/checkin/map/')
    .then(r => setMapData(r.data))
    .catch(() => {}); // map is non-critical
}, []);
```

Replace the `{/* Sections 3–5 added in later tasks */}` comment with:

```jsx
{/* Section 3 — Map */}
{mapData?.amenities?.length > 0 && (
  <div className="p-bp-section">
    <div className="p-bp-section-label">Marina Map</div>
    <div className="p-bp-map-container">
      <svg
        viewBox="0 0 800 600"
        className="p-bp-map-svg"
        style={{ touchAction: 'pinch-zoom' }}
      >
        {/* Amenity pins */}
        {mapData.amenities.map((a, i) => (
          <g key={i} transform={`translate(${a.canvas_x}, ${a.canvas_y})`}>
            <circle r="12" fill="var(--color-primary)" opacity="0.15" />
            <circle r="6" fill="var(--color-primary)" />
            <title>{a.label || a.type}</title>
          </g>
        ))}
        {/* Highlight boater's slip if berth has canvas coords */}
        {booking.berth_canvas_x && booking.berth_canvas_y && (
          <g transform={`translate(${booking.berth_canvas_x}, ${booking.berth_canvas_y})`}>
            <circle r="14" fill="#e6b800" opacity="0.3" />
            <circle r="8" fill="#e6b800" />
            <title>Your Berth: {booking.berth_code}</title>
          </g>
        )}
      </svg>
      <div className="p-bp-map-legend">
        {mapData.amenities.map((a, i) => (
          <span key={i} className="p-bp-map-legend-item">
            <span className="p-bp-map-dot" />
            {a.label || a.type}
          </span>
        ))}
      </div>
    </div>
  </div>
)}

{/* Sections 4–5 added in next task */}
```

Add map styles to `portal.css`:

```css
.p-bp-map-container { overflow: hidden; border-radius: 8px; background: #f8fafc; }
.p-bp-map-svg       { width: 100%; height: auto; max-height: 240px; }
.p-bp-map-legend    { display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 0 0; }
.p-bp-map-legend-item { display: flex; align-items: center; gap: 4px; font-size: 12px; color: rgba(0,0,0,0.5); }
.p-bp-map-dot       { width: 8px; height: 8px; border-radius: 50%; background: var(--color-primary); flex-shrink: 0; }
```

- [ ] **Step 2: Commit**

```
git add portal/src/components/shell/BoardingPass.jsx portal/src/styles/portal.css
git commit -m "feat(portal): BoardingPass marina map section with amenity pins"
```

---

### Task 6: BoardingPass.jsx — Local Guide + Extend Stay

**Files:**
- Modify: `portal/src/components/shell/BoardingPass.jsx`
- Modify: `portal/src/styles/portal.css`

- [ ] **Step 1: Replace the sections placeholder with Local Guide and Extend Stay**

Replace `{/* Sections 4–5 added in next task */}` with:

```jsx
{/* Section 4 — Local Guide */}
{appConfig?.local_guide && (
  <div className="p-bp-section">
    <div className="p-bp-section-label">Local Guide</div>
    <div
      className="p-bp-local-guide"
      dangerouslySetInnerHTML={{
        __html: (appConfig.local_guide || '')
          .replace(/\n/g, '<br/>')
          .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>'),
      }}
    />
  </div>
)}

{/* Section 5 — Extend Stay */}
<div className="p-bp-section p-bp-extend">
  <div className="p-bp-section-label">Need more time?</div>
  <button
    className="p-bp-extend-btn"
    type="button"
    onClick={() => window.dispatchEvent(new CustomEvent('portal:navigate', { detail: { screen: 'extend' } }))}
  >
    Request Extra Night
  </button>
</div>
```

Add styles:

```css
.p-bp-local-guide  { font-size: 14px; line-height: 1.6; color: rgba(0,0,0,0.7); }
.p-bp-extend       { text-align: center; }
.p-bp-extend-btn   { width: 100%; padding: 14px; background: var(--color-primary); color: #fff; border: none; border-radius: 3px; font-size: 16px; font-weight: 700; cursor: pointer; font-family: var(--font-app); }
```

- [ ] **Step 2: Wire AppShell to show BoardingPass for guests**

In `portal/src/components/shell/AppShell.jsx`:

```jsx
import BoardingPass from './BoardingPass';
// ...
if (capabilities?.isGuest) {
  // Guests see boarding pass if checked in (wallet exists), otherwise the existing checkin flow
  return booking?.marina_wallet
    ? <BoardingPass booking={booking} />
    : <HomeTab />;
}
```

> Note: Keep the existing `HomeTab` for guests who haven't checked in yet (checklist/countdown state). `BoardingPass` only renders when `marina_wallet` is populated (post check-in).

- [ ] **Step 3: Commit**

```
git add portal/src/components/shell/BoardingPass.jsx portal/src/components/shell/AppShell.jsx portal/src/styles/portal.css
git commit -m "feat(portal): complete guest BoardingPass with local guide and extend stay"
```

---

### Task 7: MemberShell.jsx — 4-tab member experience

**Files:**
- Create: `portal/src/components/shell/MemberShell.jsx`
- Modify: `portal/src/components/shell/AppShell.jsx`

- [ ] **Step 1: Create MemberShell.jsx**

```jsx
// portal/src/components/shell/MemberShell.jsx
import { useState, useEffect } from 'react';
import { useTenant } from '../../context/TenantContext';
import BottomNav from './BottomNav';
import MemberHomeTab from '../../screens/tabs/MemberHomeTab';
import UtilitiesTab  from '../../screens/tabs/UtilitiesTab';
import ServicesTab   from '../../screens/tabs/ServicesTab';
import AccountTab    from '../../screens/tabs/AccountTab';

const TAB_COMPONENTS = {
  home:      MemberHomeTab,
  utilities: UtilitiesTab,
  services:  ServicesTab,
  account:   AccountTab,
};

export default function MemberShell() {
  const { appConfig } = useTenant();
  const [activeTab, setActiveTab] = useState('home');

  useEffect(() => {
    function handleNav(e) { setActiveTab(e.detail.tab); }
    window.addEventListener('portal:navigate', handleNav);
    return () => window.removeEventListener('portal:navigate', handleNav);
  }, []);

  const tabs = [
    { id: 'home',      label: 'Home',      always: true },
    { id: 'utilities', label: 'Utilities', enabled: appConfig?.enable_utilities !== false },
    { id: 'services',  label: 'Services',  enabled: appConfig?.enable_boatyard  !== false },
    { id: 'account',   label: 'Account',   always: true },
  ].filter(t => t.always || t.enabled);

  const TabComponent = TAB_COMPONENTS[activeTab] || MemberHomeTab;

  return (
    <div className="p-shell">
      <TabComponent />
      <BottomNav tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
    </div>
  );
}
```

- [ ] **Step 2: Wire MemberShell in AppShell**

In `portal/src/components/shell/AppShell.jsx`, replace the existing member rendering:

```jsx
import MemberShell from './MemberShell';
// ...
// In render, after the guest branch:
if (capabilities?.isMember) {
  return <MemberShell />;
}
// Fall through to existing default rendering for unauthenticated state
```

- [ ] **Step 3: Verify member shell renders with 4 tabs**

Run dev server, log in as a member. Confirm 4-tab bar renders and switching tabs doesn't crash.

- [ ] **Step 4: Commit**

```
git add portal/src/components/shell/MemberShell.jsx portal/src/components/shell/AppShell.jsx
git commit -m "feat(portal): MemberShell 4-tab member shell wired into AppShell"
```

---

### Task 8: MemberHomeTab — gate key + alerts

**Files:**
- Create: `portal/src/screens/tabs/MemberHomeTab.jsx`
- Modify: `portal/src/api.js`
- Modify: `portal/src/styles/portal.css`

- [ ] **Step 1: Add gate API call to api.js**

Append to `portal/src/api.js`:

```js
export function fetchMemberGate() {
  return api.get('/portal/member/gate/');
}
```

- [ ] **Step 2: Create MemberHomeTab.jsx**

```jsx
// portal/src/screens/tabs/MemberHomeTab.jsx
import { useState, useEffect } from 'react';
import { useTenant } from '../../context/TenantContext';
import { fetchMemberGate } from '../../api';

function GateCode({ code }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(code.pin).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }
  return (
    <div className="p-home-gate-row" onClick={copy} role="button" tabIndex={0} onKeyDown={e => e.key === 'Enter' && copy()}>
      <div>
        <div className="p-home-gate-label">{code.label || 'Gate PIN'}</div>
        <div className="p-home-gate-pin">{code.pin}</div>
      </div>
      <div className="p-home-gate-copy">{copied ? 'Copied' : 'Tap to copy'}</div>
    </div>
  );
}

export default function MemberHomeTab() {
  const { marina } = useTenant();
  const [gateData, setGateData] = useState(null);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    fetchMemberGate()
      .then(r => setGateData(r.data))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="p-home-root">
      <div className="p-member-header">
        <span className="p-member-header__marina">{marina?.name || 'My Marina'}</span>
      </div>

      {/* Gate Key Card */}
      <div className="p-home-card">
        <div className="p-home-card-title">Gate Access</div>
        {loading && <div className="p-home-loading">Loading…</div>}
        {!loading && gateData?.gate_codes?.length === 0 && (
          <div className="p-home-empty">No gate codes on file. Contact the marina.</div>
        )}
        {!loading && gateData?.gate_codes?.map((c, i) => (
          <GateCode key={i} code={c} />
        ))}
      </div>

      {/* WiFi Card */}
      {gateData?.wifi_name && (
        <div className="p-home-card">
          <div className="p-home-card-title">WiFi</div>
          <div className="p-home-wifi-row">
            <span className="p-home-wifi-label">Network</span>
            <span className="p-home-wifi-value">{gateData.wifi_name}</span>
          </div>
          {gateData.wifi_password && (
            <div className="p-home-wifi-row">
              <span className="p-home-wifi-label">Password</span>
              <span className="p-home-wifi-value">{gateData.wifi_password}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add member home styles to portal.css**

```css
/* ── Member Home ────────────────────────────────────────────────── */
.p-home-root        { min-height: 100vh; background: var(--bg, #f4f6f8); padding-bottom: 80px; }
.p-home-card        { background: #fff; border-radius: 12px; padding: 16px; margin: 12px 16px 0; box-shadow: var(--shadow-card); border: 1px solid rgba(0,0,0,0.06); }
.p-home-card-title  { font-size: 13px; font-weight: 700; color: rgba(0,0,0,0.4); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
.p-home-gate-row    { display: flex; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid rgba(0,0,0,0.06); cursor: pointer; }
.p-home-gate-row:last-child { border-bottom: none; }
.p-home-gate-label  { font-size: 12px; color: rgba(0,0,0,0.4); margin-bottom: 2px; }
.p-home-gate-pin    { font-size: 28px; font-weight: 800; color: var(--color-primary); font-family: 'IBM Plex Mono', monospace; letter-spacing: 4px; }
.p-home-gate-copy   { font-size: 12px; color: rgba(0,0,0,0.3); }
.p-home-wifi-row    { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
.p-home-wifi-label  { color: rgba(0,0,0,0.4); }
.p-home-wifi-value  { font-weight: 600; color: #1a2d4a; }
.p-home-loading     { font-size: 14px; color: rgba(0,0,0,0.4); text-align: center; padding: 16px; }
.p-home-empty       { font-size: 14px; color: rgba(0,0,0,0.4); }
```

- [ ] **Step 4: Commit**

```
git add portal/src/screens/tabs/MemberHomeTab.jsx portal/src/api.js portal/src/styles/portal.css
git commit -m "feat(portal): MemberHomeTab with gate key and WiFi cards"
```

---

### Task 9: UtilitiesTab — Dockwalk meter dashboard

**Files:**
- Create: `portal/src/screens/tabs/UtilitiesTab.jsx`
- Modify: `portal/src/api.js`
- Modify: `portal/src/styles/portal.css`

- [ ] **Step 1: Add utilities API call to api.js**

```js
export function fetchMemberUtilities() {
  return api.get('/portal/member/utilities/');
}
```

- [ ] **Step 2: Create UtilitiesTab.jsx**

```jsx
// portal/src/screens/tabs/UtilitiesTab.jsx
import { useState, useEffect } from 'react';
import { fetchMemberUtilities } from '../../api';

function MeterCard({ meter }) {
  const value = meter.last_reading_value;
  const unit  = meter.last_reading_unit;
  const when  = meter.last_reading_at
    ? new Date(meter.last_reading_at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })
    : null;
  const isElec = meter.meter_type === 'electricity';

  return (
    <div className="p-util-card">
      <div className="p-util-card-header">
        <div>
          <div className="p-util-type">{isElec ? 'Shore Power' : 'Water'}</div>
          {meter.berth_code && <div className="p-util-berth">{meter.berth_code}</div>}
        </div>
        <div className="p-util-icon">
          {isElec
            ? <svg viewBox="0 0 24 24"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            : <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 16c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z"/></svg>
          }
        </div>
      </div>
      <div className="p-util-reading">
        {value !== null ? `${value} ${unit}` : 'No readings yet'}
      </div>
      {when && <div className="p-util-updated">Last updated: {when}</div>}
      {!when && <div className="p-util-updated">Awaiting first reading from marina staff</div>}
    </div>
  );
}

export default function UtilitiesTab() {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState(null);

  function load() {
    setLoading(true);
    fetchMemberUtilities()
      .then(r => { setData(r.data); setError(null); })
      .catch(e => setError(e.response?.status === 403 ? 'disabled' : 'error'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  if (loading) return <div className="p-tab-loading">Loading utilities…</div>;
  if (error === 'disabled') return <div className="p-tab-stub">Utility tracking is not enabled for this marina.</div>;
  if (error) return <div className="p-tab-stub">Could not load utility data. Pull to refresh.</div>;

  const meters = data?.meters || [];

  return (
    <div className="p-util-root">
      <div className="p-util-header">Utilities</div>
      {meters.length === 0 && (
        <div className="p-tab-stub">No meters assigned to your berth yet.</div>
      )}
      {meters.map(m => <MeterCard key={m.id} meter={m} />)}
      <div className="p-util-note">
        Readings entered daily by marina staff. Contact the harbour master if your berth is not listed.
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add utilities styles to portal.css**

```css
/* ── Utilities Tab ──────────────────────────────────────────────── */
.p-util-root    { min-height: 100vh; background: var(--bg, #f4f6f8); padding: 0 0 80px; }
.p-util-header  { padding: 20px 16px 8px; font-size: 22px; font-weight: 800; color: #1a2d4a; }
.p-util-card    { background: #fff; border-radius: 12px; padding: 16px; margin: 0 16px 12px; box-shadow: var(--shadow-card); }
.p-util-card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; }
.p-util-type    { font-size: 14px; font-weight: 700; color: #1a2d4a; }
.p-util-berth   { font-size: 12px; color: rgba(0,0,0,0.4); margin-top: 2px; }
.p-util-icon svg { width: 24px; height: 24px; stroke: var(--color-primary); fill: none; stroke-width: 2; }
.p-util-reading { font-size: 28px; font-weight: 800; color: var(--color-primary); margin-bottom: 4px; }
.p-util-updated { font-size: 12px; color: rgba(0,0,0,0.4); }
.p-util-note    { font-size: 12px; color: rgba(0,0,0,0.35); padding: 0 16px; line-height: 1.5; }
.p-tab-loading  { padding: 32px 16px; text-align: center; color: rgba(0,0,0,0.4); font-size: 14px; }
```

- [ ] **Step 4: Commit**

```
git add portal/src/screens/tabs/UtilitiesTab.jsx portal/src/api.js portal/src/styles/portal.css
git commit -m "feat(portal): UtilitiesTab showing Dockwalk meter readings"
```

---

### Task 10: ServicesTab extension + WorkOrderScreen

**Files:**
- Modify: `portal/src/screens/tabs/ServicesTab.jsx`
- Create: `portal/src/screens/WorkOrderScreen.jsx`
- Modify: `portal/src/api.js`
- Modify: `portal/src/styles/portal.css`

- [ ] **Step 1: Add work order API calls to api.js**

```js
export function fetchWorkOrders() {
  return api.get('/portal/member/work-orders/');
}

export function submitWorkOrder(data) {
  return api.post('/portal/member/work-orders/', data);
}
```

- [ ] **Step 2: Create WorkOrderScreen.jsx**

```jsx
// portal/src/screens/WorkOrderScreen.jsx
import { useState } from 'react';
import { submitWorkOrder } from '../api';

export default function WorkOrderScreen({ onBack }) {
  const [description, setDescription] = useState('');
  const [urgency, setUrgency]         = useState('routine');
  const [submitting, setSubmitting]   = useState(false);
  const [ref, setRef]                 = useState(null);
  const [error, setError]             = useState(null);

  function submit(e) {
    e.preventDefault();
    if (!description.trim()) return;
    setSubmitting(true);
    submitWorkOrder({ description: description.trim(), urgency })
      .then(r => setRef(r.data.ref))
      .catch(() => setError('Could not submit request. Please try again.'))
      .finally(() => setSubmitting(false));
  }

  if (ref) {
    return (
      <div className="p-wo-root">
        <button className="p-wo-back" onClick={onBack} type="button">← Back</button>
        <div className="p-wo-confirm-card">
          <div className="p-wo-confirm-ref">{ref}</div>
          <div className="p-wo-confirm-title">Request received</div>
          <div className="p-wo-confirm-sub">The harbour team has been notified. They will contact you to arrange access to your vessel.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-wo-root">
      <button className="p-wo-back" onClick={onBack} type="button">← Back</button>
      <div className="p-wo-card">
        <div className="p-wo-title">Boatyard Work Request</div>
        <form onSubmit={submit}>
          <label className="p-wo-label">Describe the work needed</label>
          <textarea
            className="p-wo-textarea"
            rows={5}
            placeholder="e.g. Engine making a knocking sound when starting. Needs inspection."
            value={description}
            onChange={e => setDescription(e.target.value)}
            required
          />
          <label className="p-wo-label">Urgency</label>
          <select
            className="p-wo-select"
            value={urgency}
            onChange={e => setUrgency(e.target.value)}
          >
            <option value="routine">Routine — schedule when convenient</option>
            <option value="urgent">Urgent — within 48 hours</option>
            <option value="emergency">Emergency — immediate attention needed</option>
          </select>
          {error && <div className="p-wo-error">{error}</div>}
          <button className="p-wo-submit" type="submit" disabled={submitting || !description.trim()}>
            {submitting ? 'Submitting…' : 'Submit Request'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add WorkOrder row to ServicesTab.jsx**

In `portal/src/screens/tabs/ServicesTab.jsx`, import and add the new service:

```jsx
import WorkOrderScreen from '../WorkOrderScreen';

// Add to SERVICES array:
{ id: 'workorder', label: 'Boatyard Work Request', sub: 'Request maintenance or repair work on your vessel', Icon: WrenchIcon },

// Add to the if-chain at top of component:
if (active === 'workorder') return <WorkOrderScreen onBack={() => setActive(null)} />;
```

Add a `WrenchIcon` component in `ServicesTab.jsx`:

```jsx
function WrenchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
    </svg>
  );
}
```

- [ ] **Step 4: Add work order styles to portal.css**

```css
/* ── Work Order Screen ──────────────────────────────────────────── */
.p-wo-root         { min-height: 100vh; background: var(--bg, #f4f6f8); padding: 0 0 80px; }
.p-wo-back         { background: none; border: none; padding: 16px; font-size: 15px; font-weight: 600; color: var(--color-primary); cursor: pointer; font-family: var(--font-app); }
.p-wo-card         { background: #fff; border-radius: 12px; padding: 20px; margin: 0 16px; box-shadow: var(--shadow-card); }
.p-wo-title        { font-size: 18px; font-weight: 700; color: #1a2d4a; margin-bottom: 20px; }
.p-wo-label        { display: block; font-size: 12px; font-weight: 700; color: rgba(0,0,0,0.5); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px; margin-top: 16px; }
.p-wo-textarea     { width: 100%; border: 1px solid #ddd; border-radius: 4px; padding: 10px; font-size: 15px; font-family: var(--font-app); resize: vertical; box-sizing: border-box; }
.p-wo-textarea:focus { outline: none; box-shadow: 0 0 0 3px rgba(9,127,232,0.12); }
.p-wo-select       { width: 100%; border: 1px solid #ddd; border-radius: 4px; padding: 10px; font-size: 15px; font-family: var(--font-app); background: #fff; box-sizing: border-box; }
.p-wo-submit       { width: 100%; margin-top: 20px; padding: 14px; background: var(--color-primary); color: #fff; border: none; border-radius: 3px; font-size: 16px; font-weight: 700; cursor: pointer; font-family: var(--font-app); }
.p-wo-submit:disabled { opacity: 0.5; cursor: not-allowed; }
.p-wo-error        { color: #c0392b; font-size: 14px; margin-top: 8px; }
.p-wo-confirm-card { background: #fff; border-radius: 12px; padding: 28px 20px; margin: 0 16px; text-align: center; box-shadow: var(--shadow-card); }
.p-wo-confirm-ref  { font-size: 28px; font-weight: 800; color: var(--color-primary); margin-bottom: 8px; }
.p-wo-confirm-title { font-size: 18px; font-weight: 700; margin-bottom: 8px; }
.p-wo-confirm-sub  { font-size: 14px; color: rgba(0,0,0,0.55); line-height: 1.6; }
```

- [ ] **Step 5: Commit**

```
git add portal/src/screens/tabs/ServicesTab.jsx portal/src/screens/WorkOrderScreen.jsx portal/src/api.js portal/src/styles/portal.css
git commit -m "feat(portal): add Boatyard Work Request to ServicesTab"
```

---

### Task 11: AccountTab — Financial Ledger + Document Vault + Settings

**Files:**
- Replace: `portal/src/screens/tabs/AccountTab.jsx`
- Modify: `portal/src/api.js`
- Modify: `portal/src/styles/portal.css`

- [ ] **Step 1: Add account API calls to api.js**

```js
export function fetchInvoices() {
  return api.get('/portal/invoices/');
}

export function payInvoice(pk) {
  return api.post(`/portal/invoices/${pk}/pay/`);
}

export function fetchDocuments() {
  return api.get('/portal/member/documents/');
}

export function uploadDocument(docType, file) {
  const form = new FormData();
  form.append('doc_type', docType);
  form.append('file', file);
  return api.post('/portal/member/documents/', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
}

export function deleteDocument(id) {
  return api.delete(`/portal/member/documents/${id}/`);
}
```

- [ ] **Step 2: Replace AccountTab.jsx**

```jsx
// portal/src/screens/tabs/AccountTab.jsx
import { useState, useEffect, useRef } from 'react';
import { useTenant } from '../../context/TenantContext';
import { fetchInvoices, fetchDocuments, uploadDocument, deleteDocument } from '../../api';

const STATUS_BADGE = {
  paid:    { label: 'Paid',    cls: 'badge-green' },
  unpaid:  { label: 'Unpaid',  cls: 'badge-gold'  },
  open:    { label: 'Due',     cls: 'badge-gold'  },
  draft:   { label: 'Draft',   cls: 'badge-gray'  },
  void:    { label: 'Void',    cls: 'badge-gray'  },
};

const DOC_STATUS_COLOR = {
  pending_upload: 'rgba(0,0,0,0.3)',
  uploaded:       '#2980b9',
  verified:       '#27ae60',
  due_soon:       '#e67e22',
  expired:        '#c0392b',
};

function InvoiceRow({ invoice }) {
  const badge = STATUS_BADGE[invoice.status] || { label: invoice.status, cls: 'badge-gray' };
  return (
    <div className="p-acct-invoice-row">
      <div>
        <div className="p-acct-invoice-num">{invoice.invoice_number}</div>
        <div className="p-acct-invoice-date">{invoice.due_date || invoice.created_at}</div>
      </div>
      <div className="p-acct-invoice-right">
        <div className="p-acct-invoice-amount">{invoice.total}</div>
        <span className={`badge ${badge.cls}`}>{badge.label}</span>
      </div>
    </div>
  );
}

function DocRow({ doc, appConfig, onUpload, onDelete }) {
  const fileRef = useRef();
  const color   = DOC_STATUS_COLOR[doc.status] || 'rgba(0,0,0,0.3)';
  return (
    <div className="p-acct-doc-row">
      <div>
        <div className="p-acct-doc-type">{doc.doc_type_display}</div>
        <div className="p-acct-doc-status" style={{ color }}>{doc.status_display}</div>
        {doc.expiry_date && <div className="p-acct-doc-expiry">Expires {doc.expiry_date}</div>}
      </div>
      <div className="p-acct-doc-actions">
        {doc.status === 'pending_upload' && (
          <>
            <input type="file" ref={fileRef} style={{ display: 'none' }} onChange={e => onUpload(doc.doc_type, e.target.files[0])} accept=".pdf,.jpg,.jpeg,.png" />
            <button className="p-acct-doc-btn" onClick={() => fileRef.current.click()} type="button">Upload</button>
          </>
        )}
        {doc.file && (
          <a className="p-acct-doc-btn" href={doc.file} target="_blank" rel="noreferrer">View</a>
        )}
      </div>
    </div>
  );
}

export default function AccountTab() {
  const { appConfig } = useTenant();
  const [invoices, setInvoices]   = useState([]);
  const [docs, setDocs]           = useState([]);
  const [invoiceLoading, setIL]   = useState(true);
  const [docLoading, setDL]       = useState(true);

  useEffect(() => {
    fetchInvoices().then(r => setInvoices(r.data.results || r.data)).finally(() => setIL(false));
    if (appConfig?.enable_documents !== false) {
      fetchDocuments().then(r => setDocs(r.data.documents || [])).finally(() => setDL(false));
    } else {
      setDL(false);
    }
  }, []);

  function handleUpload(docType, file) {
    if (!file) return;
    uploadDocument(docType, file)
      .then(r => setDocs(prev => prev.map(d => d.doc_type === docType ? r.data : d)))
      .catch(() => alert('Upload failed. Please try again.'));
  }

  return (
    <div className="p-acct-root">
      {/* Financial Ledger */}
      <div className="p-acct-section-title">Invoices</div>
      <div className="p-acct-card">
        {invoiceLoading && <div className="p-tab-loading">Loading…</div>}
        {!invoiceLoading && invoices.length === 0 && <div className="p-acct-empty">No invoices yet.</div>}
        {invoices.map(inv => <InvoiceRow key={inv.id} invoice={inv} />)}
      </div>

      {/* Document Vault */}
      {appConfig?.enable_documents !== false && (
        <>
          <div className="p-acct-section-title">Documents</div>
          <div className="p-acct-card">
            {docLoading && <div className="p-tab-loading">Loading…</div>}
            {!docLoading && docs.length === 0 && <div className="p-acct-empty">No documents on file.</div>}
            {docs.map(doc => (
              <DocRow
                key={doc.id}
                doc={doc}
                appConfig={appConfig}
                onUpload={handleUpload}
                onDelete={id => deleteDocument(id).then(() => setDocs(prev => prev.filter(d => d.id !== id)))}
              />
            ))}
          </div>
        </>
      )}

      {/* Settings */}
      <div className="p-acct-section-title">Settings</div>
      <div className="p-acct-card">
        <button className="p-acct-logout" type="button" onClick={() => {
          localStorage.clear();
          window.location.reload();
        }}>Log out</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Add account styles to portal.css**

```css
/* ── Account Tab ────────────────────────────────────────────────── */
.p-acct-root          { min-height: 100vh; background: var(--bg, #f4f6f8); padding: 0 0 80px; }
.p-acct-section-title { font-size: 13px; font-weight: 700; color: rgba(0,0,0,0.4); text-transform: uppercase; letter-spacing: 0.5px; padding: 20px 16px 6px; }
.p-acct-card          { background: #fff; border-radius: 12px; margin: 0 16px 12px; box-shadow: var(--shadow-card); overflow: hidden; }
.p-acct-empty         { padding: 16px; font-size: 14px; color: rgba(0,0,0,0.4); }
.p-acct-invoice-row   { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid rgba(0,0,0,0.06); }
.p-acct-invoice-row:last-child { border-bottom: none; }
.p-acct-invoice-num   { font-size: 14px; font-weight: 600; color: #1a2d4a; }
.p-acct-invoice-date  { font-size: 12px; color: rgba(0,0,0,0.4); margin-top: 2px; }
.p-acct-invoice-right { text-align: right; }
.p-acct-invoice-amount { font-size: 16px; font-weight: 700; color: #1a2d4a; margin-bottom: 4px; }
.p-acct-doc-row       { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid rgba(0,0,0,0.06); }
.p-acct-doc-row:last-child { border-bottom: none; }
.p-acct-doc-type      { font-size: 14px; font-weight: 600; color: #1a2d4a; }
.p-acct-doc-status    { font-size: 12px; font-weight: 600; margin-top: 2px; }
.p-acct-doc-expiry    { font-size: 12px; color: rgba(0,0,0,0.4); margin-top: 2px; }
.p-acct-doc-actions   { display: flex; gap: 8px; }
.p-acct-doc-btn       { background: #f4f6f8; border: none; border-radius: 6px; padding: 6px 12px; font-size: 13px; font-weight: 600; cursor: pointer; color: #1a2d4a; text-decoration: none; font-family: var(--font-app); }
.p-acct-logout        { width: 100%; padding: 14px 16px; background: none; border: none; text-align: left; font-size: 15px; color: #c0392b; font-weight: 600; cursor: pointer; font-family: var(--font-app); }
```

- [ ] **Step 4: Commit**

```
git add portal/src/screens/tabs/AccountTab.jsx portal/src/api.js portal/src/styles/portal.css
git commit -m "feat(portal): AccountTab with invoices, document vault, and settings"
```

---

### Task 12: DockwalkFlow.jsx — field app rapid meter entry

**Files:**
- Create: `frontend/src/screens/field/DockwalkFlow.jsx`
- Modify: `frontend/src/screens/Field.jsx` (add tile to action grid)

- [ ] **Step 1: Create DockwalkFlow.jsx**

```jsx
// frontend/src/screens/field/DockwalkFlow.jsx
import { useState, useEffect, useRef } from 'react';
import api from '../../api';

export default function DockwalkFlow({ onBack }) {
  const [meters, setMeters]     = useState([]);
  const [index, setIndex]       = useState(0);
  const [value, setValue]       = useState('');
  const [rollover, setRollover] = useState(false);
  const [error, setError]       = useState(null);
  const [done, setDone]         = useState(false);
  const [stats, setStats]       = useState({ entered: 0, skipped: 0 });
  const inputRef = useRef();

  useEffect(() => {
    api.get('/api/v1/utilities/dockwalk/')
      .then(r => setMeters(r.data.meters))
      .catch(() => setError('Could not load meters. Check connection.'));
  }, []);

  useEffect(() => {
    setValue('');
    setRollover(false);
    setError(null);
    inputRef.current?.focus();
  }, [index]);

  const meter = meters[index];
  const lastValue = meter?.meter_type === 'electricity'
    ? meter.last_reading_kwh
    : meter.last_reading_m3;
  const unit = meter?.meter_type === 'electricity' ? 'kWh' : 'm³';

  function skip() {
    setStats(s => ({ ...s, skipped: s.skipped + 1 }));
    if (index + 1 >= meters.length) { setDone(true); return; }
    setIndex(i => i + 1);
  }

  function submit() {
    if (!value) return;
    const payload = {
      rollover,
      ...(meter.meter_type === 'electricity'
        ? { reading_kwh: parseFloat(value) }
        : { reading_m3:  parseFloat(value) }),
    };
    api.post(`/api/v1/utilities/dockwalk/${meter.id}/reading/`, payload)
      .then(() => {
        setStats(s => ({ ...s, entered: s.entered + 1 }));
        if (index + 1 >= meters.length) { setDone(true); return; }
        setIndex(i => i + 1);
      })
      .catch(e => {
        const msg = e.response?.data?.detail || 'Submission failed.';
        setError(msg);
        if (msg.includes('lower than last')) setRollover(false); // reset checkbox
      });
  }

  if (error && meters.length === 0) {
    return (
      <div className="f-dw-root">
        <button className="f-dw-back" onClick={onBack}>← Back</button>
        <div className="f-dw-error">{error}</div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="f-dw-root">
        <button className="f-dw-back" onClick={onBack}>← Back</button>
        <div className="f-dw-done">
          <div className="f-dw-done-title">All done</div>
          <div className="f-dw-done-stats">{stats.entered} entered · {stats.skipped} skipped</div>
        </div>
      </div>
    );
  }

  if (!meter) return <div className="f-dw-root"><div className="p-tab-loading">Loading…</div></div>;

  const remaining = meters.length - index;

  return (
    <div className="f-dw-root">
      <div className="f-dw-topbar">
        <button className="f-dw-back" onClick={onBack}>← Back</button>
        <span className="f-dw-progress">{remaining} left</span>
      </div>

      <div className="f-dw-card">
        <div className="f-dw-berth">{meter.pier_label ? `${meter.pier_label} · ` : ''}{meter.berth_code || 'Unassigned'}</div>
        <div className="f-dw-meter-type">{meter.meter_type === 'electricity' ? 'Electricity' : 'Water'} · {meter.label || meter.device_id}</div>
        {lastValue && (
          <div className="f-dw-last">
            Last: <strong>{lastValue} {unit}</strong>
            {meter.last_recorded_at && ` (${new Date(meter.last_recorded_at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })})`}
          </div>
        )}

        <input
          ref={inputRef}
          className="f-dw-input"
          type="number"
          step="0.001"
          inputMode="decimal"
          placeholder={lastValue || '0.000'}
          value={value}
          onChange={e => { setValue(e.target.value); setError(null); }}
        />
        <span className="f-dw-unit">{unit}</span>

        {error && (
          <div className="f-dw-error-block">
            <div className="f-dw-error-msg">{error}</div>
            {error.includes('lower than last') && (
              <label className="f-dw-rollover-label">
                <input
                  type="checkbox"
                  checked={rollover}
                  onChange={e => setRollover(e.target.checked)}
                />
                {' '}This meter rolled over or was replaced
              </label>
            )}
          </div>
        )}
      </div>

      <div className="f-dw-actions">
        <button className="f-dw-skip" onClick={skip} type="button">Skip</button>
        <button className="f-dw-next" onClick={submit} disabled={!value} type="button">Next →</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add "Meter Readings" tile to Field.jsx action grid**

In `frontend/src/screens/Field.jsx`, import `DockwalkFlow` and add the tile:

```jsx
import DockwalkFlow from './field/DockwalkFlow';

// In the ACTIONS array/grid, add:
{ id: 'dockwalk', label: 'Meter Readings', sub: 'Enter daily utility readings', icon: <ZapIcon /> }

// In the active-screen switch:
if (active === 'dockwalk') return <DockwalkFlow onBack={() => setActive(null)} />;
```

- [ ] **Step 3: Add dockwalk styles**

Add to the management system's CSS (wherever field app styles live):

```css
/* ── Dockwalk Flow ──────────────────────────────────────────────── */
.f-dw-root      { min-height: 100vh; background: #f4f6f8; display: flex; flex-direction: column; }
.f-dw-topbar    { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #1a2d4a; }
.f-dw-back      { background: none; border: none; color: rgba(255,255,255,0.8); font-size: 15px; font-weight: 600; cursor: pointer; }
.f-dw-progress  { color: rgba(255,255,255,0.6); font-size: 14px; }
.f-dw-card      { background: #fff; margin: 16px; border-radius: 12px; padding: 20px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
.f-dw-berth     { font-size: 22px; font-weight: 800; color: #1a2d4a; margin-bottom: 4px; }
.f-dw-meter-type { font-size: 13px; color: rgba(0,0,0,0.45); margin-bottom: 12px; }
.f-dw-last      { font-size: 13px; color: rgba(0,0,0,0.5); margin-bottom: 16px; }
.f-dw-input     { width: 100%; font-size: 32px; font-weight: 700; border: 2px solid #ddd; border-radius: 6px; padding: 12px; font-family: 'IBM Plex Mono', monospace; color: #1a2d4a; box-sizing: border-box; }
.f-dw-input:focus { border-color: #1a2d4a; outline: none; }
.f-dw-unit      { font-size: 14px; color: rgba(0,0,0,0.4); margin-top: 4px; display: block; }
.f-dw-error-block { margin-top: 12px; padding: 12px; background: #fff3f3; border-radius: 6px; border: 1px solid #f5c6cb; }
.f-dw-error-msg   { font-size: 14px; color: #c0392b; margin-bottom: 8px; }
.f-dw-rollover-label { font-size: 14px; color: #1a2d4a; display: flex; align-items: center; gap: 8px; cursor: pointer; }
.f-dw-actions   { display: flex; gap: 12px; padding: 16px; margin-top: auto; }
.f-dw-skip      { flex: 1; padding: 14px; background: #f4f6f8; border: none; border-radius: 6px; font-size: 16px; font-weight: 600; cursor: pointer; color: rgba(0,0,0,0.5); }
.f-dw-next      { flex: 2; padding: 14px; background: #1a2d4a; border: none; border-radius: 6px; font-size: 16px; font-weight: 700; cursor: pointer; color: #fff; }
.f-dw-next:disabled { opacity: 0.4; cursor: not-allowed; }
.f-dw-done      { margin: 32px 16px; text-align: center; }
.f-dw-done-title { font-size: 24px; font-weight: 800; color: #1a2d4a; margin-bottom: 8px; }
.f-dw-done-stats { font-size: 16px; color: rgba(0,0,0,0.5); }
.f-dw-error     { padding: 16px; color: #c0392b; font-size: 15px; }
```

- [ ] **Step 4: Commit**

```
git add frontend/src/screens/field/DockwalkFlow.jsx frontend/src/screens/Field.jsx
git commit -m "feat(field): DockwalkFlow rapid meter reading entry with rollover support"
```

---

### Task 13: Admin Mobile Configurator

**Files:**
- Create: `frontend/src/screens/settings/MobileConfigTab.jsx`
- Modify: relevant settings screen to add the tab

- [ ] **Step 1: Create MobileConfigTab.jsx**

```jsx
// frontend/src/screens/settings/MobileConfigTab.jsx
import { useState, useEffect } from 'react';
import api from '../../api';

function Toggle({ label, desc, checked, onChange }) {
  return (
    <div className="mc-toggle-row">
      <div>
        <div className="mc-toggle-label">{label}</div>
        <div className="mc-toggle-desc">{desc}</div>
      </div>
      <button
        className={`mc-toggle-btn${checked ? ' on' : ''}`}
        onClick={() => onChange(!checked)}
        type="button"
        aria-pressed={checked}
      >
        {checked ? 'ON' : 'OFF'}
      </button>
    </div>
  );
}

export default function MobileConfigTab({ marina }) {
  const [config, setConfig]   = useState(marina?.app_config || {});
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

  useEffect(() => { setConfig(marina?.app_config || {}); }, [marina]);

  function patch(updates) {
    const next = { ...config, ...updates };
    setConfig(next);
    api.patch('/api/v1/marina/app-config/', updates)
      .catch(() => alert('Save failed. Please try again.'));
  }

  function saveContent(e) {
    e.preventDefault();
    setSaving(true);
    api.patch('/api/v1/marina/app-config/', {
      wifi_name:    config.wifi_name    || '',
      wifi_password: config.wifi_password || '',
      local_guide:  config.local_guide  || '',
      brand_color:  config.brand_color  || '#0c1f3d',
    })
      .then(() => { setSaved(true); setTimeout(() => setSaved(false), 2000); })
      .catch(() => alert('Save failed.'))
      .finally(() => setSaving(false));
  }

  return (
    <div className="mc-root">
      {/* Brand & Identity */}
      <div className="mc-section-title">Brand &amp; Identity</div>
      <div className="mc-card">
        <label className="mc-label">Primary Brand Color</label>
        <div className="mc-color-row">
          <input
            type="color"
            className="mc-color-picker"
            value={config.brand_color || '#0c1f3d'}
            onChange={e => setConfig(c => ({ ...c, brand_color: e.target.value }))}
            onBlur={e => patch({ brand_color: e.target.value })}
          />
          <input
            type="text"
            className="mc-color-hex"
            value={config.brand_color || '#0c1f3d'}
            onChange={e => setConfig(c => ({ ...c, brand_color: e.target.value }))}
            onBlur={e => /^#[0-9a-fA-F]{6}$/.test(e.target.value) && patch({ brand_color: e.target.value })}
            maxLength={7}
          />
        </div>
      </div>

      {/* Feature Toggles */}
      <div className="mc-section-title">Feature Toggles</div>
      <div className="mc-card">
        <Toggle
          label="Boatyard Services"
          desc="Members can submit work orders and maintenance requests"
          checked={config.enable_boatyard !== false}
          onChange={v => patch({ enable_boatyard: v })}
        />
        <Toggle
          label="Utility Tracking"
          desc="Members see their Dockwalk meter readings and usage costs"
          checked={config.enable_utilities !== false}
          onChange={v => patch({ enable_utilities: v })}
        />
        <Toggle
          label="Document Vault"
          desc="Members must upload insurance and registration documents"
          checked={config.enable_documents !== false}
          onChange={v => patch({ enable_documents: v })}
        />
      </div>

      {/* Content */}
      <div className="mc-section-title">Content</div>
      <form className="mc-card" onSubmit={saveContent}>
        <label className="mc-label">WiFi Network Name</label>
        <input className="mc-input" type="text" value={config.wifi_name || ''}
          onChange={e => setConfig(c => ({ ...c, wifi_name: e.target.value }))} />
        <label className="mc-label">WiFi Password</label>
        <input className="mc-input" type="text" value={config.wifi_password || ''}
          onChange={e => setConfig(c => ({ ...c, wifi_password: e.target.value }))} />
        <label className="mc-label">Local Guide</label>
        <textarea className="mc-textarea" rows={5}
          placeholder="e.g.&#10;Best pizza: Joe's Catch +1 555 0123&#10;Emergency tow: SeaTow +1 555 9999"
          value={config.local_guide || ''}
          onChange={e => setConfig(c => ({ ...c, local_guide: e.target.value }))}
        />
        <button className="mc-save" type="submit" disabled={saving}>
          {saved ? 'Saved' : saving ? 'Saving…' : 'Save Content'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Wire MobileConfigTab into the Settings screen**

Find the marina Settings screen in `frontend/src/` (likely `SettingsScreen.jsx` or similar). Add a "Mobile App" tab item that renders `<MobileConfigTab marina={marina} />`.

- [ ] **Step 3: Add Mobile Config styles to the management system CSS**

```css
/* ── Mobile Configurator ─────────────────────────────────────────── */
.mc-root          { padding: 0 0 40px; }
.mc-section-title { font-size: 12px; font-weight: 700; color: rgba(0,0,0,0.4); text-transform: uppercase; letter-spacing: 0.5px; padding: 20px 0 6px; }
.mc-card          { background: #fff; border-radius: 8px; padding: 16px; margin-bottom: 4px; border: 1px solid rgba(0,0,0,0.08); }
.mc-label         { display: block; font-size: 12px; font-weight: 600; color: rgba(0,0,0,0.5); margin-bottom: 6px; margin-top: 12px; }
.mc-label:first-child { margin-top: 0; }
.mc-input         { width: 100%; border: 1px solid #ddd; border-radius: 4px; padding: 8px 10px; font-size: 14px; box-sizing: border-box; }
.mc-textarea      { width: 100%; border: 1px solid #ddd; border-radius: 4px; padding: 8px 10px; font-size: 14px; resize: vertical; box-sizing: border-box; font-family: inherit; }
.mc-save          { margin-top: 16px; padding: 10px 24px; background: #0c1f3d; color: #fff; border: none; border-radius: 4px; font-size: 14px; font-weight: 600; cursor: pointer; }
.mc-save:disabled { opacity: 0.5; }
.mc-color-row     { display: flex; align-items: center; gap: 10px; }
.mc-color-picker  { width: 40px; height: 40px; border: 1px solid #ddd; border-radius: 4px; padding: 2px; cursor: pointer; }
.mc-color-hex     { width: 100px; border: 1px solid #ddd; border-radius: 4px; padding: 8px 10px; font-size: 14px; font-family: monospace; }
.mc-toggle-row    { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px solid rgba(0,0,0,0.06); }
.mc-toggle-row:last-child { border-bottom: none; }
.mc-toggle-label  { font-size: 14px; font-weight: 600; color: #1a2d4a; margin-bottom: 2px; }
.mc-toggle-desc   { font-size: 12px; color: rgba(0,0,0,0.45); }
.mc-toggle-btn    { padding: 6px 14px; border: 2px solid #ddd; border-radius: 20px; background: #fff; font-size: 13px; font-weight: 700; cursor: pointer; color: rgba(0,0,0,0.4); transition: all 0.15s; }
.mc-toggle-btn.on { background: #27ae60; border-color: #27ae60; color: #fff; }
```

- [ ] **Step 4: Commit**

```
git add frontend/src/screens/settings/MobileConfigTab.jsx
git commit -m "feat(admin): Mobile App configurator with brand, feature toggles, and content"
```

---

### Task 14: Full integration check

- [ ] **Step 1: Start dev server and log in as a guest**

```
cd portal && npm run dev
```
Navigate to `/{slug}` as a guest. Confirm:
- After check-in, `BoardingPass` renders (not `WalletCard`)
- Berth code shows in large text
- Gate PIN and WiFi appear with copy buttons
- Shower tokens show if any exist in test data
- Map section renders SVG (even if empty)
- Extend Stay button taps through to `ExtendStayScreen`

- [ ] **Step 2: Log in as a member**

Confirm:
- 4-tab bottom nav renders
- Home tab shows gate PIN in large monospace
- Utilities tab loads meters (or shows "no meters" state)
- Services tab shows the new Work Order row
- Account tab shows invoice list and document vault

- [ ] **Step 3: Test feature toggles**

Set `enable_boatyard: false` in the marina's `app_config` via admin. Confirm:
- Services tab disappears from the bottom nav
- Direct `POST /portal/member/work-orders/` returns 403

- [ ] **Step 4: Fix any visual issues found**

Tweak spacing, font sizes, or colors as needed. Commit fixes.

- [ ] **Step 5: Final commit**

```
git add -p
git commit -m "fix(portal): integration tweaks from end-to-end testing"
```
