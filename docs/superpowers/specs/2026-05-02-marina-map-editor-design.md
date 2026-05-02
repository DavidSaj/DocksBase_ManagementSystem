# Marina Map Editor — Design Spec
**Date:** 2026-05-02

## Overview

Full rewrite of the marina map canvas using react-konva, replacing the existing SVG-based `DigitalTwinCanvas`. The new system introduces three visual layers (infrastructure polygons, logical berths, amenity POIs), a polygon pier drawing tool, edge-snapping for berth placement, and an explicit save workflow.

---

## Decisions Made

| Question | Decision |
|---|---|
| Canvas engine | react-konva (full rewrite, not incremental) |
| Pier data migration | Hard migration — drop all rect fields, polygon-only going forward |
| Amenity storage | New `Amenity` database model |
| Save workflow | Explicit Save button — draft state, no auto-save |
| Pier reshape | Delete & redraw — no vertex editing |
| Berth canvas size | Auto-derived from `length_m` × `max_beam_m` |

---

## Architecture

```
MarinaMap.jsx (3 tabs)
├── Live tab     → LiveCanvas.jsx
├── Editor tab   → EditorCanvas.jsx
└── Docks tab    → DocksBerthsTab.jsx (unchanged)

Shared rendering components:
  PierLayer.jsx      — renders polygon piers
  BerthLayer.jsx     — renders status-colored berths
  AmenityLayer.jsx   — renders Lucide POI icons

New hook:
  useAmenities.js    — CRUD for amenities

New packages:
  react-konva + konva   — canvas engine
  lucide-react          — amenity icons
```

---

## Backend Changes

### Pier model
Remove fields: `cx`, `canvas_x`, `canvas_y`, `canvas_width`, `canvas_height`

Add field:
```python
polygon_points = models.JSONField(default=list)
# Format: [[x1,y1],[x2,y2],...] in meters
# Empty list = unmapped (not yet drawn on canvas)
```

### Amenity model (new)
```python
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
```

### Migration
One migration that:
1. Removes `cx`, `canvas_x`, `canvas_y`, `canvas_width`, `canvas_height` from `Pier`
2. Adds `polygon_points` JSONField to `Pier`
3. Creates the `Amenity` table

Existing pier canvas data is dropped (accepted trade-off, Option A).

### New API endpoints
- `GET /amenities/` — list marina amenities
- `POST /amenities/` — create amenity
- `GET /amenities/{id}/` — retrieve
- `PATCH /amenities/{id}/` — update position/scale/rotation/label
- `DELETE /amenities/{id}/` — delete

Pier endpoints unchanged — `PATCH /piers/{id}/` now accepts `polygon_points`.

---

## Frontend — Shared Layer Components

Pure Konva rendering components. Props in, pixels out. No side effects, no API calls.

### PierLayer.jsx
- Props: `piers[]`
- Renders each pier with non-empty `polygon_points` as a closed Konva `Line`
- Fill: `#7a7a7a` (concrete), stroke: `#4a4a4a`
- Pier code/label centered in polygon bounding box as `Text`
- Skips piers with empty `polygon_points`

### BerthLayer.jsx
- Props: `berths[]`, `selectedBerthId`, `onBerthClick`, `draggable` (bool)
- Renders each berth with `canvas_x != null` as a Konva `Rect` + `Text`
- Rotated via `canvas_rotation`
- Color-coded by status (available/occupied/reserved/maintenance)
- Selected berth gets blue outline ring
- `draggable` prop enables repositioning in editor mode

### AmenityLayer.jsx
- Props: `amenities[]`, `onAmenityClick`, `draggable` (bool)
- Each amenity: Konva `Group` with rounded rect background + Konva `Image` (Lucide icon) + `Text` label below
- Lucide icons serialized to SVG data URLs at module load, cached in `AMENITY_ICONS` map
- `draggable` prop enables repositioning in editor mode

---

## Frontend — LiveCanvas.jsx

Read-only, no tools, no grid.

```
Konva Stage (zoom: mousewheel, pan: middle-click or alt+drag)
└── Layer
    ├── Rect (water background #deeef7)
    ├── PierLayer
    ├── BerthLayer   (draggable=false)
    └── AmenityLayer (draggable=false)
```

- Props: `piers`, `berths`, `amenities`, `selectedBerthId`, `onBerthClick`, `onAmenityClick`
- Zoom/pan via Konva Stage `scaleX/scaleY` and `x/y`
- Zoom % indicator bottom-right
- ~60–80 lines

---

## Frontend — EditorCanvas.jsx

Full tool suite. Manages local `draft` state, only flushes to API on explicit Save.

### Toolbar
```
[ Select ] [ Draw Pier ] [ Add Amenity ▾ ] | [ Grid: ON ] | [ Save (N changes) ] [ Discard ]
```
- Active tool highlighted
- "Add Amenity" dropdown shows 12 types with Lucide icons

