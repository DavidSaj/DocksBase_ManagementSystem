# DocksBase — Project Overview

> Last updated: 2026-05-02 (session 2)

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
| Frontend (management) | React 19, Vite 8, React Router 7, Konva.js (harbor map), Axios |
| Backend | Django 6.0, Django REST Framework, Simple JWT |
| Database | PostgreSQL (SQLite for dev) |
| Auth | JWT + magic-link + email verification |
| Payments | Stripe |
| eSignature | Dropbox Sign API |
| Email | Django Anymail (Resend) |
| File storage | AWS S3 (django-storages) |
| PDF generation | WeasyPrint |
| Deploy | Gunicorn (Procfile), ASGI ready for Django Channels |

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

---

## 4. What Is Fully Built

### Frontend (17 screens)

| Screen | What it does |
|---|---|
| **Overview** | Dashboard: stat cards, activity log, weather widget, urgent alerts, pending bookings |
| **Marina Map** | Interactive SVG/Konva harbor — live berth status, drag-drop editor, berth detail panel |
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
| **Settings** | Marina config, user management, integrations, profile |
| **Boater Portal** | Self-service: my bookings, my documents, my profile |
| **Field App** | Stub — mobile-optimized dock operations (barely started) |

### Backend (15 Django apps — models and endpoints defined)

| App | Models defined | Endpoints defined | Business logic |
|---|---|---|---|
| accounts | User, Marina, MagicToken, EmailVerification | signup, login, magic link, JWT, me, onboarding | ✅ Complete |
| berths | Pier, Berth, Amenity, MapConfig, Prefab | Full CRUD + bulk-generate | ✅ Complete |
| reservations | Booking, BookingRequest | CRUD + assign-berth + available-berths + engine | ⚠️ Partial |
| vessels | Vessel | CRUD | ✅ Complete |
| members | Member | CRUD | ✅ Complete |
| billing | Invoice, InvoiceLineItem, Payment, ChargeableItem | Full CRUD + finalize + Stripe Checkout + PDF generation + S3 upload + invoice_paid signal | ✅ Complete |
| maintenance | Task, Incident, Asset, Defect | CRUD | ✅ Complete |
| boatyard | HaulOut, WorkOrder, Part, Tool, Contractor, FacilityLog | CRUD | ✅ Complete |
| staff | StaffMember, Shift, Attendance, Certification | CRUD | ✅ Complete |
| documents | DocTemplate, Envelope, AuditTrail | CRUD + mass-send | ⚠️ Partial |
| events | Event, VenueHire | CRUD | ✅ Complete |
| restaurant | Restaurant, Table, MenuItem | CRUD | ⚠️ Minimal |
| sales | Merchandise, POS | CRUD | ⚠️ Minimal |
| fuel_dock | FuelDock, FuelRequest | CRUD | ✅ Complete |
| reports | RevenueReport, OccupancyReport | GET endpoints | ⚠️ Partial |
| admin_portal | AdminSettings, AuditLog | Marina/subscription management | ⚠️ Partial |
| portal | BoaterBookingRequest, BoaterProfile | Boater self-service | ⚠️ Partial |

---

## 5. What Is Still Mock / Not Yet Wired

This is the most important section for launch planning.

### 5a. Frontend ↔ Backend — Mostly Connected

The frontend is wired to the real backend via `api.js` (Axios) and the hooks in `frontend/src/hooks/`. Most screens make live API calls to `http://localhost:8000/api/v1`.

**Only 1 screen still imports from `mock.js`:**

| Screen | Mocked data |
|---|---|
| `Restaurant.jsx` | `REST_TABLES`, `REST_BOOKINGS`, `MENU`, `REST_ORDERS` |

**Billing.jsx** — now fully wired to real data:
- Invoices use `useInvoices()` hook
- Aged Debtors are computed client-side from real invoice data (filtered by `status`, bucketed by days past `due_date`)
- Utility Meters tab shows a placeholder (model was removed in billing rebuild; no backend endpoint exists)

**Reports.jsx** — now fully wired to real data:
- Assets use `useAssets()` hook; status values use backend conventions (`due_service`, `under_repair`, `next_service`)
- Defects use `useDefects()` hook; fields use `asset_name`, `reported_at` from serializer

### 5b. Stripe — Backend Complete, Frontend Not Wired

