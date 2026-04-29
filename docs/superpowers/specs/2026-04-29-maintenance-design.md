# Maintenance Module — Design Spec

**Date:** 2026-04-29
**Status:** Approved
**Branch:** main (new branch: feat/maintenance)
**Scope:** Backend models, serializers, views, URLs for all Maintenance tabs; frontend wire-up of Maintenance.jsx (5 tabs); new /field mobile route.

---

## Context

`Maintenance.jsx` has 4 existing tabs all running on mock data: Staff Tasks, Incidents, Asset Register, Defect Log. The `maintenance` app has models for `Task`, `Incident`, `Asset`, and `Defect`, all with a placeholder view. This spec makes all 4 existing tabs real, adds a new **Maintenance Tasks** Kanban tab (backed by a new `MaintenanceTask` model) as the second tab, and adds a standalone `/field` mobile route for field crew.

---

## Decisions

| Concern | Decision |
|---|---|
| WorkOrder vs MaintenanceTask | Strict split: `WorkOrder` (boatyard) = customer vessel work (billable); `MaintenanceTask` (maintenance) = marina infrastructure (internal) |
| Defect → Task workflow | Atomic transaction via `POST /api/v1/defects/<pk>/create-task/` |
| Kanban interaction | Click-to-move buttons — no drag-and-drop, no extra library |
| Staff Tasks tab | Keep existing `Task` model — simple daily checkbox list alongside `MaintenanceTask` |
| /field routing | Install `react-router-dom`; `/field` is a real URL route, auth-gated via `isAuthenticated()` from `api.js`, no desktop shell |
| Photo upload | Django `FileField(upload_to='maintenance_tasks/')` — same `MEDIA_ROOT` pattern as member documents |
| Asset endpoint | Implemented here in Maintenance phase; Boatyard Facility Log reads same `/api/v1/assets/` endpoint via `useAssets` hook (already created) |

---

## 1. Model Changes

### `Incident` (maintenance app)

Add:
- `notes` — `TextField(blank=True)`

All other fields unchanged.

### `MaintenanceTask` (new model — maintenance app)

```
MaintenanceTask
  marina           ForeignKey → accounts.Marina (CASCADE)
  asset            ForeignKey → Asset (SET_NULL, null=True, blank=True)
  defect           ForeignKey → Defect (SET_NULL, null=True, blank=True)
  title            CharField(max_length=200)
  description      TextField(blank=True)
  assigned_to      CharField(max_length=200, blank=True)
  priority         CharField choices: low / medium / high / urgent, default='medium'
  status           CharField choices: pending / in_progress / blocked / completed, default='pending'
  due_date         DateField(null=True, blank=True)
  completed_at     DateTimeField(null=True, blank=True)    — set by view on status→completed
  completion_notes TextField(blank=True)
  completion_photo FileField(upload_to='maintenance_tasks/', null=True, blank=True)

  Meta.ordering = ['-priority', 'due_date']
  __str__ = f"Task: {self.title}"
```

### Migrations

| File | Content |
|---|---|
| `maintenance/migrations/0003_incident_notes.py` | Add `notes` to Incident |
| `maintenance/migrations/0004_maintenancetask.py` | Create MaintenanceTask |

---

## 2. API Endpoints

All endpoints JWT-authenticated. All querysets filtered by `request.user.marina`.

### Tasks (simple daily list)

| Method | URL | View |
|---|---|---|
| GET / POST | `/api/v1/tasks/` | `TaskList` |
| GET / PATCH / DELETE | `/api/v1/tasks/<pk>/` | `TaskDetail` |

### Incidents

| Method | URL | View |
|---|---|---|
| GET / POST | `/api/v1/incidents/` | `IncidentList` |
| GET / PATCH | `/api/v1/incidents/<pk>/` | `IncidentDetail` |

### Assets

| Method | URL | View |
|---|---|---|
| GET / POST | `/api/v1/assets/` | `AssetList` |
| GET / PATCH | `/api/v1/assets/<pk>/` | `AssetDetail` |

### Defects

| Method | URL | View |
|---|---|---|
| GET / POST | `/api/v1/defects/` | `DefectList` |
| GET / PATCH | `/api/v1/defects/<pk>/` | `DefectDetail` |
| POST | `/api/v1/defects/<pk>/create-task/` | `DefectCreateTaskView` |

### Maintenance Tasks

| Method | URL | View |
|---|---|---|
| GET / POST | `/api/v1/maintenance-tasks/` | `MaintenanceTaskList` |
| GET / PATCH | `/api/v1/maintenance-tasks/<pk>/` | `MaintenanceTaskDetail` |

`MaintenanceTaskDetail` accepts `multipart/form-data` to support photo upload alongside status fields.

---

## 3. Defect → MaintenanceTask Transaction

`POST /api/v1/defects/<pk>/create-task/` — custom `APIView`, no serializer input needed.

