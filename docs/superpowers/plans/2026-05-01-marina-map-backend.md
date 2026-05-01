# Marina Map — Backend Redesign

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `Pier` and `Berth` models with canvas placement coordinates, upgrade all berth/pier endpoints to full CRUD, and add a bulk berth generator endpoint so the frontend digital twin can save and render real berth positions.

**Architecture:** `canvas_x`, `canvas_y`, `canvas_width`, `canvas_height`, `canvas_rotation` are added as nullable `FloatField`s to `Berth` — `null` means the berth is unmapped (appears in the editor sidebar). `Pier` gets `canvas_x`, `canvas_y`, `canvas_width`, `canvas_height` for its dock rectangle position. `PierListView` and `BerthListView` are upgraded to `ListCreateAPIView`; both get Detail views with DELETE. A new `BulkGenerateBerthsView` lives at `POST /piers/{pk}/bulk-generate/`. The existing `MarinaMapConfig` JSON blob continues to store decorative elements (water, buildings) — it is not removed.

**Tech Stack:** Django 6, DRF, `apps.berths`, PostgreSQL (dev: SQLite)

---

## File Map

| File | Action |
|---|---|
| `backend/apps/berths/models.py` | Add canvas fields to `Pier` + `Berth` |
| `backend/apps/berths/migrations/000X_canvas_fields.py` | Auto-generated |
| `backend/apps/berths/serializers.py` | Add canvas fields; add `BulkGenerateSerializer` |
| `backend/apps/berths/views.py` | `PierListCreateView`, `PierDetailView`, `BerthListCreateView`, `BerthDetailView` (with DELETE), `BulkGenerateBerthsView` |
| `backend/apps/berths/urls.py` | Add pier detail + bulk-generate URLs |
| `backend/apps/berths/tests.py` | Replace with comprehensive CRUD + bulk-generate tests |

---

### Task 1: Add canvas fields to Pier + Berth

**Files:**
- Modify: `backend/apps/berths/models.py`

- [ ] **Step 1: Add fields to Pier model**

Open `backend/apps/berths/models.py`. Find the `Pier` model (it has `marina`, `code`, `label`, `cx`). After the `cx` field, add:

```python
canvas_x = models.FloatField(default=0)
canvas_y = models.FloatField(default=0)
canvas_width = models.FloatField(default=40)
canvas_height = models.FloatField(default=8)
```

Leave `cx` in place — new code ignores it; a future migration can remove it.

- [ ] **Step 2: Add fields to Berth model**

In the same file, find the `Berth` model. After the `status` field, add:

```python
canvas_x = models.FloatField(null=True, blank=True)
canvas_y = models.FloatField(null=True, blank=True)
canvas_width = models.FloatField(default=4)
canvas_height = models.FloatField(default=12)
canvas_rotation = models.FloatField(default=0)
```

`canvas_x is None` → berth is unmapped (not yet placed on the digital twin).

- [ ] **Step 3: Generate and apply migration**

```bash
cd backend
python manage.py makemigrations berths --settings=config.settings.dev
python manage.py migrate --settings=config.settings.dev
python manage.py check --settings=config.settings.dev
```

Expected output ends with: `System check identified no issues (0 silenced).`

- [ ] **Step 4: Commit**

```bash
git add backend/apps/berths/models.py backend/apps/berths/migrations/
git commit -m "feat(map): add canvas placement fields to Pier and Berth models"
```

---

### Task 2: Replace serializers.py

**Files:**
- Modify: `backend/apps/berths/serializers.py`

- [ ] **Step 1: Write the new serializers**

Replace the entire content of `backend/apps/berths/serializers.py`:

```python
from rest_framework import serializers
from .models import Pier, Berth, MarinaMapConfig


class PierSerializer(serializers.ModelSerializer):
    berth_count = serializers.SerializerMethodField()

    class Meta:
        model = Pier
        fields = [
            'id', 'code', 'label',
            'canvas_x', 'canvas_y', 'canvas_width', 'canvas_height',
            'berth_count',
        ]
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
            'canvas_x', 'canvas_y', 'canvas_width', 'canvas_height', 'canvas_rotation',
            'unmapped',
        ]
        read_only_fields = ['id', 'pier_code', 'pier_label', 'vessel_name', 'unmapped']

    def get_unmapped(self, obj):
        return obj.canvas_x is None


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
            raise serializers.ValidationError({'end': 'end must be >= start'})
        if (data['end'] - data['start'] + 1) > 200:
            raise serializers.ValidationError({'end': 'Cannot generate more than 200 berths at once'})
        return data


class MarinaMapConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = MarinaMapConfig
        fields = ['config', 'updated_at']
        read_only_fields = ['updated_at']
```

