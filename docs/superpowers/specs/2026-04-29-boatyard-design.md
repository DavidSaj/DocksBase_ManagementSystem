# Boatyard — Design Spec

**Date:** 2026-04-29
**Status:** Approved
**Branch:** feat/operations-reservations
**Scope:** Backend models, serializers, views, URLs, and full frontend wire-up for all 8 Boatyard tabs.

---

## Context

`Boatyard.jsx` has 8 tabs running entirely on mock data. The `boatyard` app has skeleton models for `HaulOut`, `WorkOrder`, `Part`, and `Tool`, all with placeholder views. Four tabs (Launch Queue, Dry Storage Map, Contractors, Facility Log) have no backend model at all. This spec makes all 8 tabs real.

---

## Decisions

| Concern | Decision |
|---|---|
| Dry Storage slots | DB record per slot — flexible, manager can configure lane/column layout |
| Facility Log | Reuses `Asset` model from `maintenance` app — no duplication |
| Work Orders | Live in `boatyard` app — vessel work, not marina infrastructure |
| Tool check-out | Simple CharField `checked_out_to` — no separate check-out event model |
| Launch Queue | Daily queue for dry-stack vessels; links to StorageSlot FK |

---

## 1. New Models (boatyard app)

### `StorageSlot`

```
StorageSlot
  marina       ForeignKey → accounts.Marina (CASCADE)
  lane         CharField(max_length=50)        — e.g. "Lane 1"
  col          CharField(max_length=10)        — e.g. "A"
  vessel       ForeignKey → vessels.Vessel (SET_NULL, null=True, blank=True)

  Meta.ordering = ['lane', 'col']
  __str__ = f"{lane}-{col}"
```

### `LaunchRequest`

```
LaunchRequest
  marina       ForeignKey → accounts.Marina (CASCADE)
  vessel       ForeignKey → vessels.Vessel (PROTECT)
  slot         ForeignKey → StorageSlot (SET_NULL, null=True, blank=True)
  equipment    CharField(max_length=200, blank=True)
  assigned_to  CharField(max_length=200, blank=True)
  status       CharField choices: pending / scheduled / launching / retrieved
  notes        TextField(blank=True)
  created_at   DateTimeField(auto_now_add=True)

  Meta.ordering = ['created_at']
  __str__ = f"Launch — {vessel.name}"
```

### `Contractor`

```
Contractor
  marina        ForeignKey → accounts.Marina (CASCADE)
  name          CharField(max_length=200)
  trade         CharField(max_length=200, blank=True)
  working_on    CharField(max_length=200, blank=True)   — vessel name free text
  access_start  DateField()
  access_end    DateField(null=True, blank=True)
  vessel_owner  CharField(max_length=200, blank=True)

  Meta.ordering = ['access_start']
  __str__ = name
```

---

## 2. Model Enrichments

### `HaulOut` (boatyard)

Add:
- `notes` — `TextField(blank=True)`
- `Meta.ordering = ['-scheduled_at']`
- `__str__ = f"HaulOut #{pk} — {vessel.name}"`

### `WorkOrder` (boatyard)

Add:
- `notes` — `TextField(blank=True)`
- `Meta.ordering = ['-created_at']`
- `__str__ = f"WO-{pk} {title}"`

### `Part` (boatyard)

Add:
- `Meta.ordering = ['name']`
- `__str__ = name`

### `Tool` (boatyard)

Add:
- `serial` — `CharField(max_length=100, blank=True)`
- `location` — `CharField(max_length=200, blank=True)`
- `Meta.ordering = ['name']`
- `__str__ = name`

### `Asset` (maintenance app)

Add:
- `notes` — `TextField(blank=True)`

No other changes to the Maintenance app in this phase.

---

## 3. Migrations

| File | Content |
|---|---|
| `boatyard/migrations/0002_...` | Add `notes` to HaulOut + WorkOrder; add `serial`/`location` to Tool; Meta ordering on Part/Tool/HaulOut/WorkOrder; add StorageSlot, LaunchRequest, Contractor |
| `maintenance/migrations/0002_...` | Add `notes` to Asset |

