# Map Builder Overhaul — Design Spec
**Date:** 2026-05-02
**Status:** Approved

---

## Overview

Overhaul the marina map builder tool to make it usable for real layout work. The current implementation in `MarinaMap.jsx` has no drag preview, no rotation, clunky prefab sizes, and several broken interactions (berths not removed from unplaced list, grid hard to read). This spec covers all UX improvements and two new features: a configurable parallel docking wall and custom prefab creation.

---

## Architecture

### Extraction: MapBuilder.jsx

Extract the map creator tab from `MarinaMap.jsx` into a standalone `MapBuilder.jsx` component. `MarinaMap.jsx` retains the live view tab and imports `MapBuilder` for the editor tab. No API or state shape changes — `MapBuilder` consumes the same `useMapConfig` and `useBerths` hooks.

**Files affected:**
- `frontend/src/screens/MarinaMap.jsx` — remove map creator code, import MapBuilder
- `frontend/src/components/harbor-map/MapBuilder.jsx` — new component (all builder logic)

---

## Canvas & Grid

### Grid Visibility
Two-tier grid replacing the current single-level 24px grid:
- **Minor lines:** every 1 grid unit (24px), color `#1a3a55`, stroke-width `0.5`
- **Major lines:** every 5 grid units (120px), color `#2a5a7a`, stroke-width `1`

Implemented as two nested SVG `<pattern>` elements (same approach as the existing grid, just two tiers).

### Canvas Size
Retain current: 34×22 grid units (816×528px). Grid unit remains 24px.

### Prefab Sizes (reduced ~40%)

| Prefab | Old (w×h) | New (w×h) |
|--------|-----------|-----------|
| water | 5×5 | 3×3 |
| shore | 8×4 | 5×2 |
| quay | 10×1 | 6×1 |
| pier-v | 1×8 | 1×5 |
| pier-h | 8×1 | 5×1 |
| parallel wall | — | 8×1 (new) |
| slip | 3×2 | 2×1 |
| slip-t | 3×2 | 2×1 |
| fuel-dock | 5×2 | 3×1 |
| gangway | 1×3 | 1×2 |
| ramp | 3×4 | 2×3 |
| tri-* (6 types) | 4×4 | 3×3 |
| office | 4×3 | 3×2 |
| fuel-stn | 3×2 | 2×2 |
| parking | 10×6 | 6×4 |
| boatyard | 8×6 | 5×4 |
| chandlery | 3×2 | 2×2 |
| restaurant | 4×3 | 3×2 |
| toilets | 2×2 | 2×2 |
| security | 2×2 | 2×2 |

**Removed prefab:** `T Dock` — deleted from palette entirely.

---

## UI Layout

Three-panel layout inside `MapBuilder.jsx`:

### Left Panel — Prefab Palette (160px wide)
- Grouped sections: Environment, Docking, Buildings, Custom
- Each prefab is a draggable card with a small shape preview and label
- Bottom of panel: two action buttons — **"Draw Custom"** and **"Group → Prefab"**
- Dragging a card initiates a drag interaction (see Drag & Drop below)

### Centre — Canvas
- SVG canvas with two-tier grid
- Placed elements rendered as SVG shapes
- Selected element shown with gold border + rotation handle
- Ghost element shown while dragging (see below)
- Toolbar (top-right corner): Save, Undo buttons

**SVG render order (critical):** SVG has no z-index — elements are painted in document order, last on top. The canvas renderer must sort `items` before mapping to SVG elements, regardless of insertion order:
1. Environment (water, shore)
2. Infrastructure (quay, parallel wall, pier)
3. Berths / slips
4. Buildings / amenities
5. Selection borders and handles (always on top)

### Right Panel — Unplaced Berths (150px wide)
- Fetched via `useBerths()` hook
- Each berth shown as a draggable card: `{code} · {length_m}m`
- After placement: card goes grey, label gains ✓, `cursor: default`, not draggable
- Cards sorted: unplaced first, placed at bottom

---

## Drag & Drop

### Prefab from Palette → Canvas
1. User starts dragging a prefab card from the left panel.
2. A semi-transparent ghost element (same shape, 50% opacity, dashed border) appears on the canvas snapped to the nearest grid intersection under the cursor.
3. Ghost follows cursor as user moves over canvas.
4. On drop: element placed at snapped position, ghost removed.
5. If dropped outside canvas bounds: cancelled, no element placed.

Implementation: HTML5 `dragstart`/`dragover`/`drop` events. `dragover` calculates snapped canvas position from `event.clientX/Y` and `canvas.getBoundingClientRect()`, updates a `ghostPos` state that drives the ghost element render.

### Berth from Right Panel → Canvas
Same drag mechanic as prefabs. Ghost shows as a berth-sized rectangle.

**Wall snap:** if the ghost is within 1 grid unit of a parallel wall face, it snaps flush to the wall edge instead of the free grid. Snap priority: wall face > grid.

On drop:
- Berth placed on canvas with a `canvas_x`, `canvas_y`, `canvas_rotation` stored in its item record.
- Berth card in right panel updated to placed state (grey + ✓).

---

## Selection & Rotation

