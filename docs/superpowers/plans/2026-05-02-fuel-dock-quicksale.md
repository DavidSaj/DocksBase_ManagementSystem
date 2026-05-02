# Fuel Dock Quick Sale Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the "Fuel Dock — Quick Sale" panel in Billing.jsx so the tile grid renders live ChargeableItem prices and "Process Sale" creates a real FuelDockEntry record (with correct member/invoice routing).

**Architecture:** Add three fields to `ChargeableItem` (`show_in_pos`, `fuel_dock_type`, `per_litre` pricing model). A new `usePOSCatalog` hook loads POS-enabled items from the existing `/billing/service-catalog/` endpoint. Tapping a tile reveals an inline form with a debounced member-search combobox; submitting POSTs to `/fuel-dock/queue/` with `status=completed`. The backend's `perform_create` is extended to calculate `total_amount` and call `_bill_completion` (invoice for members, `pos_paid=True` for guests) when a Quick Sale is created directly in completed state.

**Tech Stack:** Django/DRF (backend), React + plain CSS (frontend), existing `api.js` Axios instance, no new dependencies

---

## File Map

| File | Action | What changes |
|---|---|---|
| `backend/apps/billing/models.py` | Modify | Add `show_in_pos`, `fuel_dock_type`, `per_litre` to `ChargeableItem` |
| `backend/apps/billing/migrations/0006_chargeableitem_pos_fields.py` | Create | Migration for the three new fields |
| `backend/apps/billing/serializers.py` | Modify | Add `show_in_pos`, `fuel_dock_type` to `ChargeableItemSerializer.Meta.fields` |
| `backend/apps/fuel_dock/views.py` | Modify | `perform_create` calculates total + calls `_bill_completion` when `status=completed` |
| `backend/apps/fuel_dock/tests.py` | Modify | Add two Quick Sale POST tests |
| `frontend/src/hooks/useFuelEntries.js` | Modify | Expose `refetch` callback |
| `frontend/src/hooks/usePOSCatalog.js` | Create | Fetch POS-enabled ChargeableItems |
| `frontend/src/screens/Billing.jsx` | Modify | Replace hardcoded tiles; add inline sale form with combobox + Process Sale handler |

---

## Task 1 — Backend: Add POS fields to ChargeableItem

**Files:**
- Modify: `backend/apps/billing/models.py`
- Create: `backend/apps/billing/migrations/0006_chargeableitem_pos_fields.py`
- Modify: `backend/apps/billing/serializers.py`

- [ ] **Step 1: Add fields to ChargeableItem model**

In `backend/apps/billing/models.py`, add `per_litre` to the `PricingModel` choices and add two new fields to `ChargeableItem`:

```python
class PricingModel(models.TextChoices):
    FLAT_FEE            = 'flat_fee',            'Flat Fee'
    PER_NIGHT           = 'per_night',           'Per Night'
    PER_METER_PER_NIGHT = 'per_meter_per_night', 'Per Meter Per Night'
    PER_KWH             = 'per_kwh',             'Per kWh'
    PER_HOUR            = 'per_hour',            'Per Hour'
    PER_METER_FLAT      = 'per_meter_flat',      'Per Meter (flat)'
    PER_LITRE           = 'per_litre',           'Per Litre'
```

Add to the `ChargeableItem` model body (after `is_active`):

```python
show_in_pos    = models.BooleanField(default=False)
fuel_dock_type = models.CharField(max_length=20, blank=True, choices=[
    ('diesel',   'Diesel'),
    ('petrol',   'Petrol'),
    ('pump_out', 'Pump-out'),
])
```

- [ ] **Step 2: Create migration**

Run:
```
cd backend && python manage.py makemigrations billing --name chargeableitem_pos_fields
```

Expected output: `Migrations for 'billing': apps/billing/migrations/0006_chargeableitem_pos_fields.py`

Verify the generated file contains `AddField` operations for `show_in_pos`, `fuel_dock_type`, and an `AlterField` for `pricing_model` (adding the `per_litre` choice).

- [ ] **Step 3: Apply the migration**

```
python manage.py migrate billing
```

Expected: `Applying billing.0006_chargeableitem_pos_fields... OK`

- [ ] **Step 4: Update the serializer**

In `backend/apps/billing/serializers.py`, update `ChargeableItemSerializer.Meta.fields` to include the two new fields:

```python
class Meta:
    model  = ChargeableItem
    fields = [
        'id', 'name', 'category', 'category_display',
        'pricing_model', 'pricing_model_display',
        'unit_price', 'tax_rate', 'is_active',
        'show_in_pos', 'fuel_dock_type',
        'created_at',
    ]
    read_only_fields = ['id', 'created_at', 'pricing_model_display', 'category_display']
```

