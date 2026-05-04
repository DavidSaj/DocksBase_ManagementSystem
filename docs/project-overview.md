# DocksBase — Project Overview

> Last updated: 2026-05-04

---

## 1. What DocksBase Is

DocksBase is a **multi-tenant marina management SaaS platform**. A marina owner signs up, configures their facility, and gets a full suite of tools to manage berths, bookings, vessels, members, boatyard operations, billing, and staff — all in one place.

The platform has four distinct surfaces:

| Surface | Audience | Tech | Location |
|---|---|---|---|
| **Management System** | Marina owners, managers, staff | React + Django | `frontend/` + `backend/` |
| **Boater Portal** | Boat owners (clients) | React (embedded in frontend) + Django | `frontend/src/screens/Portal.jsx` |
| **Landing Page** | Prospective customers | React Vite | `website/` |
| **Admin Portal** | DocksBase super-admin | React Vite + Django | `admin/` |
| **Webmock** | Demo / marketing prototype | React Vite | `webmock/` |

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend (management) | React 19, Vite 8, React Router 7, custom SVG canvas (CanvasCore), Axios |
| Backend | Django 6.0, Django REST Framework, Simple JWT |
| Database | PostgreSQL (SQLite for dev) |
| Auth | JWT + magic-link + email verification |
| Payments | Stripe |
| eSignature | Dropbox Sign API |
| Email | Django Anymail (Resend) |
| File storage | AWS S3 (django-storages) |
| PDF generation | WeasyPrint |
| Deploy | Gunicorn (Procfile), ASGI ready for Django Channels |

> Note: The harbor map was originally Konva.js. It has been replaced with a custom SVG renderer (`CanvasCore.jsx`) — no canvas library dependency.

---

## 3. How the System Fits Together

### 3.1 The Booking Flow (end-to-end)

```
CLIENT (web browser)
  │
  ├─ Visits marina's public booking page  ──►  webmock / future white-label booking site
  │     Enters: dates, vessel size, contact info
  │
  ▼
BACKEND: POST /api/v1/portal/booking-requests/
  │     Creates a BookingRequest (status: pending)
  │     Email notification fires to marina manager
  │
  ▼
MANAGER (management frontend)
  │   Sees new request in Reservations → Pending tab
  │   Reviews boat dimensions vs available berths
  │   Uses booking engine to find a fit (tetris logic)
  │
  ├─ Approves → POST /api/v1/booking-requests/{id}/convert/
  │     Creates a Booking (status: awaiting_payment)
  │     Sends confirmation email to client via Resend
  │
  ├─ Declines → PATCH status: rejected
  │
  ▼
CLIENT receives email with payment link
  │     Clicks → Stripe Checkout session (hosted page)
  │     Pays → Stripe webhook fires
  │
  ▼
BACKEND: Stripe webhook handler
  │     Updates Booking.status → confirmed
  │     Updates Invoice.status → paid
  │     Optionally sends eSign document via Dropbox Sign (berth lease, waiver)
  │
  ▼
CLIENT checks in
  │     Manager updates Booking.status → checked_in
  │     Berth.status → occupied
  │     Harbor map shows vessel on live canvas
  │
  ▼
CLIENT checks out
      Manager updates → checked_out
      Utility meter readings finalized
      Final invoice generated (PDF via WeasyPrint, stored on S3)
```

### 3.2 Roles and Permissions

| Role | Access |
|---|---|
| `owner` | Full access to all screens; can change settings, billing plan, manage staff |
| `manager` | All operational screens; cannot change subscription/billing plan |
| `staff` | Limited to assigned modules (e.g. maintenance tasks, shift view) |
| `boater` | Portal only — own bookings, documents, profile |
| `platform_admin` | Admin portal only — all marinas, subscriptions, platform config |

### 3.3 White-Label Booking Portal — Embed Pipeline

The booking portal (`TenantContext` + `PortalApp`) supports three integration modes. The frontend auto-detects which mode is in use at page load based on hostname and path.

---

#### Option 1 — Hosted on DocksBase domain (path-based)

The simplest option. No custom domain required.

**URL pattern:** `booking.docksbase.com/:marina-slug`

**Example:** `booking.docksbase.com/harbour-view-marina`

