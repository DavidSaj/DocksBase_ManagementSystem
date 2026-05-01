# Mobile App Expansion — Design Spec

**Date:** 2026-05-01  
**Scope:** Expand the Staff Field App (`/field`) and Boater Portal (`/portal`) into fully usable mobile experiences.

---

## Access Model

| Role | How they get in | Where they land |
|------|----------------|-----------------|
| Staff / Manager | Email + password login at app.docksbase.com | `/field` (auto-routed by role) |
| Boater | Magic link emailed by marina staff | `/portal` (auto-routed by role) |
| Owner | Email + password login | `/` (full desktop dashboard) |

All three share the same React app and Django backend. Role-based routing in `App.jsx` handles the split. The app is a PWA — "Add to Home Screen" on any phone browser creates a full-screen native-feeling icon with no browser chrome.

---

## Part 1: Staff Field App (`/field`)

### Current State
`Field.jsx` shows a single maintenance task list. Staff can tap a task, start it, and mark it done with notes + photo.

### New Architecture

`Field.jsx` becomes a shell with a **bottom tab bar** — two tabs:
- **Actions** (home): quick-action grid
- **Tasks**: existing maintenance task screen (extracted to `field/TaskList.jsx`)

### Home Screen — Quick Action Grid

Six large tap-target tiles arranged in a 2×3 grid:

| Tile | Icon | Opens |
|------|------|-------|
| Check in vessel | ✅ | `CheckInFlow.jsx` |
| Check out vessel | 🚪 | `CheckOutFlow.jsx` |
| Log task | 🔧 | `LogTaskFlow.jsx` |
| Approve crane | 🏗️ | `CraneApprovalFlow.jsx` |
| Today's arrivals | 🚢 | `ArrivalsList.jsx` |
| My tasks | 📋 | Switches to Tasks tab |

Each tile is a full-width button with a large icon, bold label, and a subtle count badge where relevant (e.g. "3 pending" on Approve Crane).

### Flow Screens

**CheckInFlow.jsx**
1. List of today's expected arrivals (bookings with status `pending`, arriving today) fetched from `GET /api/v1/reservations/?arriving_today=true`
2. Tap a booking → detail card: vessel name, length, requested berth type, boater contact
3. "Check In" button → `PATCH /api/v1/reservations/{id}/` with `status: checked_in` and `actual_arrival: today`
4. Success screen → back to grid

**CheckOutFlow.jsx**
1. List of active bookings (`status: checked_in`) from `GET /api/v1/reservations/?status=checked_in`
2. Tap a booking → detail: vessel, berth, arrival date, nights stayed, estimated amount
3. "Check Out" button → `PATCH /api/v1/reservations/{id}/` with `status: checked_out` and `actual_departure: today`
4. Success screen with invoice amount shown → back to grid

**LogTaskFlow.jsx**
1. Single form screen: Title (text), Priority (urgent/high/medium/low selector), Asset (optional text), Notes (optional textarea)
2. Submit → `POST /api/v1/maintenance/tasks/` assigning to current user's marina
3. Success toast → back to grid

**CraneApprovalFlow.jsx**
1. List of pending crane/haul-out requests from `GET /api/v1/boatyard/crane-requests/?status=pending` (or haul-out queue)
2. Each card: vessel name, service type (haul-out/launch), requested date, notes
3. Two buttons: **Approve** → `PATCH` with `status: approved` | **Reject** → `PATCH` with `status: rejected`
4. List updates optimistically

**ArrivalsList.jsx**
1. Read-only list of all bookings arriving today and tomorrow
2. Vessel name, berth assignment, arrival time (if set), status badge
3. No actions — informational only

### File Map

| File | Action |
|------|--------|
| `frontend/src/screens/Field.jsx` | Refactor — becomes shell with bottom nav + action grid |
| `frontend/src/screens/field/TaskList.jsx` | New — extract existing task list from Field.jsx |
| `frontend/src/screens/field/CheckInFlow.jsx` | New |
| `frontend/src/screens/field/CheckOutFlow.jsx` | New |
| `frontend/src/screens/field/LogTaskFlow.jsx` | New |
| `frontend/src/screens/field/CraneApprovalFlow.jsx` | New |
| `frontend/src/screens/field/ArrivalsList.jsx` | New |

No new backend endpoints needed — all data available via existing reservation, maintenance, and boatyard APIs.

---

## Part 2: Boater Portal (`/portal`)

### Current State
Three tabs: **Invoices** (view + pay), **Absence** (report form), **Crane** (request + history).

### New Tabs

Tab bar becomes: `Invoices | Absence | Crane | Berth | Vessel`

---

### My Berth Tab

Displays the boater's active and upcoming bookings with berth detail.

**Data:** `GET /api/v1/portal/berth/` — new endpoint  
Returns the member's bookings (active + future) joined with berth/pier info.

**UI:**
- If active booking: prominent card with berth number, pier name, arrival date, departure date, nights remaining, status badge
- If upcoming bookings: secondary list below
- If none: empty state — "No berth currently assigned. Contact the marina to make a booking."

**Backend — new:**
- `PortalBerthView` (ListAPIView, `IsBoater` permission)
- Queries `Booking.objects.filter(member=member, status__in=['checked_in', 'pending']).select_related('berth__pier')`
- Serializer: `PortalBerthSerializer` — returns booking dates, status, berth number, pier name

---

### My Vessel Tab

Displays the boater's vessel on file at the marina, including certificate expiry status.

**Data:** `GET /api/v1/portal/vessel/` — new endpoint  
Returns the vessel linked to the member profile, plus all vessel certificates.

**UI:**
- Vessel card: name, type, length (m), beam (m), registration number, flag/country
- Certificate list: each cert shows type, expiry date, and a color-coded status:
  - 🟢 Green — valid (>30 days)
  - 🟡 Amber — expiring within 30 days
  - 🔴 Red — expired
- If no vessel linked: empty state — "No vessel on file. Contact the marina."

**Backend — new:**
- `PortalVesselView` (RetrieveAPIView, `IsBoater` permission)
- Queries `Vessel.objects.filter(owner=member).prefetch_related('certificates').first()`
- Serializers: `PortalVesselSerializer`, `PortalVesselCertificateSerializer`

### File Map

| File | Action |
|------|--------|
| `frontend/src/screens/BoaterPortal.jsx` | Modify — add Berth and Vessel tabs |
| `frontend/src/hooks/usePortalBerth.js` | New |
| `frontend/src/hooks/usePortalVessel.js` | New |
| `backend/apps/portal/views.py` | Add `PortalBerthView`, `PortalVesselView` |
| `backend/apps/portal/serializers.py` | Add berth and vessel serializers |
| `backend/apps/portal/urls.py` | Add `berth/` and `vessel/` URL patterns |
| `backend/apps/portal/tests.py` | Add tests for both new endpoints |

---

## Styling

- Staff Field App: existing inline styles (dark navy header `#1a2d4a`, card-based list) — keep consistent with current Field.jsx aesthetic
- Boater Portal: existing `.portal-*` CSS classes — new tabs follow same pattern as existing three tabs
- No new CSS frameworks — use what's already in `app.css` and `tokens.css`

---

## Out of Scope (for now)

- Boater booking flow (Book a Stay — deferred to later)
- Push notification implementation (manifest exists, service worker not yet wired)
- Offline caching beyond PWA manifest
- Messaging between boater and marina
