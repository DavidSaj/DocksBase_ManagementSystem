# Track 2 — Berth Intelligence & Smart Assignment: Implementation Plan

Date: 2026-05-08
Based on spec: `docs/superpowers/specs/2026-05-07-track-02-berth-intelligence-design.md`

---

## Overview

Track 2 adds seven capability clusters to the existing `berths` and `reservations` apps: smart berth assignment scoring, temporary departure sub-letting, dock walk mobile workflow, mooring movement logging, berth-for-sale marketplace, booking approval workflows, and vessel non-return alerting with coast guard escalation.

The only new top-level Django app is `apps/movements` for `VesselMovement` records. All other new models are added to existing apps (`berths`, `reservations`, `members`, `accounts`). The smart assignment scorer replaces/extends the existing allocator in `apps/berths/allocator.py`.

**Summary of work:** 1 new app (`movements`), 11 new models, 6 field additions to existing models, 1 new scorer service class, 1 async fleet-assign Celery task, 20+ new API endpoints, 4 background tasks/commands, and significant frontend additions.

---

## Gap Analysis

### What exists in `apps/berths`

| Component | Status |
|---|---|
| `Berth`, `Pier`, `LogicalPier`, `BerthCategory` models | Exist — need field additions |
| `apps/berths/allocator.py` | Exists — basic gap-minimisation logic; must be extended into `SmartBerthScorer` |
| Smart assign endpoints | Missing |
| Fleet assign endpoints | Missing |
| `BerthScoreWeights` model | Missing |
| `TemporaryDeparture` model | Missing |
| `SubLetBooking` model | Missing |
| `FleetAssignJob` model | Missing |
| `DockWalkSession` model | Missing |
| `DockWalkEntry` model | Missing |
| `BerthAlert` model | Missing |
| `BerthListing` model | Missing |
| `BerthListingEnquiry` model | Missing |
| Dock walk endpoints | Missing |
| Alert endpoints | Missing |
| Listing endpoints | Missing |

### What exists in `apps/reservations`

| Component | Status |
|---|---|
| `Booking` model | Exists — needs document-gate fields |
| Approve/reject endpoints | Missing |
| Document gate endpoint | Missing |

### What exists elsewhere

| Component | Status |
|---|---|
| `apps/members/models.py Member` | Needs `sublet_opt_in` field |
| `apps/accounts/models.py Marina` | Needs 7 approval/alert/commission fields |
| `VesselMovement` model | Missing (goes in new `movements` app) |

---

## New Django App: `apps/movements`

**Create the app:**
```
cd backend && python manage.py startapp movements apps/movements
```

**`apps/movements/apps.py`:**
```python
class MovementsConfig(AppConfig):
    name = 'apps.movements'
    label = 'movements'
```

**Register in `config/settings/base.py` `LOCAL_APPS`:**
```python
'apps.movements',
```

**Wire URLs in `config/urls.py`:**
```python
path('', include('apps.movements.urls')),
```
URLs will be exposed at `/api/v1/berths/movements/` for API consistency per spec §4.4.

---

## Models

### Changes to existing models

#### `apps/members/models.py` — `Member`

New migration `apps/members/migrations/000X_member_sublet_opt_in.py`:
```python
sublet_opt_in = models.BooleanField(
    default=False,
    help_text='Holder consents to berth being sub-let during temporary absences.',
)
```

#### `apps/berths/models.py` — `Berth`

New migration `apps/berths/migrations/0028_berth_air_draft.py` (and subsequent for booking_tier from Track 1):
```python
max_air_draft_m = models.DecimalField(
    max_digits=5, decimal_places=2, null=True, blank=True,
    help_text='Standard bridge/powerline clearance in metres at mid-tide. '
              'Vessels exceeding this are flagged with an amber warning, not hard-excluded.',
)
```

**Note on `position_index`:** The field already exists on `Berth`. `DockWalkEntry.Meta.ordering` uses `berth__position_index`, which will work.

#### `apps/accounts/models.py` — `Marina`

New migration `apps/accounts/migrations/000X_marina_approval_fields.py`:
```python
require_manager_approval_loa_m = models.DecimalField(
    max_digits=5, decimal_places=1, null=True, blank=True,
)
require_manager_approval_types = models.JSONField(default=list)
require_approval_for_seasonal  = models.BooleanField(default=True)
document_gate_enabled          = models.BooleanField(default=False)
non_return_grace_hours         = models.IntegerField(default=2)
coastguard_escalation_hours    = models.IntegerField(default=4)
berth_sale_commission_pct      = models.DecimalField(
    max_digits=5, decimal_places=2, default=0,
)
```

#### `apps/reservations/models.py` — `Booking`

New migration `apps/reservations/migrations/000X_booking_document_gate.py`:
```python
insurance_verified       = models.BooleanField(default=False)
registration_verified    = models.BooleanField(default=False)
waiver_verified          = models.BooleanField(default=False)
document_gate_cleared    = models.BooleanField(default=False)
document_gate_cleared_by = models.ForeignKey(
    'accounts.User', on_delete=models.SET_NULL,
    null=True, blank=True, related_name='document_gate_clearances',
)
document_gate_cleared_at = models.DateTimeField(null=True, blank=True)
```

Also add `pending_approval` to `STATUS_CHOICES` if not already present (it already is in the existing model — verified).

Also add `sublet` boolean to `Booking` for the UI flag:
```python
is_sublet = models.BooleanField(default=False,
    help_text='True when this booking fills a TemporaryDeparture sub-let gap.')
```

### New models in `apps/berths/models.py`

All six models below are added to `apps/berths/models.py` and covered by a single migration `apps/berths/migrations/0028_berth_intelligence_models.py` (after the `max_air_draft_m` field migration).

**Sequencing note:** If Track 1 also adds a migration to `berths` (`0028_berth_booking_tier`), coordinate numbering — Track 2's batch goes after, as `0029_berth_intelligence_models`.

#### Model 1: `BerthScoreWeights`

```python
class BerthScoreWeights(models.Model):
    marina = models.OneToOneField(
        'accounts.Marina', on_delete=models.CASCADE,
        related_name='score_weights',
    )
    w_size_fit      = models.IntegerField(default=40)
    w_gap_min       = models.IntegerField(default=25)
    w_amenity_match = models.IntegerField(default=20)
    w_pier_cluster  = models.IntegerField(default=15)
    updated_at      = models.DateTimeField(auto_now=True)

    def clean(self):
        from django.core.exceptions import ValidationError
        total = self.w_size_fit + self.w_gap_min + self.w_amenity_match + self.w_pier_cluster
        if total != 100:
            raise ValidationError(f'Score weights must sum to 100 (got {total}).')
```

**Migration note:** Create a `BerthScoreWeights` row for every existing marina using a data migration after the schema migration, so every marina has default weights immediately.

#### Model 2: `TemporaryDeparture`

