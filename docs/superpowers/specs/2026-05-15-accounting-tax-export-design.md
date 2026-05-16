# Accounting Reconciliation & Tax Export — Design

**Date:** 2026-05-15
**Status:** Draft
**Scope:** Bookkeeper-facing reconciliation and period-end export tooling. Reconcile Stripe payouts against bank deposits, surface tax broken down by jurisdiction, and emit CSV/Excel files formatted for QuickBooks Online and Xero so the marina's accountant can import them into the books of record.

---

## 1. Problem

DocksBase collects revenue through Stripe Connect and produces invoices via `apps.billing`. A real marina bookkeeper has three jobs each month that the current product does not support:

1. **Reconciliation.** Stripe pays out to the marina's bank account in batched lumps with platform/processor fees deducted at source. A €1,847.23 deposit on the bank statement corresponds to N invoices over M days minus Stripe fees. Today there is no way inside DocksBase to answer "what made up that deposit?".
2. **Revenue classification.** Each line of revenue must be tagged to a GL account so it lands in the right row of the P&L: transient slip revenue is one account, shore power is another, retail is another, sales tax goes to a liability account. DocksBase already has a chart of accounts (`apps.accounting.Account`), a journal ledger (`JournalEntry`/`JournalEntryLine`), and live GL-posting (`apps.accounting.services.gl_posting`). What's missing is the bookkeeper-friendly *bridge*: a configurable mapping from each `ChargeableItem.Category` to the GL code the bookkeeper's books actually use.
3. **Tax breakdown.** A single invoice can legitimately contain a transient-dockage line at an 8 % "Hotel/Transient Tax" rate alongside a bag of ice at 5 % sales tax and a seasonal-lease line that is fully exempt. Per the existing tax architecture (see `docs/superpowers/specs/2026-05-12-tax-architecture-design.md`), each line item carries its own snapshot `tax_rate`, but the *jurisdiction* and *reportable category* (transient-tax vs. sales-tax vs. exempt) are not modelled. Bookkeepers need a per-jurisdiction summary by month for their tax filings.

This spec produces the **export and reconciliation surface** that solves all three. It is explicitly *not* a re-architecture of the GL — that already exists.

---

## 2. Goals

- Per-tenant configurable mapping from invoice-line category → bookkeeper's GL account code, editable in Settings.
- A first-class `TaxCode` model with `rate × jurisdiction × reportable_category`, replacing the implicit "just a percentage" treatment that `billing.TaxRate` carries today.
- A `Payout` model that snapshots every `payout.paid` event from Stripe Connect and links to its constituent `Charge`/`Payment` rows so a bookkeeper can answer "what's in this deposit?".
- A "Financial Reports" screen with date-range picker, format selector, preview table, and download.
- Generic CSV, QuickBooks Online CSV, and Xero CSV export formats.
- A tax-summary endpoint that groups taxable sales by jurisdiction × period for tax-return prep.
- Async generation for large date ranges with email-when-ready.
- Audit trail: once an export is generated for a period, the underlying rows are flagged as *period-locked*; any subsequent edit to a past invoice must go through void + reissue.

## 3. Non-goals

- **No direct QBO/Xero API push** in phase 1. We already have OAuth adapters at `apps.accounting.integrations.{qbo,xero,...}.py` and `AccountingAdapter.push_invoice()` (`apps/accounting/integrations/base.py:47`). Wiring those into a per-period push is phase 2 — the bookkeeper-friendly path stays "download file, upload to QBO web UI" first.
- **No new ledger.** We are not replacing `JournalEntry`/`JournalEntryLine`. Export reads from the existing GL plus billing rows.
- **No real-time double-entry replication** to external systems. That is phase 3.
- **No accruals engine.** Deferred-revenue recognition already exists (`apps.accounting.services.deferred_revenue`, `DeferredRevenueEntry`, `DeferredRevenueRecognitionLog`). Reuse it.
- **No multi-currency conversion in exports.** Marina base currency only in phase 1; the GL already stores base-currency amounts on `JournalEntryLine.debit`/`credit`.
- **No AP export.** AP invoices (`apps.accounting.APInvoice`) already export through the existing journal CSV; this spec is AR-side.

---

## 4. What exists today

A surprising amount. Anyone scoping this work should read the following before adding a single model.

### 4.1 General ledger and posting

- `backend/apps/accounting/models.py` — full chart of accounts (`Account`, lines 53–79), journal (`JournalEntry` lines 101–144, `JournalEntryLine` lines 147–187), cost centres, integration configs, deferred revenue, AP, fuel duty. ~756 lines. Migration order documented at the top of the file.
- `backend/apps/accounting/services/gl_posting.py` — `post_invoice_gl()`, `post_payment_gl()`, `post_credit_note_gl()`, `post_ap_invoice_gl()`, `post_deferred_refund_gl()`, `post_deferred_recognition_gl()`. Each is `@transaction.atomic` and produces balanced debits/credits in base currency.
- `backend/apps/accounting/services/deferred_revenue.py` — period-based revenue recognition for seasonal leases / vouchers / deposits.
- `JournalEntry.save()` (`models.py:129`) already enforces immutability: a posted journal entry raises `PermissionError` on edit. This is the existing "period lock" primitive — we extend it.

### 4.2 Existing export infrastructure

- `backend/apps/accounting/views_export.py` — a `JournalCSVExportView` that streams every `JournalEntryLine` in a date range as a flat CSV. 96 lines. Mounted at `GET /api/v1/billing/accounting/export/journal.csv/`.
- `backend/apps/accounting/views_datev_export.py` — DATEV Buchungsstapel export for Germany.
- Frontend already exposes both: `frontend/src/screens/Accounting.jsx` lines 741–844 host `JournalCSVExportCard` and `DatevExportCard`. They are minimal: from/to date pickers, `posted_only` flag, a single Download button.

