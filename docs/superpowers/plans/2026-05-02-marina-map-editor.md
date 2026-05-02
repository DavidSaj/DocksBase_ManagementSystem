# Marina Map Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the marina map canvas from SVG to react-konva, adding polygon pier drawing, edge-snapping berth placement, and a drag-and-drop amenity POI layer.

**Architecture:** Split canvas into `LiveCanvas` (read-only) and `EditorCanvas` (full tool suite), sharing three pure rendering layer components (`PierLayer`, `BerthLayer`, `AmenityLayer`). EditorCanvas manages a local `draft` state object that only flushes to the API on explicit Save.

**Tech Stack:** Django REST Framework (backend), React 19 + Vite (frontend), react-konva 18.2, konva 9.3, lucide-react 0.475

---

## File Map

### Backend
- Modify: `backend/apps/berths/models.py`
- Modify: `backend/apps/berths/serializers.py`
- Modify: `backend/apps/berths/views.py`
- Modify: `backend/apps/berths/urls.py`
- Create (via makemigrations): `backend/apps/berths/migrations/0003_pier_polygon_amenity.py`
- Create: `backend/apps/berths/tests/test_amenity_api.py`

### Frontend
- Modify: `frontend/package.json`
- Create: `frontend/src/components/harbor-map/mapConstants.js`
- Create: `frontend/src/components/harbor-map/amenityIcons.js`
- Create: `frontend/src/components/harbor-map/edgeSnap.js`
- Create: `frontend/src/hooks/useAmenities.js`
- Create: `frontend/src/components/harbor-map/PierLayer.jsx`
- Create: `frontend/src/components/harbor-map/BerthLayer.jsx`
- Create: `frontend/src/components/harbor-map/AmenityLayer.jsx`
- Create: `frontend/src/components/harbor-map/LiveCanvas.jsx`
- Create: `frontend/src/components/harbor-map/EditorCanvas.jsx`
- Delete: `frontend/src/components/harbor-map/DigitalTwinCanvas.jsx`
- Modify: `frontend/src/screens/MarinaMap.jsx`

---

### Task 1: Update Pier model + add Amenity model

**Files:**
- Modify: `backend/apps/berths/models.py`

- [ ] **Step 1: Replace the Pier model and add Amenity**

Replace the entire contents of `backend/apps/berths/models.py` with:

```python
from django.db import models


class Pier(models.Model):
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='piers')
    code = models.CharField(max_length=10)
    label = models.CharField(max_length=50, blank=True)
    polygon_points = models.JSONField(default=list)
    # Format: [[x1,y1],[x2,y2],...] in meters. Empty list = unmapped.

    class Meta:
        unique_together = ('marina', 'code')
        ordering = ['code']

    def __str__(self):
        return f'{self.marina} — Pier {self.code}'


class Berth(models.Model):
    STATUS_CHOICES = [
        ('available', 'Available'),
        ('occupied', 'Occupied'),
        ('reserved', 'Reserved'),
        ('maintenance', 'Maintenance'),
    ]
    SIDE_CHOICES = [
        ('port', 'Port'),
        ('starboard', 'Starboard'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='berths')
    pier = models.ForeignKey(Pier, on_delete=models.CASCADE, related_name='berths')
    code = models.CharField(max_length=10)
    side = models.CharField(max_length=10, choices=SIDE_CHOICES, default='port')
    position_index = models.IntegerField(default=0)
    length_m = models.DecimalField(max_digits=6, decimal_places=1, null=True, blank=True)
    max_draft_m = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    max_beam_m = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    amenities = models.JSONField(default=list, blank=True)
    price_per_night = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='available')
    canvas_x = models.FloatField(null=True, blank=True)
    canvas_y = models.FloatField(null=True, blank=True)
    canvas_rotation = models.FloatField(default=0)
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True, related_name='current_berth')

    class Meta:
        unique_together = ('marina', 'code')
        ordering = ['pier__code', 'position_index']

    def __str__(self):
        return f'Berth {self.code} ({self.marina})'


class Amenity(models.Model):
    AMENITY_TYPES = [
        ('harbour_master', 'Harbour Master'),
        ('fuel',           'Fuel Pump'),
        ('toilets',        'Toilets'),
        ('showers',        'Showers'),
        ('restaurant',     'Restaurant'),
        ('parking',        'Parking'),
        ('electricity',    'Electricity'),
        ('water',          'Water'),
        ('gate',           'Security Gate'),
        ('waste',          'Waste Disposal'),
        ('chandlery',      'Chandlery'),
        ('first_aid',      'First Aid'),
    ]
    marina   = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='amenities')
    type     = models.CharField(max_length=30, choices=AMENITY_TYPES)
    label    = models.CharField(max_length=100, blank=True)
    canvas_x = models.FloatField(null=True, blank=True)
    canvas_y = models.FloatField(null=True, blank=True)
    scale    = models.FloatField(default=1.0)
    rotation = models.FloatField(default=0)

    class Meta:
        ordering = ['type']

    def __str__(self):
        return f'{self.get_type_display()} ({self.marina})'


class MarinaMapConfig(models.Model):
    marina = models.OneToOneField('accounts.Marina', on_delete=models.CASCADE, related_name='map_config')
    config = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'Map config — {self.marina}'
```

- [ ] **Step 2: Generate and apply the migration**

```bash
cd backend
python manage.py makemigrations berths --name pier_polygon_amenity
python manage.py migrate
```

Expected: migration `0003_pier_polygon_amenity.py` created and applied without errors.

- [ ] **Step 3: Verify in Django shell**

```bash
python manage.py shell
```

```python
from apps.berths.models import Pier, Amenity
print(Pier._meta.get_fields())   # should NOT include canvas_x/canvas_y/canvas_width/canvas_height/cx
print(Amenity._meta.get_fields())  # should show type, label, canvas_x, canvas_y, scale, rotation
```

Expected: Pier fields do not include old canvas rect fields. Amenity model is accessible.

- [ ] **Step 4: Commit**

```bash
git add backend/apps/berths/models.py backend/apps/berths/migrations/
git commit -m "feat: replace pier rect fields with polygon_points, add Amenity model"
```

---

### Task 2: Update serializers + views + URLs for Amenity

**Files:**
- Modify: `backend/apps/berths/serializers.py`
- Modify: `backend/apps/berths/views.py`
- Modify: `backend/apps/berths/urls.py`

- [ ] **Step 1: Update serializers.py**

Replace the entire contents of `backend/apps/berths/serializers.py` with:

```python
from rest_framework import serializers
from .models import Pier, Berth, MarinaMapConfig, Amenity


class PierSerializer(serializers.ModelSerializer):
    berth_count = serializers.SerializerMethodField()

    class Meta:
        model = Pier
        fields = ['id', 'code', 'label', 'polygon_points', 'berth_count']
        read_only_fields = ['id', 'berth_count']

    def get_berth_count(self, obj):
        return obj.berths.count()


class BerthSerializer(serializers.ModelSerializer):
    pier_code = serializers.CharField(source='pier.code', read_only=True)
    pier_label = serializers.CharField(source='pier.label', read_only=True, default='')
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, default=None)
    unmapped = serializers.SerializerMethodField()

    class Meta:
        model = Berth
        fields = [
            'id', 'code', 'pier', 'pier_code', 'pier_label',
            'side', 'position_index',
            'length_m', 'max_draft_m', 'max_beam_m', 'amenities', 'price_per_night',
            'status', 'vessel', 'vessel_name',
            'canvas_x', 'canvas_y', 'canvas_rotation',
            'unmapped',
        ]
        read_only_fields = ['id', 'pier_code', 'pier_label', 'vessel_name', 'unmapped']

    def get_unmapped(self, obj):
        return obj.canvas_x is None or obj.canvas_y is None


class AmenitySerializer(serializers.ModelSerializer):
    class Meta:
        model = Amenity
        fields = ['id', 'type', 'label', 'canvas_x', 'canvas_y', 'scale', 'rotation']
        read_only_fields = ['id']


class BulkGenerateSerializer(serializers.Serializer):
    prefix = serializers.CharField(max_length=5)
    start = serializers.IntegerField(min_value=1)
    end = serializers.IntegerField(min_value=1)
    length_m = serializers.DecimalField(max_digits=6, decimal_places=1, required=False, allow_null=True)
    max_beam_m = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    max_draft_m = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    price_per_night = serializers.DecimalField(max_digits=8, decimal_places=2, required=False, allow_null=True)
    amenities = serializers.ListField(child=serializers.CharField(), required=False, default=list)

    def validate(self, data):
        if data['end'] < data['start']:
            raise serializers.ValidationError('end must be >= start')
        if (data['end'] - data['start'] + 1) > 200:
            raise serializers.ValidationError('Cannot generate more than 200 berths at once')
        return data


class MarinaMapConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = MarinaMapConfig
        fields = ['config', 'updated_at']
        read_only_fields = ['updated_at']
```