- Backend: Stripe Checkout session creation, webhook handler (`stripe/webhook/`), `invoice_paid` signal that updates `Invoice.status → paid` and `Booking.status → confirmed` — all fully built in `billing/stripe_service.py`
- Frontend: No checkout UI — clicking "Send Invoice" or "Pay Now" does nothing
- Missing: Frontend redirect to Stripe-hosted checkout page; boater portal "Pay Now" button

### 5c. Dropbox Sign — Not Wired

- Backend: `dropboxsign_template_id` on DocTemplate, `dropboxsign_envelope_id` on Envelope, API key in env
- Frontend: Envelope creation form exists but POSTing it does not actually call Dropbox Sign API
- Missing: Backend view that creates an envelope via Dropbox Sign SDK, webhook to update envelope status when client signs

### 5d. PDF Invoice Generation — Backend Complete

- WeasyPrint installed; HTML template exists at `billing/templates/billing/invoice_pdf.html`
- `billing/pdf_service.py` renders the template, generates PDF, uploads to S3, and triggers email via Anymail/Resend
- `Invoice.pdf_document` field stores the S3 path; populated on invoice send
- Frontend just calls `POST /invoices/<pk>/send/` — no additional work needed on the frontend side

### 5e. Real-Time Updates — Not Started

- ASGI entry point (`asgi.py`) exists but Django Channels is not installed
- No WebSocket consumers written
- Harbor map and overview dashboard are static — no push updates when another manager changes something
- Required for: live berth status, booking notifications, utility meter live readings

### 5f. Field App — Stub

`frontend/src/screens/Field.jsx` is a near-empty placeholder. The field app is intended to be a mobile-optimized interface for dock staff — checking in boats, recording meter readings, marking tasks done — without needing the full management UI.

### 5g. AIS Vessel Tracking — Mock Only

The Vessels → AIS Tracker tab shows a placeholder map. Real AIS integration (e.g. via VesselFinder or AISHub API) is not implemented.

### 5h. SMS Notifications — Not Configured

Email notifications are wired (Anymail/Resend). SMS is not configured anywhere.

### 5i. Admin Portal — Not Integrated

The admin portal frontend (`admin/`) has screens for managing marinas and subscriptions but is not wired to the backend admin endpoints.

---

## 6. Design Not Yet Implemented in Backend

These are features visible in the frontend UI that have no corresponding backend endpoint:

| Frontend Feature | Missing Backend Work |
|---|---|
| Booking engine "auto-assign" button | `/api/v1/bookings/engine-request/` — business logic to run tetris algorithm against real berths |
| Boater portal — booking request with payment | Stripe Checkout session creation tied to BookingRequest approval |
| Aged-debtor chase email | `POST /billing/invoices/{id}/chase/` — send reminder email via Anymail |
| Staff shift auto-generation | No endpoint; shifts must be created one-by-one |
| Document mass-send segmentation | `/api/v1/documents/mass-send/` exists but filtering logic (by member tag, vessel type) likely incomplete |
| Fuel dock queue with real-time status | No WebSocket; queue is static |
| Maintenance task assignment notifications | No push/email when task is assigned to staff |
| Dry storage slot drag-and-drop assignment | Frontend has a grid; no `PATCH /dry-storage/{id}/assign-vessel/` endpoint confirmed |
| Boater portal — make payment | No Stripe checkout from portal side |
| Reports export (CSV/PDF) | `GET /reports/export/` exists but CSV/PDF serialization likely incomplete |
| Marina map — save after editor changes | `POST /map/config/` exists; needs verification that Konva JSON round-trips correctly |
| Restaurant table ordering / POS | Screens exist, no order-taking or POS flow in backend |
| Sales / retail POS | Screen exists, no POS transaction processing wired |
| Events — ticket sales / registration | Frontend form exists, no registration flow in backend |

---

## 7. Features Needed Before Launch

Ranked by launch-criticality:

### Must-Have (P0)

- [x] **Billing.jsx wired** — aged debtors computed from real invoice data; utility meters placeholder until model is rebuilt
- [x] **Reports.jsx wired** — assets and defects use real `useAssets()` / `useDefects()` hooks
- [ ] **Restaurant.jsx** — still uses mock data (`REST_TABLES`, `REST_BOOKINGS`, `MENU`, `REST_ORDERS`); needs real API hooks
- [ ] **Stripe payment flow** — invoice creation → Stripe Checkout → webhook → booking confirmed
- [ ] **Email notifications** — booking confirmed, invoice sent, magic link (Anymail/Resend already configured)
- [ ] **Boater portal** — booking request form live and connected; client can submit a request and receive confirmation email
- [ ] **Multi-tenant data isolation** — verify all API views filter by `request.user.marina` (security audit)
- [ ] **Production environment** — environment variables, PostgreSQL, S3, domain, SSL