### 4.3 OAuth integrations (live, unused for periodic export)

Adapters exist for **Xero, QuickBooks Online, Sage Business Cloud, Sage Intacct, NetSuite, Microsoft Dynamics 365, MYOB**:

- `backend/apps/accounting/integrations/{base,qbo,xero,sage_business_cloud,sage_intacct,netsuite,dynamics365,myob}.py`
- OAuth view modules: `views_qbo_oauth.py`, `views_xero_oauth.py`, `views_sage_oauth.py`, `views_myob_oauth.py`, `views_d365_oauth.py`, `views_netsuite_oauth.py`, `views_intacct_connect.py`.
- `AccountingIntegrationConfig` model (lines 700–725) holds per-marina credentials in an `EncryptedJSONField`. `AccountingSyncRecord` (lines 728–755) logs every push/pull.
- `AccountingAdapter` abstract base in `integrations/base.py` defines `push_invoice()`. Real implementations exist but are *not* invoked by any periodic job today — phase 2 will fix that.

### 4.4 Reports app

- `backend/apps/reports/` — small. Only `views.py` (209 lines), `urls.py`, tests. Endpoints: `OccupancyReportView`, `RevenueReportView`, `UtilisationReportView`, `ComplianceReportView`. These produce in-app KPI cards, not exports. The 2026-05-03 reports spec (`docs/superpowers/specs/2026-05-03-reports-real-data-design.md`) wired those four into `frontend/src/screens/Reports.jsx`. **There is no existing "Financial Reports" screen** — Reports.jsx is operational reporting (occupancy, utilisation), not bookkeeping.
- `apps.accounting` also exposes its own report endpoints — `BalanceSheetView`, `ProfitAndLossView`, `CashFlowView`, `CashForecastView`, `DeferredRevenueReportView`, `CostCentrePLReportView` (`accounting/urls.py:197–202`). These are accounting-internal reports, not period exports.

### 4.5 Billing tax fields

- `backend/apps/billing/models.py:6–19` — `TaxRate(name, rate, is_default, is_archived)` per marina. Immutable once created (per the 2026-05-12 tax-architecture spec).
- `ChargeableItem.tax_category` (line 181) — non-null `ForeignKey('billing.TaxRate', PROTECT)`. Every chargeable item has exactly one tax treatment.
- `ChargeableItem.category` (line 178) — `TextChoices` covering 18 categories: `berth`, `utility`, `service`, `retail`, `booking_fee`, `fuel`, `repair`, `course`, `loyalty`, `subscription`, `penalty`, `deposit`, `rent`, `offset`, `commission`, `charter`, `harbour_tariff`. **Every invoice line therefore inherits a category through `chargeable_item.category`**, with line items having `chargeable_item=NULL` falling back to `service` (see `apps.reports.views._month_revenue_by_category`).
- `InvoiceLineItem.tax_rate` (line 106) is a *snapshot* decimal copied from `ChargeableItem.tax_category.rate` at invoicing time. Historical correctness is therefore preserved even when `TaxRate` records are archived.

### 4.6 Stripe wiring

- `backend/apps/billing/stripe_service.py` — checkout-session creation and payment-intent creation only. ~40 lines. No webhook handler for `payout.*` events today.
- `backend/apps/billing/views.py:117–250` — webhook handlers exist for `checkout.session.completed`, `payment_intent.succeeded`, related payment events. **No `payout.paid` handler.** No `Payout` model anywhere in the codebase (verified: zero hits on `grep -rni "payout"` across `backend/apps`).

### 4.7 What this spec adds on top

A thin layer:
- Three new models (`GLCodeMapping`, `TaxCode`, `Payout` + `PayoutLine`).
- One new app or sub-package (`apps.accounting.exports`) that wraps existing GL/billing rows in three CSV formatters.
- One new webhook handler (`payout.paid`).
- One new period-lock mechanism on `Invoice` and `JournalEntry`.
- One new frontend screen ("Financial Reports") and a settings card for GL mapping configuration.

---

## 5. Data model additions

All new models live in `apps.accounting` unless noted. None mutate existing rows; all are additive.

### 5.1 `GLCodeMapping`

Per-tenant configurable map from invoice-line category to the bookkeeper's external GL account number.

- `marina` — FK Marina (CASCADE).
- `chargeable_category` — CharField, choices = `ChargeableItem.Category` choices, plus a sentinel `tax_collected` for the tax-liability mapping.
- `gl_account` — nullable FK to `accounting.Account`. Optional internal mirror so DocksBase's own ledger and the export agree.
- `external_gl_code` — CharField, free-text. This is the column that lands in the QBO/Xero CSV. Example values: `"4100"` (Slip Rentals), `"4200"` (Utilities), `"4300"` (Activities), `"4400"` (Boatyard), `"2200"` (Sales Tax Payable).
- `external_gl_name` — CharField, free-text label shown in previews ("Slip Rentals — 4100").
- `cost_centre` — nullable FK to `accounting.CostCentre`.
- `is_active`, `created_at`, `updated_at`.
- `unique_together = [('marina', 'chargeable_category')]`.

**Reuse vs. add.** `Account.external_code` already exists (line 72) and could carry the QBO code. We add `GLCodeMapping` rather than reusing `Account.external_code` because the unit of mapping is *category → external code*, not *internal account → external code*. A single internal `Account` row could span multiple categories or none.

Seed migration: for every existing marina, insert one inactive row per `ChargeableItem.Category` value with `external_gl_code=''`. Bookkeeper fills these in via Settings.

