# Boater Unified Ledger — Design Spec

**Date:** 2026-05-02
**Sprint:** Phase 1, Step 1 — Ledger First strategy
**Scope:** Manager "Boater Accounts" tab + headless boater mobile API

---

## Context

Marina billing operates across three charge sources: berth fees (batch invoices), fuel dock entries (charged to account), and other services (restaurant, manual). Each source already creates an `Invoice` record with a `member` FK and a `source_type` field. The ledger aggregates these into a single view of what a boater owes.

This is the prerequisite for the fuel dock "Charge to Account" toggle (Phase 1, Step 2) — there is no point charging to an account that has no visible ledger.

---

## Scope

### In scope
- `GET /billing/accounts/` — manager member list with outstanding balances
- `GET /billing/accounts/{member_id}/` — manager detail: summary + open invoice list
- `POST /billing/accounts/{member_id}/email-statement/` — stub endpoint (returns 200, no email sent yet)
- `GET /api/mobile/my-account/` — headless boater endpoint, same response shape as detail
- "Boater Accounts" tab in `Billing.jsx` — list view + right-side detail drawer
- "Mark Paid" per invoice (reuses existing `PATCH /billing/invoices/{id}/mark-paid/`)
- "Email Statement" button (toast stub, no real email this sprint)

### Explicitly out of scope
- Boater login, registration, or invite flows
- "Settle Entire Account" / payment allocation engine
- Stripe Terminal or physical card reader integration
- Electricity metering
- Email delivery for statements (backend stub only)

---

## Architecture

### New backend files
- `apps/billing/account_views.py` — three new view classes (list, detail, email-statement stub)
- New URL patterns wired into `apps/billing/urls.py` and a new `api/mobile/` URL namespace

### Unchanged backend
- `Invoice`, `InvoiceLineItem`, `Member`, `FuelDockEntry` models — no migrations required
- `PATCH /billing/invoices/{id}/mark-paid/` — reused as-is from `MarkPaidView`

### New frontend
- New `'boater-accounts'` tab branch in `Billing.jsx`
- `useBoaterAccounts()` hook — fetches list and detail
- Inline drawer component within the Billing screen (no new file needed given existing pattern)

---

## API Specification

### `GET /billing/accounts/`

**Auth:** `IsAuthenticated` (marina staff)

**Query params:**
- `?show_all=true` — include members with zero outstanding balance (default: omit them)
- `?search=<name>` — filter by member name (case-insensitive contains)

**Response:**
```json
{
  "results": [
    {
      "member_id": 7,
      "name": "Hans Müller",
      "member_type": "seasonal",
      "berth_code": "A12",
      "total_outstanding": "850.00",
      "open_invoice_count": 3,
      "oldest_due_date": "2026-04-01"
    }
  ]
}
```

**Implementation notes:**
- `total_outstanding` and `open_invoice_count`: annotated via `Invoice.objects.filter(member=..., status='open').aggregate()`
- `berth_code`: derived via `Member → Vessel(owner=member) → Booking(status='checked_in')` — most recent checked-in booking across all member vessels, nullable if no active booking
- `oldest_due_date`: `MIN(due_date)` across open invoices, nullable
- Results ordered by `total_outstanding DESC`

---

### `GET /billing/accounts/{member_id}/`

**Auth:** `IsAuthenticated` (marina staff)

**Response:**
```json
{
  "member": {
    "id": 7,
    "name": "Hans Müller",
    "email": "hans@example.com",
    "member_type": "seasonal",
    "berth_code": "A12"
  },
  "summary": {
    "total_outstanding": "850.00",
    "by_category": {
      "berth": "500.00",
      "fuel": "100.00",
      "restaurant": "0.00",
      "other": "250.00"
    }
  },
  "open_invoices": [
    {
      "id": 123,
      "invoice_number": "INV-2026-0042",
      "source_type": "berth",
      "total": "500.00",
      "due_date": "2026-05-05",
      "status": "open",
      "created_at": "2026-05-01T00:00:00Z",
      "items": [
        {
          "description": "Berth A12 — May 2026",
          "quantity": "1.00",
          "unit_price": "500.00",
          "total_price": "500.00"
        }
      ]
    }
  ]
}
```

