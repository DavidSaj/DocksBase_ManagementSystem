# Plan: Wire Billing, Fuel Dock & Accounts to Real Data

> Created: 2026-05-02
> Scope: Remove all remaining mock data from Billing.jsx, Operations.jsx (Fuel Dock tab),
>        and the Accounts tab; create any missing backend endpoints.

---

## Current State

| Screen / Tab | Mock Still In Use | What's Already Real |
|---|---|---|
| `Billing.jsx` → Fuel Dock POS tab | `FUEL_SALES` (hardcoded recent sales) | `useInvoices()` for all other tabs |
| `Billing.jsx` → Accounts tab | Hardcoded Z-report totals, batch billing select, export buttons (no-ops) | Nothing wired |
| `Operations.jsx` → Fuel Dock tab | `FUEL_BERTHS = ['FD-1','FD-2']` | `useFuelQueue()` + `useVessels()` fully wired |

The fuel dock queue itself is **already 100% real**. Three specific gaps remain.

---

## Task 1 — Fuel Dock: Replace Hardcoded `FUEL_BERTHS`

**Problem:** `Operations.jsx` line 7 has `const FUEL_BERTHS = ['FD-1', 'FD-2']`. Berths only show if
they're hardcoded here; new marinas or different berth names break the layout.

**Backend work:**
- Add `fuel_berths` JSONField to `accounts.Marina` model (default: `["FD-1", "FD-2"]`).
- Migration: `0003_marina_fuel_berths.py`.
- Expose via the existing `GET /accounts/me/` endpoint (already returns full Marina config).

**Frontend work:**
- In `Operations.jsx`, destructure `marina` from `useMarina()` (already exists via `MarinaContext`).
- Replace `FUEL_BERTHS` with `marina?.fuel_berths ?? ['FD-1', 'FD-2']`.
- No new hook needed.

**Effort:** Small. 1 migration + 2 field additions + 1 line frontend change.

---

## Task 2 — Billing Fuel Dock POS Tab: Replace `FUEL_SALES` Mock

**Problem:** `Billing.jsx` Fuel Dock POS tab renders `FUEL_SALES` — a hardcoded array of 2 rows.

**Backend work:**
- No new endpoint needed. The existing `GET /fuel-dock/queue/` endpoint already returns
  `FuelDockEntry` records. Add a `status` filter param so the view accepts `?status=completed`.
- The view likely already supports this via `filterset_fields` — verify and add if not.

**Frontend work:**
- Create `frontend/src/hooks/useFuelEntries.js`:
  - Calls `GET /fuel-dock/queue/?status=completed&ordering=-completed_at&limit=20`
  - Returns `{ entries, loading }` where each entry has:
    `vessel_name` (from serializer), `fuel_type`, `actual_litres`, `total_amount`, `completed_at`
- In `Billing.jsx`:
  - Remove `const FUEL_SALES = [...]`
  - Add `import useFuelEntries from '../hooks/useFuelEntries.js'`
  - Replace `FUEL_SALES.map(...)` with `entries.map(...)` using real fields

**Backend serializer fields needed on `FuelDockEntrySerializer`:**
```
vessel_name   = CharField(source='vessel.name', default=guest_description)
fuel_type_display
actual_litres, total_amount, completed_at
```

**Effort:** Small. Verify filter, add hook, update 1 render block.

---

## Task 3 — Accounts Tab: Batch Billing Endpoint

**Problem:** "Generate Batch Invoices" button has no backend. Managers need to bulk-create
monthly berth fee invoices for all active berth holders.

**Backend work — new endpoint `POST /billing/invoices/batch/`:**

Request body:
```json
{
  "billing_period": "2026-05",
  "member_type": "all",          // "all" | "seasonal" | "transient"
  "chargeable_item_id": 3        // the monthly berth fee ChargeableItem
}
```

Logic in `billing/batch_service.py`:
1. Fetch all `Booking` records with `status=confirmed` and `marina=request.user.marina`.
2. Filter by `member_type` if specified.
3. For each booking, look up the member's berth's `ChargeableItem` rate (or use the
   provided `chargeable_item_id`).
4. **Strict idempotency check:** skip any booking that already has an associated `Invoice`
   with `status in ('draft', 'open', 'paid')` for this `billing_period`.
   Only `void` invoices are excluded from the check — a voided invoice means it needs
   to be regenerated. This prevents double-billing paid customers if the batch is
   accidentally re-run mid-month.
5. Create `Invoice` (status `open`) + `InvoiceLineItem` for each remaining booking.
6. Return `{ created: N, skipped: N }`.

**Frontend work in `Billing.jsx`:**
- Add state: `batchLoading`, `batchResult`
- Wire `<select>` for billing period to state (generate months dynamically)
- Wire `<select>` for member type to state
- On "Generate Batch Invoices" click: `POST /billing/invoices/batch/` → show toast
  "Created X invoices, skipped Y (already invoiced)"
