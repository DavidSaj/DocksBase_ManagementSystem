# Map Editor Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix five map editor bugs/UX issues and introduce LogicalPier as a named organisational entity, with compound docks stored as a single Pier DB record with UUID-keyed components.

**Architecture:** Backend adds `LogicalPier` model and extends `Pier`/`Berth` with three new fields; `PierDetailView` gains component-UUID cascade to orphan berths on component deletion. Frontend compound-dock drops produce one API call (not N), `snapBerthToPier` applies rotation-aware offset math per component, and `CanvasCore` renders each component as its own hit-testable rect.

**Tech Stack:** Django REST Framework (Python), React 18, Vitest, SVG canvas, Axios (`api.js`).

---

## File Map

| File | Change |
|------|--------|
| `backend/apps/berths/models.py` | Add `LogicalPier`; extend `Pier` + `Berth` |
| `backend/apps/berths/migrations/0025_logical_pier.py` | New migration |
| `backend/apps/berths/serializers.py` | `LogicalPierSerializer`; update `PierSerializer` |
| `backend/apps/berths/views.py` | `LogicalPierListCreateView`, `LogicalPierDetailView`; update `PierDetailView` |
| `backend/apps/berths/urls.py` | Wire new views |
| `backend/apps/berths/tests/test_logical_pier.py` | New test file |
| `frontend/src/components/harbor-map/mapBuilderUtils.js` | Adaptive `snapToGrid`; compound `snapBerthToPier` |
| `frontend/src/components/harbor-map/mapBuilderPrefabs.js` | `fingerW` scaling |
| `frontend/src/components/harbor-map/CanvasCore.jsx` | Adaptive cursor dot |
| `frontend/src/components/harbor-map/MapBuilder.jsx` | Overflow fix; compound drop; auto-open panel; label resolution |
| `frontend/src/components/harbor-map/LogicalPierDropdown.jsx` | New component |
| `frontend/src/hooks/useLogicalPiers.js` | New hook |
| `frontend/src/screens/Infrastructure.jsx` | Replace `PiersTable` with `LogicalPiersTable` |
| `frontend/src/components/harbor-map/__tests__/mapBuilderUtils.test.js` | Update + extend tests |

---

## Task 1: LogicalPier model + Pier/Berth field migrations

**Files:**
- Modify: `backend/apps/berths/models.py`
- Create: `backend/apps/berths/migrations/0025_logical_pier.py` (auto-generated)

- [ ] **Step 1: Add LogicalPier + new fields to models.py**

In `backend/apps/berths/models.py`, insert after `PIER_TYPE_CHOICES` list and before `OTAConnection`:

```python
class LogicalPier(models.Model):
    marina     = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='logical_piers')
    name       = models.CharField(max_length=100)
    pier_type  = models.CharField(max_length=20, choices=PIER_TYPE_CHOICES, default='pontoon')
    notes      = models.TextField(blank=True)

    class Meta:
        unique_together = ('marina', 'name')
        ordering = ['name']

    def __str__(self):
        return f'{self.name} ({self.marina})'
```

Then in `class Pier(models.Model)`, add after the `rotation` field:

```python
    display_name  = models.CharField(max_length=100, blank=True, default='')
    logical_pier  = models.ForeignKey(
        LogicalPier, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='dock_shapes'
    )
    components    = models.JSONField(default=list)
    # components format: [{"id": "c_9f8a2", "type": "spine"|"finger", "ox": 0, "oy": 0, "w": 10, "h": 2}]
    # ox/oy = offset from pier canvas_x/canvas_y at rotation=0 (grid units, center-based)
```

Then in `class Berth(models.Model)`, replace the existing `position_on_parent` field:

```python
    # OLD: position_on_parent = models.JSONField(null=True, blank=True)
    position_on_parent = models.CharField(max_length=50, blank=True, default='')
    # For compound piers: stores component UUID (e.g. "c_1b3e7")
    # For simple piers: empty string
```

- [ ] **Step 2: Generate and review migration**

```bash
cd backend
python manage.py makemigrations berths --name logical_pier
```

Open the generated file and verify it:
- Creates `LogicalPier` table
- Adds `display_name`, `logical_pier`, `components` to `berths_pier`
- Alters `position_on_parent` on `berths_berth` from JSONField → CharField
- Includes a `RunPython` step that sets all existing `position_on_parent` values to `''`

If the data migration step is missing, add it manually:

```python
def reset_position_on_parent(apps, schema_editor):
    Berth = apps.get_model('berths', 'Berth')
    Berth.objects.update(position_on_parent='')

class Migration(migrations.Migration):
    # ... add to operations list:
    migrations.RunPython(reset_position_on_parent, migrations.RunPython.noop),
```

- [ ] **Step 3: Apply migration**

```bash
python manage.py migrate berths
```

Expected: `Applying berths.0025_logical_pier... OK`

- [ ] **Step 4: Commit**

```bash
git add backend/apps/berths/models.py backend/apps/berths/migrations/0025_logical_pier.py
git commit -m "feat: add LogicalPier model and extend Pier/Berth fields"
```

---

## Task 2: LogicalPier serializer + update PierSerializer

**Files:**
- Modify: `backend/apps/berths/serializers.py`

- [ ] **Step 1: Write the failing test**

Create `backend/apps/berths/tests/__init__.py` (empty) and `backend/apps/berths/tests/test_logical_pier.py`:

```python
from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from apps.accounts.models import Marina
from apps.berths.models import LogicalPier, Pier

User = get_user_model()


class LogicalPierSerializerTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='mgr@example.com', password='pass', marina=self.marina
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_pier_serializer_includes_logical_pier_name(self):
        lp = LogicalPier.objects.create(marina=self.marina, name='Pier A', pier_type='pontoon')
        pier = Pier.objects.create(
            marina=self.marina, code='P1', pier_type='pontoon',
            canvas_x=10, canvas_y=10, logical_pier=lp,
        )
        resp = self.client.get(f'/api/v1/piers/{pier.id}/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['logical_pier_id'], lp.id)
        self.assertEqual(resp.data['logical_pier_name'], 'Pier A')

    def test_pier_serializer_includes_display_name_and_components(self):
        pier = Pier.objects.create(
            marina=self.marina, code='P2', pier_type='pontoon',
            canvas_x=5, canvas_y=5,
            display_name='North Dock',
            components=[{'id': 'c_abc', 'type': 'spine', 'ox': 0, 'oy': 0, 'w': 10, 'h': 2}],
        )
        resp = self.client.get(f'/api/v1/piers/{pier.id}/')
        self.assertEqual(resp.data['display_name'], 'North Dock')
        self.assertEqual(len(resp.data['components']), 1)
        self.assertEqual(resp.data['components'][0]['id'], 'c_abc')
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend
python manage.py test apps.berths.tests.test_logical_pier.LogicalPierSerializerTest -v 2
```

Expected: FAIL — `KeyError: 'logical_pier_id'`

- [ ] **Step 3: Add LogicalPierSerializer and update PierSerializer**

In `backend/apps/berths/serializers.py`, add at the top (after imports):

```python
from .models import Pier, Berth, MarinaMapConfig, Amenity, OTAConnection, BerthCategory, LogicalPier, AMENITY_SLUGS
```

Add `LogicalPierSerializer` before `PierSerializer`:

```python
class LogicalPierSerializer(serializers.ModelSerializer):
    dock_shapes_count = serializers.SerializerMethodField()
    berths_count      = serializers.SerializerMethodField()

    class Meta:
        model  = LogicalPier
        fields = ['id', 'name', 'pier_type', 'notes', 'dock_shapes_count', 'berths_count']
        read_only_fields = ['id', 'dock_shapes_count', 'berths_count']

    def get_dock_shapes_count(self, obj):
        return obj.dock_shapes.count()

    def get_berths_count(self, obj):
        return Berth.objects.filter(pier__logical_pier=obj).count()
```

Replace the existing `PierSerializer` with:

```python
class PierSerializer(serializers.ModelSerializer):
    logical_pier_name = serializers.CharField(source='logical_pier.name', read_only=True, default=None)

    class Meta:
        model = Pier
        fields = [
            'id', 'code', 'label', 'display_name', 'polygon_points', 'pier_type', 'ghost_slots',
            'canvas_x', 'canvas_y', 'canvas_w', 'canvas_h', 'rotation',
            'logical_pier', 'logical_pier_name', 'components',
        ]
        read_only_fields = ['id', 'logical_pier_name']

    def validate_ghost_slots(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('ghost_slots must be a list.')
        for slot in value:
            if not isinstance(slot, dict):
                raise serializers.ValidationError('Each ghost slot must be an object.')
            missing = _GHOST_SLOT_KEYS - slot.keys()
            if missing:
                raise serializers.ValidationError(f'Ghost slot missing keys: {missing}.')
            for key in _GHOST_SLOT_KEYS:
                if not isinstance(slot[key], (int, float)):
                    raise serializers.ValidationError(f'Ghost slot field "{key}" must be numeric.')
        return value

    def validate_components(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('components must be a list.')
        for comp in value:
            if not isinstance(comp, dict):
                raise serializers.ValidationError('Each component must be an object.')
            required = {'id', 'type', 'ox', 'oy', 'w', 'h'}
            missing = required - comp.keys()
            if missing:
                raise serializers.ValidationError(f'Component missing keys: {missing}.')
        return value
```

Also update `BerthSerializer` — the `position_on_parent` field is already in `fields`, but now it's a CharField. No change needed in the serializer class itself; Django REST Framework handles the type automatically.

- [ ] **Step 4: Run test to verify it passes**

```bash
python manage.py test apps.berths.tests.test_logical_pier.LogicalPierSerializerTest -v 2
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/apps/berths/serializers.py backend/apps/berths/tests/
git commit -m "feat: add LogicalPierSerializer and extend PierSerializer"
```

---

## Task 3: LogicalPier CRUD views + URLs

**Files:**
- Modify: `backend/apps/berths/views.py`
- Modify: `backend/apps/berths/urls.py`

- [ ] **Step 1: Write failing tests**

Add to `backend/apps/berths/tests/test_logical_pier.py`:

```python
class LogicalPierViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='mgr@example.com', password='pass', marina=self.marina
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_create_logical_pier(self):
        resp = self.client.post('/api/v1/logical-piers/', {
            'name': 'North Dock', 'pier_type': 'pontoon', 'notes': ''
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['name'], 'North Dock')
        self.assertEqual(LogicalPier.objects.filter(marina=self.marina).count(), 1)

    def test_list_logical_piers_scoped_to_marina(self):
        other_marina = Marina.objects.create(name='Other Marina')
        LogicalPier.objects.create(marina=self.marina, name='My Pier', pier_type='concrete')
        LogicalPier.objects.create(marina=other_marina, name='Other Pier', pier_type='concrete')
        resp = self.client.get('/api/v1/logical-piers/')
        self.assertEqual(resp.status_code, 200)
        names = [lp['name'] for lp in (resp.data.get('results') or resp.data)]
        self.assertIn('My Pier', names)
        self.assertNotIn('Other Pier', names)

    def test_delete_logical_pier_unassigns_dock_shapes(self):
        lp = LogicalPier.objects.create(marina=self.marina, name='Pier A', pier_type='pontoon')
        pier = Pier.objects.create(
            marina=self.marina, code='P1', pier_type='pontoon',
            canvas_x=10, canvas_y=10, logical_pier=lp,
        )
        resp = self.client.delete(f'/api/v1/logical-piers/{lp.id}/')
        self.assertEqual(resp.status_code, 204)
        pier.refresh_from_db()
        self.assertIsNone(pier.logical_pier)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python manage.py test apps.berths.tests.test_logical_pier.LogicalPierViewTest -v 2
```

Expected: FAIL — `404 Not Found` (URL not registered)

- [ ] **Step 3: Add views**

In `backend/apps/berths/views.py`, add after the `BerthCategoryViewSet` import in the models import line:

```python
from .models import Pier, Berth, MarinaMapConfig, Amenity, OTAConnection, BerthCategory, LogicalPier
from .serializers import (
    PierSerializer, BerthSerializer, MarinaMapConfigSerializer, AmenitySerializer,
    OTAConnectionSerializer, BerthCategorySerializer, LogicalPierSerializer,
)
```

Then add these two view classes before `BroadcastSMSView`:

```python
class LogicalPierListCreateView(generics.ListCreateAPIView):
    serializer_class = LogicalPierSerializer

    def get_queryset(self):
        return LogicalPier.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class LogicalPierDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = LogicalPierSerializer

    def get_queryset(self):
        return LogicalPier.objects.filter(marina=self.request.user.marina)
```

- [ ] **Step 4: Wire URLs**

In `backend/apps/berths/urls.py`, add the two imports and two paths:

```python
from .views import (
    PierListCreateView, PierDetailView,
    BerthListCreateView, BerthDetailView,
    MapConfigView,
    BulkCreateBerthsView,
    BulkUpdateBerthPricingView,
    BulkUpdateBerthCategoryView,
    BroadcastSMSView,
    AmenityListCreateView, AmenityDetailView,
    IcalFeedView,
    OTAConnectionViewSet,
    BerthCategoryViewSet,
    LogicalPierListCreateView, LogicalPierDetailView,
)

urlpatterns = [
    path('piers/', PierListCreateView.as_view(), name='pier_list'),
    path('piers/<int:pk>/', PierDetailView.as_view(), name='pier_detail'),
    path('logical-piers/', LogicalPierListCreateView.as_view(), name='logical_pier_list'),
    path('logical-piers/<int:pk>/', LogicalPierDetailView.as_view(), name='logical_pier_detail'),
    # ... rest of existing paths unchanged
]
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
python manage.py test apps.berths.tests.test_logical_pier.LogicalPierViewTest -v 2
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add backend/apps/berths/views.py backend/apps/berths/urls.py backend/apps/berths/tests/test_logical_pier.py
git commit -m "feat: add LogicalPier CRUD endpoints"
```

---

## Task 4: PierDetailView — component UUID cascade

**Files:**
- Modify: `backend/apps/berths/views.py`

When a `PATCH /piers/{id}/` payload includes a `components` array, find any component UUIDs that were removed and unplace all berths whose `position_on_parent` matches.

- [ ] **Step 1: Write failing test**

Add to `backend/apps/berths/tests/test_logical_pier.py`:

```python
from apps.berths.models import Berth

class PierComponentCascadeTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='mgr@example.com', password='pass', marina=self.marina
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_removing_component_unplaces_attached_berths(self):
        pier = Pier.objects.create(
            marina=self.marina, code='FD1', pier_type='pontoon',
            canvas_x=10, canvas_y=10,
            components=[
                {'id': 'c_finger1', 'type': 'finger', 'ox': -5, 'oy': 3, 'w': 2, 'h': 6},
                {'id': 'c_finger2', 'type': 'finger', 'ox':  5, 'oy': 3, 'w': 2, 'h': 6},
            ],
        )
        berth_a = Berth.objects.create(
            marina=self.marina, code='A1', pier=pier,
            local_x=-6.0, local_y=3.0, position_on_parent='c_finger1',
        )
        berth_b = Berth.objects.create(
            marina=self.marina, code='A2', pier=pier,
            local_x=6.0, local_y=3.0, position_on_parent='c_finger2',
        )
        # Remove c_finger1, keep c_finger2
        resp = self.client.patch(f'/api/v1/piers/{pier.id}/', {
            'components': [
                {'id': 'c_finger2', 'type': 'finger', 'ox': 5, 'oy': 3, 'w': 2, 'h': 6},
            ]
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        berth_a.refresh_from_db()
        berth_b.refresh_from_db()
        # A1 was on c_finger1 — now unplaced
        self.assertIsNone(berth_a.pier)
        self.assertEqual(berth_a.position_on_parent, '')
        self.assertIsNone(berth_a.local_x)
        # A2 was on c_finger2 — still placed
        self.assertEqual(berth_b.pier, pier)

    def test_patching_pier_without_components_key_does_not_touch_berths(self):
        pier = Pier.objects.create(
            marina=self.marina, code='FD2', pier_type='pontoon',
            canvas_x=10, canvas_y=10,
            components=[{'id': 'c_spine', 'type': 'spine', 'ox': 0, 'oy': 0, 'w': 10, 'h': 2}],
        )
        berth = Berth.objects.create(
            marina=self.marina, code='B1', pier=pier,
            local_x=2.0, local_y=0.0, position_on_parent='c_spine',
        )
        # PATCH only canvas position — no components key
        resp = self.client.patch(f'/api/v1/piers/{pier.id}/', {
            'canvas_x': '15.00', 'canvas_y': '15.00'
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        berth.refresh_from_db()
        self.assertEqual(berth.pier, pier)  # untouched
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
python manage.py test apps.berths.tests.test_logical_pier.PierComponentCascadeTest -v 2
```

Expected: FAIL — berth_a.pier is not None after the patch

- [ ] **Step 3: Override update in PierDetailView**

Replace `class PierDetailView` in `backend/apps/berths/views.py`:

```python
class PierDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = PierSerializer

    def get_queryset(self):
        return Pier.objects.filter(marina=self.request.user.marina)

    def update(self, request, *args, **kwargs):
        from django.db import transaction
        instance = self.get_object()
        partial = kwargs.pop('partial', False)
        serializer = self.get_serializer(instance, data=request.data, partial=partial)
        serializer.is_valid(raise_exception=True)

        new_components = serializer.validated_data.get('components')
        if new_components is not None:
            old_ids = {c['id'] for c in (instance.components or [])}
            new_ids = {c['id'] for c in new_components}
            removed_ids = old_ids - new_ids
            if removed_ids:
                with transaction.atomic():
                    Berth.objects.filter(
                        pier=instance,
                        position_on_parent__in=removed_ids,
                    ).update(
                        pier=None,
                        position_on_parent='',
                        local_x=None,
                        local_y=None,
                    )
                    serializer.save()
                return Response(serializer.data)

        serializer.save()
        return Response(serializer.data)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
python manage.py test apps.berths.tests.test_logical_pier -v 2
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/apps/berths/views.py backend/apps/berths/tests/test_logical_pier.py
git commit -m "feat: cascade berth unplacement when pier component UUID removed"
```

---

## Task 5: Frontend bug fixes (overflow, grid snap, cursor dot, finger width)

**Files:**
- Modify: `frontend/src/components/harbor-map/MapBuilder.jsx`
- Modify: `frontend/src/components/harbor-map/mapBuilderUtils.js`
- Modify: `frontend/src/components/harbor-map/CanvasCore.jsx`
- Modify: `frontend/src/components/harbor-map/mapBuilderPrefabs.js`
- Modify: `frontend/src/components/harbor-map/__tests__/mapBuilderUtils.test.js`

- [ ] **Step 1: Write failing tests for adaptive snapToGrid**

Add to the `describe('snapToGrid', ...)` block in `mapBuilderUtils.test.js`:

```js
describe('snapToGrid adaptive zoom', () => {
  it('snaps to 1 GU at normal zoom (0.15+)', () => {
    // zoom=1, GRID=32: mouse at 48px → gx = round(48/1/32) = round(1.5) = 2
    expect(snapToGrid(48, 48, rect, 1)).toEqual({ gx: 2, gy: 2 })
  })
  it('snaps to 2 GU at zoom 0.1 (between 0.07 and 0.15)', () => {
    // zoom=0.1: gx = round(64 / 0.1 / 32 / 2) * 2 = round(10) * 2 = 20
    expect(snapToGrid(64, 64, rect, 0.1).gx % 2).toBe(0)
  })
  it('snaps to 5 GU at zoom 0.05 (below 0.07)', () => {
    const result = snapToGrid(100, 100, rect, 0.05)
    expect(result.gx % 5).toBe(0)
    expect(result.gy % 5).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend
npx vitest run src/components/harbor-map/__tests__/mapBuilderUtils.test.js
```

Expected: 2–3 FAIL in `snapToGrid adaptive zoom`

- [ ] **Step 3: Update snapToGrid in mapBuilderUtils.js**

Replace the existing `snapToGrid` function:

```js
export function snapToGrid(clientX, clientY, canvasRect, zoom = 1) {
  const snapGrid = zoom < 0.07 ? 5 : zoom < 0.15 ? 2 : 1
  const gx = Math.round((clientX - canvasRect.left) / zoom / GRID / snapGrid) * snapGrid
  const gy = Math.round((clientY - canvasRect.top)  / zoom / GRID / snapGrid) * snapGrid
  return {
    gx: Math.max(0, Math.min(COLS - 1, gx)),
    gy: Math.max(0, Math.min(ROWS - 1, gy)),
  }
}
```

- [ ] **Step 4: Fix draw cursor snap in MapBuilder.jsx**

In `MapBuilder.jsx`, find `handleCanvasPointerMove` (~line 616). Replace the draw-mode cursor update block:

```js
// OLD:
setDrawCursor({
  gx: Math.max(0, Math.min(COLS - 1, Math.round((e.clientX - rect.left) / zoom / GRID))),
  gy: Math.max(0, Math.min(ROWS - 1, Math.round((e.clientY - rect.top)  / zoom / GRID))),
})

// NEW — use snapToGrid so draw cursor respects the adaptive snap:
setDrawCursor(snapToGrid(e.clientX, e.clientY, rect, viewRef.current.zoom))
```

Also add `snapToGrid` to the import from `'./mapBuilderUtils.js'` if it isn't already destructured there (it already is on line 11).

- [ ] **Step 5: Fix overflow in MapBuilder.jsx**

Find the pan/zoom viewport `<div>` (~line 858). Change:

```js
// OLD:
overflow: isDrawMode ? 'visible' : 'hidden',

// NEW:
overflow: 'hidden',
```

