# Boater Portal Redesign — Design Spec
**Date:** 2026-05-12
**Status:** Approved

---

## Overview

A full redesign of the boater-facing PWA (`/portal`) to deliver two distinct role-based experiences on a single codebase. Transient Guests get a frictionless hotel-style boarding pass. Seasonal Members get a utility-focused 4-tab dashboard. Harbor Masters get a Mobile Configurator in the admin dashboard to control what their boaters see.

---

## Architecture

### Role Detection
`UserContext.jsx` already exposes `capabilities.isGuest` and `capabilities.isMember`. `AppShell.jsx` branches on these to render either the full-screen `BoardingPass` (guest) or the 4-tab `MemberShell` (member). No structural change to routing.

### Tenant Config
`TenantContext.jsx` already calls `GET /{slug}/config/` on load. The marina's `app_config` JSON is added to this response — no extra round-trip. Config is available before first render via context.

---

## Section 1: Data Layer

### Marina model — new `app_config` field

```python
app_config = models.JSONField(default=dict)
```

Shape:
```json
{
  "brand_color": "#0c1f3d",
  "logo_url": "https://...",
  "enable_boatyard": true,
  "enable_utilities": true,
  "enable_documents": true,
  "wifi_name": "MarinaNet",
  "wifi_password": "anchor123",
  "local_guide": "Free text block — HM writes recommended restaurants, mechanics, emergency contacts here."
}
```

Individual booleans are stored in the JSON (not separate columns) because the config shape will grow and we never filter marinas by these values.

### Existing models wired — no schema changes needed

| Model | Used for |
|---|---|
| `WashToken` (utilities app) | Guest shower/laundry codes + expiry display |
| `MemberDocument` (documents app) | Document Vault (insurance/registration + expiry status) |
| `SmartMeter` + `MeterReading` (utilities app) | Dockwalk dashboard — `source='manual'` readings |
| `Amenity` (berths app) | Map pin overlay — canvas_x, canvas_y positions |

### No new models
The Local Guide is a free-text block inside `app_config`. No `LocalGuideEntry` model needed.

---

## Section 2: API Layer

### Extend existing tenant config endpoint
`GET /{slug}/config/` — add `app_config` to the serializer response. No new endpoint.

### Guest endpoints — extensions to existing `/portal/checkin/`

**`GET /portal/checkin/bookings/{id}/`** (existing)
Add `wash_tokens` array to the serializer:
```json
"wash_tokens": [
  { "facility": "shower", "token_code": "AB4921", "expires_at": "2026-05-13T12:00:00Z" }
]
```

**`GET /portal/checkin/map/`** (new)
Returns the marina SVG canvas dimensions + amenity pin list (type, label, canvas_x, canvas_y). Used to render the DocksBase map with the guest's slip highlighted and amenity icons overlaid.

### Member endpoints — all `IsBoater` permission, prefix `/api/v1/portal/`

| Endpoint | Method | Purpose | Toggle guard |
|---|---|---|---|
| `/portal/gate/` | GET | Member's active gate codes from marina wallet | — |
| `/portal/utilities/` | GET | Active meters with last reading + billing-cycle cost estimate | `enable_utilities` |
| `/portal/work-orders/` | GET, POST | List submitted work orders; submit new | `enable_boatyard` |
| `/portal/invoices/` | GET | Paginated invoice list with status | — |
| `/portal/documents/` | GET, POST | MemberDocument list; upload new file to Supabase Storage | `enable_documents` |
| `/portal/documents/{id}/` | DELETE | Remove a document | `enable_documents` |

**Feature-toggle enforcement is mandatory at the API layer.** Hiding tabs in the frontend is not sufficient — a cached PWA, a malicious actor, or a direct API call can bypass UI controls. Each guarded endpoint must inspect `request.tenant.app_config` at the top of the view and return `HTTP 403 Forbidden` with body `{"detail": "This feature is not enabled for this marina."}` if the corresponding toggle is `false`. The frontend toggle check is a UX convenience only.

### Admin endpoint — manager/owner permission

**`PATCH /api/v1/marina/app-config/`**
Accepts partial JSON updates to `app_config`. Logo and marina map are file uploads; URLs are stored in `app_config` after upload to Supabase Storage.

### Dockwalk staff endpoints — staff permission

**`GET /api/v1/utilities/dockwalk/`**
Returns ordered list of active `SmartMeter` records for the current user's marina, each with: `id`, `label`, `meter_type`, `berth_code`, `last_reading` (value + timestamp).

**`POST /api/v1/utilities/dockwalk/{meter_id}/reading/`**
Body: `{ "reading_kwh": 1854.2, "rollover": false }` or `{ "reading_m3": 42.1, "rollover": false }`.
- If `new_reading < last_reading` AND `rollover: false` → return 400 with message "Reading is lower than last entry — check the meter or mark as rollover."
- If `new_reading < last_reading` AND `rollover: true` → accept the reading; delta = `new_reading` (treating the meter as reset to 0). Updates `SmartMeter.last_polled` as the new baseline.
- Creates `MeterReading(source='manual')`.
- Calculates kWh/m³ delta, looks up applicable rate via `ChargeableItem`.
- Creates an **unbilled charge**: a `ChargeableItem` line attached to the member with `invoice=null`. Never touches an existing invoice. The monthly billing sweep collects all `invoice=null` utility charges and attaches them to the new invoice when it is generated.
- Returns updated meter state.

