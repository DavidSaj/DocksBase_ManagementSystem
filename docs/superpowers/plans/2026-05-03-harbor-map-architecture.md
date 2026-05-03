# Harbor Map Architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the harbor map into a Renderer/Controller pattern: one dumb `CanvasCore` SVG renderer shared by a `MapBuilder` layout controller and a `LiveMap` operational controller, with pier/berth canvas positions stored in the database using center-origin math.

**Architecture:** `CanvasCore.jsx` is a stateless SVG renderer that takes `shapes[]` and draws them. `MapBuilder.jsx` assembles shapes from API piers + berths + MarinaMapConfig env items and handles drag/drop. `LiveMap.jsx` assembles shapes with status colors and shows a `BerthDetailPanel` on berth click.

**Tech Stack:** React 19, Django 6, DRF, SVG, Vitest, pytest

---

## Working Directory

All code paths are relative to the worktree root:
`C:\Users\david\.config\superpowers\worktrees\DocksBase_ManagementSystem\feature-signup-onboarding`

---

## File Map

| Action | File |
|--------|------|
| Modify | `backend/apps/berths/models.py` |
| New migration | `backend/apps/berths/migrations/` (auto-generated) |
| Modify | `backend/apps/berths/serializers.py` |
| Modify | `backend/apps/berths/tests/test_pier_api.py` |
| New test | `backend/apps/berths/tests/test_berth_canvas.py` |
| Modify | `frontend/src/components/harbor-map/mapBuilderUtils.js` |
| Modify | `frontend/src/components/harbor-map/__tests__/mapBuilderUtils.test.js` |
| Create | `frontend/src/components/harbor-map/CanvasCore.jsx` |
| Create | `frontend/src/hooks/usePiers.js` |
| Modify | `frontend/src/components/harbor-map/MapBuilder.jsx` |
| Create | `frontend/src/components/harbor-map/BerthDetailPanel.jsx` |
| Create | `frontend/src/components/harbor-map/LiveMap.jsx` |
| Delete | `frontend/src/components/harbor-map/HarborMap.jsx` (replaced by LiveMap) |
| Delete | `frontend/src/components/harbor-map/MapBuilderCanvas.jsx` (replaced by CanvasCore) |
| Modify | Any route/page files that import `HarborMap` |

---

## Key Design Decisions

**Center-origin math:** `Pier.canvas_x/canvas_y` store the **center point** of the pier in grid units. `Berth.local_x/local_y` are measured from the pier's center. At render time the controller calls `computeAbsPosition(pier, berth)` to get each berth's absolute canvas center. CanvasCore never does coordinate math.

**What stays in MarinaMapConfig:** Environmental canvas items (water, shore, buildings, shapes, custom polygons) remain in `MarinaMapConfig.config.env_items`. Only "Docking" category prefabs become Pier DB records.

**Docking prefabs → Pier records:** When a prefab with `cat: 'Docking'` is dropped on the canvas, MapBuilder POSTs to `/api/v1/piers/` to create a DB record with `canvas_x/y/w/h/rotation`. Non-docking prefabs save to MarinaMapConfig as before.

**Berth "unplaced" state:** `Berth.pier = null` means the berth has no canvas position. The "Unplaced Berths" sidebar in MapBuilder shows all berths where `pier_id` is null.

**Design system colors (no raw blue hex):**

Builder mode berth fill/stroke:
```
fill:   rgba(26,107,110,0.25)   (matches --teal: #1a6b6e at 25% opacity)
stroke: #1a6b6e                  (var(--teal))
```

Viewer mode status colors (LiveMap):
```js
const STATUS_COLORS = {
  available:   { fill: 'rgba(26,140,46,0.2)',  stroke: '#1a8c2e' },  // var(--green)
  occupied:    { fill: 'rgba(0,117,222,0.2)',   stroke: '#0075de' },  // var(--blue)
  reserved:    { fill: 'rgba(221,91,0,0.2)',    stroke: '#dd5b00' },  // var(--orange)
  maintenance: { fill: 'rgba(192,57,43,0.2)',   stroke: '#c0392b' },  // var(--red)
}
```

---

## Task 1: Backend — Add Canvas Fields to Pier and Berth

**Files:**
- Modify: `backend/apps/berths/models.py`
- New: `backend/apps/berths/tests/test_berth_canvas.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/apps/berths/tests/test_berth_canvas.py
from django.test import TestCase
from apps.accounts.models import Marina, User
from apps.berths.models import Pier, Berth
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken


def make_user_with_marina(email='canvas@test.com'):
    marina = Marina.objects.create(name=f'Test Marina {email}')
    user = User.objects.create_user(email=email, password='testpass', marina=marina)
    return user, marina


def auth_client(user):
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return client


class PierCanvasFieldsTest(TestCase):
    def setUp(self):
        self.user, self.marina = make_user_with_marina()

    def test_pier_canvas_fields_default_to_null_and_zero(self):
        pier = Pier.objects.create(marina=self.marina, code='A')
        self.assertIsNone(pier.canvas_x)
        self.assertIsNone(pier.canvas_y)
        self.assertEqual(pier.canvas_w, 2)
        self.assertEqual(pier.canvas_h, 10)
        self.assertEqual(pier.rotation, 0)

    def test_berth_pier_nullable(self):
        # A berth with no pier (unplaced) must be creatable
        berth = Berth.objects.create(
            marina=self.marina,
            pier=None,
            code='X1',
        )
        self.assertIsNone(berth.pier)

    def test_berth_local_coords_default_null(self):
        berth = Berth.objects.create(marina=self.marina, pier=None, code='X2')
        self.assertIsNone(berth.local_x)
        self.assertIsNone(berth.local_y)
        self.assertIsNone(berth.position_on_parent)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python manage.py test apps.berths.tests.test_berth_canvas -v 2
```

Expected: FAIL — `TypeError` or `IntegrityError` because `pier` field is not nullable and canvas fields don't exist yet.

- [ ] **Step 3: Add canvas fields to models**

Open `backend/apps/berths/models.py`. Replace the `Pier` class with:

```python
class Pier(models.Model):
    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='piers')
    code           = models.CharField(max_length=10)
    label          = models.CharField(max_length=50, blank=True)
    polygon_points = models.JSONField(default=list)
    pier_type      = models.CharField(max_length=20, choices=PIER_TYPE_CHOICES, default='concrete')
    ghost_slots    = models.JSONField(default=list)
    # Canvas layout fields (center-origin, grid units)
    canvas_x = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    canvas_y = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    canvas_w = models.IntegerField(default=2)
    canvas_h = models.IntegerField(default=10)
    rotation = models.IntegerField(default=0)

    class Meta:
        unique_together = ('marina', 'code')
        ordering = ['code']

    def clean(self):
        from django.core.exceptions import ValidationError
        pts = self.polygon_points
        if pts:
            if not isinstance(pts, list) or len(pts) < 3:
                raise ValidationError({'polygon_points': 'A polygon requires at least 3 points.'})
            if not all(isinstance(p, (list, tuple)) and len(p) == 2 for p in pts):
                raise ValidationError({'polygon_points': 'Each point must be [x, y].'})

    def __str__(self):
        return f'{self.marina} — Pier {self.code}'
```

Replace the `Berth.pier` field line and add canvas fields:

```python
class Berth(models.Model):
    # ... STATUS_CHOICES, SIDE_CHOICES unchanged ...

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='berths')
    pier   = models.ForeignKey(Pier, on_delete=models.SET_NULL, related_name='berths',
                               null=True, blank=True)   # null = unplaced on canvas
    code           = models.CharField(max_length=10)
    side           = models.CharField(max_length=10, choices=SIDE_CHOICES, default='port')
    position_index = models.IntegerField(default=0)
    length_m       = models.DecimalField(max_digits=6, decimal_places=1, null=True, blank=True)
    max_draft_m    = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    max_beam_m     = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    amenities      = models.JSONField(default=list, blank=True)
    price_per_night = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    status  = models.CharField(max_length=20, choices=STATUS_CHOICES, default='available')
    vessel  = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL,
                                null=True, blank=True, related_name='current_berth')
    # Canvas layout fields (local to parent pier, grid units, center-based)
    local_x            = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    local_y            = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    position_on_parent = models.JSONField(null=True, blank=True)
    # position_on_parent format: {"side": "port"|"starboard", "slot_index": int}

    class Meta:
        unique_together = ('marina', 'code')
        ordering = ['pier__code', 'position_index']

    def __str__(self):
        return f'Berth {self.code} ({self.marina})'
```

- [ ] **Step 4: Generate and run the migration**

```bash
cd backend && python manage.py makemigrations berths --name add_canvas_fields
python manage.py migrate
```

Expected output: `Applying berths.XXXX_add_canvas_fields... OK`

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && python manage.py test apps.berths.tests.test_berth_canvas -v 2
```

Expected: 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/berths/models.py backend/apps/berths/migrations/ backend/apps/berths/tests/test_berth_canvas.py
git commit -m "feat(berths): add canvas position fields to Pier and Berth models"
```

---

## Task 2: Backend — Update Serializers to Expose Canvas Fields

**Files:**
- Modify: `backend/apps/berths/serializers.py`
- Modify: `backend/apps/berths/tests/test_berth_canvas.py`

- [ ] **Step 1: Add serializer tests**

Append to `backend/apps/berths/tests/test_berth_canvas.py`:

```python
class PierSerializerCanvasTest(TestCase):
    def setUp(self):
        self.user, self.marina = make_user_with_marina('serial@test.com')
        self.client = auth_client(self.user)

    def test_pier_api_returns_canvas_fields(self):
        resp = self.client.post('/api/v1/piers/', {
            'code': 'P1',
            'canvas_x': '5.50',
            'canvas_y': '8.00',
            'canvas_w': 1,
            'canvas_h': 8,
            'rotation': 0,
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data['canvas_x'], '5.50')
        self.assertEqual(data['canvas_y'], '8.00')
        self.assertEqual(data['canvas_w'], 1)
        self.assertEqual(data['canvas_h'], 8)

    def test_pier_canvas_position_patchable(self):
        pier = Pier.objects.create(marina=self.marina, code='P2')
        resp = self.client.patch(
            f'/api/v1/piers/{pier.id}/',
            {'canvas_x': '12.00', 'canvas_y': '6.50'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        pier.refresh_from_db()
        self.assertEqual(float(pier.canvas_x), 12.0)

    def test_berth_api_allows_null_pier(self):
        resp = self.client.post('/api/v1/berths/', {
            'code': 'B99',
            'pier': None,
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertIsNone(resp.json()['pier'])

    def test_berth_local_coords_patchable(self):
        pier = Pier.objects.create(marina=self.marina, code='P3',
                                   canvas_x='10', canvas_y='5')
        berth = Berth.objects.create(marina=self.marina, pier=None, code='B1')
        resp = self.client.patch(
            f'/api/v1/berths/{berth.id}/',
            {
                'pier': pier.id,
                'local_x': '-3.00',
                'local_y': '0.00',
                'position_on_parent': {'side': 'port', 'slot_index': 0},
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        berth.refresh_from_db()
        self.assertEqual(berth.pier_id, pier.id)
        self.assertEqual(float(berth.local_x), -3.0)
```

- [ ] **Step 2: Run new tests to verify they fail**

```bash
cd backend && python manage.py test apps.berths.tests.test_berth_canvas.PierSerializerCanvasTest -v 2
```

Expected: FAIL — canvas fields missing from serializer response or pier=None rejected.

- [ ] **Step 3: Update serializers**

Replace `backend/apps/berths/serializers.py` with:

```python
from rest_framework import serializers
from .models import Pier, Berth, MarinaMapConfig


class PierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Pier
        fields = [
            'id', 'code', 'label', 'polygon_points', 'pier_type', 'ghost_slots',
            'canvas_x', 'canvas_y', 'canvas_w', 'canvas_h', 'rotation',
        ]


class BerthSerializer(serializers.ModelSerializer):
    pier_code   = serializers.CharField(source='pier.code', read_only=True, default=None)
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, default=None)
    is_placed   = serializers.SerializerMethodField()

    class Meta:
        model = Berth
        fields = [
            'id', 'code', 'pier', 'pier_code', 'side', 'position_index',
            'length_m', 'max_draft_m', 'max_beam_m', 'amenities',
            'price_per_night', 'status', 'vessel', 'vessel_name',
            'local_x', 'local_y', 'position_on_parent', 'is_placed',
        ]
        read_only_fields = ['id', 'pier_code', 'vessel_name', 'is_placed']

    def get_is_placed(self, obj):
        return obj.pier_id is not None and obj.local_x is not None


class MarinaMapConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = MarinaMapConfig
        fields = ['config', 'updated_at']
        read_only_fields = ['updated_at']
```

- [ ] **Step 4: Add berth create endpoint (currently ListAPIView only)**

Open `backend/apps/berths/views.py`. Change `BerthListView` to `ListCreateAPIView`:

```python
class BerthListView(generics.ListCreateAPIView):
    serializer_class = BerthSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['status', 'pier']

    def get_queryset(self):
        return Berth.objects.filter(marina=self.request.user.marina).select_related('pier', 'vessel')

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)
```

- [ ] **Step 5: Run all berths tests**

```bash
cd backend && python manage.py test apps.berths -v 2
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/berths/serializers.py backend/apps/berths/views.py backend/apps/berths/tests/test_berth_canvas.py
git commit -m "feat(berths): expose canvas fields in serializers, allow null pier on berth"
```

---

## Task 3: Frontend — Center-Origin Coordinate Utilities

**Files:**
- Modify: `frontend/src/components/harbor-map/mapBuilderUtils.js`
- Modify: `frontend/src/components/harbor-map/__tests__/mapBuilderUtils.test.js`

- [ ] **Step 1: Write failing tests**

Append to `frontend/src/components/harbor-map/__tests__/mapBuilderUtils.test.js`:

```js
import { computeAbsPosition, snapBerthToPier } from '../mapBuilderUtils.js'

describe('computeAbsPosition', () => {
  it('returns pier center when local_x and local_y are both 0', () => {
    const pier = { canvas_x: 10, canvas_y: 5, rotation: 0 }
    const berth = { local_x: 0, local_y: 0 }
    const result = computeAbsPosition(pier, berth)
    expect(result.absX).toBeCloseTo(10)
    expect(result.absY).toBeCloseTo(5)
  })

  it('offsets berth correctly when rotation is 0', () => {
    const pier = { canvas_x: 10, canvas_y: 5, rotation: 0 }
    const berth = { local_x: 3, local_y: -2 }
    const result = computeAbsPosition(pier, berth)
    expect(result.absX).toBeCloseTo(13)
    expect(result.absY).toBeCloseTo(3)
  })

  it('rotates berth 90° correctly (local_x=3, local_y=0 → offset is 0,-3 relative to center)', () => {
    // 90° rotation: cos=0, sin=1
    // rotated_x = 3*0 - 0*1 = 0
    // rotated_y = 3*1 + 0*0 = 3
    const pier = { canvas_x: 10, canvas_y: 5, rotation: 90 }
    const berth = { local_x: 3, local_y: 0 }
    const result = computeAbsPosition(pier, berth)
    expect(result.absX).toBeCloseTo(10)
    expect(result.absY).toBeCloseTo(8)
  })

  it('rotates berth 180° flips both axes', () => {
    const pier = { canvas_x: 10, canvas_y: 5, rotation: 180 }
    const berth = { local_x: 3, local_y: 2 }
    const result = computeAbsPosition(pier, berth)
    expect(result.absX).toBeCloseTo(7)
    expect(result.absY).toBeCloseTo(3)
  })
})

describe('snapBerthToPier', () => {
  const pier = { id: 1, canvas_x: 10, canvas_y: 5, canvas_w: 2, canvas_h: 8, rotation: 0 }

  it('returns null when mouse is far from any pier', () => {
    expect(snapBerthToPier(0, 0, [pier], 2, 1)).toBeNull()
  })

  it('snaps to port side (left edge) when mouse is near left edge', () => {
    // Pier left edge absX = canvas_x - canvas_w/2 = 10 - 1 = 9
    // Hover at gx=8 (one unit left of left edge)
    const result = snapBerthToPier(8, 5, [pier], 2, 1)
    expect(result).not.toBeNull()
    expect(result.pierId).toBe(1)
    expect(result.position_on_parent.side).toBe('port')
  })

  it('snaps to starboard side (right edge) when mouse is near right edge', () => {
    // Pier right edge absX = canvas_x + canvas_w/2 = 10 + 1 = 11
    const result = snapBerthToPier(12, 5, [pier], 2, 1)
    expect(result).not.toBeNull()
    expect(result.position_on_parent.side).toBe('starboard')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd frontend && npx vitest run src/components/harbor-map/__tests__/mapBuilderUtils.test.js
```

Expected: FAIL — `computeAbsPosition` and `snapBerthToPier` are not exported.

- [ ] **Step 3: Implement the new utilities**

Append to the bottom of `frontend/src/components/harbor-map/mapBuilderUtils.js`:

```js
/**
 * Compute a berth's absolute canvas position (center, in grid units)
 * from its parent pier and local offset. Uses center-origin rotation math.
 * IMPORTANT: pier.canvas_x/y must be the pier's center, not its top-left.
 */
export function computeAbsPosition(pier, berth) {
  const θ = (pier.rotation * Math.PI) / 180
  const cos = Math.cos(θ)
  const sin = Math.sin(θ)
  const rx = berth.local_x * cos - berth.local_y * sin
  const ry = berth.local_x * sin + berth.local_y * cos
  return {
    absX: pier.canvas_x + rx,
    absY: pier.canvas_y + ry,
  }
}

// Snap radius in grid units — how close the mouse must be to a pier edge to trigger snap
const SNAP_RADIUS = 2

/**
 * Determine if a dragged berth should snap to a pier edge.
 * Returns snap data or null.
 * @param {number} mouseGx - Current drag position x in grid units
 * @param {number} mouseGy - Current drag position y in grid units
 * @param {Array}  piers   - Array of pier objects with canvas_x/y/w/h/rotation
 * @param {number} berthW  - Berth width in grid units
 * @param {number} berthH  - Berth height in grid units
 * @returns {{ pierId, local_x, local_y, position_on_parent } | null}
 */
export function snapBerthToPier(mouseGx, mouseGy, piers, berthW, berthH) {
  for (const pier of piers) {
    const { canvas_x: cx, canvas_y: cy, canvas_w: pw, canvas_h: ph } = pier
    const halfW = pw / 2
    const halfH = ph / 2

    // Check proximity to left edge (port side) — only for rotation=0 initially
    const leftEdgeX = cx - halfW
    const rightEdgeX = cx + halfW

    const withinHeight = mouseGy >= cy - halfH - SNAP_RADIUS && mouseGy <= cy + halfH + SNAP_RADIUS

    if (withinHeight) {
      if (Math.abs(mouseGx - leftEdgeX) <= SNAP_RADIUS) {
        const clampedY = Math.max(cy - halfH + berthH / 2, Math.min(cy + halfH - berthH / 2, mouseGy))
        const local_x = leftEdgeX - berthW / 2 - cx
        const local_y = clampedY - cy
        const slot_index = Math.round((clampedY - (cy - halfH)) / berthH)
        return {
          pierId: pier.id,
          local_x,
          local_y,
          absX: leftEdgeX - berthW / 2,
          absY: clampedY,
          position_on_parent: { side: 'port', slot_index },
        }
      }
      if (Math.abs(mouseGx - rightEdgeX) <= SNAP_RADIUS) {
        const clampedY = Math.max(cy - halfH + berthH / 2, Math.min(cy + halfH - berthH / 2, mouseGy))
        const local_x = rightEdgeX + berthW / 2 - cx
        const local_y = clampedY - cy
        const slot_index = Math.round((clampedY - (cy - halfH)) / berthH)
        return {
          pierId: pier.id,
          local_x,
          local_y,
          absX: rightEdgeX + berthW / 2,
          absY: clampedY,
          position_on_parent: { side: 'starboard', slot_index },
        }
      }
    }
  }
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd frontend && npx vitest run src/components/harbor-map/__tests__/mapBuilderUtils.test.js
```

Expected: all tests PASS including the new `computeAbsPosition` and `snapBerthToPier` suites.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/harbor-map/mapBuilderUtils.js frontend/src/components/harbor-map/__tests__/mapBuilderUtils.test.js
git commit -m "feat(map): add center-origin coordinate utilities (computeAbsPosition, snapBerthToPier)"
```

---

## Task 4: Frontend — usePiers Hook

**Files:**
- Create: `frontend/src/hooks/usePiers.js`

- [ ] **Step 1: Create the hook**

```js
// frontend/src/hooks/usePiers.js
import { useState, useEffect, useCallback } from 'react'
import api from '../api.js'