- [ ] **Step 6: Fix cursor dot size in CanvasCore.jsx**

Find the draw cursor circle (~line 289). Change `r={5}` to:

```jsx
r={Math.max(5, Math.round(16 / zoom))}
```

The `zoom` prop is already available in the component signature — verify it's listed there.

- [ ] **Step 7: Fix fingerW scaling in mapBuilderPrefabs.js**

In `buildComboDockLayout`, replace:

```js
// OLD:
const fingerW       = 2

// NEW:
const fingerW       = Math.max(1, berthBeamGU)
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
npx vitest run src/components/harbor-map/__tests__/mapBuilderUtils.test.js
```

Expected: All tests PASS

- [ ] **Step 9: Commit**

```bash
git add frontend/src/components/harbor-map/mapBuilderUtils.js \
        frontend/src/components/harbor-map/mapBuilderPrefabs.js \
        frontend/src/components/harbor-map/CanvasCore.jsx \
        frontend/src/components/harbor-map/MapBuilder.jsx \
        frontend/src/components/harbor-map/__tests__/mapBuilderUtils.test.js
git commit -m "fix: draw overflow, adaptive grid snap, cursor dot size, finger width scaling"
```

---

## Task 6: Compound dock drop → single Pier record

**Files:**
- Modify: `frontend/src/components/harbor-map/mapBuilderPrefabs.js`
- Modify: `frontend/src/components/harbor-map/MapBuilder.jsx`

Currently, dropping a compound prefab calls `Promise.all(components.map(createPier))`. Change it to a single `createPier` call with the full `components` array.

- [ ] **Step 1: Update buildComboDockLayout to include UUIDs**

In `mapBuilderPrefabs.js`, update `buildComboDockLayout` to accept and return component UUIDs. The UUIDs are generated at call-time in `MapBuilder.jsx`, not here. The layout function stays as-is; the `MapBuilder.jsx` drop handler generates them.

No change needed to `buildComboDockLayout` itself — it already returns `components` without IDs, and the IDs will be added in the drop handler.

- [ ] **Step 2: Update compound drop handler in MapBuilder.jsx**

Find the compound drop block in `handleCanvasDrop` (~line 538):

```js
// REPLACE the entire compound block:
if (p.compound && p.components) {
  const suffix   = newId().slice(0, 3).toUpperCase()
  const pierType = p.material ?? 'pontoon'
  const created = await Promise.all(p.components.map((comp, i) =>
    createPier({
      code:      `${suffix}-${i}`,
      pier_type: pierType,
      canvas_x:  (gx + comp.ox).toFixed(2),
      canvas_y:  (gy + comp.oy).toFixed(2),
      canvas_w:  comp.canvas_w,
      canvas_h:  comp.canvas_h,
      rotation:  0,
    })
  ))
  pushUndo({ type: 'piers', ids: created.map(c => c.id) })
}
```

New code:

```js
if (p.compound && p.components) {
  const suffix   = newId().slice(0, 3).toUpperCase()
  const pierType = p.material ?? 'pontoon'
  const componentsWithIds = p.components.map(comp => ({
    id:   `c_${newId()}`,
    type: comp.pier_type === 'pontoon' ? 'spine' : 'finger',
    ox:   comp.ox - p.w / 2,   // convert from absolute layout offset to pier-center-relative
    oy:   comp.oy - p.h / 2,
    w:    comp.canvas_w,
    h:    comp.canvas_h,
  }))
  const created = await createPier({
    code:       suffix,
    pier_type:  pierType,
    canvas_x:   (gx + p.w / 2).toFixed(2),
    canvas_y:   (gy + p.h / 2).toFixed(2),
    canvas_w:   p.w,
    canvas_h:   p.h,
    rotation:   0,
    components: componentsWithIds,
  })
  pushUndo({ type: 'pier', id: created.id })
}
```

Note on `ox/oy` conversion: `buildComboDockLayout` returns component `ox/oy` as absolute offsets from the bounding box top-left corner. The Pier's `canvas_x/y` is the center of the bounding box. So the component's ox/oy relative to the pier center = `comp.ox - p.w/2` and `comp.oy - p.h/2`.

- [ ] **Step 3: Verify in browser**

Start the dev server:

```bash
cd frontend && npm run dev
```

Navigate to Settings → Map Editor. Build a "Combo Dock" from the palette and drag it onto the canvas. Open the Django admin or API at `/api/v1/piers/` and verify only **one** Pier record was created, with a non-empty `components` array.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/harbor-map/MapBuilder.jsx
git commit -m "feat: compound dock drop creates single Pier record with components JSON"
```

---

## Task 7: Update snapBerthToPier for compound piers

**Files:**
- Modify: `frontend/src/components/harbor-map/mapBuilderUtils.js`
- Modify: `frontend/src/components/harbor-map/__tests__/mapBuilderUtils.test.js`

The existing `snapBerthToPier` tests check `result.position_on_parent.side` (old JSONField format). After this task, simple piers return `position_on_parent: ''` and compound piers return `position_on_parent: 'c_uuid'`. Tests must be updated.

- [ ] **Step 1: Update existing tests for new position_on_parent format**

In `mapBuilderUtils.test.js`, find all `position_on_parent.side` and `position_on_parent.slot_index` assertions in `describe('snapBerthToPier', ...)` and update them:

```js
// OLD assertions to remove/change:
expect(result.position_on_parent.side).toBe('port')
expect(result.position_on_parent.side).toBe('starboard')
expect(result.position_on_parent.slot_index).toBe(0)