- [ ] **Step 2: Add Amenity views to views.py**

At the top of `backend/apps/berths/views.py`, update the imports line to add `Amenity` and `AmenitySerializer`:

```python
from .models import Pier, Berth, MarinaMapConfig, Amenity
from .serializers import (
    PierSerializer, BerthSerializer,
    BulkGenerateSerializer, MarinaMapConfigSerializer, AmenitySerializer,
)
```

Then append these two classes to the bottom of `views.py`:

```python
class AmenityListCreateView(generics.ListCreateAPIView):
    serializer_class = AmenitySerializer
    pagination_class = None

    def get_queryset(self):
        return Amenity.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class AmenityDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = AmenitySerializer

    def get_queryset(self):
        return Amenity.objects.filter(marina=self.request.user.marina)
```

- [ ] **Step 3: Add amenity routes to urls.py**

Replace the entire contents of `backend/apps/berths/urls.py` with:

```python
from django.urls import path
from .views import (
    PierListCreateView, PierDetailView,
    BerthListCreateView, BerthDetailView,
    BulkGenerateBerthsView,
    MapConfigView,
    AmenityListCreateView, AmenityDetailView,
)

urlpatterns = [
    path('piers/', PierListCreateView.as_view(), name='pier_list'),
    path('piers/<int:pk>/', PierDetailView.as_view(), name='pier_detail'),
    path('piers/<int:pk>/bulk-generate/', BulkGenerateBerthsView.as_view(), name='bulk_generate_berths'),
    path('berths/', BerthListCreateView.as_view(), name='berth_list'),
    path('berths/<int:pk>/', BerthDetailView.as_view(), name='berth_detail'),
    path('map/config/', MapConfigView.as_view(), name='map_config'),
    path('amenities/', AmenityListCreateView.as_view(), name='amenity_list'),
    path('amenities/<int:pk>/', AmenityDetailView.as_view(), name='amenity_detail'),
]
```

- [ ] **Step 4: Start the dev server and confirm no import errors**

```bash
python manage.py check
```

Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 5: Commit**

```bash
git add backend/apps/berths/serializers.py backend/apps/berths/views.py backend/apps/berths/urls.py
git commit -m "feat: add Amenity serializer, views, and URL routes"
```

---

### Task 3: Backend tests

**Files:**
- Create: `backend/apps/berths/tests/__init__.py`
- Create: `backend/apps/berths/tests/test_amenity_api.py`

- [ ] **Step 1: Create the tests directory and init file**

```bash
mkdir backend/apps/berths/tests
touch backend/apps/berths/tests/__init__.py
```

- [ ] **Step 2: Write failing tests**

Create `backend/apps/berths/tests/test_amenity_api.py`:

```python
from django.test import TestCase
from django.contrib.auth import get_user_model
from rest_framework.test import APIClient
from rest_framework import status
from apps.berths.models import Amenity, Pier

User = get_user_model()


def make_user_with_marina(username='testuser'):
    """Create a user that has an associated marina (adapt to actual User/Marina setup)."""
    from apps.accounts.models import Marina
    marina = Marina.objects.create(name=f'Test Marina {username}')
    user = User.objects.create_user(username=username, password='testpass')
    user.marina = marina
    user.save()
    return user, marina


class AmenityAPITest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user, self.marina = make_user_with_marina()
        self.client.force_authenticate(user=self.user)

    def test_create_amenity(self):
        resp = self.client.post('/api/amenities/', {
            'type': 'fuel',
            'label': 'North Fuel Dock',
            'canvas_x': 10.5,
            'canvas_y': 20.0,
            'scale': 1.0,
            'rotation': 0,
        }, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(resp.data['type'], 'fuel')
        self.assertEqual(resp.data['label'], 'North Fuel Dock')

    def test_list_amenities_scoped_to_marina(self):
        Amenity.objects.create(marina=self.marina, type='toilets', canvas_x=5, canvas_y=5)
        other_user, other_marina = make_user_with_marina('other')
        Amenity.objects.create(marina=other_marina, type='fuel', canvas_x=1, canvas_y=1)

        resp = self.client.get('/api/amenities/')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(len(resp.data), 1)
        self.assertEqual(resp.data[0]['type'], 'toilets')

    def test_patch_amenity(self):
        amenity = Amenity.objects.create(marina=self.marina, type='restaurant', canvas_x=0, canvas_y=0)
        resp = self.client.patch(f'/api/amenities/{amenity.pk}/', {'canvas_x': 15.5}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_200_OK)
        self.assertEqual(float(resp.data['canvas_x']), 15.5)

    def test_delete_amenity(self):
        amenity = Amenity.objects.create(marina=self.marina, type='gate', canvas_x=0, canvas_y=0)
        resp = self.client.delete(f'/api/amenities/{amenity.pk}/')
        self.assertEqual(resp.status_code, status.HTTP_204_NO_CONTENT)
        self.assertFalse(Amenity.objects.filter(pk=amenity.pk).exists())

    def test_cannot_access_other_marina_amenity(self):
        other_user, other_marina = make_user_with_marina('other2')
        amenity = Amenity.objects.create(marina=other_marina, type='fuel', canvas_x=0, canvas_y=0)
        resp = self.client.patch(f'/api/amenities/{amenity.pk}/', {'canvas_x': 99}, format='json')
        self.assertEqual(resp.status_code, status.HTTP_404_NOT_FOUND)

    def test_pier_polygon_points_field(self):
        resp = self.client.post('/api/piers/', {
            'code': 'A',
            'label': 'Pier A',
            'polygon_points': [[0, 0], [10, 0], [10, 5], [0, 5]],
        }, format='json')
        self.assertEqual(resp.status_code, status.HTTP_201_CREATED)
        self.assertEqual(len(resp.data['polygon_points']), 4)
        self.assertNotIn('canvas_x', resp.data)
        self.assertNotIn('canvas_width', resp.data)
```

- [ ] **Step 3: Run the tests to see them fail (or adjust make_user_with_marina)**

```bash
cd backend
python manage.py test apps.berths.tests.test_amenity_api -v 2
```

If `make_user_with_marina` fails because the Marina/User relationship is different, inspect the User model:

```bash
python manage.py shell -c "from django.contrib.auth import get_user_model; U = get_user_model(); print([f.name for f in U._meta.get_fields()])"
```

Adjust `make_user_with_marina` to match the actual user-marina relationship in this project.

- [ ] **Step 4: Make all tests pass**

Run until all 6 tests pass:

```bash
python manage.py test apps.berths.tests.test_amenity_api -v 2
```

Expected: `Ran 6 tests in X.XXXs — OK`

- [ ] **Step 5: Commit**

```bash
git add backend/apps/berths/tests/
git commit -m "test: add amenity API and pier polygon_points tests"
```

---

### Task 4: Frontend dependencies + shared constants

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/src/components/harbor-map/mapConstants.js`

- [ ] **Step 1: Install new packages**

```bash
cd frontend
npm install react-konva@18.2.10 konva@9.3.6 lucide-react@0.475.0
```

Expected: packages appear in `node_modules`, `package.json` updated.

- [ ] **Step 2: Create mapConstants.js**

Create `frontend/src/components/harbor-map/mapConstants.js`:

```js
export const CELL = 20; // pixels per meter at Konva scale=1

export const STATUS_COL = {
  available:   { fill: '#c2ecce', stroke: '#38a860', text: '#0a4a20' },
  occupied:    { fill: '#c6dcf5', stroke: '#3a7fc8', text: '#0a3a70' },
  reserved:    { fill: '#f6e7b0', stroke: '#c89020', text: '#6a4800' },
  maintenance: { fill: '#f5cccc', stroke: '#c04040', text: '#780000' },
};