- [ ] **Step 5: Commit**

```bash
git add backend/apps/billing/models.py \
        backend/apps/billing/migrations/0006_chargeableitem_pos_fields.py \
        backend/apps/billing/serializers.py
git commit -m "feat(billing): add show_in_pos, fuel_dock_type, per_litre to ChargeableItem"
```

---

## Task 2 — Backend: Quick Sale via perform_create

**Files:**
- Modify: `backend/apps/fuel_dock/views.py`
- Modify: `backend/apps/fuel_dock/tests.py`

The existing `perform_create` only sets `marina`. When the frontend POSTs a Quick Sale directly with `status=completed`, the total must be calculated and billing routed (member → invoice, guest → `pos_paid=True`). The existing `_bill_completion` helper handles this; we just need to call it on create.

- [ ] **Step 1: Write the failing tests**

Add to `backend/apps/fuel_dock/tests.py` (after the existing test class):

```python
class FuelDockQuickSaleTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user   = make_user(self.marina)
        self.member = Member.objects.create(marina=self.marina, name='T. Berg', phone='+353 87 200 0000')
        self.vessel = Vessel.objects.create(marina=self.marina, name='Sea Whisper', owner=self.member)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_quicksale_guest_sets_pos_paid(self):
        resp = self.client.post('/api/v1/fuel-dock/queue/', {
            'status':          'completed',
            'fuel_type':       'diesel',
            'actual_litres':   '30.00',
            'price_per_litre': '1.42',
            'guest_description': 'Red sloop',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        entry = FuelDockEntry.objects.get(pk=resp.data['id'])
        self.assertEqual(entry.status, 'completed')
        self.assertAlmostEqual(float(entry.total_amount), 42.6)
        self.assertTrue(entry.pos_paid)
        self.assertIsNone(entry.invoice)
        self.assertIsNotNone(entry.completed_at)

    def test_quicksale_member_creates_invoice(self):
        resp = self.client.post('/api/v1/fuel-dock/queue/', {
            'status':          'completed',
            'fuel_type':       'petrol',
            'actual_litres':   '20.00',
            'price_per_litre': '1.55',
            'member':          self.member.id,
            'vessel':          self.vessel.id,
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        entry = FuelDockEntry.objects.get(pk=resp.data['id'])
        self.assertEqual(entry.status, 'completed')
        self.assertAlmostEqual(float(entry.total_amount), 31.0)
        self.assertFalse(entry.pos_paid)
        self.assertIsNotNone(entry.invoice)
        self.assertEqual(entry.invoice.source_type, 'fuel_dock')
```

- [ ] **Step 2: Run tests to verify they fail**

```
python manage.py test apps.fuel_dock.tests.FuelDockQuickSaleTest -v 2
```

Expected: 2 FAILUREs — `pos_paid` not set, `completed_at` null, `total_amount` null.

- [ ] **Step 3: Implement in perform_create**

Replace `perform_create` in `FuelQueueListCreateView` in `backend/apps/fuel_dock/views.py`:

```python
def perform_create(self, serializer):
    now    = timezone.now()
    status = serializer.validated_data.get('status', 'waiting')
    extra  = {'marina': self.request.user.marina}

    if status == 'completed':
        actual = serializer.validated_data.get('actual_litres')
        price  = serializer.validated_data.get('price_per_litre')
        total  = (actual * price) if (actual and price) else None
        extra['completed_at'] = now
        extra['total_amount'] = total

    entry = serializer.save(**extra)

    if status == 'completed':
        billing_extra = _bill_completion(entry, entry.total_amount, now)
        for field, val in billing_extra.items():
            setattr(entry, field, val)
        entry.save(update_fields=list(billing_extra.keys()))
```

- [ ] **Step 4: Run tests to verify they pass**

```
python manage.py test apps.fuel_dock.tests.FuelDockQuickSaleTest -v 2
```

Expected: 2 PASSes.

- [ ] **Step 5: Run full fuel dock test suite to check for regressions**

```
python manage.py test apps.fuel_dock -v 2
```

