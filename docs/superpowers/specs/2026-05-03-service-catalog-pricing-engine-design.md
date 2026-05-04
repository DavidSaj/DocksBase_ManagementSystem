# Service Catalog & Pricing Engine — Design Spec
Date: 2026-05-03
Scope: Master Data > Service Catalog UI + Pricing Engine logic

---

## 1. Architectural Goal

We are moving all pricing logic out of Settings and hardcoded configurations into a dedicated Service Catalog. This is a top-level CRUD interface where the Marina Manager defines `ChargeableItem` records. These records act as the single source of truth for all billing events (transient bookings, seasonal batch billing, fuel dock POS).

---

## 2. The Data Model (`billing.ChargeableItem`)

> **Note:** `ChargeableItem` already exists in `backend/apps/billing/models.py`. Do not recreate or alter the existing model. The definition below is the authoritative reference; verify the live model matches it before proceeding.

```python
class ChargeableItem(models.Model):
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    name = models.CharField(max_length=200)  # e.g., "Transient Slip — 12m"

    class Category(models.TextChoices):
        BERTH   = 'berth',   'Berth Rates'
        UTILITY = 'utility', 'Utilities (Power/Water)'
        SERVICE = 'service', 'Services (Crane/Labor)'
        RETAIL  = 'retail',  'Retail & Fuel'

    category = models.CharField(choices=Category.choices)

    class PricingModel(models.TextChoices):
        FLAT_FEE            = 'flat_fee',            'Flat Fee'
        PER_NIGHT           = 'per_night',           'Per Night'
        PER_METER_PER_NIGHT = 'per_meter_per_night', 'Per Meter, Per Night'
        PER_KWH             = 'per_kwh',             'Per kWh'
        PER_HOUR            = 'per_hour',            'Per Hour'
        PER_METER_FLAT      = 'per_meter_flat',      'Per Meter (flat)'
        PER_LITRE           = 'per_litre',           'Per Litre'

    pricing_model = models.CharField(choices=PricingModel.choices)

    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    tax_rate   = models.DecimalField(max_digits=5, decimal_places=2, default=0.00)

    is_active     = models.BooleanField(default=True)
    show_in_pos   = models.BooleanField(default=False)  # Only relevant for retail/fuel

    # Only set when category=retail. Mirrors FuelDockEntry.FUEL_TYPE_CHOICES.
    # Choices: ('diesel', 'Diesel'), ('petrol', 'Petrol'), ('pump_out', 'Pump-out')
    # Leave blank for non-fuel retail items.
    fuel_dock_type = models.CharField(max_length=20, blank=True, default='',
                                      choices=FuelDockEntry.FUEL_TYPE_CHOICES)

    created_at = models.DateTimeField(auto_now_add=True)
```

---

## 3. The "Glue" Logic — Berth ↔ Price (Three-Step Migration)

To connect physical infrastructure to financial rules, add a `pricing_tier` FK to the `Berth` model. The existing `price_per_night` decimal field is **deprecated** and must be removed via the migration sequence below.

### 3a. Schema Migration

```python
# In a new migration for the berths app:
pricing_tier = models.ForeignKey(
    'billing.ChargeableItem',
    null=True,         # Temporary: allows null during data migration step
    blank=True,
    on_delete=models.SET_NULL,
    limit_choices_to={'category': 'berth'},
    related_name='berths',
)
```

`limit_choices_to` filters the Django admin widget only — it does **not** enforce at the DB or API level. Enforcement is handled in Section 5.

### 3b. Data Migration (RunPython)

Write a `RunPython` migration that:

1. Queries all `Berth` objects where `price_per_night` is not null.
2. For each unique `price_per_night` value, creates a `ChargeableItem` with:
   - `name`: `f"Legacy Rate — €{price_per_night:.2f}"`
   - `category`: `'berth'`
   - `pricing_model`: `'per_night'`
   - `unit_price`: the legacy price value
   - `tax_rate`: `0.00` (manager can update after migration)
   - `is_active`: `True`
3. Sets `berth.pricing_tier` to the matching `ChargeableItem`.
4. For any `Berth` where `price_per_night` is null (should not exist in production, but guards against a deployment crash): create a single shared `ChargeableItem` named `"Unpriced Slip — €0.00"` with `unit_price=0.00`, and assign it to all such berths. This satisfies the upcoming `NOT NULL` constraint without silently losing data.
5. Does **not** drop `price_per_night` yet — that happens in the next step.

### 3c. Cleanup Migration

After the data migration has been reviewed and verified:

1. Drop the `price_per_night` column from `Berth`.
2. Set `null=False` on `pricing_tier` (it must now be set for all berths).

> The billing engine must use `berth.pricing_tier.unit_price` as the authoritative price for all future bookings. The `price_per_night` fallback must **not** be implemented.

### 3d. Behavior

When creating or editing a physical `Berth` in the Infrastructure table, the manager selects its pricing tier from the linked list. If the price in the Catalog changes, all linked berths automatically inherit the new price for future bookings.

---

## 4. Navigation — New "Master Data" Sidebar Group

Add a new top-level nav group called **"Master Data"** to the sidebar. This group is for high-level configuration accessed by the Harbour Master and Accountant — not daily operations staff.

Initial contents of the group:
- **Service Catalog** → `/service-catalog`

