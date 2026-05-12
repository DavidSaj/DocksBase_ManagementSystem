# Tax Architecture — Design Spec
**Date:** 2026-05-12
**Scope:** Replace legacy `Invoice.vat_rate` flat-rate field with a per-marina `TaxRate` model linked to `ChargeableItem`. Introduce item-level tax resolution across the entire billing engine.

---

## 1. Core Principle

An invoice does not have a tax rate. It has a **Total Tax Amount**, which is the sum of the tax calculated on its individual line items. A single DocksBase invoice can legitimately contain items at different tax rates (e.g. a transient slip at 20%, shore power at 5%, a zero-rated book at 0%). A flat `vat_rate` on the Invoice model is a legal liability and must be removed.

`ChargeableItem` is the single source of truth for tax treatment. `InvoiceLineItem.tax_rate` is a decimal snapshot of that treatment at the moment of invoicing, providing the immutable audit trail. `TaxRate` is the named registry of rates that the Harbor Master maintains.

---

## 2. Data Model

### 2.1 New model: `TaxRate`

```python
class TaxRate(models.Model):
    marina      = ForeignKey('accounts.Marina', CASCADE, related_name='tax_rates')
    name        = CharField(max_length=100)   # e.g. "Standard VAT", "Reduced Rate", "Zero Rated", "Exempt"
    rate        = DecimalField(max_digits=5, decimal_places=2)  # e.g. 20.00, 5.00, 0.00
    is_default  = BooleanField(default=False) # pre-selected when creating a new ChargeableItem
    created_at  = DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('marina', 'name')]
        ordering = ['-rate']
```

`is_default` is enforced at the service layer (not DB level): only one TaxRate per marina may have `is_default=True`. Used purely for UI convenience — it pre-selects the most common rate when a Harbor Master creates a new ChargeableItem.

### 2.2 `ChargeableItem` changes

- **Add**: `tax_category = ForeignKey('billing.TaxRate', PROTECT, related_name='chargeable_items')` — non-null, mandatory
- **Remove**: `tax_rate = DecimalField(...)` — dropped in migration 3

`PROTECT` (not `CASCADE`) prevents deletion of a TaxRate that has ChargeableItems using it. Staff must reassign items before deleting a rate.

### 2.3 `InvoiceLineItem` — no change

`tax_rate` (DecimalField) stays as-is. It snapshots the `TaxRate.rate` decimal at invoicing time. Historical invoices remain correct regardless of future edits to TaxRate records. The `line_tax` property already calculates correctly from this field.

### 2.4 `Invoice.vat_rate` — remove

The column is already set to `None` for all new invoices in `create_invoice()`. Historical invoices have their tax locked in `InvoiceLineItem.tax_rate` snapshots — removing this column loses no audit information. It is a dead field that misleads any reader into thinking invoices have a single tax rate.

---

## 3. Migration Path

Three sequential migrations in `billing/`. They cannot be collapsed into fewer because a RunPython data migration must run between the "add nullable FK" step and the "make it non-null" step.

### Migration 1 — `0005_taxrate_model.py` (schema)

