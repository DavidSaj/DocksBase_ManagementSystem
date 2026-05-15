# AIS Phase 1 — Inbound ETA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-14-ais-vessel-tracking-design.md` (Phase 1)

**Goal:** Ship the AIS ingest pipeline + an Inbound ETA card on the Overview screen that shows incoming bookings with distance, ETA, and last-seen time, all driven by live MarineTraffic data.

**Architecture:** New `apps.ais` Django app holds the MarineTraffic adapter, a Celery beat task polling once a minute per configured marina, a `VesselPosition` model upserted per `(marina, mmsi)`, geometry helpers (haversine + point-in-polygon), and an `/api/v1/ais/inbound/` read endpoint. Frontend gets a `useInboundETAs` hook and an Overview card placed between Today's Weather and Checking Out Today.

**Tech Stack:** Django 5 + DRF, Celery + redis (already in the stack), `requests` (already in `requirements.txt`), React 18 (JSX), pytest / Django `TestCase`. No new dependencies.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/apps/ais/__init__.py` | Create | Empty — package marker |
| `backend/apps/ais/apps.py` | Create | Django AppConfig |
| `backend/apps/ais/models.py` | Create | `VesselPosition` |
| `backend/apps/ais/migrations/__init__.py` | Create | Empty |
| `backend/apps/ais/migrations/0001_initial.py` | Create | Handcrafted migration for `VesselPosition` |
| `backend/apps/accounts/models.py` | Modify | Add `basin_polygon` + `ais_poll_radius_nm` to `Marina` |
| `backend/apps/accounts/migrations/0028_marina_ais_fields.py` | Create | Migration for the two new Marina fields |
| `backend/apps/ais/geometry.py` | Create | `haversine_nm`, `bearing_deg`, `point_in_polygon` |
| `backend/apps/ais/adapters/__init__.py` | Create | Empty |
| `backend/apps/ais/adapters/base.py` | Create | `AISProvider` abstract + `AISReading` dataclass |
| `backend/apps/ais/adapters/marinetraffic.py` | Create | `MarineTrafficAdapter.fetch_positions(bbox)` |
| `backend/apps/ais/services.py` | Create | `upsert_position`, `get_inbound_etas` |
| `backend/apps/ais/tasks.py` | Create | Celery `poll_ais_for_all_marinas` + per-marina helper |
| `backend/apps/ais/serializers.py` | Create | `InboundETASerializer` |
| `backend/apps/ais/views.py` | Create | `InboundETAView` |
| `backend/apps/ais/urls.py` | Create | URL patterns |
| `backend/apps/ais/tests/__init__.py` | Create | Empty |
| `backend/apps/ais/tests/test_phase1.py` | Create | Full Phase 1 test suite |
| `backend/config/settings/base.py` | Modify | Add `apps.ais` to `LOCAL_APPS`, beat schedule entry |
| `backend/config/urls.py` | Modify | Include `apps.ais.urls` under `api/v1/ais/` |
| `frontend/src/hooks/useInboundETAs.js` | Create | Polls `/ais/inbound/` every 30 s |
| `frontend/src/screens/Overview.jsx` | Modify | Add `<InboundETACard />` between Today's Weather and Checking Out Today |
| `frontend/src/components/InboundETACard.jsx` | Create | Card component |

---

## Task 1: Scaffold `apps.ais` and register it

**Files:**
- Create: `backend/apps/ais/__init__.py`
- Create: `backend/apps/ais/apps.py`
- Create: `backend/apps/ais/migrations/__init__.py`
- Modify: `backend/config/settings/base.py`

- [ ] **Step 1: Create the package files**

Create empty file `backend/apps/ais/__init__.py`.

Create `backend/apps/ais/apps.py`:

```python
from django.apps import AppConfig


class AisConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.ais'
```

Create empty file `backend/apps/ais/migrations/__init__.py`.

- [ ] **Step 2: Register the app**

In `backend/config/settings/base.py`, locate the `LOCAL_APPS` list and add `'apps.ais'` at the end (immediately before the closing bracket).

- [ ] **Step 3: Verify Django sees the app**

Python isn't available on this dev server. Visually confirm by reading the file back. In CI / on the developer's laptop:

```bash
cd backend
python manage.py check
```

Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 4: Commit**

```bash
git add backend/apps/ais/__init__.py backend/apps/ais/apps.py backend/apps/ais/migrations/__init__.py backend/config/settings/base.py
git commit -m "feat(ais): scaffold apps.ais and register in LOCAL_APPS"
```

---

## Task 2: Geometry helpers + tests

**Files:**
- Create: `backend/apps/ais/geometry.py`
- Create: `backend/apps/ais/tests/__init__.py`
- Create: `backend/apps/ais/tests/test_phase1.py`

- [ ] **Step 1: Write failing tests**

Create empty `backend/apps/ais/tests/__init__.py`.

Create `backend/apps/ais/tests/test_phase1.py` with this opening block (we will append more test classes later):

```python
import math

from django.test import TestCase

from apps.ais.geometry import bearing_deg, haversine_nm, point_in_polygon