Django may batch these differently — use `makemigrations` output as-is.

---

## 4. API Endpoints

All endpoints are JWT-authenticated. All querysets filtered by `request.user.marina`.

### Haul-outs

| Method | URL | View |
|---|---|---|
| GET / POST | `/api/v1/haul-outs/` | `HaulOutList` |
| GET / PATCH | `/api/v1/haul-outs/<pk>/` | `HaulOutDetail` |

### Storage Slots

| Method | URL | View |
|---|---|---|
| GET / POST | `/api/v1/storage-slots/` | `StorageSlotList` |
| GET / PATCH / DELETE | `/api/v1/storage-slots/<pk>/` | `StorageSlotDetail` |

### Launch Requests

| Method | URL | View |
|---|---|---|
| GET / POST | `/api/v1/launch-requests/` | `LaunchRequestList` |
| GET / PATCH | `/api/v1/launch-requests/<pk>/` | `LaunchRequestDetail` |

### Work Orders

| Method | URL | View |
|---|---|---|
| GET / POST | `/api/v1/work-orders/` | `WorkOrderList` |
| GET / PATCH | `/api/v1/work-orders/<pk>/` | `WorkOrderDetail` |

### Parts

| Method | URL | View |
|---|---|---|
| GET / POST | `/api/v1/parts/` | `PartList` |
| GET / PATCH / DELETE | `/api/v1/parts/<pk>/` | `PartDetail` |

### Tools

| Method | URL | View |
|---|---|---|
| GET / POST | `/api/v1/tools/` | `ToolList` |
| GET / PATCH | `/api/v1/tools/<pk>/` | `ToolDetail` |

### Contractors

| Method | URL | View |
|---|---|---|
| GET / POST | `/api/v1/contractors/` | `ContractorList` |
| GET / PATCH / DELETE | `/api/v1/contractors/<pk>/` | `ContractorDetail` |

### Assets (Facility Log — served by Maintenance app)

| Method | URL | View |
|---|---|---|
| GET / POST | `/api/v1/assets/` | `AssetList` *(implemented in Maintenance phase)* |
| GET / PATCH | `/api/v1/assets/<pk>/` | `AssetDetail` *(implemented in Maintenance phase)* |

The Boatyard Facility Log tab calls `/api/v1/assets/` — the same endpoint as the Maintenance Asset Register. No separate endpoint needed.

---

## 5. Serializers

### `HaulOutSerializer`
Fields: `id`, `vessel`, `vessel_name` (read-only source), `haul_type`, `scheduled_at`, `equipment`, `crew`, `status`, `assigned_to`, `notes`

### `StorageSlotSerializer`
Fields: `id`, `lane`, `col`, `vessel`, `vessel_name` (read-only source, default `''`)

### `LaunchRequestSerializer`
Fields: `id`, `vessel`, `vessel_name` (read-only), `slot`, `slot_label` (read-only source `slot.__str__`), `equipment`, `assigned_to`, `status`, `notes`, `created_at`

### `WorkOrderSerializer`
Fields: `id`, `vessel`, `vessel_name` (read-only), `title`, `category`, `description`, `priority`, `status`, `assigned_to`, `estimate`, `actual`, `created_at`, `due`, `notes`

### `PartSerializer`
Fields: `id`, `name`, `part_no`, `category`, `supplier`, `unit_cost`, `sell_price`, `stock`, `par`, `location`

### `ToolSerializer`
Fields: `id`, `name`, `category`, `serial`, `location`, `status`, `checked_out_to`, `work_order`, `calibration_due`

### `ContractorSerializer`
Fields: `id`, `name`, `trade`, `working_on`, `access_start`, `access_end`, `vessel_owner`

---

## 6. Frontend

### New hooks

