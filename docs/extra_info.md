# Extra Info / TODO

## Maintenance Module — Follow-up Items

These were flagged as non-blocking during the maintenance module implementation (2026-04-30) and should be addressed before production use:

### 1. `MaintenanceTask.defect` — add DB-level uniqueness constraint

**File:** `backend/apps/maintenance/models.py`

Currently a nullable FK with an application-level duplicate guard (`select_for_update` + `exists()` check in `DefectCreateTaskView`). No DB-level constraint exists.

**Fix:** Change to `OneToOneField`:
```python
defect = models.OneToOneField(Defect, on_delete=models.SET_NULL, null=True, blank=True)
```
Then run `python manage.py makemigrations` to generate the migration.

---

### 3. Staff invite flow — link up SMTP server

**File:** `backend/apps/staff/views.py` (`StaffInviteView`)

`send_mail()` is called in the invite flow but SMTP credentials are not yet configured. In dev this prints to the console. Once an SMTP server is set up, add `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD`, and `EMAIL_USE_TLS` to settings and remove the console backend.

---

### 4. Staff login — mobile app integration

Staff members have no login today. The invite flow creates an inactive `User` record with a setup link (`/setup/<uid>/<token>/`) but the setup page does not exist yet. When the mobile app is built, the staff login + account activation flow should be wired up through this token mechanism.

---

### 2. Field screen (`/field`) — filter tasks by assigned user

**File:** `frontend/src/hooks/useMaintenanceTasks.js`, `backend/apps/maintenance/views.py`

`/field` currently shows all maintenance tasks for the marina. Field workers see tasks assigned to others.

**Fix options:**
- Add `?assigned_to=<name>` query param support to `MaintenanceTaskList` in `views.py`, then pass it from the hook.
- Or link `assigned_to` to the User model and add a `/maintenance-tasks/mine/` endpoint.

Note: `assigned_to` is currently a freetext `CharField` with no User FK, so a User-linked filter requires a model change.

---

## Fuel Dock Quick Sale — Smoke Test Checklist

Manual smoke test required before production use. Automated tests cover the backend paths; this verifies the full UI flow.

### Prerequisites

Start both servers:
```
cd backend && python manage.py runserver
cd frontend && npm run dev
```

### Step 1: Seed POS items via Django admin

Navigate to `/admin/` → Billing → Chargeable Items → Add three items:

| Name | Category | Pricing model | Unit price | Fuel dock type | Show in POS |
|---|---|---|---|---|---|
| Diesel | Utility | Per Litre | marina rate | diesel | ✓ |
| Petrol | Utility | Per Litre | marina rate | petrol | ✓ |
| Pump-out | Utility | Flat Fee | marina rate | pump_out | ✓ |

### Step 2: Verify tile grid

Open the app → Billing → POS tab. The three tiles should appear with correct prices. The old hardcoded tiles (Ice, Shore Power Token, Merchandise) should be gone.

### Step 3: Test guest diesel sale

Tap Diesel → enter 30 in Litres → leave Vessel/Member blank → Process Sale.
- Total should show `€<price × 30>`
- "Recent Fuel Sales" list refreshes showing the new entry (guest, Diesel, 30L)
- In Django admin: `FuelDockEntry` with `pos_paid=True`, `invoice=None`, `actual_litres=30`

### Step 4: Test member sale

Tap Diesel → type a member name in the combobox → select from dropdown (green ✓ appears) → enter 50 Litres → Process Sale.
- In Django admin: `FuelDockEntry` with `pos_paid=False` and an associated `Invoice`
- Invoice line item should show `Diesel × 50 @ €<price/L>` (not `× 1 @ total`)

### Step 5: Test pump-out (flat fee)

Tap Pump-out tile — no Litres input should appear (flat fee). Total shows immediately. Process Sale.
- In Django admin: `FuelDockEntry` with `actual_litres=None`, `price_per_litre=None`, correct `total_amount`

### Step 6: Test empty catalog state

Temporarily set all POS items to `show_in_pos=False` in admin. Reload POS tab — should show "No POS items configured" message instead of tiles.