---

## Section 3: Frontend — Guest Boarding Pass

### Shell change
`AppShell.jsx`: when `capabilities.isGuest`, render `<BoardingPass />` directly — no `BottomNav`, no tab shell.

### `BoardingPass.jsx` (replaces `WalletCard.jsx`)

Full-screen scrollable page. Fixed header: marina logo (from `app_config.logo_url`, falls back to marina name text) + marina name + gear icon (top-right → settings/logout sheet).

Brand color from `app_config.brand_color` injected as `--color-primary` CSS variable on mount.

**Section 1 — Slip**
Prominent berth code (large, bold), pier name, check-in and check-out dates/times.

**Section 2 — Access**
- Gate PIN: large monospace display, tap-to-copy with brief "Copied" feedback.
- WiFi: network name + password, each with copy button.
- Shower/Laundry tokens: one row per `WashToken` — facility label, token code, expiry countdown ("Valid until tomorrow 12:00 PM"). Displayed only if tokens exist.

**Section 3 — Marina Map**
Renders the marina's existing DocksBase SVG canvas. Guest's assigned slip is highlighted (filled accent color). Amenity icons overlaid at their `canvas_x`, `canvas_y` positions: fuel dock, showers, trash, harbour master. Pinch-to-zoom via CSS `touch-action: pinch-zoom` on the SVG container.

**Section 4 — Local Guide**
Rendered only if `app_config.local_guide` is non-empty. Section header "Local Guide". Body renders the HM's free-text block using a simple markdown-to-HTML renderer (no library — just `\n` → `<br>`, `**x**` → `<strong>x</strong>`).

**Section 5 — Extend Stay**
Full-width primary button "Request Extra Night" → navigates to existing `ExtendStayScreen`.

---

## Section 4: Frontend — Member 4-Tab Shell

### `MemberShell.jsx` (new, replaces direct `AppShell` rendering for members)
Wraps the 4-tab layout. Reads `app_config` from `TenantContext` to conditionally hide tabs.

### Role-aware `BottomNav`
`BottomNav` receives a `tabs` prop (array) instead of a hardcoded list. `MemberShell` computes the tab array:

```js
const tabs = [
  { id: 'home',      label: 'Home',      always: true },
  { id: 'utilities', label: 'Utilities', enabled: app_config.enable_utilities },
  { id: 'services',  label: 'Services',  enabled: app_config.enable_boatyard },
  { id: 'account',   label: 'Account',   always: true },
].filter(t => t.always || t.enabled);
```

### Tab 1 — `MemberHomeTab.jsx`
- **Gate Key card**: marina name subheader, gate PIN in large monospace, tap-to-copy. If multiple gate codes exist, show each with its label.
- **Alert strip**: scans for unpaid invoices and expiring documents. Each alert is a tappable row that deep-links to the relevant tab section. Zero alerts → strip hidden.

### Tab 2 — `UtilitiesTab.jsx`
One card per active meter (electricity + water). Each card shows:
- Meter type icon + berth label
- Last reading value (kWh or m³)
- "Last updated: Today 09:14" — explicitly human-entry timestamp so boaters understand the cadence
- Billing-cycle cost estimate to date (e.g. "£42.60 this month")

No live polling. Data fetched once on tab mount, pull-to-refresh for updates.

### Tab 3 — `ServicesTab.jsx` (extended)
Existing rows: Crane/Lift Request, Extend Stay, Report Issue.
New row: **Boatyard Work Order** → `WorkOrderScreen.jsx`
- Description textarea (required)
- Urgency selector: Routine / Urgent / Emergency
- Submit → `POST /api/v1/portal/work-orders/`
- Confirmation screen with reference number

Below active services: a read-only list of submitted work orders (status badges: Received / In Progress / Done).

### Tab 4 — `AccountTab.jsx` (filled in)
Three stacked sections:

**Financial Ledger**
Invoice list — each row: invoice number, amount, due date, status badge. "Pay Now" button on unpaid invoices → Stripe payment sheet. Pagination via "Load more".

**Document Vault**
One row per `MemberDocument` type (Insurance, Registration):
- If `status: pending_upload` → upload button → file picker → `POST /api/v1/portal/documents/` (multipart)
- If uploaded/verified → filename, expiry date, color-coded status badge (green/amber/red)
- Tap to view (opens file URL in new tab)
- Shown only if `app_config.enable_documents === true`

**Settings**
- Update saved card → Stripe billing portal redirect
- Logout button

---

## Section 5: Dockwalk Staff Interface (Field App)

### New quick-action tile in `Field.jsx`
"Meter Readings" tile added to the existing action grid. Opens `DockwalkFlow.jsx`.