```python
class TemporaryDeparture(models.Model):
    STATUS_CHOICES = [
        ('scheduled', 'Scheduled'),
        ('active',    'Active'),
        ('returned',  'Returned'),
        ('cancelled', 'Cancelled'),
    ]
    marina            = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                          related_name='temporary_departures')
    berth             = models.ForeignKey('berths.Berth', on_delete=models.PROTECT,
                                          related_name='temporary_departures')
    vessel            = models.ForeignKey('vessels.Vessel', on_delete=models.PROTECT,
                                          related_name='temporary_departures')
    member            = models.ForeignKey('members.Member', on_delete=models.SET_NULL,
                                          null=True, blank=True,
                                          related_name='temporary_departures')
    depart_date       = models.DateField()
    expected_return   = models.DateField()
    actual_return     = models.DateField(null=True, blank=True)
    status            = models.CharField(max_length=20, choices=STATUS_CHOICES,
                                         default='scheduled')
    sublet_enabled    = models.BooleanField(default=False)
    revenue_share_pct = models.DecimalField(max_digits=5, decimal_places=2, default=50)
    departure_heading = models.CharField(max_length=100, blank=True)
    notes             = models.TextField(blank=True)
    created_by        = models.ForeignKey('accounts.User', on_delete=models.SET_NULL,
                                          null=True, blank=True,
                                          related_name='created_departures')
    created_at        = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-depart_date']
```

#### Model 3: `SubLetBooking`

```python
class SubLetBooking(models.Model):
    marina               = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                              related_name='sublet_bookings')
    departure            = models.ForeignKey(TemporaryDeparture, on_delete=models.PROTECT,
                                              related_name='sublet_bookings')
    booking              = models.OneToOneField('reservations.Booking', on_delete=models.PROTECT,
                                                related_name='sublet_record')
    total_revenue        = models.DecimalField(max_digits=10, decimal_places=2)
    holder_share         = models.DecimalField(max_digits=10, decimal_places=2)
    marina_share         = models.DecimalField(max_digits=10, decimal_places=2)
    credit_invoice_id    = models.IntegerField(null=True, blank=True)
    credit_applied_at    = models.DateTimeField(null=True, blank=True)
    inventory_collision  = models.BooleanField(default=False)
    actual_nights_sublet = models.IntegerField(null=True, blank=True)
    relocation_booking   = models.ForeignKey(
        'reservations.Booking', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='relocated_from_sublet',
    )
    created_at           = models.DateTimeField(auto_now_add=True)
```

#### Model 4: `FleetAssignJob`

```python
class FleetAssignJob(models.Model):
    STATUS_CHOICES = [
        ('pending',    'Pending'),
        ('processing', 'Processing'),
        ('complete',   'Complete'),
        ('failed',     'Failed'),
    ]
    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                        related_name='fleet_assign_jobs')
    status          = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    request_payload = models.JSONField()
    result_payload  = models.JSONField(null=True, blank=True)
    celery_task_id  = models.CharField(max_length=100, blank=True)
    error_detail    = models.TextField(blank=True)
    created_by      = models.ForeignKey('accounts.User', on_delete=models.SET_NULL,
                                        null=True, blank=True,
                                        related_name='fleet_assign_jobs')
    created_at      = models.DateTimeField(auto_now_add=True)
    completed_at    = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']
```

#### Model 5: `DockWalkSession`

```python
class DockWalkSession(models.Model):
    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                    related_name='dock_walk_sessions')
    pier        = models.ForeignKey('berths.LogicalPier', on_delete=models.SET_NULL,
                                    null=True, blank=True,
                                    related_name='dock_walk_sessions')
    walked_by   = models.ForeignKey('accounts.User', on_delete=models.SET_NULL,
                                    null=True, blank=True, related_name='dock_walks')
    started_at  = models.DateTimeField()
    finished_at = models.DateTimeField(null=True, blank=True)
    berth_order = models.JSONField(default=list)  # [berth_id, ...] in physical walk order

    class Meta:
        ordering = ['-started_at']
```

#### Model 6: `DockWalkEntry`

```python
class DockWalkEntry(models.Model):
    OCCUPANCY_CHOICES = [
        ('occupied', 'Occupied'),
        ('empty',    'Empty'),
        ('unknown',  'Unknown'),
    ]
    DISCREPANCY_CHOICES = [
        ('none',             'None'),
        ('unexpected_empty', 'Unexpected Empty'),
        ('unexpected_vessel','Unexpected Vessel'),
        ('overstay',         'Overstay'),
    ]
    marina               = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                              related_name='dock_walk_entries')
    session              = models.ForeignKey(DockWalkSession, on_delete=models.CASCADE,
                                              related_name='entries')
    berth                = models.ForeignKey('berths.Berth', on_delete=models.PROTECT,
                                              related_name='dock_walk_entries')
    observed_occupancy   = models.CharField(max_length=20, choices=OCCUPANCY_CHOICES)
    discrepancy          = models.CharField(max_length=25, choices=DISCREPANCY_CHOICES, default='none')
    electric_reading_kwh = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    water_reading_litres = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    notes                = models.TextField(blank=True)
    photo                = models.ImageField(upload_to='dock_walk/', null=True, blank=True)
    observed_at          = models.DateTimeField()
    synced_at            = models.DateTimeField(auto_now_add=True)
    alert                = models.ForeignKey('berths.BerthAlert', on_delete=models.SET_NULL,
                                              null=True, blank=True,
                                              related_name='dock_walk_entries')

    class Meta:
        ordering = ['session', 'berth__position_index']
        unique_together = ('session', 'berth')
```

#### Model 7: `BerthAlert`

```python
class BerthAlert(models.Model):
    TYPE_CHOICES = [
        ('unexpected_empty',  'Unexpected Empty Berth'),
        ('unexpected_vessel', 'Unexpected Vessel in Berth'),
        ('overstay',          'Overstay'),
        ('non_return',        'Vessel Non-Return'),
        ('meter_anomaly',     'Meter Reading Anomaly'),
    ]
    STATUS_CHOICES = [
        ('open',      'Open'),
        ('critical',  'Critical'),
        ('resolved',  'Resolved'),
        ('escalated', 'Escalated'),
    ]
    marina                   = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                                  related_name='berth_alerts')
    alert_type               = models.CharField(max_length=30, choices=TYPE_CHOICES)
    status                   = models.CharField(max_length=20, choices=STATUS_CHOICES, default='open')
    berth                    = models.ForeignKey('berths.Berth', on_delete=models.SET_NULL,
                                                  null=True, blank=True, related_name='alerts')
    vessel                   = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL,
                                                  null=True, blank=True, related_name='berth_alerts')
    departure                = models.ForeignKey('berths.TemporaryDeparture', on_delete=models.SET_NULL,
                                                  null=True, blank=True, related_name='alerts')
    detail                   = models.TextField(blank=True)
    resolved_at              = models.DateTimeField(null=True, blank=True)
    resolved_by              = models.ForeignKey('accounts.User', on_delete=models.SET_NULL,
                                                  null=True, blank=True,
                                                  related_name='resolved_alerts')
    coastguard_report_text   = models.TextField(blank=True)
    coastguard_escalated_at  = models.DateTimeField(null=True, blank=True)
    coastguard_escalated_by  = models.ForeignKey('accounts.User', on_delete=models.SET_NULL,
                                                  null=True, blank=True,
                                                  related_name='coastguard_escalations')
    created_at               = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
```

**Note:** `BerthAlert` must be defined before `DockWalkEntry` in the file, since `DockWalkEntry` has a FK to `BerthAlert`. Alternatively, use a string reference `'berths.BerthAlert'`.

#### Model 8: `BerthListing` and `BerthListingEnquiry`