Expected: all 6 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/fuel_dock/views.py backend/apps/fuel_dock/tests.py
git commit -m "feat(fuel_dock): perform_create routes billing when status=completed"
```

---

## Task 3 — Frontend hooks: useFuelEntries refetch + usePOSCatalog

**Files:**
- Modify: `frontend/src/hooks/useFuelEntries.js`
- Create: `frontend/src/hooks/usePOSCatalog.js`

- [ ] **Step 1: Add refetch to useFuelEntries**

Replace the entire contents of `frontend/src/hooks/useFuelEntries.js`:

```js
import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function useFuelEntries({ limit = 20 } = {}) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(() => {
    setLoading(true);
    api
      .get('/fuel-dock/queue/', { params: { status: 'completed', active: '0', ordering: '-completed_at', limit } })
      .then(r => setEntries(r.data.results ?? r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [limit]);

  useEffect(() => { fetch(); }, [fetch]);

  return { entries, loading, refetch: fetch };
}
```

- [ ] **Step 2: Create usePOSCatalog.js**

Create `frontend/src/hooks/usePOSCatalog.js`:

```js
import { useState, useEffect } from 'react';
import api from '../api.js';

export default function usePOSCatalog() {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/billing/service-catalog/')
      .then(r => {
        const all = r.data.results ?? r.data;
        const ORDER = { diesel: 0, petrol: 1, pump_out: 2 };
        setItems(
          all
            .filter(i => i.show_in_pos && i.is_active)
            .sort((a, b) => (ORDER[a.fuel_dock_type] ?? 99) - (ORDER[b.fuel_dock_type] ?? 99))
        );
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return { items, loading };
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useFuelEntries.js frontend/src/hooks/usePOSCatalog.js
git commit -m "feat(frontend): usePOSCatalog hook + refetch on useFuelEntries"
```

---

## Task 4 — Frontend: Replace hardcoded tiles + add sale form

**Files:**
- Modify: `frontend/src/screens/Billing.jsx`

This task is the largest. Work top-to-bottom through the file in four sub-steps.

### 4a — Imports and state

- [ ] **Step 1: Add import for usePOSCatalog**

At the top of `Billing.jsx`, add after the existing hook imports:

```js
import usePOSCatalog from '../hooks/usePOSCatalog.js';
```

- [ ] **Step 2: Add usePOSCatalog hook call and POS state**

Inside the `Billing()` component, after the existing `useFuelEntries` line:

```js
const { entries: fuelEntries, loading: fuelLoading, refetch: refetchFuelEntries } = useFuelEntries({ limit: 20 });
```

(Update the existing destructure to also capture `refetch`.)

Then add the Quick Sale state block immediately below:

```js
// Quick Sale state
const [selectedPOSItem,  setSelectedPOSItem]  = useState(null);
const [posLitres,        setPosLitres]        = useState('');
const [posQuery,         setPosQuery]         = useState('');
const [posSuggestions,   setPosSuggestions]   = useState([]);
const [posResolved,      setPosResolved]      = useState(null);
const [posSubmitting,    setPosSubmitting]    = useState(false);
const [posError,         setPosError]         = useState('');
const debounceRef = useRef(null);

const { items: posCatalog, loading: posLoading } = usePOSCatalog();
```

Also confirm `useRef` is imported at the top — the existing import line is:
```js
import { useState, useEffect, useCallback } from 'react';
```
Add `useRef` to it:
```js
import { useState, useEffect, useCallback, useRef } from 'react';
```

### 4b — Helper functions

- [ ] **Step 3: Add helper functions for the sale form**

Add these functions inside the `Billing` component, after the state declarations (before the return):

```js
const FUEL_COLORS = { diesel: '#0075de', petrol: '#dd5b00', pump_out: '#2a9d99' };

function posTotal() {
  if (!selectedPOSItem) return 0;
  if (selectedPOSItem.pricing_model === 'per_litre') {
    const l = parseFloat(posLitres);
    return (isNaN(l) || l <= 0) ? 0 : +(l * parseFloat(selectedPOSItem.unit_price)).toFixed(2);
  }
  return parseFloat(selectedPOSItem.unit_price);
}

function posPriceLabel(item) {
  return item.pricing_model === 'per_litre'
    ? `€${Number(item.unit_price).toFixed(2)}/L`
    : `€${Number(item.unit_price).toFixed(2)} flat`;
}

function handlePosQueryChange(e) {
  const val = e.target.value;
  setPosQuery(val);
  setPosResolved(null);
  clearTimeout(debounceRef.current);
  if (val.length < 2) { setPosSuggestions([]); return; }
  debounceRef.current = setTimeout(() => {
    api.get('/members/', { params: { search: val } })
      .then(r => setPosSuggestions((r.data.results ?? r.data).slice(0, 5)))
      .catch(() => {});
  }, 300);
}

function handlePosSuggestionSelect(member) {
  const vessel = member.vessels?.[0] ?? null;
  setPosResolved({ id: member.id, vesselId: vessel?.id ?? null });
  setPosQuery(vessel ? `${member.name} — ${vessel.name}` : member.name);
  setPosSuggestions([]);
}

function clearPosForm() {
  setSelectedPOSItem(null);
  setPosLitres('');
  setPosQuery('');
  setPosSuggestions([]);
  setPosResolved(null);
  setPosError('');
}

async function handleProcessSale() {
  const total = posTotal();
  if (total <= 0) return;
  setPosSubmitting(true);
  setPosError('');
  try {
    const isPerLitre = selectedPOSItem.pricing_model === 'per_litre';
    await api.post('/fuel-dock/queue/', {
      status:          'completed',
      fuel_type:       selectedPOSItem.fuel_dock_type,
      actual_litres:   isPerLitre ? posLitres : '1',
      price_per_litre: selectedPOSItem.unit_price,
      ...(posResolved
        ? { member: posResolved.id, ...(posResolved.vesselId ? { vessel: posResolved.vesselId } : {}) }
        : { guest_description: posQuery || 'Walk-up' }),
    });
    clearPosForm();
    refetchFuelEntries();
  } catch {
    setPosError('Sale failed — please try again.');
  } finally {
    setPosSubmitting(false);
  }
}
```

### 4c — Replace tile grid JSX

- [ ] **Step 4: Replace the hardcoded tile array in the JSX**

Find the existing tile grid in the `{tab === 'pos' && ...}` block. Replace this:

```jsx
{[['Diesel','€1.42/L','#0075de'],['Petrol','€1.55/L','#dd5b00'],['Pump-out','€12 flat','#2a9d99'],['Ice (5kg)','€4.50','#615d59'],['Shore Power Token','€3.00','#213183'],['Merchandise','Price varies','#b8965a']].map(([item,price,c]) => (
  <div key={item} style={{ background: 'var(--bg)', borderRadius: 8, padding: '14px', cursor: 'pointer', border: 'var(--border)', transition: 'box-shadow 0.1s' }}
    onMouseOver={e => e.currentTarget.style.boxShadow = 'var(--shadow2)'}
    onMouseOut={e  => e.currentTarget.style.boxShadow = ''}>
    <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.8)' }}>{item}</div>
    <div style={{ fontSize: 12, color: c, fontWeight: 600, marginTop: 4 }}>{price}</div>
  </div>
))}
```

With this:

```jsx
{posLoading ? (
  <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: 8 }}>Loading catalog…</div>
) : posCatalog.length === 0 ? (
  <div style={{ gridColumn: '1 / -1', fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: 8 }}>
    No POS items configured. Add items in Settings → Service Catalog and enable "Show in POS".
  </div>
) : posCatalog.map(item => (
  <div key={item.id}
    onClick={() => { clearPosForm(); setSelectedPOSItem(item); }}
    style={{
      background: selectedPOSItem?.id === item.id ? 'var(--bg-active, #eef4ff)' : 'var(--bg)',
      borderRadius: 8, padding: '14px', cursor: 'pointer',
      border: selectedPOSItem?.id === item.id ? '1.5px solid var(--blue, #0075de)' : 'var(--border)',
      transition: 'box-shadow 0.1s',
    }}
    onMouseOver={e => e.currentTarget.style.boxShadow = 'var(--shadow2)'}
    onMouseOut={e  => e.currentTarget.style.boxShadow = ''}>
    <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(0,0,0,0.8)' }}>{item.name}</div>
    <div style={{ fontSize: 12, color: FUEL_COLORS[item.fuel_dock_type] ?? '#888', fontWeight: 600, marginTop: 4 }}>
      {posPriceLabel(item)}
    </div>
  </div>
))}
```

### 4d — Add inline sale form

- [ ] **Step 5: Add inline sale form below the tile grid**

After the closing `</div>` of the tile grid and before the `<button className="btn btn-gold"...>Process Sale</button>`, replace the Process Sale button with:

```jsx
{selectedPOSItem && (
  <div style={{ marginTop: 12, padding: '12px 0 4px', borderTop: 'var(--border)' }}>

    {/* Member / Guest combobox */}
    <div style={{ position: 'relative', marginBottom: 8 }}>
      <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginBottom: 3 }}>
        Vessel / Member <span style={{ fontWeight: 400 }}>(optional)</span>
      </div>
      <input
        value={posQuery}
        onChange={handlePosQueryChange}
        onBlur={() => setTimeout(() => setPosSuggestions([]), 200)}
        placeholder="Search member or type guest name…"
        style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '7px 10px',
          border: 'var(--border)', borderRadius: 6, outline: 'none',
          borderColor: posResolved ? 'var(--green, #2a9d50)' : undefined }}
      />
      {posResolved && (
        <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-2px)',
          color: 'var(--green, #2a9d50)', fontSize: 13, fontWeight: 700 }}>✓</span>
      )}
      {posSuggestions.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 20,
          background: '#fff', border: 'var(--border)', borderRadius: 6,
          boxShadow: 'var(--shadow2)', marginTop: 2 }}>
          {posSuggestions.map(m => (
            <div key={m.id}
              onMouseDown={() => handlePosSuggestionSelect(m)}
              style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer' }}
              onMouseOver={e => e.currentTarget.style.background = 'var(--bg)'}
              onMouseOut={e  => e.currentTarget.style.background = '#fff'}>
              <span style={{ fontWeight: 600 }}>{m.name}</span>
              {m.vessels?.[0] && <span style={{ color: 'rgba(0,0,0,0.4)', marginLeft: 6 }}>— {m.vessels[0].name}</span>}
            </div>
          ))}
        </div>
      )}
    </div>

    {/* Litres input (per_litre items only) */}
    {selectedPOSItem.pricing_model === 'per_litre' && (
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginBottom: 3 }}>Litres</div>
        <input
          type="number" min="0" step="0.1"
          value={posLitres}
          onChange={e => setPosLitres(e.target.value)}
          placeholder="0.0"
          style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '7px 10px',
            border: 'var(--border)', borderRadius: 6, outline: 'none' }}
        />
      </div>
    )}

    {/* Total */}
    {posTotal() > 0 && (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 10, fontSize: 13 }}>
        <span style={{ color: 'rgba(0,0,0,0.5)' }}>Total</span>
        <span style={{ fontWeight: 700 }}>€{posTotal().toFixed(2)}</span>
      </div>
    )}

    {posError && (
      <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 8 }}>{posError}</div>
    )}

    <div style={{ display: 'flex', gap: 8 }}>
      <button className="btn btn-ghost btn-sm" onClick={clearPosForm} style={{ flex: 1 }}>Cancel</button>
      <button
        className="btn btn-gold"
        onClick={handleProcessSale}
        disabled={posSubmitting || posTotal() <= 0}
        style={{ flex: 2, justifyContent: 'center', fontSize: 13, padding: '10px' }}>
        {posSubmitting ? 'Processing…' : 'Process Sale'}
      </button>
    </div>
  </div>
)}