**How it works:**
1. Browser visits `booking.docksbase.com/harbour-view-marina`
2. `detectTenant()` reads `harbour-view-marina` from the URL path
3. Frontend sends `X-Marina-Slug: harbour-view-marina` to `GET /public/marina/`
4. `TenantMiddleware` looks up `Marina.objects.get(slug=...)` and attaches it to the request
5. `MarinaPublicView` returns the marina's public profile; `PortalApp` renders

**Setup:** No configuration needed — works automatically once the marina has a slug (auto-generated from marina name on account creation).

---

#### Option 2 — Marina's own website embeds the DocksBase booking page (redirect with pre-fill)

The marina's website has a "Book Now" form. On submit, it redirects to DocksBase with the booking details pre-filled as query parameters.

**URL pattern:** `booking.docksbase.com/:marina-slug?arrival=YYYY-MM-DD&departure=YYYY-MM-DD&category=...`

**Example:**
```
booking.docksbase.com/harbour-view-marina?arrival=2026-06-10&departure=2026-06-14&category=berth
```

**Supported query params:**

| Param | Description | Example |
|---|---|---|
| `arrival` | Check-in date (ISO) | `2026-06-10` |
| `departure` | Check-out date (ISO) | `2026-06-14` |
| `category` | Booking type | `berth` |

**How it works:** Same as Option 1, but `detectTenant()` also extracts the query params and exposes them via the `prefill` object in `TenantContext`. The booking form reads `prefill.arrival`, `prefill.departure`, `prefill.category` to skip the date-selection step.

**Setup:** Same as Option 1. The marina's developer constructs the redirect URL from their booking form. No DocksBase configuration required.

---

#### Option 3 — Fully custom domain

The portal lives entirely on the marina's own domain. Visitors never see `docksbase.com` in the URL.

**URL pattern:** `booking.harbourview.com` (or any hostname the marina controls)

**Example:** `reservations.portofmontevideo.uy`

**How it works:**
1. Marina sets `Marina.custom_domain = "booking.harbourview.com"` in their settings
2. Marina points their DNS (CNAME or A record) at the DocksBase servers
3. Browser visits `booking.harbourview.com`
4. `detectTenant()` sees the hostname is not `*.docksbase.com` → treats it as a custom domain
5. Frontend sends `X-Marina-Domain: booking.harbourview.com` to `GET /public/marina/`
6. `TenantMiddleware` looks up `Marina.objects.get(custom_domain=...)` and attaches it