```python
class BerthListing(models.Model):
    STATUS_CHOICES = [
        ('active',      'Active'),
        ('under_offer', 'Under Offer'),
        ('sold',        'Sold'),
        ('withdrawn',   'Withdrawn'),
    ]
    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                      related_name='berth_listings')
    berth         = models.OneToOneField('berths.Berth', on_delete=models.CASCADE,
                                         related_name='listing')
    seller_member = models.ForeignKey('members.Member', on_delete=models.SET_NULL,
                                      null=True, blank=True, related_name='berth_listings')
    asking_price  = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    licence_terms = models.TextField(blank=True)
    description   = models.TextField(blank=True)
    status        = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    listed_at     = models.DateTimeField(auto_now_add=True)
    updated_at    = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-listed_at']


class BerthListingEnquiry(models.Model):
    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                        related_name='berth_listing_enquiries')
    listing         = models.ForeignKey(BerthListing, on_delete=models.CASCADE,
                                        related_name='enquiries')
    enquirer_member = models.ForeignKey('members.Member', on_delete=models.SET_NULL,
                                        null=True, blank=True, related_name='berth_enquiries')
    enquirer_name   = models.CharField(max_length=200, blank=True)
    enquirer_email  = models.EmailField(blank=True)
    enquirer_phone  = models.CharField(max_length=50, blank=True)
    message         = models.TextField(blank=True)
    created_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
```

### New model in `apps/movements/models.py`

#### Model: `VesselMovement`

```python
class VesselMovement(models.Model):
    MOVEMENT_TYPES = [
        ('arrival',        'Arrival'),
        ('departure',      'Departure'),
        ('inter_marina',   'Inter-Marina Transfer'),
        ('haul_out',       'Haul Out'),
        ('relaunch',       'Relaunch'),
        ('berth_change',   'Berth Change'),
        ('temp_departure', 'Temporary Departure'),
        ('temp_return',    'Temporary Return'),
        ('correction',     'Correction'),
    ]
    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                        related_name='vessel_movements')
    vessel          = models.ForeignKey('vessels.Vessel', on_delete=models.PROTECT,
                                        related_name='movements')
    movement_type   = models.CharField(max_length=20, choices=MOVEMENT_TYPES)
    berth_from      = models.ForeignKey('berths.Berth', on_delete=models.SET_NULL,
                                        null=True, blank=True, related_name='movements_from')
    berth_to        = models.ForeignKey('berths.Berth', on_delete=models.SET_NULL,
                                        null=True, blank=True, related_name='movements_to')
    booking         = models.ForeignKey('reservations.Booking', on_delete=models.SET_NULL,
                                        null=True, blank=True, related_name='movements')
    departure       = models.ForeignKey('berths.TemporaryDeparture', on_delete=models.SET_NULL,
                                        null=True, blank=True, related_name='movements')
    scheduled_at    = models.DateTimeField(null=True, blank=True)
    actual_at       = models.DateTimeField(null=True, blank=True)
    completed       = models.BooleanField(default=False)
    heading         = models.CharField(max_length=100, blank=True)
    notes           = models.TextField(blank=True)
    recorded_by     = models.ForeignKey('accounts.User', on_delete=models.SET_NULL,
                                        null=True, blank=True,
                                        related_name='recorded_movements')
    created_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
```

**Immutability enforcement:** No `update` or `delete` endpoints exist. The `PATCH /complete/` action only sets `completed=True` and `actual_at`.

---

## Services

### `SmartBerthScorer` (in `apps/berths/scorer.py`)

Create a new file `backend/apps/berths/scorer.py`. The existing `apps/berths/allocator.py` gap-minimisation logic is refactored into a `GapMinScorer` component used by `SmartBerthScorer`.

**Scorer architecture:**

```python
class SmartBerthScorer:
    def __init__(self, marina, check_in, check_out, vessel_params: dict):
        """
        vessel_params: {
            loa, beam, draft, air_draft (optional),
            shore_power (bool, optional),
            mooring_pref (str, optional),
        }
        """
        self.marina = marina
        self.check_in = check_in
        self.check_out = check_out
        self.vessel_params = vessel_params
        self.weights = BerthScoreWeights.objects.get_or_create(marina=marina)[0]

    def get_available_berths(self) -> QuerySet:
        """
        Returns berths that are physically available for the date window.
        Includes gaps opened by TemporaryDeparture records (sublet_enabled=True).
        Excludes berths with conflicting confirmed/checked_in bookings.
        """

    def score_berth(self, berth) -> dict:
        """
        Returns {
            berth_id, berth_code, pier, score, score_breakdown,
            length_m, max_beam_m, max_draft_m, max_air_draft_m,
            amenities, pricing_tier, price_per_night,
            air_draft_warning, air_draft_warning_text,
        }
        """

    def score_all(self) -> list[dict]:
        """Returns sorted list of scored berth dicts, highest score first."""
```

**Dimension scoring (out of each weight maximum):**

- **`SizeFitScorer` (weight: `w_size_fit`, max 40 pts by default):**
  - Hard exclusion: `berth.length_m < vessel.loa` OR `berth.max_beam_m < vessel.beam` OR `berth.max_draft_m < vessel.draft` → exclude berth from results.
  - Air draft: if `berth.max_air_draft_m` is non-null and `vessel.air_draft > berth.max_air_draft_m` → **not excluded**, but set `air_draft_warning=True`, `air_draft_warning_text="Vessel air draft exceeds standard clearance. Transit at low water only — confirm with harbour master."`.
  - Score: `w_size_fit × (1 - headroom_ratio)` where `headroom_ratio = (berth.length_m - vessel.loa) / berth.length_m`. Smaller headroom = better fit = higher score. Cap at `w_size_fit`.

- **`GapMinScorer` (weight: `w_gap_min`, max 25 pts by default):**
  - Refactor existing allocator gap logic: measure how much gap the new booking leaves on either side of existing bookings on that berth. Minimise wasted gaps. Score `w_gap_min` if perfect fit (no gap wasted), 0 if large gaps on both sides.

- **`AmenityMatchScorer` (weight: `w_amenity_match`, max 20 pts by default):**
  - If `vessel_params.shore_power=True` and berth amenities include `power_30a` or `power_50a`: full `w_amenity_match` points.
  - If `mooring_pref` matches berth's category mooring type: add partial points.
  - Scale by number of matched requirements / total requested requirements.

- **`PierClusterScorer` (weight: `w_pier_cluster`, max 15 pts by default):**
  - If any other active booking for the same fleet group (same booking source + same check_in date) is on the same `LogicalPier` as this berth: add full `w_pier_cluster` points.
  - For single-vessel scoring: score = 0 (no fleet clustering signal available).

**Total score:** `size_fit_score + gap_min_score + amenity_score + pier_cluster_score` (max 100).

**`BerthScoreWeights.clean()` validation:** Weights must sum to 100. The scorer normalises at runtime only as a safety fallback.

### `solve_fleet_assignment` Celery task (in `apps/berths/tasks.py`)

```python
@app.task(name='berths.solve_fleet_assignment')
def solve_fleet_assignment(job_id: int):
    job = FleetAssignJob.objects.get(pk=job_id)
    job.status = 'processing'
    job.save(update_fields=['status'])
    try:
        payload = job.request_payload
        # For each vessel in payload['vessels']:
        #   resolve vessel params (from Vessel record or inline dims)
        #   run SmartBerthScorer
        #   exclude already-assigned berths from subsequent scorers
        # Pier-clustering pass: prefer assigning all vessels to the same pier
        # Write result_payload, completed_at, status='complete'
    except Exception as exc:
        job.error_detail = str(exc)
        job.status = 'failed'
        job.completed_at = timezone.now()
        job.save(update_fields=['error_detail', 'status', 'completed_at'])
        raise
```

