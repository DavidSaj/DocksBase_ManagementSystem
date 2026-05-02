# Boater Unified Ledger — Design Spec (v2)

**Date:** 2026-05-02
**Sprint:** Phase 1, Step 1 — Ledger First strategy
**Scope:** Manager "Boater Accounts" tab + Payment Allocation Engine + Boater Portal invite + headless boater API

---

## Context

Marina billing operates across three charge sources: berth fees (batch invoices), fuel dock entries (charged to account), and other services (restaurant, manual). Each source already creates an `Invoice` record with a `member` FK and a `source_type` field. The ledger aggregates these into a single view of what a boater owes.

This spec replaces v1. Three architectural upgrades from v1:
1. Per-invoice "Mark Paid" buttons replaced by a **Payment Allocation Engine** — one lump sum cascades across invoices oldest-first
2. Email stub replaced by a real **Boater Portal Invite** via Django token + Resend email
3. Headless API upgraded to the live data source for the **separate Boater Portal frontend**

This is the prerequisite for the fuel dock "Charge to Account" toggle (Phase 1, Step 2).

---

## Scope

### In scope
- `GET /billing/accounts/` — manager member list with outstanding balances
- `GET /billing/accounts/{member_id}/` — manager detail: summary + open invoice list
- `POST /billing/accounts/{member_id}/payments/` — lump sum payment + allocation engine
- `POST /billing/accounts/{member_id}/generate-invite/` — create/activate boater user + send real email
- `GET /api/mobile/my-account/` — live data source for the separate boater portal frontend
- `POST /api/mobile/activate/` — validates invite token, sets password, returns auth token
- "Boater Accounts" tab in `Billing.jsx` — list view + right-side detail drawer
- New `AccountPayment` and `PaymentAllocation` models (new migration)
- Email via existing Resend/django-anymail setup in prod

### Explicitly out of scope
- Boater Portal frontend app (separate repo — spec covers the API contract only)
- Stripe Terminal or physical card reader integration
- Electricity metering
- Per-invoice "Mark Paid" buttons in the ledger drawer (replaced by allocation engine)
- "Settle Entire Account" single-click (avoided to prevent allocation complexity)
- Global "Settle All" button

---

## New Data Models

### `AccountPayment`

Represents a lump sum received from a boater (cash, card, bank transfer). One payment can satisfy multiple invoices via `PaymentAllocation`.

```python
class AccountPayment(models.Model):
    METHOD_CHOICES = [
        ('cash',          'Cash'),
        ('external_card', 'External Card'),
        ('bank_transfer', 'Bank Transfer'),
    ]

    marina           = FK('accounts.Marina')
    member           = FK('members.Member', related_name='account_payments')
    amount           = DecimalField(max_digits=10, decimal_places=2)   # total received
    credit_remaining = DecimalField(max_digits=10, decimal_places=2, default=0)  # overpayment surplus
    method           = CharField(max_length=20, choices=METHOD_CHOICES)
    recorded_by      = FK('staff.StaffMember', null=True, on_delete=SET_NULL)
    notes            = CharField(max_length=500, blank=True)
    created_at       = DateTimeField(auto_now_add=True)
```

### `PaymentAllocation`

Join table between one `AccountPayment` and one `Invoice`, recording how much of the payment was applied to that invoice.

```python
class PaymentAllocation(models.Model):
    payment          = FK(AccountPayment, related_name='allocations', on_delete=CASCADE)
    invoice          = FK('billing.Invoice', related_name='allocations', on_delete=PROTECT)
    allocated_amount = DecimalField(max_digits=10, decimal_places=2)
```

### Existing `Payment` model — unchanged

The existing `Payment` model (single invoice FK) is left intact. It is used by the manual invoice flow (`MarkPaidView`) and will not be touched by this sprint.

---

## Allocation Engine

### Algorithm

`POST /billing/accounts/{member_id}/payments/` triggers:

1. Fetch all `open` invoices for the member, ordered by `due_date ASC NULLS LAST`, then `created_at ASC` as tie-breaker
2. For each invoice, compute `balance_due = invoice.total - SUM(existing PaymentAllocation.allocated_amount for that invoice)`
3. Walk the list, allocating the payment amount greedily:
   - If `remaining >= balance_due`: mark invoice `paid`, create `PaymentAllocation(allocated_amount=balance_due)`, subtract `balance_due` from remaining
   - If `remaining < balance_due`: create partial `PaymentAllocation(allocated_amount=remaining)` — invoice stays `open`, remaining goes to zero
   - Stop when remaining = 0
3. If money remains after all invoices are settled: store surplus in `AccountPayment.credit_remaining`
4. All operations run inside a single database transaction — if anything fails, nothing is committed

