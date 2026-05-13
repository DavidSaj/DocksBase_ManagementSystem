# Map Editor Redesign — "City Builder" UX
**Date:** 2026-05-02  
**Status:** Approved

---

## Overview

Transform the marina map editor from a free-hand drawing tool into a modular, grid-locked "city builder" experience. The core philosophy is mathematical alignment over freehand creativity — marinas are built on geometry and the tool enforces it automatically.

The build touches three layers: backend data model, a new left asset panel, and canvas engine changes.

---

## Architecture

The editor layout splits into two fixed regions:

- **Left asset panel** (~280px wide, full height) — replaces `UnmappedBerthsSidebar`
- **Konva canvas** — fills remaining width

New files:
- `frontend/src/components/harbor-map/AssetPanel.jsx` — panel container with 4 accordions
- `frontend/src/components/harbor-map/PrefabLibrary.jsx` — Group B inner component
- `frontend/src/components/harbor-map/gridSnap.js` — snap-to-grid utility
- `frontend/src/hooks/usePrefabs.js` — prefab CRUD hook

Modified files:
- `EditorCanvas.jsx` — snap-to-grid, material-type-aware drawing, ghost slots, simplified toolbar
- `mapConstants.js` — fine grid constants, pier type colors
- `MarinaMap.jsx` — wires AssetPanel, passes prefab callbacks
- `PierLayer.jsx` — renders pier fill using `pier_type` color

Retired:
- `UnmappedBerthsSidebar.jsx` — content absorbed into AssetPanel Group C

---

## Data Model

### `Pier` model — new fields

```python
PIER_TYPE_CHOICES = [
    ('concrete', 'Concrete Pier'),
    ('pontoon',  'Wooden Pontoon'),
    ('land',     'Land / Grass'),
]
pier_type   = models.CharField(max_length=20, choices=PIER_TYPE_CHOICES, default='concrete')
ghost_slots = models.JSONField(default=list)
# ghost_slots format: [{ x, y, rotation, width_m, height_m }, ...]
# x, y in metres relative to canvas origin (not normalized).
# Populated when a prefab is dropped. A slot is removed when a real berth
# is dragged onto it (within 1m snap radius). Updated via PATCH /piers/.
```

- Both fields flow through the existing `PierSerializer` and `/piers/` endpoint — no new endpoint needed.
- The `PierViewSet.create` method is extended: if the incoming `code` field contains `{n}`, the view resolves it to the next available integer by querying `Pier.objects.filter(marina=marina, code__startswith=prefix)` and incrementing until unique. The resolved code is saved; `label_template` is not stored on the Pier model (it lives only on `MapPrefab`).
- Visual colors: concrete = `#94a3b8`, pontoon = `#a16207`, land = `#86efac`.
- `pier_type` used for display differentiation on live map and for reports/filters — no pricing or maintenance logic in this iteration.
- `ghost_slots` is persisted so that partially-mapped prefabs survive browser refresh/logout. The editor reads `ghost_slots` from each pier on load and re-renders them as dashed outlines.

### New `MapPrefab` model

```python
class MapPrefab(models.Model):
    marina          = ForeignKey('accounts.Marina', on_delete=CASCADE, related_name='prefabs',
                                null=True, blank=True)  # null for is_base=True prefabs
    name            = CharField(max_length=100)
    pier_type       = CharField(max_length=20, choices=PIER_TYPE_CHOICES)
    polygon_points  = JSONField()           # [[x,y], ...] in metres, normalized to origin
    berth_slots     = JSONField(default=list)  # [{ x, y, rotation, width, height_m, width_m }, ...]
                                               # width_m from berth.max_beam_m, height_m from berth.length_m
    label_template  = CharField(max_length=50, blank=True)  # e.g. "Pontoon {n}"
    is_base         = BooleanField(default=False)  # True = platform-shipped, read-only
    created_at      = DateTimeField(auto_now_add=True)
```

- Geometry stored **normalized to origin** (bounding box min = `[0,0]`). Drop offset applied at render time.
- `MapPrefabViewSet` exposes `/prefabs/` — `list`, `create`, `update`, `destroy`, filtered by marina. The `list` action returns both marina-specific prefabs AND all base prefabs (`is_base=True`) in a single response.
- `destroy` is rejected with 403 if `is_base=True`.
- Base prefabs seeded via data migration.

---

## Left Asset Panel

`AssetPanel.jsx` — 280px wide, full editor height, vertically scrollable. Four independently collapsible accordion sections, all expanded by default.

### Group A — Infrastructure & Terrain

Three pill buttons, one per material type. Clicking activates `draw-pier` mode with the selected `pier_type` passed to the canvas. The active material is highlighted. The pier preview polygon renders in that material's color while drawing.

| Button | Color |
|--------|-------|
| Concrete Pier | slate grey `#94a3b8` |
| Wooden Pontoon | warm brown `#a16207` |
| Land / Grass | green `#86efac` |

### Group B — Smart Prefabs