### Tool: Select (default)
- Click berth → Konva `Transformer` with rotation handle; draggable to reposition
- Click amenity → `Transformer` with scale + rotation handles; draggable. Transformer must use `keepRatio={true}` and `enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}` to enforce uniform scaling — this ensures the single `scale` database column is never split into separate `scaleX`/`scaleY` values.
- Click pier → highlights pier, shows delete button (no reshape)
- Rubber-band drag on empty canvas → multi-select berths/amenities
- Multi-selected objects move as a group

### Tool: Draw Pier
- Click to drop vertices (shown as small circles)
- Preview line follows cursor
- Double-click closes polygon, creates pier shape
- Escape cancels in-progress polygon
- After closing: inline prompt for pier code + label
- New pier added to `draft.newPiers`

### Tool: Add Amenity
- Select type from dropdown → places amenity at viewport center
- User drags to position, rotates/scales via Transformer
- New amenity added to `draft.newAmenities`

### Berth Placement (sidebar → canvas)
- Drag from `UnmappedBerthsSidebar`, drop onto canvas
- Canvas size derived from `length_m × max_beam_m` (defaults: 12m × 4m if null)
- **Edge snap:** on drop, if within 2m of any pier polygon edge, snap berth center to that edge and rotate to align with edge angle
- Added to `draft.berths`

### Draft State Shape
```js
draft = {
  piers:             { [id]: { polygon_points } },
  newPiers:          [{ code, label, polygon_points }],
  deletedPierIds:    [],
  berths:            { [id]: { canvas_x, canvas_y, canvas_rotation } },
  amenities:         { [id]: { canvas_x, canvas_y, scale, rotation } },
  newAmenities:      [{ type, label, canvas_x, canvas_y, scale, rotation }],
  deletedAmenityIds: [],
}
```

**Berth sizing rule:** `canvas_width` and `canvas_height` are never stored in draft state and never sent in PATCH payloads. `BerthLayer` derives visual size on the fly: `width = length_m * CELL`, `height = max_beam_m * CELL`. This keeps the database as the single source of truth for berth dimensions.

### Save Layout
- Fires minimal API calls: individual PATCH per modified berth, PATCH/POST/DELETE per modified pier, PATCH/POST/DELETE per modified amenity
- Save button shows count of pending changes
- On success: clears draft, re-fetches data

### Discard
- Clears draft state, reverts canvas to last saved state

---

## Frontend — MarinaMap.jsx

Slimmer orchestrator — owns data fetching, passes props, handles save callback.

```js
const { piers, createPier, updatePier, deletePier, bulkGenerate } = usePiers();
const { berths, updateBerth, deleteBerth, addBerths } = useBerths();
const { amenities, createAmenity, updateAmenity, deleteAmenity } = useAmenities();
```

- **Live tab:** `LiveCanvas` + `BerthStatusSidebar` + `BerthDetailPanel`
- **Editor tab:** `EditorCanvas` + `UnmappedBerthsSidebar`; editor calls `onSave(draft)`, MarinaMap fans out to hooks
- **Docks tab:** `DocksBerthsTab` (unchanged)

**Save error handling:** If any API call fails, show inline error, keep draft intact. Already-succeeded calls are not rolled back.

---

## Amenity Icon Map

| Type | Lucide Icon |
|---|---|
| harbour_master | `Anchor` |
| fuel | `Fuel` |
| toilets | `Toilet` |
| showers | `ShowerHead` |
| restaurant | `UtensilsCrossed` |
| parking | `ParkingSquare` |
| electricity | `Zap` |
| water | `Waves` |
| gate | `DoorClosed` |
| waste | `Trash2` |
| chandlery | `Store` |
| first_aid | `Cross` |

---

## New Dependencies

```json
"react-konva": "^18.2.0",
"konva": "^9.3.0",
"lucide-react": "^0.475.0"
```

---

## Files Changed / Created

### Backend
- `backend/apps/berths/models.py` — modify Pier, add Amenity
- `backend/apps/berths/serializers.py` — add AmenitySerializer, update PierSerializer
- `backend/apps/berths/views.py` — add AmenityListCreateView, AmenityDetailView
- `backend/apps/berths/urls.py` — add amenity routes
- `backend/apps/berths/migrations/XXXX_pier_polygon_amenity.py` — new migration

### Frontend
- `frontend/package.json` — add react-konva, konva, lucide-react
- `frontend/src/hooks/useAmenities.js` — new
- `frontend/src/components/harbor-map/PierLayer.jsx` — new
- `frontend/src/components/harbor-map/BerthLayer.jsx` — new
- `frontend/src/components/harbor-map/AmenityLayer.jsx` — new
- `frontend/src/components/harbor-map/LiveCanvas.jsx` — new (replaces DigitalTwinCanvas for live tab)
- `frontend/src/components/harbor-map/EditorCanvas.jsx` — new (replaces DigitalTwinCanvas for editor tab)
- `frontend/src/components/harbor-map/DigitalTwinCanvas.jsx` — deleted
- `frontend/src/screens/MarinaMap.jsx` — updated
