# DocksBase — System Documentation

**Document version:** 2.0
**Date:** 2026-04-25
**Status:** Current

---

## Overview

DocksBase is a harbor and marina management platform for harbor masters, dock masters, and marina operators. It provides a unified operational interface covering berth management, vessel tracking, reservations, billing, staff coordination, boatyard operations, eSignature workflows, and port mapping.

---

## Architecture

```
DocksBase_ManagementSystem/
├── frontend/        React + Vite (current phase: mock data only)
├── backend/         Planned — Django REST Framework (future)
├── docs/            Architecture and design documentation
└── README.md
```

### Current Phase: Frontend-Only with Mock Data

All data is defined in `frontend/src/data/mock.js` as named exports. No API calls are wired. The UI is a fully interactive prototype suitable for investor demos and UX validation.

### Target Stack (full system)

| Layer      | Technology                      |
|------------|---------------------------------|
| Frontend   | React 18, Vite, plain CSS       |
| Backend    | Django, Django REST Framework   |
| Database   | PostgreSQL                      |
| Auth       | Django sessions / JWT           |
| Real-time  | Django Channels (WebSocket)     |
| Deployment | TBD                             |

---

## Design System

### Fonts

| Role          | Font               | Usage                              |
|---------------|--------------------|------------------------------------|
| App UI        | IBM Plex Sans      | All data interfaces, tables, forms |
| Serif display | Cormorant Garamond | Landing page headlines             |
| Branding      | Jost               | Logo wordmark, sidebar             |

### Color Palette

| Token      | Value     | Use                            |
|------------|-----------|--------------------------------|
| `--navy`   | `#0c1f3d` | Sidebar, primary buttons       |
| `--gold`   | `#b8965a` | Active indicator, confirm CTA  |
| `--teal`   | `#1a6b6e` | Teal accent, status            |
| `--bg`     | `#f4f3f0` | Page background                |
| `--red`    | `#c0392b` | Danger, overdue                |
| `--orange` | `#dd5b00` | Warning, pending               |
| `--green`  | `#1a8c2e` | Success, paid                  |
| `--blue`   | `#0075de` | Links, info badges             |

### Component Classes (CSS)

All component styles live in `frontend/src/styles/app.css`. Flat BEM-like naming:

- Layout: `.app`, `.sb`, `.main`, `.content`, `.grid-2`
- Buttons: `.btn`, `.btn-primary`, `.btn-gold`, `.btn-ghost`, `.btn-danger`, `.btn-sm`
- Cards: `.card`, `.card-header`, `.card-header-title`, `.card-body`
- Badges: `.badge`, `.badge-green`, `.badge-blue`, `.badge-orange`, `.badge-red`, `.badge-gray`, `.badge-gold`, `.badge-teal`, `.badge-navy`
- Tables: `.tbl`, `.tbl-name`, `.tbl-sub`
  - `th` padding: `12px 14px 8px` — 12px top gives column headers breathing room from the card edge
  - `td` padding: `10px 14px`
- Tabs: `.tabs`, `.tab`, `.tab.active`
- Detail panel: `.detail`, `.detail-title`, `.detail-sub`, `.detail-row`, `.detail-key`, `.detail-val`, `.detail-actions`
- Section header: `.sec-hdr`, `.sec-hdr-title`
- eSign: `.template-card`, `.template-card-name`
- Launch queue: `.lq-num`, `.weather-hold-banner`
- Fuel dock: `.fuel-berth`, `.fuel-berth-id`

---

## Application Screens

### Navigation Groups

**Operations:** Overview, Marina Map, Reservations, Vessels, Documents & eSign
**Yard & Crew:** Boatyard, Maintenance, Staff
**Finance:** Billing, Reports
**People:** Members
**Hospitality:** Restaurant, Events
**System:** Settings

---

### 1. Overview (`overview`)
Dashboard entry point:
- 5 stat cards: Berths Occupied, Arrivals Today, Available Slips, Pending Payments, Open Tasks
- Activity Log — chronological event feed
- Weather widget — temperature, wind, swell, visibility, tides
- Urgent panel — insurance expiries, overdue payments, safety flags
- Pending Bookings — quick-confirm actions

### 2. Marina Map (`map`)
Interactive top-down SVG harbor map:
- Animated water background (SVG feTurbulence + wave patterns)
- 3 piers (A, B, C) with individual slip cells
- Color-coded slip status: occupied (blue), available (green), reserved (gold), maintenance (red)
- Click slip → detail panel with vessel info and actions
- Shore buildings, compass rose, scale bar, depth soundings

