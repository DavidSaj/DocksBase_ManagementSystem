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
| Dry Storage slots | DB record per slot — flexible, manager can configure lane/column/tier layout |
| Dry Storage dimensionality | 3D — lane + col + tier. tier=1 is ground, tier=2 middle, tier=3 top |
| Blocked slot rule | Slot at tier N is blocked if same lane+col at tier N-1 has a vessel assigned |
| Weather Hold | Persisted on `Marina` model as `operations_paused` BooleanField — marina-wide, syncs to all devices |
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
  tier         IntegerField(default=1)         — 1=Ground, 2=Middle, 3=Top
  vessel       ForeignKey → vessels.Vessel (SET_NULL, null=True, blank=True)

  Meta.ordering = ['lane', 'col', 'tier']
  unique_together = [('marina', 'lane', 'col', 'tier')]
  __str__ = f"{lane}-{col}-T{tier}"
```

**Blocked slot rule (frontend):** A slot is blocked if its `tier > 1` AND the slot at the same `lane` + `col` with `tier = this.tier - 1` has a vessel assigned. This is a pure frontend computation over the sorted slot list — no backend field needed.

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

`vessel` uses `PROTECT` — prevents deletion of a vessel actively in a launch queue.

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

`access_start` / `access_end` are Phase 2 hooks for smart-gate integration.

---

## 2. Model Enrichments

### `Marina` (accounts app)

Add:
- `operations_paused` — `BooleanField(default=False)`

This is the marina-wide Weather Hold flag. When `True`, the Launch Queue frontend disables all "Assign & Schedule" actions and displays the hold banner. All devices read this from the `/api/v1/marina/` endpoint so the state syncs instantly.

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
| `accounts/migrations/0002_...` | Add `operations_paused` to Marina |
| `boatyard/migrations/0002_...` | Add `notes` to HaulOut + WorkOrder; add `serial`/`location` to Tool; Meta ordering; add StorageSlot, LaunchRequest, Contractor |
| `maintenance/migrations/0002_...` | Add `notes` to Asset |

Django may batch these differently — use `makemigrations` output as-is.

---

## 4. API Endpoints

All endpoints are JWT-authenticated. All querysets filtered by `request.user.marina`.

### Marina (Weather Hold)

The existing `/api/v1/marina/` endpoint (in `accounts` app) already returns the marina object. Add `operations_paused` to the marina serializer so it is readable and writable. A `PATCH /api/v1/marina/` with `{ "operations_paused": true }` toggles the hold marina-wide.

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

The Boatyard Facility Log tab calls `/api/v1/assets/` — the same endpoint as the Maintenance Asset Register.

---

## 5. Serializers

### `HaulOutSerializer`
Fields: `id`, `vessel`, `vessel_name` (read-only source), `haul_type`, `scheduled_at`, `equipment`, `crew`, `status`, `assigned_to`, `notes`

### `StorageSlotSerializer`
Fields: `id`, `lane`, `col`, `tier`, `vessel`, `vessel_name` (read-only source, default `''`)

### `LaunchRequestSerializer`
Fields: `id`, `vessel`, `vessel_name` (read-only), `slot`, `slot_label` (read-only, `slot.__str__` or `''`), `equipment`, `assigned_to`, `status`, `notes`, `created_at`

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

### Weather Hold

`useMarina` hook (existing) returns the marina object including `operations_paused`. The Launch Queue tab reads `marina.operations_paused` for the hold banner and button state. "Weather Hold" button calls `PATCH /api/v1/marina/` with `{ operations_paused: !marina.operations_paused }`. Because all devices read from the same endpoint, the state is immediately consistent.

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

**Haul-out Schedule** — table from `useHaulOuts`. "Schedule Lift" → create modal (vessel select, type, date/time, equipment, crew).

**Launch Queue** — cards from `useLaunchRequests`. Weather Hold button calls `PATCH /api/v1/marina/` and reads `marina.operations_paused` — hold banner shown and launch actions disabled when true. Summary counts computed from local state. Action buttons call `updateRequest(id, { status })`.

**Dry Storage Map** — grid from `useStorageSlots`. Group by lane → col → sort by tier. Blocked rule: `tier > 1` and same `lane+col` at `tier - 1` has a vessel. Slot colours: occupied=blue, available=grey, blocked=yellow. Click occupied → clear modal. Click available (not blocked) → assign vessel modal.

**Work Orders** — cards from `useWorkOrders`. Action buttons call `updateWorkOrder(id, { status })` for Authorise / Start Work / Mark Complete.

**Parts & Inventory** — table from `useParts`. Below-PAR badge. Stock highlighted red when `stock < par`.

**Tools** — grouped category cards + table from `useTools`. Check Out → modal entering `checked_out_to`. Return → clears it. Log Service → updates `calibration_due`.

**Contractors** — table from `useContractors`. Add / Delete actions.

**Facility Log** — table from `useAssets`. Status badges: `ok`→green, `due_service`→orange, `under_repair`→red.

---

## 7. Tests

### `apps/boatyard/tests.py`

| Class | Tests |
|---|---|
| `HaulOutTest` | POST creates; GET scoped to marina; PATCH updates status |
| `StorageSlotTest` | POST creates slot with tier; PATCH assigns vessel; PATCH clears vessel; unique_together enforced |
| `LaunchRequestTest` | POST creates; PATCH status transitions (pending→scheduled→launching→retrieved) |
| `WorkOrderTest` | POST creates; PATCH status transitions; GET scoped |
| `PartTest` | POST creates; GET scoped; stock/par values preserved |
| `ToolTest` | POST creates with serial/location; PATCH check-out sets checked_out_to; PATCH return clears it |
| `ContractorTest` | POST creates; DELETE removes; GET scoped |

### `apps/accounts/tests.py` (addition)

| Test | Description |
|---|---|
| `test_marina_operations_paused_toggle` | PATCH `/api/v1/marina/` with `operations_paused=true` persists; second device reading same endpoint sees updated value |

---

## Design Constraints

- All models carry `marina` FK — no cross-marina data leakage
- Weather Hold is `Marina.operations_paused` — persisted, syncs to all devices via existing `/api/v1/marina/` endpoint
- Dry Storage is 3D: lane + col + tier. `unique_together` enforces no duplicate positions per marina
- Blocked slot rule is frontend-only computation — no backend field needed
- Facility Log tab = same `Asset` model as Maintenance Asset Register — `/api/v1/assets/` implemented in Maintenance phase
- `useAssets` hook created in Boatyard phase; Maintenance phase wires it into `Maintenance.jsx`
- Tool check-out is simple CharField — no audit trail (YAGNI)
- `LaunchRequest.vessel` uses PROTECT — prevents deletion of vessel while in queue