- [ ] **Step 2: Verify no import errors**

```bash
cd backend
python manage.py check --settings=config.settings.dev
```

Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 3: Commit**

```bash
git add backend/apps/berths/serializers.py
git commit -m "feat(map): update berth/pier serializers with canvas fields + BulkGenerateSerializer"
```

---

### Task 3: Replace views.py

**Files:**
- Modify: `backend/apps/berths/views.py`

- [ ] **Step 1: Write the new views**

Replace the entire content of `backend/apps/berths/views.py`:

```python
from rest_framework import generics, status as http_status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django.shortcuts import get_object_or_404

from .models import Pier, Berth, MarinaMapConfig
from .serializers import (
    PierSerializer, BerthSerializer,
    BulkGenerateSerializer, MarinaMapConfigSerializer,
)


class PierListCreateView(generics.ListCreateAPIView):
    serializer_class = PierSerializer

    def get_queryset(self):
        return Pier.objects.filter(marina=self.request.user.marina).prefetch_related('berths')

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class PierDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = PierSerializer

    def get_queryset(self):
        return Pier.objects.filter(marina=self.request.user.marina)


class BerthListCreateView(generics.ListCreateAPIView):
    serializer_class = BerthSerializer
    filterset_fields = ['status', 'pier']

    def get_queryset(self):
        return Berth.objects.filter(marina=self.request.user.marina).select_related(
            'pier', 'vessel'
        )

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class BerthDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = BerthSerializer

    def get_queryset(self):
        return Berth.objects.filter(marina=self.request.user.marina)


class BulkGenerateBerthsView(APIView):
    """POST /piers/{pk}/bulk-generate/ — create many berths for a pier in one request."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        pier = get_object_or_404(Pier, pk=pk, marina=request.user.marina)
        ser = BulkGenerateSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=http_status.HTTP_400_BAD_REQUEST)

        d = ser.validated_data
        marina = request.user.marina

        existing_codes = set(
            Berth.objects.filter(marina=marina).values_list('code', flat=True)
        )

        to_create = []
        for i in range(d['start'], d['end'] + 1):
            code = f"{d['prefix']}{i}"
            if code not in existing_codes:
                to_create.append(Berth(
                    marina=marina,
                    pier=pier,
                    code=code,
                    length_m=d.get('length_m'),
                    max_beam_m=d.get('max_beam_m'),
                    max_draft_m=d.get('max_draft_m'),
                    price_per_night=d.get('price_per_night'),
                    amenities=d.get('amenities', []),
                    position_index=i,
                    # canvas coords intentionally None — unmapped until editor places them
                ))

        created = Berth.objects.bulk_create(to_create)
        # bulk_create doesn't return PKs on all backends; re-fetch to include ids
        codes = [b.code for b in created]
        created_with_ids = list(
            Berth.objects.filter(marina=marina, code__in=codes).select_related('pier', 'vessel')
        )
        return Response(
            BerthSerializer(created_with_ids, many=True).data,
            status=http_status.HTTP_201_CREATED,
        )


class MapConfigView(generics.RetrieveUpdateAPIView):
    serializer_class = MarinaMapConfigSerializer

    def get_object(self):
        obj, _ = MarinaMapConfig.objects.get_or_create(marina=self.request.user.marina)
        return obj
```

- [ ] **Step 2: Verify no import errors**

```bash
cd backend
python manage.py check --settings=config.settings.dev
```

- [ ] **Step 3: Commit**

```bash
git add backend/apps/berths/views.py
git commit -m "feat(map): pier/berth CRUD views + BulkGenerateBerthsView"
```

---

### Task 4: Update urls.py

**Files:**
- Modify: `backend/apps/berths/urls.py`

- [ ] **Step 1: Write new URL patterns**

Replace the entire content of `backend/apps/berths/urls.py`:

```python
from django.urls import path
from .views import (
    PierListCreateView, PierDetailView,
    BerthListCreateView, BerthDetailView,
    BulkGenerateBerthsView, MapConfigView,
)

urlpatterns = [
    path('piers/', PierListCreateView.as_view(), name='pier_list'),
    path('piers/<int:pk>/', PierDetailView.as_view(), name='pier_detail'),
    path('piers/<int:pk>/bulk-generate/', BulkGenerateBerthsView.as_view(), name='pier_bulk_generate'),
    path('berths/', BerthListCreateView.as_view(), name='berth_list'),
    path('berths/<int:pk>/', BerthDetailView.as_view(), name='berth_detail'),
    path('map/config/', MapConfigView.as_view(), name='map_config'),
]
```

- [ ] **Step 2: Smoke-check URLs resolve**

```bash
cd backend
python manage.py check --settings=config.settings.dev
```

- [ ] **Step 3: Commit**

```bash
git add backend/apps/berths/urls.py
git commit -m "feat(map): berths/piers URL patterns with CRUD + bulk-generate"
```

---

### Task 5: Write tests

**Files:**
- Modify: `backend/apps/berths/tests.py`

- [ ] **Step 1: Write the failing tests (red phase)**

Replace the entire content of `backend/apps/berths/tests.py`:

```python
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Marina, User
from apps.berths.models import Pier, Berth


def make_marina(name='Test Marina'):
    return Marina.objects.create(name=name, currency='EUR')


def make_user(marina):
    i = User.objects.count()
    return User.objects.create_user(
        email=f'user{i}@test.com', password='pass', marina=marina, role='owner'
    )


def auth(client, user):
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')


def make_pier(marina, code='A', **kwargs):
    return Pier.objects.create(marina=marina, code=code, **kwargs)


def make_berth(marina, pier, code='A1', **kwargs):
    return Berth.objects.create(marina=marina, pier=pier, code=code, **kwargs)


# ── Pier CRUD ─────────────────────────────────────────────────────────────────

class PierCRUDTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.client = APIClient()
        auth(self.client, self.user)

    def test_create_pier(self):
        resp = self.client.post('/api/v1/piers/', {
            'code': 'A', 'label': 'Pier Alpha',
            'canvas_x': 5, 'canvas_y': 10, 'canvas_width': 40, 'canvas_height': 8,
        })
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(Pier.objects.filter(code='A', marina=self.marina).exists())

    def test_list_piers(self):
        make_pier(self.marina, 'A')
        make_pier(self.marina, 'B')
        resp = self.client.get('/api/v1/piers/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.json()), 2)

    def test_pier_list_includes_berth_count(self):
        pier = make_pier(self.marina, 'A')
        make_berth(self.marina, pier, 'A1')
        make_berth(self.marina, pier, 'A2')
        resp = self.client.get('/api/v1/piers/')
        self.assertEqual(resp.json()[0]['berth_count'], 2)

    def test_update_pier_canvas_coords(self):
        pier = make_pier(self.marina, 'A')
        resp = self.client.patch(
            f'/api/v1/piers/{pier.id}/',
            {'canvas_x': 15.5, 'canvas_y': 20.0},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        pier.refresh_from_db()
        self.assertAlmostEqual(pier.canvas_x, 15.5)

    def test_delete_pier(self):
        pier = make_pier(self.marina, 'A')
        resp = self.client.delete(f'/api/v1/piers/{pier.id}/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Pier.objects.filter(id=pier.id).exists())

    def test_cannot_access_other_marina_pier(self):
        other = make_marina('Other')
        other_pier = make_pier(other, 'X')
        resp = self.client.get(f'/api/v1/piers/{other_pier.id}/')
        self.assertEqual(resp.status_code, 404)


# ── Berth CRUD ────────────────────────────────────────────────────────────────

class BerthCRUDTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.client = APIClient()
        auth(self.client, self.user)
        self.pier = make_pier(self.marina, 'A')

    def test_create_berth(self):
        resp = self.client.post('/api/v1/berths/', {
            'code': 'A1', 'pier': self.pier.id, 'length_m': '12.0', 'max_beam_m': '4.0',
        })
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(Berth.objects.filter(code='A1', marina=self.marina).exists())

    def test_new_berth_is_unmapped(self):
        berth = make_berth(self.marina, self.pier, 'A1')
        self.assertIsNone(berth.canvas_x)
        resp = self.client.get(f'/api/v1/berths/{berth.id}/')
        self.assertTrue(resp.json()['unmapped'])

    def test_update_canvas_coords_maps_berth(self):
        berth = make_berth(self.marina, self.pier, 'A1')
        resp = self.client.patch(f'/api/v1/berths/{berth.id}/', {
            'canvas_x': 6.0, 'canvas_y': 11.0,
            'canvas_width': 4.0, 'canvas_height': 12.0, 'canvas_rotation': 0,
        }, format='json')
        self.assertEqual(resp.status_code, 200)
        berth.refresh_from_db()
        self.assertAlmostEqual(berth.canvas_x, 6.0)
        self.assertFalse(resp.json()['unmapped'])

    def test_delete_berth(self):
        berth = make_berth(self.marina, self.pier, 'A1')
        resp = self.client.delete(f'/api/v1/berths/{berth.id}/')
        self.assertEqual(resp.status_code, 204)
        self.assertFalse(Berth.objects.filter(id=berth.id).exists())

    def test_filter_berths_by_pier(self):
        pier_b = make_pier(self.marina, 'B')
        make_berth(self.marina, self.pier, 'A1')
        make_berth(self.marina, pier_b, 'B1')
        resp = self.client.get(f'/api/v1/berths/?pier={self.pier.id}')
        self.assertEqual(resp.status_code, 200)
        codes = [b['code'] for b in resp.json()]
        self.assertIn('A1', codes)
        self.assertNotIn('B1', codes)

    def test_berth_serializer_includes_pier_code(self):
        berth = make_berth(self.marina, self.pier, 'A1')
        resp = self.client.get(f'/api/v1/berths/{berth.id}/')
        self.assertEqual(resp.json()['pier_code'], 'A')

    def test_cannot_access_other_marina_berth(self):
        other = make_marina('Other')
        other_pier = make_pier(other, 'X')
        other_berth = make_berth(other, other_pier, 'X1')
        resp = self.client.get(f'/api/v1/berths/{other_berth.id}/')
        self.assertEqual(resp.status_code, 404)


# ── Bulk Generate ─────────────────────────────────────────────────────────────

class BulkGenerateTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.client = APIClient()
        auth(self.client, self.user)
        self.pier = make_pier(self.marina, 'A')
        self.url = f'/api/v1/piers/{self.pier.id}/bulk-generate/'

    def test_generates_correct_count(self):
        resp = self.client.post(self.url, {
            'prefix': 'A', 'start': 1, 'end': 10,
            'length_m': '12.0', 'max_beam_m': '4.0', 'price_per_night': '50.00',
        })
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(len(resp.json()), 10)

    def test_generates_correct_codes(self):
        self.client.post(self.url, {'prefix': 'A', 'start': 1, 'end': 5})
        for i in range(1, 6):
            self.assertTrue(Berth.objects.filter(code=f'A{i}', marina=self.marina).exists())

    def test_generated_berths_are_unmapped(self):
        self.client.post(self.url, {'prefix': 'A', 'start': 1, 'end': 5})
        for berth in Berth.objects.filter(marina=self.marina):
            self.assertIsNone(berth.canvas_x)

    def test_skips_existing_codes(self):
        make_berth(self.marina, self.pier, 'A3')
        resp = self.client.post(self.url, {'prefix': 'A', 'start': 1, 'end': 5})
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(len(resp.json()), 4)  # A3 skipped

    def test_rejects_end_less_than_start(self):
        resp = self.client.post(self.url, {'prefix': 'A', 'start': 10, 'end': 5})
        self.assertEqual(resp.status_code, 400)

    def test_rejects_over_200_berths(self):
        resp = self.client.post(self.url, {'prefix': 'A', 'start': 1, 'end': 201})
        self.assertEqual(resp.status_code, 400)

    def test_cannot_generate_for_other_marina_pier(self):
        other = make_marina('Other')
        other_pier = make_pier(other, 'X')
        resp = self.client.post(
            f'/api/v1/piers/{other_pier.id}/bulk-generate/',
            {'prefix': 'X', 'start': 1, 'end': 5},
        )
        self.assertEqual(resp.status_code, 404)
```

- [ ] **Step 2: Run tests to verify they pass**

```bash
cd backend
python manage.py test apps.berths --settings=config.settings.dev -v 2 2>&1 | tail -10
```

Expected: all pass. If any fail, fix the implementation (not the tests).

- [ ] **Step 3: Run full suite**

```bash
python manage.py test --settings=config.settings.dev 2>&1 | tail -3
```

Expected: `OK` with no failures.

- [ ] **Step 4: Commit**

```bash
git add backend/apps/berths/tests.py
git commit -m "test(map): pier/berth CRUD + bulk-generate tests — all green"
```
