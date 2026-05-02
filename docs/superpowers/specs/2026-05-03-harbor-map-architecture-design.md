# Harbor Map Architecture — Design Spec

**Date:** 2026-05-03
**Status:** Approved

## Problem

The existing codebase has `MapBuilder.jsx` and `HarborMap.jsx` doing overlapping jobs. Neither component has a single clear responsibility, leading to duplicated rendering logic, inconsistent colors (not using the design system), and no clean separation between layout editing and operational monitoring.

## Solution: Renderer/Controller Pattern

Three layers with strict separation of concerns.

```
CanvasCore.jsx          — dumb renderer. Props in, pixels out. No state, no API calls.
    ↑
MapBuilder.jsx          — layout controller. Owns drag/drop, snap logic, palette,
                          unplaced berths sidebar. Writes to database.

LiveMap.jsx             — operational controller. Owns status coloring, booking
                          side panel. Reads live data.
```

`CanvasCore` is shared by both controllers. It guarantees 100% visual consistency. Business logic never leaks into the renderer.

Existing `mapBuilderUtils.js` and `mapBuilderPrefabs.js` are retained and imported by MapBuilder. CanvasCore never imports them directly.

---

## Data Model Changes

### Backend: `Pier` model — new fields

```python
canvas_x: DecimalField       # absolute position on canvas (grid units)
canvas_y: DecimalField
rotation: IntegerField        # degrees, snaps to 45° increments
```

Moving a pontoon = updating `canvas_x/canvas_y` on one Pier record only.

### Backend: `Berth` model — new fields

```python
# Note: Berth already has a `pier` FK for logical grouping (which pier section it belongs to).
# The map canvas uses the same FK as the parent anchor. A berth with pier=null is "unplaced"
# on the canvas. No separate parent_pier_id field is needed — the existing pier FK doubles
# as the canvas parent. The implementation plan must confirm this is safe (no berths currently
# have pier=null for non-map reasons).
local_x: DecimalField                          # position relative to parent pontoon; null = unplaced
local_y: DecimalField
position_on_parent: JSONField                  # {side: "port"|"starboard", slot_index: int}
```

Child berths store local coordinates. Absolute canvas position is computed at render time:

```
abs = parent.canvas_xy + rotate(berth.local_xy, parent.rotation)
```

This means moving a pontoon moves all 40 attached berths with zero API calls per berth.

### Center-Origin Math (mandatory — do not skip)

`canvas_x/canvas_y` on a Pier must represent its **center point**, not its top-left corner. `local_x/local_y` on a Berth must be measured relative to that **center point**.

If the origin is the top-left corner, rotating a pontoon swings it across the entire canvas like a baseball bat, dragging all child berths with it in a large unintended arc.

**Correct rotation formula (applied by the controller, not CanvasCore):**
```js
// θ = pier.rotation in radians
const rotated_x = local_x * Math.cos(θ) - local_y * Math.sin(θ)
const rotated_y = local_x * Math.sin(θ) + local_y * Math.cos(θ)
const abs_x = pier.canvas_x + rotated_x
const abs_y = pier.canvas_y + rotated_y
```

**In SVG rendering:** use `transform="rotate(θ, canvas_x, canvas_y)"` on the pier `<g>` element. This rotates around the pier's center point and child elements inherit the transform automatically, avoiding per-berth manual math at render time.

**At save time:** when a prefab is dropped onto the canvas, store `canvas_x/y` as the shape's center:
```js
canvas_x = drop_x + (w / 2)
canvas_y = drop_y + (h / 2)
```
Never store the top-left corner as the position anchor.

### Frontend: Shape contract CanvasCore expects

```js
{
  id: string,
  type: string,
  absX: number,          // absolute canvas position — computed by controller, never by CanvasCore
  absY: number,
  w: number,
  h: number,
  rotation: number,
  fill: string,          // design system CSS variable, e.g. var(--color-surface-dock)
  stroke: string,
  label: string,
  meta: object,          // opaque — controller puts whatever it needs here
}
```

---

## CanvasCore Renderer

**File:** `frontend/src/components/harbor-map/CanvasCore.jsx`

Dumb SVG renderer. Receives shapes, draws shapes.

### Props

