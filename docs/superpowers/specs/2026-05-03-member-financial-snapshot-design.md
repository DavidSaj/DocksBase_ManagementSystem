# Member Financial Snapshot & Boater Account UX

**Date:** 2026-05-03
**Branch:** feature/map-editor-city-builder (to be moved to its own branch or merged into ongoing work)

---

## Goal

Split financial information into two distinct contexts that match the user's mental model:

- **Directory → Members** — customer service / quick check while someone is at the desk
- **Billing → Boater Accounts** — deliberate accounting work on Tuesday morning

Connect them with a single "View Full Ledger →" jump so neither screen needs to duplicate the other's work.

---

## 1. Financial Snapshot Card (Members.jsx)

### Location
Inserted at the top of the existing member detail panel (right side), above the current CRM fields (Email, Phone, Insurance, etc.).

### Data source
Fetch `GET /billing/accounts/{member_id}/` when a member is selected. This endpoint already returns:
```json
{
  "summary": { "total_outstanding", "credit_on_account" },
  "open_invoices": [{ "id", "invoice_number", "total", "amount_paid_so_far", "due_date", "source_type" }]
}
```
Loading state: show a subtle skeleton / "Loading…" in place of the card. Error state: hide the card silently (don't break CRM data).

### Card content

**Balance number (large)**
- `€{total_outstanding}` in red if any open invoice has `due_date < today`, otherwise default navy/dark colour
- If balance is €0 and no open invoices: show `€0.00` in green with a small "✓ Settled" label

**Mini invoice list**
- Up to 3 open invoices, sorted by `due_date` ascending (oldest first)
- Each row: `invoice_number` + due date (red + "OVERDUE" badge if past due) + remaining amount
- If more than 3 open invoices: show "…and N more" below the list

**Action buttons**
- `[ Record Payment ]` — opens the Record Payment modal (see §1.1)
- `[ View Full Ledger → ]` — triggers the cross-screen jump (see §2)

### 1.1 Record Payment Modal

A small focused modal (similar to the existing `payModalInv` modal in Billing.jsx).

**Fields:**
- Amount (number input, step 0.01)
- Payment Method (segmented control: Cash / Card / Bank Transfer)
- Notes (optional text input)

**On submit:** `POST /billing/accounts/{member_id}/payments/` with `{ amount, method, notes }`. On success: close modal, re-fetch the snapshot data to update the balance. On error: show inline error message inside the modal.

**Dismiss:** clicking the backdrop or a Cancel button closes the modal without submitting.

### Implementation notes
- `Members.jsx` gets a new local state: `financialSnap` (the fetched account data), `snapLoading`, `snapError`, and `showPayModal`.
- Fetch is triggered in a `useEffect` keyed on `sel?.id` — fires whenever a different member is selected.
- No new hook file needed; the fetch is simple enough to live inline in `Members.jsx`.
- `Members.jsx` must accept the `setScreen` prop (it is already passed by `App.jsx` via `<Screen setScreen={setScreen} />` but currently ignored).

---

## 2. Cross-Screen Jump ("View Full Ledger →")

### Mechanism
localStorage hand-off — simple, avoids prop drilling, keeps URL clean for a desktop app.

**In Members.jsx** (on "View Full Ledger →" click):
```js
localStorage.setItem('billing_open_member', String(sel.id));
setScreen('billing');
```

**In Billing.jsx** (on mount / tab change to `boater-accounts`):
```js
const pendingId = localStorage.getItem('billing_open_member');
if (pendingId) {
  localStorage.removeItem('billing_open_member');
  setTab('boater-accounts');
  openDrawer(Number(pendingId));
}
```
The check runs in a `useEffect` with an empty dependency array so it fires once on mount. If the user navigates to Billing directly (no pending ID), nothing changes.

---

## 3. Boater Accounts Tab Enhancements (Billing.jsx)

### 3.1 Tab reordering
Current order: `Invoices → Utility Meters → Fuel Dock POS → Aged Debtors → Accounts → Boater Accounts`
New order: `Invoices → Boater Accounts → Utility Meters → Fuel Dock POS → Aged Debtors → Accounts`

### 3.2 Aging bucket summary (list view)
Three summary cards above the existing table:

| Card | Label | Colour |
|------|-------|--------|
| Members with oldest due < 30 days | "< 30 Days" | orange badge |
| Members with oldest due 30–60 days | "30–60 Days" | red badge |
| Members with oldest due > 60 days | "60+ Days" | red badge, bold |

Bucket logic (client-side, computed from the `accounts` array):
```js
function ageDays(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);          // normalize to local midnight
  const due = new Date(dateStr);
  due.setHours(0, 0, 0, 0);            // normalize to local midnight
  return Math.floor((today - due) / 86_400_000);
}
```
Both dates are normalized to local midnight before the diff, avoiding off-by-one errors for users in non-UTC timezones.

Only members with `total_outstanding > 0` and a valid `oldest_due_date` that is past today count toward buckets.

### 3.3 Table sort
Sort `accounts` by `oldest_due_date` ascending (nulls last) before rendering — most overdue at top.

### 3.4 Detail drawer additions
Add three heavy-action buttons below the existing "Record Payment" form:
- `[ Apply Credit ]` — placeholder, disabled with tooltip "Coming soon"
- `[ Issue Refund ]` — placeholder, disabled with tooltip "Coming soon"  
- `[ Send Payment Reminder ]` — placeholder, disabled with tooltip "Coming soon"

These are intentionally non-functional. They claim the visual space now so the layout is stable when the backend endpoints are added later.

---

## Out of Scope

- Backend changes to support Apply Credit, Issue Refund, or bulk reminder endpoints
- Full ledger history view (all historical invoices, credit notes, utility histories) — this is a future sub-project
- URL-based deep linking to a specific member's account