### Selection
Click any placed element to select it. Selected state:
- Gold border (`stroke: #b8965a`, `stroke-width: 2`)
- Rotation handle: gold circle (radius 8px) centered 16px above the element's top-center edge, containing a ↻ symbol
- Move cursor on hover (`cursor: move`)

Click canvas background to deselect.

### Rotation
- Drag the gold rotation handle to rotate the selected element.
- Rotation snaps to **45° increments** by default.
- After rotating, the element remains selected and can be dragged to move.
- Rotation stored as degrees (0–359) in the item's `rotation` field.
- Applied via SVG `transform="rotate(deg, cx, cy)"` around the element's pixel center.

**Non-square rotation snap (critical):** SVG visual rotation around the pixel center will displace non-square elements off the grid (e.g. a 2×1 slip rotated 90° lands at a 0.5-unit offset). After every rotation, recalculate the axis-aligned bounding box of the rotated element and snap its top-left corner back to `Math.round(newGx)`, `Math.round(newGy)` so `gx` and `gy` remain whole integers. The SVG transform is then recomputed from the corrected position.

### Deletion
- `Delete` or `Backspace` key removes selected element.
- If the deleted element was a placed berth: its card returns to unplaced state in the right panel.

### Move after drop
Selected elements can be dragged to a new position (separate from the rotation handle drag). Dragged position snaps to grid (or wall face if near a parallel wall).

---

## Parallel Docking Wall

### Prefab
New prefab type: `parallel-wall`. Default size: 8×1 grid units. Visually distinct from a quay: dashed border on the docking face (the long edge boats tie up to), different fill color (`#3a7f5f`).

### Resize
After placing, selecting a parallel wall shows resize handles at both ends (small squares, `#b8965a`). Dragging a handle extends or shortens the wall in 1-unit increments. A small label shows current length in grid units while resizing.

### Berth Snap to Wall
When dragging a berth near a parallel wall (within 1 grid unit):
- Ghost snaps flush to the wall's docking face
- Ghost aligns to nearest slot position along the wall (wall positions are implicit: every 2 grid units along the wall length)
- On drop, berth is associated with the wall in the item record (`{ ..., snapWallId: wall.id, slotIndex: n }`)

Berths snapped to a wall move with the wall if the wall is relocated.

---

## Custom Prefab Creation

### Flow A — Draw Polygon
1. User clicks **"Draw Custom"** in the palette.
2. Canvas enters draw mode (cursor: crosshair, toolbar shows "Drawing — click to add points. Click first point to close.").
3. User clicks to place vertices. Preview line follows cursor from last placed vertex.
4. Close: click the first vertex (gold circle appears at it when ≥3 points exist) or click "Close Shape" button.
5. On close: dialog prompts for prefab name and fill color.
6. Saved to a `customPrefabs` array in `mapConfig`. Appears in a "Custom" section of the palette immediately.
7. Can be placed, moved, rotated like any built-in prefab.

### Flow B — Group Elements into Prefab
1. User Shift+clicks multiple placed elements to select a group (all selected show gold borders).
2. User clicks **"Group → Prefab"** button in palette.
3. Dialog prompts for prefab name.
4. The selected elements are removed from the canvas and saved as a prefab definition (their relative positions preserved).
5. A new card appears in the "Custom" palette section.
6. Placing that prefab re-creates all grouped elements at the drop position.

### Custom Prefab Persistence
Custom prefabs stored in `mapConfig.custom_prefabs` (new field alongside existing `custom_elements`). Loaded on mount, saved on Save button press.

---

## State Shape

```js
// Items on canvas (existing shape, extended)
{
  id,           // uuid
  type,         // prefab type or 'berth' or 'custom-prefab'
  gx, gy,       // grid position (top-left)
  w, h,         // grid dimensions
  rotation,     // degrees, default 0
  fill, stroke,
  label,
  // berth-specific:
  berthId,      // references useBerths() berth.id
  snapWallId,   // id of parallel-wall item this berth is snapped to (optional)
  slotIndex,    // slot along wall (optional)
  // custom prefab instance:
  customPrefabId, // references mapConfig.custom_prefabs entry
}

// Custom prefabs (new) — two variants
mapConfig.custom_prefabs = [
  // Flow A: drawn polygon
  {
    id,
    name,
    kind: 'polygon',
    points: [ { gx, gy } ],  // vertices in grid coords, relative to bounding-box origin
    fill, stroke,
  },
  // Flow B: grouped elements
  {
    id,
    name,
    kind: 'group',
    // origin = Math.min(all selected gx), Math.min(all selected gy) — NOT centroid average.
    // Each element's gx/gy is stored as offset from this origin so the group
    // snaps cleanly to whole grid integers on placement.
    elements: [ /* items with gx/gy as integer offsets from origin */ ],
  }
]
```

---

## Undo

Up to 20 undo steps: `history` ref holds an array of `items` snapshots (max 20, oldest dropped when full). Ctrl+Z and the Undo toolbar button both pop the last snapshot and restore it. No redo.

---

## Out of Scope

- Free (non-snapped) rotation
- Multi-level undo/redo
- Zoom/pan on the canvas
- Exporting map as image
- Renaming or deleting custom prefabs (future)
