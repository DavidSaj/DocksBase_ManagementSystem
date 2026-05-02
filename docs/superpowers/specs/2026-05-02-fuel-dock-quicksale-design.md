# Spec: Fuel Dock Quick Sale — Product Tiles + Process Sale

> Created: 2026-05-02
> Scope: Wire the Billing POS tab "Fuel Dock — Quick Sale" tile grid and "Process Sale" button
>        to real data. Fuel-only scope (Diesel, Petrol, Pump-out).

---

## Context

The Billing screen's `pos` tab has a "Fuel Dock — Quick Sale" panel. The tile grid and prices
are currently hardcoded in `Billing.jsx`. The "Process Sale" button is a no-op. The "Recent
Fuel Sales" list below it is already wired (via `useFuelEntries` → `GET /fuel-dock/queue/?status=completed`).

**This spec covers:** making the tile grid dynamic and the "Process Sale" button functional.
**Out of scope:** non-fuel POS items (Ice, Shore Power Token, Merchandise) — deferred to a later sprint.

---

## Architectural Principle

`ChargeableItem` is the single source of truth for all billable pricing in DocksBase. Fuel prices
live here (not in a Marina JSON blob) so that tax rates, revenue categories, and ledger routing
are inherited automatically. The marina admin manages fuel prices in the same Service Catalog UI
used for berth fees.

---

## Data Model Changes

### `ChargeableItem` (apps/billing/models.py)

Three new fields:

| Field | Type | Default | Purpose |
|---|---|---|---|
| `show_in_pos` | `BooleanField` | `False` | Marks items that appear on the Quick Sale tile grid |
| `fuel_dock_type` | `CharField(max_length=20, blank=True)` | `''` | Maps item to a `FuelDockEntry.fuel_type` value; empty for non-fuel items |
| `per_litre` | new `PricingModel` choice | — | Pricing model for diesel/petrol (price × litres = total) |

`fuel_dock_type` uses the same choices as `FuelDockEntry.FUEL_TYPE_CHOICES`:
`'diesel'` | `'petrol'` | `'pump_out'`

Pump-out items use `pricing_model='flat_fee'` (no litre input). Diesel/Petrol use
`pricing_model='per_litre'` (litre input shown).

**Migration:** single migration `0002_chargeableitem_pos_fields.py` covering all three changes.

### Seeding

Initial POS items are created via Django admin per marina (prices are marina-specific so cannot
be seeded in a data migration):

| name | category | pricing_model | unit_price | fuel_dock_type | show_in_pos |
|---|---|---|---|---|---|
| Diesel | utility | per_litre | marina-specific | diesel | true |
| Petrol | utility | per_litre | marina-specific | petrol | true |
| Pump-out | utility | flat_fee | marina-specific | pump_out | true |

---

## API

### Existing endpoint — no changes needed

`GET /billing/service-catalog/` already filters by marina and returns all `ChargeableItem` fields.
The new fields (`show_in_pos`, `fuel_dock_type`) are automatically included in the serializer
(ModelSerializer with `fields = '__all__'` or explicit list — confirm and add if needed).

Frontend filters client-side: `items.filter(i => i.show_in_pos)` — or pass `?show_in_pos=true`
if the view gains a filter backend. Either is fine given the catalog is small.

### Sale creation — existing endpoint, no changes

`POST /fuel-dock/queue/` accepts `status=completed` on creation (no transition logic is triggered
on `perform_create`, only on `perform_update`). The Quick Sale POSTs directly with
`status=completed` and `pos_paid=true`.

---

## Frontend

### New hook — `usePOSCatalog.js`

```
GET /billing/service-catalog/
```

Returns `{ items, loading }` where `items` is filtered to `show_in_pos === true`, ordered by
`fuel_dock_type` (diesel → petrol → pump_out).

### `Billing.jsx` — POS tab changes

**Tile grid:**
- Replace the hardcoded array literal with `posCatalog` from `usePOSCatalog`.
- Each tile shows: `item.name`, formatted price (`€X.XX/L` for per_litre, `€X flat` for flat_fee).
- Clicking a tile sets `selectedPOSItem` state.

**Inline sale form (shown when `selectedPOSItem` is set):**
- **Vessel / Member** — searchable combobox (see below)
- **Litres** — number input, only rendered if `selectedPOSItem.pricing_model === 'per_litre'`
- **Total** — read-only, calculated live:
  - per_litre: `(litres * unit_price).toFixed(2)`
  - flat_fee: `unit_price`
- **Cancel** button — clears `selectedPOSItem`
- **Process Sale** button — disabled until total > 0

**Vessel / Member combobox behaviour:**

The input is a searchable combobox, not a plain text field. This prevents member sales from
being silently saved as unlinked guest strings (which would break ledger search by berth/member).

- As the user types, the dropdown queries the existing members/vessels data (reuse `useMembers`
  or a lightweight `GET /members/?search=<query>` call) and surfaces suggestions formatted as
  `"Berth A12 — John Smith"`.
- **If a suggestion is selected:** the resolved `member` (and optionally `vessel`) FK is stored
  in component state. The POST payload sends `member: <id>` (and `vessel: <id>` if known).
  `guest_description` is omitted.
- **If the user types a free-text string and dismisses the dropdown (no match selected):**
  treat as a guest. POST sends `guest_description: <typed string>`, no `member`/`vessel` field.
- The combobox label updates to reflect the resolved state: green checkmark + name if a member
  was matched, plain text if guest.

**Process Sale handler:**
```js
POST /fuel-dock/queue/
{
  status: 'completed',
  pos_paid: true,
  fuel_type: selectedPOSItem.fuel_dock_type,
  actual_litres: litres || null,
  price_per_litre: selectedPOSItem.pricing_model === 'per_litre' ? selectedPOSItem.unit_price : null,
  total_amount: total,
  // mutually exclusive — one or the other, never both:
  member: resolvedMemberId || undefined,
  vessel: resolvedVesselId || undefined,
  guest_description: resolvedMemberId ? undefined : guestText,
}
```

On success: clear form state, call `refetchFuelEntries()` so "Recent Fuel Sales" updates immediately.
`useFuelEntries` must be updated to expose a `refetch` function alongside `{ entries, loading }`.
On error: show inline error message (do not clear form).

---

## Files Touched

**Backend:**
- `apps/billing/models.py` — add 3 fields to `ChargeableItem`
- `apps/billing/serializers.py` — confirm new fields are included
- `apps/billing/migrations/0002_chargeableitem_pos_fields.py` — new migration

**Frontend:**
- `frontend/src/hooks/usePOSCatalog.js` — new hook
- `frontend/src/hooks/useFuelEntries.js` — add `refetch` to return value
- `frontend/src/screens/Billing.jsx` — replace tile array, add sale form + handler

---

## Out of Scope

- Non-fuel POS items (Ice, Shore Power Token, Merchandise) — requires a different sale record type
- "Charge to account" via Quick Sale (member invoice path) — queue flow already handles this
- Price management UI — admins use existing Settings > Service Catalog