### Overpayment handling

Surplus is stored as `AccountPayment.credit_remaining`. It is displayed as **"Credit on account: €X.XX"** in both the manager drawer and the boater portal. No automatic application to future invoices this sprint — the manager handles it manually on the next payment entry.

### Partial payment on a single invoice

When a payment partially covers one invoice (remaining < invoice.total), that invoice remains `open`. The detail endpoint returns `amount_paid_so_far` on each invoice so the drawer can show "€300 of €500 paid".

---

## API Specification

### `GET /billing/accounts/`

**Auth:** `IsAuthenticated` (marina staff)

**Query params:**
- `?show_all=true` — include members with zero outstanding (default: omit)
- `?search=<name>` — case-insensitive name filter

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
      "credit_on_account": "0.00",
      "open_invoice_count": 3,
      "oldest_due_date": "2026-04-01",
      "portal_active": false
    }
  ]
}
```

`portal_active`: `true` if `member.boater_user` exists and `boater_user.is_active=True`.

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
    "berth_code": "A12",
    "portal_active": false
  },
  "summary": {
    "total_outstanding": "850.00",
    "credit_on_account": "0.00",
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
      "amount_paid_so_far": "0.00",
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
- `amount_paid_so_far`: `SUM(PaymentAllocation.allocated_amount)` for that invoice
- `by_category` buckets: `berth`/`booking` → `berth`, `fuel_dock` → `fuel`, `restaurant_order` → `restaurant`, all others → `other`
- `open_invoices` ordered `due_date ASC NULLS LAST`
- `credit_on_account`: `SUM(AccountPayment.credit_remaining)` for this member
- 404 if member does not belong to `request.user.marina`

---

### `POST /billing/accounts/{member_id}/payments/`

**Auth:** `IsAuthenticated` (marina staff)

**Request:**
```json
{
  "amount": "1000.00",
  "method": "bank_transfer",
  "notes": "Wire ref TXN-20260501"
}
```

**Response (200):**
```json
{
  "payment_id": 42,
  "amount_received": "1000.00",
  "amount_allocated": "850.00",
  "credit_remaining": "150.00",
  "invoices_settled": [123, 124],
  "invoices_partial": []
}
```

**Validation:**
- `amount` must be > 0
- `method` must be one of `cash`, `external_card`, `bank_transfer`
- If member has no open invoices and no prior credit, still records the payment with full amount as `credit_remaining`

---

### `POST /billing/accounts/{member_id}/generate-invite/`

**Auth:** `IsAuthenticated` (marina staff)

**Behaviour:**

1. If `member.boater_user` is `null`:
   - Create `User(email=member.email, username=member.email, is_active=False)`
   - Set `member.boater_user = new_user`
2. If `member.boater_user` exists but `is_active=False`: reuse existing inactive user
3. If `member.boater_user` exists and `is_active=True`: still allow re-sending (manager may be resetting access)
4. Generate token: `uid = urlsafe_base64_encode(force_bytes(user.pk))`, `token = default_token_generator.make_token(user)`
5. Send email via `send_mail()` (Resend in prod, console in dev):
   - **To:** `member.email`
   - **Subject:** `"Your DocksBase Boater Portal Access"`
   - **Body:** Contains link `{PORTAL_BASE_URL}/activate/{uid}/{token}/` and marina name

**Response:**
```json
{ "detail": "Invite sent to hans@example.com." }
```

**Error cases:**
- Member has no email → `400 {"detail": "Member has no email address."}`
- Email send fails → `500 {"detail": "Failed to send invite email. Please try again."}`

**Settings:** `PORTAL_BASE_URL` added to `base.py` (e.g. `"https://portal.docksbase.com"`), overridable per environment.

---

### `GET /api/mobile/my-account/`

**Auth:** `IsAuthenticated` + guard: `if not hasattr(request.user, 'member_profile'): return 403`

**Response:** Identical shape to `GET /billing/accounts/{member_id}/`. `member_id` derived from `request.user.member_profile`.

This is the live data source for the boater portal frontend. Not a test stub.

---

### `POST /api/mobile/activate/`

**Auth:** None (pre-authentication endpoint)

**Request:**
```json
{
  "uid": "Mg",
  "token": "abc123-def456",
  "password": "NewSecurePass1!"
}
```

**Behaviour:**
1. Decode `uid` → user pk → fetch `User`
2. Validate token with `default_token_generator.check_token(user, token)` → `400` if invalid or expired
3. Set `user.set_password(password)`, `user.is_active = True`, `user.save()`
4. Return a DRF auth token for immediate login

**Response:**
```json
{ "token": "9944b09199c62bcf9418ad846dd0e4bbdfc6ee4b" }
```

The boater portal frontend stores this token and includes it as `Authorization: Token <token>` on all subsequent requests to `/api/mobile/my-account/`.

---

## UI — Manager "Boater Accounts" Tab

### Tab placement
`Invoices | Utility Meters | Fuel Dock POS | Aged Debtors | Accounts | Boater Accounts`

### List view

Full-width table of members with outstanding balances (or all members when `show_all=true`).

| Column | Notes |
|---|---|
| Name | Member name |
| Type | `seasonal` / `transient` / `associate` badge |
| Berth | `berth_code` or `—` |
| Outstanding | Bold; red if any invoice is past `due_date` |
| Credit | `credit_on_account` — shown in green if > 0 |
| Open Invoices | Count |
| Oldest Due | Date string; red if past today |
| Portal | Green "Active" badge or grey "No portal" |
| Action | "View Account →" button |

Controls above table:
- Search input (`?search=`)
- "Show settled accounts" toggle (`?show_all=true`)

### Detail drawer

Slides in from the right. List remains visible behind it.

**Drawer header:**
- `← Back` link
- Member name · type badge · berth code
- `Total Outstanding: €X.XX` in large text
- `Credit on account: €X.XX` in green (hidden if 0)
- `[ Generate Portal Invite ]` button — fires `POST .../generate-invite/`, shows toast *"Invite sent to {email}"*; button label changes to *"Re-send Invite"* if `portal_active=true`

**Record Payment form** (below header, above invoice list):

```
  Amount:  [ €__________ ]   Method: [ Bank Transfer ▾ ]
  Notes:   [ optional _________________________ ]
                                    [ Record Payment ]
