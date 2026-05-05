# Operational Berths & Fuel Dock Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the Operations tab fuel dock queue to real Berth records by introducing `berth_class`/`operational_type` fields, replacing the disconnected `marina.fuel_berths` JSON array, and showing live fueling status on the LiveMap.

**Architecture:** Two new fields on `Berth` (berth_class, operational_type) replace the `marina.fuel_berths` JSON blob. `FuelDockEntry.fuel_berth` is migrated from a free-text CharField to a FK to `Berth`. The Operations tab fetches fuel dock berths via the API; the LiveMap overlays active fueling entries on those berths at the 30s poll interval.

**Tech Stack:** Django/DRF (backend), React (frontend), DjangoFilterBackend, APIClient (tests)

---

## File Map

| File | Change |
|------|--------|
| `backend/apps/berths/models.py` | Add `berth_class` + `operational_type` to Berth |
| `backend/apps/berths/migrations/0016_berth_class_operational_type.py` | Migration for new fields |
| `backend/apps/berths/tests/test_operational_berths.py` | New test file for operational berth API |
| `backend/apps/berths/serializers.py` | Expose `berth_class` + `operational_type` |
| `backend/apps/berths/views.py` | Add `operational_type` to filterset_fields |
| `backend/apps/fuel_dock/models.py` | `fuel_berth` CharField → FK to Berth |
| `backend/apps/fuel_dock/migrations/0002_fueldockentry_fuel_berth_fk.py` | Migration |
| `backend/apps/fuel_dock/serializers.py` | Expose `fuel_berth` as PK + `fuel_berth_code` as read-only |
| `backend/apps/fuel_dock/tests.py` | Update `_create_entry` helper; remove old `fuel_berth='FD-1'` strings |
| `frontend/src/screens/Infrastructure.jsx` | Add Classification section to BerthDetailModal + BulkCreateModal |
| `frontend/src/components/harbor-map/mapBuilderPrefabs.js` | Remove fuel-dock entry from PREFABS + PREFAB_TO_PIER_TYPE |
| `frontend/src/components/harbor-map/MapBuilderBerthPanel.jsx` | Amber tag for operational_type=fuel_dock berths |
| `frontend/src/screens/Operations.jsx` | Fetch fuel berths from API; berth picker on "To Berth"; match by ID |
| `frontend/src/components/harbor-map/LiveMap.jsx` | Fetch active fuel entries; amber overlay + vessel label on fueling berths |

---

## Task 1: Backend model — Add berth_class + operational_type to Berth

**Files:**
- Modify: `backend/apps/berths/models.py`
- Create: `backend/apps/berths/migrations/0016_berth_class_operational_type.py`
- Create: `backend/apps/berths/tests/test_operational_berths.py`

- [ ] **Step 1: Write the failing test**

Create `backend/apps/berths/tests/test_operational_berths.py`:

```python
from django.test import TestCase
from apps.accounts.models import Marina, User
from apps.berths.models import Berth
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken


def make_user_with_marina(email='ops@test.com'):
    marina = Marina.objects.create(name=f'Test Marina {email}')
    user = User.objects.create_user(email=email, password='testpass', marina=marina)
    return user, marina


def auth_client(user):
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return client


class BerthClassFieldsTest(TestCase):
    def setUp(self):
        self.user, self.marina = make_user_with_marina()
        self.client = auth_client(self.user)

    def test_berth_defaults_to_standard_class(self):
        berth = Berth.objects.create(marina=self.marina, code='B1')
        self.assertEqual(berth.berth_class, 'standard')
        self.assertEqual(berth.operational_type, '')

    def test_fuel_dock_berth_filterable_via_api(self):
        Berth.objects.create(
            marina=self.marina, code='FD1',
            berth_class='operational', operational_type='fuel_dock',
        )
        Berth.objects.create(marina=self.marina, code='B2', berth_class='standard')
        resp = self.client.get('/api/v1/berths/?operational_type=fuel_dock')
        self.assertEqual(resp.status_code, 200)
        data = resp.data if isinstance(resp.data, list) else resp.data.get('results', [])
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]['code'], 'FD1')

    def test_serializer_exposes_berth_class_and_operational_type(self):
        Berth.objects.create(
            marina=self.marina, code='FD2',
            berth_class='operational', operational_type='fuel_dock',
        )
        resp = self.client.get('/api/v1/berths/')
        self.assertEqual(resp.status_code, 200)
        data = resp.data if isinstance(resp.data, list) else resp.data.get('results', [])
        fd = next(b for b in data if b['code'] == 'FD2')
        self.assertEqual(fd['berth_class'], 'operational')
        self.assertEqual(fd['operational_type'], 'fuel_dock')

    def test_patch_berth_class_and_operational_type(self):
        berth = Berth.objects.create(marina=self.marina, code='FD3')
        resp = self.client.patch(f'/api/v1/berths/{berth.id}/', {
            'berth_class': 'operational',
            'operational_type': 'fuel_dock',
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        berth.refresh_from_db()
        self.assertEqual(berth.berth_class, 'operational')
        self.assertEqual(berth.operational_type, 'fuel_dock')
```

- [ ] **Step 2: Run test to verify it fails**

```
cd backend && python manage.py test apps.berths.tests.test_operational_berths -v 2
```

Expected: FAIL with `AttributeError: type object 'Berth' has no attribute 'berth_class'`

- [ ] **Step 3: Add fields to Berth model**

In `backend/apps/berths/models.py`, add two fields to the `Berth` class after `berth_type`:

```python
    BERTH_CLASS_CHOICES = [
        ('standard',    'Standard'),
        ('operational', 'Operational'),
    ]
    OPERATIONAL_TYPE_CHOICES = [
        ('fuel_dock', 'Fuel Dock'),
    ]

    berth_class      = models.CharField(max_length=20, choices=BERTH_CLASS_CHOICES, default='standard')
    operational_type = models.CharField(max_length=30, choices=OPERATIONAL_TYPE_CHOICES, blank=True, default='')
```

Place them right after `berth_type = models.CharField(...)` (line 66 in current file).

- [ ] **Step 4: Create migration**

```
cd backend && python manage.py makemigrations berths --name berth_class_operational_type
```

Verify the generated file `0016_berth_class_operational_type.py` adds both fields with correct defaults. Run:

```
cd backend && python manage.py migrate
```

Expected: `Applying berths.0016_berth_class_operational_type... OK`

- [ ] **Step 5: Run test to verify it passes**

```
cd backend && python manage.py test apps.berths.tests.test_operational_berths -v 2
```

Expected: `test_berth_defaults_to_standard_class` passes, others still fail (serializer/filter not updated yet — that's fine, they'll pass after Task 2).

- [ ] **Step 6: Commit**

```
git add backend/apps/berths/models.py backend/apps/berths/migrations/0016_berth_class_operational_type.py backend/apps/berths/tests/test_operational_berths.py
git commit -m "feat(berths): add berth_class and operational_type fields to Berth"
```

---

## Task 2: Backend API — expose new fields in serializer and add filter

**Files:**
- Modify: `backend/apps/berths/serializers.py`
- Modify: `backend/apps/berths/views.py`

- [ ] **Step 1: Update BerthSerializer to include new fields**

In `backend/apps/berths/serializers.py`, update the `Meta.fields` list and `read_only_fields`. Replace the `fields` list inside `BerthSerializer.Meta`:

```python
    class Meta:
        model = Berth
        fields = [
            'id', 'code', 'berth_type', 'berth_class', 'operational_type',
            'pier', 'pier_code', 'side', 'position_index',
            'length_m', 'max_draft_m', 'max_beam_m', 'amenities',
            'pricing_tier', 'pricing_tier_name', 'pricing_tier_unit_price',
            'status', 'effective_status', 'vessel', 'vessel_name',
            'local_x', 'local_y', 'position_on_parent', 'is_placed',
        ]
        read_only_fields = ['id', 'pier_code', 'vessel_name', 'is_placed', 'effective_status']
```

- [ ] **Step 2: Add operational_type to filterset_fields in BerthListCreateView**

In `backend/apps/berths/views.py`, update `BerthListCreateView`:

```python
class BerthListCreateView(generics.ListCreateAPIView):
    serializer_class = BerthSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['status', 'pier', 'berth_type', 'operational_type']
```

- [ ] **Step 3: Run the full operational berths test suite**

```
cd backend && python manage.py test apps.berths.tests.test_operational_berths -v 2
```

Expected: All 4 tests PASS.

- [ ] **Step 4: Run existing berths tests to check for regressions**

```
cd backend && python manage.py test apps.berths -v 2
```

Expected: All pass.

- [ ] **Step 5: Commit**

```
git add backend/apps/berths/serializers.py backend/apps/berths/views.py
git commit -m "feat(berths): expose berth_class/operational_type in serializer and add filter"
```

---

## Task 3: Backend — FuelDockEntry fuel_berth CharField → FK + serializer update

**Files:**
- Modify: `backend/apps/fuel_dock/models.py`
- Create: `backend/apps/fuel_dock/migrations/0002_fueldockentry_fuel_berth_fk.py`
- Modify: `backend/apps/fuel_dock/serializers.py`
- Modify: `backend/apps/fuel_dock/tests.py`

- [ ] **Step 1: Update existing tests to remove fuel_berth string references**

