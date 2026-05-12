# Enterprise Multi-Marina Management — Design Spec

**Date:** 2026-05-12
**Status:** Approved

---

## Overview

Enterprise customers manage multiple marinas (a "group") through a dedicated group console (`marina-admin`). This is a separate standalone React app, not an extension of the existing marina frontend. Enterprise plans are not self-serve — David sets them up manually in the DocksBase admin portal, including the marina limit per group.

---

## Architecture

### New directory

`DocksBase_ManagementSystem/marina-admin/` — standalone Vite + React app, same stack and CSS token conventions as `frontend/` and `admin/`.

### Existing code reused

- Same Django backend, same JWT auth endpoints
- `MarinaGroup`, `MarinaGroupMembership`, `MarinaGroupUserRole` models already exist in `accounts/models.py` — no schema changes to these
- CSS design tokens from `frontend/src/styles/tokens.css` copied/referenced

### Auth flow

Enterprise admins log in at `marina-admin/` with email + password (same JWT backend as all other apps). On login the API returns their groups via `MarinaGroupUserRole`. If they belong to one group → straight to dashboard. If multiple groups → group picker screen first.

### SSO handoff — "Open marina" deep link

When an enterprise admin clicks "Open marina" for a specific sub-marina, the marina-admin app calls a new `group/{id}/exchange_token/` endpoint, passing the target `marina_id`. The backend verifies the user has `MarinaGroupUserRole: admin` for the group, then issues a **short-lived (60s), single-use scoped JWT** with `marina_id=<target_marina>`. The marina-admin app appends this as a URL param and opens the marina frontend:

```
portal.docksbase.com/cannes?sso_token=<exchange_token>
```

The marina frontend intercepts `sso_token` on load (same pattern as the existing `impersonate_token` flow in `admin/src/screens/Marinas.jsx:79`), exchanges it for a standard session JWT, and logs them in. The marina frontend's permission classes require no changes — they see a normal marina-scoped token.

**No physical User row syncing.** The enterprise admin maintains exactly one `User` account. Group membership is resolved at the exchange token endpoint only, not propagated into per-marina User records.

---

## Data Model Changes

### `MarinaGroup` additions (migration required)

```python
max_marinas = models.IntegerField(default=1)
billing_contact_email = models.EmailField(blank=True)
stripe_customer_id = models.CharField(max_length=64, blank=True)
base_currency = models.CharField(max_length=3, default='EUR')
```

### Marina limit enforcement

When assigning a marina to a group (via the admin portal), the backend checks:
```python
if group.memberships.count() >= group.max_marinas:
    raise ValidationError("Marina limit reached for this group.")
```

### No changes to `Marina` model

Individual marinas are unchanged. Group membership is purely through `MarinaGroupMembership`.

### Multi-currency handling

Enterprise groups can contain marinas billing in different currencies (e.g. GBP + EUR). The `group/{id}/financials/` endpoint must not `SUM()` raw amounts across currencies. Instead:

1. Each marina's revenue is fetched in its own `Marina.currency`
2. The endpoint looks up today's `ExchangeRate` (from `accounting.ExchangeRate`, populated daily by `fx_rate_updater` in `accounting/tasks.py`) to convert each marina's figures into `MarinaGroup.base_currency`
3. Converted totals are summed and the response includes `base_currency` so the UI can display the correct currency symbol
4. If no exchange rate is available for a pair, that marina's revenue is excluded from the aggregate and flagged in the response (`missing_fx: ["GBP"]`).

---

## Backend — New APIs

All under `/api/` prefix, DRF viewsets.

### Group management (admin portal use)

| Endpoint | Method | Description |
|---|---|---|
| `admin/groups/` | GET | List all groups |
| `admin/groups/` | POST | Create group |
| `admin/groups/{id}/` | GET, PATCH, DELETE | Group detail |
| `admin/groups/{id}/add_marina/` | POST | Add marina to group (enforces limit) |
| `admin/groups/{id}/remove_marina/` | POST | Remove marina from group |
| `admin/groups/{id}/set_admin/` | POST | Assign MarinaGroupUserRole: admin to a user by email |

### Group console APIs (marina-admin use)

| Endpoint | Method | Description |
|---|---|---|
| `group/me/` | GET | Returns user's groups and roles |
| `group/{id}/overview/` | GET | Per-marina stats: name, status, total_berths, active_bookings, revenue_this_month |
| `group/{id}/financials/` | GET | Aggregated: MRR, outstanding invoices total, paid this month, monthly revenue breakdown by marina (12 months) |
| `group/{id}/marinas/` | GET | Marina list with key stats |
| `group/{id}/staff/` | GET | Harbour masters across all member marinas |
| `group/{id}/staff/invite/` | POST | Invite a manager to a specific marina |
| `group/{id}/staff/{user_id}/remove/` | POST | Remove a manager from a marina |
| `group/{id}/exchange_token/` | POST | Issue a short-lived scoped JWT for a member marina (SSO handoff) |

### Permissions