```js
CanvasCore.propTypes = {
  shapes: arrayOf(ShapeSchema),
  mode: oneOf(['builder', 'viewer']),  // builder shows drag handles and snap zones
  onItemClick: func,
  onItemDrop: func,                    // builder only
  onCanvasDrop: func,                  // builder only
  zoom: number,
  pan: shape({ x: number, y: number }),
}
```

### Render layer order

1. Environment (water, ground)
2. Pontoons / piers
3. Berths (with snap zone overlay in builder mode)
4. Buildings / structures
5. UI overlays (drag handles, selection box)

### Constraints

CanvasCore must never:
- Call any API
- Make color decisions based on business state
- Do coordinate math beyond grid-units → pixels
- Import `mapBuilderUtils.js`, `mapBuilderPrefabs.js`, or any domain module

All fills and strokes must be design system CSS variables. No raw hex values.

---

## MapBuilder Controller

**File:** `frontend/src/components/harbor-map/MapBuilder.jsx`

Owns all layout editing behavior.

### Layout

- **Left sidebar:** Prefab palette — `MapBuilderPalette.jsx` (pontoons, walls, buildings, shapes)
- **Right sidebar:** "Unplaced Berths" — `MapBuilderBerthPanel.jsx`, filtered to berths where `parent_pier_id` is null
- **Center:** CanvasCore in `mode="builder"`

### Interaction flows

**Placing a pontoon:**
Drag from palette → drop on canvas → create Pier record via API → CanvasCore re-renders.

**Snapping a berth to a pontoon:**
1. User drags berth (e.g. A1) from right sidebar
2. On hover over a pontoon edge, CanvasCore renders snap zone highlight (ghost slots along the pontoon edge)
3. On drop, MapBuilder calls API: set `A1.parent_pier_id`, `local_x`, `local_y`, `position_on_parent`
4. A1 disappears from "Unplaced Berths" sidebar

**Moving a pontoon:**
Drag pontoon → MapBuilder updates `pier.canvas_x/y` via single API call → all child berths follow automatically (CanvasCore recomputes absolute positions from parent).

**Undo:** 20-item history stack (existing logic in `mapBuilderUtils.js`), Ctrl+Z reverses last mutation.

**Colors:** All fills/strokes use design system tokens. No raw hex. This corrects the existing blue palette.

---

## LiveMap Controller

**File:** `frontend/src/components/harbor-map/LiveMap.jsx`

Read-only. No drag handles, no palette, no editing.

### Layout

- **Full-width:** CanvasCore in `mode="viewer"`
- **Right panel (on berth click):** `BerthDetailPanel.jsx`

### Status color mapping

Controller computes `fill` before passing shapes to CanvasCore:

| Status      | Token                          |
|-------------|--------------------------------|
| available   | `var(--color-status-available)` |
| occupied    | `var(--color-status-occupied)`  |
| reserved    | `var(--color-status-reserved)`  |
| maintenance | `var(--color-status-maintenance)` |

### BerthDetailPanel

**Static section (always shown):**
- Berth code, length, max draft, max beam
- Amenities list
- Price category

**Active booking section:**
- If occupied/reserved: vessel name, skipper name, check-in date, check-out date, nights remaining, balance owed
- Actions: "Check Out", "Add Charge", "View Full Booking"
- If available: "No active booking" + "Create Booking" button

### Data freshness

Polling interval vs. WebSocket subscription — deferred to implementation plan.

---

## Navigation

| Route | Component |
|-------|-----------|
| Settings → Harbor Layout | `MapBuilder.jsx` |
| Dashboard → Live Map | `LiveMap.jsx` |
| Settings → Docks & Berths | Existing data table (unchanged) |

---

## Files Affected

| Action | File |
|--------|------|
| Create | `CanvasCore.jsx` |
| Refactor | `MapBuilder.jsx` (strip operational code, wire to CanvasCore) |
| Refactor | `HarborMap.jsx` → rename to `LiveMap.jsx` (strip editing, wire to CanvasCore) |
| Create | `BerthDetailPanel.jsx` |
| Retain | `mapBuilderUtils.js`, `mapBuilderPrefabs.js`, `MapBuilderPalette.jsx`, `MapBuilderBerthPanel.jsx` |
| Backend | `berths/models.py` — add fields to Pier and Berth |
| Backend | `berths/views.py` — migration + updated serializers |