Logic (all inside `transaction.atomic()`):

1. Fetch defect scoped to `request.user.marina` — 404 if not found
2. Validate `defect.status == 'acknowledged'` — return 400 `{"detail": "Defect must be acknowledged before raising a task."}` if not
3. Guard against duplicate: if `MaintenanceTask.objects.filter(defect=defect).exists()` — return 400 `{"detail": "A maintenance task already exists for this defect."}`
4. Create `MaintenanceTask`:
   - `marina` = `request.user.marina`
   - `defect` = defect
   - `asset` = `defect.asset`
   - `title` = `defect.description[:100]`
   - `description` = `defect.description`
   - `priority` = `'high'` if `defect.severity in ('high', 'critical')` else `'medium'`
   - `status` = `'pending'`
5. Set `defect.status = 'in_progress'` and `defect.save()`
6. Return `MaintenanceTaskSerializer(task).data` with HTTP 201

---

## 4. Serializers

### `TaskSerializer`
Fields: `id`, `text`, `location`, `priority`, `assigned_to`, `done`, `created_at`

### `IncidentSerializer`
Fields: `id`, `vessel`, `vessel_name` (read-only, source `vessel.name`, default `''`), `berth`, `berth_name` (read-only, source `berth.name`, default `''`), `description`, `severity`, `reporter`, `notes`, `resolved`, `occurred_at`, `created_at`

### `AssetSerializer`
Fields: `id`, `name`, `category`, `location`, `make`, `model`, `serial`, `purchased`, `cost`, `status`, `last_service`, `next_service`, `total_maint_cost`, `notes`

### `DefectSerializer`
Fields: `id`, `asset`, `asset_name` (read-only, source `asset.name`, default `''`), `location`, `description`, `severity`, `reporter`, `assigned_to`, `status`, `reported_at`

### `MaintenanceTaskSerializer`
Fields: `id`, `asset`, `asset_name` (read-only, source `asset.name`, default `''`), `defect`, `title`, `description`, `assigned_to`, `priority`, `status`, `due_date`, `completed_at` (read-only), `completion_notes`, `completion_photo`

---

## 5. Views

All standard `generics` views. `MaintenanceTaskDetail` overrides `perform_update` to auto-set `completed_at = now()` when `status` transitions to `'completed'`.

```python
def perform_update(self, serializer):
    if serializer.validated_data.get('status') == 'completed':
        serializer.save(completed_at=timezone.now())
    else:
        serializer.save()
```

`MaintenanceTaskDetail` uses DRF's default parser classes which include `MultiPartParser` — no extra configuration needed for photo upload.

---

## 6. Frontend Hooks

| Hook | File | Functions |
|---|---|---|
| `useTasks` | `hooks/useTasks.js` | `createTask(payload)`, `updateTask(id, payload)`, `deleteTask(id)` |
| `useIncidents` | `hooks/useIncidents.js` | `createIncident(payload)`, `updateIncident(id, payload)` |
| `useDefects` | `hooks/useDefects.js` | `createDefect(payload)`, `updateDefect(id, payload)`, `raiseTask(id)` → POST `/defects/<id>/create-task/` |
| `useMaintenanceTasks` | `hooks/useMaintenanceTasks.js` | `createTask(payload)`, `updateTask(id, payload)`, `completeTask(id, notes, photo)` → multipart PATCH |

`useAssets` already exists from the Boatyard phase and is unchanged.

### `completeTask` multipart pattern

```javascript
async function completeTask(id, notes, photo) {
  const form = new FormData();
  form.append('status', 'completed');
  form.append('completion_notes', notes);
  if (photo) form.append('completion_photo', photo);
  const { data } = await api.patch(`/maintenance-tasks/${id}/`, form, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  setTasks(prev => prev.map(t => t.id === id ? data : t));
  return data;
}
```

---

## 7. Maintenance.jsx — Desktop (5 tabs)

Tab order: **Staff Tasks | Maintenance Tasks | Incidents | Asset Register | Defect Log**

### Staff Tasks
Simple checkbox list wired to `useTasks`. Left column: task list. Right column: summary card (total / completed / open / high priority) + by-assignment card. "Add Task" modal: text, location, priority, assigned_to.

### Maintenance Tasks (Kanban)
4 columns: Pending / In Progress / Blocked / Completed. Each card shows title, asset name, priority badge, assigned_to, due date. Click-to-move buttons per card:

| Current status | Available actions |
|---|---|
| pending | `[Start]` → PATCH `status='in_progress'` |
| in_progress | `[Block]` → PATCH `status='blocked'`; `[Complete]` → PATCH `status='completed'` |
| blocked | `[Resume]` → PATCH `status='in_progress'` |
| completed | *(no actions)* |

"New Task" button → create modal: title, asset select, description, priority, assigned_to, due_date.