{!selectedPOSItem && (
  <button className="btn btn-gold" style={{ width: '100%', justifyContent: 'center', fontSize: 13, padding: '10px', marginTop: 12 }} disabled>
    Select item above
  </button>
)}
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/Billing.jsx
git commit -m "feat(billing): fuel dock quick sale — live catalog tiles + member combobox + Process Sale"
```

---

## Task 5 — Smoke test the full flow

- [ ] **Step 1: Start backend and frontend dev servers**

Backend:
```
cd backend && python manage.py runserver
```
Frontend (separate terminal):
```
cd frontend && npm run dev
```

- [ ] **Step 2: Seed a test POS item via Django admin**

Navigate to `/admin/` → Billing → Chargeable Items → Add:
- Name: `Diesel`
- Category: `Utility`
- Pricing model: `Per Litre`
- Unit price: `1.42`
- Tax rate: `0`
- Show in POS: ✓
- Fuel dock type: `diesel`
- Save

- [ ] **Step 3: Verify tile grid shows the seeded item**

Open the app → Billing → POS tab. The Diesel tile should appear with `€1.42/L`. The hardcoded tiles are gone.

- [ ] **Step 4: Test guest Quick Sale**

Tap Diesel → enter 30 in Litres → leave Member/Guest blank → Process Sale.
Expected: total shows `€42.60`, sale submits, "Recent Fuel Sales" list refreshes showing `— · Diesel · 30L · €42.60`.

- [ ] **Step 5: Test member Quick Sale**

Tap Diesel → type a member name in the combobox → select from dropdown (green checkmark appears) → enter 50 Litres → Process Sale.
Expected: sale submits, Recent Fuel Sales shows the member's vessel name and amount. In Django admin, a `FuelDockEntry` with the member FK set and an associated `Invoice` should exist.

- [ ] **Step 6: Test pump-out (flat fee)**

Add a second POS item: Name `Pump-out`, pricing_model `flat_fee`, unit_price `12.00`, fuel_dock_type `pump_out`, show_in_pos ✓.
Tap the Pump-out tile — no litres input should appear. Total shows `€12.00` immediately. Process Sale and verify in admin.

- [ ] **Step 7: Commit any fixes found during smoke testing**

Fix any issues found, then:
```bash
git add -p
git commit -m "fix(billing): quicksale smoke test corrections"
```