```

On submit: fires `POST .../payments/`. On success:
- Toast: *"€1,000.00 recorded — 3 invoices settled, €150.00 credit remaining"*
- Drawer re-fetches the detail endpoint and re-renders invoice list and summary totals

**Invoice groups:**
Open invoices grouped by category (Berth Fees / Fuel Dock / Restaurant / Other), each group showing its subtotal.

Each invoice row:
- Invoice number + date issued
- Due date — red + `OVERDUE` badge if past today
- Amount + partial payment progress if `amount_paid_so_far > 0` (e.g. *"€300 of €500"*)
- Status badge

No "Mark Paid" button per row — payment is recorded via the form above.

**Empty state:** *"No outstanding charges"* if member has no open invoices and no credit.

---

## Data flow

```
Manager opens drawer
  → GET /billing/accounts/{member_id}/
  → Renders summary, credit, invoice groups, portal status

Manager enters lump sum + clicks "Record Payment"
  → POST /billing/accounts/{member_id}/payments/
  → Allocation engine runs in one transaction
  → On 200: toast, drawer re-fetches

Manager clicks "Generate Portal Invite"
  → POST /billing/accounts/{member_id}/generate-invite/
  → User created/reused, token generated, email sent via Resend
  → On 200: toast, portal_active badge updates

Boater receives email, clicks activation link
  → Separate portal frontend at {PORTAL_BASE_URL}/activate/{uid}/{token}/
  → POST /api/mobile/activate/ → returns auth token
  → Portal stores token, redirects to dashboard

Boater views their tab
  → GET /api/mobile/my-account/ (Authorization: Token ...)
  → Same JSON shape as manager detail endpoint
```

---

## Error states

| Scenario | Behaviour |
|---|---|
| Member not in this marina | 404 on all account endpoints |
| Boater user has no `member_profile` | 403 on `/api/mobile/` endpoints |
| Payment amount = 0 or negative | 400 with validation error |
| Member has no email (invite) | 400 `"Member has no email address."` |
| Activation token expired/invalid | 400 `"Invalid or expired activation link."` |
| Allocation engine DB error | Full rollback, 500 returned |
| List endpoint returns empty | Table shows *"No outstanding balances"* |

---

## Architecture

### New backend files
- `apps/billing/account_views.py` — `AccountListView`, `AccountDetailView`, `RecordPaymentView`, `GenerateInviteView`
- `apps/billing/allocation_service.py` — `allocate_payment(member, amount, method, notes, recorded_by)` — pure function, called inside a transaction
- `apps/mobile/views.py` + `apps/mobile/urls.py` — `MyAccountView`, `ActivatePortalView`
- `apps/billing/migrations/XXXX_account_payment_allocation.py` — new migration for `AccountPayment` + `PaymentAllocation`

### New settings
- `PORTAL_BASE_URL` in `base.py` — used when generating invite links

### Unchanged
- `Invoice`, `InvoiceLineItem`, `Member`, `FuelDockEntry` models
- Existing `Payment` model and `MarkPaidView`
- Existing Resend/anymail email configuration