export const AMENITY_TYPES = [
  { value: 'harbour_master', label: 'Harbour Master' },
  { value: 'fuel',           label: 'Fuel Pump' },
  { value: 'toilets',        label: 'Toilets' },
  { value: 'showers',        label: 'Showers' },
  { value: 'restaurant',     label: 'Restaurant' },
  { value: 'parking',        label: 'Parking' },
  { value: 'electricity',    label: 'Electricity' },
  { value: 'water',          label: 'Water' },
  { value: 'gate',           label: 'Security Gate' },
  { value: 'waste',          label: 'Waste Disposal' },
  { value: 'chandlery',      label: 'Chandlery' },
  { value: 'first_aid',      label: 'First Aid' },
];
```

- [ ] **Step 3: Verify Vite still starts**

```bash
npm run dev
```

Expected: dev server starts without errors. Open the app and confirm it still loads (the old DigitalTwinCanvas is still in place at this point).

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/components/harbor-map/mapConstants.js
git commit -m "feat: install react-konva, konva, lucide-react; add mapConstants"
```

---

### Task 5: Utility files — amenityIcons.js + edgeSnap.js

**Files:**
- Create: `frontend/src/components/harbor-map/amenityIcons.js`
- Create: `frontend/src/components/harbor-map/edgeSnap.js`

- [ ] **Step 1: Create amenityIcons.js**

Create `frontend/src/components/harbor-map/amenityIcons.js`:

```js
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  Anchor, Fuel, Toilet, ShowerHead, UtensilsCrossed,
  ParkingSquare, Zap, Waves, DoorClosed, Trash2, Store, Cross,
} from 'lucide-react';

const ICON_COMPONENTS = {
  harbour_master: Anchor,
  fuel:           Fuel,
  toilets:        Toilet,
  showers:        ShowerHead,
  restaurant:     UtensilsCrossed,
  parking:        ParkingSquare,
  electricity:    Zap,
  water:          Waves,
  gate:           DoorClosed,
  waste:          Trash2,
  chandlery:      Store,
  first_aid:      Cross,
};

const urlCache = {};

export function getAmenityDataUrl(type) {
  if (!urlCache[type]) {
    const Component = ICON_COMPONENTS[type];
    if (!Component) return null;
    const svg = renderToStaticMarkup(
      createElement(Component, { size: 40, color: '#1e293b', strokeWidth: 1.5 })
    );
    urlCache[type] = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }
  return urlCache[type];
}

export { ICON_COMPONENTS };
```

- [ ] **Step 2: Create a hook that loads all amenity icons as HTMLImageElements for Konva**

Create `frontend/src/components/harbor-map/useAmenityImages.js`:

```js
import { useState, useEffect } from 'react';
import { getAmenityDataUrl } from './amenityIcons';
import { AMENITY_TYPES } from './mapConstants';

export function useAmenityImages() {
  const [images, setImages] = useState({});

  useEffect(() => {
    const loaded = {};
    let remaining = AMENITY_TYPES.length;

    AMENITY_TYPES.forEach(({ value: type }) => {
      const url = getAmenityDataUrl(type);
      if (!url) { remaining--; if (remaining === 0) setImages({ ...loaded }); return; }
      const img = new window.Image();
      img.onload = () => {
        loaded[type] = img;
        remaining--;
        if (remaining === 0) setImages({ ...loaded });
      };
      img.onerror = () => { remaining--; if (remaining === 0) setImages({ ...loaded }); };
      img.src = url;
    });
  }, []);

  return images;
}
```

- [ ] **Step 3: Create edgeSnap.js**

This is a pure geometric utility. Create `frontend/src/components/harbor-map/edgeSnap.js`:

```js
/**
 * Given a drop point (meters) and a list of piers with polygon_points,
 * find the nearest pier polygon edge within snapDistanceMeters.
 * Returns { snapX, snapY, angle } or null.
 * angle is in degrees, representing the edge direction for berth rotation.
 */
export function findNearestEdge(dropX, dropY, piers, snapDistanceMeters = 2) {
  let best = null;
  let bestDist = Infinity;

  for (const pier of piers) {
    const pts = pier.polygon_points;
    if (!pts || pts.length < 2) continue;

    for (let i = 0; i < pts.length; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % pts.length];

      const dx = x2 - x1;
      const dy = y2 - y1;
      const lenSq = dx * dx + dy * dy;
      let t = lenSq > 0 ? ((dropX - x1) * dx + (dropY - y1) * dy) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));

      const nearX = x1 + t * dx;
      const nearY = y1 + t * dy;
      const dist = Math.sqrt((dropX - nearX) ** 2 + (dropY - nearY) ** 2);

      if (dist < bestDist && dist <= snapDistanceMeters) {
        bestDist = dist;
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        best = { snapX: nearX, snapY: nearY, angle };
      }
    }
  }

  return best;
}

/**
 * Given a snap result and berth dimensions (in meters),
 * return { canvas_x, canvas_y, canvas_rotation } positioning the berth
 * so its long axis aligns with the snapped edge.
 */
export function berthFromSnap(snap, lengthM, beamM) {
  const halfL = lengthM / 2;
  const halfB = beamM / 2;
  const rad = snap.angle * (Math.PI / 180);
  // Center the berth on the snap point, offset perpendicular to edge by half beam
  const cx = snap.snapX - Math.sin(rad) * halfB;
  const cy = snap.snapY + Math.cos(rad) * halfB;
  return {
    canvas_x: cx - halfL * Math.cos(rad),
    canvas_y: cy - halfL * Math.sin(rad),
    canvas_rotation: snap.angle,
  };
}
```

- [ ] **Step 4: Verify edgeSnap logic manually**

Open browser console and run a quick sanity check after importing. A point at (5, 0) should snap to the edge from (0,0) to (10,0) at angle=0:

```js
// In browser console after dev server is running — import edgeSnap manually
// Expected: { snapX: 5, snapY: 0, angle: 0 }
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/harbor-map/amenityIcons.js \
        frontend/src/components/harbor-map/useAmenityImages.js \
        frontend/src/components/harbor-map/edgeSnap.js
git commit -m "feat: add amenity icon loader and edge-snap geometry utility"
```

---

### Task 6: useAmenities hook

**Files:**
- Create: `frontend/src/hooks/useAmenities.js`

- [ ] **Step 1: Write the hook**

Create `frontend/src/hooks/useAmenities.js`:

```js
import { useState, useEffect, useCallback } from 'react';
import api from '../api';

export function useAmenities() {
  const [amenities, setAmenities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/amenities/')
      .then(r => { setAmenities(r.data); setLoading(false); })
      .catch(e => { setError(e); setLoading(false); });
  }, []);

  const createAmenity = useCallback(async (data) => {
    const r = await api.post('/amenities/', data);
    setAmenities(prev => [...prev, r.data]);
    return r.data;
  }, []);

  const updateAmenity = useCallback(async (id, data) => {
    const r = await api.patch(`/amenities/${id}/`, data);
    setAmenities(prev => prev.map(a => a.id === id ? r.data : a));
    return r.data;
  }, []);

  const deleteAmenity = useCallback(async (id) => {
    await api.delete(`/amenities/${id}/`);
    setAmenities(prev => prev.filter(a => a.id !== id));
  }, []);

  return { amenities, loading, error, createAmenity, updateAmenity, deleteAmenity };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useAmenities.js
git commit -m "feat: add useAmenities hook"
```

---

### Task 7: PierLayer component

**Files:**
- Create: `frontend/src/components/harbor-map/PierLayer.jsx`

- [ ] **Step 1: Create PierLayer.jsx**

```jsx
import { Fragment } from 'react';
import { Line, Text } from 'react-konva';
// Fragment must be imported from 'react', not from react-konva.
import { CELL } from './mapConstants';

function getBoundingBox(points) {
  const xs = points.map(p => p[0]);
  const ys = points.map(p => p[1]);
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
  };
}

export default function PierLayer({ piers, selectedPierId, onPierClick, editMode = false }) {
  return (
    <>
      {piers.map(pier => {
        if (!pier.polygon_points || pier.polygon_points.length < 3) return null;
        const flat = pier.polygon_points.flatMap(([x, y]) => [x * CELL, y * CELL]);
        const bb = getBoundingBox(pier.polygon_points);
        const cx = ((bb.minX + bb.maxX) / 2) * CELL;
        const cy = ((bb.minY + bb.maxY) / 2) * CELL;
        const isSelected = pier.id === selectedPierId;

        return (
          <Fragment key={pier.id}>
            <Line
              points={flat}
              closed
              fill={isSelected ? '#5a5a5a' : '#7a7a7a'}
              stroke={isSelected ? '#2563eb' : '#4a4a4a'}
              strokeWidth={isSelected ? 2 : 1}
              onClick={editMode ? () => onPierClick?.(pier) : undefined}
              onTap={editMode ? () => onPierClick?.(pier) : undefined}
              listening={editMode}
            />
            <Text
              x={cx - 40}
              y={cy - 8}
              width={80}
              text={pier.label || pier.code}
              fontSize={12}
              fontStyle="bold"
              fill="white"
              align="center"
              listening={false}
            />
          </Fragment>
        );
      })}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/harbor-map/PierLayer.jsx
git commit -m "feat: add PierLayer Konva component"
```