The pier-clustering pass: after per-vessel scoring, count how many vessels can be placed on the highest-scoring pier. If a single pier can accommodate all vessels, assign all to that pier (re-running scorer constrained to that pier). If not, greedy assignment: fill the best pier first, overflow to next.

---

## API Endpoints

All paths are under `/api/v1/`. All viewsets filter by `request.user.marina`. No delete endpoints on movements (append-only). No delete endpoint on approval actions.

### 4.1 Smart Assignment

| Method | URL | View | Permission |
|---|---|---|---|
| GET | `berths/smart-assign/` | `SmartAssignView` | Staff |
| POST | `berths/fleet-assign/` | `FleetAssignView` | Staff |
| GET | `berths/fleet-assign/{job_id}/status/` | `FleetAssignStatusView` | Staff |
| GET | `berths/score-weights/` | `ScoreWeightsView` | Staff |
| PATCH | `berths/score-weights/` | `ScoreWeightsView` | Manager |

**`GET /api/v1/berths/smart-assign/`**

Query params: `check_in`, `check_out`, `vessel_id` (optional), `boat_loa`, `boat_beam`, `boat_draft`, `air_draft`, `shore_power` (bool), `mooring_pref`.

If `vessel_id` is provided, load dimensions from the `Vessel` record (inline params override if also provided).

Response:
```json
{
  "scored_berths": [{ ... }],
  "recommended_berth_id": 12
}
```
`recommended_berth_id` is the `berth_id` of the first element in `scored_berths`.

**`POST /api/v1/berths/fleet-assign/`**

Returns `202 Accepted` immediately:
```json
{ "job_id": 42, "status": "pending", "status_url": "/api/v1/berths/fleet-assign/42/status/" }
```

Dispatches `solve_fleet_assignment.delay(job_id)` inside `transaction.on_commit()`.

**`GET /api/v1/berths/fleet-assign/{job_id}/status/`**

Polls `FleetAssignJob.status`. Frontend polls every 2 seconds until `complete` or `failed`.

**`GET/PATCH /api/v1/berths/score-weights/`**

Get or update `BerthScoreWeights` for the marina. `PATCH` calls `full_clean()` to validate sum=100.

**Serializer — `BerthScoreWeightsSerializer`:**
Fields: `w_size_fit`, `w_gap_min`, `w_amenity_match`, `w_pier_cluster`, `updated_at`. Add `validate()` to check sum=100.

### 4.2 Temporary Departure and Sub-letting

| Method | URL | View | Notes |
|---|---|---|---|
| GET, POST | `berths/temporary-departures/` | `TemporaryDepartureViewSet` | |
| PATCH | `berths/temporary-departures/{id}/` | `TemporaryDepartureViewSet` | |
| POST | `berths/temporary-departures/{id}/activate/` | `TemporaryDepartureViewSet.activate` | Creates `temp_departure` VesselMovement |
| POST | `berths/temporary-departures/{id}/return/` | `TemporaryDepartureViewSet.return_vessel` | Collision handling |
| GET | `berths/sublet-bookings/` | `SubLetBookingViewSet` | |
| POST | `berths/sublet-bookings/apply-credit/{id}/` | `SubLetBookingViewSet.apply_credit` | Post-checkout only |

**`activate` action logic:**
1. Check `departure.status == 'scheduled'`. Return 400 if not.
2. Set `departure.status = 'active'`.
3. Create `VesselMovement(movement_type='temp_departure', vessel=departure.vessel, berth_from=departure.berth, marina=departure.marina, actual_at=now(), completed=True)`.
4. Save both.

**`return_vessel` action logic:**
1. Check `departure.status == 'active'`. Return 400 if not.
2. Set `actual_return`, transition to `returned`.
3. Create `VesselMovement(movement_type='temp_return', ...)`.
4. **Inventory collision detection:** If any linked `SubLetBooking` has `booking.check_out > actual_return`:
   a. For each affected `SubLetBooking`:
      - Set `inventory_collision = True`
      - `actual_nights_sublet = max((actual_return - booking.check_in).days, 1)`
      - Pro-rate: `holder_share = berth.pricing_tier.unit_price × actual_nights_sublet × (departure.revenue_share_pct / 100)`
      - Call `SmartBerthScorer` for the transient guest (remaining nights: `check_in=actual_return`, `check_out=original check_out`).
      - If replacement berth found: update `Booking.berth`, create `berth_change` `VesselMovement`, set `relocation_booking = booking`.
      - If no replacement: create `BerthAlert(alert_type='unexpected_vessel', berth=departure.berth, ...)`.
5. Response includes `"inventory_collisions": [{ "sublet_booking_id": ..., "relocated": true/false }]`.

**Sub-let booking auto-creation** (in `TemporaryDepartureViewSet` or `BookingViewSet`):

When a booking is created and the target berth has an active `TemporaryDeparture` with `sublet_enabled=True` and the booking dates fall within the departure window:
1. Auto-create a `SubLetBooking` record.
2. Compute `total_revenue = booking.amount`, `holder_share = total_revenue × (departure.revenue_share_pct / 100)`, `marina_share = total_revenue - holder_share`.
3. Set `booking.is_sublet = True`.

**`apply_credit` action logic:**
1. Fetch `SubLetBooking`. Check `booking.status == 'checked_out'`. Return 400 if not.
2. If `inventory_collision=True`, use `actual_nights_sublet` as credit basis.
3. Create a credit `Invoice` (or `InvoiceLineItem` with negative amount) against `departure.member`.
4. Set `credit_applied_at = now()`, `credit_invoice_id = invoice.pk`.

**Serializer — `TemporaryDepartureSerializer`:**
All model fields plus read-only `berth_code`, `vessel_name`, `member_name`, nested `sublet_bookings` (list of summary dicts).

**Portal visibility:** The berth holder's portal view of sub-let records must use a restricted serializer — include only sub-let dates and credit amount. Exclude all guest PII (name, email, phone).

### 4.3 Dock Walk

| Method | URL | View | Notes |
|---|---|---|---|
| POST, GET | `berths/dock-walk/sessions/` | `DockWalkSessionViewSet` | |
| GET | `berths/dock-walk/sessions/{id}/` | `DockWalkSessionViewSet` | |
| POST | `berths/dock-walk/sessions/{id}/entries/` | `DockWalkEntryBulkView` | Bulk create + discrepancy detection |
| PATCH | `berths/dock-walk/sessions/{id}/finish/` | `DockWalkSessionViewSet.finish` | Sets `finished_at` |
| GET | `berths/dock-walk/offline-payload/` | `DockWalkOfflinePayloadView` | Full berth+booking snapshot |

**`POST /berths/dock-walk/sessions/`:**
On session creation, compute `berth_order` server-side from `Berth.position_index` order for the specified pier. Embed in response.

**`POST /berths/dock-walk/sessions/{id}/entries/` — bulk create:**