**Implementation notes:**
- Only `status='open'` invoices appear in `open_invoices`; paid/void invoices are excluded
- `by_category` maps `source_type` to category buckets: `berth`/`booking` → `berth`, `fuel_dock` → `fuel`, `restaurant_order` → `restaurant`, everything else → `other`
- `open_invoices` ordered by `due_date ASC NULLS LAST` so most urgent appear first
- Returns 404 if `member_id` does not belong to `request.user.marina`

---

### `POST /billing/accounts/{member_id}/email-statement/`

**Auth:** `IsAuthenticated` (marina staff)

**Response:** `200 OK` with `{"detail": "Statement queued."}`

**Sprint behaviour:** Stub only — logs intent, returns 200, sends no email. Email delivery is wired in a future sprint when Stripe Connect is live (the statement will include a Stripe Checkout link).

---

### `GET /api/mobile/my-account/`

**Auth:** `IsAuthenticated` + explicit guard: `if not hasattr(request.user, 'member_profile'): return 403`

**Response:** Identical shape to `GET /billing/accounts/{member_id}/`, where `member_id` is derived from `request.user.member_profile`.

**Notes:**
- Lives under a separate URL namespace (`/api/mobile/`) to make the mobile/staff split explicit
- No login, registration, or invite flow is built this sprint — tested via manually created DRF tokens in Postman

---

## UI — Manager "Boater Accounts" Tab

### Tab placement
Added to the existing tab row in `Billing.jsx`:
`Invoices | Utility Meters | Fuel Dock POS | Aged Debtors | Accounts | Boater Accounts`

### List view
Full-width table, shown when tab is active and no member is selected.

| Column | Notes |
|---|---|
| Name | Member name |
| Type | `seasonal` / `transient` / `associate` badge |
| Berth | `berth_code` or `—` |
| Outstanding | Bold; red if any invoice is past `due_date` |
| Open Invoices | Count |
| Oldest Due | Date string; red if in the past |
| Action | "View Account →" button |

Controls above table:
- Search input (fires `?search=` against the list endpoint)
- "Show settled accounts" toggle (fires `?show_all=true`)

### Detail drawer
Slides in from the right when "View Account →" is clicked. The list remains visible behind it (not a blocking modal).

**Drawer header:**
- `← Back` link (closes drawer, returns to list)
- Member name · type badge · berth code
- `Total Outstanding: €X.XX` in large text
- `[ Email Statement ]` button — on click: POST to stub endpoint, show toast *"Statement emailed to {email}"*

**Invoice groups:**
Open invoices grouped by category label (Berth Fees / Fuel Dock / Restaurant / Other), each group showing its subtotal on the right of the group header.

Each invoice row:
- Invoice number + date issued
- Due date — red + `OVERDUE` badge if past today
- Amount
- `[ Mark Paid ]` button — fires existing `PATCH /billing/invoices/{id}/mark-paid/` with `method: 'external_card'` as default; on success the row is removed from the drawer and the summary totals recompute client-side

**Empty state:** If a member has no open invoices, the drawer shows *"No outstanding charges"* with no action buttons.

---

## Data flow

```
Manager clicks "View Account →"
  → GET /billing/accounts/{member_id}/
  → Drawer renders summary + grouped invoice list

Manager clicks "Mark Paid" on invoice row
  → PATCH /billing/invoices/{id}/mark-paid/   (existing endpoint, no changes)
  → On 200: remove row from local state, subtract from summary totals

Manager clicks "Email Statement"
  → POST /billing/accounts/{member_id}/email-statement/   (stub)
  → On 200: toast notification

Boater mobile app (future)
  → GET /api/mobile/my-account/   (IsAuthenticated, member_profile guard)
  → Same JSON shape as detail endpoint
```

---

## Error states

| Scenario | Behaviour |
|---|---|
| Member not in this marina | 404 |
| Boater user has no `member_profile` | 403 on `/api/mobile/my-account/` |
| `Mark Paid` on already-paid invoice | Existing endpoint returns 400; toast shows error message |
| List endpoint returns empty | Table shows "No outstanding balances" empty state |