---

### Task 8: BerthLayer component

**Files:**
- Create: `frontend/src/components/harbor-map/BerthLayer.jsx`

- [ ] **Step 1: Create BerthLayer.jsx**

Each berth Group is positioned with its center at `(canvas_x + w/2, canvas_y + h/2) * CELL` using `offsetX/offsetY` so rotation pivots around the center. Children are drawn from `(0, 0)` to `(w, h)` relative to the Group.

```jsx
import { useRef, useEffect } from 'react';
import { Group, Rect, Text, Transformer } from 'react-konva';
import { CELL, STATUS_COL } from './mapConstants';

function BerthItem({ berth, isSelected, onSelect, editMode, onDragEnd, onTransformEnd }) {
  const groupRef = useRef();
  const trRef = useRef();

  const w = parseFloat(berth.length_m || 12) * CELL;
  const h = parseFloat(berth.max_beam_m || 4) * CELL;
  const col = STATUS_COL[berth.status] || STATUS_COL.available;

  useEffect(() => {
    if (isSelected && editMode && trRef.current && groupRef.current) {
      trRef.current.nodes([groupRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected, editMode]);

  return (
    <>
      <Group
        ref={groupRef}
        x={(berth.canvas_x + parseFloat(berth.length_m || 12) / 2) * CELL}
        y={(berth.canvas_y + parseFloat(berth.max_beam_m || 4) / 2) * CELL}
        offsetX={w / 2}
        offsetY={h / 2}
        rotation={berth.canvas_rotation || 0}
        draggable={editMode}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={e => {
          const node = e.target;
          onDragEnd?.(berth.id, {
            canvas_x: (node.x() - node.offsetX()) / CELL,
            canvas_y: (node.y() - node.offsetY()) / CELL,
          });
        }}
        onTransformEnd={e => {
          const node = e.target;
          onTransformEnd?.(berth.id, {
            canvas_x: (node.x() - node.offsetX()) / CELL,
            canvas_y: (node.y() - node.offsetY()) / CELL,
            canvas_rotation: node.rotation(),
          });
        }}
      >
        {isSelected && editMode && (
          <Rect
            x={-4} y={-4} width={w + 8} height={h + 8}
            fill="none" stroke="#2563eb" strokeWidth={2} cornerRadius={3}
            listening={false}
          />
        )}
        {isSelected && !editMode && (
          <Rect
            x={-3} y={-3} width={w + 6} height={h + 6}
            fill="none" stroke="#2563eb" strokeWidth={2} cornerRadius={3}
            listening={false}
          />
        )}
        <Rect width={w} height={h} fill={col.fill} stroke={col.stroke} strokeWidth={1} cornerRadius={1} />
        <Text
          width={w} height={h / 2}
          y={h / 4}
          text={berth.code}
          fontSize={10} fontStyle="bold"
          fill={col.text} align="center" verticalAlign="middle"
          listening={false}
        />
        {berth.vessel_name && (
          <Text
            width={w} height={h / 2}
            y={h / 2}
            text={berth.vessel_name.substring(0, 10)}
            fontSize={8}
            fill={col.text} align="center" verticalAlign="middle"
            listening={false}
          />
        )}
      </Group>
      {isSelected && editMode && (
        <Transformer
          ref={trRef}
          rotateEnabled
          resizeEnabled={false}
          enabledAnchors={[]}
          borderStroke="#2563eb"
          borderStrokeWidth={1}
          anchorStroke="#2563eb"
          anchorFill="white"
          anchorSize={8}
        />
      )}
    </>
  );
}

export default function BerthLayer({
  berths,
  selectedBerthId,
  onBerthClick,
  editMode = false,
  onDragEnd,
  onTransformEnd,
}) {
  return (
    <>
      {berths
        .filter(b => b.canvas_x != null)
        .map(berth => (
          <BerthItem
            key={berth.id}
            berth={berth}
            isSelected={berth.id === selectedBerthId}
            onSelect={() => onBerthClick?.(berth)}
            editMode={editMode}
            onDragEnd={onDragEnd}
            onTransformEnd={onTransformEnd}
          />
        ))}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/harbor-map/BerthLayer.jsx
git commit -m "feat: add BerthLayer Konva component with Transformer support"
```

---

### Task 9: AmenityLayer component

**Files:**
- Create: `frontend/src/components/harbor-map/AmenityLayer.jsx`

- [ ] **Step 1: Create AmenityLayer.jsx**

Amenities render as a 48×48 icon centered at `(canvas_x, canvas_y)`. Scale is a uniform multiplier (1.0 = 48px). The Transformer enforces `keepRatio` and corner-only anchors so `scale` stays a single value.

```jsx
import { useRef, useEffect } from 'react';
import { Group, Rect, Image, Text, Transformer } from 'react-konva';
import { useAmenityImages } from './useAmenityImages';
import { AMENITY_TYPES, CELL } from './mapConstants';

const BASE_SIZE = 48;
const LABEL_H = 16;

function AmenityItem({ amenity, isSelected, onSelect, editMode, images, onDragEnd, onTransformEnd }) {
  const groupRef = useRef();
  const trRef = useRef();
  const img = images[amenity.type];
  const scale = amenity.scale || 1;
  const size = BASE_SIZE * scale;
  const typeLabel = AMENITY_TYPES.find(t => t.value === amenity.type)?.label || amenity.type;
  const displayLabel = amenity.label || typeLabel;

  useEffect(() => {
    if (isSelected && editMode && trRef.current && groupRef.current) {
      trRef.current.nodes([groupRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected, editMode]);

  // Position: Group x/y = top-left + half-size offset so rotation pivots at center.
  // offsetX/offsetY shift the origin; children drawn from (0,0) to (BASE_SIZE, BASE_SIZE).
  // We do NOT set scaleX/scaleY on the Group — children are pre-scaled via Image width/height.
  // On transform end, Transformer writes scaleX to the node; we capture it then reset to 1.
  return (
    <>
      <Group
        ref={groupRef}
        x={(amenity.canvas_x || 0) * CELL + size / 2}
        y={(amenity.canvas_y || 0) * CELL + size / 2}
        offsetX={size / 2}
        offsetY={size / 2}
        rotation={amenity.rotation || 0}
        draggable={editMode}
        onClick={onSelect}
        onTap={onSelect}
        onDragEnd={e => {
          const node = e.target;
          onDragEnd?.(amenity.id, {
            canvas_x: (node.x() - node.offsetX()) / CELL,
            canvas_y: (node.y() - node.offsetY()) / CELL,
          });
        }}
        onTransformEnd={e => {
          const node = e.target;
          const newScale = scale * node.scaleX(); // compound scale
          node.scaleX(1);
          node.scaleY(1);
          onTransformEnd?.(amenity.id, {
            canvas_x: (node.x() - node.offsetX()) / CELL,
            canvas_y: (node.y() - node.offsetY()) / CELL,
            scale: newScale,
            rotation: node.rotation(),
          });
        }}
      >
        <Rect
          x={-4} y={-4}
          width={BASE_SIZE + 8} height={BASE_SIZE + 8 + LABEL_H}
          fill="rgba(255,255,255,0.85)"
          stroke={isSelected ? '#2563eb' : '#94a3b8'}
          strokeWidth={isSelected ? 2 : 1}
          cornerRadius={6}
          listening={false}
        />
        {img && (
          <Image image={img} x={0} y={0} width={BASE_SIZE} height={BASE_SIZE} listening={false} />
        )}
        <Text
          x={-4} y={BASE_SIZE + 2}
          width={BASE_SIZE + 8}
          text={displayLabel}
          fontSize={10} fill="#1e293b" align="center"
          listening={false}
        />
      </Group>
      {isSelected && editMode && (
        <Transformer
          ref={trRef}
          keepRatio
          enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
          rotateEnabled
          borderStroke="#2563eb"
          borderStrokeWidth={1}
          anchorStroke="#2563eb"
          anchorFill="white"
          anchorSize={8}
        />
      )}
    </>
  );
}

export default function AmenityLayer({
  amenities,
  selectedAmenityId,
  onAmenityClick,
  editMode = false,
  onDragEnd,
  onTransformEnd,
}) {
  const images = useAmenityImages();

  return (
    <>
      {amenities.map(amenity => (
        <AmenityItem
          key={amenity.id}
          amenity={amenity}
          isSelected={amenity.id === selectedAmenityId}
          onSelect={() => onAmenityClick?.(amenity)}
          editMode={editMode}
          images={images}
          onDragEnd={onDragEnd}
          onTransformEnd={onTransformEnd}
        />
      ))}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/harbor-map/AmenityLayer.jsx
git commit -m "feat: add AmenityLayer with keepRatio Transformer"
```