The "Master Data" group is intentionally separate from "Billing" (daily operations) and "Infrastructure" (physical layout). Future items like vessel type management or harbour configuration belong here.

---

## 5. Frontend Component Architecture

Route: `/service-catalog` (under the "Master Data" sidebar group)

Build the UI using a **List/Drawer pattern** to keep the user in context.

### A. `ServiceCatalogScreen.jsx` (Wrapper)

- Layout: Header + 4 horizontal tabs mapping to the Categories:
  `Berth Rates | Utilities | Services | Retail & Fuel`
- Action: Top-right button `[ + New Pricing Rule ]` opens `CatalogFormDrawer` in create mode.

### B. `CatalogList.jsx` (Data Table)

Renders the list of items for the currently active tab.

Columns: **Name**, **Pricing Model**, **Unit Price** (formatted to currency), **Tax %**, **Status** (Active/Inactive badge).

Row action: clicking a row opens `CatalogFormDrawer` in edit mode.

### C. `CatalogFormDrawer.jsx` (Slide-out Form)

Slides in from the right. Handles both Create (`POST`) and Edit (`PATCH`).

**Dynamic field rules:**
- If `category === 'retail'`, reveal the `show_in_pos` toggle and the `fuel_dock_type` select. Otherwise hide both.
- `show_in_pos` is keyed strictly on `category === 'retail'`, not on a freeform check.

**Validation:**
- `unit_price` must be `>= 0`.
- `name` is required.

**Deactivation (soft delete):**
- The drawer includes a **Deactivate** button (visible in edit mode only).
- Clicking it sends `PATCH { is_active: false }`.
- There is **no hard DELETE** in the UI and the API must not expose a delete endpoint for `ChargeableItem`. Hard deletion is blocked because `InvoiceLineItem.chargeable_item` references these records via FK (`on_delete=SET_NULL`); deleting would silently null out historical line-item links.

---

## 6. API Contract

> **Note:** The `/api/v1/billing/service-catalog/` ViewSet already exists. Verify the serializer exposes all fields below (including `fuel_dock_type`). No new ViewSet needs to be created.

### `GET /api/v1/billing/service-catalog/`

Query params:
- `?category=berth` — filter by category (used for tab loading and the Berth form dropdown)
- `?is_active=true` — filter to active items only (used by dropdown pickers elsewhere)

Response:

```json
{
  "results": [
    {
      "id": 42,
      "name": "Transient Slip — 12m",
      "category": "berth",
      "pricing_model": "per_night",
      "unit_price": "40.00",
      "tax_rate": "20.00",
      "is_active": true,
      "show_in_pos": false,
      "fuel_dock_type": ""
    }
  ]
}
```

### `POST /api/v1/billing/service-catalog/`

Accepts the shape of the GET response object. Returns `201 Created`.

### `PATCH /api/v1/billing/service-catalog/{id}/`

Accepts partial updates (standard DRF `partial=True`). Returns `200 OK`.

The serializer must validate that `pricing_tier` on a `Berth` has `category == 'berth'`:

```python
def validate_pricing_tier(self, value):
    if value and value.category != 'berth':
        raise serializers.ValidationError("pricing_tier must be a Berth Rate item.")
    return value
```

This validation belongs on the `BerthSerializer`, not the `ChargeableItemSerializer`.

**No DELETE endpoint is exposed.**

---

## 7. Frontend Data Layer

Follow the same hook pattern as `usePOSCatalog.js`. Create:

```js
// hooks/useServiceCatalog.js
// Fetches /billing/service-catalog/ with optional ?category= filter.
// Exposes createItem, updateItem, and deactivateItem mutations.
// Toast notifications on mutation success/error (same pattern as existing hooks).
```

Mutations use React Query + Axios. On success, invalidate the `service-catalog` query key to refresh the list.

For the Berth edit form dropdown (Infrastructure section), use:
```
GET /api/v1/billing/service-catalog/?category=berth&is_active=true
```

---

## 8. Implementation Steps for the Agent

> Steps are ordered to respect Django migration dependencies. Do not reorder.

1. **Verify backend model** — Confirm live `ChargeableItem` matches Section 2. Do not modify existing fields or remove any `PricingModel` choices.

2. **Verify serializer** — Confirm `ChargeableItemSerializer` exposes all fields in Section 6 including `fuel_dock_type`. Update if any field is missing.

3. **Schema migration** — Add `pricing_tier` FK to `Berth` with `null=True` (Section 3a).

4. **Data migration** — Write `RunPython` to convert `price_per_night` values to `ChargeableItem` records and assign FKs (Section 3b).

5. **Cleanup migration** — Drop `price_per_night`, set `null=False` on `pricing_tier` (Section 3c).

6. **Update `BerthSerializer`** — Add `pricing_tier` field; add `validate_pricing_tier` (Section 6).

7. **Add "Master Data" nav group** — Add sidebar section and `/service-catalog` route (Section 4).

8. **Build frontend components** — `ServiceCatalogScreen.jsx`, `CatalogList.jsx`, `CatalogFormDrawer.jsx` (Section 5).

9. **Create `useServiceCatalog.js` hook** — Wire to React Query mutations with toasts (Section 7).

10. **Update Berth edit form** — Replace `price_per_night` input with `pricing_tier` dropdown, filtered to `?category=berth&is_active=true` (Section 3d).