### 3. Reservations (`reservations`)
7 tabs: **All / Transient / Seasonal / Pending / Overdue / Wait List / Fuel Dock**
- Booking tabs: table with booking ID, vessel/owner, slip, dates, type, status, amount; click row → side detail panel
- **Wait List** — applicant table with LOA, berth type, applied date, deposit amount/status (held/pending); summary cards showing total deposit value held
- **Fuel Dock** — live queue view with visual berth diagram (FD-1/FD-2) and ordered queue list with fuel type, quantity, arrival time, and status

### 4. Vessels (`vessels`)
3 tabs: **Registry / AIS Tracker / Certificates**
- Registry: vessel table with type, LOA, draft, berth, owner; click → detail panel
- AIS Tracker: live position simulation with vessel list and map placeholder
- Certificates: certification expiry tracking per vessel

### 5. Documents & eSign (`documents`)
3 tabs: **Templates / Envelopes / Mass Send**
- **Templates** — card grid of document templates with category badge, page/field count, uses, last-used date; Send/Preview/Edit actions
- **Envelopes** — filterable table (All/Pending/Completed/Expired) with status badges; click row → detail panel with audit trail and download PDF
- **Mass Send** — compose form (template, segment, expiry, optional message); recent mass sends list with per-template completion progress bar

### 6. Boatyard (`boatyard`)
8 tabs: **Haul-out Schedule / Launch Queue / Dry Storage Map / Work Orders / Parts & Inventory / Tools / Contractors / Facility Log**
- **Haul-out Schedule** — crane lifts and splashes table
- **Launch Queue** — dry stack day queue with weather hold toggle; card per request showing vessel, LOA, yard position, equipment, assigned tech, status; status-dependent action buttons
- **Dry Storage Map** — grid of lanes × columns showing vessel positions; blocked/occupied/available states
- **Work Orders** — card per WO with priority/status badges, estimate vs actual, description, assigned tech, status-driven actions (Authorise / Start Work / Mark Complete)
- **Parts & Inventory** — table with part number, category, supplier, cost/sell prices, stock vs PAR (red if below PAR)
- **Tools** — availability board grouped by category with status dots; calibration-due-within-30-days alert card; full register table with checkout/return/log-service actions
- **Contractors** — on-site contractor registry with trade and access period
- **Facility Log** — maintenance schedule for yard equipment with overdue/due-soon status

### 7. Maintenance (`maintenance`)
4 tabs: **Staff Tasks / Incidents / Asset Register / Defect Log**
- **Staff Tasks** — interactive checklist with priority and team assignment
- **Incidents** — incident report cards with severity and resolution actions
- **Asset Register** — table of marina assets with make/model, service dates, status (operational/due-service/under-repair); overdue highlighted red
- **Defect Log** — card per defect with severity/status/WO-ref badges; description block; status-driven actions (Acknowledge / Raise Work Order / Mark Resolved)

### 8. Staff (`staff`)
Staff register with rota, time tracking, and skills matrix.

### 9. Billing (`billing`)
5 tabs: **Invoices / Utility Meters / Fuel Dock POS / Aged Debtors / Accounts**
- **Invoices** — paid/unpaid/overdue summary chips; invoice table with chase action
- **Utility Meters** — electricity and water readings per berth with progress bars and estimated charge
- **Fuel Dock POS** — quick-sale product grid (diesel/petrol/pump-out/ice/shore power/merchandise); recent sales log
- **Aged Debtors** — bucket summary cards (0–7 / 8–30 / 31–60 days); full debtor table with days overdue and chase action
- **Accounts** — batch billing generator, CSV/PDF/XLSX exports, end-of-day Z-report, payment reconciliation

### 10. Reports (`reports`)
Revenue analytics, occupancy trends, yard throughput.

### 11. Members (`members`)
4 tabs: **Members & Owners / Document Vault / Communications / Segments**
- **Members & Owners** — registry table; click row → detail panel
- **Document Vault** — per-owner registration/insurance/lease status
- **Communications** — blast message form (email/SMS to segment or all)
- **Segments** — saved filter segments with member count and Send Message action; segment builder form

### 12. Restaurant (`restaurant`)
Menu management, table reservations, kitchen display system.

### 13. Events (`events`)
Venue hire, event scheduling, booking management.

### 14. Settings (`settings`)
Marina profile, user management, billing configuration.

---

## Mock Data Exports (`frontend/src/data/mock.js`)