---

### Task 10: LiveCanvas

**Files:**
- Create: `frontend/src/components/harbor-map/LiveCanvas.jsx`

- [ ] **Step 1: Create LiveCanvas.jsx**

```jsx
import { useRef, useCallback, useState } from 'react';
import { Stage, Layer, Rect } from 'react-konva';
import PierLayer from './PierLayer';
import BerthLayer from './BerthLayer';
import AmenityLayer from './AmenityLayer';

const MIN_SCALE = 0.15;
const MAX_SCALE = 8;

export default function LiveCanvas({
  piers = [],
  berths = [],
  amenities = [],
  selectedBerthId = null,
  onBerthClick,
  onAmenityClick,
}) {
  const stageRef = useRef();
  const containerRef = useRef();
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 60, y: 60 });
  const isPanning = useRef(false);
  const panStart = useRef(null);

  const handleWheel = useCallback((e) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    const factor = e.evt.deltaY < 0 ? 1.12 : 0.89;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, oldScale * factor));
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };
    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };
    setScale(newScale);
    setPos(newPos);
  }, []);

  const handleMouseDown = useCallback((e) => {
    if (e.evt.button === 1 || (e.evt.button === 0 && e.evt.altKey)) {
      e.evt.preventDefault();
      isPanning.current = true;
      panStart.current = {
        x: e.evt.clientX - pos.x,
        y: e.evt.clientY - pos.y,
      };
    }
  }, [pos]);

  const handleMouseMove = useCallback((e) => {
    if (!isPanning.current || !panStart.current) return;
    setPos({
      x: e.evt.clientX - panStart.current.x,
      y: e.evt.clientY - panStart.current.y,
    });
  }, []);

  const handleMouseUp = useCallback(() => { isPanning.current = false; }, []);

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}>
      <Stage
        ref={stageRef}
        width={containerRef.current?.offsetWidth || 800}
        height={containerRef.current?.offsetHeight || 600}
        scaleX={scale}
        scaleY={scale}
        x={pos.x}
        y={pos.y}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: isPanning.current ? 'grabbing' : 'default' }}
      >
        <Layer>
          <Rect x={-9999} y={-9999} width={19998} height={19998} fill="#deeef7" listening={false} />
          <PierLayer piers={piers} />
          <BerthLayer
            berths={berths}
            selectedBerthId={selectedBerthId}
            onBerthClick={onBerthClick}
          />
          <AmenityLayer
            amenities={amenities}
            onAmenityClick={onAmenityClick}
          />
        </Layer>
      </Stage>
      <div style={{
        position: 'absolute', bottom: 8, right: 8,
        fontSize: 11, color: '#999', userSelect: 'none', pointerEvents: 'none',
      }}>
        {Math.round(scale * 100)}%
      </div>
    </div>
  );
}
```

**Note:** The Stage `width`/`height` are set from the container ref. To make the stage resize with the container, wrap it in a `ResizeObserver` effect or use a fixed `100vw/100vh`. For now, use a simple effect:

Add this import and effect inside `LiveCanvas`:

```jsx
import { useRef, useCallback, useState, useEffect } from 'react';
// ... inside component:
const [size, setSize] = useState({ width: 800, height: 600 });
useEffect(() => {
  if (!containerRef.current) return;
  const ro = new ResizeObserver(entries => {
    const { width, height } = entries[0].contentRect;
    setSize({ width, height });
  });
  ro.observe(containerRef.current);
  return () => ro.disconnect();
}, []);
```

Replace `width={containerRef.current?.offsetWidth || 800}` with `width={size.width}` and same for height.

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/harbor-map/LiveCanvas.jsx
git commit -m "feat: add LiveCanvas react-konva component"
```

---

### Task 11: EditorCanvas — Stage, grid, toolbar, draft state

**Files:**
- Create: `frontend/src/components/harbor-map/EditorCanvas.jsx`

This task builds the scaffold. Tools are added in Tasks 12 and 13.

- [ ] **Step 1: Create EditorCanvas.jsx scaffold**

Create `frontend/src/components/harbor-map/EditorCanvas.jsx`:

```jsx
import { useRef, useCallback, useState, useEffect, useReducer } from 'react';
import { Stage, Layer, Rect, Line } from 'react-konva';
import PierLayer from './PierLayer';
import BerthLayer from './BerthLayer';
import AmenityLayer from './AmenityLayer';
import { CELL, AMENITY_TYPES } from './mapConstants';
import { findNearestEdge, berthFromSnap } from './edgeSnap';

const MIN_SCALE = 0.15;
const MAX_SCALE = 8;

// Draft state tracks only unsaved changes
const INITIAL_DRAFT = {
  piers: {},              // { [id]: { polygon_points } }
  newPiers: [],           // [{ code, label, polygon_points }]
  deletedPierIds: [],
  berths: {},             // { [id]: { canvas_x, canvas_y, canvas_rotation } }
  newAmenities: [],       // [{ type, label, canvas_x, canvas_y, scale, rotation }]
  amenities: {},          // { [id]: { canvas_x, canvas_y, scale, rotation } }
  deletedAmenityIds: [],
};

function draftReducer(state, action) {
  switch (action.type) {
    case 'UPDATE_BERTH':
      return { ...state, berths: { ...state.berths, [action.id]: { ...(state.berths[action.id] || {}), ...action.data } } };
    case 'UPDATE_PIER':
      return { ...state, piers: { ...state.piers, [action.id]: { ...(state.piers[action.id] || {}), ...action.data } } };
    case 'ADD_NEW_PIER':
      return { ...state, newPiers: [...state.newPiers, action.pier] };
    case 'DELETE_PIER':
      return { ...state, deletedPierIds: [...state.deletedPierIds, action.id] };
    case 'UPDATE_AMENITY':
      return { ...state, amenities: { ...state.amenities, [action.id]: { ...(state.amenities[action.id] || {}), ...action.data } } };
    case 'ADD_NEW_AMENITY':
      return { ...state, newAmenities: [...state.newAmenities, action.amenity] };
    case 'DELETE_AMENITY':
      return { ...state, deletedAmenityIds: [...state.deletedAmenityIds, action.id] };
    case 'RESET':
      return INITIAL_DRAFT;
    default:
      return state;
  }
}

function countChanges(draft) {
  return (
    Object.keys(draft.piers).length +
    draft.newPiers.length +
    draft.deletedPierIds.length +
    Object.keys(draft.berths).length +
    Object.keys(draft.amenities).length +
    draft.newAmenities.length +
    draft.deletedAmenityIds.length
  );
}

function GridLayer({ scale }) {
  const gSize = CELL * scale;
  return (
    <Layer listening={false}>
      <Line
        points={[]}
        stroke="#d8dde3"
        strokeWidth={0.5}
      />
    </Layer>
  );
}

