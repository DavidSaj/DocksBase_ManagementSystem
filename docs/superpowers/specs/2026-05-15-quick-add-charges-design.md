# Quick-Add Charges — Design

**Date:** 2026-05-15
**Status:** Draft
**Scope:** A staff-facing "tap-tap-done" mobile flow that lets a dockhand add a small, ad-hoc charge to a boater's tab in ~5 seconds. Lives in the `field/` PWA, writes a real invoice line via the existing billing models, and is undoable for 30 seconds.

---

## 1. Problem

A boater on B-7 flags down a dockhand and asks for two bags of ice. A skipper on the fuel dock asks for a $20 pump-out without a fuel purchase. A guest on the transient dock owes a late check-out penalty. Today there is no fast path for any of these:

- The full **Billing → New Invoice** flow (see `backend/apps/billing/service.py`, `frontend/src/screens/Billing.jsx`) is an invoice-level workflow designed for back-office staff. It is too heavy for one-handed phone use.
- The **Fuel Dock Quick Sale** flow (see `2026-05-02-fuel-dock-quicksale-design.md`, `field/src/screens/field/FuelDockFlow.jsx`, `backend/apps/fuel_dock/models.py:FuelDockEntry`) is hard-wired to the fuel POS — it writes to a `FuelDockEntry` row, requires `fuel_type` (diesel/petrol/pump_out), and lives behind the "Fuel Dock" action. Asking a dockhand on the transient dock to "open Fuel Dock to sell two bags of ice" is a non-starter both in UX and in data model — ice is not fuel.
- The **Dockwalk** flow (`field/src/screens/field/DockwalkFlow.jsx`, `backend/apps/utilities/models.py:PendingUtilityCharge`) is meter-driven and batches charges via a monthly sweep. It does not handle one-off retail/service items.
- **Boatyard work orders** (`backend/apps/boatyard/`) are the right tool for large multi-line invoices, not "$5 of ice."

The result: dockhands either don't capture these charges (revenue leak), or they write them on paper and a back-office user keys them in later (double work, lost audit trail).

---

## 2. Goals & Non-Goals

### Goals (v1)

1. A single "Quick Charge" tile on the `field/` PWA home screen.
2. Pick a boat → tap an item → confirm → toast. Five seconds end-to-end.
3. Items in scope for v1:
   - **Ice** (count, e.g. 2 bags)
   - **Pump-out** (flat fee — *not* the fuel-dock pump-out, which is sold via the fuel POS)
   - **Generic services** — a per-marina configurable list (e.g. "Ice cube delivery", "Trash haul-off", "Loaner cart", "Late departure fee")
   - **Late fees / penalties** (flat, manual)
4. Charges land on an actual invoice line so existing accounting export, tax, and ledger search "just work."
5. Audit trail: every charge records who, when, and against which boat/reservation/member.
6. Undoable for 30 seconds (fat-finger guard).
7. Manager-only **void** after the undo window — creates a credit-note line, never hard-deletes.

### Non-goals (v1)

- **Fuel sales** — already covered by `FuelDockFlow` and `FuelDockEntry`.
- **Retail / ship-store POS** — the candy-bar-and-snorkel-mask use case. Legacy systems do this; we are explicitly out. (If a marina wants to sell branded merchandise, they use the existing service-catalog UI; we will not build a barcode-scan POS in v1.)
- **Boatyard work orders** — multi-line, multi-day jobs belong in `backend/apps/boatyard/`.
- **Open guest tabs without a reservation** — if there is no reservation, the dockhand cannot add a charge. Walk-in handling is phase 3.
- **Boater-facing approval / dispute UI** — phase 3.
- **Offline queue with conflict resolution** — phase 2.

---

## 3. What Already Exists (file citations)