| Export | Records | Used in |
|---|---|---|
| `PIERS` | 3 piers × ~8 slips | MarinaMap, Overview |
| `BOOKINGS` | ~12 | Reservations, Overview |
| `INVOICES` | ~10 | Billing |
| `MEMBERS` | ~8 | Members |
| `SEGMENTS` | 4 | Members |
| `HAUL_SCHEDULE` | ~6 | Boatyard |
| `DRY_STORAGE` | 4×6 grid | Boatyard |
| `WORK_ORDERS` | ~6 | Boatyard |
| `PARTS` | ~10 | Boatyard |
| `LAUNCH_REQUESTS` | 6 | Boatyard |
| `TOOLS` | 10 | Boatyard |
| `UTILITY_METERS` | ~6 | Billing |
| `DEBTORS` | ~6 | Billing |
| `ASSETS` | ~8 | Maintenance |
| `DEFECTS` | ~6 | Maintenance |
| `ESIGN_TEMPLATES` | 6 | Documents |
| `ENVELOPES` | 8 | Documents |
| `WAITLIST` | 5 | Reservations |
| `FUEL_QUEUE` | 4 | Reservations |
| `VESSELS` | ~8 | Vessels |
| `STAFF` | ~6 | Staff |
| `RESTAURANT_*` | various | Restaurant |
| `EVENTS` | ~4 | Events |

---

## File Map

```
frontend/src/
├── App.jsx                          App shell + screen router
├── main.jsx                         Entry point, CSS imports
├── styles/
│   ├── tokens.css                   CSS custom properties
│   └── app.css                      All component and layout CSS
├── data/
│   └── mock.js                      All mock data exports
├── components/
│   ├── layout/
│   │   ├── Sidebar.jsx              Nav sidebar with NAV group definitions
│   │   └── Topbar.jsx               Top bar with breadcrumb, date, TITLE_MAP
│   ├── ui/
│   │   ├── Icon.jsx                 Inline SVG icon renderer (<Ic n="name" s={size} />)
│   │   └── Badge.jsx                StatusBadge — status string → badge class
│   └── harbor-map/
│       └── HarborMap.jsx            SVG harbor map with animated water + piers
└── screens/
    ├── Overview.jsx
    ├── MarinaMap.jsx
    ├── Reservations.jsx             7 tabs incl. Wait List + Fuel Dock
    ├── Vessels.jsx
    ├── Documents.jsx                eSignature — Templates, Envelopes, Mass Send
    ├── Boatyard.jsx                 8 tabs incl. Launch Queue + Tools
    ├── Maintenance.jsx              4 tabs incl. Asset Register + Defect Log
    ├── Staff.jsx
    ├── Billing.jsx                  5 tabs incl. Aged Debtors + Accounts
    ├── Reports.jsx
    ├── Members.jsx                  4 tabs incl. Segments
    ├── Restaurant.jsx
    ├── Events.jsx
    └── Settings.jsx
```

---

## Development Setup

```bash
cd frontend
npm install
npm run dev       # starts on http://localhost:5173
npm run build     # production build to frontend/dist/
```

---

## Future Plans

See `docs/future-platform-features.md` for the full list of features requiring backend, native mobile, or hardware infrastructure, and the 8-phase development roadmap.

### Phase 2 — Backend (Django + PostgreSQL)
Replace mock data with REST API. Models: `Marina`, `Berth`, `Vessel`, `Booking`, `Invoice`, `Member`, `Task`, `Incident`, `WorkOrder`, `Asset`, `Document`, `Envelope`. JWT auth with role-based access (Harbor Master, Dock Master, Staff, Viewer).

### Phase 3 — Payments & Comms
Stripe payment processing (server-side Payment Intents + webhooks). Email/SMS via SendGrid/Twilio.

### Phase 4 — Staff PWA
Offline-capable progressive web app for dock staff: geofencing clock-in/out, mobile work order access, barcode parts scanning, photo attachments.

### Phase 5 — Customer Boater App
iOS/Android native app: arrival notification, berth map, invoice payment, fuel requests, push notifications.

### Phase 6 — Hardware Integrations
FuelCloud pay-at-pump, MarineSync automated meter readings, gate/barrier control, CCTV WebRTC feeds.

### Phase 7 — AI Features
ML-based work order scheduling (technician assignment optimisation). BLU Voice Agent (AI phone agent for 24/7 inbound calls).

### Phase 8 — Third-Party Channels
AIS feed integration, online booking channels (Noforeignland, Navily), accounting push (Xero/QuickBooks), PartSmart catalog, BoatCloud/SpeedyDock sync.