export default function EditorCanvas({
  piers = [],
  berths = [],
  amenities = [],
  onSave,
}) {
  const stageRef = useRef();
  const containerRef = useRef();
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 60, y: 60 });
  const isPanning = useRef(false);
  const panStart = useRef(null);
  const [showGrid, setShowGrid] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  // Tool state
  const [tool, setTool] = useState('select'); // 'select' | 'drawPier' | 'addAmenity'
  const [showAmenityDropdown, setShowAmenityDropdown] = useState(false);

  // Selection state
  const [selectedBerthId, setSelectedBerthId] = useState(null);
  const [selectedAmenityId, setSelectedAmenityId] = useState(null);
  const [selectedPierId, setSelectedPierId] = useState(null);
  const [multiSelected, setMultiSelected] = useState({ berths: new Set(), amenities: new Set() });
  const [selectionRect, setSelectionRect] = useState(null);
  const selRectStart = useRef(null);

  // Pier drawing state
  const [drawVertices, setDrawVertices] = useState([]);
  const [mouseMeters, setMouseMeters] = useState(null);
  const [showPierForm, setShowPierForm] = useState(false);
  const [pendingPolygon, setPendingPolygon] = useState(null);
  const [pierFormData, setPierFormData] = useState({ code: '', label: '' });

  // Draft state
  const [draft, dispatch] = useReducer(draftReducer, INITIAL_DRAFT);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Escape key cancels pier drawing
  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') {
        setDrawVertices([]);
        setTool('select');
        setShowAmenityDropdown(false);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, []);

  const screenToMeters = useCallback((clientX, clientY) => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const stageBox = stage.container().getBoundingClientRect();
    const sx = (clientX - stageBox.left - stage.x()) / (stage.scaleX() * CELL);
    const sy = (clientY - stageBox.top  - stage.y()) / (stage.scaleY() * CELL);
    const snapped = Math.round(sx * 2) / 2; // snap to 0.5m grid
    const snappedY = Math.round(sy * 2) / 2;
    return { x: snapped, y: snappedY };
  }, []);

  const handleWheel = useCallback((e) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    const oldScale = stage.scaleX();
    const pointer = stage.getPointerPosition();
    const factor = e.evt.deltaY < 0 ? 1.12 : 0.89;
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, oldScale * factor));
    const mousePointTo = {
      x: (pointer.x - stage.x()) / oldScale,
      y: (pointer.y - stage.y()) / oldScale,
    };
    const newPos = {
      x: pointer.x - mousePointTo.x * newScale,
      y: pointer.y - mousePointTo.y * newScale,
    };
    setScale(newScale);
    setPos(newPos);
  }, []);

  const handleMouseDown = useCallback((e) => {
    if (e.evt.button === 1 || (e.evt.button === 0 && e.evt.altKey)) {
      e.evt.preventDefault();
      isPanning.current = true;
      panStart.current = { x: e.evt.clientX - pos.x, y: e.evt.clientY - pos.y };
      return;
    }
    if (tool === 'select' && e.target === stageRef.current) {
      const ptr = stageRef.current.getPointerPosition();
      selRectStart.current = {
        x: (ptr.x - pos.x) / scale,
        y: (ptr.y - pos.y) / scale,
      };
      setSelectionRect({ x: selRectStart.current.x, y: selRectStart.current.y, w: 0, h: 0 });
      setSelectedBerthId(null);
      setSelectedAmenityId(null);
      setSelectedPierId(null);
    }
  }, [pos, scale, tool]);

  const handleMouseMove = useCallback((e) => {
    if (isPanning.current && panStart.current) {
      setPos({ x: e.evt.clientX - panStart.current.x, y: e.evt.clientY - panStart.current.y });
      return;
    }
    if (tool === 'drawPier') {
      const m = screenToMeters(e.evt.clientX, e.evt.clientY);
      setMouseMeters(m);
    }
    if (selectionRect && selRectStart.current) {
      const ptr = stageRef.current.getPointerPosition();
      const cx = (ptr.x - pos.x) / scale;
      const cy = (ptr.y - pos.y) / scale;
      setSelectionRect({
        x: Math.min(selRectStart.current.x, cx),
        y: Math.min(selRectStart.current.y, cy),
        w: Math.abs(cx - selRectStart.current.x),
        h: Math.abs(cy - selRectStart.current.y),
      });
    }
  }, [tool, screenToMeters, selectionRect, pos, scale]);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
    if (selectionRect && selectionRect.w > 5) {
      const rx = selectionRect.x / CELL, ry = selectionRect.y / CELL;
      const rw = selectionRect.w / CELL, rh = selectionRect.h / CELL;
      const bIds = new Set(
        berths
          .filter(b => b.canvas_x != null &&
            b.canvas_x >= rx && b.canvas_x <= rx + rw &&
            b.canvas_y >= ry && b.canvas_y <= ry + rh)
          .map(b => b.id)
      );
      const aIds = new Set(
        amenities
          .filter(a => a.canvas_x != null &&
            a.canvas_x >= rx && a.canvas_x <= rx + rw &&
            a.canvas_y >= ry && a.canvas_y <= ry + rh)
          .map(a => a.id)
      );
      setMultiSelected({ berths: bIds, amenities: aIds });
    }
    setSelectionRect(null);
    selRectStart.current = null;
  }, [selectionRect, berths, amenities]);

  const handleStageClick = useCallback((e) => {
    if (e.target !== stageRef.current) return;
    if (tool === 'drawPier') {
      const m = screenToMeters(e.evt.clientX, e.evt.clientY);
      setDrawVertices(v => [...v, [m.x, m.y]]);
    }
  }, [tool, screenToMeters]);

  const handleStageDblClick = useCallback((e) => {
    if (tool !== 'drawPier') return;
    if (drawVertices.length >= 3) {
      setPendingPolygon([...drawVertices]);
      setDrawVertices([]);
      setTool('select');
      setShowPierForm(true);
    }
  }, [tool, drawVertices]);

  const handlePierFormSubmit = useCallback(() => {
    if (!pierFormData.code.trim() || !pendingPolygon) return;
    dispatch({ type: 'ADD_NEW_PIER', pier: {
      code: pierFormData.code.trim(),
      label: pierFormData.label.trim(),
      polygon_points: pendingPolygon,
    }});
    setShowPierForm(false);
    setPendingPolygon(null);
    setPierFormData({ code: '', label: '' });
  }, [pierFormData, pendingPolygon]);

  const handleBerthDrop = useCallback((e) => {
    e.preventDefault();
    const berthId = parseInt(e.dataTransfer.getData('berthId'), 10);
    if (!berthId) return;
    const stageBox = stageRef.current.container().getBoundingClientRect();
    const mx = (e.clientX - stageBox.left - pos.x) / (scale * CELL);
    const my = (e.clientY - stageBox.top  - pos.y) / (scale * CELL);
    const berth = berths.find(b => b.id === berthId);
    if (!berth) return;
    const lengthM = parseFloat(berth.length_m || 12);
    const beamM = parseFloat(berth.max_beam_m || 4);
    const snap = findNearestEdge(mx, my, piers);
    const placement = snap
      ? berthFromSnap(snap, lengthM, beamM)
      : { canvas_x: mx - lengthM / 2, canvas_y: my - beamM / 2, canvas_rotation: 0 };
    dispatch({ type: 'UPDATE_BERTH', id: berthId, data: placement });
  }, [berths, piers, pos, scale]);

  const handleAddAmenity = useCallback((type) => {
    const stage = stageRef.current;
    const cx = (size.width / 2 - stage.x()) / (scale * CELL);
    const cy = (size.height / 2 - stage.y()) / (scale * CELL);
    dispatch({ type: 'ADD_NEW_AMENITY', amenity: {
      type,
      label: '',
      canvas_x: cx,
      canvas_y: cy,
      scale: 1.0,
      rotation: 0,
    }});
    setShowAmenityDropdown(false);
    setTool('select');
  }, [size, scale, pos]);

  const handleBerthDragEnd = useCallback((id, data) => {
    if (multiSelected.berths.has(id) && multiSelected.berths.size > 1) {
      const orig = draft.berths[id] || berths.find(b => b.id === id);
      const dx = data.canvas_x - orig.canvas_x;
      const dy = data.canvas_y - orig.canvas_y;
      multiSelected.berths.forEach(bid => {
        const b = draft.berths[bid] || berths.find(b2 => b2.id === bid);
        dispatch({ type: 'UPDATE_BERTH', id: bid, data: {
          canvas_x: (b?.canvas_x || 0) + dx,
          canvas_y: (b?.canvas_y || 0) + dy,
        }});
      });
    } else {
      dispatch({ type: 'UPDATE_BERTH', id, data });
    }
  }, [multiSelected, draft.berths, berths]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(draft);
      dispatch({ type: 'RESET' });
    } catch (err) {
      setSaveError('Save failed — some changes may not have been applied.');
    } finally {
      setSaving(false);
    }
  };

  // Merge draft berths over base berths for rendering
  const mergedBerths = berths.map(b => ({
    ...b,
    ...(draft.berths[b.id] || {}),
  }));

  // Merge draft amenities over base amenities
  const mergedAmenities = [
    ...amenities
      .filter(a => !draft.deletedAmenityIds.includes(a.id))
      .map(a => ({ ...a, ...(draft.amenities[a.id] || {}) })),
    ...draft.newAmenities.map((a, i) => ({ ...a, id: `new-${i}` })),
  ];

  // Merge draft piers
  const mergedPiers = [
    ...piers
      .filter(p => !draft.deletedPierIds.includes(p.id))
      .map(p => ({ ...p, ...(draft.piers[p.id] || {}) })),
    ...draft.newPiers.map((p, i) => ({ ...p, id: `new-${i}` })),
  ];

  const changeCount = countChanges(draft);

  // Toolbar button style
  const btn = (active) => ({
    padding: '5px 12px', fontSize: 12, borderRadius: 5, cursor: 'pointer', fontWeight: active ? 700 : 500,
    background: active ? '#2563eb' : '#f1f5f9', color: active ? 'white' : '#374151',
    border: `1px solid ${active ? '#2563eb' : '#d1d5db'}`,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
        background: 'white', borderBottom: '1px solid #e5e7eb', flexShrink: 0, flexWrap: 'wrap',
      }}>
        <button style={btn(tool === 'select')} onClick={() => setTool('select')}>Select</button>
        <button style={btn(tool === 'drawPier')} onClick={() => { setTool('drawPier'); setDrawVertices([]); }}>Draw Pier</button>
        <div style={{ position: 'relative' }}>
          <button style={btn(tool === 'addAmenity')} onClick={() => setShowAmenityDropdown(v => !v)}>
            Add Amenity ▾
          </button>
          {showAmenityDropdown && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, zIndex: 100,
              background: 'white', border: '1px solid #e5e7eb', borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)', minWidth: 180, padding: 4,
            }}>
              {AMENITY_TYPES.map(({ value, label }) => (
                <div
                  key={value}
                  onClick={() => handleAddAmenity(value)}
                  style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 12, borderRadius: 4 }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f1f5f9'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  {label}
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ width: 1, height: 20, background: '#e5e7eb', margin: '0 4px' }} />
        <button style={btn(false)} onClick={() => setShowGrid(g => !g)}>
          Grid: {showGrid ? 'ON' : 'OFF'}
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {saveError && <span style={{ fontSize: 11, color: '#dc2626' }}>{saveError}</span>}
          {changeCount > 0 && (
            <>
              <button
                onClick={() => dispatch({ type: 'RESET' })}
                style={{ ...btn(false), color: '#6b7280' }}
              >
                Discard
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{ ...btn(true), opacity: saving ? 0.6 : 1 }}
              >
                {saving ? 'Saving…' : `Save (${changeCount} changes)`}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        style={{ flex: 1, position: 'relative', overflow: 'hidden' }}
        onDragOver={e => e.preventDefault()}
        onDrop={handleBerthDrop}
      >
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          scaleX={scale}
          scaleY={scale}
          x={pos.x}
          y={pos.y}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onClick={handleStageClick}
          onDblClick={handleStageDblClick}
          style={{ cursor: tool === 'drawPier' ? 'crosshair' : 'default' }}
        >
          {/* Background */}
          <Layer listening={false}>
            <Rect x={-9999} y={-9999} width={19998} height={19998} fill="#deeef7" />
            {showGrid && (() => {
              const lines = [];
              const gSize = CELL;
              for (let x = -500; x < 1000; x += gSize) {
                lines.push(<Line key={`v${x}`} points={[x, -10000, x, 10000]} stroke="#d8dde3" strokeWidth={1 / scale} listening={false} />);
              }
              for (let y = -500; y < 1000; y += gSize) {
                lines.push(<Line key={`h${y}`} points={[-10000, y, 10000, y]} stroke="#d8dde3" strokeWidth={1 / scale} listening={false} />);
              }
              return lines;
            })()}
          </Layer>

          {/* Content */}
          <Layer>
            <PierLayer
              piers={mergedPiers}
              selectedPierId={selectedPierId}
              onPierClick={p => { setSelectedPierId(p.id); setSelectedBerthId(null); setSelectedAmenityId(null); }}
              editMode
            />
            <BerthLayer
              berths={mergedBerths}
              selectedBerthId={selectedBerthId}
              onBerthClick={b => { setSelectedBerthId(b.id); setSelectedAmenityId(null); setSelectedPierId(null); }}
              editMode
              onDragEnd={handleBerthDragEnd}
              onTransformEnd={(id, data) => dispatch({ type: 'UPDATE_BERTH', id, data })}
            />
            <AmenityLayer
              amenities={mergedAmenities}
              selectedAmenityId={selectedAmenityId}
              onAmenityClick={a => { setSelectedAmenityId(a.id); setSelectedBerthId(null); setSelectedPierId(null); }}
              editMode
              onDragEnd={(id, data) => {
                if (typeof id === 'string' && id.startsWith('new-')) {
                  const idx = parseInt(id.replace('new-', ''));
                  dispatch({ type: 'UPDATE_NEW_AMENITY', idx, data });
                } else {
                  dispatch({ type: 'UPDATE_AMENITY', id, data });
                }
              }}
              onTransformEnd={(id, data) => {
                if (typeof id === 'string' && id.startsWith('new-')) {
                  const idx = parseInt(id.replace('new-', ''));
                  dispatch({ type: 'UPDATE_NEW_AMENITY', idx, data });
                } else {
                  dispatch({ type: 'UPDATE_AMENITY', id, data });
                }
              }}
            />

            {/* Pier draw preview */}
            {tool === 'drawPier' && drawVertices.length > 0 && (() => {
              const pts = drawVertices.flatMap(([x, y]) => [x * CELL, y * CELL]);
              if (mouseMeters) { pts.push(mouseMeters.x * CELL, mouseMeters.y * CELL); }
              return (
                <>
                  <Line points={pts} stroke="#2563eb" strokeWidth={2 / scale} dash={[6 / scale, 4 / scale]} listening={false} />
                  {drawVertices.map(([x, y], i) => (
                    <Rect key={i} x={x * CELL - 4 / scale} y={y * CELL - 4 / scale}
                      width={8 / scale} height={8 / scale}
                      fill="#2563eb" cornerRadius={2 / scale} listening={false} />
                  ))}
                </>
              );
            })()}

            {/* Rubber-band selection rect */}
            {selectionRect && selectionRect.w > 2 && (
              <Rect
                x={selectionRect.x} y={selectionRect.y}
                width={selectionRect.w} height={selectionRect.h}
                fill="rgba(37,99,235,0.08)"
                stroke="#2563eb" strokeWidth={1 / scale}
                dash={[4 / scale, 3 / scale]}
                listening={false}
              />
            )}
          </Layer>
        </Stage>

        {/* Pier delete button overlay */}
        {selectedPierId && (
          <div style={{
            position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)',
            background: 'white', border: '1px solid #fca5a5', borderRadius: 6,
            padding: '6px 14px', display: 'flex', gap: 8, alignItems: 'center',
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)', zIndex: 10,
          }}>
            <span style={{ fontSize: 12, color: '#374151' }}>Pier selected</span>
            <button
              onClick={() => {
                if (typeof selectedPierId !== 'string') {
                  dispatch({ type: 'DELETE_PIER', id: selectedPierId });
                }
                setSelectedPierId(null);
              }}
              style={{ fontSize: 12, color: '#dc2626', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
            >
              Delete Pier
            </button>
            <button
              onClick={() => setSelectedPierId(null)}
              style={{ fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              ✕
            </button>
          </div>
        )}

        {/* Pier form overlay */}
        {showPierForm && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            background: 'white', border: '1px solid #e5e7eb', borderRadius: 8,
            padding: 20, width: 280, boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: 20,
          }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Name this pier</div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 12, color: '#374151', display: 'block', marginBottom: 4 }}>Code *</label>
              <input
                autoFocus
                value={pierFormData.code}
                onChange={e => setPierFormData(d => ({ ...d, code: e.target.value }))}
                placeholder="e.g. A"
                style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 5, boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: '#374151', display: 'block', marginBottom: 4 }}>Label</label>
              <input
                value={pierFormData.label}
                onChange={e => setPierFormData(d => ({ ...d, label: e.target.value }))}
                placeholder="e.g. Pier A"
                style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 5, boxSizing: 'border-box' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowPierForm(false); setPendingPolygon(null); }}
                style={{ padding: '6px 14px', fontSize: 12, background: '#f1f5f9', border: '1px solid #d1d5db', borderRadius: 5, cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={handlePierFormSubmit} disabled={!pierFormData.code.trim()}
                style={{ padding: '6px 14px', fontSize: 12, background: '#2563eb', color: 'white', border: 'none', borderRadius: 5, cursor: 'pointer', opacity: pierFormData.code.trim() ? 1 : 0.5 }}>
                Add Pier
              </button>
            </div>
          </div>
        )}

        <div style={{
          position: 'absolute', bottom: 8, right: 8,
          fontSize: 11, color: '#999', userSelect: 'none', pointerEvents: 'none',
        }}>
          {Math.round(scale * 100)}%
          {tool === 'drawPier' && ' — Click to place vertices, double-click to close'}
        </div>
      </div>
    </div>
  );
}
```

Also add `UPDATE_NEW_AMENITY` to `draftReducer`:

```js
case 'UPDATE_NEW_AMENITY':
  return {
    ...state,
    newAmenities: state.newAmenities.map((a, i) => i === action.idx ? { ...a, ...action.data } : a),
  };
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/harbor-map/EditorCanvas.jsx
git commit -m "feat: add EditorCanvas with full tool suite and draft state"
```

---

### Task 12: Update MarinaMap.jsx + delete DigitalTwinCanvas

**Files:**
- Modify: `frontend/src/screens/MarinaMap.jsx`
- Delete: `frontend/src/components/harbor-map/DigitalTwinCanvas.jsx`

- [ ] **Step 1: Update MarinaMap.jsx**

Replace the entire contents of `frontend/src/screens/MarinaMap.jsx`:

```jsx
import { useState, useCallback } from 'react';
import { usePiers } from '../hooks/usePiers';
import { useBerths } from '../hooks/useBerths';
import { useAmenities } from '../hooks/useAmenities';
import LiveCanvas from '../components/harbor-map/LiveCanvas';
import EditorCanvas from '../components/harbor-map/EditorCanvas';
import BerthStatusSidebar from '../components/harbor-map/BerthStatusSidebar';
import UnmappedBerthsSidebar from '../components/harbor-map/UnmappedBerthsSidebar';
import DocksBerthsTab from '../components/harbor-map/DocksBerthsTab';
import api from '../api';