In `backend/apps/fuel_dock/tests.py`, update `_create_entry` in `FuelDockBillingTest` and `FuelDockQuickSaleTest` to drop the `fuel_berth` default (it's now a nullable FK):

In `FuelDockBillingTest._create_entry`:
```python
    def _create_entry(self, **kwargs):
        defaults = dict(marina=self.marina, fuel_type='diesel', status='service')
        defaults.update(kwargs)
        return FuelDockEntry.objects.create(**defaults)
```

Also update `test_state_machine_advances_in_order` which uses `status='waiting'` (already no `fuel_berth`), so only remove `fuel_berth='FD-1'` from the defaults. The test at line 29 currently has `fuel_berth='FD-1'` — remove that from defaults.

- [ ] **Step 2: Verify tests still pass with current CharField (before model change)**

```
cd backend && python manage.py test apps.fuel_dock -v 2
```

Expected: All tests pass (we only removed a default that DRF was fine with).

- [ ] **Step 3: Change fuel_berth to FK in model**

In `backend/apps/fuel_dock/models.py`, replace:
```python
    fuel_berth = models.CharField(max_length=20, blank=True)
```
with:
```python
    fuel_berth = models.ForeignKey(
        'berths.Berth',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='fuel_entries',
    )
```

- [ ] **Step 4: Create migration**

```
cd backend && python manage.py makemigrations fuel_dock --name fueldockentry_fuel_berth_fk
```

Verify the file removes the old CharField and adds the FK. Run:

```
cd backend && python manage.py migrate
```

Expected: `Applying fuel_dock.0002_fueldockentry_fuel_berth_fk... OK`

- [ ] **Step 5: Update FuelDockEntry serializer**

In `backend/apps/fuel_dock/serializers.py`, add `fuel_berth_code` as a read-only derived field and expose `fuel_berth` as a writable PK:

```python
from rest_framework import serializers
from .models import FuelDockEntry


class FuelDockEntrySerializer(serializers.ModelSerializer):
    vessel_name    = serializers.CharField(source='vessel.name',      read_only=True, default=None)
    member_name    = serializers.CharField(source='member.name',      read_only=True, default=None)
    member_phone   = serializers.CharField(source='member.phone',     read_only=True, default=None)
    fuel_berth_code = serializers.CharField(source='fuel_berth.code', read_only=True, default=None)

    class Meta:
        model = FuelDockEntry
        fields = [
            'id', 'vessel', 'vessel_name', 'member', 'member_name', 'member_phone',
            'guest_description', 'guest_phone',
            'fuel_type', 'estimated_litres', 'actual_litres', 'price_per_litre', 'total_amount',
            'status', 'fuel_berth', 'fuel_berth_code',
            'arrived_at', 'service_start', 'completed_at',
            'invoice', 'pos_paid',
        ]
        read_only_fields = [
            'id', 'vessel_name', 'member_name', 'member_phone', 'fuel_berth_code',
            'arrived_at', 'service_start', 'completed_at',
            'invoice', 'pos_paid',
        ]
```

Note: `fuel_berth` is writable (accepts a Berth `id` integer), `fuel_berth_code` is read-only.

- [ ] **Step 6: Update filterset_fields in FuelQueueListCreateView**

In `backend/apps/fuel_dock/views.py`, `filterset_fields` currently includes `'fuel_berth'`. This still works with a FK field in DjangoFilterBackend (filters by Berth ID). No change needed for the filter itself.

However, the `select_related` call must include the FK. Update `get_queryset` in `FuelQueueListCreateView`:

```python
    def get_queryset(self):
        qs = FuelDockEntry.objects.filter(marina=self.request.user.marina).select_related(
            'vessel', 'member', 'invoice', 'fuel_berth'
        )
        if self.request.query_params.get('active', '1') == '1':
            qs = qs.exclude(status='completed')
        return qs
```

Also update `FuelQueueDetailView.get_queryset`:

```python
    def get_queryset(self):
        return FuelDockEntry.objects.filter(marina=self.request.user.marina).select_related(
            'vessel', 'member', 'fuel_berth'
        )
```

- [ ] **Step 7: Run all fuel dock tests**

```
cd backend && python manage.py test apps.fuel_dock -v 2
```

Expected: All tests pass.

- [ ] **Step 8: Run full test suite to check regressions**

```
cd backend && python manage.py test apps.berths apps.fuel_dock apps.billing apps.reservations -v 2
```

Expected: All pass.

- [ ] **Step 9: Commit**

```
git add backend/apps/fuel_dock/models.py backend/apps/fuel_dock/migrations/0002_fueldockentry_fuel_berth_fk.py backend/apps/fuel_dock/serializers.py backend/apps/fuel_dock/views.py backend/apps/fuel_dock/tests.py
git commit -m "feat(fuel_dock): migrate fuel_berth from CharField to Berth FK"
```

---

## Task 4: Frontend — Infrastructure.jsx — Classification section

**Files:**
- Modify: `frontend/src/screens/Infrastructure.jsx`

- [ ] **Step 1: Add berth_class + operational_type to BerthDetailModal form state**

In `BerthDetailModal`, the `useEffect` that initialises `form` (line 31–42) — add the two new fields:

```javascript
  useEffect(() => {
    setForm({
      berth_type:       berth.berth_type       || '',
      berth_class:      berth.berth_class      || 'standard',
      operational_type: berth.operational_type || '',
      status:           berth.status,
      length_m:         berth.length_m     != null ? String(berth.length_m)     : '',
      max_beam_m:       berth.max_beam_m   != null ? String(berth.max_beam_m)   : '',
      max_draft_m:      berth.max_draft_m  != null ? String(berth.max_draft_m)  : '',
      side:             berth.side         || '',
      pricing_tier:     berth.pricing_tier != null ? String(berth.pricing_tier) : '',
      amenities:        berth.amenities    ?? [],
    });
    setError('');
  }, [berth?.id]);
```

- [ ] **Step 2: Add berth_class + operational_type to the save patch**

In `BerthDetailModal.save()`, the `patch` object (line 56–65) — add the two new fields:

```javascript
      const patch = {
        berth_type:       form.berth_type.trim(),
        berth_class:      form.berth_class,
        operational_type: form.berth_class === 'operational' ? form.operational_type : '',
        status:           form.status,
        side:             form.side || null,
        length_m:         form.length_m    !== '' ? Number(form.length_m)    : null,
        max_beam_m:       form.max_beam_m  !== '' ? Number(form.max_beam_m)  : null,
        max_draft_m:      form.max_draft_m !== '' ? Number(form.max_draft_m) : null,
        pricing_tier:     form.pricing_tier !== '' ? Number(form.pricing_tier) : null,
        amenities:        form.amenities,
      };
```

- [ ] **Step 3: Add the Classification UI block to BerthDetailModal render**

Inside the form area of `BerthDetailModal` (after the `{/* Berth Type */}` block and before `{/* Status + Side */}`), add:

```jsx
          {/* Classification */}
          <div>
            <label style={lbl}>Classification</label>
            <div style={{ display: 'flex', gap: 8, marginBottom: form.berth_class === 'operational' ? 8 : 0 }}>
              {[['standard', 'Standard'], ['operational', 'Operational']].map(([v, l]) => (
                <button
                  key={v} type="button"
                  onClick={() => setForm(f => ({
                    ...f,
                    berth_class: v,
                    operational_type: v === 'standard' ? '' : f.operational_type,
                  }))}
                  style={{
                    padding: '6px 16px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                    border: `1.5px solid ${form.berth_class === v ? 'var(--navy)' : 'rgba(0,0,0,0.15)'}`,
                    background: form.berth_class === v ? 'var(--navy)' : '#fff',
                    color: form.berth_class === v ? '#fff' : 'rgba(0,0,0,0.6)',
                    fontFamily: 'var(--font)',
                  }}
                >{l}</button>
              ))}
            </div>
            {form.berth_class === 'operational' && (
              <select
                value={form.operational_type}
                onChange={e => setForm(f => ({ ...f, operational_type: e.target.value }))}
                style={inputSt}
              >
                <option value="">Select operational type…</option>
                <option value="fuel_dock">Fuel Dock</option>
              </select>
            )}
          </div>
```

- [ ] **Step 4: Add berth_class + operational_type to BulkCreateModal**

In `BulkCreateModal`, add the two fields to `form` state initialisation:

```javascript
  const [form, setForm] = useState({
    prefix: '', start: 1, count: 10, berth_type: '',
    berth_class: 'standard', operational_type: '',
    length_m: '', beam_m: '', max_draft_m: '',
  });
```

In `BulkCreateModal.submit()`, add to the POST body:

```javascript
      await api.post('/berths/bulk-create/', {
        prefix:           form.prefix.trim().toUpperCase(),
        start:            Number(form.start),
        count:            Number(form.count),
        berth_type:       form.berth_type.trim(),
        berth_class:      form.berth_class,
        operational_type: form.berth_class === 'operational' ? form.operational_type : '',
        length_m:         form.length_m    ? Number(form.length_m)    : null,
        beam_m:           form.beam_m      ? Number(form.beam_m)      : null,
        max_draft_m:      form.max_draft_m ? Number(form.max_draft_m) : null,
      });
```

Add classification UI in `BulkCreateModal` render, after the "Berth Type" field and before the prefix/start/count grid:

```jsx
        <div style={{ marginBottom: 14 }}>
          <div className="field-label">Classification</div>
          <div style={{ display: 'flex', gap: 8, marginBottom: form.berth_class === 'operational' ? 8 : 0 }}>
            {[['standard', 'Standard'], ['operational', 'Operational']].map(([v, l]) => (
              <button
                key={v} type="button"
                onClick={() => set('berth_class', v)}
                style={{
                  padding: '5px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 13,
                  border: `1.5px solid ${form.berth_class === v ? 'var(--navy)' : 'rgba(0,0,0,0.15)'}`,
                  background: form.berth_class === v ? 'var(--navy)' : '#fff',
                  color: form.berth_class === v ? '#fff' : 'rgba(0,0,0,0.6)',
                  fontFamily: 'var(--font)',
                }}
              >{l}</button>
            ))}
          </div>
          {form.berth_class === 'operational' && (
            <select className="field-input" value={form.operational_type} onChange={e => set('operational_type', e.target.value)}>
              <option value="">Select operational type…</option>
              <option value="fuel_dock">Fuel Dock</option>
            </select>
          )}
        </div>
```

- [ ] **Step 5: Update BulkCreateBerthsView to accept the new fields**

In `backend/apps/berths/views.py`, `BulkCreateBerthsView.post()`, add the two fields to the defaults dict:

```python
        berth_class      = (request.data.get('berth_class') or 'standard').strip()
        operational_type = (request.data.get('operational_type') or '').strip()
```

And add them to the `defaults` in `get_or_create`:

```python
                defaults={
                    'length_m':        length_m,
                    'max_beam_m':      beam_m,
                    'max_draft_m':     max_draft_m,
                    'berth_type':      berth_type,
                    'berth_class':     berth_class,
                    'operational_type': operational_type,
                    'status':          'available',
                },
```

- [ ] **Step 6: Verify visually**

Start the dev server and navigate to Infrastructure → Berths. Click a berth to open BerthDetailModal. Verify:
- "Classification" section shows two buttons: Standard (active by default) and Operational
- Clicking Operational reveals the dropdown showing "Fuel Dock"
- Saving patches the berth correctly (check Network tab: `berth_class: "operational"`, `operational_type: "fuel_dock"`)
- Open BulkCreate: same classification section appears

- [ ] **Step 7: Commit**

```
git add frontend/src/screens/Infrastructure.jsx backend/apps/berths/views.py
git commit -m "feat(infrastructure): add berth classification section to berth forms"
```

---

## Task 5: Frontend Map Editor — remove fuel-dock prefab, amber tag on fuel dock berths

**Files:**
- Modify: `frontend/src/components/harbor-map/mapBuilderPrefabs.js`
- Modify: `frontend/src/components/harbor-map/MapBuilderBerthPanel.jsx`

- [ ] **Step 1: Remove fuel-dock from PREFABS and PREFAB_TO_PIER_TYPE**

In `frontend/src/components/harbor-map/mapBuilderPrefabs.js`:

Remove this line from the `PREFABS` array:
```javascript
  { type: 'fuel-dock',             label: 'Fuel Dock',                 cat: 'Docking', w: 4,  h: 2,   bg: '#f0d878', border: '#c8a820' },
```

Remove this line from `PREFAB_TO_PIER_TYPE`:
```javascript
  'fuel-dock':             'fuel-dock',
```

The `PIER_COLORS` object in `MapBuilder.jsx` keeps its `'fuel-dock'` entry — existing legacy piers on the map still render correctly.

- [ ] **Step 2: Add amber styling for fuel dock berths in MapBuilderBerthPanel**

Replace the entire content of `frontend/src/components/harbor-map/MapBuilderBerthPanel.jsx`:

```jsx
export default function MapBuilderBerthPanel({ berths, placedBerthIds, onBerthDragStart }) {
  const sorted = [...berths].sort((a, b) => {
    const aP = placedBerthIds.has(a.id) ? 1 : 0
    const bP = placedBerthIds.has(b.id) ? 1 : 0
    return aP - bP
  })

  return (
    <div style={{
      width: 150, flexShrink: 0, display: 'flex', flexDirection: 'column',
      background: 'var(--white)', borderLeft: 'var(--border)', overflowY: 'auto',
    }}>
      <div style={{ padding: '10px 12px', fontSize: 11, letterSpacing: '1px', color: 'var(--gold)', borderBottom: 'var(--border)', fontWeight: 700 }}>
        BERTHS
      </div>
      <div style={{ padding: '5px 8px 4px', fontSize: 10, color: 'rgba(0,0,0,0.4)' }}>
        Drag onto map ↓
      </div>

      {sorted.map(berth => {
        const placed     = placedBerthIds.has(berth.id)
        const isFuelDock = berth.operational_type === 'fuel_dock'
        return (
          <div
            key={berth.id}
            draggable={!placed}
            onDragStart={placed ? undefined : e => onBerthDragStart(e, berth)}
            style={{
              margin: '3px 8px',
              padding: '6px 8px',
              background: placed ? 'transparent' : isFuelDock ? '#fff8e8' : '#e8f2ff',
              border: `1px solid ${placed ? 'rgba(0,0,0,0.08)' : isFuelDock ? '#f0a020' : '#b0cff5'}`,
              borderRadius: 4,
              fontSize: 11,
              color: placed ? 'rgba(0,0,0,0.3)' : 'rgba(0,0,0,0.7)',
              cursor: placed ? 'default' : 'grab',
              userSelect: 'none',
              display: 'flex', flexDirection: 'column', gap: 2,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>{berth.code} · {berth.length_m}m</span>
              {placed && <span style={{ fontSize: 9, color: 'var(--green)' }}>✓</span>}
            </div>
            {isFuelDock && !placed && (
              <span style={{ fontSize: 9, color: '#c87010', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.3px' }}>
                Fuel Dock
              </span>
            )}
          </div>
        )
      })}

      {berths.length === 0 && (
        <div style={{ padding: '20px 12px', fontSize: 11, color: 'rgba(0,0,0,0.35)', textAlign: 'center' }}>
          No berths defined yet
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Verify visually**

Start the dev server. Navigate to Infrastructure → Map Editor. Verify:
- Palette no longer shows a "Fuel Dock" drag item in the Docking category
- Any berths with `operational_type='fuel_dock'` in the unplaced sidebar appear with amber background + "Fuel Dock" sub-label
- Standard berths still appear with their blue background

- [ ] **Step 4: Commit**

```
git add frontend/src/components/harbor-map/mapBuilderPrefabs.js frontend/src/components/harbor-map/MapBuilderBerthPanel.jsx
git commit -m "feat(map-editor): remove fuel-dock prefab; amber label for fuel dock berths in sidebar"
```

---

## Task 6: Frontend Operations — fetch fuel berths from API + berth picker on "To Berth"

**Files:**
- Modify: `frontend/src/screens/Operations.jsx`

The Operations screen currently reads `marina.fuel_berths` (a JSON array of strings). This task replaces it with an API fetch of berths where `operational_type=fuel_dock`, and adds a berth picker when advancing a queue entry from `next` → `service`.

- [ ] **Step 1: Replace the full Operations.jsx content**

Replace `frontend/src/screens/Operations.jsx` with:

```jsx
import { useState } from 'react';
import useFuelQueue from '../hooks/useFuelQueue.js';
import useBerths from '../hooks/useBerths.js';
import useVessels from '../hooks/useVessels.js';
import StatusBadge from '../components/ui/Badge.jsx';
import Ic from '../components/ui/Icon.jsx';

const FUEL_DOCK_FILTER = { operational_type: 'fuel_dock' };

function AddQueueForm({ vessels, onAdd, onCancel }) {
  const [mode, setMode] = useState('stranger');
  const [form, setForm] = useState({
    vessel: '', guest_description: '', guest_phone: '',
    fuel_type: 'diesel', estimated_litres: '',
  });
  const [submitting, setSubmitting] = useState(false);

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  async function submit(e) {
    e.preventDefault();
    setSubmitting(true);
    const payload = {
      fuel_type:        form.fuel_type,
      estimated_litres: form.estimated_litres || null,
    };
    if (mode === 'member' && form.vessel) {
      const v = vessels.find(v => v.id === Number(form.vessel));
      payload.vessel = Number(form.vessel);
      if (v?.owner) payload.member = v.owner;
    } else {
      payload.guest_description = form.guest_description;
      payload.guest_phone       = form.guest_phone;
    }
    await onAdd(payload);
    setSubmitting(false);
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="modal-hdr">
          <span className="modal-title">Add to Queue</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}><Ic n="x" s={13}/></button>
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {[['member','Known Vessel'],['stranger','Free Text']].map(([v,l]) => (
            <button key={v} type="button" className={`btn ${mode === v ? 'btn-primary' : 'btn-ghost'} btn-sm`} onClick={() => setMode(v)}>{l}</button>
          ))}
        </div>
        <form onSubmit={submit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {mode === 'member' ? (
              <select className="input" value={form.vessel} onChange={e => set('vessel', e.target.value)} required>
                <option value="">Select vessel…</option>
                {vessels.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            ) : (
              <>
                <input className="input" placeholder='Description (e.g. "White Sailboat")' value={form.guest_description} onChange={e => set('guest_description', e.target.value)} />
                <input className="input" placeholder="Phone number" value={form.guest_phone} onChange={e => set('guest_phone', e.target.value)} />
              </>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <select className="input" value={form.fuel_type} onChange={e => set('fuel_type', e.target.value)}>
                <option value="diesel">Diesel</option>
                <option value="petrol">Petrol</option>
                <option value="pump_out">Pump-out</option>
              </select>
              <input className="input" placeholder="Est. litres" type="number" value={form.estimated_litres} onChange={e => set('estimated_litres', e.target.value)} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={submitting}>{submitting ? 'Adding…' : 'Add to Queue'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CompletionForm({ entry, onComplete, onCancel }) {
  const [litres, setLitres]  = useState('');
  const [price,  setPrice]   = useState('');
  const [saving, setSaving]  = useState(false);

  const preview = (litres && price) ? `€${(litres * price).toFixed(2)}` : '—';

  async function submit(e) {
    e.preventDefault();
    setSaving(true);
    await onComplete(entry.id, {
      status:          'completed',
      actual_litres:   litres,
      price_per_litre: price,
    });
    setSaving(false);
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <input className="input" placeholder="Actual litres" type="number" step="0.01" value={litres} onChange={e => setLitres(e.target.value)} style={{ width: 110 }} required />
      <input className="input" placeholder="€/litre" type="number" step="0.0001" value={price} onChange={e => setPrice(e.target.value)} style={{ width: 90 }} required />
      <span style={{ fontSize: 12, fontWeight: 700 }}>{preview}</span>
      <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Complete'}</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
    </form>
  );
}

function BerthPickerModal({ entry, fuelBerths, serviceEntries, onPick, onCancel }) {
  const occupiedIds = new Set(serviceEntries.map(e => e.fuel_berth).filter(Boolean));

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="dialog" aria-modal="true" onClick={e => e.stopPropagation()}>
        <div className="modal-hdr">
          <span className="modal-title">Assign to Fuel Berth</span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}><Ic n="x" s={13}/></button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '4px 0 8px' }}>
          {fuelBerths.length === 0 && (
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', fontStyle: 'italic' }}>
              No fuel dock berths configured. Add them in Harbor Infrastructure.
            </div>
          )}
          {fuelBerths.map(berth => {
            const occupied = occupiedIds.has(berth.id);
            return (
              <button
                key={berth.id}
                type="button"
                disabled={occupied}
                onClick={() => onPick(berth.id)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 14px', borderRadius: 6, cursor: occupied ? 'not-allowed' : 'pointer',
                  border: '1.5px solid rgba(0,0,0,0.12)',
                  background: occupied ? 'rgba(0,0,0,0.04)' : '#fff8e8',
                  opacity: occupied ? 0.6 : 1,
                  fontFamily: 'var(--font)',
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 13 }}>{berth.code}</span>
                {occupied
                  ? <span className="badge badge-teal">In Use</span>
                  : <span className="badge badge-green">Available</span>
                }
              </button>
            );
          })}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

function FuelDockTab() {
  const { queue, loading, addToQueue, advanceEntry, removeEntry } = useFuelQueue();
  const { vessels } = useVessels();
  const { berths: fuelBerths } = useBerths(FUEL_DOCK_FILTER);
  const [showAddForm,    setShowAddForm]    = useState(false);
  const [completingId,   setCompletingId]   = useState(null);
  const [berthPickingId, setBerthPickingId] = useState(null);

  const NEXT_LABEL = { waiting: 'Next', next: 'To Berth', service: 'Complete' };

  async function handleAdvance(entry) {
    if (entry.status === 'service') {
      setCompletingId(entry.id);
    } else if (entry.status === 'next') {
      setBerthPickingId(entry.id);
    } else {
      await advanceEntry(entry.id, { status: 'next' });
    }
  }

  async function handleBerthPick(berthId) {
    await advanceEntry(berthPickingId, { status: 'service', fuel_berth: berthId });
    setBerthPickingId(null);
  }

  async function handleComplete(id, patch) {
    await advanceEntry(id, patch);
    setCompletingId(null);
  }

  const serviceEntries = queue.filter(e => e.status === 'service');
  const berthPickingEntry = queue.find(e => e.id === berthPickingId);

  return (
    <div>
      <div className="sec-hdr">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="sec-hdr-title">Fuel Dock — Live Queue</div>
          <span className="badge badge-teal">{queue.filter(q => q.status === 'service').length} Fuelling</span>
          <span className="badge badge-gray">{queue.filter(q => q.status === 'waiting').length} Waiting</span>
          {queue.filter(q => q.status === 'next').length > 0 && (
            <span className="badge badge-gold">{queue.filter(q => q.status === 'next').length} Next</span>
          )}
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => setShowAddForm(v => !v)}>
          <Ic n="plus" s={11} />Add to Queue
        </button>
      </div>

      {showAddForm && (
        <AddQueueForm
          vessels={vessels}
          onAdd={async payload => { await addToQueue(payload); setShowAddForm(false); }}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {berthPickingEntry && (
        <BerthPickerModal
          entry={berthPickingEntry}
          fuelBerths={fuelBerths}
          serviceEntries={serviceEntries}
          onPick={handleBerthPick}
          onCancel={() => setBerthPickingId(null)}
        />
      )}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'rgba(0,0,0,0.35)', fontSize: 12 }}>Loading…</div>
      ) : (
        <div className="grid-2" style={{ alignItems: 'start' }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Fuel Dock Berths</div>
            {fuelBerths.length === 0 && (
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', fontStyle: 'italic', padding: '10px 0' }}>
                No fuel dock berths. Create berths with Classification → Operational → Fuel Dock in Harbor Infrastructure.
              </div>
            )}
            {fuelBerths.map(berth => {
              const occ = serviceEntries.find(e => e.fuel_berth === berth.id);
              return (
                <div key={berth.id} className="fuel-berth">
                  <div className="fuel-berth-id">{berth.code}</div>
                  {occ ? (
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700 }}>{occ.vessel_name || occ.guest_description}</div>
                        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)', marginTop: 2 }}>{occ.member_name || ''}</div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span className="badge badge-teal">{occ.fuel_type}</span>
                        <span className="badge badge-teal">Fuelling</span>
                      </div>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', fontStyle: 'italic' }}>Available</div>
                  )}
                </div>
              );
            })}
          </div>

          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Queue</div>
            {queue.length === 0 ? (
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', fontStyle: 'italic', padding: '12px 0' }}>Queue is empty.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {queue.map((q, idx) => (
                  <div key={q.id} className="card" style={{ padding: '12px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div className="lq-num">{idx + 1}</div>
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 700 }}>{q.vessel_name || q.guest_description}</div>
                          <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.4)' }}>
                            {q.member_name || q.guest_phone || ''}
                            {q.estimated_litres ? ` · ~${q.estimated_litres}L` : ''}
                            {q.fuel_berth_code ? ` · Berth ${q.fuel_berth_code}` : ''}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {q.fuel_type && <span className="badge badge-navy">{q.fuel_type}</span>}
                        <span className={`badge ${q.status === 'service' ? 'badge-teal' : q.status === 'next' ? 'badge-gold' : 'badge-gray'}`}>{q.status}</span>
                        {q.status !== 'completed' && (
                          <button className="btn btn-primary btn-sm" onClick={() => handleAdvance(q)}>
                            {NEXT_LABEL[q.status]}
                          </button>
                        )}
                        <button className="btn btn-ghost btn-sm" onClick={() => removeEntry(q.id)} title="Remove from queue">
                          <Ic n="x" s={11} />
                        </button>
                      </div>
                    </div>
                    {completingId === q.id && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid rgba(0,0,0,0.08)' }}>
                        <CompletionForm
                          entry={q}
                          onComplete={handleComplete}
                          onCancel={() => setCompletingId(null)}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function Operations() {
  const [tab, setTab] = useState('fueldock');

  return (
    <div>
      <div className="tabs">
        {[['fueldock', 'Fuel Dock']].map(([v, l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>{l}</div>
        ))}
      </div>
      {tab === 'fueldock' && <FuelDockTab />}
    </div>
  );
}
```

- [ ] **Step 2: Verify visually**

Start the dev server. Navigate to Operations → Fuel Dock.

- Right panel "Fuel Dock Berths" now shows berths fetched from API (empty if none created yet, with instructional message)
- Create a fuel dock berth in Infrastructure first if needed
- Add an entry to the queue; advance to "Next"; click "To Berth" → `BerthPickerModal` appears showing available fuel dock berths
- Select a berth; entry advances to "service" and the right panel shows the vessel at that berth
- The queue card now shows "Berth FD1" (or whatever code) in the sub-line

- [ ] **Step 3: Commit**

```
git add frontend/src/screens/Operations.jsx
git commit -m "feat(operations): fetch fuel berths from API and add berth picker on advancement"
```

---

## Task 7: Frontend LiveMap — fueling overlay

**Files:**
- Modify: `frontend/src/components/harbor-map/LiveMap.jsx`

- [ ] **Step 1: Add fuel entries state and fetcher to LiveMap**

After the existing `const [berths, setBerths] = useState([])` state, add:

```javascript
  const [fuelEntries, setFuelEntries] = useState([])

  const fetchFuelEntries = useCallback(async () => {
    try {
      const { data } = await api.get('/fuel-dock/queue/', { params: { active: 1 } })
      setFuelEntries(data.results ?? data)
    } catch { /* non-fatal — map still works without fueling overlay */ }
  }, [])
```

Add `useCallback` to the import at the top of the file:
```javascript
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
```

- [ ] **Step 2: Fetch fuel entries on mount and include in the poll interval**

After the existing WebSocket `useEffect`, add a mount-time fetch:

```javascript
  useEffect(() => { fetchFuelEntries() }, [fetchFuelEntries])
```

Update the existing polling `useEffect` to also refresh fuel entries:

```javascript
  useEffect(() => {
    const timer = setInterval(() => {
      if (!wsConnected.current) refetchBerths()
      fetchFuelEntries()
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refetchBerths, fetchFuelEntries])
```

- [ ] **Step 3: Add FUELING_COLOR constant and update buildLiveShapes**

After the `STATUS_COLORS` constant, add:

```javascript
const FUELING_COLOR = { fill: 'rgba(240,160,32,0.35)', stroke: '#c87010' }
```

Replace the `buildLiveShapes` function signature and berth mapping to accept and use `fuelEntries`:

```javascript
function buildLiveShapes(piers, berths, envItems, fuelEntries) {
  const pierById = Object.fromEntries(piers.map(p => [p.id, p]))

  const serviceFuelByBerthId = Object.fromEntries(
    fuelEntries
      .filter(e => e.status === 'service' && e.fuel_berth != null)
      .map(e => [e.fuel_berth, e])
  )

  const pierShapes = piers
    .filter(p => p.canvas_x != null)
    .map(p => ({
      id: `pier-${p.id}`, type: 'pier',
      absX: parseFloat(p.canvas_x), absY: parseFloat(p.canvas_y),
      w: p.canvas_w, h: p.canvas_h, rotation: p.rotation,
      fill: '#c8b97a', stroke: '#a8994a', label: p.code,
      meta: { pierId: p.id },
    }))

  const berthShapes = berths
    .filter(b => b.pier && b.local_x != null && pierById[b.pier])
    .map(b => {
      const pier = pierById[b.pier]
      const { absX, absY } = computeAbsPosition(
        { canvas_x: parseFloat(pier.canvas_x), canvas_y: parseFloat(pier.canvas_y), rotation: pier.rotation },
        { local_x: parseFloat(b.local_x), local_y: parseFloat(b.local_y) }
      )
      const fuelEntry = serviceFuelByBerthId[b.id]
      const col = fuelEntry
        ? FUELING_COLOR
        : (STATUS_COLORS[b.effective_status ?? b.status] ?? STATUS_COLORS.available)
      const { berthW, berthH } = berthCanvasDims(b, pier)
      const label = fuelEntry
        ? (fuelEntry.vessel_name || fuelEntry.guest_description || b.code)
        : b.code
      return {
        id: `berth-${b.id}`, type: 'berth',
        absX, absY,
        w: berthW, h: berthH, rotation: 0,
        fill: col.fill, stroke: col.stroke,
        label,
        meta: { berthId: b.id, berthData: b, fuelEntry: fuelEntry ?? null },
      }
    })

  const envShapes = (envItems ?? []).map(item => {
    if (item.isPolygon) return { ...item, fill: item.bg, stroke: item.border }
    return { ...item, absX: item.gx + item.w / 2, absY: item.gy + item.h / 2, fill: item.bg, stroke: item.border }
  })

  return sortItemsForRender([...envShapes, ...pierShapes, ...berthShapes])
}
```

- [ ] **Step 4: Pass fuelEntries to buildLiveShapes in the useMemo**

Find the existing `shapes` useMemo:

```javascript
  const shapes = useMemo(
    () => buildLiveShapes(piers, berths, envItems),
    [piers, berths, envItems]
  )
```

Replace with:

```javascript
  const shapes = useMemo(
    () => buildLiveShapes(piers, berths, envItems, fuelEntries),
    [piers, berths, envItems, fuelEntries]
  )
```

- [ ] **Step 5: Add fuel type to the berth click hover info in BerthDetailPanel (informational)**

The `meta.fuelEntry` is now available on the shape when a berth is being fueled. The existing `BerthDetailPanel` receives `berth={selectedBerth}` which is `item.meta.berthData`. No change needed in the panel itself — the amber color and label change on the canvas are sufficient for the LiveMap requirement. The fuel type is visible in Operations.

- [ ] **Step 6: Verify visually**

Start the dev server. Ensure there is at least one fuel dock berth in Infrastructure and one active queue entry at `status='service'` assigned to that berth (use Operations to create one).

Open the LiveMap (Marina Map screen). Verify:
- The fueling berth renders with amber fill and gold stroke
- The berth label shows the vessel name or guest description instead of the berth code
- After the 30s poll (or navigate away and back), the state reflects current fueling

- [ ] **Step 7: Commit**

```
git add frontend/src/components/harbor-map/LiveMap.jsx
git commit -m "feat(livemap): overlay amber color and vessel name on berths with active fueling"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Section 1 (Data Model): Berth new fields (Task 1), FuelDockEntry FK (Task 3)
- ✅ Section 2 (Harbor Infrastructure UI): Classification section in BerthDetailModal + BulkCreateModal (Task 4)
- ✅ Section 3 (Map Editor): Fuel dock prefab removed (Task 5), amber berths in sidebar (Task 5)
- ✅ Section 4 (Operations Tab): API fetch for fuel berths, berth picker, fuel_berth ID matching (Task 6)
- ✅ Section 5 (LiveMap): Amber overlay, vessel label, service-only trigger, 30s poll (Task 7)
- ✅ Section 6 (API Changes): operational_type filter (Task 2), fuel_berth FK + fuel_berth_code (Task 3)
- ✅ Section 7 (Migration Notes): berth_class/operational_type migration (Task 1), fuel_berth FK migration (Task 3)
- ✅ Section 8 (Out of Scope): pump-out, WebSocket, marina.fuel_berths cleanup deferred — not included

**No placeholders found.**

**Type consistency:**
- `fuel_berth` on entries = integer FK ID throughout (Operations and LiveMap both compare `e.fuel_berth === berth.id`)
- `fuel_berth_code` read-only string for display in queue card sub-line
- `operational_type='fuel_dock'` string used consistently in filter params and berth checks
- `FUELING_COLOR` defined before `buildLiveShapes` uses it
- `serviceFuelByBerthId` keyed by integer berth ID, matching `b.id` which is also integer ✅