Accept a list of observation dicts. For each:
1. Create `DockWalkEntry` record.
2. **Turnaround day guard:** Check if `observed_at.date()` is a turnaround day for the berth (any booking where `check_out == observed_date` OR `check_in == observed_date` exists). If turnaround day and `observed_occupancy == 'empty'`: set `discrepancy = 'none'` — do not generate an alert.
3. **Discrepancy detection** (comparing against booking state at `observed_at`, not at sync time):
   - Query bookings active at `observed_at` for that berth: `check_in <= observed_at.date() < check_out` and `status__in=['confirmed', 'checked_in']`.
   - If booking exists but `observed_occupancy == 'empty'` (and not turnaround day): `discrepancy = 'unexpected_empty'` → create `BerthAlert(alert_type='unexpected_empty')`.
   - If no booking but `observed_occupancy == 'occupied'`: `discrepancy = 'unexpected_vessel'` → create `BerthAlert(alert_type='unexpected_vessel')`.
   - If booking exists, `check_out <= today` (past due), and still `observed_occupancy == 'occupied'`: `discrepancy = 'overstay'` → create `BerthAlert(alert_type='overstay')`.
4. **Meter anomaly detection:**
   - Compute `delta = current_reading - last_reading` (query previous `DockWalkEntry` for this berth, ordered by `observed_at`).
   - Query vessel's 30-day rolling average delta from historical `DockWalkEntry` records.
   - If `delta > 3 × rolling_average`: create `BerthAlert(alert_type='meter_anomaly')`.
5. Set `DockWalkEntry.alert = created_alert` if an alert was generated.

Response: `{ "created": N, "discrepancies": [...], "meter_anomalies": [...] }`.

**`GET /berths/dock-walk/offline-payload/`:**
Returns full berth list for all piers + today's bookings + last meter readings + active session if exists. This endpoint is what the service worker caches. Keep response size small: exclude historical booking data, include only today's active booking per berth.

### 4.4 Mooring Movements

URLs for the `movements` app — expose at `berths/movements/` for API consistency:

| Method | URL | View | Notes |
|---|---|---|---|
| GET | `berths/movements/` | `VesselMovementViewSet` | Filter: `date`, `pier_id`, `vessel_type`, `movement_type`, `completed` |
| POST | `berths/movements/` | `VesselMovementViewSet` | Create movement record |
| PATCH | `berths/movements/{id}/complete/` | `VesselMovementViewSet.complete` | Sets `completed=True`, `actual_at` |
| GET | `berths/movements/expected-board/` | `VesselMovementViewSet.expected_board` | Today's movements grouped |
| GET | `berths/movements/traffic-log/` | `VesselMovementViewSet.traffic_log` | Date range + CSV export |

**No `PUT`, `PATCH` (general), or `DELETE` endpoints.** The `complete` action is the only mutation on an existing record.

**`expected-board` action:** Query movements where `scheduled_at.date() == today`. Group into `arrivals` (movement_type in `arrival`, `temp_return`, `relaunch`) and `departures` (movement_type in `departure`, `temp_departure`, `haul_out`). Flag `overdue = True` if `scheduled_at < now()` and `completed = False`.

**`traffic-log` action:** Same as main list but accepts `date_from`/`date_to` params. Supports `?format=csv` — use DRF's `renderer_classes` or manual `HttpResponse` with CSV content type.

**Serializer — `VesselMovementSerializer`:**
All fields plus read-only `vessel_name`, `berth_from_code`, `movement_type_display`, `recorded_by_name`.

**Auto-creation of movement records** (implement in signal receivers in `apps/movements/signals.py`):

| Trigger | Movement created |
|---|---|
| `TemporaryDeparture.activate()` action | `temp_departure` |
| `TemporaryDeparture.return_vessel()` action | `temp_return` |
| `Booking.status` → `checked_in` | `arrival` |
| `Booking.status` → `checked_out` | `departure` |
| Sub-let relocation (collision handler) | `berth_change` |

