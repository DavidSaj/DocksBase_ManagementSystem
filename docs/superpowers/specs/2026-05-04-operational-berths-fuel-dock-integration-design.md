# Operational Berths & Fuel Dock Integration — Design Spec

**Date:** 2026-05-04
**Status:** Approved

## Overview

Connects the Operations tab fuel dock queue to real berth records. Introduces a `berth_class` / `operational_type` system on the Berth model, removes the disconnected `marina.fuel_berths` JSON array and the standalone Fuel Dock pier prefab, and makes the LiveMap show who is actively fueling at each berth.

---

## 1. Data Model

### Berth model — two new fields

```python
berth_class = models.CharField(
    max_length=20,
    choices=[('standard', 'Standard'), ('operational', 'Operational')],
    default='standard',
)
operational_type = models.CharField(
    max_length=30,
    choices=[('fuel_dock', 'Fuel Dock')],
    blank=True,
    default='',
)
```

- `berth_class='standard'` is the default for all existing berths (backward-compatible migration).
- `operational_type` is only meaningful when `berth_class='operational'`. Setting `berth_class` back to `standard` clears `operational_type`.
- `fuel_dock` is the only operational type for now. The design is intentionally extensible (pump-out, haul-out, etc. added as future choices).

### FuelDockEntry — fuel_berth becomes a FK

```python
fuel_berth = models.ForeignKey(
    'berths.Berth',
    null=True, blank=True,
    on_delete=models.SET_NULL,
    related_name='fuel_entries',
)
```

- Replaces the existing `fuel_berth = CharField(max_length=20)`.
- `null=True` preserves backward compat for any existing rows during the migration.
- The old `marina.fuel_berths` JSONField is no longer read. It can be dropped in a subsequent cleanup migration once confirmed safe.

### Pier model — fuel-dock pier type

- `pier_type='fuel-dock'` stays in the enum for backward compat with any existing map data.
- The Fuel Dock prefab is removed from the map palette — no new fuel-dock piers can be placed.
- Existing fuel-dock piers on maps remain visible as structural elements but carry no operational meaning.

---

## 2. Harbor Infrastructure UI

When creating or editing a berth, the form gains a **Classification** section below the existing code/berth_type fields:

```
Classification
  ○ Standard      ← default; nothing extra to configure
  ● Operational
      Type: [Fuel Dock ▾]   ← dropdown, single choice for now
```

- Selecting **Operational** reveals the type dropdown.
- Switching back to **Standard** clears `operational_type` on save.
- All other berth attributes (dimensions, amenities, pricing tier, status) are unchanged for operational berths.

---

## 3. Map Editor

- **Fuel Dock pier prefab removed** from `MapBuilderPalette`. The entry is deleted from `mapBuilderPrefabs.js`.
- Operational berths (`operational_type='fuel_dock'`) appear in the **unplaced berths sidebar** alongside standard berths, with a distinct amber tag and "Fuel Dock" sub-label.
- They snap onto any pier type using the existing snapping logic — no special pier required.
- On canvas, fuel dock berths render with an amber fill (e.g. `#f0a020`) and gold stroke (`#c87010`), distinct from standard berth colors. Shape and snap behavior are identical to standard berths.
- `PIER_COLORS['fuel-dock']` entry stays for rendering legacy fuel-dock piers but `'fuel-dock'` is removed from the prefab palette list.

---

## 4. Operations Tab

- The right-panel fuel berth list is populated from `GET /berths/?operational_type=fuel_dock` (filtered to the marina via auth context).
- Each berth's `code` is the display name in the slot UI.
- When assigning a queue entry to a berth, the payload sends `fuel_berth` as the berth's `id` (FK), not a free-text string.
- `marina.fuel_berths` is no longer read anywhere in the frontend. The field is left in place on the backend until a cleanup migration removes it.
- The `useFuelQueue` hook is updated to pass `fuel_berth` as an ID on create/update.

---

## 5. LiveMap

- On each poll cycle, the LiveMap fetches active `FuelDockEntry` records alongside berth/pier data: `GET /fuel-dock/queue/?active=1`.
- Berths with a linked entry at `status='service'` render with an **amber fill** overlay (same amber as the map editor's fuel dock berth color).
- The berth label always shows the active entry's vessel name or `guest_description` (e.g. `"Seabreeze"`).
- Hovering a fueling berth shows a tooltip: vessel name, fuel type, estimated litres.
- Berths with entries at `status='waiting'` or `status='next'` render in their normal available/occupied color — only `service` status triggers the amber overlay.
- Poll interval remains 30 seconds. No WebSocket needed.

---

## 6. API Changes

### Berths endpoint

- `GET /berths/?operational_type=fuel_dock` — new filter param
- Berth serializer exposes `berth_class` and `operational_type`

### FuelDockEntry endpoint

- `POST /fuel-dock/queue/` — `fuel_berth` field now accepts a Berth `id` (integer FK) instead of a string
- `GET /fuel-dock/queue/?active=1` — response includes `fuel_berth` as a nested object with `id` and `code`

---

## 7. Migration Notes

1. Add `berth_class` (default `'standard'`) and `operational_type` (default `''`) to `Berth` — no data migration needed, all existing berths become standard.
2. Add new `fuel_berth` FK column to `FuelDockEntry` (nullable). Existing rows retain the old `fuel_berth` CharField until manually mapped. The old CharField can be dropped in a follow-up migration once all rows are migrated.
3. No changes to Pier model schema.

---

## 8. Out of Scope

- Pump-out, haul-out, or other operational types (schema supports them, but no UI yet)
- Real-time WebSocket push for fueling status (30s poll is sufficient)
- Removing `marina.fuel_berths` JSONField (deferred cleanup migration)
- Removing old `fuel_berth` CharField from `FuelDockEntry` (deferred until data migrated)