- Add `useBillingServiceCatalog()` hook (or inline fetch) to populate the chargeable item dropdown

**Effort:** Medium. New service file + view + URL + frontend wiring.

---

## Task 4 — Accounts Tab: Z-Report Endpoint

**Problem:** Z-Report shows hardcoded totals. Needs to aggregate today's POS activity.

**Backend work — new endpoint `GET /billing/z-report/?date=2026-05-02`:**

Logic in `billing/views.py` (new `ZReportView`):
1. Default `date` to today.
2. Aggregate `FuelDockEntry.objects.filter(status='completed', completed_at__date=date)`:
   - Group by `fuel_type`, sum `total_amount`.
3. Aggregate same-day `Payment` records by category (via InvoiceLineItem → ChargeableItem.category):
   - Sums for: `utility` (pump-outs, shore power), `retail` (marina store), `service` (other).
4. Return:
```json
{
  "date": "2026-05-02",
  "lines": [
    { "label": "Diesel",         "total": "420.00" },
    { "label": "Petrol",         "total": "280.00" },
    { "label": "Pump-outs",      "total": "36.00"  },
    { "label": "Shore Power",    "total": "9.00"   },
    { "label": "Marina Store",   "total": "18.50"  }
  ],
  "grand_total": "763.50"
}
```

**Frontend work in `Billing.jsx`:**
- Add `useZReport()` hook: `GET /billing/z-report/?date=<today>`.
- Replace hardcoded line items with `zReport.lines.map(...)`.
- Wire "Print Z-Report" to `window.print()` (triggers browser print dialog).
- Show loading state.

**Effort:** Medium. Aggregation query + view + hook + render update.

---

## Task 5 — Accounts Tab: Invoice Export (CSV)

**Problem:** "All Invoices (CSV)" export button is a no-op.

**Backend work — new endpoint `GET /billing/invoices/export/?format=csv`:**
- Stream a CSV response with headers:
  `Invoice #, Member, Status, Total, Due Date, Paid At`
- Use Django `StreamingHttpResponse` with Python's `csv` module.
- Same `marina` filter as the list endpoint.

**Frontend work in `Billing.jsx`:**
- Wire "All Invoices (CSV)" button to:
  ```js
  window.open(`${API_BASE}/billing/invoices/export/?format=csv&token=${accessToken}`)
  ```
  Or use Axios blob download → `URL.createObjectURL`.

**Effort:** Small. One view + URL + frontend click handler.

**Defer for now:**
- Debtor Report (PDF) — needs WeasyPrint template for debtors layout
- Revenue Summary (XLSX) — needs `openpyxl` (not yet installed)
- Utility Charges export — no utility model yet

---

## Task 6 — Accounts Tab: Payment Reconciliation (Stub)

**Problem:** "Import Bank Statement" / "Auto-Reconcile" has no backend at all.

**Decision: Defer to P2.** True bank reconciliation requires parsing multiple bank CSV
formats and fuzzy-matching by amount + reference. This is a standalone feature sprint.

**What to do now:** Replace the two no-op buttons with a "Coming Soon" placeholder card
that explains the feature. Removes the dead UI without losing the design.

---

## Execution Order

| # | Task | Effort | Priority |
|---|---|---|---|
| 1 | Fuel Dock — wire `fuel_berths` from Marina model | Small | P1 |
| 2 | Billing POS tab — replace `FUEL_SALES` with real entries | Small | P0 |
| 3 | Accounts tab — Batch Billing endpoint + wiring | Medium | P1 |
| 4 | Accounts tab — Z-Report endpoint + wiring | Medium | P1 |
| 5 | Accounts tab — Invoice CSV export | Small | P1 |
| 6 | Accounts tab — Reconciliation stub/placeholder | Trivial | P2 |

Total estimated: 1–2 days of focused work.

---

## Files Touched

**Backend:**
- `apps/accounts/models.py` — add `fuel_berths` JSONField to Marina
- `apps/accounts/migrations/0003_marina_fuel_berths.py` — new migration
- `apps/fuel_dock/views.py` — verify/add `status` filter param
- `apps/fuel_dock/serializers.py` — add `vessel_name`, `completed_at` to FuelDockEntrySerializer
- `apps/billing/batch_service.py` — new: batch invoice generation logic
- `apps/billing/views.py` — new: BatchInvoiceView, ZReportView, InvoiceExportView
- `apps/billing/urls.py` — add 3 new URL patterns

**Frontend:**
- `frontend/src/screens/Operations.jsx` — replace `FUEL_BERTHS` const
- `frontend/src/hooks/useFuelEntries.js` — new hook
- `frontend/src/screens/Billing.jsx` — remove FUEL_SALES, wire all Accounts tab actions