For booking status transitions, use a `post_save` signal on `Booking` checking for status transitions from the previous value (store old status in `__init__`'s `self._pre_save_status` pattern).

### 4.5 Berth Listings

| Method | URL | View | Notes |
|---|---|---|---|
| GET, POST | `berths/listings/` | `BerthListingViewSet` | Staff create; portal read |
| PATCH | `berths/listings/{id}/` | `BerthListingViewSet` | Status transitions |
| GET | `berths/listings/{id}/enquiries/` | `BerthListingEnquiryViewSet` | |
| POST | `berths/listings/{id}/enquiries/` | `BerthListingEnquiryViewSet` | Portal-accessible |

**Commission auto-generation on `sold` transition:**

In `BerthListingViewSet.partial_update`, when `status` changes to `sold`:
1. Verify `listing.asking_price` is set and `marina.berth_sale_commission_pct > 0`.
2. Create an `Invoice` against `listing.seller_member` for `asking_price × marina.berth_sale_commission_pct / 100`.
3. Log commission invoice PK in the response.

**Serializer — `BerthListingSerializer`:**
All fields plus read-only `berth_code`, `berth_length_m`, `berth_max_beam_m`, `berth_amenities`, `seller_name`, `commission_pct` (from `marina.berth_sale_commission_pct`), `enquiry_count` (annotated count).

**Portal read-only endpoint:** `GET /api/v1/berths/listings/` must be accessible to portal-authenticated boaters. Apply a different permission class (`IsPortalAuthenticated` or equivalent) for `GET` vs staff-only for `POST`/`PATCH`.

### 4.6 Booking Approval Workflows

These endpoints extend `apps/reservations/views.py` or `apps/reservations/urls.py`. Do not create a separate app.

| Method | URL | View | Permission |
|---|---|---|---|
| POST | `reservations/bookings/{id}/approve/` | `ApproveBookingView` | Manager |
| POST | `reservations/bookings/{id}/reject/` | `RejectBookingView` | Manager |
| POST | `reservations/bookings/{id}/clear-document-gate/` | `ClearDocumentGateView` | Manager or Owner |

**Approval gate logic in `BookingViewSet.create()`:**

Before saving the booking, check:
1. `boat_loa >= marina.require_manager_approval_loa_m` (when `marina.require_manager_approval_loa_m` is not null).
2. Vessel type (from `Vessel.vessel_type` or `Booking.vessel_type`) in `marina.require_manager_approval_types`.
3. `booking_type == 'seasonal'` and `marina.require_approval_for_seasonal == True`.

If any condition fires: force `status = 'pending_approval'` regardless of `marina.booking_mode`.

**`ApproveBookingView` logic:**
1. Check `booking.status == 'pending_approval'`. Return 400 if not.
2. Optionally assign `berth` from request body.
3. If `marina.booking_mode == 'instant_booking'` and document gate is cleared (or not enabled): transition to `confirmed`.
4. Else: transition to `awaiting_payment`.

**`ClearDocumentGateView` logic:**
1. Check `request.user.role in ['marina_manager', 'owner']`. Return 403 if not.
2. Check `marina.document_gate_enabled`. If False, return 400 (gate not active).
3. Validate request body contains all three: `insurance_verified`, `registration_verified`, `waiver_verified` = True.
4. Set all three fields on booking, set `document_gate_cleared = True`, `document_gate_cleared_by = request.user`, `document_gate_cleared_at = now()`.
5. If booking is in `pending_approval`, transition to next status.

### 4.7 Vessel Non-Return Alerts

| Method | URL | View | Notes |
|---|---|---|---|
| GET | `berths/alerts/` | `BerthAlertViewSet` | Filter: `status`, `alert_type`, `vessel_id` |
| PATCH | `berths/alerts/{id}/resolve/` | `BerthAlertViewSet.resolve` | Sets status=resolved, resolved_at, resolved_by |
| POST | `berths/alerts/{id}/escalate-coastguard/` | `BerthAlertViewSet.escalate_coastguard` | Staff action only |

**`escalate-coastguard` action:**
1. Generate `coastguard_report_text` from vessel + departure + marina data.
2. Set `coastguard_escalated_at = now()`, `coastguard_escalated_by = request.user`.
3. Transition `status = 'escalated'`.
4. **No `VesselMovement` record is created** — alerts and movements are separate audit trails.

**Serializer — `BerthAlertSerializer`:**
All fields plus read-only `vessel_name`, `vessel_owner_name`, `vessel_owner_phone` (from vessel.member or departure.member), `departure_id`, `departure_heading`, `expected_return`, `hours_overdue` (computed: `(now() - expected_return_datetime).total_seconds() / 3600`).

---

## Signals

**File:** `backend/apps/movements/signals.py`

```python
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver
from apps.reservations.models import Booking
from .models import VesselMovement

@receiver(pre_save, sender=Booking)
def capture_pre_save_status(sender, instance, **kwargs):
    """Store old status so post_save can detect transitions."""
    if instance.pk:
        try:
            instance._pre_status = Booking.objects.get(pk=instance.pk).status
        except Booking.DoesNotExist:
            instance._pre_status = None
    else:
        instance._pre_status = None

@receiver(post_save, sender=Booking)
def auto_create_movement_on_status_change(sender, instance, created, **kwargs):
    old = getattr(instance, '_pre_status', None)
    new = instance.status
    if old == new:
        return
    if new == 'checked_in' and old != 'checked_in':
        VesselMovement.objects.create(
            marina=instance.marina,
            vessel=instance.vessel,
            movement_type='arrival',
            berth_to=instance.berth,
            booking=instance,
            actual_at=timezone.now(),
            completed=True,
        )
    elif new == 'checked_out' and old != 'checked_out':
        VesselMovement.objects.create(
            marina=instance.marina,
            vessel=instance.vessel,
            movement_type='departure',
            berth_from=instance.berth,
            booking=instance,
            actual_at=timezone.now(),
            completed=True,
        )
```

**Connect in `apps/movements/apps.py` `ready()`:**
```python
def ready(self):
    import apps.movements.signals  # noqa
```

**`apps/berths/signals.py`** (existing file — add to it):

No new Django signals needed for berth models. The `TemporaryDeparture.activate()` and `return_vessel()` actions create `VesselMovement` records directly within the view action, not via signals, to keep causality explicit.

---

## Background Task: `check_non_returns`

**File:** `backend/apps/berths/tasks.py` (create if not exists) or `apps/movements/tasks.py`.

**Register as management command AND Celery beat task (every 30 minutes):**

```python
@app.task(name='berths.check_non_returns')
def check_non_returns():
    from django.utils import timezone
    from apps.berths.models import BerthAlert, TemporaryDeparture

    now = timezone.now()
    for marina in Marina.objects.all():
        grace = timedelta(hours=marina.non_return_grace_hours)
        escalation = timedelta(hours=marina.coastguard_escalation_hours)

        # Step 1: Create non-return alerts for overdue departures
        overdue = TemporaryDeparture.objects.filter(
            marina=marina,
            status='active',
            expected_return__lt=(now - grace).date(),
        )
        for departure in overdue:
            alert, created = BerthAlert.objects.get_or_create(
                marina=marina,
                alert_type='non_return',
                departure=departure,
                status__in=['open', 'critical'],
                defaults={
                    'vessel': departure.vessel,
                    'berth': departure.berth,
                    'status': 'open',
                    'detail': f'Vessel has not returned after grace period.',
                }
            )
            # Step 2: Elevate to CRITICAL if alert is old enough
            if not created and alert.status == 'open':
                if alert.created_at < now - escalation:
                    alert.status = 'critical'
                    alert.save(update_fields=['status'])
                    # Send push notification to harbour master
                    # (notification system plug-in point)
```

**Management command equivalent** (`backend/apps/berths/management/commands/check_non_returns.py`):
```python
class Command(BaseCommand):
    help = 'Check for vessel non-returns and create BerthAlert records'

    def handle(self, *args, **options):
        check_non_returns()
```

**Celery beat schedule entry** (add to `CELERY_BEAT_SCHEDULE` in `settings/base.py`):
```python
'check-non-returns': {
    'task': 'berths.check_non_returns',
    'schedule': crontab(minute='*/30'),
},
```

---

## Admin (`admin.py`)

**`apps/berths/admin.py`** — add registrations:

```python
@admin.register(BerthScoreWeights)
class BerthScoreWeightsAdmin(admin.ModelAdmin):
    list_display = ['marina', 'w_size_fit', 'w_gap_min', 'w_amenity_match', 'w_pier_cluster', 'updated_at']

@admin.register(TemporaryDeparture)
class TemporaryDepartureAdmin(admin.ModelAdmin):
    list_display = ['berth', 'vessel', 'depart_date', 'expected_return', 'status', 'sublet_enabled']
    list_filter  = ['marina', 'status']

@admin.register(SubLetBooking)
class SubLetBookingAdmin(admin.ModelAdmin):
    list_display = ['booking', 'departure', 'total_revenue', 'holder_share', 'credit_applied_at', 'inventory_collision']
    list_filter  = ['marina', 'inventory_collision']

@admin.register(BerthAlert)
class BerthAlertAdmin(admin.ModelAdmin):
    list_display = ['alert_type', 'status', 'vessel', 'berth', 'created_at']
    list_filter  = ['marina', 'alert_type', 'status']

@admin.register(FleetAssignJob)
class FleetAssignJobAdmin(admin.ModelAdmin):
    list_display = ['pk', 'marina', 'status', 'created_by', 'created_at', 'completed_at']
    list_filter  = ['marina', 'status']
    readonly_fields = ['request_payload', 'result_payload', 'celery_task_id']

@admin.register(DockWalkSession)
class DockWalkSessionAdmin(admin.ModelAdmin):
    list_display = ['pier', 'walked_by', 'started_at', 'finished_at']
    list_filter  = ['marina']

@admin.register(DockWalkEntry)
class DockWalkEntryAdmin(admin.ModelAdmin):
    list_display = ['session', 'berth', 'observed_occupancy', 'discrepancy', 'observed_at']
    list_filter  = ['marina', 'discrepancy']

@admin.register(BerthListing)
class BerthListingAdmin(admin.ModelAdmin):
    list_display = ['berth', 'seller_member', 'asking_price', 'status', 'listed_at']
    list_filter  = ['marina', 'status']

admin.site.register(BerthListingEnquiry)
```

**`apps/movements/admin.py`:**

```python
@admin.register(VesselMovement)
class VesselMovementAdmin(admin.ModelAdmin):
    list_display = ['movement_type', 'vessel', 'berth_from', 'berth_to', 'scheduled_at', 'actual_at', 'completed']
    list_filter  = ['marina', 'movement_type', 'completed']
    # No delete button — admin should be read-only for movement records
    def has_delete_permission(self, request, obj=None):
        return False
```

---

## Settings and URL Wiring

### `config/settings/base.py`

Add to `LOCAL_APPS`:
```python
'apps.movements',
```

Add `check_non_returns` to `CELERY_BEAT_SCHEDULE`:
```python
'check-non-returns': {
    'task': 'berths.check_non_returns',
    'schedule': crontab(minute='*/30'),
},
```

### `config/urls.py`

Add inside the `api/v1/` block (if not already routed through `apps.berths.urls`):
```python
path('', include('apps.movements.urls')),
```

**`apps/movements/urls.py`:**
```python
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import views

router = DefaultRouter()
router.register('berths/movements', views.VesselMovementViewSet, basename='vessel-movement')

urlpatterns = router.urls
```

**`apps/berths/urls.py`** — add new routes (append to existing):
```python
path('berths/smart-assign/',                  views.SmartAssignView.as_view()),
path('berths/fleet-assign/',                   views.FleetAssignView.as_view()),
path('berths/fleet-assign/<int:job_id>/status/', views.FleetAssignStatusView.as_view()),
path('berths/score-weights/',                  views.ScoreWeightsView.as_view()),
path('berths/temporary-departures/',           views.TemporaryDepartureViewSet.as_view({'get': 'list', 'post': 'create'})),
path('berths/temporary-departures/<int:pk>/',  views.TemporaryDepartureViewSet.as_view({'patch': 'partial_update'})),
path('berths/temporary-departures/<int:pk>/activate/', views.TemporaryDepartureViewSet.as_view({'post': 'activate'})),
path('berths/temporary-departures/<int:pk>/return/',   views.TemporaryDepartureViewSet.as_view({'post': 'return_vessel'})),
path('berths/sublet-bookings/',                views.SubLetBookingViewSet.as_view({'get': 'list'})),
path('berths/sublet-bookings/apply-credit/<int:pk>/', views.SubLetBookingViewSet.as_view({'post': 'apply_credit'})),
path('berths/dock-walk/sessions/',             views.DockWalkSessionViewSet.as_view({'post': 'create', 'get': 'list'})),
path('berths/dock-walk/sessions/<int:pk>/',    views.DockWalkSessionViewSet.as_view({'get': 'retrieve'})),
path('berths/dock-walk/sessions/<int:pk>/entries/', views.DockWalkEntryBulkView.as_view()),
path('berths/dock-walk/sessions/<int:pk>/finish/', views.DockWalkSessionViewSet.as_view({'patch': 'finish'})),
path('berths/dock-walk/offline-payload/',      views.DockWalkOfflinePayloadView.as_view()),
path('berths/alerts/',                         views.BerthAlertViewSet.as_view({'get': 'list'})),
path('berths/alerts/<int:pk>/resolve/',        views.BerthAlertViewSet.as_view({'patch': 'resolve'})),
path('berths/alerts/<int:pk>/escalate-coastguard/', views.BerthAlertViewSet.as_view({'post': 'escalate_coastguard'})),
path('berths/listings/',                       views.BerthListingViewSet.as_view({'get': 'list', 'post': 'create'})),
path('berths/listings/<int:pk>/',              views.BerthListingViewSet.as_view({'patch': 'partial_update'})),
path('berths/listings/<int:pk>/enquiries/',    views.BerthListingEnquiryViewSet.as_view({'get': 'list', 'post': 'create'})),
```

**`apps/reservations/urls.py`** — add approval routes:
```python
path('reservations/bookings/<int:pk>/approve/',           views.ApproveBookingView.as_view()),
path('reservations/bookings/<int:pk>/reject/',            views.RejectBookingView.as_view()),
path('reservations/bookings/<int:pk>/clear-document-gate/', views.ClearDocumentGateView.as_view()),
```

---

## Migration Notes

**No `btree_gist` extension is required for Track 2.** The spec references `ExclusionConstraint` in the title but does not actually use it — availability is computed via ORM queries, not PostgreSQL range exclusion constraints. If date-range exclusion constraints are added in a future iteration, `django.contrib.postgres` must be in `INSTALLED_APPS` and `CREATE EXTENSION IF NOT EXISTS btree_gist;` must run in a RunSQL migration before the constraint migration.

**Migration run order:**

1. `makemigrations members` — adds `sublet_opt_in`
2. `makemigrations accounts` — adds 7 Marina fields
3. `makemigrations reservations` — adds document-gate fields + `is_sublet`
4. `makemigrations berths` — adds `max_air_draft_m`, then in a second migration adds all 8 new berth models (`BerthScoreWeights`, `TemporaryDeparture`, `SubLetBooking`, `FleetAssignJob`, `DockWalkSession`, `DockWalkEntry`, `BerthAlert`, `BerthListing`, `BerthListingEnquiry`)
5. `makemigrations movements` — creates `VesselMovement` initial migration
6. `migrate`
7. **Data migration for `BerthScoreWeights`**: add a `RunPython` step in the berths migration to create a default `BerthScoreWeights` row for every existing `Marina`.

**Migration file naming convention:**
- berths: `0028_berth_air_draft.py` → `0029_berth_intelligence_models.py` (or coordinate with Track 1 numbering)
- movements: `0001_initial.py`
- reservations: next available number (check existing count)
- accounts: next available number
- members: next available number

---

## Implementation Order

Follow this sequence — step N may have dependencies on earlier steps.

**Step 1 — Database foundations (prerequisite for everything)**

File targets:
- `apps/members/models.py` — add `sublet_opt_in`
- `apps/accounts/models.py` — add 7 Marina fields
- `apps/reservations/models.py` — add document-gate fields + `is_sublet`
- `apps/berths/models.py` — add `max_air_draft_m`
- Run `makemigrations` for `members`, `accounts`, `reservations`, `berths` (air draft only)
- Run `migrate`

**Step 2 — Create `apps/movements` app**

File targets:
- `apps/movements/__init__.py`, `apps.py`, `models.py`, `serializers.py`, `views.py`, `urls.py`, `admin.py`, `signals.py`, `tasks.py`
- Add `'apps.movements'` to `LOCAL_APPS`
- Write `VesselMovement` model
- `makemigrations movements`
- `migrate`
- Register in `config/urls.py`

**Step 3 — Write new berths app models**

File target: `apps/berths/models.py`

Add in this order (to avoid forward reference issues):
1. `BerthAlert` (no internal FKs to new models)
2. `BerthScoreWeights`
3. `TemporaryDeparture`
4. `SubLetBooking` (depends on `TemporaryDeparture`)
5. `FleetAssignJob`
6. `DockWalkSession`
7. `DockWalkEntry` (depends on `DockWalkSession` and `BerthAlert`)
8. `BerthListing`
9. `BerthListingEnquiry` (depends on `BerthListing`)

Run `makemigrations berths` and `migrate`. Include data migration for `BerthScoreWeights` default rows.

**Step 4 — Write `SmartBerthScorer` service**

File target: `apps/berths/scorer.py`

1. Extract gap-minimisation logic from `apps/berths/allocator.py` into `GapMinScorer` class.
2. Implement `SizeFitScorer`, `AmenityMatchScorer`, `PierClusterScorer`.
3. Implement `SmartBerthScorer` combining all four dimensions with `BerthScoreWeights`.
4. Implement `get_available_berths()` — include departure gap windows (sublet berths).
5. Write unit tests in `apps/berths/tests/test_scorer.py` — one test per dimension, one integration test with all four dimensions.

**Step 5 — Implement smart assign endpoints**

File targets: `apps/berths/views.py`, `apps/berths/urls.py`, `apps/berths/serializers.py`

1. `SmartAssignView` — calls `SmartBerthScorer`, returns ranked list.
2. `ScoreWeightsView` — GET/PATCH with sum=100 validation.
3. Write `BerthScoreWeightsSerializer` with custom `validate()`.
4. Write `SmartAssignResultSerializer`.
5. Wire URLs.
6. Write integration test: `test_smart_assign_returns_ranked_list`.

**Step 6 — Implement fleet assign (async)**

File targets: `apps/berths/views.py`, `apps/berths/tasks.py`

1. `FleetAssignView` — creates `FleetAssignJob`, dispatches `solve_fleet_assignment.delay(job.pk)` inside `transaction.on_commit()`, returns 202.
2. `FleetAssignStatusView` — returns job status + result when complete.
3. `solve_fleet_assignment` Celery task in `tasks.py`.
4. Write integration test: mock Celery task, verify 202 → processing → complete state transitions.

**Step 7 — Booking approval gate + approval endpoints**

File targets: `apps/reservations/views.py`, `apps/reservations/urls.py`

1. Add approval gate logic in `BookingViewSet.create()` (check three Marina conditions).
2. Implement `ApproveBookingView`.
3. Implement `RejectBookingView`.
4. Implement `ClearDocumentGateView` with role check.
5. Write serializer tests: seasonal approval trigger, LOA trigger, document gate role enforcement.

**Step 8 — Temporary departure + sub-letting**

File targets: `apps/berths/views.py`, `apps/berths/serializers.py`, `apps/reservations/views.py`

1. Implement `TemporaryDepartureViewSet` with `activate` and `return_vessel` actions.
2. Implement the full inventory collision path in `return_vessel`.
3. Implement `SubLetBookingViewSet` with `apply_credit` action.
4. Add sub-let auto-creation logic to `BookingViewSet.create()` (detect departure gap overlap, create `SubLetBooking`, set `is_sublet=True`).
5. Write tests: sub-let creation, revenue split calculation, credit-before-checkout rejection, early-return collision with relocation, early-return collision with no replacement (alert raised).

**Step 9 — VesselMovement signals and endpoints**

File targets: `apps/movements/signals.py`, `apps/movements/views.py`, `apps/movements/urls.py`

1. Write `pre_save`/`post_save` signal receivers on `Booking` for auto-creating movement records.
2. Connect signals in `apps/movements/apps.py.ready()`.
3. Implement `VesselMovementViewSet` with `complete`, `expected_board`, `traffic_log` actions.
4. Implement CSV export for `traffic_log` (`?format=csv`).
5. Wire URLs.
6. Write tests: movement auto-creation on check-in/check-out, append-only enforcement (no update/delete endpoint), expected-board grouping.

**Step 10 — Dock walk**

File targets: `apps/berths/views.py` (dock walk views)

1. Implement `DockWalkSessionViewSet` with `finish` action and `berth_order` computation.
2. Implement `DockWalkEntryBulkView` with turnaround day guard, discrepancy detection, and meter anomaly detection.
3. Implement `DockWalkOfflinePayloadView`.
4. Write integration tests: complete walk sync with discrepancy → `BerthAlert` created; meter spike → `meter_anomaly` alert.

**Step 11 — Vessel non-return alerts**

File targets: `apps/berths/views.py`, `apps/berths/tasks.py`, `apps/berths/management/commands/check_non_returns.py`

1. Implement `BerthAlertViewSet` with `resolve` and `escalate_coastguard` actions.
2. Implement `check_non_returns` Celery task.
3. Implement `check_non_returns` management command.
4. Add task to `CELERY_BEAT_SCHEDULE`.
5. Write tests: grace period respected, `critical` escalation threshold, no `VesselMovement` created on non-return.

**Step 12 — Berth listings**

File targets: `apps/berths/views.py`, `apps/berths/serializers.py`

1. Implement `BerthListingViewSet` with commission invoice auto-generation on `sold` transition.
2. Implement `BerthListingEnquiryViewSet`.
3. Add portal-facing permission class to `GET /berths/listings/`.
4. Write tests: listing creation, enquiry submission, commission invoice generation.

**Step 13 — Admin registration**

File targets: `apps/berths/admin.py`, `apps/movements/admin.py`

Register all new models as specified in the Admin section above.

**Step 14 — Frontend (backend team hands off)**

Screens to build (in order):
1. `SmartAssignPanel` — replaces static berth `<select>` in `SmartBookingModal`
2. `ApprovalActionsBar` + `DocumentGatePanel` — on booking detail in `Reservations.jsx`
3. `DepartureScreen` / `RegisterDepartureDrawer` — under Reservations sidebar
4. `MovementsScreen` — `ExpectedMovementsBoard`, `TrafficLogTable`, `LogMovementDrawer`
5. `DockWalkScreen` — with service worker offline cache, `BerthWalkCard`, sync flow
6. `AlertsPanel` — `AlertsBadge`, `AlertsDrawer`, `AlertCard`, `CoastGuardReportModal`
7. `BerthListingsScreen` — staff + portal views
8. Score weights settings panel (in Infrastructure or Admin settings)

Hooks to write:
- `useSmartAssign(params)` — React Query, debounced
- `useFleetAssign()` — polling hook (2-second interval until complete/failed)
- `useDepartures(params)`
- `useSubLetBookings(params)`
- `useMovements(params)`
- `useDockWalk(sessionId)` — offline-aware state + localStorage buffering
- `useBerthAlerts(params)`
- `useBerthListings(params)`
- `useBerthListingEnquiries(listingId)`

**Step 15 — Cross-cutting verification**

1. Verify all new viewsets filter by `request.user.marina` — no cross-marina data exposure.
2. Verify movement log is append-only: confirm no `update` or `delete` endpoints exist.
3. Verify `BerthAlert` `coastguard_escalated_*` fields are only set by the explicit `escalate_coastguard` staff action — never by the background `check_non_returns` task.
4. Run full test suite; fix any FK circular reference issues in migration ordering.
5. Verify `DockWalkEntry` turnaround day guard logic with an integration test covering the 11:00 walk during a 09:00 check-out / 14:00 check-in turnaround.

---

## Cross-cutting Notes

- **Air draft is never a hard exclusion** — the scorer must not call `exclude()` on air draft. It must call `annotate()` to flag the berth in the result set and let the harbour master decide.
- **Revenue share credit is applied only after transient check-out** — the `apply_credit` action must return 400 if `booking.status != 'checked_out'`. Do not allow pre-emptive credit.
- **Coast guard escalation is human-only** — the `check_non_returns` task elevates to `CRITICAL` status and sends a push notification but **never** auto-generates a coast guard report. Only the `escalate_coastguard` staff endpoint does that.
- **Movement records are immutable** — the admin should disable delete permissions for `VesselMovement`, and there must be no `DELETE` or general `PATCH` endpoint in the API.
- **`BerthAlert` and `VesselMovement` are separate audit trails** — non-return alerts do not create movement records; movement records do not create alerts. The two systems are independent.
- **`FleetAssignJob` dispatches via `transaction.on_commit()`** — never call `solve_fleet_assignment.delay()` directly inside the view body before the `FleetAssignJob` row is committed.