| Concern | Where it lives today |
|---|---|
| Invoice header | `backend/apps/billing/models.py:Invoice` (statuses `draft`/`unpaid`/`open`/`paid`/`void`) |
| Invoice line item | `backend/apps/billing/models.py:InvoiceLineItem` — `description`, `quantity`, `unit_price`, `total_price`, FK `chargeable_item`, `tax_rate` |
| Service / item catalog | `backend/apps/billing/models.py:ChargeableItem` — already has `show_in_pos`, `category`, `pricing_model`, `unit_price`, `tax_category` FK, `is_active`, `marina` scope |
| Catalog UI | `marina-admin/` Service Catalog screen (see `2026-05-03-service-catalog-pricing-engine-design.md`) |
| Reservation status | `backend/apps/reservations/models.py:Reservation.status` — includes `checked_in`, `overstay`, etc. |
| Reservation → member/vessel | `Reservation` has `member` FK, `vessel` FK, and a `berth_assignment` |
| Tax rate | `backend/apps/billing/models.py:TaxRate` linked via `ChargeableItem.tax_category` |
| Fuel POS | `backend/apps/fuel_dock/models.py:FuelDockEntry` + `field/src/screens/field/FuelDockFlow.jsx` |
| Staged-then-swept pattern | `backend/apps/utilities/models.py:PendingUtilityCharge` (rows queued, monthly task sweeps into the next invoice) |
| Staff PWA shell | `field/src/screens/Field.jsx` — `ACTIONS` grid drives navigation; each action ID renders a `*Flow.jsx` component |
| Staff identity | `backend/apps/staff/models.py:StaffMember` (has `role` free-text field) |
| Idempotency precedent | `backend/apps/channels/services/ota.py` and `backend/apps/accounting/models.py` already use idempotency keys |

### Can the fuel-dock quicksale infrastructure be reused?

**Partially, yes — but not by extending it.** The `ChargeableItem.show_in_pos` flag, the per-marina pricing model, and the `field/` PWA flow shell pattern are all reusable. The `FuelDockEntry` table is **not** reusable: it is fuel-specific (mandatory `fuel_type` choice, litres column, pump number). Forcing ice and late fees through it would pollute fuel reporting and force NULL-able columns on a model whose job is fuel reconciliation.

Decision: Quick-Add Charges writes directly to `InvoiceLineItem`. The fuel POS stays as-is. The two flows share the catalog (`ChargeableItem`) and the field-PWA flow shell, but not the storage layer.

---

## 4. Data Model

### 4.1 No new "Item" table — reuse `ChargeableItem`

The catalog of quick-charge items lives in `ChargeableItem`. We add **one new flag**:

| Field | Type | Purpose |
|---|---|---|
| `show_in_quick_charge` | `BooleanField(default=False)` | Surfaces this item in the dockhand Quick Charge grid |

Why a new flag instead of overloading `show_in_pos`? `show_in_pos` already means "show in the back-office Billing POS tile grid" (currently fuel-only). Quick Charge is a different audience (dockhands on phones) and a different surface (`field/` not `marina-admin/`). The Marina Manager will want to expose ice on Quick Charge but not on the back-office tile grid (which would be redundant and visually noisy in Billing). A second flag keeps these audiences decoupled.

Recommended categories used by Quick Charge: `Category.RETAIL`, `Category.SERVICE`, `Category.UTILITY` (pump-out), `Category.PENALTY` (late fees). The catalog query filters by `show_in_quick_charge=True` and `is_active=True`, marina-scoped.

Tax + GL routing is **already** inherited from `ChargeableItem.tax_category` (FK to `TaxRate`). No new columns needed; this is the whole point of the Service Catalog being the single source of truth.

### 4.2 No staging table — write straight to the invoice

We considered mirroring `PendingUtilityCharge` (stage now, sweep monthly into invoice). **Rejected.** Three reasons:

1. **Boater-visible.** Unlike meter readings (which only make sense after rollover into a billing period), a dockhand handing a customer ice expects that charge to be immediately visible on the customer's tab, in the boater portal, and on a printable receipt. Staging delays this by up to a month.
2. **Sweep complexity for transients.** `PendingUtilityCharge` works because seasonal members have a single guaranteed monthly invoice. Transient guests check out in 1–7 days; there is no scheduled future invoice to sweep into. Writing to the current invoice is simpler.
3. **Refund paths.** A staging row that hasn't been swept yet needs different undo logic from a swept row. Two code paths.

Decision: Quick-Add writes an `InvoiceLineItem` directly. The target invoice is resolved like this:

```
def resolve_target_invoice(reservation):
    # 1. If reservation has a draft invoice, use it.
    # 2. Else if reservation has an open (unpaid) invoice, use it.
    # 3. Else create a new draft invoice for this reservation.
```

The third branch is the common transient case: the dockhand adds ice mid-stay, before the check-out invoice has been finalised. The auto-created draft is finalised at check-out by the existing check-out flow (`backend/apps/reservations/views.py` check-out handler).

For seasonal members on monthly billing, the same logic naturally selects the open monthly invoice if one exists, or creates a draft that the monthly batch run (`backend/apps/billing/batch_service.py`) can merge.

### 4.3 Audit log — extend `InvoiceLineItem`

`InvoiceLineItem` today has no "who added me" column. We add:

| Field | Type | Purpose |
|---|---|---|
| `added_by` | `FK staff.StaffMember, null=True, blank=True` | Who created this line. NULL for system-generated lines (batch runs, fuel POS) so the migration is non-destructive. |
| `source` | `CharField(max_length=30, blank=True)` | `'quick_charge'`, `'fuel_dock'`, `'reservation'`, `'utility_sweep'`, `'manual'`. Discriminates lines for reporting + audit. |
| `idempotency_key` | `CharField(max_length=64, blank=True, db_index=True)` | Unique per `(marina, idempotency_key)` for `source='quick_charge'`. Allows offline replay. |
| `voided_at` | `DateTimeField(null=True, blank=True)` | When the line was voided (post-undo-window). |
| `voided_by` | `FK staff.StaffMember, null=True, blank=True` | Manager who voided. |
| `void_credit_line` | `FK self, null=True, blank=True` | Points to the offsetting credit line. |

Voiding never deletes. It creates a second `InvoiceLineItem` with negative `quantity` and `total_price`, links the two, and stamps `voided_at` on the original. The accounting export sees both rows; the boater sees a zeroed-out pair on the invoice PDF.

Undo (within 30 seconds) **does** hard-delete the line via a server-side endpoint that checks `created_at > now() - 30s` AND `added_by == request.user.staff_member`. This is safe because the line has not been finalised, exported, or seen by the boater.

### 4.4 Reservation guard

To prevent charging a boat that left yesterday, the catalog query for "active boats" returns only reservations where `status IN ('checked_in', 'overstay', 'pending_checkout')`. Walk-up guests with no reservation are out of scope for v1 (see §2).

---

## 5. Staff Mobile UX

All UI lives in `field/` (the existing staff PWA at `field/src/`). No changes to `marina-admin/`.

### 5.1 Home screen — new action tile

In `field/src/screens/Field.jsx`, append a new entry to `ACTIONS`:

```
{ id: 'quickcharge', label: 'Quick Charge', icon: 'tag', sub: 'Add ice, pump-out, fees' }
```

Tapping it routes to `<QuickChargeFlow onBack={…} />`, a new file at `field/src/screens/field/QuickChargeFlow.jsx`.

### 5.2 Flow steps

The flow has **three** screens, designed to be operable one-handed with thumb reach on a 5-inch phone:

**Screen 1 — Pick a boat.**

- Top: a single search input (autofocused). Placeholder: "Name, slip, RES-…".
- Below: scrollable list of currently-on-dock reservations, sorted by berth code ascending. Each row shows: vessel name, member name (or guest name), berth code, slip-side avatar dot. Tappable target height ≥ 56px.
- Source: `GET /api/v1/quick-charge/active-boats/`. Refresh-on-pull.
- If the dockhand has just checked someone in, that reservation appears at the top of the list (sort: most recent `checked_in_at` first within the last hour).