### `DockwalkFlow.jsx`
Rapid one-meter-per-screen entry flow:

1. Fetches `GET /api/v1/utilities/dockwalk/` — ordered meter list.
2. Progress indicator: "X left" count in header.
3. Each screen shows: berth code, meter type, pedestal label, last reading + timestamp.
4. Numeric input auto-focused (numeric keyboard on mobile). Placeholder shows last reading value as a hint.
5. "Next →" submits the reading and advances. "Skip" records nothing and advances.
6. If the submitted value is lower than the last reading, the backend returns 400. The UI shows: "Reading is lower than last entry — check the meter." Below the error, a checkbox appears: "This meter rolled over or was replaced." Checking it re-enables "Next →" and sends `rollover: true` with the next submission. The API then accepts the lower value and calculates the delta from 0.
7. Final screen: summary "11 entered, 1 skipped" with a "Done" button back to the action grid.

### `MeterAssignFlow.jsx` (separate quick action: "Assign Meter")
Staff scans pedestal barcode via device camera → shows berth selector → saves `device_id` to `SmartMeter` record. One-time setup per pedestal.

---

## Section 6: Admin Mobile Configurator

### Location
New "Mobile App" tab in the marina's Settings area in the management system desktop app.

### Layout
Three card sections:

**Brand & Identity**
- Logo upload (image file → Supabase Storage → URL saved to `app_config.logo_url`)
- Primary color: hex text input + color swatch preview. Saved to `app_config.brand_color`.

**Feature Toggles**
Three ON/OFF toggle switches:
- Enable Boatyard Services (controls Services tab visibility + work order row)
- Enable Utility Tracking (controls Utilities tab visibility)
- Enable Document Vault (controls Document Vault section in Account tab)

Each toggle fires `PATCH /api/v1/marina/app-config/` immediately on change (no save button needed — instant feedback).

**Content**
- WiFi Name field
- WiFi Password field
- Local Guide textarea (placeholder: "e.g. Best pizza: Fisherman's Catch +1 555 0123. Emergency tow: SeaTow +1 555 9999")
- Marina Map upload (PDF or JPG → Supabase Storage)

Single "Save Content" button at the bottom of this section.

---

## File Map

### Backend

| File | Change |
|---|---|
| `accounts/models.py` | Add `app_config = JSONField(default=dict)` to `Marina` |
| `portal/views.py` | Add `PortalGateView`, `PortalUtilitiesView`, `PortalWorkOrderView`, `PortalInvoiceView`, `PortalDocumentView` |
| `portal/serializers.py` | Add serializers for all new views; extend checkin booking serializer with `wash_tokens` |
| `portal/urls.py` | Wire new portal endpoints |
| `utilities/views.py` | Add `DockwalkListView`, `DockwalkReadingView` |
| `utilities/urls.py` | Wire dockwalk endpoints |
| `marina/views.py` | Add `AppConfigView` (PATCH) |
| `marina/urls.py` | Wire app-config endpoint |

### Frontend (portal)

| File | Change |
|---|---|
| `src/context/TenantContext.jsx` | Expose `appConfig` from tenant response |
| `src/components/shell/AppShell.jsx` | Branch: `isGuest` → `BoardingPass`; `isMember` → `MemberShell` |
| `src/components/shell/BottomNav.jsx` | Accept `tabs` prop instead of hardcoded list |
| `src/components/shell/BoardingPass.jsx` | New — full guest boarding pass |
| `src/components/shell/MemberShell.jsx` | New — 4-tab member shell |
| `src/screens/tabs/MemberHomeTab.jsx` | New — gate key + alert strip |
| `src/screens/tabs/UtilitiesTab.jsx` | New — dockwalk meter dashboard |
| `src/screens/tabs/ServicesTab.jsx` | Extend — add work order row + submitted list |
| `src/screens/tabs/AccountTab.jsx` | Fill in — ledger + document vault + settings |
| `src/screens/WorkOrderScreen.jsx` | New — submit work order form |
| `src/styles/portal.css` | Add boarding pass styles; CSS variable `--color-primary` |

### Frontend (management system)

| File | Change |
|---|---|
| `src/screens/settings/MobileConfigTab.jsx` | New — brand, toggles, content sections |
| `src/hooks/useAppConfig.js` | New — fetch + patch app_config |

---

## Design System Rules

- All new styles follow existing portal CSS conventions (`p-` prefix for portal classes)
- Brand color applied as `--color-primary` CSS variable — replaces hardcoded `#0c1f3d` on primary buttons and active tab indicators in the portal only (admin UI unchanged)
- No inline styles in new components — all rules in `portal.css`
- Lucide SVG icons only — no emoji
- IBM Plex Sans throughout
- Cards: `border-radius: 12px`, `var(--shadow-card)`, `1px solid rgba(0,0,0,0.1)`

---

## Out of Scope (v1)

- QR/barcode gate key rendering (PIN display only)
- IoT/hardware meter integration (Dockwalk manual entry only)
- Push notifications for work order status updates
- In-app messaging between boater and marina
- Boater self-service booking from the member portal
- Smart Meter live polling