| Hook | File | Endpoints used |
|---|---|---|
| `useHaulOuts` | `frontend/src/hooks/useHaulOuts.js` | GET/POST `/haul-outs/`, PATCH `/haul-outs/<pk>/` |
| `useStorageSlots` | `frontend/src/hooks/useStorageSlots.js` | GET/POST `/storage-slots/`, PATCH `/storage-slots/<pk>/` |
| `useLaunchRequests` | `frontend/src/hooks/useLaunchRequests.js` | GET/POST `/launch-requests/`, PATCH `/launch-requests/<pk>/` |
| `useWorkOrders` | `frontend/src/hooks/useWorkOrders.js` | GET/POST `/work-orders/`, PATCH `/work-orders/<pk>/` |
| `useParts` | `frontend/src/hooks/useParts.js` | GET/POST `/parts/`, PATCH `/parts/<pk>/` |
| `useTools` | `frontend/src/hooks/useTools.js` | GET/POST `/tools/`, PATCH `/tools/<pk>/` |
| `useContractors` | `frontend/src/hooks/useContractors.js` | GET/POST `/contractors/`, PATCH/DELETE `/contractors/<pk>/` |
| `useAssets` | `frontend/src/hooks/useAssets.js` | GET `/assets/`, PATCH `/assets/<pk>/` — also used by Maintenance |

### `Boatyard.jsx` tab wire-up

**Haul-out Schedule** — table from `useHaulOuts`. "Schedule Lift" button → create modal (vessel select, type, date/time, equipment, crew). Status badge. No inline status transitions needed (managers edit directly).

**Launch Queue** — cards from `useLaunchRequests`. Summary counts (queued / launching / retrieved) computed from local state. Weather Hold toggle is local UI state only (no backend — it's a visual hold, not persisted). Action buttons call `updateRequest(id, { status: 'scheduled' | 'launching' | 'retrieved' })`.

**Dry Storage Map** — grid from `useStorageSlots`. Group slots by lane, then sort by col. Each slot rendered as a coloured cell: occupied (vessel assigned), available, blocked (vessel above occupies overhead — compute from sorted slots: slot in row N is blocked if row N-1 same col has a vessel). Click occupied slot → clear vessel modal. Click empty slot → assign vessel modal.

**Work Orders** — cards from `useWorkOrders`. "New Work Order" → create modal. Action buttons: Authorise (`status: 'authorised'`), Start Work (`status: 'in_progress'`), Mark Complete (`status: 'completed'`). Each calls `updateWorkOrder(id, { status })`.

**Parts & Inventory** — table from `useParts`. "Add Part" → create modal. Below-PAR count badge. Stock highlighted red when `stock < par`.

**Tools** — grouped category cards + full table, from `useTools`. "Add Tool" → create modal. Check Out button → modal (enter who), Return button → clears `checked_out_to`, Log Service button → updates `calibration_due`.

**Contractors** — table from `useContractors`. "Add" button → create modal. Delete row action.

**Facility Log** — table from `useAssets`. Reuses the same hook as Maintenance Asset Register. Status badge colours: `ok` → green, `due_service` → orange, `under_repair` → red. "Log Entry" button → create asset modal.

---

## 7. Tests

### `apps/boatyard/tests.py`

| Class | Tests |
|---|---|
| `HaulOutTest` | POST creates; GET scoped to marina; PATCH updates status |
| `StorageSlotTest` | POST creates slot; PATCH assigns vessel; PATCH clears vessel |
| `LaunchRequestTest` | POST creates; PATCH status transitions (pending→scheduled→launching→retrieved) |
| `WorkOrderTest` | POST creates; PATCH status transitions; GET scoped |
| `PartTest` | POST creates; GET shows below-par flag derivable from stock/par; GET scoped |
| `ToolTest` | POST creates with serial/location; PATCH check-out sets checked_out_to; PATCH return clears it |
| `ContractorTest` | POST creates; DELETE removes; GET scoped |

---

## Design Constraints

- All models carry `marina` FK — no cross-marina data leakage
- Weather Hold is local UI state only — no backend persistence needed
- Facility Log tab = filtered view of `Asset` model (maintained by Maintenance phase)
- `useAssets` hook created in this phase so Boatyard Facility Log works immediately; Maintenance phase wires it into Maintenance.jsx
- Tool check-out is simple CharField — no audit trail of check-out history (YAGNI)
- Blocked slot calculation is purely frontend — derived from sorted slot data, no backend field needed