**Screen 2 — Pick an item.**

- Top bar: "Charging **John Smith / Slip B-7**" + ✕ to go back.
- 2-column tile grid of items from the catalog. Each tile: icon, name, price (formatted with marina currency). Tile size ≥ 100×100.
- Item tiles fall into two visual variants:
  - **One-tap items** (`default_qty = 1`, e.g. Pump-out, Late Fee) — tapping immediately advances to Screen 3 with `qty=1`.
  - **Quantity items** (e.g. Ice) — tile shows a `−  1  +` stepper inline. Default `qty=1`, max 99. Tapping the **name area** (not ± buttons) advances with the chosen qty.
- Footer pinned at bottom: "Add custom note (optional)" toggle → reveals a single-line text input for the line's `description` override (e.g. "delivered to swim platform"). Max 80 chars.

**Screen 3 — Confirm + Toast.**

- Big green confirm button: "**Add €X.YY to John Smith / Slip B-7**". Total is computed client-side using `unit_price × qty` (with tax shown if `tax_inclusive` setting is on for the marina).
- Tap → POST, return to Screen 1.
- Bottom of the home screen shows a toast that persists 30 seconds: "**€X.YY added — Undo**". Tapping Undo calls the undo endpoint and removes the toast. After 30 s the toast disappears and Undo is no longer available.

### 5.3 Undo button persistence

The toast and the undo button are anchored at the bottom of the `field/` PWA root layout (not the flow itself) so undoing works even if the dockhand has moved on to check in another boat. The undo state lives in a small React context (`UndoContext`) so any screen renders the same toast. After 30 s the toast fades.

### 5.4 Offline support (phase 2)

In phase 1 the POST is online-only — if there is no signal the confirm button shows "No signal — try again" and the line is not created. This is acceptable because the dockhand typically has cellular coverage on most marina docks.

Phase 2 adds an offline queue using the existing service-worker pattern in `field/` (Vite PWA). Pending charges are stored in IndexedDB with a client-generated UUID `idempotency_key` and retried with exponential backoff. The server's idempotency check (see §6) makes this safe.

---

## 6. API Endpoints

All endpoints under `/api/v1/quick-charge/`, authenticated by JWT (same auth as the rest of `field/`). All endpoints are marina-scoped via the requesting user's `staff_member.marina`.

### `GET /api/v1/quick-charge/items/`

Returns the catalog for the current marina:

```
[
  { "id": 12, "name": "Bag of Ice",  "category": "retail",
    "default_qty": 1, "unit_price": "5.00", "tax_rate_pct": "20.00",
    "qty_variable": true,  "icon_hint": "snowflake" },
  { "id": 13, "name": "Pump-out (off-dock)", "category": "service",
    "default_qty": 1, "unit_price": "20.00", "tax_rate_pct": "20.00",
    "qty_variable": false, "icon_hint": "droplet" },
  ...
]
```

Filter: `is_active=True AND show_in_quick_charge=True AND marina=<requester>`. Ordered by `category, name`.

`qty_variable` is a derived boolean: `true` when the front-end should render the ±1 stepper. Mapped from `pricing_model='flat_fee'` items where the catalog admin has marked them as quantity-eligible (a new bool we may add later; for v1 we can derive it from category — `retail` defaults `true`, everything else defaults `false`).

### `GET /api/v1/quick-charge/active-boats/`

Returns reservations currently on dock, lightweight payload:

```
[
  { "reservation_id": "RES-2-04891",
    "vessel_name": "Sea Glass",
    "member_name": "John Smith",
    "berth_code": "B-7",
    "status": "checked_in",
    "checked_in_at": "2026-05-14T16:02:00Z" },
  ...
]
```