// NEW — simple piers return empty string:
expect(result.position_on_parent).toBe('')
```

The other assertions (pierId, berthW, berthH, etc.) remain unchanged.

Also add new compound pier snap tests:

```js
describe('snapBerthToPier compound piers', () => {
  // Compound pier: center at (20,20), rotation=0
  // Component c_f1: ox=-5, oy=3, w=2, h=6 → absX=15, absY=23
  const compoundPier = {
    id: 99,
    canvas_x: 20, canvas_y: 20,
    canvas_w: 12, canvas_h: 8,
    rotation: 0,
    components: [
      { id: 'c_f1', type: 'finger', ox: -5, oy: 3, w: 2, h: 6 },
      { id: 'c_f2', type: 'finger', ox:  5, oy: 3, w: 2, h: 6 },
    ],
  }

  it('returns null when mouse is far from all components', () => {
    expect(snapBerthToPier(0, 0, [compoundPier])).toBeNull()
  })

  it('snaps to component left edge and returns component UUID as position_on_parent', () => {
    // c_f1 absX=15, absY=23, w=2, h=6 → left edge = 15-1=14
    const result = snapBerthToPier(13, 23, [compoundPier])
    expect(result).not.toBeNull()
    expect(result.pierId).toBe(99)
    expect(result.position_on_parent).toBe('c_f1')
  })

  it('local_x/y are relative to pier origin, not component', () => {
    // c_f1 left edge abs = 14, snap absX = 14 - berthW/2
    // For vertical component (h>w): berthW=1, berthH=2
    // snapAbsX ≈ 13.5, local_x = snapAbsX - pier.canvas_x = 13.5 - 20 = -6.5
    const result = snapBerthToPier(13, 23, [compoundPier])
    expect(result).not.toBeNull()
    // local coords are relative to pier origin (20,20)
    expect(result.local_x).toBeCloseTo(result.absX - 20, 1)
    expect(result.local_y).toBeCloseTo(result.absY - 20, 1)
  })

  it('applies rotation when pier is rotated 90°', () => {
    // At 90°: c_f1 ox=-5,oy=3 → rotated: ox' = -5*cos90 - 3*sin90 = -3
    //                                      oy' = -5*sin90 + 3*cos90 = -5
    // compAbsX = 20 + (-3) = 17, compAbsY = 20 + (-5) = 15
    const rotatedPier = { ...compoundPier, rotation: 90 }
    const result = snapBerthToPier(16, 15, [rotatedPier])
    expect(result).not.toBeNull()
    expect(result.pierId).toBe(99)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend
npx vitest run src/components/harbor-map/__tests__/mapBuilderUtils.test.js
```

Expected: Several FAIL (old `position_on_parent.side` assertions now return `''`, new compound tests return null)

- [ ] **Step 3: Update snapBerthToPier in mapBuilderUtils.js**

Replace the entire `snapBerthToPier` function:

```js
export function snapBerthToPier(mouseGx, mouseGy, piers, berth = null) {
  for (const pier of piers) {
    const { canvas_x: cx, canvas_y: cy, components } = pier

    if (components?.length > 0) {
      // Compound pier — snap to individual component edges
      const θ = (pier.rotation * Math.PI) / 180
      const cosθ = Math.cos(θ)
      const sinθ = Math.sin(θ)

      for (const comp of components) {
        // Rotate component offset by pier angle
        const rotOx = comp.ox * cosθ - comp.oy * sinθ
        const rotOy = comp.ox * sinθ + comp.oy * cosθ

        const compAbsX = cx + rotOx
        const compAbsY = cy + rotOy
        const halfW = comp.w / 2
        const halfH = comp.h / 2
        const { berthW, berthH } = berth
          ? berthCanvasDims(berth, { canvas_w: comp.w, canvas_h: comp.h })
          : berthDimsForPier({ canvas_w: comp.w, canvas_h: comp.h })

        const snap = _snapToEdge(
          mouseGx, mouseGy, compAbsX, compAbsY, halfW, halfH, berthW, berthH
        )
        if (snap) {
          return {
            pierId: pier.id,
            position_on_parent: comp.id,
            // local_x/y relative to pier origin (not component)
            local_x:  snap.absX - cx,
            local_y:  snap.absY - cy,
            absX:     snap.absX,
            absY:     snap.absY,
            berthW,
            berthH,
          }
        }
      }
    } else {
      // Simple pier — existing behaviour
      const halfW = pier.canvas_w / 2
      const halfH = pier.canvas_h / 2
      const { berthW, berthH } = berth
        ? berthCanvasDims(berth, pier)
        : berthDimsForPier(pier)

      const snap = _snapToEdge(
        mouseGx, mouseGy, cx, cy, halfW, halfH, berthW, berthH
      )
      if (snap) {
        return {
          pierId: pier.id,
          position_on_parent: '',
          local_x:  snap.absX - cx,
          local_y:  snap.absY - cy,
          absX:     snap.absX,
          absY:     snap.absY,
          berthW,
          berthH,
        }
      }
    }
  }
  return null
}

// Internal helper: given a rectangular target (cx,cy,halfW,halfH), test if mouseGx/Gy
// is within SNAP_RADIUS of a port or starboard/top-bottom edge and return the snap position.
function _snapToEdge(mouseGx, mouseGy, cx, cy, halfW, halfH, berthW, berthH) {
  if (halfH >= halfW) {
    // Vertical element — snap to left (port) or right (starboard) edge
    const leftEdgeX  = cx - halfW
    const rightEdgeX = cx + halfW
    const withinHeight = mouseGy >= cy - halfH - SNAP_RADIUS && mouseGy <= cy + halfH + SNAP_RADIUS

    if (withinHeight) {
      if (Math.abs(mouseGx - leftEdgeX) <= SNAP_RADIUS) {
        const clampedY = Math.max(cy - halfH + berthH / 2, Math.min(cy + halfH - berthH / 2, mouseGy))
        return { absX: leftEdgeX - berthW / 2, absY: clampedY }
      }
      if (Math.abs(mouseGx - rightEdgeX) <= SNAP_RADIUS) {
        const clampedY = Math.max(cy - halfH + berthH / 2, Math.min(cy + halfH - berthH / 2, mouseGy))
        return { absX: rightEdgeX + berthW / 2, absY: clampedY }
      }
    }
  } else {
    // Horizontal element — snap to top or bottom edge
    const topEdgeY    = cy - halfH
    const bottomEdgeY = cy + halfH
    const withinWidth = mouseGx >= cx - halfW - SNAP_RADIUS && mouseGx <= cx + halfW + SNAP_RADIUS

    if (withinWidth) {
      if (Math.abs(mouseGy - topEdgeY) <= SNAP_RADIUS) {
        const clampedX = Math.max(cx - halfW + berthW / 2, Math.min(cx + halfW - berthW / 2, mouseGx))
        return { absX: clampedX, absY: topEdgeY - berthH / 2 }
      }
      if (Math.abs(mouseGy - bottomEdgeY) <= SNAP_RADIUS) {
        const clampedX = Math.max(cx - halfW + berthW / 2, Math.min(cx + halfW - berthW / 2, mouseGx))
        return { absX: clampedX, absY: bottomEdgeY + berthH / 2 }
      }
    }
  }
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/components/harbor-map/__tests__/mapBuilderUtils.test.js
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/harbor-map/mapBuilderUtils.js \
        frontend/src/components/harbor-map/__tests__/mapBuilderUtils.test.js
git commit -m "feat: snapBerthToPier supports compound pier components with rotation"
```

---

## Task 8: buildShapes + CanvasCore compound pier rendering

**Files:**
- Modify: `frontend/src/components/harbor-map/MapBuilder.jsx`

Compound piers must render as multiple component shapes, each with the correct hit area, so clicking empty water between fingers doesn't select the pier.

- [ ] **Step 1: Update buildShapes to expand compound piers**

In `MapBuilder.jsx`, replace the `pierShapes` section of `buildShapes`:

```js
function buildShapes(piers, berths, envItems, dragOverride) {
  const pierById = Object.fromEntries(piers.map(p => [p.id, p]))

  const pierShapes = []
  for (const p of piers) {
    if (p.canvas_x == null || p.canvas_y == null) continue
    const ov = dragOverride?.pierId === p.id ? dragOverride : null
    const { fill, stroke } = pierColors(p)
    const cx = ov ? ov.absX : parseFloat(p.canvas_x)
    const cy = ov ? ov.absY : parseFloat(p.canvas_y)
    const rot = p.rotation ?? 0
    const label = p.display_name || p.logical_pier_name || p.code

    if (p.components?.length > 0) {
      // Compound pier — one shape per component, each inheriting pier rotation
      const θ = (rot * Math.PI) / 180
      const cosθ = Math.cos(θ)
      const sinθ = Math.sin(θ)
      for (const comp of p.components) {
        const rotOx = comp.ox * cosθ - comp.oy * sinθ
        const rotOy = comp.ox * sinθ + comp.oy * cosθ
        pierShapes.push({
          id:       `pier-${p.id}-comp-${comp.id}`,
          _pierId:  p.id,
          _compId:  comp.id,
          type:     'pier',
          absX:     cx + rotOx,
          absY:     cy + rotOy,
          w:        ov?.w != null ? comp.w : comp.w,
          h:        ov?.h != null ? comp.h : comp.h,
          rotation: rot,
          fill,
          stroke,
          label:    comp.type === 'spine' ? label : '',
        })
      }
    } else {
      // Simple pier — single shape as before
      pierShapes.push({
        id:      `pier-${p.id}`,
        _pierId: p.id,
        type:    'pier',
        absX:    cx,
        absY:    cy,
        w:       ov?.w ?? p.canvas_w,
        h:       ov?.h ?? p.canvas_h,
        rotation: rot,
        fill,
        stroke,
        label,
      })
    }
  }

  // ... berth shapes and env shapes unchanged ...
```

- [ ] **Step 2: Update handleItemPointerDown to group-select compound piers**

Replace `handleItemPointerDown`:

```js
function handleItemPointerDown(e, item) {
  if (!item._pierId) return
  e.stopPropagation()
  e.currentTarget.setPointerCapture(e.pointerId)

  // Select all shapes belonging to the same pier (compound group)
  const groupIds = shapes.filter(s => s._pierId === item._pierId).map(s => s.id)
  setSelectedIds(new Set(groupIds))

  // Use any one shape's absX/absY as move start — all share the same pier
  moveRef.current = {
    pierId:       item._pierId,
    startAbsX:    item.absX,
    startAbsY:    item.absY,
    startClientX: e.clientX,
    startClientY: e.clientY,
    moved:        false,
  }
}
```

- [ ] **Step 3: Fix selectedShape and selectedPier to handle compound group selection**

After the `shapes` computed value (~line 365), update:

```js
const selectedShape = selectedIds.size > 0
  ? shapes.find(s => selectedIds.has(s.id))
  : null
const selectedPier = selectedShape?._pierId
  ? piers.find(p => p.id === selectedShape._pierId)
  : null
```

This is unchanged — it already finds the first matching shape. Works for both simple and compound piers.

- [ ] **Step 4: Verify in browser**

Open the map editor. Drop a combo dock. Click one of the fingers — all finger shapes should highlight. Drag the dock — the whole structure moves. Drag a single finger from the empty space (water) between fingers — no selection should trigger.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/harbor-map/MapBuilder.jsx
git commit -m "feat: expand compound piers into per-component shapes for accurate hit detection"
```

---

## Task 9: useLogicalPiers hook + LogicalPierDropdown component

**Files:**
- Create: `frontend/src/hooks/useLogicalPiers.js`
- Create: `frontend/src/components/harbor-map/LogicalPierDropdown.jsx`

- [ ] **Step 1: Create useLogicalPiers.js**

Create `frontend/src/hooks/useLogicalPiers.js`:

```js
import { useState, useEffect, useCallback } from 'react'
import api from '../api.js'

export default function useLogicalPiers() {
  const [logicalPiers, setLogicalPiers] = useState([])
  const [loading,      setLoading]      = useState(true)

  const fetchLogicalPiers = useCallback(async () => {
    try {
      setLoading(true)
      const { data } = await api.get('/logical-piers/')
      setLogicalPiers(data.results ?? data)
    } catch (e) {
      console.error('[useLogicalPiers]', e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchLogicalPiers() }, [fetchLogicalPiers])

  async function createLogicalPier(attrs) {
    const { data } = await api.post('/logical-piers/', attrs)
    setLogicalPiers(prev => [...prev, data])
    return data
  }

  return { logicalPiers, loading, refetch: fetchLogicalPiers, createLogicalPier }
}
```

- [ ] **Step 2: Create LogicalPierDropdown.jsx**

Create `frontend/src/components/harbor-map/LogicalPierDropdown.jsx`:

```jsx
import { useState } from 'react'

export default function LogicalPierDropdown({ value, logicalPiers, onSelect, onCreate }) {
  const [showCreate, setShowCreate] = useState(false)
  const [newName,    setNewName]    = useState('')
  const [newType,    setNewType]    = useState('pontoon')
  const [creating,   setCreating]   = useState(false)

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true)
    try {
      const created = await onCreate({ name: newName.trim(), pier_type: newType, notes: '' })
      onSelect(created)
      setShowCreate(false)
      setNewName('')
    } finally {
      setCreating(false)
    }
  }

  const labelStyle = { fontSize: 10, color: 'rgba(0,0,0,0.4)', fontWeight: 600, letterSpacing: '0.5px', marginBottom: 3 }

  return (
    <div>
      <div style={labelStyle}>ASSIGN PIER</div>
      <select
        className="field-input"
        style={{ fontSize: 12, marginBottom: showCreate ? 8 : 0 }}
        value={value ?? ''}
        onChange={e => {
          if (e.target.value === '__create__') { setShowCreate(true); return }
          onSelect(logicalPiers.find(lp => lp.id === Number(e.target.value)) ?? null)
          setShowCreate(false)
        }}
      >
        <option value="">— Unassigned —</option>
        {logicalPiers.map(lp => (
          <option key={lp.id} value={lp.id}>{lp.name}</option>
        ))}
        <option value="__create__">+ Create new pier…</option>
      </select>

      {showCreate && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '8px 10px', background: 'var(--bg)', borderRadius: 6, border: '1px solid rgba(0,0,0,0.09)' }}>
          <input
            className="field-input"
            style={{ fontSize: 12 }}
            placeholder="Pier name (e.g. North Dock)"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate() }}
            autoFocus
          />
          <select
            className="field-input"
            style={{ fontSize: 12 }}
            value={newType}
            onChange={e => setNewType(e.target.value)}
          >
            <option value="pontoon">Pontoon</option>
            <option value="concrete">Concrete</option>
            <option value="steel">Steel</option>
          </select>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="btn btn-primary btn-sm"
              style={{ flex: 1, fontSize: 11 }}
              onClick={handleCreate}
              disabled={creating || !newName.trim()}
            >
              {creating ? 'Creating…' : 'Create'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 11 }}
              onClick={() => { setShowCreate(false); setNewName('') }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useLogicalPiers.js \
        frontend/src/components/harbor-map/LogicalPierDropdown.jsx
git commit -m "feat: useLogicalPiers hook and LogicalPierDropdown component"
```

---

## Task 10: SelectedItemPanel — Name + Assign Pier + auto-open on drop

**Files:**
- Modify: `frontend/src/components/harbor-map/MapBuilder.jsx`

Three changes: (1) extend `SelectedItemPanel` with Name and Assign Pier fields; (2) auto-open the panel after any successful drop; (3) update `buildShapes` label to resolve `display_name → logical_pier_name → code`.

- [ ] **Step 1: Import useLogicalPiers and LogicalPierDropdown in MapBuilder.jsx**

At the top of `MapBuilder.jsx`, add:

```js
import useLogicalPiers from '../../hooks/useLogicalPiers.js'
import LogicalPierDropdown from './LogicalPierDropdown.jsx'
```

Inside the `MapBuilder` component, add the hook call alongside the other hooks:

```js
const { logicalPiers, createLogicalPier, refetch: refetchLogicalPiers } = useLogicalPiers()
```

- [ ] **Step 2: Extend SelectedItemPanel**

Replace the `SelectedItemPanel` component definition. The new version adds `displayName`, `logicalPierId`, `logicalPiers`, `onNameBlur`, `onAssignPier` props:

```jsx
function SelectedItemPanel({ shape, pier, logicalPiers, onRotate, onDelete, onResize, onClose, onNameBlur, onAssignPier }) {
  const [w, setW] = useState(Math.round(shape.w * 10) / 10)
  const [h, setH] = useState(Math.round(shape.h * 10) / 10)
  const [name, setName] = useState(pier?.display_name ?? '')
  useEffect(() => {
    setW(Math.round(shape.w * 10) / 10)
    setH(Math.round(shape.h * 10) / 10)
    setName(pier?.display_name ?? '')
  }, [shape.id, shape.w, shape.h, pier?.display_name])

  const rot      = shape.rotation ?? 0
  const pierType = pier?.pier_type ?? shape.type
  const isCompound = pier?.components?.length > 0

  const row   = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }
  const label = { fontSize: 10, color: 'rgba(0,0,0,0.4)', fontWeight: 600, letterSpacing: '0.5px' }
  const rotBtn = {
    width: 32, height: 32, borderRadius: 6, border: '1px solid rgba(0,0,0,0.15)',
    background: 'var(--white)', cursor: 'pointer', fontSize: 16, display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  }

  return (
    <div style={{
      position: 'absolute', top: 12, right: 12, zIndex: 20,
      background: '#fff', borderRadius: 10, padding: '14px 16px',
      boxShadow: '0 4px 20px rgba(0,0,0,0.18)', width: 220,
      border: '1px solid rgba(0,0,0,0.09)', fontSize: 12,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'rgba(0,0,0,0.85)' }}>
            {pier?.display_name || pier?.logical_pier_name || pier?.code || 'Dock'}
          </div>
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginTop: 2, textTransform: 'capitalize' }}>
            {pierType.replace(/-/g, ' ')}
          </div>
        </div>
        <button onClick={onClose} style={{
          background: 'none', border: 'none', cursor: 'pointer', fontSize: 18,
          color: 'rgba(0,0,0,0.3)', lineHeight: 1, padding: '0 2px',
        }}>×</button>
      </div>

      {/* Name */}
      <div style={{ marginBottom: 10 }}>
        <div style={label}>NAME</div>
        <input
          className="field-input"
          style={{ fontSize: 12, marginTop: 4, width: '100%', boxSizing: 'border-box' }}
          placeholder="e.g. North Dock"
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={() => onNameBlur(name)}
        />
      </div>

      {/* Assign Pier */}
      <div style={{ marginBottom: 10 }}>
        <LogicalPierDropdown
          value={pier?.logical_pier ?? null}
          logicalPiers={logicalPiers}
          onSelect={lp => onAssignPier(lp?.id ?? null)}
          onCreate={async attrs => {
            const created = await onAssignPier.__createPier(attrs)
            return created
          }}
        />
      </div>

      {/* Rotation */}
      <div style={{ marginBottom: 10 }}>
        <div style={label}>ROTATION</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <button style={rotBtn} onClick={() => onRotate(-10)} title="Rotate −10°">↺</button>
          <span style={{ flex: 1, textAlign: 'center', fontWeight: 600 }}>{rot}°</span>
          <button style={rotBtn} onClick={() => onRotate(+10)} title="Rotate +10°">↻</button>
        </div>
      </div>

      {/* Size — disabled for compound piers */}
      {!isCompound && (
        <div style={{ marginBottom: 12 }}>
          <div style={label}>SIZE (grid units)</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.45)', marginBottom: 2 }}>W</div>
              <input type="number" value={w} min={0.5} step={0.5}
                onChange={e => setW(parseFloat(e.target.value) || 1)}
                style={{ width: '100%', padding: '4px 6px', borderRadius: 5, border: '1px solid #ddd', fontSize: 12 }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 10, color: 'rgba(0,0,0,0.45)', marginBottom: 2 }}>H</div>
              <input type="number" value={h} min={0.5} step={0.5}
                onChange={e => setH(parseFloat(e.target.value) || 1)}
                style={{ width: '100%', padding: '4px 6px', borderRadius: 5, border: '1px solid #ddd', fontSize: 12 }} />
            </div>
            <button
              onClick={() => onResize(w, h)}
              style={{ padding: '5px 8px', borderRadius: 5, border: 'none', background: 'var(--navy,#1a3a5c)', color: '#fff', cursor: 'pointer', fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap' }}
            >Apply</button>
          </div>
        </div>
      )}

      {/* Delete */}
      <button onClick={onDelete} style={{
        width: '100%', padding: '7px', borderRadius: 6, border: '1px solid rgba(192,57,43,0.4)',
        background: 'rgba(192,57,43,0.06)', color: '#c0392b', cursor: 'pointer',
        fontSize: 12, fontWeight: 600,
      }}>
        Delete
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Add onNameBlur and onAssignPier handlers in MapBuilder**

Add two new handlers after `handleDeleteSelected`:

```js
async function handleNameBlur(name) {
  if (!selectedPier) return
  await patchPier(selectedPier.id, { display_name: name.trim() })
}

async function handleAssignPier(logicalPierId) {
  if (!selectedPier) return
  await patchPier(selectedPier.id, { logical_pier: logicalPierId })
}
// Attach createLogicalPier so LogicalPierDropdown can call it
handleAssignPier.__createPier = createLogicalPier
```

- [ ] **Step 4: Auto-open panel after drop**

In `handleCanvasDrop`, after any successful pier creation (both compound and simple paths), add:

```js
// After: pushUndo(...)
setSelectedIds(new Set(
  shapes
    .filter(s => s._pierId === created.id)
    .map(s => s.id)
    .concat([`pier-${created.id}`])  // fallback for immediate render
))
```

Note: shapes might not yet include the new pier (state update is async). Set selectedIds to `pier-${created.id}` as a pre-selection; when shapes re-renders with the new pier, the panel will appear.

Replace the simple prefab drop return path with:

```js
} else if (DOCKING_TYPES.has(p.type) || p.type.startsWith('custom-')) {
  const pier_type = p.material ?? PREFAB_TO_PIER_TYPE[p.type] ?? 'pontoon'
  const created = await createPier({
    code:      `${p.type.toUpperCase().slice(0,4)}-${newId().slice(0,4).toUpperCase()}`,
    pier_type,
    canvas_x:  (gx + p.w / 2).toFixed(2),
    canvas_y:  (gy + p.h / 2).toFixed(2),
    canvas_w:  p.w,
    canvas_h:  p.h,
    rotation:  0,
  })
  pushUndo({ type: 'pier', id: created.id })
  setSelectedIds(new Set([`pier-${created.id}`]))
}
```

And for the compound drop path, after `pushUndo`:

```js
setSelectedIds(new Set([`pier-${created.id}`]))
```

- [ ] **Step 5: Pass new props to SelectedItemPanel in the render**

Find the `<SelectedItemPanel` JSX and update:

```jsx
{selectedShape && selectedPier && !isDrawMode && (
  <SelectedItemPanel
    shape={selectedShape}
    pier={selectedPier}
    logicalPiers={logicalPiers}
    onRotate={handleRotateSelected}
    onResize={handleResizeSelected}
    onDelete={handleDeleteSelected}
    onClose={() => setSelectedIds(new Set())}
    onNameBlur={handleNameBlur}
    onAssignPier={handleAssignPier}
  />
)}
```

- [ ] **Step 6: Verify in browser**

Drop any prefab onto the canvas. The detail panel should open automatically. Enter a name and blur — the pier should be renamed. Select "Create new pier…" in the Assign Pier dropdown, enter a name, and click Create — the new logical pier should be selected immediately.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/harbor-map/MapBuilder.jsx
git commit -m "feat: auto-open detail panel on drop with Name and Assign Pier fields"
```

---

## Task 11: Infrastructure.jsx — repurpose Piers tab for LogicalPier management

**Files:**
- Modify: `frontend/src/screens/Infrastructure.jsx`

Replace the existing `PiersTable` (which shows canvas dock shapes) with a `LogicalPiersTable` that manages `LogicalPier` entities.

- [ ] **Step 1: Add imports**

At the top of `Infrastructure.jsx`, add:

```js
import useLogicalPiers from '../hooks/useLogicalPiers.js'
import api from '../api.js'
```

- [ ] **Step 2: Replace PiersTable with LogicalPiersTable**

Remove the existing `PiersTable` function entirely and replace with:

```jsx
function LogicalPiersTable() {
  const { logicalPiers, loading, refetch, createLogicalPier } = useLogicalPiers()
  const [showForm,  setShowForm]  = useState(false)
  const [formName,  setFormName]  = useState('')
  const [formType,  setFormType]  = useState('pontoon')
  const [formNotes, setFormNotes] = useState('')
  const [saving,    setSaving]    = useState(false)
  const [editId,    setEditId]    = useState(null)

  async function handleCreate() {
    if (!formName.trim()) return
    setSaving(true)
    try {
      await createLogicalPier({ name: formName.trim(), pier_type: formType, notes: formNotes })
      setShowForm(false); setFormName(''); setFormType('pontoon'); setFormNotes('')
    } finally { setSaving(false) }
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this pier? Dock shapes assigned to it will be unassigned.')) return
    await api.delete(`/logical-piers/${id}/`)
    refetch()
  }

  if (loading) return <div className="empty"><div className="empty-title">Loading…</div></div>

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button className="btn btn-primary btn-sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Cancel' : '+ New Pier'}
        </button>
      </div>

      {showForm && (
        <div className="card" style={{ padding: 16, marginBottom: 14, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 2 }}>
            <div className="field-label">Name</div>
            <input className="field-input" placeholder="e.g. Pier A" value={formName} onChange={e => setFormName(e.target.value)} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="field-label">Type</div>
            <select className="field-input" value={formType} onChange={e => setFormType(e.target.value)}>
              <option value="pontoon">Pontoon</option>
              <option value="concrete">Concrete</option>
              <option value="steel">Steel</option>
            </select>
          </div>
          <div style={{ flex: 2 }}>
            <div className="field-label">Notes (optional)</div>
            <input className="field-input" value={formNotes} onChange={e => setFormNotes(e.target.value)} />
          </div>
          <button className="btn btn-primary btn-sm" onClick={handleCreate} disabled={saving || !formName.trim()}>
            {saving ? 'Saving…' : 'Create'}
          </button>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: 'var(--border)', background: 'var(--bg)' }}>
              {['Name', 'Type', 'Dock Shapes', 'Berths', 'Notes', ''].map(h => (
                <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.45)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logicalPiers.map((lp, i) => (
              <tr key={lp.id} style={{ borderBottom: i < logicalPiers.length - 1 ? 'var(--border)' : 'none' }}
                onMouseEnter={e => e.currentTarget.style.background = '#fafaf9'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <td style={{ padding: '10px 14px', fontWeight: 600 }}>{lp.name}</td>
                <td style={{ padding: '10px 14px', color: 'rgba(0,0,0,0.55)', textTransform: 'capitalize' }}>{lp.pier_type}</td>
                <td style={{ padding: '10px 14px', color: 'rgba(0,0,0,0.55)' }}>{lp.dock_shapes_count}</td>
                <td style={{ padding: '10px 14px', color: 'rgba(0,0,0,0.55)' }}>{lp.berths_count}</td>
                <td style={{ padding: '10px 14px', color: 'rgba(0,0,0,0.4)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lp.notes || '—'}</td>
                <td style={{ padding: '10px 14px' }}>
                  <button
                    onClick={() => handleDelete(lp.id)}
                    style={{ fontSize: 11, padding: '3px 8px', borderRadius: 5, border: '1px solid rgba(192,57,43,0.35)', background: 'rgba(192,57,43,0.05)', color: '#c0392b', cursor: 'pointer' }}
                  >Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {logicalPiers.length === 0 && (
          <div className="empty">
            <div className="empty-title">No named piers yet</div>
            <div className="empty-sub">Create a pier here, then assign dock shapes to it from the Map Editor.</div>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Update the tab render**

In the `Infrastructure` component, change:

```jsx
{tab === 'piers'  && <PiersTable />}
```

to:

```jsx
{tab === 'piers'  && <LogicalPiersTable />}
```

- [ ] **Step 4: Remove usePiers import if it's now unused**

Check whether `usePiers` is still imported in `Infrastructure.jsx`. If `PiersTable` was the only consumer, remove that import.

- [ ] **Step 5: Verify in browser**

Navigate to Settings → Harbor Infrastructure → Piers tab. Create two logical piers ("Pier A", "Pier B"). Verify they appear in the table with dock shape counts. Delete one and confirm it disappears.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/Infrastructure.jsx frontend/src/hooks/useLogicalPiers.js
git commit -m "feat: replace Piers tab with LogicalPier management UI"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|-----------------|-----------|
| Draw mode overflow bug | Task 5 step 5 |
| Adaptive grid snap (zoom thresholds) | Task 5 steps 1–4 |
| Cursor dot size scales with zoom | Task 5 step 6 |
| Finger width scaling with berthBeamGU | Task 5 step 7 |
| LogicalPier model + migration | Task 1 |
| Pier.display_name / logical_pier / components fields | Task 1 |
| Berth.position_on_parent → CharField | Task 1 |
| LogicalPierSerializer with counts | Task 2 |
| PierSerializer exposes logical_pier_name | Task 2 |
| LogicalPier CRUD endpoints | Task 3 |
| Component UUID cascade on PATCH | Task 4 |
| Compound drop → single Pier record | Task 6 |
| snapBerthToPier rotation-aware component snap | Task 7 |
| local_x/y relative to pier origin | Task 7 |
| Compound pier = per-component shapes | Task 8 |
| Hit detection per component (not bounding box) | Task 8 |
| useLogicalPiers hook | Task 9 |
| LogicalPierDropdown with inline create | Task 9 |
| Auto-open panel on drop | Task 10 |
| Name field in panel | Task 10 |
| Assign Pier field in panel | Task 10 |
| Canvas label: display_name → logical_pier_name → code | Task 8 (buildShapes) |
| Infrastructure Piers tab → LogicalPier | Task 11 |

All spec requirements covered. ✓

**Type consistency check:**
- `position_on_parent` is a `CharField` throughout — no place returns `{side, slot_index}` after Task 7
- `pier.components` is always an array (`default=list`) — `?.length > 0` guard used everywhere
- `_pierId` is the DB pier `id` (integer) in all shape objects
- `snapBerthToPier` return: `{ pierId, position_on_parent, local_x, local_y, absX, absY, berthW, berthH }` — consistent with how it's consumed in `handleCanvasDrop`

**Placeholder scan:** No TBD, TODO, or "similar to task N" patterns. All code blocks are complete.