### 5.2 `TaxCode`

Promotes the existing flat `billing.TaxRate` into a fully reportable tax classification.

- `marina` — FK Marina.
- `name` — CharField, e.g. `"FL Sales Tax 6%"`, `"Broward County Transient 5%"`, `"Boat Sales Exempt"`.
- `rate` — Decimal(5,2). **Snapshot only**; mirrors `TaxRate.rate` to keep the export self-contained.
- `jurisdiction_country`, `jurisdiction_state`, `jurisdiction_county`, `jurisdiction_city` — four optional CharFields. Population determines granularity.
- `reportable_category` — TextChoices:
  - `sales_tax` — generic goods/services tax.
  - `transient_tax` — short-stay dockage / hotel-equivalent tax.
  - `tourism_levy` — bed tax / TDT.
  - `fuel_excise` — fuel-specific excise (red diesel covered separately by `FuelDutyRate`).
  - `vat_standard`, `vat_reduced`, `vat_zero`, `vat_exempt` — for EU/UK marinas.
  - `gst`, `pst`, `hst` — for AU/CA marinas.
  - `none` — no tax (zero-rated or exempt; differentiated by `rate=0` and an explicit `vat_exempt`/`vat_zero` here).
- `effective_from`, `effective_to` — DateField, nullable. Historical periods can resolve a code by date.
- `tax_rate` — nullable OneToOne to `billing.TaxRate`. Carries the existing record forward; new `TaxRate` rows can create a matching `TaxCode` on save.
- `is_active`, `created_at`.
- `unique_together = [('marina', 'name')]`.

`TaxCode` is **immutable on `rate` and `reportable_category`** after first use (i.e. once a `JournalEntry.source_type='invoice'` references its parent `TaxRate`). Rate changes follow the existing `TaxRate` pattern: archive the old, create a new code. The 2026-05-12 tax-architecture spec already establishes this discipline for `TaxRate`; we extend it.

**Why not just denormalise onto `TaxRate`?** `billing.TaxRate` is a *registry of rates*, and the 2026-05-12 spec deliberately keeps it free of jurisdiction semantics. Reporting concerns belong in `accounting`. The two models stay 1:1 (or 1:0) via the optional FK; `TaxCode` is creatable without a `TaxRate` for tax-exempt classifications that never appear on an invoice line.

### 5.3 Customer-level exemption

To support tax-exempt seasonal leases:

- Add `members.Member.tax_exempt` — BooleanField, default False.
- Add `members.Member.tax_exempt_certificate_no` — CharField, blank=True (resale/exemption certificate reference).
- Add `members.Member.tax_exempt_reason` — short CharField, blank=True.

Resolution rule, in priority order, at invoicing time:
1. If `Member.tax_exempt` is True → all lines for that member are zero-tax regardless of `ChargeableItem.tax_category`.
2. Else if the `ChargeableItem.tax_category` resolves through `TaxCode.reportable_category` to `vat_exempt` / `none` → zero tax.
3. Else apply `ChargeableItem.tax_category.rate`.

The snapshot on `InvoiceLineItem.tax_rate` still occurs as today; this just controls which value gets snapshotted. **Line-item override is not supported in phase 1** — to override per-line, staff change the line's chargeable item.

### 5.4 `Payout`

Snapshot of one Stripe payout event. One `Payout` row per `payout.paid` webhook.

