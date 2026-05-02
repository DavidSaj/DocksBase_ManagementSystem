# Map Editor Redesign — "City Builder" UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the marina map editor into a modular, grid-locked "city builder" with a 4-group asset panel, snap-to-grid, pier material types, persistent ghost slots, and a per-marina prefab library.

**Architecture:** Backend gets two new Pier fields (`pier_type`, `ghost_slots`) and a new `MapPrefab` model with a viewset. The frontend replaces `UnmappedBerthsSidebar` with a full `AssetPanel` containing 4 accordion groups, and rewires `EditorCanvas` for snap-to-grid drawing, material-type-aware pier creation, and prefab drag-and-drop.

**Tech Stack:** Django/DRF (backend), React + Konva (frontend), HTML5 Drag-and-Drop (panel ↔ canvas)

---

## File Map

**Create:**
- `backend/apps/berths/tests/test_pier_api.py`
- `backend/apps/berths/tests/test_prefab_api.py`
- `backend/apps/berths/migrations/0005_pier_type_ghost_slots.py` *(auto-generated)*
- `backend/apps/berths/migrations/0006_mapprefab.py` *(auto-generated)*
- `backend/apps/berths/migrations/0007_seed_base_prefabs.py`
- `frontend/src/components/harbor-map/gridSnap.js`
- `frontend/src/components/harbor-map/AssetPanel.jsx`
- `frontend/src/components/harbor-map/PrefabLibrary.jsx`
- `frontend/src/hooks/usePrefabs.js`

**Modify:**
- `backend/apps/berths/models.py` — add `pier_type`, `ghost_slots` to `Pier`; add `MapPrefab`
- `backend/apps/berths/serializers.py` — expose `pier_type`, `ghost_slots`; add `MapPrefabSerializer`
- `backend/apps/berths/views.py` — `{n}` resolution in `PierListCreateView`; add `MapPrefabViewSet`
- `backend/apps/berths/urls.py` — add prefab routes
- `frontend/src/components/harbor-map/mapConstants.js` — fine grid constants, pier type colors
- `frontend/src/components/harbor-map/PierLayer.jsx` — pier_type fill + ghost slot rendering
- `frontend/src/components/harbor-map/EditorCanvas.jsx` — snap-to-grid, pier_type state, floating confirm panel, simplified toolbar, prefab drop, ghost slot removal, amenity DnD
- `frontend/src/screens/MarinaMap.jsx` — wire AssetPanel, usePrefabs; retire UnmappedBerthsSidebar

**Retire:**
- `frontend/src/components/harbor-map/UnmappedBerthsSidebar.jsx` *(keep file, no longer imported)*

---

## Task 1: Pier model — add `pier_type` and `ghost_slots` fields

**Files:**
- Modify: `DocksBase_ManagementSystem/backend/apps/berths/models.py`
- Create: `DocksBase_ManagementSystem/backend/apps/berths/tests/test_pier_api.py`

- [ ] **Step 1: Write failing tests**

Create `DocksBase_ManagementSystem/backend/apps/berths/tests/test_pier_api.py`:

```python
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from apps.accounts.models import Marina, User
from apps.berths.models import Pier


def make_user_with_marina(email='owner@test.com'):
    marina = Marina.objects.create(name=f'Test Marina {email}')
    user = User.objects.create_user(email=email, password='testpass', marina=marina)
    return user, marina


def auth_client(user):
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return client


class PierTypeFieldTest(TestCase):
    def setUp(self):
        self.user, self.marina = make_user_with_marina()
        self.client = auth_client(self.user)

    def test_pier_type_defaults_to_concrete(self):
        pier = Pier.objects.create(
            marina=self.marina, code='A', polygon_points=[[0,0],[10,0],[10,5],[0,5]]
        )
        self.assertEqual(pier.pier_type, 'concrete')

    def test_pier_type_and_ghost_slots_in_api_response(self):
        resp = self.client.post('/api/v1/piers/', {
            'code': 'B',
            'pier_type': 'pontoon',
            'polygon_points': [[0,0],[10,0],[10,5],[0,5]],
            'ghost_slots': [],
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data['pier_type'], 'pontoon')
        self.assertEqual(data['ghost_slots'], [])

    def test_ghost_slots_persisted_and_patchable(self):
        pier = Pier.objects.create(
            marina=self.marina, code='C', polygon_points=[[0,0],[10,0],[10,5],[0,5]]
        )
        slots = [{'x': 5, 'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12}]
        resp = self.client.patch(
            f'/api/v1/piers/{pier.id}/',
            {'ghost_slots': slots},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        pier.refresh_from_db()
        self.assertEqual(pier.ghost_slots, slots)
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd DocksBase_ManagementSystem/backend
python manage.py test apps.berths.tests.test_pier_api -v 2
```
Expected: `AttributeError: type object 'Pier' has no attribute 'pier_type'`

- [ ] **Step 3: Add fields to Pier model**

In `DocksBase_ManagementSystem/backend/apps/berths/models.py`, replace the `Pier` class definition with:

```python
PIER_TYPE_CHOICES = [
    ('concrete', 'Concrete Pier'),
    ('pontoon',  'Wooden Pontoon'),
    ('land',     'Land / Grass'),
]


class Pier(models.Model):
    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='piers')
    code           = models.CharField(max_length=10)
    label          = models.CharField(max_length=50, blank=True)
    polygon_points = models.JSONField(default=list)
    pier_type      = models.CharField(max_length=20, choices=PIER_TYPE_CHOICES, default='concrete')
    ghost_slots    = models.JSONField(default=list)
    # ghost_slots format: [{ x, y, rotation, width_m, height_m }, ...]
    # x, y in metres (canvas origin). Removed when a real berth is dropped on the slot.

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

- [ ] **Step 4: Create and run migration**

```bash
cd DocksBase_ManagementSystem/backend
python manage.py makemigrations berths --name pier_type_ghost_slots
python manage.py migrate
```

- [ ] **Step 5: Run tests — verify they pass**

```bash
python manage.py test apps.berths.tests.test_pier_api -v 2
```
Expected: 3 tests PASS

- [ ] **Step 6: Commit**

```bash
git add DocksBase_ManagementSystem/backend/apps/berths/models.py \
        DocksBase_ManagementSystem/backend/apps/berths/migrations/0005_pier_type_ghost_slots.py \
        DocksBase_ManagementSystem/backend/apps/berths/tests/test_pier_api.py