### Should-Have (P1)

- [ ] **PDF invoice generation** — WeasyPrint template + S3 upload on invoice send
- [ ] **Dropbox Sign integration** — envelope creation, status webhook, audit trail
- [ ] **Admin portal integration** — super-admin can provision/suspend marinas
- [ ] **Onboarding flow** — new marina setup wizard (marina details → map → first berths → invite staff)
- [ ] **Booking engine tetris** — auto-assign available berth based on LOA/beam/dates
- [ ] **Role-based permissions audit** — ensure staff cannot access owner-only endpoints

### Nice-to-Have (P2)

- [ ] **Real-time updates** — Django Channels WebSockets for live harbor map and notifications
- [ ] **Field app** — mobile-optimized dock staff UI
- [ ] **AIS vessel tracking** — real feed integration
- [ ] **SMS notifications** — via Twilio or similar
- [ ] **Reports export** — CSV/PDF download
- [ ] **Restaurant & Sales POS** — full order-taking and transaction flow

---

## 8. Mobile App

There is no separate mobile app. The "mobile" surface exists in two places:

1. **Boater Portal** (`/portal`) — responsive web view for boat owners to check bookings, sign documents, update profile. Partially implemented.
2. **Field App** (`/field`) — stub stub. Intended for dock staff on tablets/phones. Almost nothing built.

The `website/` landing page has a "Mobile App" marketing section promoting a boater app, but there is no native app (iOS/Android). If this is a launch commitment, it needs to be either built or removed from marketing materials until ready.

---

## 9. Database Tables (35+ models)

```
accounts_marina                   marina company, subscription, config
accounts_user                     users (all roles)
accounts_magictoken               magic link tokens
accounts_emailverification        email verification codes

berths_pier                       pier definitions
berths_berth                      individual berth/slip
berths_amenity                    amenity markers (fuel, toilets, etc.)
berths_marinamapconfig            harbor map canvas state (JSON)
berths_mapprefab                  reusable pier templates

reservations_booking              booking records
reservations_bookingrequest       booking requests / wait list

vessels_vessel                    vessel registry

members_member                    member/owner registry

billing_invoice                   invoice records
billing_invoicelineitem           invoice line items
billing_payment                   payment records
billing_chargeableitem            service catalog (berth, utility, service, retail pricing)

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

reports_revenuereport             cached revenue reports
reports_occupancyreport           cached occupancy data

admin_portal_adminsettings        platform config
admin_portal_auditlog             platform audit trail

portal_boaterbookingrequest       boater self-service requests
portal_boaterprofile              boater profile
```

---

## 10. Repository Structure

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
    │       ├── components/       harbor map, sidebar, shared UI
    │       ├── hooks/            data-fetching hooks (real API calls)
    │       ├── context/          AuthContext, MarinaContext
    │       ├── api.js            Axios client with JWT + auto-refresh
    │       └── styles/           design tokens + app CSS
    │
    ├── backend/                  Django REST API (port 8000)
    │   ├── config/               settings, urls, wsgi/asgi
    │   └── apps/                 15 Django apps (see section 4)
    │
    ├── admin/                    SaaS admin portal (port 5175)
    ├── webmock/                  Interactive demo/marketing (port 5174)
    ├── website/                  Public landing page
    └── shared/
        └── mock.js               62KB of mock data (only Restaurant.jsx still uses this)
```

---

## 11. Key Design Decisions

- **Multi-tenancy via FK:** Every model has a `marina_fk`. All API views must filter by the authenticated user's marina. This is the primary security boundary.
- **Booking modes:** Marinas can operate in `instant_booking` (auto-confirm if berth available) or `request_only` (all bookings need manager approval). Controlled by `Marina.booking_mode`.
- **Roles at the user level:** Role (`owner`, `manager`, `staff`, `boater`) is stored on the User model, not as Django groups. ProtectedRoute in the frontend gates screens by role. Backend views should mirror these gates.
- **Map state as JSON:** The harbor map configuration (pier polygons, berth positions, amenities) is stored as a single JSON blob in `berths_marinamapconfig`. The Konva.js canvas serializes/deserializes this on load and save.
- **Stripe per-marina:** Each marina has its own `stripe_account_id`, enabling Stripe Connect for platform-level revenue share if needed.