Filter: `reservation.marina = requester.marina AND status IN ('checked_in', 'overstay', 'pending_checkout')`. Ordered by `berth_code ASC`. Limit 200 — if a marina has more checked-in boats than that, the front-end relies on search.

### `POST /api/v1/quick-charge/`

Body:
```
{
  "reservation_id": "RES-2-04891",
  "item_id": 12,
  "qty": 2,
  "note": "delivered to swim platform",
  "idempotency_key": "<uuid v4 generated client-side>"
}
```

Response 201:
```
{
  "line_id": 88142,
  "invoice_id": 9912,
  "invoice_status": "draft",
  "description": "Bag of Ice — delivered to swim platform",
  "qty": "2.00",
  "unit_price": "5.00",
  "total_price": "10.00",
  "tax_rate": "20.00",
  "added_by": { "id": 4, "name": "Maria L." },
  "added_at": "2026-05-15T11:14:22Z",
  "can_undo_until": "2026-05-15T11:14:52Z"
}
```

Server behaviour:

1. Resolve `(marina, idempotency_key)` — if a row with `source='quick_charge'` exists, return it as 200 (replay safe). Idempotency rows older than 24h are ignored to keep the index small.
2. Resolve the target invoice (see §4.2).
3. Create the `InvoiceLineItem` with `chargeable_item=<item>`, `quantity=qty`, `unit_price=item.unit_price`, `total_price=qty*unit_price`, `tax_rate=item.tax_rate_pct`, `description=item.name (+ note)`, `added_by=request.user.staff_member`, `source='quick_charge'`, `idempotency_key=<uuid>`.
4. Recompute `invoice.subtotal`, `invoice.tax_total`, `invoice.total` (call existing `billing.service.recompute_totals(invoice)`).
5. Emit signal `quick_charge.created` so notifications, analytics, and the boater portal can react.

### `POST /api/v1/quick-charge/<line_id>/undo/`

Hard-deletes the line. Allowed only if:
- `line.source == 'quick_charge'`
- `line.added_by == request.user.staff_member` (dockhands undo their own; managers see the manager void path instead — see §7)
- `now() - line.created_at <= 30 seconds`
- Invoice is still `draft` (a `paid` invoice can never be retroactively edited)

On success: recompute invoice totals, return 204. On any guard failure: 400 with a human-readable reason ("Undo window expired — ask a manager to void").

### `POST /api/v1/quick-charge/<line_id>/void/`

Manager-only. Creates an offsetting negative-quantity line, stamps `voided_at`/`voided_by` on the original, links `void_credit_line`. Returns the new credit line. Visible to the boater on the invoice PDF.

---

## 7. Permissions

A new permission key `billing.add_quick_charge` (Django permission, attached to a "Dockhand" group seeded for each new marina).

| Role | Catalog read | Add charge | Undo own | Void any |
|---|---|---|---|---|
| Dockhand | yes | yes | yes (≤30s) | no |
| Manager | yes | yes | yes (own, ≤30s) | yes |
| Owner | yes | yes | yes | yes |
| Boater (portal) | no | no | no | no |

The check is `request.user.has_perm('billing.add_quick_charge')` on `POST /api/v1/quick-charge/`. The catalog `GET` is open to any staff member of the marina (read-only). The void endpoint additionally checks `is_marina_manager_or_owner` (existing helper in `backend/apps/accounts/`).

---

## 8. Tax

Every `ChargeableItem` already carries a `tax_category` FK to `billing.TaxRate`. When the line is created, the rate at the moment of creation is **copied** into `InvoiceLineItem.tax_rate` (existing field). This snapshot semantics is the same pattern used by the rest of billing — see `backend/apps/billing/service.py` — and means a later catalog edit cannot retro-modify historical lines. The accounting export (see `backend/apps/accounting/`) consumes the snapshot directly.

---

## 9. Audit

Every quick charge logs:

- `added_by` (FK `StaffMember`) — required for `source='quick_charge'`.
- `created_at` — auto.
- `reservation_id` — via the parent `Invoice.reservation` FK.
- `idempotency_key` — for offline-replay forensics.
- `source='quick_charge'` — discriminates this line from auto-generated lines in reports.

Optional in phase 2: `created_geo` (lat/lng captured from the dockhand's phone) and `created_device` (PWA install ID). These help spot anomalies — e.g. a charge added from outside the marina perimeter — but are not required for v1.

The Settings → Activity log (existing) gains a new row per charge so the marina manager can see "Maria L. added $10 ice to RES-2-04891 at 11:14 today."

---

## 10. Edge Cases

| Case | v1 behaviour |
|---|---|
| Boat has no open or draft invoice | Auto-create a draft, attach the line. |
| Boat is checked-out but invoice unpaid | Allow if reservation status is `pending_checkout`; reject if `checked_out` or beyond (rare — dockhand should use the back-office tool to amend a finalised invoice). |
| Guest is on a no-reservation tab | Reject. Out of scope v1. Toast: "No active reservation — add via the office." |
| Network failure mid-POST | Front-end retains the form state and shows "Try again." Phase 2 queues offline. |
| Duplicate submit (double-tap) | Idempotency key dedupes server-side. |
| Item is deleted/deactivated between catalog fetch and POST | Server returns 410 Gone; front-end refreshes catalog. |
| Marina deactivates a chargeable item | Future POSTs reject; existing lines unaffected (snapshot semantics). |
| Refund after invoice is paid | Use the existing credit-note flow on the invoice — out of Quick Charge scope. |
| Manager wants to bulk-void five lines | Manager voids one-at-a-time in v1. Bulk-void is phase 3. |
| Dockhand mis-charges the wrong boat 31 s after the fact | Manager voids; manager re-charges the right boat. Two audit rows. |

---

## 11. Phasing

### Phase 1 (this spec, ship-now)

- Schema migration: `show_in_quick_charge`, `added_by`, `source`, `idempotency_key`, `voided_at`, `voided_by`, `void_credit_line` on `InvoiceLineItem`; one `ChargeableItem` boolean.
- `GET /quick-charge/items/`, `GET /quick-charge/active-boats/`, `POST /quick-charge/`, `POST /quick-charge/<id>/undo/`, `POST /quick-charge/<id>/void/`.
- `field/src/screens/field/QuickChargeFlow.jsx` (Screens 1–3 + Undo toast).
- New action tile on `field/src/screens/Field.jsx`.
- Marina Admin → Service Catalog gains a "Show in Quick Charge" checkbox (small addition to the existing form in `marina-admin/`).
- Dockhand permission group seeded.

### Phase 2

- Offline queue + IndexedDB persistence in `field/`.
- Geolocation tag on the line at POST time.
- Bulk void on Settings → Activity log.

### Phase 3

- Open guest tab (charge without a reservation).
- Boater notification: "Maria added $10 ice to your tab — view / dispute" via the existing notifications app (`backend/apps/notifications/`), with a 24-hour dispute window before the line is locked.
- Configurable approval threshold per marina (e.g. any charge over $50 requires boater acknowledgement).

---

## 12. Test Plan

### Backend

1. `POST /quick-charge/` happy path — creates a line on the reservation's draft invoice; totals recomputed; `added_by` stamped.
2. Auto-create draft invoice when none exists.
3. Idempotency replay returns the same line, 200 not 201.
4. `qty=0` rejected (400).
5. Item from another marina rejected (404 via marina scope).
6. Deactivated item rejected (410).
7. Reservation `checked_out` rejected.
8. Undo within 30 s succeeds; line is gone; totals recomputed.
9. Undo at 31 s rejected (400).
10. Undo on someone else's line rejected (403).
11. Undo on paid invoice rejected (400).
12. Void by manager creates negative-quantity credit line, links `void_credit_line`, stamps `voided_at`, recomputes totals.
13. Void by dockhand role rejected (403).
14. Tax rate is snapshotted (changing the catalog tax after line creation does not move the existing line).
15. `GET /quick-charge/active-boats/` excludes `checked_out` reservations.
16. Permission check: a user without `billing.add_quick_charge` gets 403.
17. Cross-marina leakage test: catalog and active-boats are filtered by marina.

### Frontend (field PWA)

1. Render Quick Charge tile on home; tap routes to flow.
2. Screen 1 search filters by name/slip/RES.
3. Screen 2 stepper increments and decrements correctly; min 1, max 99.
4. Confirm button reflects live total.
5. Toast appears after POST; Undo button visible for 30 s; auto-dismisses at 30.
6. Undo tap removes the line and dismisses toast.
7. POST failure shows inline retry, does not clear form.
8. Idempotency key is generated client-side and re-sent on retry.
9. Custom note populates the line description with item-name prefix.
10. Undo toast survives navigation to a different flow.

### Integration

1. End-to-end: dockhand adds 2 bags of ice → manager opens Billing → invoice shows the draft with two-bag line + correct tax → accounting export contains the line with correct GL category.
2. Manager voids; PDF shows both the original line and the credit; invoice total is unchanged from pre-charge state.
3. Monthly batch run (`billing.batch_service`) merges a Quick Charge draft invoice into a seasonal member's monthly invoice cleanly.

---

## 13. Open Questions

1. **Quantity-eligible items** — for v1 we derive `qty_variable` from category. Is that sufficient, or should the catalog grow an explicit `qty_variable` bool? (Affects the catalog admin form.)
2. **Undo window length** — 30 s is a guess. Should it be configurable per marina (e.g. 60 s for slower-moving operations)?
3. **Active-boats list ordering** — berth code vs. most-recently-touched. Berth is predictable; "recent" rewards the workflow of "I just checked them in, now I'm adding ice." Need staff feedback after first dogfood.

---

## 14. Files Touched (rough estimate)

**Backend**
- `backend/apps/billing/models.py` — add fields to `InvoiceLineItem` and `ChargeableItem`.
- `backend/apps/billing/migrations/XXXX_quick_charge.py` — new migration.
- `backend/apps/billing/serializers.py` — expose new fields.
- `backend/apps/billing/quick_charge_views.py` — new file (4 endpoints + permissions).
- `backend/apps/billing/urls.py` — wire the new routes.
- `backend/apps/billing/service.py` — add `resolve_target_invoice(reservation)` helper.
- `backend/apps/billing/tests/test_quick_charge.py` — new test module.
- `backend/apps/accounts/management/commands/` — seed "Dockhand" permission group.

**Frontend (field PWA)**
- `field/src/screens/Field.jsx` — add `quickcharge` action.
- `field/src/screens/field/QuickChargeFlow.jsx` — new flow component.
- `field/src/context/UndoContext.jsx` — new global undo state.
- `field/src/api.js` — add quick-charge helpers (or use existing axios instance directly).

**Frontend (marina-admin)**
- Service Catalog form — add `show_in_quick_charge` checkbox next to the existing `show_in_pos` one.
- 
answer: 

As your system architect, this is a phenomenal execution of the "tap-tap-done" requirement. Avoiding the PendingUtilityCharge staging table is the exact right move—putting retail charges directly on the draft invoice ensures the boater portal and the Harbor Master's ledger are instantly in sync. The 30-second Undo guard is also a beautiful piece of UX that will save your support team countless hours fixing voided lines.However, bridging the gap between high-speed physical retail (handing someone ice) and strict asynchronous accounting exposes three severe operational traps. If you build this spec as written, you will cause data corruption during check-out and permanently break your invoice merging logic.Here is the teardown of the hidden flaws and how to patch them, along with the answers to your open questions.1. The Race Condition at Check-Out (Data Corruption Trap)The Spec States: "Allow if reservation status is pending_checkout... Auto-create a draft invoice when none exists... The draft is finalised at check-out."The Error: A boater clicks "Pay & Check Out" on their phone. The backend starts processing their Stripe payment for the slip fee (which takes ~3 seconds). In that exact 3-second window, a dockhand hands them a bag of ice and taps "Quick Charge." The Quick Charge endpoint sees pending_checkout, finds the open invoice, and appends the $5 line item. Stripe finishes processing the original amount. The invoice is marked paid, but the totals now reflect the ice that was never charged to the card. Your ledger is corrupted.The Fix: The target invoice resolution logic in resolve_target_invoice must actively check the payment_intent_status. If the parent Reservation or its active Invoice has a pending or processing Stripe intent, the Quick Charge endpoint must immediately return a 409 Conflict ("Checkout in progress. Cannot add charges."). Do not attempt to append lines to an invoice that is actively hitting a payment gateway.2. The Multi-Draft Merge Disaster (Accounting Trap)The Spec States: For seasonal members, "creates a draft that the monthly batch run can merge."The Error: If a dockhand adds Ice on Tuesday (creates Draft 1) and adds Pump-out on Thursday (creates Draft 2), your monthly batch run now has to figure out how to merge multiple floating draft invoices into the master monthly invoice without losing tax snapshots or duplicate-billing the boater.The Fix: You must enforce a Single Open Draft Rule per reservation. Update resolve_target_invoice: it must execute a select_for_update() lock on the Reservation. If a draft invoice already exists, it must use it. It can only create a new draft if exactly zero un-finalized invoices exist.3. The Cross-Marina Replay Vulnerability (Idempotency Trap)The Spec States: "Resolve (marina, idempotency_key)... Unique per (marina, idempotency_key)... Idempotency rows older than 24h are ignored."The Error: If a dockhand with multi-marina access (e.g., a regional manager) sends a Quick Charge request with a UUID, and then accidentally fires that exact same UUID payload against Marina B's endpoint, the uniqueness constraint on (marina, idempotency_key) will allow the second charge because the marina ID is different.The Fix: Idempotency keys must be globally unique across the entire platform, not scoped to the marina. The constraint must be simply unique=True on the idempotency_key column (where source='quick_charge').Answers to Your Open Questions1. Quantity-eligible items:Answer: Do not derive qty_variable from the category. It is far too brittle. Some retail items (like a branded Yeti cooler) might be strictly limited to a quantity of 1 due to inventory tracking, while some services (like "Extra Dock Line Rental") might need a quantity of 4. Add the explicit qty_variable = models.BooleanField(default=False) to the ChargeableItem model now. It is a tiny schema addition that saves you from writing hacky override logic later.2. Undo window length:Answer: Keep it strictly at 30 seconds, hardcoded. Do not make this configurable per marina. A configurable window creates a nightmare for your database state machine. If a marina sets the window to 5 minutes, that means a line item sits in "limbo" for 5 minutes, preventing the boater from checking out or paying their bill. 30 seconds is standard enterprise UX for an "Undo" toast (e.g., Gmail). If they miss the 30-second window, they use the Manager Void path.3. Active-boats list ordering:Answer: Sort by Berth Code. Do not sort by "most recently touched." Dockhands navigate the physical world. If they are walking down Pier B, they want to see B-1, B-2, B-3 in order on their phone. If the list is jumping around based on who checked in 5 minutes ago, they will accidentally charge the wrong boat because muscle memory expects the physical layout.Interactive Prototype: The Quantity StepperTo ensure the UX is truly one-handed for those quantity-variable items, I have generated an interactive prototype of Screen 2 (Pick an item).Notice how tapping the core tile area advances the flow immediately, while the +/- buttons only update the local state without advancing. This is the crucial interaction that makes "tap-tap-done" work.Once you patch the Stripe race condition and enforce the single-draft rule, this specification is rock-solid and ready for the backend team.