**Setup:**
1. In the marina's Settings (or Django admin), set `custom_domain` to the full hostname, e.g. `booking.harbourview.com`
2. Marina adds a DNS record pointing that hostname at the DocksBase server IP
3. SSL certificate must be provisioned for the custom domain (Let's Encrypt / Caddy / nginx)
4. Pre-fill params (Option 2) work on custom domains too — just append the same query string

---

#### Detection logic (code reference)

`frontend/src/context/TenantContext.jsx` — `detectTenant()`:

```
booking.docksbase.com/:slug   →  { slug, customDomain: null, prefill }   (Options 1 & 2)
<any other hostname>          →  { slug: null, customDomain, prefill }    (Option 3)
app.docksbase.com / localhost →  null  (management app, portal not shown)
```

`backend/apps/accounts/middleware.py` — `TenantMiddleware`:

```
X-Marina-Slug header    →  Marina.objects.get(slug=...)          (Options 1 & 2)
X-Marina-Domain header  →  Marina.objects.get(custom_domain=...) (Option 3)
```

`Marina.custom_domain` — nullable, unique CharField added in migration `0011_marina_custom_domain`.

---

## 4. What Is Fully Built

### Frontend (17 screens)

| Screen | What it does |
|---|---|
| **Overview** | Dashboard: stat cards, activity log, weather widget, urgent alerts, pending bookings |
| **Marina Map** | Two modes: live viewer (read-only, status colors, berth click → detail) and map builder (drag-drop editor for laying out the marina) |
| **Reservations** | 7-tab view: All / Transient / Seasonal / Pending / Overdue / Wait List / Fuel Dock |
| **Vessels** | Registry, AIS tracker (mock), certificates vault |
| **Documents & eSign** | Template library, envelope tracking, mass-send, audit trail |
| **Boatyard** | Haul-out schedule, launch queue, dry storage grid, work orders, parts, tools, contractors, facility log |
| **Maintenance** | Staff tasks, incident reports, asset register, defect log |
| **Staff** | Shift scheduler, attendance, time tracking, certifications |
| **Billing** | Invoices list, utility meter readings, fuel dock POS, aged-debtor chase |
| **Reports** | KPI dashboards, revenue analysis, occupancy trends |
| **Members** | Registry, insurance expiry tracking, tags, messaging |
| **Restaurant** | Table and menu management |
| **Events** | Event planning, venue hire, participant tracking |
| **Sales** | Merchandise inventory, retail POS |
| **Settings** | Marina profile, service catalog / price book, user management, notifications, system info |
| **Boater Portal** | Self-service: my bookings, my documents, my profile |
| **Field App** | Stub — mobile-optimized dock operations (barely started) |

### Backend (15 Django apps — models and endpoints defined)

| App | Models defined | Endpoints defined | Business logic |
|---|---|---|---|
| accounts | User, Marina, MagicToken, EmailVerification | signup, login, magic link, JWT, me, onboarding | ✅ Complete |
| berths | Pier, Berth, MarinaMapConfig, MapPrefab | Full CRUD piers/berths + map config | ✅ Complete |
| reservations | Booking, BookingRequest | CRUD + assign-berth + available-berths + engine | ⚠️ Partial |
| vessels | Vessel | CRUD | ✅ Complete |
| members | Member | CRUD | ✅ Complete |
| billing | Invoice, InvoiceLineItem, Payment, ChargeableItem, AccountPayment | Full CRUD + finalize + Stripe Checkout + PDF generation + S3 upload + invoice_paid signal + service catalog | ✅ Complete |
| maintenance | Task, Incident, Asset, Defect | CRUD | ✅ Complete |
| boatyard | HaulOut, WorkOrder, Part, Tool, Contractor, FacilityLog | CRUD | ✅ Complete |
| staff | StaffMember, Shift, Attendance, Certification | CRUD | ✅ Complete |
| documents | DocTemplate, Envelope, AuditTrail | CRUD + mass-send | ⚠️ Partial |
| events | Event, VenueHire | CRUD | ✅ Complete |
| restaurant | Restaurant, Table, MenuItem | CRUD | ⚠️ Minimal |
| sales | Merchandise, POS | CRUD | ⚠️ Minimal |
| fuel_dock | FuelDock, FuelRequest, FuelDockEntry | CRUD | ✅ Complete |
| reports | RevenueReport, OccupancyReport | GET endpoints | ⚠️ Partial |
| admin_portal | AdminSettings, AuditLog | Marina/subscription management | ⚠️ Partial |
| portal | BoaterBookingRequest, BoaterProfile | Boater self-service | ⚠️ Partial |

---

## 5. The Harbor Map — How It Works

The marina map has two completely separate modes, accessed from the same **Marina Map** screen in the sidebar.

### 5.1 Live Map (viewer mode)

The default view. Read-only. Renders all placed piers and berths on a grid, colored by berth status:

| Color | Status |
|---|---|
| Green | Available |
| Blue | Occupied |
| Orange | Reserved |
| Red | Maintenance |

Clicking a berth opens a detail panel (`BerthDetailPanel`) showing the vessel, booking status, and price per night. Berth data is polled from the API every 30 seconds to stay fresh.

**Component:** `LiveMap.jsx` — wraps `CanvasCore` in `mode="viewer"`.

### 5.2 Map Builder (editor mode)

Where the marina layout is constructed. Has three zones:

**Left — Palette** (`MapBuilderPalette`): prefab shapes to drag onto the canvas.
- **Docking structures** (pier-v, pier-h, slip, parallel-wall, fuel-dock, gangway, ramp, etc.) — dropping one creates a **Pier record in the database** with `canvas_x`, `canvas_y`, `canvas_w`, `canvas_h`, `rotation`.
- **Environmental items** (water, land, buildings, landmarks) — stored in `MarinaMapConfig` as a JSON blob. You must click **Save** to persist these.

**Center — Canvas** (`CanvasCore` in `mode="builder"`): the grid where everything is laid out. You can:
- Drop prefabs to place new piers
- Drag an existing pier to reposition it (auto-saves to the database on mouse-up)
- Drop unplaced berths from the right panel onto a pier to assign their position

**Right — Berth Panel** (`MapBuilderBerthPanel`): lists all berths split into **Placed** and **Unplaced**. An unplaced berth is dragged from this list onto the canvas; it snaps to the nearest pier, and the drop saves `pier`, `local_x`, `local_y` on the berth via `PATCH /berths/{id}/`.

**Component:** `MapBuilder.jsx` — wraps `CanvasCore` in `mode="builder"`.

### 5.3 How Berths Are Created

**Berths are not created in the map.** The map only *places* already-existing berths onto piers. The intended flow is:

1. Berths are created via Django admin or a future berth management UI. They start with no pier and no coordinates — `is_placed = false`.
2. They appear in the **Unplaced** section of the Map Builder's right panel.
3. The manager drags them onto the canvas, snapping to a pier.
4. They disappear from the unplaced list and appear on the map.

There is currently **no frontend UI for creating berths** — this is a gap that needs a form (either in the Map Builder panel or a separate Berths management screen).

### 5.4 The Coordinate System

- **Pier position:** stored as `canvas_x`, `canvas_y` — the center of the pier in grid units. Grid unit = 40px.
- **Berth position:** stored as `local_x`, `local_y` — offset from the pier center. Computed to an absolute canvas position at render time via `computeAbsPosition()` in `mapBuilderUtils.js`.
- **Environmental items:** stored as `gx`, `gy` (top-left corner) in `MarinaMapConfig.env_items` JSON.

### 5.5 Architecture (three-component pattern)

```
CanvasCore.jsx         — dumb SVG renderer, no data fetching, no business logic
                         Props: shapes[], mode, ghost, snapZones, selectedIds, event handlers
                         Renders: env items → piers → berths (layered, piers below berths)

MapBuilder.jsx         — layout controller (builder mode)
                         Fetches: piers, berths, map config
                         Builds shapes[], handles drag/drop, saves to API

LiveMap.jsx            — operational controller (viewer mode)
                         Fetches: piers, berths, map config
                         Builds shapes[] with status colors, polls every 30s, opens detail panel
```

---

## 6. Service Catalog — Where Pricing Lives

**The service catalog is the single source of truth for all pricing in DocksBase.** No prices are stored anywhere else — not in bookings, not in marina config JSON, not hardcoded in the frontend.

### 6.1 Where to find it

**Settings → Service Catalog tab** (`Settings.jsx`, tab `'catalog'`).

This is a price book management screen where marina owners define every type of charge they apply. The data lives in the `ChargeableItem` model (`billing` app) and is served via `GET/POST /api/v1/billing/service-catalog/`.

### 6.2 What a catalog item contains

| Field | Options |
|---|---|
| **Name** | Free text (e.g. "Visitor Slip — Up to 10m", "Shore Power", "Diesel") |
| **Category** | `berth` / `utility` / `service` / `retail` |
| **Pricing model** | `flat_fee` / `per_night` / `per_meter_per_night` / `per_kwh` / `per_hour` / `per_meter_flat` / `per_litre` |
| **Unit price** | Decimal (€) |
| **Tax rate** | Percentage (%) |
| **Active** | Toggle — inactive items don't appear in pickers |
| **Show in POS** | Whether this item appears in the Fuel Dock POS quick-sale grid |
| **Fuel dock type** | `diesel` / `petrol` / `pump_out` (only relevant if Show in POS is on) |

### 6.3 How catalog items flow through the system

```
Settings → Service Catalog
    │
    ├─► Invoices (Billing screen)
    │       When adding a line item to an invoice, the manager picks from active catalog items.
    │       The price and tax rate are snapshotted onto InvoiceLineItem at that moment
    │       (so changing the catalog later doesn't change historical invoices).
    │
    ├─► Batch Billing (Billing → Accounts tab)
    │       Batch invoice generator looks up the first active `berth` category ChargeableItem
    │       for the marina and applies it to all seasonal berths in one operation.
    │
    ├─► Fuel Dock POS (Billing → Fuel Dock POS tab)
    │       Items with `show_in_pos = True` and `is_active = True` appear as quick-sale
    │       buttons on the POS grid. Ordered: diesel → petrol → pump_out → everything else.
    │
    └─► Booking-to-invoice conversion (service.py)
            When a booking is approved and an invoice is auto-generated, the backend
            finds the best-matching ChargeableItem (category=berth, active) to price it.
```

### 6.4 Why this design matters

Before `ChargeableItem` existed, pricing was scattered in Marina JSON config blobs. That caused inconsistencies — invoices created by different paths could have different prices for the same service. Now there is one place to change "Visitor berth per night" and the change propagates everywhere.

---

## 7. Settings Screen — Full Map

**Settings** has 5 tabs:

| Tab | What it does |
|---|---|
| **Marina Profile** | Name, address, contact info, timezone, booking mode (instant / request-only), logo |
| **Service Catalog** | Price book — all ChargeableItems. Add/edit/delete pricing for berths, utilities, services, retail |
| **Users & Roles** | Invite staff, set roles (owner / manager / staff), deactivate accounts |
| **Notifications** | Coming soon — email/SMS notification preferences |
| **System** | Platform info, database size, integrations status |

---

## 8. What Is Still Mock / Not Yet Wired

### 8a. Frontend screens still using mock data

| Screen | Mocked data |
|---|---|
| `Restaurant.jsx` | `REST_TABLES`, `REST_BOOKINGS`, `MENU`, `REST_ORDERS` — fully mock |

Everything else is wired to real API calls via hooks.

### 8b. Stripe — Backend Complete, Frontend Not Wired

- Backend: Stripe Checkout session creation, webhook handler (`stripe/webhook/`), `invoice_paid` signal — all fully built in `billing/stripe_service.py`
- Frontend: No checkout UI — clicking "Send Invoice" or "Pay Now" does nothing
- Missing: Frontend redirect to Stripe-hosted checkout page; boater portal "Pay Now" button

### 8c. Dropbox Sign — Not Wired

- Backend: `dropboxsign_template_id` on DocTemplate, `dropboxsign_envelope_id` on Envelope, API key in env
- Frontend: Envelope creation form exists but POSTing it does not actually call Dropbox Sign API
- Missing: Backend view that calls Dropbox Sign SDK, webhook to update envelope status when signed

### 8d. PDF Invoice Generation — Backend Complete

- WeasyPrint renders `billing/templates/billing/invoice_pdf.html`, uploads to S3, emails via Anymail
- Frontend just calls `POST /invoices/<pk>/send/` — no additional frontend work needed

### 8e. Real-Time Updates — Not Started

- ASGI entry point (`asgi.py`) exists but Django Channels is not installed
- Harbor map and overview are polled (30s interval) — no WebSocket push
- Required for: live berth status from multiple concurrent managers, booking notifications

### 8f. Field App — Stub

`frontend/src/screens/Field.jsx` is near-empty. Intended for dock staff on mobile — check-in boats, record meter readings, mark tasks done.

### 8g. AIS Vessel Tracking — Mock Only

The Vessels → AIS Tracker tab shows a placeholder map. No real AIS feed integrated.

### 8h. SMS Notifications — Not Configured

Email is wired (Anymail/Resend). SMS is not configured anywhere.

### 8i. Admin Portal — Not Integrated

`admin/` frontend has screens for managing marinas and subscriptions but is not wired to backend.

### 8j. Berth Creation UI — Missing

There is no frontend screen for creating berths. They must currently be created via Django admin. A berth management form (either in the Map Builder right panel or a separate screen) is needed before non-technical users can set up the marina.

---

## 9. Design Not Yet Implemented in Backend

| Frontend Feature | Missing Backend Work |
|---|---|
| Booking engine "auto-assign" button | Business logic to run tetris algorithm against real berths |
| Boater portal — booking with payment | Stripe Checkout tied to BookingRequest approval |
| Aged-debtor chase email | `POST /billing/invoices/{id}/chase/` — send reminder email |
| Staff shift auto-generation | No endpoint; shifts must be created one-by-one |
| Document mass-send segmentation | Filtering logic by member tag/vessel type likely incomplete |
| Fuel dock queue with real-time status | No WebSocket; queue is static |
| Maintenance task assignment notifications | No push/email when task assigned |
| Dry storage slot drag-and-drop assignment | No `PATCH /dry-storage/{id}/assign-vessel/` confirmed |
| Boater portal — pay invoice | No Stripe checkout from portal side |
| Reports export (CSV/PDF) | Serialization likely incomplete |
| Restaurant table ordering / POS | Screens exist, no order-taking flow in backend |
| Sales / retail POS | Screen exists, no POS transaction processing |
| Events — ticket sales / registration | No registration flow in backend |

---

## 10. Features Needed Before Launch

> See `docs/operational-friction.md` for the full operational UX analysis (Frau Zanger's five gaps). That document reprioritizes several items that were previously listed as P2 but are real safety or business-critical issues.

### Must-Have (P0)

- [ ] **Record Payment button (counter-sale)** — backend `AccountPayment` is fully built; frontend needs a prominent "Record Cash / Card" button on every invoice. The easiest win on the list. *(operational-friction Gap 2)*
- [ ] **Live Map WebSockets** — 30-second polling creates double-booking risk on a live dock. Django Channels + one WebSocket consumer + LiveMap client update. Previously listed as P2 — reclassified as P0. *(operational-friction Gap 3)*
- [ ] **Auto check-in / check-out** — Celery scheduled tasks to transition `confirmed → checked_in` at arrival date 14:00 and `checked_in → checked_out` at departure. Removes the manager desk bottleneck at peak hours. *(operational-friction Gap 1)*
- [ ] **Berth creation UI** — managers need to create berths without Django admin
- [ ] **Stripe payment flow** — invoice creation → Stripe Checkout → webhook → booking confirmed
- [ ] **Email notifications** — booking confirmed, invoice sent, magic link (Anymail/Resend already configured)
- [ ] **Boater portal** — booking request form live; client can submit and receive confirmation email
- [ ] **Multi-tenant data isolation audit** — verify all API views filter by `request.user.marina`
- [ ] **Production environment** — env vars, PostgreSQL, S3, domain, SSL
- [ ] **Restaurant.jsx** — still uses mock data; needs real API hooks

### Should-Have (P1)

- [ ] **SMS notifications** — Twilio integration for booking confirmation, departure reminder, and emergency broadcast by pier. Previously P2 — reclassified because boaters don't check email while onboard. Emergency broadcast (select pier → SMS all occupied berths) is a safety-critical feature. *(operational-friction Gap 5)*
- [ ] **Self-check-in on Boater Portal** — boaters with confirmed bookings tap "Check In" in the portal, bypassing the manager desk. *(operational-friction Gap 1)*
- [ ] **Module-level staff permissions** — per-user access flags (can_access_billing, can_access_boatyard, etc.) so a dockhand doesn't see revenue reports and a mechanic doesn't get fuel dock alerts. *(operational-friction Gap 4)*
- [ ] **PDF invoice generation** — WeasyPrint template + S3 upload on invoice send
- [ ] **Dropbox Sign integration** — envelope creation, status webhook, audit trail
- [ ] **Admin portal integration** — super-admin can provision/suspend marinas
- [ ] **Onboarding flow** — new marina setup wizard (marina details → map → first berths → invite staff)
- [ ] **Booking engine tetris** — auto-assign available berth based on LOA/beam/dates
- [ ] **Role-based permissions audit** — staff cannot access owner-only endpoints

### Nice-to-Have (P2)

- [ ] **Field app** — mobile-optimized dock staff UI
- [ ] **AIS vessel tracking** — real feed integration
- [ ] **Reports export** — CSV/PDF download
- [ ] **Restaurant & Sales POS** — full order-taking and transaction flow
- [ ] **Stripe Terminal** — physical card reader integration for the counter (counter-sale via "Record Payment" button covers this for now)

---

## 11. Mobile App

There is no separate mobile app. The "mobile" surface exists in two places:

1. **Boater Portal** (`/portal`) — responsive web view for boat owners. Partially implemented.
2. **Field App** (`/field`) — stub. Intended for dock staff on tablets/phones. Almost nothing built.

The `website/` landing page has a "Mobile App" marketing section. There is no native iOS/Android app. If this is a launch commitment, it needs to be built or removed from marketing materials.

---

## 12. Database Tables

```
accounts_marina                   marina company, subscription, config
accounts_user                     users (all roles)
accounts_magictoken               magic link tokens
accounts_emailverification        email verification codes

berths_pier                       pier definitions (canvas_x/y/w/h/rotation stored here)
berths_berth                      individual berth/slip (local_x/y relative to pier center)
berths_marinamapconfig            harbor map env items (water, land, buildings) as JSON
berths_mapprefab                  reusable pier/environment shape templates

reservations_booking              booking records
reservations_bookingrequest       booking requests / wait list

vessels_vessel                    vessel registry

members_member                    member/owner registry

billing_invoice                   invoice records
billing_invoicelineitem           invoice line items (price snapshotted from ChargeableItem)
billing_payment                   payment records
billing_chargeableitem            service catalog — single source of truth for all pricing
billing_accountpayment            manual account payments (cash, card, bank transfer)

maintenance_task                  staff tasks
maintenance_incident              incident reports
maintenance_asset                 asset register
maintenance_defect                defect log

boatyard_haulout                  haul-out / splash schedule
boatyard_workorder                work orders
boatyard_part                     parts inventory
boatyard_tool                     tools register
boatyard_contractor               contractors
boatyard_facilitylog              facility maintenance

staff_staffmember                 staff records
staff_shift                       shift schedule
staff_attendance                  attendance log
staff_certification               certifications

documents_doctemplate             eSign templates
documents_envelope                completed envelopes
documents_audittrail              document audit log

events_event                      events
events_venuehire                  venue hire bookings

restaurant_restaurant             restaurant / venue
restaurant_table                  tables
restaurant_menuitem               menu items

sales_merchandise                 retail products
sales_pos                         POS transactions

fuel_dock_fueldock                fuel dock config
fuel_dock_fuelrequest             fuel queue requests
fuel_dock_fueldockentry           fuel sale records

reports_revenuereport             cached revenue reports
reports_occupancyreport           cached occupancy data

admin_portal_adminsettings        platform config
admin_portal_auditlog             platform audit trail

portal_boaterbookingrequest       boater self-service requests
portal_boaterprofile              boater profile
```

---

## 13. Repository Structure

```
DocksBase/
└── DocksBase_ManagementSystem/
    ├── docs/                     all documentation (canonical location)
    │   ├── project-overview.md   this file
    │   └── superpowers/
    │       ├── plans/            implementation plans (date-prefixed .md)
    │       └── specs/            design specs (date-prefixed .md)
    │
    ├── frontend/                 React management UI (port 5173)
    │   └── src/
    │       ├── screens/          17 feature screens
    │       ├── components/
    │       │   ├── harbor-map/   CanvasCore, MapBuilder, LiveMap, BerthDetailPanel, MapBuilderPalette, MapBuilderBerthPanel, mapBuilderUtils
    │       │   ├── layout/       Sidebar, Topbar
    │       │   └── ui/           Icon, Badge, modal helpers
    │       ├── hooks/            data-fetching hooks (real API calls, ~44 hooks)
    │       ├── context/          AuthContext, MarinaContext
    │       ├── api.js            Axios client with JWT + auto-refresh
    │       └── styles/           design tokens + app CSS
    │
    ├── backend/                  Django REST API (port 8000)
    │   ├── config/               settings, urls, wsgi/asgi
    │   └── apps/                 15+ Django apps (see section 4)
    │
    ├── admin/                    SaaS admin portal (port 5175)
    ├── webmock/                  Interactive demo/marketing (port 5174)
    ├── website/                  Public landing page
    └── shared/
        └── mock.js               62KB of mock data (only Restaurant.jsx still uses this)
```

---

## 14. Key Design Decisions

- **Multi-tenancy via FK:** Every model has a `marina` FK. All API views filter by the authenticated user's marina. This is the primary security boundary.

- **Booking modes:** Marinas can operate in `instant_booking` (auto-confirm if berth available) or `request_only` (all bookings need manager approval). Controlled by `Marina.booking_mode`.

- **Roles at the user level:** Role (`owner`, `manager`, `staff`, `boater`) is stored on the User model. `ProtectedRoute` in the frontend gates screens by role. Backend views should mirror these gates.

- **Harbor map — split storage:** Pier positions and berth positions are stored as proper database fields (`canvas_x/y/w/h/rotation` on Pier; `local_x/y` on Berth), not as a JSON blob. Only environmental decoration items (water, buildings, land) are stored as JSON in `MarinaMapConfig.env_items`. This means piers and berths can be queried, filtered, and related to bookings normally — they are real DB records.

- **Service catalog as single source of truth:** All pricing lives in `ChargeableItem` (billing app). Prices are snapshotted onto `InvoiceLineItem` at invoice time so historical invoices are immutable. No prices are stored in marina config JSON or hardcoded in the frontend.

- **Stripe per-marina:** Each marina has its own `stripe_account_id`, enabling Stripe Connect for platform-level revenue share if needed.

- **Map coordinate system — center-origin:** Pier `canvas_x/y` is the center of the pier, not top-left. Berth `local_x/y` is the offset from the pier's center. All rendering converts to center-origin before drawing. This makes rotation math correct.