class GeometryTests(TestCase):
    def test_haversine_zero_distance(self):
        self.assertAlmostEqual(haversine_nm(52.0, 1.0, 52.0, 1.0), 0.0, places=3)

    def test_haversine_one_degree_latitude(self):
        # 1° of latitude ≈ 60 nautical miles (definition of nm).
        d = haversine_nm(52.0, 1.0, 53.0, 1.0)
        self.assertAlmostEqual(d, 60.0, delta=0.5)

    def test_haversine_known_pair(self):
        # Harwich (~51.945°N 1.283°E) to Felixstowe (~51.961°N 1.347°E)
        # is roughly 2.7 nm by sea — accept anything in [2.2, 3.2].
        d = haversine_nm(51.945, 1.283, 51.961, 1.347)
        self.assertGreater(d, 2.2)
        self.assertLess(d, 3.2)

    def test_bearing_due_north_is_zero(self):
        self.assertAlmostEqual(bearing_deg(52.0, 1.0, 53.0, 1.0), 0.0, delta=0.5)

    def test_bearing_due_east_is_90(self):
        self.assertAlmostEqual(bearing_deg(52.0, 1.0, 52.0, 2.0), 90.0, delta=0.5)

    def test_point_in_polygon_inside(self):
        # Simple square: [(0,0), (0,10), (10,10), (10,0)]
        poly = [(0.0, 0.0), (0.0, 10.0), (10.0, 10.0), (10.0, 0.0)]
        self.assertTrue(point_in_polygon(5.0, 5.0, poly))

    def test_point_in_polygon_outside(self):
        poly = [(0.0, 0.0), (0.0, 10.0), (10.0, 10.0), (10.0, 0.0)]
        self.assertFalse(point_in_polygon(15.0, 5.0, poly))

    def test_point_in_polygon_empty(self):
        self.assertFalse(point_in_polygon(5.0, 5.0, []))
```

- [ ] **Step 2: Run failing tests**

```bash
cd backend
python -m pytest apps/ais/tests/test_phase1.py::GeometryTests -v
```

Expected: ImportError or test failures — `apps.ais.geometry` doesn't exist yet.

- [ ] **Step 3: Implement the helpers**

Create `backend/apps/ais/geometry.py`:

```python
"""
Geographic helpers for AIS work.

All distances are in nautical miles (1 nm = 1852 m). All bearings are
compass-style: 0° = North, increasing clockwise, in the range [0, 360).
"""
from __future__ import annotations

import math

EARTH_RADIUS_NM = 3440.065  # mean earth radius in nautical miles