git commit -m "feat(berths): add pier_type and ghost_slots fields to Pier model"
```

---

## Task 2: PierSerializer — expose new fields + `{n}` label resolution

**Files:**
- Modify: `DocksBase_ManagementSystem/backend/apps/berths/serializers.py`
- Modify: `DocksBase_ManagementSystem/backend/apps/berths/views.py`
- Modify: `DocksBase_ManagementSystem/backend/apps/berths/tests/test_pier_api.py`

- [ ] **Step 1: Add failing tests for serializer fields and {n} resolution**

Append to `DocksBase_ManagementSystem/backend/apps/berths/tests/test_pier_api.py`:

```python
class PierLabelTemplateTest(TestCase):
    def setUp(self):
        self.user, self.marina = make_user_with_marina('label@test.com')
        self.client = auth_client(self.user)

    def test_n_template_resolved_to_1_when_no_existing(self):
        resp = self.client.post('/api/v1/piers/', {
            'code': 'Pontoon {n}',
            'pier_type': 'pontoon',
            'polygon_points': [[0,0],[10,0],[10,5],[0,5]],
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['code'], 'Pontoon 1')

    def test_n_template_increments_when_collision(self):
        Pier.objects.create(marina=self.marina, code='Dock 1',
                            polygon_points=[[0,0],[5,0],[5,5],[0,5]])
        resp = self.client.post('/api/v1/piers/', {
            'code': 'Dock {n}',
            'pier_type': 'concrete',
            'polygon_points': [[0,0],[10,0],[10,5],[0,5]],
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['code'], 'Dock 2')

    def test_code_without_template_saved_as_is(self):
        resp = self.client.post('/api/v1/piers/', {
            'code': 'A',
            'pier_type': 'concrete',
            'polygon_points': [[0,0],[10,0],[10,5],[0,5]],
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.json()['code'], 'A')
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
python manage.py test apps.berths.tests.test_pier_api.PierLabelTemplateTest -v 2
```
Expected: FAIL — `pier_type` not in serializer fields

- [ ] **Step 3: Update PierSerializer**

Replace `PierSerializer` in `DocksBase_ManagementSystem/backend/apps/berths/serializers.py`:

```python
class PierSerializer(serializers.ModelSerializer):
    berth_count = serializers.SerializerMethodField()

    class Meta:
        model = Pier
        fields = [
            'id', 'code', 'label',
            'polygon_points',
            'pier_type',
            'ghost_slots',
            'berth_count',
        ]
        read_only_fields = ['id', 'berth_count']

    def get_berth_count(self, obj):
        return obj.berths.count()
```

- [ ] **Step 4: Add `resolve_pier_code` helper and override `perform_create` in `PierListCreateView`**

In `DocksBase_ManagementSystem/backend/apps/berths/views.py`, add the helper function after the imports block:

```python
def resolve_pier_code(marina, code_template):
    """Replace {n} in code_template with the next available integer for this marina."""
    if '{n}' not in code_template:
        return code_template
    parts = code_template.split('{n}')
    prefix, suffix = parts[0], parts[1]
    existing = set(
        Pier.objects.filter(marina=marina).values_list('code', flat=True)
    )
    n = 1
    while True:
        candidate = f'{prefix}{n}{suffix}'
        if candidate not in existing:
            return candidate
        n += 1
```

Then replace `PierListCreateView.perform_create`:

```python
class PierListCreateView(generics.ListCreateAPIView):
    serializer_class = PierSerializer
    pagination_class = None

    def get_queryset(self):
        return Pier.objects.filter(marina=self.request.user.marina).prefetch_related('berths')

    def perform_create(self, serializer):
        marina = self.request.user.marina
        raw_code = serializer.validated_data.get('code', '')
        resolved_code = resolve_pier_code(marina, raw_code)
        serializer.save(marina=marina, code=resolved_code)
```

- [ ] **Step 5: Run all pier tests**

```bash
python manage.py test apps.berths.tests.test_pier_api -v 2
```
Expected: All 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add DocksBase_ManagementSystem/backend/apps/berths/serializers.py \
        DocksBase_ManagementSystem/backend/apps/berths/views.py \
        DocksBase_ManagementSystem/backend/apps/berths/tests/test_pier_api.py
git commit -m "feat(berths): expose pier_type/ghost_slots in PierSerializer; resolve {n} in pier code"
```

---

## Task 3: MapPrefab model + serializer + viewset + URLs

**Files:**
- Modify: `DocksBase_ManagementSystem/backend/apps/berths/models.py`
- Modify: `DocksBase_ManagementSystem/backend/apps/berths/serializers.py`
- Modify: `DocksBase_ManagementSystem/backend/apps/berths/views.py`
- Modify: `DocksBase_ManagementSystem/backend/apps/berths/urls.py`
- Create: `DocksBase_ManagementSystem/backend/apps/berths/tests/test_prefab_api.py`

- [ ] **Step 1: Write failing tests**

Create `DocksBase_ManagementSystem/backend/apps/berths/tests/test_prefab_api.py`:

```python
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from apps.accounts.models import Marina, User
from apps.berths.models import MapPrefab


def make_user_with_marina(email='owner@test.com'):
    marina = Marina.objects.create(name=f'Test Marina {email}')
    user = User.objects.create_user(email=email, password='testpass', marina=marina)
    return user, marina


def auth_client(user):
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return client


SAMPLE_POLYGON = [[0,0],[10,0],[10,5],[0,5]]
SAMPLE_SLOTS = [{'x': 5, 'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12}]


class PrefabCRUDTest(TestCase):
    def setUp(self):
        self.user, self.marina = make_user_with_marina()
        self.client = auth_client(self.user)

    def test_create_custom_prefab(self):
        resp = self.client.post('/api/v1/prefabs/', {
            'name': 'My Dock',
            'pier_type': 'concrete',
            'polygon_points': SAMPLE_POLYGON,
            'berth_slots': SAMPLE_SLOTS,
            'label_template': 'My Dock {n}',
        }, format='json')
        self.assertEqual(resp.status_code, 201)
        data = resp.json()
        self.assertEqual(data['name'], 'My Dock')
        self.assertFalse(data['is_base'])
        self.assertTrue(MapPrefab.objects.filter(marina=self.marina, name='My Dock').exists())

    def test_list_returns_own_and_base_prefabs(self):
        MapPrefab.objects.create(
            marina=None, name='Base Prefab', pier_type='pontoon',
            polygon_points=SAMPLE_POLYGON, is_base=True,
        )
        MapPrefab.objects.create(
            marina=self.marina, name='Custom Prefab', pier_type='concrete',
            polygon_points=SAMPLE_POLYGON,
        )
        _, other_marina = make_user_with_marina('other@test.com')
        MapPrefab.objects.create(
            marina=other_marina, name='Other Marina Prefab', pier_type='concrete',
            polygon_points=SAMPLE_POLYGON,
        )
        resp = self.client.get('/api/v1/prefabs/')
        self.assertEqual(resp.status_code, 200)
        names = {p['name'] for p in resp.json()}
        self.assertIn('Base Prefab', names)
        self.assertIn('Custom Prefab', names)
        self.assertNotIn('Other Marina Prefab', names)

    def test_cannot_delete_base_prefab(self):
        base = MapPrefab.objects.create(
            marina=None, name='Base', pier_type='pontoon',
            polygon_points=SAMPLE_POLYGON, is_base=True,
        )
        resp = self.client.delete(f'/api/v1/prefabs/{base.id}/')
        self.assertEqual(resp.status_code, 403)
        self.assertTrue(MapPrefab.objects.filter(id=base.id).exists())

    def test_can_delete_own_prefab(self):
        prefab = MapPrefab.objects.create(
            marina=self.marina, name='To Delete', pier_type='concrete',
            polygon_points=SAMPLE_POLYGON,
        )
        resp = self.client.delete(f'/api/v1/prefabs/{prefab.id}/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(MapPrefab.objects.filter(id=prefab.id).exists())

    def test_cannot_access_other_marina_prefab(self):
        _, other_marina = make_user_with_marina('other2@test.com')
        other_prefab = MapPrefab.objects.create(
            marina=other_marina, name='Theirs', pier_type='concrete',
            polygon_points=SAMPLE_POLYGON,
        )
        resp = self.client.delete(f'/api/v1/prefabs/{other_prefab.id}/')
        self.assertEqual(resp.status_code, 404)
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
python manage.py test apps.berths.tests.test_prefab_api -v 2
```
Expected: `ImportError: cannot import name 'MapPrefab'`

- [ ] **Step 3: Add MapPrefab model**

Append to `DocksBase_ManagementSystem/backend/apps/berths/models.py` (after the `Amenity` class):

```python
class MapPrefab(models.Model):
    marina         = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='prefabs',
        null=True, blank=True,
    )  # null for is_base=True prefabs
    name           = models.CharField(max_length=100)
    pier_type      = models.CharField(max_length=20, choices=PIER_TYPE_CHOICES)
    polygon_points = models.JSONField()
    # Normalized to origin: bounding box min = [0,0]. Drop offset applied at render time.
    berth_slots    = models.JSONField(default=list)
    # format: [{ x, y, rotation, width_m, height_m }, ...] — also normalized to origin
    label_template = models.CharField(max_length=50, blank=True)
    is_base        = models.BooleanField(default=False)
    created_at     = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-is_base', 'name']

    def __str__(self):
        return f'Prefab: {self.name}'
```

- [ ] **Step 4: Create migration**

```bash
cd DocksBase_ManagementSystem/backend
python manage.py makemigrations berths --name mapprefab
python manage.py migrate
```

- [ ] **Step 5: Add MapPrefabSerializer**

Append to `DocksBase_ManagementSystem/backend/apps/berths/serializers.py`:

```python
from .models import Pier, Berth, MarinaMapConfig, Amenity, MapPrefab


class MapPrefabSerializer(serializers.ModelSerializer):
    class Meta:
        model = MapPrefab
        fields = [
            'id', 'name', 'pier_type',
            'polygon_points', 'berth_slots',
            'label_template', 'is_base', 'created_at',
        ]
        read_only_fields = ['id', 'is_base', 'created_at']
```

- [ ] **Step 6: Add MapPrefabViewSet**

In `DocksBase_ManagementSystem/backend/apps/berths/views.py`, add the import and viewset:

```python
from django.db.models import Q
from .models import Pier, Berth, MarinaMapConfig, Amenity, MapPrefab
from .serializers import (
    PierSerializer, BerthSerializer,
    BulkGenerateSerializer, MarinaMapConfigSerializer,
    AmenitySerializer, MapPrefabSerializer,
)
```

Append viewset:

```python
class MapPrefabViewSet(generics.ListCreateAPIView):
    serializer_class = MapPrefabSerializer
    pagination_class = None

    def get_queryset(self):
        marina = self.request.user.marina
        return MapPrefab.objects.filter(Q(marina=marina) | Q(is_base=True))

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina, is_base=False)


class MapPrefabDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = MapPrefabSerializer

    def get_queryset(self):
        marina = self.request.user.marina
        return MapPrefab.objects.filter(Q(marina=marina) | Q(is_base=True))

    def destroy(self, request, *args, **kwargs):
        obj = self.get_object()
        if obj.is_base:
            return Response(
                {'detail': 'Base prefabs cannot be deleted.'},
                status=http_status.HTTP_403_FORBIDDEN,
            )
        return super().destroy(request, *args, **kwargs)
```

- [ ] **Step 7: Add prefab URLs**

In `DocksBase_ManagementSystem/backend/apps/berths/urls.py`:

```python
from django.urls import path
from .views import (
    PierListCreateView, PierDetailView,
    BerthListCreateView, BerthDetailView,
    BulkGenerateBerthsView,
    MapConfigView,
    AmenityListCreateView, AmenityDetailView,
    MapPrefabViewSet, MapPrefabDetailView,
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
    path('prefabs/', MapPrefabViewSet.as_view(), name='prefab_list'),
    path('prefabs/<int:pk>/', MapPrefabDetailView.as_view(), name='prefab_detail'),
]
```

- [ ] **Step 8: Run all prefab tests**

```bash
python manage.py test apps.berths.tests.test_prefab_api -v 2
```
Expected: All 5 tests PASS

- [ ] **Step 9: Run full test suite**

```bash
python manage.py test apps.berths -v 2
```
Expected: All tests PASS

- [ ] **Step 10: Commit**

```bash
git add DocksBase_ManagementSystem/backend/apps/berths/models.py \
        DocksBase_ManagementSystem/backend/apps/berths/serializers.py \
        DocksBase_ManagementSystem/backend/apps/berths/views.py \
        DocksBase_ManagementSystem/backend/apps/berths/urls.py \
        DocksBase_ManagementSystem/backend/apps/berths/migrations/0006_mapprefab.py \
        DocksBase_ManagementSystem/backend/apps/berths/tests/test_prefab_api.py
git commit -m "feat(berths): add MapPrefab model, serializer, viewset, and routes"
```

---

## Task 4: Seed base prefabs via data migration

**Files:**
- Create: `DocksBase_ManagementSystem/backend/apps/berths/migrations/0007_seed_base_prefabs.py`

- [ ] **Step 1: Create the data migration file**

```bash
cd DocksBase_ManagementSystem/backend
python manage.py makemigrations berths --empty --name seed_base_prefabs
```

- [ ] **Step 2: Write the seed data**

Replace the generated empty migration at `DocksBase_ManagementSystem/backend/apps/berths/migrations/0007_seed_base_prefabs.py` with:

```python
from django.db import migrations

BASE_PREFABS = [
    {
        'name': 'Standard Pontoon (10 berths)',
        'pier_type': 'pontoon',
        'label_template': 'Pontoon {n}',
        'polygon_points': [[0,0],[30,0],[30,8],[0,8]],
        'berth_slots': [
            {'x': 3,  'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 9,  'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 15, 'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 21, 'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 27, 'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 3,  'y': 14, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 9,  'y': 14, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 15, 'y': 14, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 21, 'y': 14, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 27, 'y': 14, 'rotation': 0, 'width_m': 4, 'height_m': 12},
        ],
    },
    {
        'name': 'T-Dock End Piece',
        'pier_type': 'concrete',
        'label_template': 'T-Dock {n}',
        'polygon_points': [
            [6,0],[14,0],[14,6],[20,6],[20,12],[14,12],[14,18],[6,18],[6,12],[0,12],[0,6],[6,6]
        ],
        'berth_slots': [],
    },
    {
        'name': 'Parallel Docking Wall (6 berths)',
        'pier_type': 'concrete',
        'label_template': 'Dock {n}',
        'polygon_points': [[0,0],[36,0],[36,4],[0,4]],
        'berth_slots': [
            {'x': 3,  'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 9,  'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 15, 'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 21, 'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 27, 'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12},
            {'x': 33, 'y': -6, 'rotation': 0, 'width_m': 4, 'height_m': 12},
        ],
    },
    {
        'name': 'Grass Breakwater',
        'pier_type': 'land',
        'label_template': 'Breakwater {n}',
        'polygon_points': [[0,0],[50,0],[50,6],[0,6]],
        'berth_slots': [],
    },
]


def seed_prefabs(apps, schema_editor):
    MapPrefab = apps.get_model('berths', 'MapPrefab')
    for p in BASE_PREFABS:
        MapPrefab.objects.get_or_create(
            name=p['name'],
            is_base=True,
            defaults={
                'pier_type':      p['pier_type'],
                'label_template': p['label_template'],
                'polygon_points': p['polygon_points'],
                'berth_slots':    p['berth_slots'],
                'marina':         None,
            },
        )


def unseed_prefabs(apps, schema_editor):
    MapPrefab = apps.get_model('berths', 'MapPrefab')
    MapPrefab.objects.filter(is_base=True).delete()


class Migration(migrations.Migration):
    dependencies = [
        ('berths', '0006_mapprefab'),
    ]
    operations = [
        migrations.RunPython(seed_prefabs, unseed_prefabs),
    ]
```

- [ ] **Step 3: Run migration**

```bash
cd DocksBase_ManagementSystem/backend
python manage.py migrate
```

- [ ] **Step 4: Verify seeded data**

```bash
python manage.py shell -c "
from apps.berths.models import MapPrefab
print(list(MapPrefab.objects.filter(is_base=True).values_list('name', flat=True)))
"
```
Expected output:
```
['Standard Pontoon (10 berths)', 'T-Dock End Piece', 'Parallel Docking Wall (6 berths)', 'Grass Breakwater']
```

- [ ] **Step 5: Commit**

```bash
git add DocksBase_ManagementSystem/backend/apps/berths/migrations/0007_seed_base_prefabs.py
git commit -m "feat(berths): seed 4 base prefabs via data migration"
```

---

## Task 5: Frontend — `mapConstants.js` + `gridSnap.js`

**Files:**
- Modify: `DocksBase_ManagementSystem/frontend/src/components/harbor-map/mapConstants.js`
- Create: `DocksBase_ManagementSystem/frontend/src/components/harbor-map/gridSnap.js`

- [ ] **Step 1: Update mapConstants.js**

Replace the full contents of `DocksBase_ManagementSystem/frontend/src/components/harbor-map/mapConstants.js`:

```js
export const CELL = 20; // pixels per metre at scale 1

// Grid display
export const GRID_MINOR = CELL;      // line every 1m (fine)
export const GRID_MAJOR = CELL * 5;  // line every 5m (accent)

export const STATUS_COLORS = {
  available:   '#22c55e',
  occupied:    '#ef4444',
  reserved:    '#f59e0b',
  maintenance: '#6b7280',
};

export const PIER_TYPE_COLORS = {
  concrete: '#94a3b8',
  pontoon:  '#a16207',
  land:     '#86efac',
};

export const PIER_TYPES = [
  { value: 'concrete', label: 'Concrete Pier',  color: '#94a3b8' },
  { value: 'pontoon',  label: 'Wooden Pontoon', color: '#a16207' },
  { value: 'land',     label: 'Land / Grass',   color: '#86efac' },
];

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

- [ ] **Step 2: Create gridSnap.js**

Create `DocksBase_ManagementSystem/frontend/src/components/harbor-map/gridSnap.js`:

```js
// All marina coordinates are in metres. Snapping to 1m grid = Math.round.

export function snapToGrid(valueMetres) {
  return Math.round(valueMetres);
}

export function snapPointToGrid(x, y) {
  return [snapToGrid(x), snapToGrid(y)];
}
```

- [ ] **Step 3: Commit**

```bash
git add DocksBase_ManagementSystem/frontend/src/components/harbor-map/mapConstants.js \
        DocksBase_ManagementSystem/frontend/src/components/harbor-map/gridSnap.js
git commit -m "feat(map): add pier type colors/constants and grid snap utility"
```

---

## Task 6: PierLayer — `pier_type` fill colors + ghost slot rendering

**Files:**
- Modify: `DocksBase_ManagementSystem/frontend/src/components/harbor-map/PierLayer.jsx`

- [ ] **Step 1: Replace PierLayer.jsx**

```jsx
import { Layer, Line, Rect, Text, Group } from 'react-konva';
import { CELL, PIER_TYPE_COLORS } from './mapConstants';

function centroid(points) {
  const n = points.length;
  const cx = points.reduce((s, p) => s + p[0], 0) / n;
  const cy = points.reduce((s, p) => s + p[1], 0) / n;
  return [cx * CELL, cy * CELL];
}

export default function PierLayer({ piers = [], selectedPierId, onPierClick }) {
  return (
    <Layer>
      {piers.filter(p => p.polygon_points?.length >= 3).map(pier => {
        const pts = pier.polygon_points.flatMap(([x, y]) => [x * CELL, y * CELL]);
        const [cx, cy] = centroid(pier.polygon_points);
        const selected = pier.id === selectedPierId;
        const fillColor = PIER_TYPE_COLORS[pier.pier_type] || PIER_TYPE_COLORS.concrete;

        return (
          <Group key={pier.id}>
            {/* Pier polygon */}
            <Line
              points={pts}
              closed
              fill={fillColor}
              stroke={selected ? '#2563eb' : '#4a4a4a'}
              strokeWidth={selected ? 2 : 1}
              onClick={() => onPierClick?.(pier)}
              onTap={() => onPierClick?.(pier)}
            />

            {/* Ghost slot outlines */}
            {(pier.ghost_slots || []).map((slot, i) => (
              <Rect
                key={i}
                x={(slot.x - slot.width_m / 2) * CELL}
                y={(slot.y - slot.height_m / 2) * CELL}
                width={slot.width_m * CELL}
                height={slot.height_m * CELL}
                rotation={slot.rotation || 0}
                fill="transparent"
                stroke={fillColor}
                strokeWidth={1.5}
                dash={[5, 4]}
                listening={false}
              />
            ))}

            {/* Pier label */}
            <Text
              x={cx - 20} y={cy - 7}
              width={40} align="center"
              text={pier.code}
              fontSize={11} fill="#ffffff" fontStyle="bold"
              listening={false}
            />
          </Group>
        );
      })}
    </Layer>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add DocksBase_ManagementSystem/frontend/src/components/harbor-map/PierLayer.jsx
git commit -m "feat(map): PierLayer renders pier_type fill color and ghost slot dashed outlines"
```

---

## Task 7: EditorCanvas — snap-to-grid + `pier_type` state + floating confirm panel + simplified toolbar + amenity DnD

**Files:**
- Modify: `DocksBase_ManagementSystem/frontend/src/components/harbor-map/EditorCanvas.jsx`

- [ ] **Step 1: Replace EditorCanvas.jsx**

Replace the entire file with:

```jsx
import { useState, useRef, useEffect } from 'react';
import { Stage, Layer, Line, Circle, Rect } from 'react-konva';
import { CELL, GRID_MINOR, GRID_MAJOR, PIER_TYPE_COLORS, PIER_TYPES } from './mapConstants';
import { snapPointToGrid, snapToGrid } from './gridSnap';
import { findNearestEdge } from './edgeSnap';
import PierLayer from './PierLayer';
import BerthLayer from './BerthLayer';
import AmenityLayer from './AmenityLayer';

const CANVAS_W = 2000;
const CANVAS_H = 1500;

const EMPTY_DRAFT = {
  piers:             {},
  newPiers:          [],
  deletedPierIds:    [],
  berths:            {},
  amenities:         {},
  newAmenities:      [],
  deletedAmenityIds: [],
};

// ---------------------------------------------------------------------------
// GridLayer — two-tier: minor lines every 1m, major lines every 5m
// ---------------------------------------------------------------------------
function GridLayer({ width, height, scale }) {
  const lines = [];
  for (let x = 0; x <= width; x += GRID_MINOR) {
    const isMajor = x % GRID_MAJOR === 0;
    lines.push(
      <Line key={'v' + x} points={[x, 0, x, height]}
        stroke={isMajor ? '#cbd5e1' : '#e5e7eb'}
        strokeWidth={(isMajor ? 1 : 0.5) / scale}
        listening={false} />
    );
  }
  for (let y = 0; y <= height; y += GRID_MINOR) {
    const isMajor = y % GRID_MAJOR === 0;
    lines.push(
      <Line key={'h' + y} points={[0, y, width, y]}
        stroke={isMajor ? '#cbd5e1' : '#e5e7eb'}
        strokeWidth={(isMajor ? 1 : 0.5) / scale}
        listening={false} />
    );
  }
  return <Layer listening={false}>{lines}</Layer>;
}

// ---------------------------------------------------------------------------
// FloatingConfirmPanel — replaces window.prompt after polygon close
// ---------------------------------------------------------------------------
function FloatingConfirmPanel({ position, pierType, onConfirm, onCancel }) {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');

  return (
    <div style={{
      position: 'absolute',
      left: position.x + 10,
      top: position.y + 10,
      background: 'white',
      border: '1px solid #e2e8f0',
      borderRadius: 8,
      padding: 12,
      boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
      zIndex: 20,
      width: 200,
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8, color: '#374151' }}>
        New {PIER_TYPES.find(t => t.value === pierType)?.label || 'Pier'}
      </div>
      <input
        autoFocus
        placeholder="Code (e.g. A)"
        value={code}
        onChange={e => setCode(e.target.value)}
        style={{ width: '100%', padding: '4px 6px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, marginBottom: 6, boxSizing: 'border-box' }}
        onKeyDown={e => { if (e.key === 'Enter') onConfirm(code.trim(), label.trim()); if (e.key === 'Escape') onCancel(); }}
      />
      <input
        placeholder="Label (optional)"
        value={label}
        onChange={e => setLabel(e.target.value)}
        style={{ width: '100%', padding: '4px 6px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, marginBottom: 8, boxSizing: 'border-box' }}
        onKeyDown={e => { if (e.key === 'Enter') onConfirm(code.trim(), label.trim()); if (e.key === 'Escape') onCancel(); }}
      />
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={() => onConfirm(code.trim(), label.trim())}
          disabled={!code.trim()}
          style={{ flex: 1, background: '#2563eb', color: 'white', border: 'none', borderRadius: 4, padding: '5px 0', fontSize: 12, cursor: code.trim() ? 'pointer' : 'not-allowed' }}
        >Confirm</button>
        <button
          onClick={onCancel}
          style={{ flex: 1, background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, padding: '5px 0', fontSize: 12, cursor: 'pointer' }}
        >Cancel</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// findNearestGhostSlot — returns { pierId, slotIndex, slot } or null
// ---------------------------------------------------------------------------
function findNearestGhostSlot(piers, berthX, berthY, thresholdM = 1) {
  let best = null;
  for (const pier of piers) {
    for (let i = 0; i < (pier.ghost_slots?.length || 0); i++) {
      const slot = pier.ghost_slots[i];
      const dist = Math.hypot(slot.x - berthX, slot.y - berthY);
      if (dist <= thresholdM && (!best || dist < best.dist)) {
        best = { pierId: pier.id, slotIndex: i, slot, dist };
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// EditorCanvas
// ---------------------------------------------------------------------------
export default function EditorCanvas({
  piers = [], berths = [], amenities = [],
  onSave, onPierCreate, onPierDelete, onGhostSlotRemove,
  activePierType = 'concrete',
  prefabs = [],
}) {
  const [activeTool, setActiveTool]       = useState('select');
  const [gridOn, setGridOn]               = useState(true);
  const [selectedBerthId, setSelectedBerthId]     = useState(null);
  const [selectedAmenityId, setSelectedAmenityId] = useState(null);
  const [selectedPierId, setSelectedPierId]       = useState(null);
  const [draft, setDraft]                 = useState(EMPTY_DRAFT);
  const [drawingPoints, setDrawingPoints] = useState([]);
  const [cursorPos, setCursorPos]         = useState(null);
  const [confirmPanel, setConfirmPanel]   = useState(null); // { screenX, screenY, points }
  const [stageScale, setStageScale]       = useState(1);
  const [stagePos, setStagePos]           = useState({ x: 0, y: 0 });
  const isPanning    = useRef(false);
  const lastPointer  = useRef(null);
  const stageRef     = useRef(null);
  const containerRef = useRef(null);

  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setDrawingPoints([]);
        setCursorPos(null);
        setConfirmPanel(null);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const pendingCount =
    Object.keys(draft.piers).length + draft.newPiers.length + draft.deletedPierIds.length +
    Object.keys(draft.berths).length + Object.keys(draft.amenities).length +
    draft.newAmenities.length + draft.deletedAmenityIds.length;

  const mergedBerths = berths.map(b => {
    const override = draft.berths[b.id];
    return override ? { ...b, ...override } : b;
  });
  const mergedAmenities = [
    ...amenities.map(a => { const o = draft.amenities[a.id]; return o ? { ...a, ...o } : a; }),
    ...draft.newAmenities.map((a, i) => ({ ...a, id: `new-amenity-${i}` })),
  ];
  const mergedPiers = piers
    .filter(p => !draft.deletedPierIds.includes(p.id))
    .map(p => { const o = draft.piers[p.id]; return o ? { ...p, ...o } : p; });

  // --- Zoom / pan ---
  function handleWheel(e) {
    e.evt.preventDefault();
    const stage = stageRef.current;
    const oldScale = stageScale;
    const pointer = stage.getPointerPosition();
    const scaleBy = 1.08;
    const newScale = Math.max(0.2, Math.min(5, e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy));
    const mousePointTo = { x: (pointer.x - stagePos.x) / oldScale, y: (pointer.y - stagePos.y) / oldScale };
    setStageScale(newScale);
    setStagePos({ x: pointer.x - mousePointTo.x * newScale, y: pointer.y - mousePointTo.y * newScale });
  }
  function handleMouseDown(e) {
    if (e.evt.button === 1 || (e.evt.button === 0 && e.evt.altKey)) {
      isPanning.current = true;
      lastPointer.current = { x: e.evt.clientX, y: e.evt.clientY };
      e.evt.preventDefault();
    }
  }
  function handleMouseMove(e) {
    if (isPanning.current) {
      const dx = e.evt.clientX - lastPointer.current.x;
      const dy = e.evt.clientY - lastPointer.current.y;
      lastPointer.current = { x: e.evt.clientX, y: e.evt.clientY };
      setStagePos(prev => ({ x: prev.x + dx, y: prev.y + dy }));
      return;
    }
    if (activeTool === 'draw-pier' && drawingPoints.length > 0) {
      const pos = stageRef.current.getRelativePointerPosition();
      const rawX = pos.x / CELL, rawY = pos.y / CELL;
      setCursorPos({ x: snapToGrid(rawX), y: snapToGrid(rawY) });
    }
  }
  function handleMouseUp() { isPanning.current = false; }

  // --- Stage click ---
  function handleStageClick(e) {
    if (isPanning.current) return;
    if (e.target !== e.target.getStage() && e.target.name() !== 'background') return;
    if (activeTool === 'select') {
      setSelectedBerthId(null); setSelectedAmenityId(null); setSelectedPierId(null);
      return;
    }
    if (activeTool === 'draw-pier') {
      const pos = stageRef.current.getRelativePointerPosition();
      const [sx, sy] = snapPointToGrid(pos.x / CELL, pos.y / CELL);
      setDrawingPoints(prev => [...prev, [sx, sy]]);
    }
  }

  // --- Double-click: close polygon, show floating confirm panel ---
  function handleStageDblClick(e) {
    if (activeTool !== 'draw-pier' || drawingPoints.length < 3) return;
    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const lastPt = drawingPoints[drawingPoints.length - 1];
    const screenX = lastPt[0] * CELL * stageScale + stagePos.x + rect.left - rect.left;
    const screenY = lastPt[1] * CELL * stageScale + stagePos.y;
    setConfirmPanel({ screenX, screenY, points: drawingPoints });
    setDrawingPoints([]);
    setCursorPos(null);
  }

  function handleConfirmPier(code, label) {
    if (!code || !confirmPanel) return;
    onPierCreate?.({
      code,
      label,
      pier_type: activePierType,
      polygon_points: confirmPanel.points,
      ghost_slots: [],
    });
    setConfirmPanel(null);
  }

  // --- Select callbacks ---
  function handleBerthClick(berth)   { if (activeTool !== 'select') return; setSelectedBerthId(berth.id); setSelectedAmenityId(null); setSelectedPierId(null); }
  function handleAmenityClick(a)     { if (activeTool !== 'select') return; setSelectedAmenityId(a.id); setSelectedBerthId(null); setSelectedPierId(null); }
  function handlePierClick(pier)     { if (activeTool !== 'select') return; setSelectedPierId(pier.id); setSelectedBerthId(null); setSelectedAmenityId(null); }

  // --- Berth drag on canvas → snap to grid, check ghost slots ---
  function handleBerthDragEnd(id, x, y) {
    const [sx, sy] = snapPointToGrid(x, y);
    let finalX = sx, finalY = sy, finalRot = null;
    const ghostSnap = findNearestGhostSlot(mergedPiers, sx, sy);
    if (ghostSnap) {
      finalX = ghostSnap.slot.x;
      finalY = ghostSnap.slot.y;
      finalRot = ghostSnap.slot.rotation;
      onGhostSlotRemove?.(ghostSnap.pierId, ghostSnap.slotIndex);
    }
    setDraft(prev => ({
      ...prev,
      berths: {
        ...prev.berths,
        [id]: {
          ...(prev.berths[id] || {}),
          canvas_x: finalX,
          canvas_y: finalY,
          ...(finalRot !== null ? { canvas_rotation: finalRot } : {}),
        },
      },
    }));
  }

  // --- Amenity drag on canvas → snap to grid ---
  function handleAmenityDragEnd(id, x, y) {
    const [sx, sy] = snapPointToGrid(x, y);
    if (String(id).startsWith('new-amenity-')) {
      const idx = parseInt(id.replace('new-amenity-', ''), 10);
      setDraft(prev => { const arr = [...prev.newAmenities]; arr[idx] = { ...arr[idx], canvas_x: sx, canvas_y: sy }; return { ...prev, newAmenities: arr }; });
    } else {
      setDraft(prev => ({ ...prev, amenities: { ...prev.amenities, [id]: { ...(prev.amenities[id] || {}), canvas_x: sx, canvas_y: sy } } }));
    }
  }
  function handleAmenityTransformEnd(id, { canvas_x, canvas_y, rotation, scale }) {
    const [sx, sy] = snapPointToGrid(canvas_x, canvas_y);
    if (String(id).startsWith('new-amenity-')) {
      const idx = parseInt(id.replace('new-amenity-', ''), 10);
      setDraft(prev => { const arr = [...prev.newAmenities]; arr[idx] = { ...arr[idx], canvas_x: sx, canvas_y: sy, rotation, scale }; return { ...prev, newAmenities: arr }; });
    } else {
      setDraft(prev => ({ ...prev, amenities: { ...prev.amenities, [id]: { ...(prev.amenities[id] || {}), canvas_x: sx, canvas_y: sy, rotation, scale } } }));
    }
  }

  function handleDeletePier() {
    if (!selectedPierId) return;
    onPierDelete?.(selectedPierId);
    setSelectedPierId(null);
  }

  // --- HTML DnD: berth from sidebar, amenity from sidebar, prefab from sidebar ---
  function handleDragOver(e) { e.preventDefault(); }

  function handleDrop(e) {
    e.preventDefault();
    const container = containerRef.current;
    const rect = container.getBoundingClientRect();
    const dropPixelX = (e.clientX - rect.left - stagePos.x) / stageScale;
    const dropPixelY = (e.clientY - rect.top  - stagePos.y) / stageScale;
    const [dropMetreX, dropMetreY] = snapPointToGrid(dropPixelX / CELL, dropPixelY / CELL);

    const berthId     = e.dataTransfer.getData('berthId');
    const amenityType = e.dataTransfer.getData('amenityType');
    const prefabId    = e.dataTransfer.getData('prefabId');

    if (berthId) {
      // Edge snap first, fallback to grid snap
      let canvas_x = dropMetreX, canvas_y = dropMetreY, canvas_rotation = 0;
      for (const pier of mergedPiers) {
        const snap = findNearestEdge(pier.polygon_points, dropMetreX, dropMetreY, 2);
        if (snap) { canvas_x = snap.x; canvas_y = snap.y; canvas_rotation = snap.rotation; break; }
      }
      // Check ghost slot proximity
      const ghostSnap = findNearestGhostSlot(mergedPiers, canvas_x, canvas_y);
      if (ghostSnap) {
        canvas_x = ghostSnap.slot.x;
        canvas_y = ghostSnap.slot.y;
        canvas_rotation = ghostSnap.slot.rotation;
        onGhostSlotRemove?.(ghostSnap.pierId, ghostSnap.slotIndex);
      }
      setDraft(prev => ({ ...prev, berths: { ...prev.berths, [berthId]: { canvas_x, canvas_y, canvas_rotation } } }));
    }

    if (amenityType) {
      setDraft(prev => ({
        ...prev,
        newAmenities: [...prev.newAmenities, {
          type: amenityType, label: '',
          canvas_x: dropMetreX, canvas_y: dropMetreY,
          scale: 1, rotation: 0,
        }],
      }));
    }

    if (prefabId) {
      const prefab = prefabs.find(p => String(p.id) === prefabId);
      if (!prefab) return;
      const offsetPoints = prefab.polygon_points.map(([x, y]) => [x + dropMetreX, y + dropMetreY]);
      const offsetSlots  = prefab.berth_slots.map(s => ({ ...s, x: s.x + dropMetreX, y: s.y + dropMetreY }));
      onPierCreate?.({
        code:           prefab.label_template || prefab.name,
        label:          '',
        pier_type:      prefab.pier_type,
        polygon_points: offsetPoints,
        ghost_slots:    offsetSlots,
      });
    }
  }

  // --- Save / Discard ---
  async function handleSave()    { await onSave?.(draft); }
  function handleDiscard()       { setDraft(EMPTY_DRAFT); setSelectedBerthId(null); setSelectedAmenityId(null); setSelectedPierId(null); }

  // --- Draw-pier preview ---
  const previewPoints = (() => {
    if (activeTool !== 'draw-pier' || drawingPoints.length === 0 || !cursorPos) return null;
    const last = drawingPoints[drawingPoints.length - 1];
    return [last[0] * CELL, last[1] * CELL, cursorPos.x * CELL, cursorPos.y * CELL];
  })();
  const drawnPolyPoints = drawingPoints.flatMap(([x, y]) => [x * CELL, y * CELL]);

  function toolBtn(tool) {
    const active = activeTool === tool;
    return { padding: '4px 12px', borderRadius: 4, border: '1px solid #cbd5e1', cursor: 'pointer', fontSize: 13, background: active ? '#2563eb' : '#ffffff', color: active ? '#ffffff' : '#1e293b', fontWeight: active ? 600 : 400 };
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Simplified toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
        <button style={toolBtn('select')} onClick={() => setActiveTool('select')}>Select</button>

        {selectedPierId && (
          <button
            style={{ padding: '4px 12px', borderRadius: 4, border: '1px solid #ef4444', cursor: 'pointer', fontSize: 13, background: '#fee2e2', color: '#dc2626' }}
            onClick={handleDeletePier}
          >Delete Pier</button>
        )}

        <div style={{ width: 1, height: 24, background: '#e2e8f0', margin: '0 4px' }} />

        <button
          style={{ padding: '4px 12px', borderRadius: 4, border: '1px solid #cbd5e1', cursor: 'pointer', fontSize: 13, background: gridOn ? '#f0fdf4' : '#ffffff', color: gridOn ? '#166534' : '#1e293b' }}
          onClick={() => setGridOn(g => !g)}
        >Grid: {gridOn ? 'ON' : 'OFF'}</button>

        <div style={{ flex: 1 }} />

        <button
          style={{ padding: '4px 14px', borderRadius: 4, border: '1px solid #2563eb', cursor: 'pointer', fontSize: 13, background: '#2563eb', color: '#ffffff', fontWeight: 600 }}
          onClick={handleSave}
        >Save{pendingCount > 0 ? ` (${pendingCount} changes)` : ''}</button>
        <button
          style={{ padding: '4px 12px', borderRadius: 4, border: '1px solid #cbd5e1', cursor: 'pointer', fontSize: 13 }}
          onClick={handleDiscard}
        >Discard</button>
      </div>

      {/* Canvas area */}
      <div
        ref={containerRef}
        style={{ flex: 1, overflow: 'hidden', position: 'relative', cursor: activeTool === 'draw-pier' ? 'crosshair' : 'default' }}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <Stage
          ref={stageRef}
          width={containerRef.current?.clientWidth || 900}
          height={containerRef.current?.clientHeight || 600}
          scaleX={stageScale} scaleY={stageScale}
          x={stagePos.x} y={stagePos.y}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onClick={handleStageClick}
          onDblClick={handleStageDblClick}
        >
          <Layer>
            <Rect name="background" x={0} y={0} width={CANVAS_W} height={CANVAS_H} fill="#deeef7" listening={true} />
          </Layer>
          {gridOn && <GridLayer width={CANVAS_W} height={CANVAS_H} scale={stageScale} />}
          <PierLayer piers={mergedPiers} selectedPierId={selectedPierId} onPierClick={handlePierClick} />
          <BerthLayer berths={mergedBerths} selectedBerthId={selectedBerthId} onBerthClick={handleBerthClick} draggable={activeTool === 'select'} onBerthDragEnd={handleBerthDragEnd} />
          <AmenityLayer amenities={mergedAmenities} selectedAmenityId={selectedAmenityId} onAmenityClick={handleAmenityClick} draggable={activeTool === 'select'} onAmenityDragEnd={handleAmenityDragEnd} onAmenityTransformEnd={handleAmenityTransformEnd} />
          {activeTool === 'draw-pier' && (
            <Layer>
              {drawnPolyPoints.length >= 4 && (
                <Line points={drawnPolyPoints} stroke={PIER_TYPE_COLORS[activePierType] || '#2563eb'} strokeWidth={2 / stageScale} dash={[6 / stageScale, 3 / stageScale]} listening={false} />
              )}
              {previewPoints && (
                <Line points={previewPoints} stroke={PIER_TYPE_COLORS[activePierType] || '#2563eb'} strokeWidth={1.5 / stageScale} dash={[4 / stageScale, 4 / stageScale]} listening={false} />
              )}
              {drawingPoints.map(([x, y], i) => (
                <Circle key={i} x={x * CELL} y={y * CELL} radius={4 / stageScale} fill={PIER_TYPE_COLORS[activePierType] || '#2563eb'} listening={false} />
              ))}
            </Layer>
          )}
        </Stage>

        {/* Floating confirm panel after polygon close */}
        {confirmPanel && (
          <FloatingConfirmPanel
            position={{ x: confirmPanel.screenX, y: confirmPanel.screenY }}
            pierType={activePierType}
            onConfirm={handleConfirmPier}
            onCancel={() => setConfirmPanel(null)}
          />
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add DocksBase_ManagementSystem/frontend/src/components/harbor-map/EditorCanvas.jsx
git commit -m "feat(map): EditorCanvas snap-to-grid, floating pier confirm, prefab/amenity DnD, ghost slot removal"
```

---

## Task 8: `usePrefabs.js` hook

**Files:**
- Create: `DocksBase_ManagementSystem/frontend/src/hooks/usePrefabs.js`

- [ ] **Step 1: Create the hook**

Create `DocksBase_ManagementSystem/frontend/src/hooks/usePrefabs.js`:

```js
import { useState, useEffect, useCallback } from 'react';
import api from '../api';

export function usePrefabs() {
  const [prefabs, setPrefabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    api.get('/prefabs/')
      .then(r => { setPrefabs(r.data); setLoading(false); })
      .catch(e => { setError(e); setLoading(false); });
  }, []);

  const createPrefab = useCallback(async (data) => {
    const r = await api.post('/prefabs/', data);
    setPrefabs(prev => [...prev, r.data]);
    return r.data;
  }, []);

  const deletePrefab = useCallback(async (id) => {
    await api.delete(`/prefabs/${id}/`);
    setPrefabs(prev => prev.filter(p => p.id !== id));
  }, []);

  return { prefabs, loading, error, createPrefab, deletePrefab };
}
```

- [ ] **Step 2: Commit**

```bash
git add DocksBase_ManagementSystem/frontend/src/hooks/usePrefabs.js
git commit -m "feat(map): add usePrefabs hook for prefab CRUD"
```

---

## Task 9: `PrefabLibrary.jsx` — Group B component

**Files:**
- Create: `DocksBase_ManagementSystem/frontend/src/components/harbor-map/PrefabLibrary.jsx`

- [ ] **Step 1: Create PrefabLibrary.jsx**

Create `DocksBase_ManagementSystem/frontend/src/components/harbor-map/PrefabLibrary.jsx`:

```jsx
import { useState } from 'react';
import { PIER_TYPE_COLORS } from './mapConstants';

function PrefabThumbnail({ polygonPoints, pierType }) {
  const W = 80, H = 48, PAD = 4;
  if (!polygonPoints?.length) return <div style={{ width: W, height: H, background: '#f3f4f6', borderRadius: 4 }} />;
  const xs = polygonPoints.map(p => p[0]);
  const ys = polygonPoints.map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const scaleX = (W - PAD * 2) / (maxX - minX || 1);
  const scaleY = (H - PAD * 2) / (maxY - minY || 1);
  const s = Math.min(scaleX, scaleY);
  const pts = polygonPoints.map(([x, y]) =>
    `${PAD + (x - minX) * s},${PAD + (y - minY) * s}`
  ).join(' ');
  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      <polygon points={pts} fill={PIER_TYPE_COLORS[pierType] || '#94a3b8'} stroke="#6b7280" strokeWidth={1} />
    </svg>
  );
}

export default function PrefabLibrary({
  prefabs = [],
  selectedPier,           // the currently selected pier object (or null)
  pierBerths = [],        // berths belonging to selectedPier
  onSavePrefab,           // async (data) => void
  onDeletePrefab,         // (id) => void
}) {
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveName, setSaveName]         = useState('');
  const [saveTemplate, setSaveTemplate] = useState('');
  const [saving, setSaving]             = useState(false);

  async function handleSave() {
    if (!saveName.trim() || !selectedPier) return;
    // Normalize polygon_points to origin
    const pts = selectedPier.polygon_points;
    const minX = Math.min(...pts.map(p => p[0]));
    const minY = Math.min(...pts.map(p => p[1]));
    const normalizedPts = pts.map(([x, y]) => [x - minX, y - minY]);

    // Normalize berth slots to origin
    const slots = pierBerths
      .filter(b => b.canvas_x != null && b.canvas_y != null)
      .map(b => ({
        x:        b.canvas_x - minX,
        y:        b.canvas_y - minY,
        rotation: b.canvas_rotation || 0,
        width_m:  b.max_beam_m  || 4,
        height_m: b.length_m    || 12,
      }));

    setSaving(true);
    await onSavePrefab({
      name:           saveName.trim(),
      pier_type:      selectedPier.pier_type || 'concrete',
      polygon_points: normalizedPts,
      berth_slots:    slots,
      label_template: saveTemplate.trim(),
    });
    setSaving(false);
    setSaveName('');
    setSaveTemplate('');
    setShowSaveForm(false);
  }

  const inputStyle = {
    width: '100%', padding: '4px 6px', fontSize: 12,
    border: '1px solid #d1d5db', borderRadius: 4,
    boxSizing: 'border-box', marginBottom: 6,
  };

  return (
    <div>
      {/* Card grid */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: '6px 8px' }}>
        {prefabs.map(prefab => (
          <div
            key={prefab.id}
            draggable
            onDragStart={e => {
              e.dataTransfer.setData('prefabId', String(prefab.id));
              e.dataTransfer.effectAllowed = 'copy';
            }}
            style={{
              background: 'white', border: '1px solid #e5e7eb', borderRadius: 6,
              padding: 6, cursor: 'grab', position: 'relative',
            }}
          >
            <PrefabThumbnail polygonPoints={prefab.polygon_points} pierType={prefab.pier_type} />
            <div style={{ fontSize: 10, fontWeight: 600, color: '#374151', marginTop: 4, lineHeight: 1.3 }}>
              {prefab.name}
            </div>
            {prefab.is_base ? (
              <span style={{ position: 'absolute', top: 4, right: 4, fontSize: 10 }}>🔒</span>
            ) : (
              <button
                onClick={() => onDeletePrefab(prefab.id)}
                style={{
                  position: 'absolute', top: 2, right: 2,
                  background: 'none', border: 'none', cursor: 'pointer',
                  fontSize: 12, color: '#9ca3af', lineHeight: 1,
                }}
                title="Delete prefab"
              >×</button>
            )}
          </div>
        ))}
      </div>

      {/* Save current pier as prefab */}
      {selectedPier && !showSaveForm && (
        <div style={{ padding: '6px 8px' }}>
          <button
            onClick={() => { setShowSaveForm(true); setSaveTemplate(selectedPier.label || selectedPier.code); }}
            style={{
              width: '100%', background: '#f0fdf4', color: '#166534',
              border: '1px solid #bbf7d0', borderRadius: 5,
              padding: '5px 0', fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}
          >+ Save Selected Pier as Prefab</button>
        </div>
      )}

      {selectedPier && showSaveForm && (
        <div style={{ padding: '6px 8px', background: '#f9fafb', borderTop: '1px solid #e5e7eb' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', marginBottom: 6 }}>Save as Prefab</div>
          <input placeholder="Name (required)" value={saveName} onChange={e => setSaveName(e.target.value)} style={inputStyle} />
          <input placeholder="Label template (e.g. Pontoon {n})" value={saveTemplate} onChange={e => setSaveTemplate(e.target.value)} style={inputStyle} />
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleSave} disabled={!saveName.trim() || saving}
              style={{ flex: 1, background: '#2563eb', color: 'white', border: 'none', borderRadius: 4, padding: '5px 0', fontSize: 11, cursor: saveName.trim() ? 'pointer' : 'not-allowed' }}
            >{saving ? 'Saving…' : 'Save'}</button>
            <button
              onClick={() => setShowSaveForm(false)}
              style={{ flex: 1, background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, padding: '5px 0', fontSize: 11, cursor: 'pointer' }}
            >Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add DocksBase_ManagementSystem/frontend/src/components/harbor-map/PrefabLibrary.jsx
git commit -m "feat(map): add PrefabLibrary component with card grid, thumbnails, and save form"
```

---

## Task 10: `AssetPanel.jsx` — 4-group accordion panel

**Files:**
- Create: `DocksBase_ManagementSystem/frontend/src/components/harbor-map/AssetPanel.jsx`

- [ ] **Step 1: Create AssetPanel.jsx**

Create `DocksBase_ManagementSystem/frontend/src/components/harbor-map/AssetPanel.jsx`:

```jsx
import { useState } from 'react';
import { PIER_TYPES, AMENITY_TYPES } from './mapConstants';
import PrefabLibrary from './PrefabLibrary';

function AccordionSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: '1px solid #e5e7eb' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 12px', background: '#f9fafb', border: 'none', cursor: 'pointer',
          fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', letterSpacing: '0.05em',
        }}
      >
        {title}
        <span style={{ fontSize: 14, color: '#9ca3af' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

export default function AssetPanel({
  // Group A
  activePierType,
  onMaterialSelect,       // (pierType: string) => void — also activates draw-pier tool
  // Group B
  prefabs,
  selectedPier,           // pier object or null
  pierBerths,             // berths for selectedPier
  onSavePrefab,
  onDeletePrefab,
  // Group C
  berths,
  piers,
  // (no extra props needed for Group D — uses dataTransfer)
}) {
  const [berthSearch, setBerthSearch] = useState('');

  // --- Group C: unmapped berths grouped by pier ---
  const unmapped = berths.filter(
    b => b.canvas_x == null &&
    (berthSearch === '' || b.code.toLowerCase().includes(berthSearch.toLowerCase()))
  );
  const byPier = piers.reduce((acc, p) => { acc[p.id] = { pier: p, berths: [] }; return acc; }, {});
  byPier['__none'] = { pier: { code: 'No Dock', label: '' }, berths: [] };
  unmapped.forEach(b => {
    const key = b.pier ?? '__none';
    if (byPier[key]) byPier[key].berths.push(b);
    else byPier['__none'].berths.push(b);
  });
  const berthGroups = Object.values(byPier).filter(g => g.berths.length > 0);

  return (
    <div style={{
      width: 280, flexShrink: 0, borderRight: '1px solid #e5e7eb',
      display: 'flex', flexDirection: 'column', background: '#f9fafb', overflowY: 'auto',
    }}>

      {/* Group A — Infrastructure & Terrain */}
      <AccordionSection title="Infrastructure & Terrain">
        <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {PIER_TYPES.map(t => (
            <button
              key={t.value}
              onClick={() => onMaterialSelect(t.value)}
              style={{
                padding: '7px 12px', borderRadius: 20, border: `2px solid ${t.color}`,
                cursor: 'pointer', fontSize: 12, fontWeight: 600, textAlign: 'left',
                background: activePierType === t.value ? t.color : 'white',
                color: activePierType === t.value ? 'white' : '#374151',
              }}
            >
              <span style={{
                display: 'inline-block', width: 10, height: 10, borderRadius: '50%',
                background: t.color, marginRight: 8, verticalAlign: 'middle',
                border: activePierType === t.value ? '2px solid white' : 'none',
              }} />
              {t.label}
            </button>
          ))}
        </div>
      </AccordionSection>

      {/* Group B — Smart Prefabs */}
      <AccordionSection title={`Smart Prefabs (${prefabs.length})`}>
        <PrefabLibrary
          prefabs={prefabs}
          selectedPier={selectedPier}
          pierBerths={pierBerths}
          onSavePrefab={onSavePrefab}
          onDeletePrefab={onDeletePrefab}
        />
      </AccordionSection>

      {/* Group C — Unmapped Berths */}
      <AccordionSection title={`Unmapped Berths (${unmapped.length})`}>
        <div style={{ padding: '6px 10px 4px' }}>
          <input
            placeholder="Search…"
            value={berthSearch}
            onChange={e => setBerthSearch(e.target.value)}
            style={{ width: '100%', padding: '4px 8px', fontSize: 12, border: '1px solid #d1d5db', borderRadius: 4, boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ maxHeight: 240, overflowY: 'auto' }}>
          {berthGroups.length === 0 && (
            <div style={{ padding: 16, fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>All berths are placed.</div>
          )}
          {berthGroups.map(({ pier, berths: gb }) => (
            <div key={pier.id || '__none'}>
              <div style={{ padding: '5px 12px 2px', fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase' }}>
                {pier.label || pier.code}
              </div>
              {gb.map(berth => (
                <div
                  key={berth.id}
                  draggable
                  onDragStart={e => { e.dataTransfer.setData('berthId', String(berth.id)); e.dataTransfer.effectAllowed = 'move'; }}
                  style={{
                    padding: '5px 12px', margin: '2px 8px',
                    background: 'white', border: '1px solid #e5e7eb',
                    borderRadius: 4, fontSize: 12, fontWeight: 600,
                    cursor: 'grab', display: 'flex', alignItems: 'center', gap: 6,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#38a860', flexShrink: 0 }} />
                  {berth.code}
                  {berth.length_m && (
                    <span style={{ color: '#9ca3af', fontSize: 10, marginLeft: 'auto' }}>{berth.length_m}m</span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </AccordionSection>

      {/* Group D — Amenities */}
      <AccordionSection title="Amenities">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, padding: '8px 10px' }}>
          {AMENITY_TYPES.map(t => (
            <div
              key={t.value}
              draggable
              onDragStart={e => { e.dataTransfer.setData('amenityType', t.value); e.dataTransfer.effectAllowed = 'copy'; }}
              style={{
                padding: '6px 4px', background: 'white', border: '1px solid #e5e7eb',
                borderRadius: 6, cursor: 'grab', textAlign: 'center',
                fontSize: 10, color: '#374151', fontWeight: 500,
              }}
            >
              <div style={{ fontSize: 16, marginBottom: 2 }}>⚓</div>
              {t.label}
            </div>
          ))}
        </div>
      </AccordionSection>

    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add DocksBase_ManagementSystem/frontend/src/components/harbor-map/AssetPanel.jsx
git commit -m "feat(map): add AssetPanel with 4 accordion groups (terrain, prefabs, berths, amenities)"
```

---

## Task 11: `MarinaMap.jsx` — wire AssetPanel + `usePrefabs` + retire sidebar

**Files:**
- Modify: `DocksBase_ManagementSystem/frontend/src/screens/MarinaMap.jsx`

- [ ] **Step 1: Replace MarinaMap.jsx**

```jsx
import { useState } from 'react';
import { usePiers }    from '../hooks/usePiers';
import { useBerths }   from '../hooks/useBerths';
import { useAmenities } from '../hooks/useAmenities';
import { usePrefabs }  from '../hooks/usePrefabs';
import LiveCanvas      from '../components/harbor-map/LiveCanvas';
import EditorCanvas    from '../components/harbor-map/EditorCanvas';
import AssetPanel      from '../components/harbor-map/AssetPanel';
import BerthStatusSidebar from '../components/harbor-map/BerthStatusSidebar';
import DocksBerthsTab  from '../components/harbor-map/DocksBerthsTab';

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
  const [tab, setTab]               = useState('live');
  const [selectedBerth, setSelectedBerth] = useState(null);
  const [activePierType, setActivePierType] = useState('concrete');
  const [selectedPierId, setSelectedPierId] = useState(null);

  const { piers, createPier, updatePier, deletePier, bulkGenerate } = usePiers();
  const { berths, updateBerth, deleteBerth, addBerths, removeBerthsByPier } = useBerths();
  const { amenities, createAmenity, updateAmenity, deleteAmenity } = useAmenities();
  const { prefabs, createPrefab, deletePrefab } = usePrefabs();

  const selectedPier  = piers.find(p => p.id === selectedPierId) || null;
  const pierBerths    = selectedPierId ? berths.filter(b => b.pier === selectedPierId) : [];

  async function handleEditorSave(draft) {
    const berthUpdates   = Object.entries(draft.berths).map(([id, data]) => updateBerth(Number(id), data));
    const amenityUpdates = Object.entries(draft.amenities).map(([id, data]) => updateAmenity(Number(id), data));
    const amenityCreates = draft.newAmenities.map(data => createAmenity(data));
    const amenityDeletes = draft.deletedAmenityIds.map(id => deleteAmenity(id));
    const pierUpdates    = Object.entries(draft.piers).map(([id, data]) => updatePier(Number(id), data));
    await Promise.allSettled([...berthUpdates, ...amenityUpdates, ...amenityCreates, ...amenityDeletes, ...pierUpdates]);
  }

  function handlePierCreate(pierData) {
    createPier(pierData);
  }

  function handlePierDelete(pierId) {
    deletePier(pierId);
    removeBerthsByPier(pierId);
  }

  function handleMaterialSelect(pierType) {
    setActivePierType(pierType);
    // Signal to EditorCanvas to activate draw-pier mode.
    // EditorCanvas monitors activePierType changes via a ref-based approach;
    // this is handled inside EditorCanvas by checking if activeTool should switch.
    // We communicate via the activeTool prop exposed through onMaterialSelect.
  }

  function handleGhostSlotRemove(pierId, slotIndex) {
    const pier = piers.find(p => p.id === pierId);
    if (!pier) return;
    const newSlots = pier.ghost_slots.filter((_, i) => i !== slotIndex);
    updatePier(pierId, { ghost_slots: newSlots });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid #e5e7eb', background: 'white', paddingLeft: 16, flexShrink: 0 }}>
        <button style={tabStyle(tab === 'live')}   onClick={() => setTab('live')}>Marina Map</button>
        <button style={tabStyle(tab === 'editor')} onClick={() => setTab('editor')}>Map Editor</button>
        <button style={tabStyle(tab === 'docks')}  onClick={() => setTab('docks')}>Docks & Berths</button>
      </div>

      {tab === 'live' && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden', position: 'relative' }}>
          <div style={{ flex: 1, position: 'relative' }}>
            <LiveCanvas piers={piers} berths={berths} amenities={amenities} selectedBerthId={selectedBerth?.id} onBerthClick={setSelectedBerth} onAmenityClick={() => {}} />
            <BerthDetailPanel berth={selectedBerth} onClose={() => setSelectedBerth(null)} onUpdateBerth={updateBerth} />
          </div>
          <BerthStatusSidebar berths={berths} selectedBerthId={selectedBerth?.id} onBerthClick={setSelectedBerth} />
        </div>
      )}

      {tab === 'editor' && (
        <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
          <AssetPanel
            activePierType={activePierType}
            onMaterialSelect={(pierType) => { setActivePierType(pierType); }}
            prefabs={prefabs}
            selectedPier={selectedPier}
            pierBerths={pierBerths}
            onSavePrefab={createPrefab}
            onDeletePrefab={deletePrefab}
            berths={berths}
            piers={piers}
          />
          <div style={{ flex: 1, position: 'relative' }}>
            <EditorCanvas
              piers={piers}
              berths={berths}
              amenities={amenities}
              prefabs={prefabs}
              activePierType={activePierType}
              onSave={handleEditorSave}
              onPierCreate={handlePierCreate}
              onPierDelete={(id) => handlePierDelete(id)}
              onGhostSlotRemove={handleGhostSlotRemove}
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
            onDeletePier={(id) => handlePierDelete(id)}
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

- [ ] **Step 2: Wire `activeTool` switching from AssetPanel to EditorCanvas**

The `AssetPanel` calls `onMaterialSelect` when a terrain button is clicked. `EditorCanvas` needs to activate `draw-pier` mode when `activePierType` changes from outside. Add a `useEffect` to `EditorCanvas.jsx` directly after the `activePierType` prop is received:

In `EditorCanvas.jsx`, add this effect after the existing `useEffect` for keyboard:

```js
// When parent selects a material type, switch to draw-pier mode automatically
const prevPierTypeRef = useRef(activePierType);
useEffect(() => {
  if (activePierType !== prevPierTypeRef.current) {
    prevPierTypeRef.current = activePierType;
    setActiveTool('draw-pier');
  }
}, [activePierType]);
```

- [ ] **Step 3: Commit**

```bash
git add DocksBase_ManagementSystem/frontend/src/screens/MarinaMap.jsx \
        DocksBase_ManagementSystem/frontend/src/components/harbor-map/EditorCanvas.jsx
git commit -m "feat(map): wire AssetPanel, usePrefabs, and ghost slot removal into MarinaMap"
```

---

## Self-Review Checklist

- [x] **pier_type on Pier model** → Task 1 + 2
- [x] **ghost_slots on Pier model** → Task 1 + 2
- [x] **{n} label_template resolved on backend** → Task 2
- [x] **MapPrefab model + viewset** → Task 3
- [x] **Base prefabs seeded** → Task 4
- [x] **1m fine grid (minor/major lines)** → Task 5 + 7
- [x] **Snap-to-grid on vertex placement** → Task 7 (handleStageClick + handleMouseMove)
- [x] **Snap-to-grid on berth/amenity drag** → Task 7 (handleBerthDragEnd, handleAmenityDragEnd)
- [x] **Floating confirm panel replaces window.prompt** → Task 7
- [x] **Pier preview polygon in material color** → Task 7 (draw-pier overlay)
- [x] **PierLayer fill uses pier_type color** → Task 6
- [x] **Ghost slot dashed outlines from pier.ghost_slots** → Task 6
- [x] **Toolbar simplified (no Draw Pier, no amenity dropdown)** → Task 7
- [x] **AssetPanel Group A — terrain buttons activate draw-pier** → Task 10 + 11
- [x] **AssetPanel Group B — prefab card grid + save form** → Task 9 + 10
- [x] **AssetPanel Group C — unmapped berths queue** → Task 10
- [x] **AssetPanel Group D — amenity tiles with DnD** → Task 10
- [x] **Prefab drop: offset geometry, POST pier, persist ghost_slots** → Task 7
- [x] **Berth drop removes nearest ghost slot via PATCH** → Task 7 + 11
- [x] **Prefab save: normalize geometry + POST** → Task 9
- [x] **usePrefabs hook** → Task 8
- [x] **UnmappedBerthsSidebar retired** → Task 11 (no longer imported)
- [x] **Amenity drop from sidebar DnD** → Task 7 + 10
