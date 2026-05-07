# Map Editor Improvements — Design Spec

**Date:** 2026-05-07
**Status:** Approved
**Branch:** feature/map-editor-city-builder

## Problem

Five issues with the current map editor:

1. **Draw mode overflow** — when drawing and zoomed in, the canvas bleeds outside the container border
2. **Pier naming** — dropped shapes get auto-generated codes (e.g., `PONT-AB12`); no named pier concept
3. **Compound docks create N pier records** — every block in a combo dock is a separate DB record, so move/rotate only affects one block at a time
4. **Grid snap too fine at low zoom** — at high zoom-out the snap dot is tiny and always snaps to 1 GU even when a 5 GU snap would be more useful
5. **Finger pier width not proportional** — `fingerW` is hardcoded to 2 GU regardless of berth beam size

---

## Section 1: Data Model

### New model: `LogicalPier`

```python
class LogicalPier(models.Model):
    marina      = ForeignKey(Marina, on_delete=CASCADE)
    name        = CharField(max_length=100)   # "Pier A", "North Dock", "Visitors' Pontoon"
    pier_type   = CharField(max_length=30)    # pontoon, concrete, steel, etc.
    notes       = TextField(blank=True)
```

Created and managed in Harbor Infrastructure. Fully optional — a marina works fine without any defined.

### Changes to `Pier` (canvas dock shape)

```python
# New fields added to existing model
display_name  = CharField(max_length=100, blank=True)
logical_pier  = ForeignKey(LogicalPier, null=True, blank=True, on_delete=SET_NULL)
components    = JSONField(default=list)
# Component schema:
# [{ "id": "c_9f8a2", "type": "spine"|"finger", "ox": 0, "oy": 0, "w": 10, "h": 2 }]
# ox/oy = offset from pier canvas_x/canvas_y anchor (grid units)
```

- **Simple piers** (`components = []`): shape defined by `canvas_w/h` as today — no behaviour change
- **Compound piers**: `components` holds sub-shapes with stable UUIDs; `canvas_w/h` stores the bounding box

`canvas_x/y/rotation` remain as the anchor for the whole structure in both cases.

### Changes to `Berth`

`position_on_parent` (currently JSONField storing `{side, slot_index}`) is migrated to a `CharField(max_length=50, blank=True, default='')`:
- **Compound pier**: stores component UUID (e.g. `"c_1b3e7"`)
- **Simple pier**: empty string — berth snaps to pier body as before

Migration sets all existing `position_on_parent` values to `''` (safe: the old `{side, slot_index}` data is superseded by the new component UUID system).

`local_x` / `local_y` remain as the offset from the component's ox/oy (compound) or pier center (simple).

### Deletion cascade

When `PATCH /piers/{id}/` receives an updated `components` array, the Django view diffs old vs new UUID sets. Any UUID present in the old set but absent in the new set triggers:

```python
Berth.objects.filter(pier=pier, position_on_parent__in=removed_ids).update(
    pier=None, position_on_parent='', local_x=None, local_y=None, is_placed=False
)
```

This runs atomically before saving the pier. Orphaned berths reappear in the Unassigned Berths sidebar immediately.

---

## Section 2: Backend

### Migration

1. Create `LogicalPier` model
2. Add `logical_pier` FK, `display_name`, `components` to `Pier`
3. Migrate `position_on_parent` from JSONField to CharField (or update usage in place)

### New endpoints

| Method | URL | Purpose |
|--------|-----|---------|
| GET/POST | `/logical-piers/` | List + create; filtered by marina |
| GET/PATCH/DELETE | `/logical-piers/{id}/` | Manage individual |

### Updated `Pier` endpoint

`PATCH /piers/{id}/` gains two new behaviours:

1. **Assign to logical pier** — `{ logical_pier: 12 }` links the dock shape to a named pier
2. **Component update cascade** — when `components` is in the payload, the view diffs old vs new UUID set and unplaces orphaned berths atomically before saving

### Serializers