def haversine_nm(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance between two points, in nautical miles."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlng / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))
    return EARTH_RADIUS_NM * c


def bearing_deg(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """
    Initial compass bearing from (lat1, lng1) toward (lat2, lng2).
    Returns 0–360.
    """
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlng = math.radians(lng2 - lng1)
    y = math.sin(dlng) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dlng)
    brg = math.degrees(math.atan2(y, x))
    return (brg + 360) % 360


def point_in_polygon(lat: float, lng: float, polygon: list[tuple[float, float]]) -> bool:
    """
    Ray-casting test for whether (lat, lng) lies inside `polygon`.
    `polygon` is a list of (lat, lng) tuples; the last vertex implicitly
    connects to the first. Empty / <3-vertex polygons return False.
    """
    n = len(polygon)
    if n < 3:
        return False
    inside = False
    j = n - 1
    for i in range(n):
        lat_i, lng_i = polygon[i]
        lat_j, lng_j = polygon[j]
        intersect = ((lng_i > lng) != (lng_j > lng)) and (
            lat < (lat_j - lat_i) * (lng - lng_i) / (lng_j - lng_i + 1e-12) + lat_i
        )
        if intersect:
            inside = not inside
        j = i
    return inside
```

- [ ] **Step 4: Run tests, expect pass**

```bash
cd backend
python -m pytest apps/ais/tests/test_phase1.py::GeometryTests -v
```

Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/ais/geometry.py backend/apps/ais/tests/__init__.py backend/apps/ais/tests/test_phase1.py
git commit -m "feat(ais): geometry helpers (haversine, bearing, point-in-polygon)"
```

---

## Task 3: `VesselPosition` model + migration

**Files:**
- Create: `backend/apps/ais/models.py`
- Modify: `backend/apps/accounts/models.py`
- Create: `backend/apps/ais/migrations/0001_initial.py`
- Create: `backend/apps/accounts/migrations/0028_marina_ais_fields.py`

- [ ] **Step 1: Define `VesselPosition`**

Create `backend/apps/ais/models.py`:

```python
from django.db import models


class VesselPosition(models.Model):
    """
    Latest known AIS position for a vessel within a marina's tracking area.
    Upserted on every poll cycle; one row per (marina, mmsi).
    """

    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='ais_positions',
    )
    mmsi = models.CharField(max_length=20, db_index=True)
    vessel = models.ForeignKey(
        'vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='ais_positions',
        help_text='Set when MMSI matches a known marina vessel.',
    )

    lat         = models.DecimalField(max_digits=9, decimal_places=6)
    lng         = models.DecimalField(max_digits=9, decimal_places=6)
    speed_kn    = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    course_deg  = models.IntegerField(null=True, blank=True)
    heading_deg = models.IntegerField(null=True, blank=True)
    nav_status  = models.CharField(max_length=30, blank=True)

    reported_at = models.DateTimeField()
    received_at = models.DateTimeField(auto_now=True)
    source      = models.CharField(max_length=30, default='marinetraffic')

    # Set by event detection (Phase 2). Phase 1 always leaves this False.
    in_basin    = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['marina', 'mmsi'],
                name='ais_position_marina_mmsi_uniq',
            ),
        ]
        indexes = [
            models.Index(fields=['marina', '-reported_at'],
                         name='ais_position_marina_reported_idx'),
        ]

    def __str__(self):
        return f'{self.mmsi} @ {self.lat},{self.lng}'
```

- [ ] **Step 2: Extend `Marina` with AIS settings**

In `backend/apps/accounts/models.py`, find the existing AIS-adjacent fields (the `marinetraffic_api_key` line introduced in PR #50). Immediately after `openweathermap_api_key`, add:

```python
    basin_polygon = models.JSONField(
        default=list, blank=True,
        help_text='Marina basin polygon as list of [lat, lng] vertices. Used for AIS arrival detection.',
    )
    ais_poll_radius_nm = models.IntegerField(
        default=10,
        help_text='Bounding-box radius around marina lat/lng (nautical miles) used to query AIS providers.',
    )
```

- [ ] **Step 3: Handcraft the AIS app's initial migration**

(Python isn't available on the server, so we cannot run `makemigrations`. Handcraft it.)

Create `backend/apps/ais/migrations/0001_initial.py`:

```python
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('accounts', '0027_marina_integration_api_keys'),
        ('vessels', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='VesselPosition',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('mmsi', models.CharField(db_index=True, max_length=20)),
                ('lat', models.DecimalField(decimal_places=6, max_digits=9)),
                ('lng', models.DecimalField(decimal_places=6, max_digits=9)),
                ('speed_kn', models.DecimalField(blank=True, decimal_places=2, max_digits=5, null=True)),
                ('course_deg', models.IntegerField(blank=True, null=True)),
                ('heading_deg', models.IntegerField(blank=True, null=True)),
                ('nav_status', models.CharField(blank=True, max_length=30)),
                ('reported_at', models.DateTimeField()),
                ('received_at', models.DateTimeField(auto_now=True)),
                ('source', models.CharField(default='marinetraffic', max_length=30)),
                ('in_basin', models.BooleanField(default=False)),
                ('marina', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='ais_positions',
                    to='accounts.marina',
                )),
                ('vessel', models.ForeignKey(
                    blank=True, help_text='Set when MMSI matches a known marina vessel.',
                    null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name='ais_positions',
                    to='vessels.vessel',
                )),
            ],
            options={
                'constraints': [
                    models.UniqueConstraint(
                        fields=['marina', 'mmsi'],
                        name='ais_position_marina_mmsi_uniq',
                    ),
                ],
                'indexes': [
                    models.Index(
                        fields=['marina', '-reported_at'],
                        name='ais_position_marina_reported_idx',
                    ),
                ],
            },
        ),
    ]
```

The `vessels` dependency points at the initial migration since `vessels.Vessel` has existed since 0001. If you find a later `vessels` migration is required at apply time, bump the dependency to the latest existing one.

- [ ] **Step 4: Handcraft the Marina migration**

Create `backend/apps/accounts/migrations/0028_marina_ais_fields.py`:

```python
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0027_marina_integration_api_keys'),
    ]

    operations = [
        migrations.AddField(
            model_name='marina',
            name='basin_polygon',
            field=models.JSONField(
                blank=True, default=list,
                help_text='Marina basin polygon as list of [lat, lng] vertices. Used for AIS arrival detection.',
            ),
        ),
        migrations.AddField(
            model_name='marina',
            name='ais_poll_radius_nm',
            field=models.IntegerField(
                default=10,
                help_text='Bounding-box radius around marina lat/lng (nautical miles) used to query AIS providers.',
            ),
        ),
    ]
```

- [ ] **Step 5: Apply migrations (CI / dev machine)**

```bash
cd backend
python manage.py migrate accounts
python manage.py migrate ais
```

Expected: both applied cleanly.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/ais/models.py backend/apps/ais/migrations/0001_initial.py backend/apps/accounts/models.py backend/apps/accounts/migrations/0028_marina_ais_fields.py
git commit -m "feat(ais): VesselPosition model + Marina basin polygon and poll-radius fields"
```

---

## Task 4: Provider abstraction + MarineTraffic adapter

**Files:**
- Create: `backend/apps/ais/adapters/__init__.py`
- Create: `backend/apps/ais/adapters/base.py`
- Create: `backend/apps/ais/adapters/marinetraffic.py`

- [ ] **Step 1: Write failing adapter test**

Append to `backend/apps/ais/tests/test_phase1.py`:

```python
from datetime import datetime, timezone
from unittest.mock import patch, MagicMock

from apps.ais.adapters.base import AISReading
from apps.ais.adapters.marinetraffic import MarineTrafficAdapter


class MarineTrafficAdapterTests(TestCase):
    BBOX = (51.0, 53.0, 0.5, 2.5)  # minlat, maxlat, minlng, maxlng

    @patch('apps.ais.adapters.marinetraffic.requests.get')
    def test_fetch_positions_returns_readings(self, mock_get):
        # MT 'simple' protocol returns a list of dicts.
        mock_get.return_value = MagicMock(
            ok=True,
            status_code=200,
            json=lambda: [
                {
                    'MMSI': '227123456',
                    'LAT': '52.105',
                    'LON': '1.420',
                    'SPEED': '94',     # tenths of knots
                    'COURSE': '142',
                    'HEADING': '140',
                    'STATUS': '0',
                    'TIMESTAMP': '2026-05-14T15:04:00',
                },
            ],
        )
        adapter = MarineTrafficAdapter(api_key='fake')
        readings = adapter.fetch_positions(self.BBOX)
        self.assertEqual(len(readings), 1)
        r = readings[0]
        self.assertEqual(r.mmsi, '227123456')
        self.assertAlmostEqual(float(r.lat), 52.105, places=3)
        self.assertAlmostEqual(float(r.speed_kn), 9.4, places=1)
        self.assertEqual(r.reported_at.year, 2026)

    @patch('apps.ais.adapters.marinetraffic.requests.get')
    def test_fetch_positions_raises_on_4xx(self, mock_get):
        mock_get.return_value = MagicMock(ok=False, status_code=401, text='unauthorized')
        adapter = MarineTrafficAdapter(api_key='bad')
        with self.assertRaises(Exception):
            adapter.fetch_positions(self.BBOX)

    @patch('apps.ais.adapters.marinetraffic.requests.get')
    def test_fetch_positions_drops_malformed(self, mock_get):
        mock_get.return_value = MagicMock(
            ok=True, status_code=200,
            json=lambda: [
                {'MMSI': 'bad', 'LAT': 'x', 'LON': 'y'},  # malformed
                {'MMSI': '227000001', 'LAT': '52.1', 'LON': '1.0',
                 'SPEED': '0', 'COURSE': '0', 'HEADING': '0',
                 'STATUS': '5', 'TIMESTAMP': '2026-05-14T15:04:00'},
            ],
        )
        readings = MarineTrafficAdapter(api_key='fake').fetch_positions(self.BBOX)
        self.assertEqual(len(readings), 1)
        self.assertEqual(readings[0].mmsi, '227000001')
```

- [ ] **Step 2: Run tests, expect fail**

```bash
cd backend
python -m pytest apps/ais/tests/test_phase1.py::MarineTrafficAdapterTests -v
```

Expected: ImportError — adapters don't exist yet.

- [ ] **Step 3: Implement adapter base**

Create empty `backend/apps/ais/adapters/__init__.py`.

Create `backend/apps/ais/adapters/base.py`:

```python
"""
AIS provider abstraction.

Subclasses implement `fetch_positions(bbox)` returning a list of `AISReading`.
The rest of the AIS app reads only from `AISReading` / the protocol, so
swapping providers (Spire, FleetMon, …) is one file.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal


@dataclass
class AISReading:
    mmsi: str
    lat: Decimal
    lng: Decimal
    speed_kn: Decimal | None
    course_deg: int | None
    heading_deg: int | None
    nav_status: str
    reported_at: datetime  # timezone-aware


# bbox = (minlat, maxlat, minlng, maxlng)
BBox = tuple[float, float, float, float]


class AISProvider(ABC):
    @abstractmethod
    def fetch_positions(self, bbox: BBox) -> list[AISReading]:
        """Return all AIS contacts inside the bounding box."""
```

- [ ] **Step 4: Implement MarineTraffic adapter**

Create `backend/apps/ais/adapters/marinetraffic.py`:

```python
"""
MarineTraffic 'simple' export protocol.
Docs: https://www.marinetraffic.com/en/ais-api-services/detail/ps01
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from decimal import Decimal

import requests

from .base import AISProvider, AISReading, BBox

logger = logging.getLogger(__name__)

_TIMEOUT = 10


class MarineTrafficAdapter(AISProvider):
    BASE_URL = 'https://services.marinetraffic.com/api/exportvessels'

    def __init__(self, api_key: str):
        self.api_key = api_key

    def fetch_positions(self, bbox: BBox) -> list[AISReading]:
        minlat, maxlat, minlng, maxlng = bbox
        url = f'{self.BASE_URL}/v:8/{self.api_key}/'
        params = {
            'protocol': 'jsono',
            'msgtype': 'simple',
            'minlat': minlat, 'maxlat': maxlat,
            'minlon': minlng, 'maxlon': maxlng,
        }
        resp = requests.get(url, params=params, timeout=_TIMEOUT)
        if not resp.ok:
            raise RuntimeError(
                f'MarineTraffic API returned {resp.status_code}: {resp.text[:200]}'
            )
        return [r for r in (_parse_row(row) for row in resp.json()) if r is not None]


def _parse_row(row: dict) -> AISReading | None:
    try:
        return AISReading(
            mmsi=str(row['MMSI']),
            lat=Decimal(str(row['LAT'])),
            lng=Decimal(str(row['LON'])),
            speed_kn=(Decimal(str(row['SPEED'])) / Decimal('10')) if row.get('SPEED') not in (None, '') else None,
            course_deg=int(row['COURSE']) if row.get('COURSE') not in (None, '') else None,
            heading_deg=int(row['HEADING']) if row.get('HEADING') not in (None, '') else None,
            nav_status=str(row.get('STATUS') or ''),
            reported_at=_parse_ts(row['TIMESTAMP']),
        )
    except Exception:
        logger.warning('Skipping malformed MarineTraffic row: %s', row)
        return None


def _parse_ts(s: str) -> datetime:
    # MT format: 'YYYY-MM-DDTHH:MM:SS' in UTC.
    return datetime.strptime(s, '%Y-%m-%dT%H:%M:%S').replace(tzinfo=timezone.utc)
```

- [ ] **Step 5: Run adapter tests, expect pass**

```bash
cd backend
python -m pytest apps/ais/tests/test_phase1.py::MarineTrafficAdapterTests -v
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/ais/adapters/
git commit -m "feat(ais): AISProvider abstraction + MarineTraffic adapter"
```

---

## Task 5: `upsert_position` and `get_inbound_etas` service functions

**Files:**
- Create: `backend/apps/ais/services.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/apps/ais/tests/test_phase1.py`:

```python
from datetime import date, timedelta
from decimal import Decimal

from django.utils import timezone

from apps.accounts.models import Marina
from apps.vessels.models import Vessel
from apps.berths.models import Berth
from apps.reservations.models import Booking
from apps.ais.adapters.base import AISReading
from apps.ais.models import VesselPosition
from apps.ais.services import get_inbound_etas, upsert_position


def _make_reading(mmsi='227123456', lat=52.0, lng=1.0, speed=10.0):
    return AISReading(
        mmsi=mmsi,
        lat=Decimal(str(lat)),
        lng=Decimal(str(lng)),
        speed_kn=Decimal(str(speed)),
        course_deg=0, heading_deg=0, nav_status='',
        reported_at=timezone.now(),
    )


class UpsertPositionTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Harwich', lat=Decimal('51.945'), lng=Decimal('1.283'))
        self.vessel = Vessel.objects.create(marina=self.marina, name='Wanderer', mmsi='227123456')

    def test_first_upsert_creates_row(self):
        reading = _make_reading()
        pos = upsert_position(self.marina, reading, vessel=self.vessel)
        self.assertEqual(VesselPosition.objects.count(), 1)
        self.assertEqual(pos.vessel_id, self.vessel.id)

    def test_second_upsert_updates_in_place(self):
        upsert_position(self.marina, _make_reading(lat=52.0))
        upsert_position(self.marina, _make_reading(lat=52.5))
        self.assertEqual(VesselPosition.objects.count(), 1)
        pos = VesselPosition.objects.get()
        self.assertAlmostEqual(float(pos.lat), 52.5, places=3)

    def test_unmatched_mmsi_leaves_vessel_null(self):
        upsert_position(self.marina, _make_reading(mmsi='999999999'))
        pos = VesselPosition.objects.get(mmsi='999999999')
        self.assertIsNone(pos.vessel_id)


class GetInboundETAsTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Harwich', lat=Decimal('51.945'), lng=Decimal('1.283'))
        self.vessel = Vessel.objects.create(marina=self.marina, name='Wanderer', mmsi='227123456')
        self.berth = Berth.objects.create(marina=self.marina, code='A1')
        self.booking = Booking.objects.create(
            marina=self.marina, berth=self.berth, vessel=self.vessel,
            check_in=date.today(), check_out=date.today() + timedelta(days=1),
            status='confirmed',
        )

    def test_inbound_returns_booking_with_eta(self):
        upsert_position(self.marina, _make_reading(lat=52.0, lng=1.5, speed=10.0))
        rows = get_inbound_etas(self.marina)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['booking_id'], self.booking.id)
        self.assertGreater(rows[0]['distance_nm'], 0)
        self.assertGreater(rows[0]['eta_minutes'], 0)

    def test_no_ais_returns_empty(self):
        self.assertEqual(get_inbound_etas(self.marina), [])

    def test_other_marina_invisible(self):
        other = Marina.objects.create(name='Felixstowe', lat=Decimal('51.961'), lng=Decimal('1.347'))
        upsert_position(other, _make_reading())
        self.assertEqual(get_inbound_etas(self.marina), [])

    def test_distant_vessel_filtered_out(self):
        # 60 nm north of Harwich — outside the 50 nm default.
        upsert_position(self.marina, _make_reading(lat=53.0, lng=1.283, speed=8))
        self.assertEqual(get_inbound_etas(self.marina, max_distance_nm=50), [])
```

- [ ] **Step 2: Run, expect fail**

```bash
cd backend
python -m pytest apps/ais/tests/test_phase1.py::UpsertPositionTests apps/ais/tests/test_phase1.py::GetInboundETAsTests -v
```

Expected: ImportError — `services` doesn't exist yet.

- [ ] **Step 3: Implement services**

Create `backend/apps/ais/services.py`:

```python
"""
AIS service layer — small functions called by the poll task and read API.
"""
from __future__ import annotations

import logging
from datetime import date, timedelta
from decimal import Decimal

from django.utils import timezone

from apps.ais.adapters.base import AISReading
from apps.ais.geometry import bearing_deg, haversine_nm
from apps.ais.models import VesselPosition
from apps.reservations.models import Booking

logger = logging.getLogger(__name__)


def upsert_position(marina, reading: AISReading, vessel=None) -> VesselPosition:
    """
    Insert or update the latest position for (marina, mmsi).

    `vessel` is passed in by the caller — the batch poll path in tasks.py
    pre-fetches all marina vessels in one query before looping over the
    readings, so we never do per-row vessel SELECTs from inside this
    function. If `None` is passed the position is recorded with no vessel
    link (legitimate case for AIS-only transients).
    """
    obj, _ = VesselPosition.objects.update_or_create(
        marina=marina, mmsi=reading.mmsi,
        defaults={
            'lat':         reading.lat,
            'lng':         reading.lng,
            'speed_kn':    reading.speed_kn,
            'course_deg':  reading.course_deg,
            'heading_deg': reading.heading_deg,
            'nav_status':  reading.nav_status,
            'reported_at': reading.reported_at,
            'vessel':      vessel,
            'source':      'marinetraffic',
        },
    )
    return obj


def get_inbound_etas(
    marina, *,
    horizon_hours: int = 24,
    max_distance_nm: float = 50.0,
):
    """
    Bookings within the next `horizon_hours` whose linked vessel has a
    recent AIS contact within `max_distance_nm` of the marina. Sorted by
    closest ETA first.
    """
    if marina.lat is None or marina.lng is None:
        return []

    now = timezone.now()
    window_end = (now + timedelta(hours=horizon_hours)).date()

    bookings = (
        Booking.objects
        .filter(
            marina=marina,
            status__in=['confirmed', 'awaiting_payment', 'pending_payment'],
            check_in__lte=window_end,
            check_in__gte=now.date(),
            vessel__isnull=False,
        )
        .select_related('vessel')
    )

    mmsis = {b.vessel.mmsi for b in bookings if b.vessel.mmsi}
    if not mmsis:
        return []

    positions = {
        p.mmsi: p for p in
        VesselPosition.objects.filter(marina=marina, mmsi__in=mmsis)
    }

    mlat, mlng = float(marina.lat), float(marina.lng)
    rows = []
    for booking in bookings:
        pos = positions.get(booking.vessel.mmsi)
        if not pos:
            continue
        plat, plng = float(pos.lat), float(pos.lng)
        distance = haversine_nm(plat, plng, mlat, mlng)
        if distance > max_distance_nm:
            continue
        bearing  = bearing_deg(plat, plng, mlat, mlng)
        speed    = float(pos.speed_kn) if pos.speed_kn is not None else 0.0
        eta_min  = round((distance / max(speed, 1.0)) * 60)
        eta_when = now + timedelta(minutes=eta_min)

        rows.append({
            'booking_id':   booking.id,
            'guest_name':   booking.guest_name or (booking.vessel.name or ''),
            'vessel_name':  booking.vessel.name or '',
            'mmsi':         pos.mmsi,
            'check_in':     booking.check_in.isoformat(),
            # ISO 8601 with offset — the React side renders this in the
            # browser's locale. Server-side `strftime('%H:%M')` on a UTC
            # datetime would show the wrong local time to Italian (CEST)
            # or US harbourmasters.
            'eta':          eta_when.isoformat(),
            'eta_minutes':  eta_min,
            'distance_nm':  round(distance, 1),
            'bearing_deg':  round(bearing),
            'speed_kn':     round(speed, 1),
            'last_seen':    pos.reported_at.isoformat(),
        })

    rows.sort(key=lambda r: r['eta_minutes'])
    return rows
```

- [ ] **Step 4: Run tests, expect pass**

```bash
cd backend
python -m pytest apps/ais/tests/test_phase1.py::UpsertPositionTests apps/ais/tests/test_phase1.py::GetInboundETAsTests -v
```

Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/ais/services.py backend/apps/ais/tests/test_phase1.py
git commit -m "feat(ais): upsert_position + get_inbound_etas service functions"
```

---

## Task 6: Celery poll task

**Files:**
- Create: `backend/apps/ais/tasks.py`
- Modify: `backend/config/settings/base.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/apps/ais/tests/test_phase1.py`:

```python
from unittest.mock import patch

from apps.ais.tasks import poll_ais_for_marina


class PollTaskTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='Harwich',
            lat=Decimal('51.945'), lng=Decimal('1.283'),
            marinetraffic_api_key='fake',
            ais_poll_radius_nm=10,
        )

    @patch('apps.ais.tasks.MarineTrafficAdapter')
    def test_poll_creates_positions(self, MockAdapter):
        MockAdapter.return_value.fetch_positions.return_value = [_make_reading()]
        poll_ais_for_marina(self.marina.id)
        self.assertEqual(VesselPosition.objects.count(), 1)

    @patch('apps.ais.tasks.MarineTrafficAdapter')
    def test_missing_key_skips(self, MockAdapter):
        Marina.objects.filter(pk=self.marina.pk).update(marinetraffic_api_key='')
        poll_ais_for_marina(self.marina.id)
        MockAdapter.assert_not_called()
        self.assertEqual(VesselPosition.objects.count(), 0)

    @patch('apps.ais.tasks.MarineTrafficAdapter')
    def test_provider_failure_is_swallowed(self, MockAdapter):
        MockAdapter.return_value.fetch_positions.side_effect = RuntimeError('401')
        # Must not raise.
        poll_ais_for_marina(self.marina.id)
        self.assertEqual(VesselPosition.objects.count(), 0)
```

- [ ] **Step 2: Run, expect fail**

```bash
cd backend
python -m pytest apps/ais/tests/test_phase1.py::PollTaskTests -v
```

Expected: ImportError — `tasks.py` doesn't exist.

- [ ] **Step 3: Implement tasks**

Create `backend/apps/ais/tasks.py`:

```python
"""
AIS Celery tasks.

`poll_ais_for_all_marinas` is the beat-driven entry point. It fans out one
sub-task per marina that has a MarineTraffic key configured. Per-marina
failures are swallowed and logged so one bad marina cannot starve the rest.
"""
from __future__ import annotations

import logging
from math import cos, radians

from celery import shared_task

from apps.accounts.models import Marina
from apps.ais.adapters.marinetraffic import MarineTrafficAdapter
from apps.ais.services import upsert_position

logger = logging.getLogger(__name__)

# 1° of latitude ≈ 60 nm. Longitude shrinks with cos(lat).
_NM_PER_LAT_DEG = 60.0


def _bbox(lat: float, lng: float, radius_nm: int) -> tuple[float, float, float, float]:
    dlat = radius_nm / _NM_PER_LAT_DEG
    dlng = radius_nm / max(_NM_PER_LAT_DEG * cos(radians(lat)), 1e-6)
    return (lat - dlat, lat + dlat, lng - dlng, lng + dlng)


@shared_task(name='apps.ais.tasks.poll_ais_for_all_marinas')
def poll_ais_for_all_marinas():
    """Beat entrypoint — fan out to every configured marina."""
    qs = Marina.objects.exclude(marinetraffic_api_key='').filter(
        lat__isnull=False, lng__isnull=False,
    )
    for marina_id in qs.values_list('id', flat=True):
        poll_ais_for_marina.delay(marina_id)


@shared_task(name='apps.ais.tasks.poll_ais_for_marina')
def poll_ais_for_marina(marina_id: int):
    try:
        marina = Marina.objects.get(pk=marina_id)
    except Marina.DoesNotExist:
        return
    if not marina.marinetraffic_api_key or marina.lat is None or marina.lng is None:
        return

    bbox = _bbox(float(marina.lat), float(marina.lng), marina.ais_poll_radius_nm)
    try:
        readings = MarineTrafficAdapter(marina.marinetraffic_api_key).fetch_positions(bbox)
    except Exception as e:  # noqa: BLE001
        logger.warning('AIS poll failed for marina %s: %s', marina_id, e)
        return

    # Pre-resolve known vessels in ONE query rather than per-reading.
    # A busy harbour can return 300+ AIS contacts and we run this every
    # 60 s — N+1 would exhaust the DB connection pool quickly.
    from apps.vessels.models import Vessel
    mmsis = [r.mmsi for r in readings]
    known_vessels = {
        v.mmsi: v for v in
        Vessel.objects.filter(marina=marina, mmsi__in=mmsis)
    }

    for reading in readings:
        upsert_position(marina, reading, vessel=known_vessels.get(reading.mmsi))

    logger.info('AIS poll marina=%s readings=%d matched=%d',
                marina_id, len(readings), sum(1 for r in readings if r.mmsi in known_vessels))
```

- [ ] **Step 4: Wire the beat schedule**

In `backend/config/settings/base.py`, locate `CELERY_BEAT_SCHEDULE = {` and add a new entry inside the dict (anywhere; group with other 1-minute pollers if there are any):

```python
    'poll-ais-positions-1min': {
        'task':     'apps.ais.tasks.poll_ais_for_all_marinas',
        'schedule': 60.0,  # every 60 seconds
    },
```

- [ ] **Step 5: Run tests, expect pass**

```bash
cd backend
python -m pytest apps/ais/tests/test_phase1.py::PollTaskTests -v
```

Expected: 3 passed.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/ais/tasks.py backend/config/settings/base.py
git commit -m "feat(ais): Celery poll task + 60s beat schedule"
```

---

## Task 7: `InboundETAView` + URL wiring

**Files:**
- Create: `backend/apps/ais/serializers.py`
- Create: `backend/apps/ais/views.py`
- Create: `backend/apps/ais/urls.py`
- Modify: `backend/config/urls.py`

- [ ] **Step 1: Write failing endpoint test**

Append to `backend/apps/ais/tests/test_phase1.py`:

```python
from rest_framework.test import APIClient
from apps.accounts.models import User


class InboundETAViewTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='Harwich', lat=Decimal('51.945'), lng=Decimal('1.283'),
        )
        self.other = Marina.objects.create(
            name='Felixstowe', lat=Decimal('51.961'), lng=Decimal('1.347'),
        )
        self.user = User.objects.create_user(
            email='hm@harwich.test', password='pw',
            marina=self.marina, role='manager',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)

        self.vessel = Vessel.objects.create(marina=self.marina, name='Wanderer', mmsi='227123456')
        self.berth = Berth.objects.create(marina=self.marina, code='A1')
        Booking.objects.create(
            marina=self.marina, berth=self.berth, vessel=self.vessel,
            check_in=date.today(), check_out=date.today() + timedelta(days=1),
            status='confirmed',
        )
        upsert_position(self.marina, _make_reading(lat=52.0, lng=1.5, speed=8))

    def test_returns_inbound_rows(self):
        r = self.client.get('/api/v1/ais/inbound/')
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertIn('inbound', body)
        self.assertEqual(len(body['inbound']), 1)
        row = body['inbound'][0]
        self.assertEqual(row['mmsi'], '227123456')
        self.assertIn('eta_minutes', row)
        self.assertIn('fetched_at', body)

    def test_unauthenticated_returns_401(self):
        anon = APIClient()
        r = anon.get('/api/v1/ais/inbound/')
        self.assertEqual(r.status_code, 401)

    def test_scoped_to_user_marina(self):
        # Seed the other marina with a vessel + booking + position.
        v = Vessel.objects.create(marina=self.other, name='Otter', mmsi='227999999')
        bt = Berth.objects.create(marina=self.other, code='B1')
        Booking.objects.create(
            marina=self.other, berth=bt, vessel=v,
            check_in=date.today(), check_out=date.today() + timedelta(days=1),
            status='confirmed',
        )
        upsert_position(self.other, _make_reading(mmsi='227999999', lat=51.97, lng=1.35))

        r = self.client.get('/api/v1/ais/inbound/')
        body = r.json()
        mmsis = [row['mmsi'] for row in body['inbound']]
        self.assertIn('227123456', mmsis)
        self.assertNotIn('227999999', mmsis)
```

- [ ] **Step 2: Run, expect fail (404)**

```bash
cd backend
python -m pytest apps/ais/tests/test_phase1.py::InboundETAViewTests -v
```

Expected: 404 on the GET (URL not wired yet).

- [ ] **Step 3: Implement the view + URL**

Create `backend/apps/ais/serializers.py`:

```python
"""
Output-only serializers for AIS endpoints. The service layer already returns
plain dicts so we don't need DRF serializer machinery for round-tripping —
this module exists for clarity and to make any future schema changes easy
to grep.
"""
```

(Empty body is fine — the view returns dicts directly.)

Create `backend/apps/ais/views.py`:

```python
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.ais.services import get_inbound_etas


class InboundETAView(APIView):
    """
    GET /api/v1/ais/inbound/
    Return upcoming bookings whose vessel is within AIS range of the marina,
    sorted by closest ETA first.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        marina = request.user.marina
        return Response({
            'inbound':    get_inbound_etas(marina),
            'fetched_at': timezone.now().isoformat(),
        })
```

Create `backend/apps/ais/urls.py`:

```python
from django.urls import path
from .views import InboundETAView

urlpatterns = [
    path('inbound/', InboundETAView.as_view(), name='ais_inbound'),
]
```

In `backend/config/urls.py`, locate the `api/v1/` include block and add (alongside the other app includes):

```python
        path('ais/', include('apps.ais.urls')),
```

- [ ] **Step 4: Run, expect pass**

```bash
cd backend
python -m pytest apps/ais/tests/test_phase1.py::InboundETAViewTests -v
```

Expected: 3 passed.

- [ ] **Step 5: Run the full Phase 1 suite**

```bash
cd backend
python -m pytest apps/ais/ -v
```

Expected: every test passes (geometry, adapter, upsert, etas, poll, view — total ≈ 21).

- [ ] **Step 6: Commit**

```bash
git add backend/apps/ais/serializers.py backend/apps/ais/views.py backend/apps/ais/urls.py backend/config/urls.py
git commit -m "feat(ais): InboundETAView + URL wiring"
```

---

## Task 8: Frontend — `useInboundETAs` hook

**Files:**
- Create: `frontend/src/hooks/useInboundETAs.js`

- [ ] **Step 1: Create the hook**

```jsx
import { useEffect, useState } from 'react';
import api from '../api.js';

const POLL_INTERVAL_MS = 30_000;

/**
 * Polls /ais/inbound/ every 30s. Returns:
 *   { rows, loading, error, supported }
 * `supported === false` means the backend returned a 4xx (e.g. AIS isn't
 * configured) so the caller can hide the card entirely.
 */
export default function useInboundETAs() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer;

    const fetchOnce = () => api.get('/ais/inbound/')
      .then(({ data }) => {
        if (cancelled) return;
        setRows(data.inbound || []);
        setError(null);
        setSupported(true);
      })
      .catch(err => {
        if (cancelled) return;
        if (err.response && err.response.status >= 400 && err.response.status < 500) {
          setSupported(false);
        } else {
          setError(err);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    fetchOnce();
    timer = setInterval(fetchOnce, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  return { rows, loading, error, supported };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useInboundETAs.js
git commit -m "feat(ais): useInboundETAs hook polling /ais/inbound/ every 30s"
```

---

## Task 9: Frontend — Inbound ETA card on Overview

**Files:**
- Create: `frontend/src/components/InboundETACard.jsx`
- Modify: `frontend/src/screens/Overview.jsx`

- [ ] **Step 1: Create the card component**

Create `frontend/src/components/InboundETACard.jsx`:

```jsx
import useInboundETAs from '../hooks/useInboundETAs.js';

function formatEtaMinutes(mins) {
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

export default function InboundETACard() {
  const { rows, loading, supported } = useInboundETAs();

  // AIS not configured at the backend (4xx) — hide the card entirely so
  // we don't waste sidebar real estate on marinas that don't subscribe.
  if (!supported) return null;
  // No matched bookings — also hide to keep the screen clean.
  if (!loading && rows.length === 0) return null;

  return (
    <div className="card">
      <div className="card-header">
        <div className="card-header-title">Inbound — AIS</div>
        {!loading && rows.length > 0 && (
          <span className="badge badge-blue">{rows.length}</span>
        )}
      </div>
      <div className="card-body" style={{ padding: 0 }}>
        {loading ? (
          <div style={{ padding: '14px 18px', fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>
            Checking AIS…
          </div>
        ) : (
          rows.map(r => (
            <div key={r.booking_id} style={{
              padding: '12px 18px', borderBottom: 'var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.vessel_name || r.guest_name}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 2 }}>
                  {r.guest_name && r.vessel_name ? r.guest_name : `MMSI ${r.mmsi}`}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>
                  {new Date(r.eta).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.55)', marginTop: 2 }}>
                  {r.distance_nm} nm · {formatEtaMinutes(r.eta_minutes)}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Place the card on Overview**

In `frontend/src/screens/Overview.jsx`, add the import after the existing imports (find the existing import block at the top of the file):

```jsx
import InboundETACard from '../components/InboundETACard.jsx';
```

Then locate the JSX where the Weather card ends and the "Urgent" card begins (search for the comment `{/* Urgent */}`). Insert immediately before that comment:

```jsx
          {/* Inbound — AIS */}
          <InboundETACard />
```

- [ ] **Step 3: Smoke-test the build**

```bash
cd frontend
npm run build
```

Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/InboundETACard.jsx frontend/src/screens/Overview.jsx
git commit -m "feat(ais): Inbound ETA card on Overview screen"
```

---

## Task 10: End-to-end verification

- [ ] **Step 1: Run all backend tests**

```bash
cd backend
python -m pytest apps/ais/ -v
```

Expected: all green.

- [ ] **Step 2: Run the broader test suite (no regressions in callers)**

```bash
cd backend
python -m pytest apps/accounts/ apps/reservations/ apps/vessels/ -v
```

Expected: no failures from your changes.

- [ ] **Step 3: Frontend build**

```bash
cd frontend
npm run build
```

Expected: clean.

- [ ] **Step 4: Manual smoke (CI / dev laptop)**

Log in as marina staff. Visit Settings → Integrations and confirm an AIS / MarineTraffic key is configured. Wait for Celery beat to run (or trigger manually):

```bash
cd backend
python manage.py shell -c "from apps.ais.tasks import poll_ais_for_all_marinas; poll_ais_for_all_marinas()"
```

Visit Overview. If at least one booking has a linked vessel whose MMSI shows up in MarineTraffic's response for the bbox, you should see the "Inbound — AIS" card with that row.

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin feature/ais-phase-1
gh pr create --title "feat(ais): Phase 1 — Inbound ETA list" \
  --body-file docs/superpowers/specs/2026-05-14-ais-vessel-tracking-design.md
```

(Edit the PR body afterwards to focus on Phase 1; the spec is the long-form reference, not the PR description.)

---

## Self-Review

**Spec coverage (Phase 1):**
- ✅ AIS ingest pipeline (Task 6: poll task) backed by adapter (Task 4) and `upsert_position` (Task 5).
- ✅ `VesselPosition` model with unique `(marina, mmsi)` (Task 3).
- ✅ Marina `basin_polygon` + `ais_poll_radius_nm` (Task 3).
- ✅ Geometry helpers — haversine, bearing, point-in-polygon (Task 2).
- ✅ Adapter abstraction so swapping vendors is one file (Task 4).
- ✅ `get_inbound_etas` matches bookings to positions and computes ETA/distance/bearing (Task 5).
- ✅ `GET /api/v1/ais/inbound/` endpoint scoped per marina (Task 7).
- ✅ Frontend hook polling every 30 s (Task 8).
- ✅ Overview card placement between Weather and Urgent (Task 9).
- ✅ Failure-handling: missing key skips, 5xx/4xx swallowed (Task 6).
- ✅ Test plan items 1–9 each have a corresponding test in Tasks 4–7.
- ✅ `point_in_polygon` is defined now even though Phase 1 doesn't use it — Phase 2 will. Listed in geometry tests so the contract is locked.

**Placeholder scan:** No TBDs / TODOs / vague steps. Every code block is complete.

**Type consistency:**
- `AISReading` defined in `adapters/base.py` (Task 4); used by `MarineTrafficAdapter.fetch_positions` (Task 4) and `upsert_position(reading: AISReading)` (Task 5).
- `BBox` tuple shape `(minlat, maxlat, minlng, maxlng)` is consistent across `_bbox` helper (Task 6) and `MarineTrafficAdapter.fetch_positions` (Task 4).
- The `get_inbound_etas` return shape in Task 5 matches the response schema the frontend hook (Task 8) and card (Task 9) consume — same keys: `booking_id`, `guest_name`, `vessel_name`, `mmsi`, `check_in`, `eta` (ISO 8601 with offset — client renders local time), `eta_minutes`, `distance_nm`, `bearing_deg`, `speed_kn`, `last_seen`.
- `upsert_position(marina, reading, vessel=None)` signature is consistent: the test in Task 5 (`test_first_upsert_creates_row`) passes `vessel=self.vessel` explicitly; the batch caller in Task 6 (`tasks.py`) pre-fetches via `Vessel.objects.filter(marina=marina, mmsi__in=mmsis)` and passes the resolved value per reading; one-off callers can omit it (position recorded without a vessel link).
- URL `/api/v1/ais/inbound/` is consistent between `apps/ais/urls.py` (Task 7), the view test (Task 7), and the hook (Task 8).