const tabStyle = (active) => ({
  padding: '8px 18px', cursor: 'pointer', fontSize: 13, fontWeight: active ? 700 : 500,
  color: active ? '#2563eb' : '#6b7280', background: 'none', border: 'none',
  borderBottom: active ? '2px solid #2563eb' : '2px solid transparent',
});

function BerthDetailPanel({ berth, onClose, onUpdateBerth }) {
  if (!berth) return null;
  return (
    <div style={{
      position: 'absolute', top: 16, right: 256, background: 'white',
      border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, width: 220,
      boxShadow: '0 4px 20px rgba(0,0,0,0.1)', zIndex: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{ fontWeight: 700, fontSize: 15 }}>{berth.code}</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: '#9ca3af' }}>×</button>
      </div>
      <div style={{ fontSize: 12, color: '#374151', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div><b>Status:</b> {berth.status}</div>
        <div><b>Dock:</b> {berth.pier_code}</div>
        {berth.length_m && <div><b>Length:</b> {berth.length_m}m</div>}
        {berth.max_beam_m && <div><b>Beam:</b> {berth.max_beam_m}m</div>}
        {berth.vessel_name && <div><b>Vessel:</b> {berth.vessel_name}</div>}
        {berth.price_per_night && <div><b>Rate:</b> €{berth.price_per_night}/night</div>}
      </div>
      <select
        value={berth.status}
        onChange={e => onUpdateBerth(berth.id, { status: e.target.value })}
        style={{ marginTop: 10, width: '100%', padding: '5px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 5 }}
      >
        {['available', 'occupied', 'reserved', 'maintenance'].map(s => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
    </div>
  );
}

export default function MarinaMap() {
  const [tab, setTab] = useState('live');
  const [selectedBerth, setSelectedBerth] = useState(null);

  const { piers, createPier, updatePier, deletePier, bulkGenerate } = usePiers();
  const { berths, updateBerth, deleteBerth, addBerths } = useBerths();
  const { amenities, createAmenity, updateAmenity, deleteAmenity } = useAmenities();

  const handleSave = useCallback(async (draft) => {
    const tasks = [];

    // Berths: PATCH each modified berth (canvas_x, canvas_y, canvas_rotation only)
    Object.entries(draft.berths).forEach(([id, data]) => {
      tasks.push(updateBerth(parseInt(id), data));
    });

    // Piers: PATCH modified, POST new, DELETE removed
    Object.entries(draft.piers).forEach(([id, data]) => {
      tasks.push(updatePier(parseInt(id), data));
    });
    draft.newPiers.forEach(pier => {
      tasks.push(createPier(pier));
    });
    draft.deletedPierIds.forEach(id => {
      tasks.push(deletePier(id));
    });

    // Amenities: PATCH modified, POST new, DELETE removed
    Object.entries(draft.amenities).forEach(([id, data]) => {
      tasks.push(updateAmenity(parseInt(id), data));
    });
    draft.newAmenities.forEach(amenity => {
      tasks.push(createAmenity(amenity));
    });
    draft.deletedAmenityIds.forEach(id => {
      tasks.push(deleteAmenity(id));
    });

    await Promise.all(tasks);
  }, [updateBerth, updatePier, createPier, deletePier, updateAmenity, createAmenity, deleteAmenity]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{
        display: 'flex', alignItems: 'center',
        borderBottom: '1px solid #e5e7eb', background: 'white', paddingLeft: 16, flexShrink: 0,
      }}>
        <button style={tabStyle(tab === 'live')}   onClick={() => setTab('live')}>Marina Map</button>
        <button style={tabStyle(tab === 'editor')} onClick={() => setTab('editor')}>Map Editor</button>
        <button style={tabStyle(tab === 'docks')}  onClick={() => setTab('docks')}>Docks & Berths</button>
      </div>

      {tab === 'live' && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <LiveCanvas
              piers={piers}
              berths={berths}
              amenities={amenities}
              selectedBerthId={selectedBerth?.id}
              onBerthClick={setSelectedBerth}
            />
            <BerthDetailPanel
              berth={selectedBerth}
              onClose={() => setSelectedBerth(null)}
              onUpdateBerth={updateBerth}
            />
          </div>
          <BerthStatusSidebar
            berths={berths}
            selectedBerthId={selectedBerth?.id}
            onBerthClick={setSelectedBerth}
          />
        </div>
      )}

      {tab === 'editor' && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <UnmappedBerthsSidebar berths={berths} piers={piers} />
          <div style={{ flex: 1, position: 'relative' }}>
            <EditorCanvas
              piers={piers}
              berths={berths}
              amenities={amenities}
              onSave={handleSave}
            />
          </div>
        </div>
      )}

      {tab === 'docks' && (
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <DocksBerthsTab
            piers={piers}
            berths={berths}
            onCreatePier={createPier}
            onUpdatePier={updatePier}
            onDeletePier={deletePier}
            onBulkGenerate={async (pierId, data) => {
              const created = await bulkGenerate(pierId, data);
              addBerths(created);
              return created;
            }}
            onUpdateBerth={updateBerth}
            onDeleteBerth={deleteBerth}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Delete DigitalTwinCanvas.jsx**

```bash
rm frontend/src/components/harbor-map/DigitalTwinCanvas.jsx
```

Verify no other file imports `DigitalTwinCanvas`:

```bash
grep -r "DigitalTwinCanvas" frontend/src/
```

Expected: no output.

- [ ] **Step 3: Start the dev server and verify all three tabs load**

```bash
npm run dev
```

Open the app in a browser:
1. **Marina Map tab** — should render a blue water background with any existing piers and berths
2. **Map Editor tab** — should show the toolbar (Select / Draw Pier / Add Amenity / Grid / Save)
3. **Docks & Berths tab** — unchanged, should still work as before

- [ ] **Step 4: Test core editor interactions manually**

1. **Grid toggle** — click "Grid: ON" button, verify grid appears/disappears
2. **Draw Pier** — click "Draw Pier", click 4+ points on canvas, double-click to close, enter code "TEST", click Add Pier — a grey polygon should appear on the canvas with "TEST" label
3. **Save** — verify "Save (N changes)" button appears and clicking it calls the API
4. **Berth drag from sidebar** — drag an unmapped berth from the left sidebar onto the canvas, verify it appears as a coloured rectangle
5. **Select + rotate** — click a placed berth, verify a rotation handle appears; drag the handle to rotate the berth
6. **Add Amenity** — click "Add Amenity ▾", select "Fuel Pump" — verify an icon appears at viewport center
7. **Discard** — make changes and click Discard, verify canvas reverts

- [ ] **Step 5: Commit**

```bash
git add frontend/src/screens/MarinaMap.jsx
git commit -m "feat: wire up LiveCanvas and EditorCanvas in MarinaMap, remove DigitalTwinCanvas"
```