### Incidents
Cards wired to `useIncidents`. "Log Incident" modal: vessel select, occurred_at datetime, severity, description, reporter. Per card: "Mark Resolved" → PATCH `{resolved: true}`; "Add Note" → inline textarea that PATCHes `{notes: value}`.

### Asset Register
Table wired to `useAssets`. Status badges: `ok`→green, `due_service`→orange, `under_repair`→red. "Add Asset" modal: name, category, location, make, model, serial, purchased, cost.

### Defect Log
Cards wired to `useDefects`. "Log Defect" modal: asset select, location, severity, description, reporter. Status transition buttons per card:

| Status | Button |
|---|---|
| open | `[Acknowledge]` → PATCH `{status: 'acknowledged'}` |
| acknowledged | `[Raise Maintenance Task]` → `raiseTask(id)` then refresh both defects + maintenance tasks |
| in_progress | `[Mark Resolved]` → PATCH `{status: 'resolved'}` |
| resolved | *(no actions)* |

---

## 8. React Router Integration

Install `react-router-dom`. Minimal change to existing routing:

### `frontend/src/main.jsx`
Wrap `<App />` in `<BrowserRouter>`.

### `frontend/src/App.jsx`
Add `<Routes>`:
- `<Route path="/field" element={<ProtectedField />} />` — auth-gated, no shell
- `<Route path="/*" element={<DesktopApp />} />` — existing sidebar + topbar layout

`ProtectedField` component: checks `isAuthenticated()` from `api.js`. If false, redirects `window.location.href = '/'` (which triggers login). If true, renders `<Field />`.

The entire existing `SCREEN_MAP` + `Sidebar` + `Topbar` logic moves into a `DesktopApp` component (extracted from current `App`). No functional change to desktop navigation.

---

## 9. Field.jsx — Mobile Route (`/field`)

Standalone full-screen component. No `Sidebar`, no `Topbar`. Auth-gated as described above.

### Screen 1 — Roster
Reads all `MaintenanceTask` records where `status != 'completed'` from `useMaintenanceTasks`, sorted by priority then due_date. Vertical list of large cards (min 60px height). Each card:
- Title (bold, 14px)
- Asset name + location (subtitle)
- Priority badge (🔥 High / 🟠 Medium / ⬜ Low)
- Assigned to

Tap card → Screen 2.

### Screen 2 — Task Detail
Shows title, asset name, description, priority, due date, manager notes. Bottom of screen, pinned (position: fixed):
- `status === 'pending'` → large green `[▶ START TASK]` button (60px tall) → PATCH `{status: 'in_progress'}`
- `status === 'in_progress'` → large green `[✔ MARK DONE]` button → opens completion modal
- `status === 'blocked'` → grey "Blocked" label, no action

Back button top-left returns to roster.

### Screen 3 — Completion Modal
Slides up on "Mark Done" tap. Contains:
- Textarea: "Add a completion note…" (binds `completion_notes`)
- File input styled as button: "📷 Add Photo" — opens device camera/gallery (binds `completion_photo`)
- Large `[Submit]` button → calls `completeTask(id, notes, photo)` → multipart PATCH → closes modal, removes task from roster

### Design constraints
- Minimum 60px tap targets on all buttons
- High contrast: navy `#1a2d4a` background on action buttons, white text
- Bottom navigation: back arrow bottom-left, not top hamburger
- No sidebar, no topbar

---

## 10. Tests

### `apps/maintenance/tests.py`

| Class | Tests |
|---|---|
| `TaskTest` | POST creates; PATCH toggles done; GET scoped to marina |
| `IncidentTest` | POST creates; PATCH sets resolved; PATCH sets notes; GET scoped |
| `AssetTest` | POST creates; PATCH updates status; GET scoped |
| `DefectTest` | POST creates; PATCH acknowledges; PATCH resolves; GET scoped |
| `DefectCreateTaskTest` | Happy path: creates task + sets defect in_progress + links defect; 400 if status not acknowledged; 400 if task already exists for defect |
| `MaintenanceTaskTest` | POST creates; PATCH status transitions; PATCH to completed sets completed_at; multipart PATCH uploads photo |

---

## Design Constraints

- All models carry `marina` FK — no cross-marina data leakage
- `MaintenanceTask` and `WorkOrder` are strictly separate — `MaintenanceTask` is internal infrastructure, `WorkOrder` is customer vessel work
- `Defect → MaintenanceTask` transaction is atomic — no partial state
- `/field` is auth-gated via `isAuthenticated()` — unauthenticated requests redirect to `/`
- Photo upload uses Django `FileField` + `MEDIA_ROOT` — S3-ready via single settings swap
- `completed_at` is server-set (not client-supplied) — `read_only=True` in serializer
- `completeTask` in `useMaintenanceTasks` sends `multipart/form-data` — `Content-Type` header must be set explicitly on the axios call
- Boatyard Facility Log tab reads `/api/v1/assets/` — this endpoint is implemented here; the `useAssets` hook already exists and requires no changes