- `PierSerializer`: exposes `logical_pier_id` and `logical_pier_name` (read-only, resolved from FK)
- `LogicalPierSerializer`: includes `dock_shapes_count` annotation and `berths_count` (berths whose dock shape points to this logical pier)

---

## Section 3: Map Editor Changes

### Bug fix — Draw mode overflow

`MapBuilder.jsx` line 859: remove `overflow: isDrawMode ? 'visible' : 'hidden'`. Container is always `overflow: hidden`. The extended invisible hit-area rect already inside `CanvasCore` (beyond canvas bounds) handles edge drawing without the container needing to bleed.

### Bug fix — Adaptive grid snap + cursor dot size

`snapToGrid` in `mapBuilderUtils.js` gains a `snapGrid` multiplier:

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

`MapBuilder.jsx handleCanvasPointerMove` passes `viewRef.current.zoom` to the draw cursor update so the draw cursor also uses the coarser snap.

`CanvasCore.jsx` cursor dot: change `r={5}` to `r={Math.max(5, 16 / zoom)}` so it remains visually large at low zoom.

### Bug fix — Finger width scaling

`mapBuilderPrefabs.js buildComboDockLayout`:

```js
const fingerW = Math.max(1, berthBeamGU)  // was hardcoded 2
const fingerSpacing = fingerW + 2 * berthBeamGU
```

When berth beam is 1 GU, fingers are 1 GU wide. Spacing scales accordingly.

### Feature — Compound dock → single Pier record

When a compound prefab is dropped (`p.compound && p.components`), instead of `Promise.all(components.map(createPier))`, a single `createPier` call is made:

```js
const componentUUIDs = layout.components.map(comp => ({
  ...comp,
  id: `c_${newId()}`,   // UUID generated client-side at drop time
}))
await createPier({
  code:       `${suffix}`,
  pier_type:  p.material ?? 'pontoon',
  canvas_x:   (gx + p.w / 2).toFixed(2),
  canvas_y:   (gy + p.h / 2).toFixed(2),
  canvas_w:   p.w,
  canvas_h:   p.h,
  rotation:   0,
  components: componentUUIDs,
})
```

Simple (non-compound) prefabs: no change, `components` stays `[]`.

### Feature — Drop opens detail panel automatically

After any successful drop, `selectedIds` is set to the new pier's shape ID. The `SelectedItemPanel` gains two new fields:

- **Name** — text input bound to `display_name`; saves on blur via `PATCH /piers/{id}/`
- **Assign Pier** — searchable dropdown of `LogicalPier` records for this marina. "Create new pier…" option at the bottom opens an inline mini-form (name + type), POSTs to `/logical-piers/`, and immediately selects the new pier in the dropdown.

Panel can be dismissed at any time without assigning — both fields are optional.

### Feature — Compound pier move/rotate

Because compound docks are now one Pier record, `handleRotateSelected` / `handleResizeSelected` work on the whole structure automatically.

**Bounding box hit-area trap:** `canvas_w/h` stores the bounding box of a compound pier. Clicking empty water inside an L-shaped dock's bounding box must not select the dock. `CanvasCore.jsx` must not use the bounding box rect for pointer hit detection on compound piers. Instead, `onPointerDown` on a pier shape with `components.length > 0` must iterate each component's rotated rect and only fire if the pointer lands inside at least one component. For simple piers (`components = []`), the existing bounding-box `<rect>` hit area is fine.

### Feature — Berth snapping to components

`snapBerthToPier` in `mapBuilderUtils.js` is extended. Three math rules apply:

**Rule 1 — Compound component absolute position requires rotation.**
`comp.ox/oy` are offsets relative to the pier anchor at `rotation=0`. When the pier is rotated, they must be rotated first:

```js
const θ = (pier.rotation * Math.PI) / 180
const rotOx = comp.ox * Math.cos(θ) - comp.oy * Math.sin(θ)
const rotOy = comp.ox * Math.sin(θ) + comp.oy * Math.cos(θ)
const compAbsX = pier.canvas_x + rotOx
const compAbsY = pier.canvas_y + rotOy
```