- 2-column card grid. Each card: prefab name + small SVG thumbnail of polygon outline.
- Base prefabs show a lock icon and cannot be deleted.
- Custom prefabs show a `×` delete button.
- Dragging a card onto the canvas triggers the prefab drop flow (see below).
- **"Save Current Pier as Prefab"** button appears at the bottom of this group when a pier is selected on canvas. Opens an inline form: Name (required), Label Template (optional). On submit, triggers the prefab save flow.

### Group C — Unmapped Berths

Same content as the retired `UnmappedBerthsSidebar`: search box, berths grouped by pier, draggable cards. The count moves to the accordion header: **"Unmapped Berths (N)"** so it's visible when collapsed.

### Group D — Amenities

Replaces the toolbar dropdown. A 3-column icon grid of all 12 amenity types, each as a labelled drag-and-drop tile. Dragging onto canvas drops amenity at snapped position.

---

## Canvas Changes

### Grid

`mapConstants.js` additions:
```js
export const GRID_SNAP = CELL;        // 20px = 1m
export const GRID_MINOR = CELL;       // lines every 1m
export const GRID_MAJOR = CELL * 5;   // lines every 5m
```

`GridLayer` updated: minor lines (`#e5e7eb`, very faint) every 1m; major lines (`#cbd5e1`) every 5m. Two-tier visual prevents noise while maintaining orientation.

### Snap-to-Grid — `gridSnap.js`

```js
export function snapToGrid(valueMetres) {
  return Math.round(valueMetres);
}
export function snapPointToGrid(x, y) {
  return [snapToGrid(x), snapToGrid(y)];
}
```

All coordinates in the system are already in metres — snapping is `Math.round`.

### Draw-Pier Tool

- Every placed vertex snaps to nearest grid intersection before being added to `drawingPoints`.
- Cursor preview dot snaps live on mouse move — gives the magnetic "city builder" feel.
- The `window.prompt()` dialogs for pier code/label are replaced by a small floating panel that appears on canvas after the polygon is closed (double-click). The panel has Name and Label fields and a Confirm button.
- The active `pier_type` (from Group A selection) is passed into the canvas and stored in state. It is sent with the `onPierCreate` payload.

### Berth Drag

- **Repositioning on canvas:** drop position snaps to grid.
- **Drag from Group C sidebar:** `findNearestEdge` runs first — if within 2m of a pier edge, snaps to edge. Otherwise falls back to grid snap. Edge snap takes priority.

### Amenity Drag

- Drops from Group D snap to grid.
- Repositioning on canvas snaps to grid on drag end.

### Toolbar (simplified)

Removed: Draw Pier button, Add Amenity dropdown.  
Remaining: **Select**, **Grid ON/OFF**, separator, **Save (N changes)**, **Discard**.

---

## Prefab Drop Flow

When a prefab card is dragged from Group B and dropped on the canvas:

1. Drop position snapped to nearest grid intersection.
2. Prefab `polygon_points` (normalized) offset by drop position → actual canvas coordinates.
3. New pier created immediately via `POST /piers/` with `pier_type`, `polygon_points`, `ghost_slots` (slots from the prefab definition, offset to canvas coordinates), and `label_template` sent as-is (e.g. `"Pontoon {n}"`). The backend is solely responsible for resolving `{n}` — it queries the database for existing pier codes matching the pattern, finds the next available integer, and saves the final unique code. The frontend never guesses auto-incrementing identifiers.
4. Prefab `berth_slots` are offset from origin to the drop position, included in the `POST /piers/` payload as `ghost_slots`, and persisted to the database. The editor renders them as dashed rectangles in the material color on load (reading from `pier.ghost_slots`) — they survive browser refresh.
5. When a real berth from Group C is dropped within 1m of a ghost slot center, that slot is removed from the pier's `ghost_slots` array and a `PATCH /piers/{id}/` is sent immediately to persist the removal. The placed berth replaces the ghost visually.

### Prefab Save Flow

When "Save Current Pier as Prefab" is submitted:

1. Selected pier's `polygon_points` normalized to origin (subtract bounding box min-x, min-y).
2. Berths belonging to that pier converted to `berth_slots` — `canvas_x/y/rotation` also normalized to origin.
3. `POST /prefabs/` called with full payload.
4. New prefab card appears immediately in Group B below base prefabs.

---

## Base Prefabs (Seeded)

Four base prefabs shipped with the platform via data migration:

| Name | pier_type | Description |
|------|-----------|-------------|
| Standard Pontoon (10 berths) | pontoon | Rectangular pontoon with 5 slips per side |
| T-Dock End Piece | concrete | T-shaped end cap for concrete pier |
| Parallel Docking Wall | concrete | Single straight wall, 6 berths one side |
| Grass Breakwater | land | Long thin land strip, no berth slots |

---

## Out of Scope (This Iteration)

- Material type driving maintenance schedules or pricing rules
- Edge-to-edge pier snapping
- Global shared prefab library across marinas
- Prefab thumbnail auto-generation (thumbnails are static SVGs for base prefabs; custom prefabs show a generic icon until a future iteration adds auto-generation)