export default function usePiers() {
  const [piers,   setPiers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  const fetchPiers = useCallback(async () => {
    try {
      setLoading(true)
      const { data } = await api.get('/piers/')
      setPiers(data.results ?? data)
    } catch (e) {
      setError(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchPiers() }, [fetchPiers])

  async function createPier(attrs) {
    const { data } = await api.post('/piers/', attrs)
    setPiers(prev => [...prev, data])
    return data
  }

  async function updatePierCanvas(id, canvas_x, canvas_y, rotation = 0) {
    const { data } = await api.patch(`/piers/${id}/`, { canvas_x, canvas_y, rotation })
    setPiers(prev => prev.map(p => p.id === id ? data : p))
    return data
  }

  async function deletePier(id) {
    await api.delete(`/piers/${id}/`)
    setPiers(prev => prev.filter(p => p.id !== id))
  }

  return { piers, loading, error, refetch: fetchPiers, createPier, updatePierCanvas, deletePier }
}
```

- [ ] **Step 2: Start the dev server and verify the hook can fetch piers**

```bash
cd frontend && npm run dev
```

Open the app in a browser. Open DevTools → Network. Navigate to the harbor builder page. Confirm `GET /api/v1/piers/` returns a 200 with an array including the new canvas fields.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/usePiers.js
git commit -m "feat(map): add usePiers hook with canvas position update methods"
```

---

## Task 5: Frontend — CanvasCore.jsx (Dumb SVG Renderer)

**Files:**
- Create: `frontend/src/components/harbor-map/CanvasCore.jsx`

CanvasCore renders a `shapes[]` array. It knows nothing about piers, berths, bookings, or business state. Colors come in via `item.fill`/`item.stroke`.

- [ ] **Step 1: Create CanvasCore.jsx**

```jsx
// frontend/src/components/harbor-map/CanvasCore.jsx
import { GRID, COLS, ROWS, CW, CH } from './mapBuilderUtils.js'

/**
 * CanvasCore — dumb SVG renderer.
 *
 * shapes[] item contract:
 * {
 *   id:       string,
 *   type:     string,
 *   absX:     number,   // center x in grid units
 *   absY:     number,   // center y in grid units
 *   w:        number,   // width in grid units
 *   h:        number,   // height in grid units
 *   rotation: number,   // degrees
 *   fill:     string,   // CSS color or var(--token)
 *   stroke:   string,
 *   label:    string,
 *   meta:     object,   // opaque controller data
 * }
 *
 * mode='builder': shows drag handles, snap zone overlays
 * mode='viewer':  pointer cursor on berths, no edit affordances
 */
export default function CanvasCore({
  shapes = [],
  mode = 'viewer',
  snapZones = [],       // [{absX, absY, w, h}] — highlight these in builder mode
  selectedIds = new Set(),
  onItemClick,          // (e, item) => void
  onItemPointerDown,    // (e, item) => void  — builder only
  onRotateHandlePointerDown, // (e, item) => void  — builder only
  onCanvasPointerMove,
  onCanvasPointerUp,
  onCanvasClick,
  onCanvasDragOver,
  onCanvasDrop,
  onCanvasDragLeave,
  ghost,                // { absX, absY, w, h, fill, stroke } | null — drag preview
}) {
  return (
    <svg
      className="canvas-core"
      width={CW}
      height={CH}
      style={{ display: 'block', cursor: mode === 'builder' ? 'default' : 'default', flexShrink: 0 }}
      onClick={onCanvasClick}
      onPointerMove={onCanvasPointerMove}
      onPointerUp={onCanvasPointerUp}
      onDragOver={onCanvasDragOver}
      onDrop={onCanvasDrop}
      onDragLeave={onCanvasDragLeave}
    >
      {/* Grid */}
      <defs>
        <pattern id="ccMinorGrid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
          <path d={`M ${GRID} 0 L 0 0 0 ${GRID}`} fill="none" stroke="#1a3a55" strokeWidth={0.5} />
        </pattern>
        <pattern id="ccMajorGrid" width={GRID * 5} height={GRID * 5} patternUnits="userSpaceOnUse">
          <rect width={GRID * 5} height={GRID * 5} fill="url(#ccMinorGrid)" />
          <path d={`M ${GRID * 5} 0 L 0 0 0 ${GRID * 5}`} fill="none" stroke="#2a5a7a" strokeWidth={1} />
        </pattern>
      </defs>
      <rect width={CW} height={CH} fill="#0d2235" />
      <rect width={CW} height={CH} fill="url(#ccMajorGrid)" />

      {/* Shapes — rendered in array order (controller is responsible for layer ordering) */}
      {shapes.map(item => {
        const px = item.absX * GRID              // center in pixels
        const py = item.absY * GRID
        const pw = item.w * GRID
        const ph = item.h * GRID
        const rx = px - pw / 2                   // top-left in pixels
        const ry = py - ph / 2
        const selected = selectedIds.has(item.id)
        const isEditable = mode === 'builder'
        const isClickable = mode === 'viewer' && item.type === 'berth'

        return (
          <g
            key={item.id}
            transform={item.rotation ? `rotate(${item.rotation},${px},${py})` : undefined}
            onPointerDown={isEditable && onItemPointerDown ? e => onItemPointerDown(e, item) : undefined}
            onClick={isClickable && onItemClick ? e => onItemClick(e, item) : undefined}
            style={{ cursor: isEditable ? 'move' : (isClickable ? 'pointer' : 'default') }}
          >
            <rect
              x={rx} y={ry} width={pw} height={ph}
              fill={item.fill ?? '#888'}
              stroke={item.stroke ?? '#555'}
              strokeWidth={1.5}
              rx={2}
            />
            {item.label && (
              <text
                x={px} y={py}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={10} fill="rgba(255,255,255,0.75)"
                style={{ pointerEvents: 'none', userSelect: 'none' }}
                fontFamily="var(--font)"
              >
                {item.label}
              </text>
            )}
            {selected && (
              <rect
                x={rx} y={ry} width={pw} height={ph}
                fill="none" stroke="#b8965a" strokeWidth={2} rx={2}
                style={{ pointerEvents: 'none' }}
              />
            )}
          </g>
        )
      })}

      {/* Snap zone highlights — builder mode only */}
      {mode === 'builder' && snapZones.map((zone, i) => {
        const zx = zone.absX * GRID - (zone.w * GRID) / 2
        const zy = zone.absY * GRID - (zone.h * GRID) / 2
        return (
          <rect
            key={`snap-${i}`}
            x={zx} y={zy}
            width={zone.w * GRID} height={zone.h * GRID}
            fill="rgba(42,157,153,0.25)"
            stroke="#2a9d99"
            strokeWidth={1.5}
            strokeDasharray="4,3"
            rx={2}
            style={{ pointerEvents: 'none' }}
          />
        )
      })}

      {/* Rotation handles — builder mode, selected items */}
      {mode === 'builder' && shapes
        .filter(i => selectedIds.has(i.id))
        .map(item => {
          const px = item.absX * GRID
          const handleY = (item.absY - item.h / 2) * GRID - 16
          return (
            <g
              key={`rot-${item.id}`}
              onPointerDown={onRotateHandlePointerDown ? e => { e.stopPropagation(); onRotateHandlePointerDown(e, item) } : undefined}
              style={{ cursor: 'grab' }}
            >
              <circle cx={px} cy={handleY} r={8} fill="#b8965a" stroke="white" strokeWidth={1.5} />
              <text x={px} y={handleY} textAnchor="middle" dominantBaseline="middle"
                fontSize={10} fill="white" style={{ pointerEvents: 'none', userSelect: 'none' }}>↻</text>
            </g>
          )
        })
      }

      {/* Ghost element while dragging */}
      {ghost && (() => {
        const gx = ghost.absX * GRID - (ghost.w * GRID) / 2
        const gy = ghost.absY * GRID - (ghost.h * GRID) / 2
        return (
          <rect
            x={gx} y={gy}
            width={ghost.w * GRID} height={ghost.h * GRID}
            fill={ghost.fill ?? '#888'} fillOpacity={0.45}
            stroke={ghost.stroke ?? '#aaa'} strokeWidth={1.5}
            strokeDasharray="4,3" rx={2}
            style={{ pointerEvents: 'none' }}
          />
        )
      })()}
    </svg>
  )
}
```

- [ ] **Step 2: Verify no import errors**

```bash
cd frontend && npx vitest run --reporter=verbose 2>&1 | head -30
```

Expected: existing tests still pass, no import failures.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/harbor-map/CanvasCore.jsx
git commit -m "feat(map): add CanvasCore dumb SVG renderer (Renderer/Controller pattern)"
```

---

## Task 6: Frontend — Refactor MapBuilder.jsx

MapBuilder becomes a pure layout controller. It:
- Fetches piers from `/piers/` (DB) and env items from MarinaMapConfig
- Assembles `shapes[]` for CanvasCore from both sources
- On docking prefab drop → creates Pier DB record
- On pier move → PATCHes pier canvas position
- On berth drag to pier → PATCHes berth with local coords + pier FK
- On env prefab drop → saves to MarinaMapConfig (unchanged)
- Fixes berth colors to use design system (no more blue hex)

**Files:**
- Modify: `frontend/src/components/harbor-map/MapBuilder.jsx`

- [ ] **Step 1: Replace MapBuilder.jsx**

```jsx
// frontend/src/components/harbor-map/MapBuilder.jsx
import { useState, useEffect, useRef, useCallback } from 'react'
import useMapConfig from '../../hooks/useMapConfig.js'
import useBerths from '../../hooks/useBerths.js'
import usePiers from '../../hooks/usePiers.js'
import CanvasCore from './CanvasCore.jsx'
import MapBuilderPalette from './MapBuilderPalette.jsx'
import MapBuilderBerthPanel from './MapBuilderBerthPanel.jsx'
import {
  newId, snapToGrid, GRID, COLS, ROWS, rotateAndSnap, snapRotation,
  groupOrigin, sortItemsForRender, computeAbsPosition, snapBerthToPier,
} from './mapBuilderUtils.js'
import { PREFAB_BY_TYPE } from './mapBuilderPrefabs.js'
import api from '../../api.js'

// Docking prefab types that create Pier DB records when dropped
const DOCKING_TYPES = new Set([
  'parallel-wall', 'pier-v', 'pier-h', 'slip', 'slip-t', 'fuel-dock', 'gangway', 'ramp',
])

const TRANSPARENT_IMG = (() => {
  const img = new Image()
  img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
  return img
})()

// Build shapes[] for CanvasCore from piers (DB), berths (DB), and env items (MarinaMapConfig)
function buildShapes(piers, berths, envItems, selectedIds) {
  const pierById = Object.fromEntries(piers.map(p => [p.id, p]))

  // Pier shapes — center coords from DB
  const pierShapes = piers
    .filter(p => p.canvas_x != null && p.canvas_y != null)
    .map(p => ({
      id:       `pier-${p.id}`,
      _pierId:  p.id,
      type:     'pier',
      absX:     parseFloat(p.canvas_x),
      absY:     parseFloat(p.canvas_y),
      w:        p.canvas_w,
      h:        p.canvas_h,
      rotation: p.rotation,
      fill:     '#c8b97a',
      stroke:   '#a8994a',
      label:    p.code,
    }))

  // Berth shapes — position computed from parent pier
  const berthShapes = berths
    .filter(b => b.pier && b.local_x != null && pierById[b.pier])
    .map(b => {
      const pier = pierById[b.pier]
      const { absX, absY } = computeAbsPosition(
        { canvas_x: parseFloat(pier.canvas_x), canvas_y: parseFloat(pier.canvas_y), rotation: pier.rotation },
        { local_x: parseFloat(b.local_x), local_y: parseFloat(b.local_y) }
      )
      return {
        id:       `berth-${b.id}`,
        _berthId: b.id,
        type:     'berth',
        absX,
        absY,
        w:        2,
        h:        1,
        rotation: 0,
        fill:     'rgba(26,107,110,0.25)',
        stroke:   '#1a6b6e',
        label:    b.code,
      }
    })

  // Env shapes (non-DB items from MarinaMapConfig) — gx/gy are top-left, convert to center
  const envShapes = envItems.map(item => ({
    ...item,
    absX: item.gx + item.w / 2,
    absY: item.gy + item.h / 2,
    fill:   item.bg,
    stroke: item.border,
  }))

  return sortItemsForRender([...envShapes, ...pierShapes, ...berthShapes])
}

export default function MapBuilder() {
  const { config, loading: cfgLoading, saveConfig } = useMapConfig()
  const { berths, loading: berthsLoading, refetch: refetchBerths } = useBerths()
  const { piers, loading: piersLoading, createPier, updatePierCanvas, deletePier } = usePiers()

  const [envItems,      setEnvItems]      = useState([])
  const [customPrefabs, setCustomPrefabs] = useState([])
  const [selectedIds,   setSelectedIds]   = useState(new Set())
  const [ghost,         setGhost]         = useState(null)
  const [snapZones,     setSnapZones]     = useState([])
  const [saveStatus,    setSaveStatus]    = useState(null)
  const [canUndo,       setCanUndo]       = useState(false)

  const historyRef      = useRef([])
  const dragPayloadRef  = useRef(null)
  const moveRef         = useRef(null)
  const rotateRef       = useRef(null)

  useEffect(() => {
    if (!config) return
    if (config.env_items)      setEnvItems(config.env_items)
    if (config.custom_prefabs) setCustomPrefabs(config.custom_prefabs)
    // Legacy: migrate old custom_elements to env_items if present
    if (config.custom_elements && !config.env_items) {
      setEnvItems(config.custom_elements)
    }
  }, [config])

  const shapes = buildShapes(piers, berths, envItems, selectedIds)

  // ── Drag start ──────────────────────────────────────────────────────────────

  function handlePrefabDragStart(e, prefab) {
    dragPayloadRef.current = { kind: 'prefab', prefab }
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setDragImage(TRANSPARENT_IMG, 0, 0)
  }

  function handleBerthDragStart(e, berth) {
    dragPayloadRef.current = { kind: 'berth', berth }
    e.dataTransfer.effectAllowed = 'copy'
    e.dataTransfer.setDragImage(TRANSPARENT_IMG, 0, 0)
  }

  // ── Canvas drag over ─────────────────────────────────────────────────────────

  function handleCanvasDragOver(e) {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
    const payload = dragPayloadRef.current
    if (!payload) return

    const rect = e.currentTarget.getBoundingClientRect()
    const { gx, gy } = snapToGrid(e.clientX, e.clientY, rect)

    const w = payload.kind === 'prefab' ? payload.prefab.w : 2
    const h = payload.kind === 'prefab' ? payload.prefab.h : 1

    if (payload.kind === 'berth') {
      const placedPiers = piers.filter(p => p.canvas_x != null)
        .map(p => ({
          id: p.id,
          canvas_x: parseFloat(p.canvas_x),
          canvas_y: parseFloat(p.canvas_y),
          canvas_w: p.canvas_w,
          canvas_h: p.canvas_h,
          rotation: p.rotation,
        }))
      const snap = snapBerthToPier(gx, gy, placedPiers, w, h)
      if (snap) {
        setGhost({ absX: snap.absX, absY: snap.absY, w, h, fill: 'rgba(42,157,153,0.35)', stroke: '#2a9d99' })
        setSnapZones([{ absX: snap.absX, absY: snap.absY, w, h }])
        return
      }
      setSnapZones([])
    }

    const fill   = payload.kind === 'prefab' ? (payload.prefab.bg ?? '#888') : 'rgba(26,107,110,0.35)'
    const stroke = payload.kind === 'prefab' ? (payload.prefab.border ?? '#aaa') : '#1a6b6e'
    setGhost({ absX: gx + w / 2, absY: gy + h / 2, w, h, fill, stroke })
  }

  // ── Canvas drop ──────────────────────────────────────────────────────────────

  async function handleCanvasDrop(e) {
    e.preventDefault()
    const payload = dragPayloadRef.current
    dragPayloadRef.current = null
    if (!payload || !ghost) { setGhost(null); setSnapZones([]); return }

    if (payload.kind === 'berth') {
      const placedPiers = piers.filter(p => p.canvas_x != null)
        .map(p => ({
          id: p.id,
          canvas_x: parseFloat(p.canvas_x),
          canvas_y: parseFloat(p.canvas_y),
          canvas_w: p.canvas_w,
          canvas_h: p.canvas_h,
          rotation: p.rotation,
        }))
      const rect = e.currentTarget.getBoundingClientRect()
      const { gx, gy } = snapToGrid(e.clientX, e.clientY, rect)
      const snap = snapBerthToPier(gx, gy, placedPiers, 2, 1)
      if (snap) {
        await api.patch(`/berths/${payload.berth.id}/`, {
          pier: snap.pierId,
          local_x: snap.local_x.toFixed(2),
          local_y: snap.local_y.toFixed(2),
          position_on_parent: snap.position_on_parent,
        })
        await refetchBerths()
      }
      setGhost(null)
      setSnapZones([])
      return
    }

    // Prefab drop
    const p = payload.prefab
    const rect = e.currentTarget.getBoundingClientRect()
    const { gx, gy } = snapToGrid(e.clientX, e.clientY, rect)
    const dropCenterX = gx + p.w / 2
    const dropCenterY = gy + p.h / 2

    if (DOCKING_TYPES.has(p.type)) {
      // Creates a Pier DB record
      await createPier({
        code:     `${p.type.toUpperCase()}-${newId().slice(0, 4).toUpperCase()}`,
        pier_type: p.type === 'pier-v' || p.type === 'pier-h' ? 'concrete' : 'pontoon',
        canvas_x:  dropCenterX.toFixed(2),
        canvas_y:  dropCenterY.toFixed(2),
        canvas_w:  p.w,
        canvas_h:  p.h,
        rotation:  0,
      })
    } else {
      // Environmental item — goes to MarinaMapConfig
      const newItem = {
        id: newId(), type: p.type, shape: 'rect',
        gx, gy, w: p.w, h: p.h,
        bg: p.bg, border: p.border, label: p.label ?? '',
        rotation: 0,
      }
      historyRef.current = [...historyRef.current.slice(-19), envItems]
      setEnvItems(prev => [...prev, newItem])
      setCanUndo(true)
    }

    setGhost(null)
    setSnapZones([])
  }

  // ── Pointer events for moving pier shapes ────────────────────────────────────

  function handleItemPointerDown(e, item) {
    if (!item._pierId) return   // only piers are draggable in builder
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    setSelectedIds(new Set([item.id]))
    moveRef.current = {
      pierId: item._pierId,
      startAbsX: item.absX,
      startAbsY: item.absY,
      startClientX: e.clientX,
      startClientY: e.clientY,
      moved: false,
    }
  }

  function handleCanvasPointerMove(e) {
    if (!moveRef.current || e.buttons === 0) return
    const { startAbsX, startAbsY, startClientX, startClientY } = moveRef.current
    const dgx = (e.clientX - startClientX) / GRID
    const dgy = (e.clientY - startClientY) / GRID
    if (Math.abs(dgx) < 0.1 && Math.abs(dgy) < 0.1) return
    moveRef.current.moved = true
    // Live update: mutate piers state optimistically for smooth drag
    // (actual API call on pointer up)
    moveRef.current.liveX = startAbsX + dgx
    moveRef.current.liveY = startAbsY + dgy
    // Force re-render by triggering a state update
    setSelectedIds(prev => new Set(prev))
  }

  async function handleCanvasPointerUp() {
    if (moveRef.current?.moved && moveRef.current.pierId) {
      const { pierId, liveX, liveY } = moveRef.current
      await updatePierCanvas(pierId, liveX.toFixed(2), liveY.toFixed(2))
    }
    moveRef.current = null
  }

  // ── Undo (env items only) ────────────────────────────────────────────────────

  function handleUndo() {
    if (!historyRef.current.length) return
    setEnvItems(historyRef.current.pop())
    setCanUndo(historyRef.current.length > 0)
  }

  useEffect(() => {
    function onKey(e) {
      if (e.ctrlKey && e.key === 'z') handleUndo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── Save env items to MarinaMapConfig ───────────────────────────────────────

  async function handleSave() {
    setSaveStatus('saving')
    const ok = await saveConfig({ ...(config ?? {}), env_items: envItems, custom_prefabs: customPrefabs })
    setSaveStatus(ok ? 'saved' : 'error')
    setTimeout(() => setSaveStatus(null), 2500)
  }

  const saveLabel = saveStatus === 'saving' ? 'Saving…'
    : saveStatus === 'saved' ? '✓ Saved'
    : saveStatus === 'error' ? 'Error!'
    : 'Save'

  const placedBerthIds = new Set(berths.filter(b => b.is_placed).map(b => b.id))

  if (cfgLoading || berthsLoading || piersLoading) {
    return <div style={{ padding: 40, color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>Loading…</div>
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#0a1829' }}>
      <MapBuilderPalette
        customPrefabs={customPrefabs}
        selectedIds={selectedIds}
        drawMode={false}
        onPrefabDragStart={handlePrefabDragStart}
        onStartDraw={() => {}}
        onGroupToPrefab={() => {}}
      />

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'auto', position: 'relative' }}>
        <div style={{
          display: 'flex', gap: 8, padding: '8px 12px',
          background: '#0c1f3d', borderBottom: '1px solid #1e3a5f', alignItems: 'center',
        }}>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button
              onClick={handleUndo}
              disabled={!canUndo}
              style={{ fontSize: 11, padding: '4px 12px', background: '#1e3a5f', border: '1px solid #2a5a7a', borderRadius: 4, color: '#c8d8e8', cursor: 'pointer' }}
            >
              Undo
            </button>
            <button
              onClick={handleSave}
              style={{ fontSize: 11, padding: '4px 14px', background: '#b8965a', border: 'none', borderRadius: 4, color: 'white', cursor: 'pointer', fontWeight: 600 }}
            >
              {saveLabel}
            </button>
          </div>
        </div>

        <CanvasCore
          shapes={shapes}
          mode="builder"
          snapZones={snapZones}
          selectedIds={selectedIds}
          ghost={ghost}
          onItemPointerDown={handleItemPointerDown}
          onCanvasPointerMove={handleCanvasPointerMove}
          onCanvasPointerUp={handleCanvasPointerUp}
          onCanvasClick={() => setSelectedIds(new Set())}
          onCanvasDragOver={handleCanvasDragOver}
          onCanvasDrop={handleCanvasDrop}
          onCanvasDragLeave={() => { setGhost(null); setSnapZones([]) }}
        />
      </div>

      <MapBuilderBerthPanel
        berths={berths}
        placedBerthIds={placedBerthIds}
        onBerthDragStart={handleBerthDragStart}
      />
    </div>
  )
}
```

- [ ] **Step 2: Delete MapBuilderCanvas.jsx (superseded)**

```bash
rm frontend/src/components/harbor-map/MapBuilderCanvas.jsx
```

- [ ] **Step 3: Start dev server and test MapBuilder manually**

```bash
cd frontend && npm run dev
```

Navigate to Settings → Harbor Layout. Verify:
1. Existing env items still render
2. Dragging a "Pier (N–S)" prefab onto canvas creates a pier record (check Network tab for `POST /api/v1/piers/`)
3. Dragging a berth from the right panel and hovering over a pier shows a teal snap zone
4. Dropping the berth onto the pier snap zone calls `PATCH /api/v1/berths/<id>/` and the berth disappears from Unplaced Berths
5. Moving a pier moves it (check Network for `PATCH /api/v1/piers/<id>/`)
6. Berth colors are teal, not blue

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/harbor-map/MapBuilder.jsx
git rm frontend/src/components/harbor-map/MapBuilderCanvas.jsx
git commit -m "refactor(map): MapBuilder uses CanvasCore, piers/berths backed by API, fix colors"
```

---

## Task 7: Frontend — BerthDetailPanel.jsx

**Files:**
- Create: `frontend/src/components/harbor-map/BerthDetailPanel.jsx`

- [ ] **Step 1: Create BerthDetailPanel.jsx**

```jsx
// frontend/src/components/harbor-map/BerthDetailPanel.jsx
import { useState, useEffect } from 'react'
import api from '../../api.js'

export default function BerthDetailPanel({ berth, onClose }) {
  const [booking, setBooking] = useState(null)
  const [loadingBooking, setLoadingBooking] = useState(false)

  useEffect(() => {
    if (!berth) { setBooking(null); return }
    if (!['occupied', 'reserved'].includes(berth.status)) { setBooking(null); return }

    setLoadingBooking(true)
    api.get('/bookings/', { params: { berth: berth.id, status: 'checked_in' } })
      .then(({ data }) => {
        const results = data.results ?? data
        setBooking(results[0] ?? null)
      })
      .catch(() => setBooking(null))
      .finally(() => setLoadingBooking(false))
  }, [berth?.id])

  if (!berth) return null

  const statusColors = {
    available:   '#1a8c2e',
    occupied:    '#0075de',
    reserved:    '#dd5b00',
    maintenance: '#c0392b',
  }
  const statusColor = statusColors[berth.status] ?? '#888'

  return (
    <div style={{
      width: 280, flexShrink: 0,
      background: '#0c1f3d',
      borderLeft: '1px solid #1e3a5f',
      display: 'flex', flexDirection: 'column',
      overflowY: 'auto',
      fontFamily: 'var(--font)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px',
        borderBottom: '1px solid #1e3a5f',
      }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 700, color: '#f0e8d8' }}>
            Berth {berth.code}
          </div>
          <div style={{ fontSize: 11, color: statusColor, marginTop: 2, textTransform: 'capitalize' }}>
            ● {berth.status}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#5a7a9a', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}
        >
          ×
        </button>
      </div>

      {/* Static berth info */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #1e3a5f' }}>
        <Label>Dimensions</Label>
        <Row label="Length"    value={berth.length_m    ? `${berth.length_m}m` : '—'} />
        <Row label="Max Draft" value={berth.max_draft_m ? `${berth.max_draft_m}m` : '—'} />
        <Row label="Max Beam"  value={berth.max_beam_m  ? `${berth.max_beam_m}m` : '—'} />

        {berth.price_per_night && (
          <>
            <Label style={{ marginTop: 10 }}>Pricing</Label>
            <Row label="Per Night" value={`€${berth.price_per_night}`} />
          </>
        )}

        {berth.amenities?.length > 0 && (
          <>
            <Label style={{ marginTop: 10 }}>Amenities</Label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
              {berth.amenities.map(a => (
                <span key={a} style={{
                  fontSize: 10, padding: '2px 7px', borderRadius: 10,
                  background: '#1e3a5f', color: '#a8c8d8', border: '1px solid #2a5a7a',
                }}>
                  {a}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Active booking section */}
      <div style={{ padding: '12px 14px', flex: 1 }}>
        {berth.status === 'available' ? (
          <>
            <div style={{ fontSize: 12, color: '#5a7a9a', marginBottom: 10 }}>No active booking</div>
            <ActionButton href={`/bookings/new?berth=${berth.id}`}>
              Create Booking
            </ActionButton>
          </>
        ) : loadingBooking ? (
          <div style={{ fontSize: 11, color: '#5a7a9a' }}>Loading booking…</div>
        ) : booking ? (
          <>
            <Label>Active Booking</Label>
            <Row label="Vessel"    value={booking.vessel_name ?? booking.guest_name ?? '—'} />
            <Row label="Check In"  value={booking.check_in} />
            <Row label="Check Out" value={booking.check_out} />
            <Row label="Nights"    value={booking.nights} />
            <Row label="Amount"    value={booking.amount ? `€${booking.amount}` : '—'} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 12 }}>
              <ActionButton onClick={() => alert('Check-out flow TBD')}>
                Check Out
              </ActionButton>
              <ActionButton secondary href={`/bookings/${booking.id}`}>
                View Full Booking
              </ActionButton>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 11, color: '#5a7a9a' }}>No checked-in booking found.</div>
        )}
      </div>
    </div>
  )
}

function Label({ children, style }) {
  return (
    <div style={{ fontSize: 10, letterSpacing: '0.8px', color: '#b8965a', fontWeight: 700, marginBottom: 4, ...style }}>
      {children.toUpperCase()}
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
      <span style={{ color: '#7a9ab8' }}>{label}</span>
      <span style={{ color: '#c8d8e8', fontWeight: 500 }}>{value}</span>
    </div>
  )
}

function ActionButton({ children, onClick, href, secondary }) {
  const style = {
    display: 'block', textAlign: 'center', textDecoration: 'none',
    padding: '7px 12px', borderRadius: 4, fontSize: 12, fontWeight: 600,
    cursor: 'pointer', border: 'none',
    background: secondary ? 'transparent' : '#b8965a',
    color: secondary ? '#7a9ab8' : 'white',
    border: secondary ? '1px solid #2a5a7a' : 'none',
    fontFamily: 'var(--font)',
  }
  if (href) return <a href={href} style={style}>{children}</a>
  return <button onClick={onClick} style={style}>{children}</button>
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/harbor-map/BerthDetailPanel.jsx
git commit -m "feat(map): add BerthDetailPanel with static berth info and active booking section"
```

---

## Task 8: Frontend — LiveMap.jsx (Operational Controller)

**Files:**
- Create: `frontend/src/components/harbor-map/LiveMap.jsx`
- Delete: `frontend/src/components/harbor-map/HarborMap.jsx`

- [ ] **Step 1: Create LiveMap.jsx**

```jsx
// frontend/src/components/harbor-map/LiveMap.jsx
import { useState, useEffect, useCallback } from 'react'
import usePiers from '../../hooks/usePiers.js'
import useBerths from '../../hooks/useBerths.js'
import useMapConfig from '../../hooks/useMapConfig.js'
import CanvasCore from './CanvasCore.jsx'
import BerthDetailPanel from './BerthDetailPanel.jsx'
import { computeAbsPosition, sortItemsForRender } from './mapBuilderUtils.js'

const STATUS_COLORS = {
  available:   { fill: 'rgba(26,140,46,0.2)',  stroke: '#1a8c2e' },
  occupied:    { fill: 'rgba(0,117,222,0.2)',   stroke: '#0075de' },
  reserved:    { fill: 'rgba(221,91,0,0.2)',    stroke: '#dd5b00' },
  maintenance: { fill: 'rgba(192,57,43,0.2)',   stroke: '#c0392b' },
}

// Build shapes[] for CanvasCore: env items + piers + berths with status colors
function buildLiveShapes(piers, berths, envItems) {
  const pierById = Object.fromEntries(piers.map(p => [p.id, p]))

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
      const col = STATUS_COLORS[b.status] ?? STATUS_COLORS.available
      return {
        id: `berth-${b.id}`, type: 'berth',
        absX, absY,
        w: 2, h: 1, rotation: 0,
        fill: col.fill, stroke: col.stroke,
        label: b.code,
        meta: { berthId: b.id, berthData: b },
      }
    })

  const envShapes = (envItems ?? []).map(item => ({
    ...item,
    absX: item.gx + item.w / 2,
    absY: item.gy + item.h / 2,
    fill: item.bg, stroke: item.border,
  }))

  return sortItemsForRender([...envShapes, ...pierShapes, ...berthShapes])
}

const POLL_INTERVAL_MS = 30_000  // refresh berth statuses every 30 seconds

export default function LiveMap() {
  const { piers, loading: piersLoading } = usePiers()
  const { berths, loading: berthsLoading, refetch: refetchBerths } = useBerths()
  const { config, loading: cfgLoading } = useMapConfig()
  const [selectedBerth, setSelectedBerth] = useState(null)

  // Poll for status changes
  useEffect(() => {
    const timer = setInterval(refetchBerths, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refetchBerths])

  function handleItemClick(e, item) {
    if (item.type !== 'berth') return
    const berthData = item.meta?.berthData
    if (!berthData) return
    setSelectedBerth(berthData)
  }

  const envItems = config?.env_items ?? config?.custom_elements ?? []
  const shapes = buildLiveShapes(piers, berths, envItems)

  if (piersLoading || berthsLoading || cfgLoading) {
    return <div style={{ padding: 40, color: 'rgba(255,255,255,0.35)', fontSize: 13 }}>Loading harbor map…</div>
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: '#0a1829' }}>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <CanvasCore
          shapes={shapes}
          mode="viewer"
          onItemClick={handleItemClick}
        />
      </div>

      <BerthDetailPanel
        berth={selectedBerth}
        onClose={() => setSelectedBerth(null)}
      />
    </div>
  )
}
```

- [ ] **Step 2: Delete HarborMap.jsx**

```bash
git rm frontend/src/components/harbor-map/HarborMap.jsx
```

- [ ] **Step 3: Start dev server and test LiveMap manually**

```bash
cd frontend && npm run dev
```

Navigate to Dashboard → Live Map. Verify:
1. Canvas renders with correct env items
2. Piers appear at their canvas positions
3. Berths appear at positions computed from pier parent + local coords
4. Berth colors match status (green=available, blue=occupied, amber=reserved, red=maintenance)
5. Clicking a berth opens BerthDetailPanel with its code, length, draft, beam, amenities
6. An occupied berth shows booking info in the lower panel
7. An available berth shows "No active booking" + "Create Booking" button

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/harbor-map/LiveMap.jsx
git commit -m "feat(map): add LiveMap operational controller with status colors and BerthDetailPanel"
```

---

## Task 9: Update Routing

Find all files that import `HarborMap` and update them to import `LiveMap`. Find the route for the harbor layout settings page and update it to use `MapBuilder`.

- [ ] **Step 1: Find all imports of HarborMap**

```bash
cd frontend && grep -r "HarborMap" src/ --include="*.jsx" --include="*.js" -l
```

- [ ] **Step 2: Replace each import**

For each file found, change:
```js
import HarborMap from '../components/harbor-map/HarborMap.jsx'
```
to:
```js
import LiveMap from '../components/harbor-map/LiveMap.jsx'
```

And replace `<HarborMap ...>` usage with `<LiveMap />` (LiveMap takes no props — it fetches its own data).

- [ ] **Step 3: Start dev server and verify full flow**

```bash
cd frontend && npm run dev
```

1. Open Settings → Harbor Layout → confirm MapBuilder loads
2. Open Dashboard → Live Map (or wherever LiveMap is routed) → confirm LiveMap loads
3. Create a pier in MapBuilder, refresh LiveMap — pier appears
4. Snap a berth in MapBuilder, refresh LiveMap — berth appears with correct status color

- [ ] **Step 4: Run all frontend tests**

```bash
cd frontend && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 5: Run all backend tests**

```bash
cd backend && python manage.py test apps.berths -v 2
```

Expected: all tests pass.

- [ ] **Step 6: Final commit**

```bash
git add -u
git commit -m "feat(map): wire routing to MapBuilder and LiveMap, complete architecture refactor"
```

---

## Self-Review

**Spec coverage check:**
- ✅ CanvasCore dumb renderer with props contract — Task 5
- ✅ MapBuilder layout controller — Task 6
- ✅ LiveMap operational controller — Task 8
- ✅ Pier model: canvas_x/y/w/h/rotation — Task 1
- ✅ Berth model: nullable pier FK, local_x/y/position_on_parent — Task 1
- ✅ Center-origin math with `computeAbsPosition` — Task 3
- ✅ Snap zone on berth-to-pier drag — Task 3 + Task 6
- ✅ Parent-child: moving a pier moves all berths — Tasks 3+6 (absX/absY recomputed from pier canvas_x/y)
- ✅ Design system colors (no blue hex) — Task 6 (MapBuilder builder mode), Task 8 (LiveMap status colors)
- ✅ BerthDetailPanel: static + booking sections — Task 7
- ✅ "Unplaced Berths" sidebar: filtered to pier=null — existing MapBuilderBerthPanel + `is_placed` flag from Task 2
- ✅ Docking prefabs create Pier DB records — Task 6
- ✅ Environmental items still use MarinaMapConfig — Task 6

**Placeholder scan:** No TBDs in code tasks. "Check-out flow TBD" placeholder exists in BerthDetailPanel's Check Out button — acceptable since the check-out flow is a separate feature (reservations spec).

**Type consistency:**
- `computeAbsPosition(pier, berth)` signature is consistent in Tasks 3, 6, and 8
- `snapBerthToPier(mouseGx, mouseGy, piers, berthW, berthH)` consistent in Tasks 3 and 6
- `shapes[]` item contract uses `absX/absY/w/h/fill/stroke/label/meta` consistently in Tasks 5, 6, and 8
- `is_placed` serializer field referenced correctly in Task 6 (`b.is_placed`)