- `admin/groups/*` — requires `is_platform_admin` (DocksBase internal only)
- `group/*` — requires `MarinaGroupUserRole: admin` for the requested group

---

## DocksBase Admin Portal Changes

### New "Groups" sidebar item

Added to `admin/src/screens/` as `Groups.jsx`, linked in the sidebar navigation.

### Groups list

Table columns: Group name | Marina count / limit | Billing contact | Created date

### Group detail panel (side panel, same pattern as Marinas screen)

- Group name (editable)
- Billing contact email (editable)
- Base currency (editable — used for financial aggregation)
- Marina limit (editable integer input)
- Member marinas list — each row shows marina name + a Remove button
- "Add marina" — searchable dropdown of marinas not currently in any group
- "Set enterprise admin" — input field for email → assigns `MarinaGroupUserRole: admin`

### Marinas tab changes

- Enterprise marinas (those in a group) show the existing `badge-gold` "Enterprise" badge in the plan column
- Sub-line under marina name shows the group name (e.g. "Adriatic Ports Group")

### Creating a group

"New Group" button in Groups tab header → inline form: name, billing email, marina limit → creates group. Marina assignment and admin setup done from the detail panel.

---

## `marina-admin` App — Screens

### Auth

- `/login` — email + password, magic link option
- `/groups` — group picker (only shown if user belongs to 2+ groups)

### Sidebar navigation (post-login)

- Overview
- Financials
- Marinas
- Staff
- Settings

### Overview (`/`)

**Group KPI strip (top):**
- Total MRR across all marinas
- Total outstanding invoices
- Total berths
- Total active bookings

**Marina card grid:**
One card per sub-marina. Each card shows:
- Marina name + status badge
- Total berths
- Occupancy % (active bookings / total berths)
- Revenue this month
- "Open marina" button → deep-links to that marina's `frontend/` URL

### Financials (`/financials`)

- Monthly revenue stacked bar chart — one stack per marina, 12-month rolling window
- Summary row: paid this month, outstanding, MRR
- No per-invoice drill-down (enterprise admins access individual marina invoices via the marina frontend directly)

### Marinas (`/marinas`)

Table: Marina name | Status | Berths | Occupancy | MRR | Actions

Actions column: "Open marina" deep-link only. No operational controls here.

### Staff (`/staff`)

Shows the primary manager (harbour master) for each marina:
- Name, email, marina, role

Actions available to enterprise admin:
- **Invite manager** — enter email + select marina → sends invite. The invited person creates their own `User` account linked to that marina (standard marina staff invite flow). Enterprise admin does not need their own User record at each marina — access is via SSO handoff only.
- **Remove manager** — removes their marina access
- **Cannot** manage day-to-day staff (done inside each marina's own frontend)

### Settings (`/settings`)

- Group name (editable)
- Billing contact email (editable)
- VAT number (editable)
- Base currency (editable — used for financial aggregation across marinas)
- Marina count vs. limit (read-only display)
- No plan changes (handled manually by David)

---

## What Is Explicitly Out of Scope

- Booking creation or reservation management from the group console
- Per-marina operational pipelines (handled in individual marina frontends)
- Self-serve enterprise signup (contact David to set up)
- Per-invoice drill-down in group financials
- Day-to-day staff management (handled in individual marina frontends)
- White-label mobile app configuration (future)

---

## File Structure

```
DocksBase_ManagementSystem/
├── admin/                          # existing — DocksBase internal admin
│   └── src/screens/
│       ├── Groups.jsx              # NEW
│       └── Marinas.jsx             # MODIFIED (enterprise badge + group sub-line)
├── frontend/                       # existing — single-marina management app
├── marina-admin/                   # NEW — enterprise group console
│   ├── package.json
│   ├── vite.config.js
│   └── src/
│       ├── api.js
│       ├── App.jsx
│       ├── screens/
│       │   ├── Login.jsx
│       │   ├── GroupPicker.jsx
│       │   ├── Overview.jsx
│       │   ├── Financials.jsx
│       │   ├── Marinas.jsx
│       │   ├── Staff.jsx
│       │   └── Settings.jsx
│       ├── components/
│       │   ├── layout/
│       │   │   ├── Sidebar.jsx
│       │   │   └── TopBar.jsx
│       │   └── ui/
│       │       ├── KpiStrip.jsx
│       │       ├── MarinaCard.jsx
│       │       └── RevenueChart.jsx
│       └── styles/
│           └── tokens.css
└── backend/
    └── apps/
        └── accounts/
            └── migrations/         # new migration for MarinaGroup fields
```

---

## Implementation Phases

### Phase 1 — Backend + Admin Portal

1. Migration: add `max_marinas`, `billing_contact_email`, `stripe_customer_id` to `MarinaGroup`
2. Backend: admin group viewset + group console APIs
3. Admin portal: `Groups.jsx` screen + marina detail panel updates
4. Marinas list: enterprise badge + group sub-line

### Phase 2 — `marina-admin` App

1. Scaffold Vite + React app, auth screens
2. Overview dashboard
3. Financials screen
4. Marinas screen
5. Staff screen
6. Settings screen