- `marina` — FK Marina.
- `stripe_payout_id` — CharField, unique per marina.
- `stripe_account_id` — CharField, the Connect account that owns the payout.
- `amount` — Decimal(12,2). Net amount deposited to the bank.
- `currency` — CharField(3).
- `arrival_date` — DateField (Stripe's `arrival_date`).
- `created_at_stripe` — DateTimeField from Stripe's `created`.
- `status` — CharField; mirrors Stripe (`paid`, `pending`, `in_transit`, `failed`, `canceled`).
- `bank_account_last4` — CharField, blank ok.
- `gross_amount` — Decimal(12,2). Sum of constituent charges.
- `fee_amount` — Decimal(12,2). `gross - amount`.
- `raw_payload` — JSONField. Full Stripe object for audit.
- `synced_at` — DateTimeField, `auto_now_add`.
- `journal_entry` — nullable OneToOne to `accounting.JournalEntry`. Set when the bookkeeper marks the payout as posted to GL (a `Dr Bank / Cr Stripe Clearing` move).
- `reconciled` — Boolean; `True` once `bank_amount` matches `amount` for a manually-entered bank deposit.
- `unique_together = [('marina', 'stripe_payout_id')]`.

### 5.5 `PayoutLine`

One row per constituent charge inside a payout.

- `payout` — FK `Payout` (CASCADE).
- `stripe_charge_id` — CharField.
- `stripe_payment_intent_id` — CharField, blank ok.
- `invoice` — nullable FK `billing.Invoice`. Linked by `payment_intent` match.
- `payment` — nullable FK `billing.Payment` or `billing.AccountPayment`.
- `gross_amount`, `fee_amount`, `net_amount` — Decimal(10,2).
- `currency` — CharField(3).
- `description` — CharField, mirrors Stripe.
- `created_at_stripe` — DateTimeField.

Backfill is best-effort: a `Charge` whose `payment_intent` matches an existing `Invoice.stripe_payment_intent_id` links automatically. Unmatched charges produce a `PayoutLine` with `invoice=NULL` and surface in the reconciliation UI as "investigate".

### 5.6 `ExportJob`

Async export tracking row.

- `marina` — FK.
- `requested_by` — FK `staff.StaffMember`.
- `format` — TextChoices: `generic_csv`, `qbo_csv`, `qbo_bank_csv`, `xero_sales_csv`, `xero_bank_csv`, `tax_summary_csv`.
- `start_date`, `end_date` — DateField.
- `category_filter` — JSONField, list of `ChargeableItem.Category` values (empty = all).
- `status` — `queued`, `running`, `completed`, `failed`.
- `file` — FileField, nullable. Stored under `exports/{marina_id}/{job_id}.csv`.
- `row_count`, `total_gross`, `total_tax`, `total_net` — Decimal aggregates, populated on completion.
- `error_detail` — TextField, blank ok.
- `notify_email` — CharField. Default = requesting user's email; bookkeeper email can override.
- `created_at`, `started_at`, `completed_at`.

### 5.7 `PeriodClose`

Per-marina period lock. One row per closed month.

- `marina` — FK.
- `period` — CharField(7), `"YYYY-MM"`, unique with marina.
- `closed_at` — DateTimeField.
- `closed_by` — FK `staff.StaffMember`.
- `triggering_export` — nullable FK `ExportJob` (the export that finalised the close).
- `notes` — TextField.

When `PeriodClose` exists for `period`, `Invoice.save()` and `Payment.save()` for rows dated within the period raise a `PeriodLockedError`. `JournalEntry.save()` already raises on edit of any posted entry (`models.py:129`); we extend the guard to insertion of new entries dated inside a closed period unless `source_type='manual'` and a "post-close correction" flag is set. Voiding a closed-period invoice always goes through `void + reissue in the current period` (a new credit note plus a fresh invoice), never a silent mutation. The exact enforcement code lives in `apps.billing` (see Section 9).

---

## 6. Category → GL mapping flow

1. On marina creation, a startup signal seeds an inactive `GLCodeMapping` row per `ChargeableItem.Category` value plus one for `tax_collected`. All rows have empty `external_gl_code`.
2. Bookkeeper opens **Settings → Accounting → GL Mapping**, fills in each row's external code and friendly label. The screen surfaces every category that has at least one `ChargeableItem` using it, plus categories that appear on any `InvoiceLineItem` in the last 12 months.
3. Mappings are versioned implicitly through `updated_at`; previous exports retain their snapshot because the export job writes the resolved code into the file at generation time, not at render time. Re-running an export for the same period after a mapping change produces a *different* file — this is expected and documented in the UI ("re-export uses current GL mapping").
4. Unmapped category at export time: the row appears in the export file with `external_gl_code='UNMAPPED'` and the job's `error_detail` lists the affected category. Bookkeeper fixes the mapping and re-exports.

---

## 7. Tax handling and the tax-summary view

### 7.1 Per-line resolution

Every `InvoiceLineItem` already carries a `tax_rate` decimal snapshot. To resolve *which tax code* applies, the export joins:

```
InvoiceLineItem
  .chargeable_item                       -- nullable
  .tax_category                          -- billing.TaxRate, NOT NULL on ChargeableItem
  .tax_code                              -- accounting.TaxCode (the new FK from §5.2), nullable
```

If `tax_code` is null (legacy `TaxRate` without a TaxCode created yet), the export falls back to a synthetic "Uncategorised — {rate}%" bucket and the job emits a warning. The Settings UI surfaces unresolved tax codes the same way it surfaces unmapped GL codes.

### 7.2 Mixed-rate invoices

A single invoice with three lines at 8 % transient-tax, 5 % sales-tax, and 0 % exempt produces three separate rows in the generic export (one per line item), each with its own `tax_code_name`, `jurisdiction`, `reportable_category`, `tax_rate`, and `tax_amount`. Invoice totals in the export are still per-invoice; the tax breakdown is per-line.

### 7.3 Tax-summary endpoint

`GET /api/v1/accounting/tax-summary/?start_date=&end_date=&jurisdiction_state=&jurisdiction_country=`

Returns a roll-up:

```
{
  "period": {"start": "2026-04-01", "end": "2026-04-30"},
  "by_jurisdiction": [
    {
      "country": "US", "state": "FL", "county": "Broward", "city": null,
      "totals": [
        {
          "tax_code_id": 12, "tax_code_name": "Broward County Transient 5%",
          "reportable_category": "transient_tax",
          "rate": "5.00",
          "taxable_sales": "48210.00",
          "exempt_sales": "0.00",
          "tax_collected": "2410.50",
          "invoice_count": 84
        },
        ...
      ]
    },
    ...
  ],
  "grand_total_tax_collected": "8741.20"
}
```

This is the bookkeeper's tax-filing worksheet. It also drives a CSV (`format=tax_summary_csv`) with the same content flattened.

---

## 8. Stripe payout reconciliation

### 8.1 Webhook

Register `payout.paid`, `payout.failed`, `payout.updated` in the Stripe Connect webhook listener at `apps/billing/views.py` (alongside the existing handlers around lines 117–250). On `payout.paid`:

1. Look up the marina by `account` (Stripe Connect account ID) — `Marina.stripe_account_id`.
2. `Payout.objects.update_or_create(marina=marina, stripe_payout_id=event['data']['object']['id'], defaults={...})`.
3. Fetch `balance_transactions` for the payout (paged) and for each one that has `type='charge'` create or update a `PayoutLine`. Link to `Invoice` by `payment_intent`.
4. Compute `fee_amount = gross - amount`.
5. Emit a Celery task `reconcile_payout(payout_id)` that does a best-effort `Invoice` linkage for any `PayoutLine` that didn't match by payment-intent (fallback: match on `Charge.id` stored in `Payment.stripe_charge_id` if that field is added).

### 8.2 Backfill

`apps.accounting.tasks.backfill_payouts(marina_id, since_date)` — pulls `stripe.Payout.list()` for the last N days, walks balance transactions, and idempotently builds `Payout`/`PayoutLine` rows. Idempotency guaranteed by `unique_together` on stripe IDs. First run after deploy should be invoked manually per marina with a 90-day window.

### 8.3 GL posting (optional, phase 1.5)

When the bookkeeper clicks "Mark posted" on a payout, post a journal entry:

```
Dr Bank Clearing               net_amount
Dr Stripe Fees Expense         fee_amount
    Cr Stripe Clearing             gross_amount
```

`Account` codes for "Stripe Clearing", "Bank Clearing", and "Stripe Fees Expense" come from `GLCodeMapping` (new entries seeded for these synthetic categories) or from a per-marina settings panel. This is the only *write* path of phase 1 — everything else is read/export.

### 8.4 Reconciliation UI

`GET /api/v1/accounting/payouts/` lists payouts. The screen shows: arrival date, gross, fee, net, # invoices, reconciliation status, "View constituent invoices", "Mark reconciled", "Mark posted to GL".

---

## 9. Period close and immutability

`apps.accounting.JournalEntry` is already immutable once `is_posted=True` (see `models.py:129`). We extend the lock to `apps.billing.Invoice` and `apps.billing.Payment`:

1. Add a `Invoice.save()` guard: if `Invoice.created_at.date()` falls inside a closed period for `self.marina` AND `pk` exists AND any tracked field changed, raise `PeriodLockedError`. New fields tracked: `subtotal`, `tax_total`, `total`, `status`, line items via `pre_save` on `InvoiceLineItem`.
2. Add a `Payment.save()` guard with the same logic on `paid_at` date.
3. `void` action on a closed-period invoice creates a credit note dated *today* (current open period) and a replacement invoice dated *today*. The original row is untouched.
4. `PeriodClose` is created either:
   - Manually via `POST /api/v1/accounting/period-close/`, after the bookkeeper has reconciled all payouts and downloaded the export, or
   - Automatically as a side-effect of a successful `generic_csv` or `qbo_csv` export with `lock_period=true` in the request body.
5. Re-opening a closed period requires deleting the `PeriodClose` row and is audit-logged through the existing `apps.audit` infrastructure. Owner-only permission.

Phase 1 implements (1)–(3) as a *warning*, not a hard error, behind a feature flag `marina.period_lock_enforced`. Default off. Hard enforcement turns on per marina once the bookkeeper has done one successful close cycle.

---

## 10. Export formats

All exports are produced by `apps.accounting.exports.{generic,qbo,xero,tax_summary}.py`, one module per format. Each exposes a single `def generate(job: ExportJob) -> None` that writes to `job.file` and updates aggregates.

### 10.1 Generic CSV

Columns:

```
date, invoice_number, customer_name, customer_id,
line_description, category, gl_code, gl_name,
quantity, unit_price, subtotal,
tax_code_name, jurisdiction, reportable_category, tax_rate, tax_amount,
total, payment_method, payment_date, stripe_payout_id, currency
```

One row per `InvoiceLineItem`, ordered by `invoice.created_at` then `invoice_number` then line position. Credit notes appear as negative rows.

### 10.2 QuickBooks Online CSV

QBO's web-import "Import Invoices" feature accepts a CSV with these column names (these are the column headers QBO actually expects — they must match exactly, including the case):

```
InvoiceNo, Customer, InvoiceDate, DueDate, Terms,
Location, Memo,
Item(Product/Service), ItemDescription, ItemQuantity, ItemRate, ItemAmount,
ItemTaxCode, ItemTaxAmount,
Currency
```

Implementation notes:
- `Item(Product/Service)` maps from `GLCodeMapping.external_gl_name`.
- `ItemTaxCode` requires the bookkeeper to have created matching tax codes inside QBO; we surface them in Settings → Accounting → Tax Codes → QBO Mapping (`TaxCode.external_qbo_code` — add an optional field on `TaxCode`).
- Credit notes go to a separate file (`{job_id}-credit-notes.csv`) because QBO uses a different import surface for them.

A second QBO file, `qbo_bank_csv`, emits the marina's *deposit register* — one row per `Payout` formatted for QBO's "Banking → Receive payment → Upload CSV":

```
Date, Description, Amount, Reference
```

Reference is the Stripe payout ID, Amount is `Payout.amount` (net). The bookkeeper imports both files and matches in QBO.

### 10.3 Xero CSV

Xero has two relevant imports:

- **Sales Invoices import** (`xero_sales_csv`) — column conventions from Xero's "Import sales invoices" docs:

```
ContactName, EmailAddress, POAddressLine1, POCity, POPostalCode, POCountry,
InvoiceNumber, Reference, InvoiceDate, DueDate, InventoryItemCode,
Description, Quantity, UnitAmount, AccountCode, TaxType, TrackingName1, TrackingOption1, Currency
```

- `AccountCode` ← `GLCodeMapping.external_gl_code`.
- `TaxType` ← a per-marina-configured Xero tax-type string stored on `TaxCode.external_xero_code` (e.g. `OUTPUT2`, `EXEMPTOUTPUT`).

- **Bank Statement import** (`xero_bank_csv`) — minimal CSV:

```
Date, Amount, Payee, Description, Reference
```

One row per `Payout`. Bookkeeper imports into the marina's Xero bank feed and reconciles.

### 10.4 Tax summary CSV

Flattens the JSON shape from §7.3:

```
country, state, county, city, tax_code_name, reportable_category, rate,
taxable_sales, exempt_sales, tax_collected, invoice_count
```

One row per `(jurisdiction × tax_code)` combination.

---

## 11. Endpoints

All under `/api/v1/accounting/` and mounted in `apps.accounting.urls`. Endpoint names sit alongside the existing report views in that urls module.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/exports/` | Create an `ExportJob`. Body: `format`, `start_date`, `end_date`, optional `category_filter`, optional `notify_email`, optional `lock_period`. Returns the job row (immediately, with `status=queued`). |
| GET | `/exports/` | List recent jobs for the marina. Pagination. |
| GET | `/exports/{id}/` | Single job. Includes `file_url` when `status=completed`. |
| GET | `/exports/{id}/download/` | Streams the file with `Content-Disposition: attachment`. Falls back to 404 if pending or failed. |
| GET | `/payouts/` | List payouts. Filters: `arrival_date__gte`, `reconciled`, `status`. |
| GET | `/payouts/{id}/` | Single payout with constituent `PayoutLine` rows expanded. |
| POST | `/payouts/{id}/reconcile/` | Mark reconciled; body `bank_amount` recorded for audit. |
| POST | `/payouts/{id}/post-to-gl/` | Triggers the Stripe-clearing journal entry from §8.3. |
| GET | `/tax-summary/` | The JSON shape from §7.3. |
| GET | `/gl-mappings/`, POST/PATCH | CRUD on `GLCodeMapping`. Bookkeeper UI. |
| GET | `/tax-codes/`, POST/PATCH | CRUD on `TaxCode`. |
| POST | `/period-close/` | Body: `period`, optional `notes`. Returns the `PeriodClose` row. |
| DELETE | `/period-close/{id}/` | Re-open (owner only). |

The legacy `GET /api/v1/billing/accounting/export/journal.csv/` (`views_export.py`) stays. It's the raw GL dump and remains the universal fallback — useful for forensic work or platforms not covered by the formatted exports. New endpoints supplement, not replace.

---

## 12. Frontend

### 12.1 New screen: Financial Reports

Path: `/financial-reports`. Lives in the existing top-level nav under "Accounting" or as a sibling tab. Created at `frontend/src/screens/FinancialReports.jsx`. Hooks in `frontend/src/hooks/useFinancialReports.js`.

Sections:

1. **Period selector** — month picker plus custom date range. Defaults to last closed full month.
2. **Format selector** — radio cards: Generic CSV / QuickBooks Online / Xero / Tax Summary. Each card shows one paragraph of "what's in this file" and "import into QBO/Xero where".
3. **Preview table** — first 50 rows of the resolved data, with unmapped categories highlighted red. "X categories need mapping" link jumps to Settings.
4. **Tax summary panel** — always-visible roll-up by jurisdiction for the selected period. Mirrors §7.3.
5. **Payout reconciliation panel** — lists payouts in the period, status, # linked invoices.
6. **Generate** — button. For small ranges (< 30 days, < 5000 rows in preview), returns the file immediately via the synchronous `download/` endpoint. For larger ranges, creates an `ExportJob` and shows "We'll email you at {bookkeeper_email} when it's ready". The screen polls the job every 5 s for the first 60 s, then drops to a toast.
7. **Recent exports** — table of last 20 `ExportJob` rows with re-download links until `file` expires (90-day retention).

### 12.2 Existing Accounting screen

The two existing cards in `frontend/src/screens/Accounting.jsx` (`JournalCSVExportCard`, `DatevExportCard`, lines 741–870) stay where they are. The new Financial Reports screen is a *new* surface aimed at bookkeepers; the existing cards are aimed at controllers who want the raw GL dump.

### 12.3 Settings screen

New cards under `Settings → Accounting`:

- **GL Code Mapping** — table of categories with editable `external_gl_code` and `external_gl_name`. Highlights categories that appear on recent invoices but have no mapping.
- **Tax Codes** — list of `TaxCode` rows. Create/edit form with jurisdiction fields and reportable category. Per-row `external_qbo_code` and `external_xero_code` inputs.
- **Stripe Connect status** — already exists in some form; extend to surface "{N} payouts in last 30 days, all reconciled" indicator.

---

## 13. Async generation

`ExportJob` rows queue a Celery task `apps.accounting.tasks.generate_export(job_id)`. The existing Celery wiring (see `docs/superpowers/specs/2026-05-11-celery-wiring-design.md`) is reused — no new beat schedule, just a regular task queue.

The task:
1. Loads the job, sets `status='running'`, `started_at=now()`.
2. Streams the relevant rows (invoices and line items inside the date range, payouts inside the date range for bank-CSV formats).
3. Writes CSV to a `tempfile.NamedTemporaryFile`, then `job.file.save(...)`.
4. Computes aggregates, sets `status='completed'`, `completed_at=now()`.
5. On exception, sets `status='failed'`, `error_detail=str(e)`. Retries: 0 — exports are deterministic; failures imply data issues that need human attention.
6. On completion, dispatches a notification through `apps.communications` (the existing adapter — verified in repo) with template `accounting/export-ready.html`. Email contains a download link valid for 7 days, requiring login.

Synchronous fast path for small exports: `POST /exports/` with `inline=true` and `end_date - start_date < 31 days` AND estimated row count < 5000 (estimated via a `COUNT(*)` pre-query) streams the file in the response. Otherwise it always goes async.

File retention: exports are deleted by a daily Celery task after 90 days. `ExportJob` rows are kept indefinitely.

---

## 14. Audit and immutability summary

| Layer | Mechanism |
|-------|-----------|
| Journal | `JournalEntry.save()` raises on edit when `is_posted=True` (already exists, `apps/accounting/models.py:129`). |
| Invoice | New `Invoice.save()` guard checking `PeriodClose` for the marina × invoice month. Warning in phase 1, hard error once `period_lock_enforced=True`. |
| Payment | New `Payment.save()` and `AccountPayment.save()` guards, same logic. |
| Voiding | Closed-period void → new credit note + new invoice in current period, never silent mutation. |
| TaxCode | Immutable on `rate` and `reportable_category` once referenced by a `JournalEntry` whose `entry_date` is within a closed period. |
| GLCodeMapping | Mutable freely; exports snapshot the resolved code at generation time. Re-exports for the same period use *current* mapping (documented; logged on the export job). |
| ExportJob | Append-only audit table. `file` may be cleaned up after 90 days but the row, aggregates, and parameters are retained. |
| AuditLog | All actions on `PeriodClose`, `TaxCode` create/edit, `GLCodeMapping` edits go through the existing `apps.audit` log. |

---

## 15. Phasing

### Phase 1 — Reconciliation + CSV exports (this spec, ~3 sprints)

- Models: `GLCodeMapping`, `TaxCode`, `Payout`, `PayoutLine`, `ExportJob`, `PeriodClose`, plus `Member.tax_exempt*` fields.
- Stripe `payout.paid` webhook + backfill task.
- Three CSV formatters: generic, QBO sales+bank, Xero sales+bank, tax summary.
- Endpoints listed in §11.
- Frontend: Financial Reports screen, GL Code Mapping settings card, Tax Codes settings card, payouts list with reconcile/mark-posted actions.
- Period-close UI with *soft* enforcement (warnings, feature flag off by default).

### Phase 2 — Direct API push to QBO/Xero (~2 sprints)

- Wire the existing `AccountingAdapter.push_invoice()` implementations into a per-period batch push triggered from the Financial Reports screen.
- A new `format` option `qbo_api_push` / `xero_api_push` becomes available when the marina has an active `AccountingIntegrationConfig` for that platform.
- `AccountingSyncRecord` (already exists) logs every push.
- The CSV path remains the default; API push is opt-in per period.

### Phase 3 — Real-time double-entry posting (~2 sprints)

- Replace batch push with event-driven: each `JournalEntry` insertion enqueues a push task per active integration.
- Backfill catches up missed entries.
- Conflict-resolution UI for sync failures.
- Hard period-lock enforcement turns on by default for new marinas.

---

## 16. Test plan

### 16.1 Unit tests

- `tests/accounting/test_gl_code_mapping.py` — seed migration creates one row per category; unique constraint; resolution returns 'UNMAPPED' when blank.
- `tests/accounting/test_tax_code.py` — immutability of `rate`/`reportable_category` after first referenced journal entry; `TaxCode.resolve_for_invoice_line(line)` returns correct code for a given line item; exemption resolution priority (member.tax_exempt > tax_category.vat_exempt > rate).
- `tests/accounting/test_payout_webhook.py` — `payout.paid` fixture creates `Payout` + N `PayoutLine` rows; idempotent on replay; balance-transaction enrichment links `PayoutLine.invoice` correctly via `payment_intent`.
- `tests/accounting/test_payout_reconciliation.py` — payout with one unmatched charge surfaces in the reconciliation list; `Mark posted` creates a balanced journal entry.
- `tests/accounting/test_period_close.py` — closing period rejects edits to invoices in that period (warning mode logs only; enforce mode raises `PeriodLockedError`); void in closed period creates new credit note + invoice in current period; re-open requires owner permission.

### 16.2 Export formatter tests

- `tests/accounting/test_export_generic_csv.py` — golden file: a fixture marina with 5 invoices covering all categories, mixed tax codes, two payouts, one credit note → CSV byte-for-byte match.
- `tests/accounting/test_export_qbo_csv.py` — QBO column headers match the QBO spec exactly; tax columns populated; credit notes go to the separate file.
- `tests/accounting/test_export_xero_csv.py` — Xero sales-invoice column order matches Xero spec; `AccountCode` populated from `GLCodeMapping`; `TaxType` populated from `TaxCode.external_xero_code`.
- `tests/accounting/test_export_tax_summary.py` — multi-jurisdiction fixture; totals sum to the expected jurisdiction breakdown.

### 16.3 Endpoint tests

- `tests/accounting/test_exports_api.py` — `POST /exports/` queues a job; `GET /exports/{id}/` returns 404 across marina boundary; download serves the file with the right content-disposition; sync fast-path returns inline for small ranges.
- `tests/accounting/test_tax_summary_api.py` — date filtering; jurisdiction filtering; permissions (staff with `accounting.view_reports`).
- `tests/accounting/test_payouts_api.py` — list filtering by `arrival_date` and `reconciled`; cross-marina isolation; reconcile action records `bank_amount`.

### 16.4 Migration tests

- Seed migration on a fixture marina with existing `ChargeableItem.Category` values creates one `GLCodeMapping` row per category, all inactive, blank external codes.
- Backfill task for `Payout` is idempotent across runs.

### 16.5 Frontend tests

- `frontend/src/screens/FinancialReports.test.jsx` — preview table renders unmapped categories in red; format change updates the preview; small range hits sync path; large range hits async path and shows the toast.
- `frontend/src/screens/Accounting.test.jsx` — existing `JournalCSVExportCard` and `DatevExportCard` continue to render and call the legacy endpoint.
- Settings tax-codes screen — create, edit, archive flow.

### 16.6 Integration test (full period close)

End-to-end fixture covering: 30 days of invoices and payments across all categories, three Stripe payouts ingested via webhook, bookkeeper opens Financial Reports, generates QBO CSV, verifies preview, downloads file, triggers `period-close`, attempts to edit a closed-period invoice (expects warning in phase 1), opens the resulting CSV files in the test harness and asserts row counts and totals.

### 16.7 Backend test recipe

Per repo memory: backend pytest runs via `pct exec 100 -- docker exec -u david agent-os …` against the worktree `.venv`. New test files follow the existing `backend/apps/accounting/tests/` and `backend/apps/billing/tests/` layout.

---

## 17. Open decisions

1. **Sync vs. async threshold.** The 5000-row / 31-day inline cutoff in §13 is a guess. Bench against real marinas before shipping; a controller exporting 90 days for a quarter close is a normal flow and must not block the request thread.
2. **Where does `Member.tax_exempt` live for non-member customers?** Walk-in transient bookings without a `Member` row would need an equivalent flag on the booking. Out of scope for phase 1 (assume non-members pay tax); resolve when phase 2 lands a `Customer` abstraction.
3. **Multi-period exports.** Phase 1 supports a single arbitrary date range. Bookkeepers may want "rolling 12 months" or "fiscal-year-to-date". Add presets in phase 1.5 once the underlying generator is stable.

---

## 18. Glossary

- **GL** — General Ledger. The bookkeeper's record of debits and credits per account.
- **Chart of accounts** — the marina's list of GL accounts. Lives in `apps.accounting.Account`.
- **Payout** — Stripe's term for a batched bank transfer of accumulated charges.
- **Charge** — Stripe's per-transaction credit-card capture record.
- **Balance transaction** — Stripe's per-event row in the merchant's running balance, linking a charge to a payout.
- **Reportable tax category** — the bucket the bookkeeper files the tax under (sales tax vs. transient/hotel tax vs. VAT vs. exempt), separate from the percentage rate.
- **Period close** — the bookkeeper's monthly act of "freezing" the books for the period after reconciliation.
- **Period-locked** — state of an invoice/payment whose date falls inside a closed period.
- 
answer:
This is a masterclass in translating messy, real-world accounting requirements into a clean software architecture. You have perfectly isolated the operational billing (which dockhands need) from the financial reporting (which accountants need) without forcing double-entry logic into the checkout flow. The concept of the GLCodeMapping as a bridge is exactly how enterprise ERPs handle this.

However, bridging Stripe's asynchronous ledger with a standard double-entry accounting system exposes two severe data-integrity traps. If you implement the spec exactly as written, your bookkeepers will never be able to reconcile a payout, and your historical tax reports will silently mutate.

Here is the teardown of the hidden flaws, followed by the answers to your open questions:

1. The Stripe Refund Trap (Reconciliation Failure)
The Spec States: "Fetch balance_transactions for the payout... and for each one that has type='charge' create or update a PayoutLine."

The Error: Stripe payouts are almost never just a neat bundle of charges. They include refunds (type='refund'), chargebacks/disputes (type='adjustment'), and sometimes rolling reserve holds. If you explicitly filter the ingest loop to only look at type='charge', the sum of your PayoutLine net amounts will physically never match the Payout.amount. The bookkeeper will be left with a permanent, unexplainable variance, defeating the entire purpose of the reconciliation UI.

The Fix: You must ingest all transaction types that hit the payout balance.

Update Section 5.5 (PayoutLine) to include a type field (charge, refund, dispute, adjustment).

Update Section 8.1 (Webhook): Ingest refunds as negative PayoutLine amounts, and link them to their original Invoice or CreditNote.

2. The Tax Jurisdiction Snapshot Trap (Compliance Failure)
The Spec States: "Every InvoiceLineItem already carries a tax_rate decimal snapshot... To resolve which tax code applies, the export joins InvoiceLineItem -> ChargeableItem -> tax_category -> tax_code."

The Error: You successfully snapshotted the percentage rate, but you left the jurisdiction dynamically linked to the ChargeableItem. If a marina changes the tax category of "Shore Power" from "Transient Tax" to "Sales Tax" in January 2027, running a historical export for July 2026 will retroactively export all those old lines under the new jurisdiction. This destroys the immutability of historical tax returns.

The Fix: You must snapshot the TaxCode reference directly on the invoice line. Add tax_code_snapshot = models.ForeignKey('accounting.TaxCode', on_delete=models.PROTECT, null=True) directly to InvoiceLineItem. At checkout, copy the reference from the ChargeableItem directly to the line item, breaking the historical dependency.

Answers to Your Open Decisions
1. Sync vs. async threshold (5000 rows / 31 days)

Answer: Drop the COUNT(*) pre-query entirely. Running a COUNT(*) across massive join tables can sometimes take just as long as streaming the CSV itself, defeating the purpose of the fast-path. Keep it brutally simple: if end_date - start_date <= 31 days, run it synchronously. If it's 32+ days, force async. Modern web frameworks (and Heroku/AWS API gateways) will time out around 30 seconds, so relying strictly on date boundaries is safer than row counts.

2. Where does Member.tax_exempt live for non-member customers?

Answer: Add a tax_exempt_override boolean directly to the Booking (or Reservation) model. Transients will always have a booking row, even if they don't have a persistent Member profile. At invoicing time, the engine checks the Booking override first, then the Member profile, then defaults to the item's standard tax code.

3. Multi-period exports

Answer: Do not build this for Phase 1. Accounting and reconciliation are inherently monthly workflows. Bookkeepers close the books one period at a time. If you allow a 12-month trailing export, they will run it, find a discrepancy in month 2, and struggle to isolate it. Force them into the monthly rhythm first; you can add YTD presets in Phase 1.5.

With the payout transaction types expanded and the tax jurisdiction properly snapshotted, this architecture will sail through an audit.

When a bookkeeper clicks "Mark posted to GL" on a Payout, how do you want the frontend to handle partial reconciliations (e.g., if the webhook missed a transaction and the lines don't sum perfectly to the bank deposit)?