**Rule 2 — Berth `local_x/local_y` are always relative to the Pier's main origin (canvas_x/canvas_y), not the component.**
`position_on_parent` records which component the berth belongs to (for deletion cascade), but the stored `local_x/local_y` are the berth's offset from the Pier anchor. This means rendering always uses `computeAbsPosition(pier, berth)` unchanged — no double-math needed.

When snapping to a component edge, the returned snap values must convert back to Pier-origin coordinates:

```js
return {
  pierId: pier.id,
  position_on_parent: comp.id,
  local_x: snapAbsX - pier.canvas_x,   // relative to Pier origin, not comp
  local_y: snapAbsY - pier.canvas_y,
  absX: snapAbsX,
  absY: snapAbsY,
  berthW, berthH,
}
```

**Rule 3 — For simple piers, behaviour is unchanged.** If `pier.components.length === 0`, the existing snap-to-pier-body logic runs as before, returning `position_on_parent: ''`.

---

## Section 4: Harbor Infrastructure — Pier Management

### Piers tab in `Infrastructure.jsx`

The existing "Piers" tab currently shows canvas dock shapes (the old auto-named `Pier` records). This tab is repurposed to manage `LogicalPier` entities. Canvas dock shapes are managed exclusively from the map editor; they no longer need their own Harbor Infrastructure table.

**Table columns:** Name · Type · Dock Shapes (count) · Berths (count) · Notes · Actions

**Create pier** — inline row form or small modal: Name (required), Type (dropdown), Notes (optional).

**Edit pier** — same fields plus read-only "Assigned dock shapes" list with a "View on map" shortcut.

**Delete pier** — if dock shapes are assigned, warns: "X dock shapes will be unassigned but not deleted." Sets `dock.logical_pier = null` on those shapes atomically.

### Canvas label resolution

The canvas renders a pier's label in this priority order:
1. `display_name` (user-set on the dock shape)
2. `logical_pier.name` (resolved from FK, returned by serializer)
3. `code` (auto-generated fallback)

---

## Canvas Math Reference

Three rotation/coordinate rules that must be applied consistently throughout implementation:

| Rule | Where it applies | Formula |
|------|-----------------|---------|
| Rotate component offset by pier angle | `snapBerthToPier`, `CanvasCore` hit-test | `rotOx = ox·cos θ − oy·sin θ`, `rotOy = ox·sin θ + oy·cos θ` |
| Berth local coords relative to Pier origin | `snapBerthToPier` return value, `computeAbsPosition` | `local_x = snapAbsX − pier.canvas_x` (not minus compAbsX) |
| Hit-test compound pier by components, not bounding box | `CanvasCore` pointer events | Iterate `components`, skip bounding box |

---

## Files Affected

| Action | File |
|--------|------|
| Create | `backend/berths/migrations/XXXX_logical_pier.py` |
| Edit | `backend/berths/models.py` — add LogicalPier, update Pier + Berth |
| Edit | `backend/berths/views.py` — cascade logic, new endpoints |
| Edit | `backend/berths/serializers.py` — updated Pier + new LogicalPier serializers |
| Edit | `frontend/src/components/harbor-map/mapBuilderUtils.js` — snapToGrid, snapBerthToPier |
| Edit | `frontend/src/components/harbor-map/mapBuilderPrefabs.js` — fingerW scaling |
| Edit | `frontend/src/components/harbor-map/MapBuilder.jsx` — drop logic, overflow fix, detail panel |
| Edit | `frontend/src/components/harbor-map/CanvasCore.jsx` — cursor dot size |
| Create | `frontend/src/components/harbor-map/LogicalPierDropdown.jsx` — assign pier dropdown |
| Edit | `frontend/src/screens/Infrastructure.jsx` — repurpose Piers tab for LogicalPier management |
| Create | `frontend/src/hooks/useLogicalPiers.js` |