- Creates `TaxRate` table
- Adds `ChargeableItem.tax_category_id` as **nullable** FK (temporary — required so existing rows don't violate NOT NULL)

### Migration 2 — `0006_taxrate_data_migration.py` (RunPython)

Per marina that has at least one ChargeableItem:

1. Create seed TaxRate records:
   - `"Standard — 20.00%"` (`is_default=True`)
   - `"Zero Rated — 0.00%"`
   - `"Exempt — 0.00%"`
2. For each ChargeableItem with `tax_rate == 0.00`: assign `tax_category` → `"Zero Rated — 0.00%"`
3. For each ChargeableItem with `tax_rate > 0.00`: match to the `"Standard"` record if the rates align, otherwise create a new `TaxRate` record for that exact value and assign

Reverse migration: sets `tax_category_id = NULL` on all ChargeableItems and deletes no TaxRate records (safe no-op).

### Migration 3 — `0007_taxrate_cleanup.py` (schema)

- Sets `ChargeableItem.tax_category_id` to `NOT NULL`
- Drops `ChargeableItem.tax_rate` decimal column
- Drops `Invoice.vat_rate` decimal column

---

## 4. Service Layer

### 4.1 Changes to `service.py`

**`add_line_item_from_catalog()`** — snapshot source changes:
```python
# Before
tax_rate=chargeable_item.tax_rate,
# After
tax_rate=chargeable_item.tax_category.rate,
```

**`calculate_booking_invoice()`** — same change: `item.tax_rate` → `item.tax_category.rate`.

**`finalize_invoice()`** — no change. It already sums `item.line_tax` across line items. The engine is correct.

**`add_line_item()`** — no change. Signature stays `tax_rate=None` accepting a decimal. This preserves programmatic callers.

**`create_invoice()`** — remove the `vat_rate=None` kwarg once the column is dropped.

### 4.2 New: `TaxRateService` functions (in `service.py`)

```python
def create_tax_rate(marina, name, rate, is_default=False) -> TaxRate
```
If `is_default=True`, clears `is_default` on all other TaxRates for that marina before saving.

```python
def set_default_tax_rate(tax_rate) -> TaxRate
```
Clears `is_default` on all other TaxRates for the same marina, sets it on this one.

```python
def delete_tax_rate(tax_rate) -> None
```
Raises `ValueError` if `tax_rate.chargeable_items.exists()`. Staff must reassign items first.

```python
def seed_default_tax_rates(marina) -> list[TaxRate]
```
Creates Standard (20.00%, is_default=True), Zero Rated (0.00%), Exempt (0.00%) for the marina. Called during marina onboarding. Idempotent — skips records that already exist by name.

---

## 5. API Endpoints

All endpoints are JWT-authenticated (marina staff only).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/v1/billing/tax-rates/` | List all TaxRates for the requesting marina |
| `POST` | `/api/v1/billing/tax-rates/` | Create a new TaxRate |
| `PATCH` | `/api/v1/billing/tax-rates/{id}/` | Update name or rate |
| `DELETE` | `/api/v1/billing/tax-rates/{id}/` | Delete — returns 409 if ChargeableItems are assigned |
| `POST` | `/api/v1/billing/tax-rates/{id}/set-default/` | Mark as marina default, clears others |

**`ChargeableItem` serializer changes:**
- Remove: `tax_rate` decimal field
- Add write field: `tax_category_id` (integer FK)
- Add read field: `tax_category` nested object `{id, name, rate}`

No new ChargeableItem endpoints — the existing create/edit endpoints handle this via the serializer update.

---

## 6. UI

### 6.1 Tax Rates settings screen

Location: **Settings > Tax Rates**

Displays a table of the marina's TaxRate records:

| Name | Rate | Default | Actions |
|------|------|---------|---------|
| Standard VAT | 20.00% | ★ | Edit / Delete |
| Reduced Rate | 5.00% | | Edit / Delete |
| Zero Rated | 0.00% | | Edit / Delete |
| Exempt | 0.00% | | Edit / Delete |

UI rules:
- The `★` Default toggle is single-select — clicking it on one row clears the star on all others
- Delete is disabled (greyed out, tooltip: "Remove all items using this rate first") if any ChargeableItems reference the record
- Rate input: numeric, 0–100, two decimal places

**Disclaimer banner** (displayed at the top of the screen):
> "You are responsible for ensuring these rates are correct and up to date. DocksBase applies the rate you set — we do not provide tax advice. Consult your accountant if you are unsure which rate applies to a given item."

### 6.2 ChargeableItem create/edit form

The `tax_rate` decimal input is replaced with a **Tax Treatment** dropdown. Options are populated from the marina's TaxRate list (name + rate displayed). The marina's `is_default` rate is pre-selected when creating a new item.

---

## 7. Marina Onboarding

`seed_default_tax_rates(marina)` is called as part of the marina signup wizard completion. This ensures every marina has a usable TaxRate set before any ChargeableItems are created. The Harbor Master can rename, adjust, or add rates in Settings > Tax Rates at any time.

---

## 8. Out of Scope

- **Stripe Tax (Tier 1)**: Adding `stripe_tax_code` to ChargeableItem and delegating calculation to Stripe's API is deferred. The manual engine (Tier 2) must be flawless first.
- **Tax reporting**: A breakdown of tax collected by rate (for VAT return filing) is a future reporting feature, not part of this spec.
- **Compound tax / tax-on-tax**: Not required for any current target market.
- **Customer tax IDs**: Collection and storage of boater VAT registration numbers for B2B zero-rating is deferred.

---

## 9. Decision Log

| Decision | Choice | Reason |
|----------|--------|--------|
| FK delete behaviour on TaxRate | `PROTECT` | Prevents silent loss of tax treatment on active items |
| `InvoiceLineItem.tax_rate` | Keep as decimal snapshot | The snapshot is the audit trail — independent of future TaxRate edits |
| `Invoice.vat_rate` | Remove | Dead field; misleads readers; all calculation already happens per line item |
| Zero-rate representation | Mandatory FK to a zero-rate TaxRate record | Explicit declaration of tax treatment (zero-rated ≠ forgot to set a rate) |
| Default TaxRate | `is_default` flag, single per marina | UX convenience for new item creation; not a billing constraint |
| Seed rates | Standard 20%, Zero Rated 0%, Exempt 0% | Common UK/EU starting point; Harbor Master adjusts for their jurisdiction |
| Stripe Tax | Deferred | Manual engine must be correct first; Stripe Tax adds cost and complexity |
