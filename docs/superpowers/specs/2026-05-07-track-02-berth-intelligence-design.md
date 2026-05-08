---
title: Track 2 — Berth Intelligence & Smart Assignment: Design Spec
date: 2026-05-07
status: final
---

> Spec status: Final — reviewed 2026-05-08

# Track 2 — Berth Intelligence & Smart Assignment: Design Spec

Date: 2026-05-07

Scope: Seven feature clusters spanning smart berth assignment scoring, temporary departure sub-letting, a dock walk mobile workflow, mooring movement logging, a berth-for-sale marketplace flag, booking approval workflows (manager gate and document gate), and vessel non-return alerting with coast guard escalation. All features are marina-scoped and sit within the existing Django/DRF + React 19 stack. No new top-level Django apps are introduced except a dedicated `movements` app; all remaining code lands in existing apps (`berths`, `reservations`, `vessels`, `members`).

---

## 1. Architectural Goal

Extend the existing `booking_engine.py` scoring logic from a gap-minimisation-only function into a full vessel-to-berth intelligence layer, and wrap it with the operational workflows marina staff need: departure registration, dock walk data collection, movement tracking, safety alerting, and a berth marketplace. The goal is to make all seven features feel like one coherent "berth lifecycle" layer rather than seven independent bolted-on tools.

Key principles:
- All approval gates are state machine transitions on `Booking.status`; no new top-level status values are added unless strictly necessary.
- The dock walk is designed mobile-first with a service-worker offline cache; it does not require a separate native app.
- The `movements` app is a dedicated Django app, keeping `berths` strictly about physical infrastructure and `movements` strictly about vessel logistics.
- Movement logging is append-only (never updated, only created) so it can serve as an audit trail for harbour authority submissions. Corrections are achieved by creating a new corrective `VesselMovement` entry; the erroneous original remains visible.
- Non-return alerts use Django's existing periodic task pattern (Celery beat or management command) — no new scheduler dependency.
- Revenue share credits for sub-let bookings are applied only after transient check-out, never at booking confirmation, to avoid clawback complexity.
- Air draft constraint (`Berth.max_air_draft_m`) is a **tidal warning, not a hard exclusion**. Air draft clearance is tide-relative — a vessel may clear a bridge at low water that it cannot clear at high water. The scorer never excludes on air draft; it flags results with `air_draft_warning: true` so the harbour master can make an informed decision and add a transit instruction to the booking.
- The fleet placement endpoint (`POST /api/v1/berths/fleet-assign/`) is built in this track alongside the single-vessel smart assign endpoint.
- `VesselMovement` records and `BerthAlert` records remain separate audit trails; non-return alerts do not auto-create movement records.

---

## 2. New Models (Django class definitions)

### 2.1 `BerthScoreWeights` — per-marina tuning for the smart assignment scorer

**App:** `berths`

```python
class BerthScoreWeights(models.Model):
    """
    Marina-level weights that control how the smart assignment scorer
    blends the individual matching dimensions.  Weights are integers that
    sum to 100; the scorer normalises them at runtime.
    """
    marina = models.OneToOneField(
        'accounts.Marina', on_delete=models.CASCADE,
        related_name='score_weights',
    )
    # Dimension weights (must sum to 100; validated in clean())
    w_size_fit       = models.IntegerField(default=40)   # berth length/beam/draft headroom
    w_gap_min        = models.IntegerField(default=25)   # gap-minimisation (existing tetris score)
    w_amenity_match  = models.IntegerField(default=20)   # shore power / mooring type match
    w_pier_cluster   = models.IntegerField(default=15)   # fleet clustering bonus

    updated_at = models.DateTimeField(auto_now=True)

    def clean(self):
        from django.core.exceptions import ValidationError
        total = self.w_size_fit + self.w_gap_min + self.w_amenity_match + self.w_pier_cluster
        if total != 100:
            raise ValidationError(f'Score weights must sum to 100 (got {total}).')

    def __str__(self):
        return f'Score weights — {self.marina}'
```

### 2.2 `TemporaryDeparture` — gap window created by an annual holder leaving

**App:** `berths`

```python
class TemporaryDeparture(models.Model):
    STATUS_CHOICES = [
        ('scheduled',   'Scheduled'),    # recorded but vessel still present
        ('active',      'Active'),       # vessel has departed, berth is empty
        ('returned',    'Returned'),     # vessel back, gap window closed
        ('cancelled',   'Cancelled'),
    ]

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                    related_name='temporary_departures')
    berth       = models.ForeignKey('berths.Berth', on_delete=models.PROTECT,
                                    related_name='temporary_departures')
    vessel      = models.ForeignKey('vessels.Vessel', on_delete=models.PROTECT,
                                    related_name='temporary_departures')
    member      = models.ForeignKey('members.Member', on_delete=models.SET_NULL,
                                    null=True, blank=True,
                                    related_name='temporary_departures')

    depart_date         = models.DateField()
    expected_return     = models.DateField()
    actual_return       = models.DateField(null=True, blank=True)

    status              = models.CharField(max_length=20, choices=STATUS_CHOICES,
                                           default='scheduled')

    # Sub-let consent recorded at departure creation time (reflects Member.sublet_opt_in)
    sublet_enabled      = models.BooleanField(default=False)

    # Revenue share — percentage credited to the berth holder
    revenue_share_pct   = models.DecimalField(max_digits=5, decimal_places=2,
                                              default=50)

    departure_heading   = models.CharField(max_length=100, blank=True,
                                           help_text='E.g. "Falmouth via Newlyn" — '
                                                     'used in non-return report')
    notes               = models.TextField(blank=True)
    created_by          = models.ForeignKey('accounts.User', on_delete=models.SET_NULL,
                                            null=True, blank=True,
                                            related_name='created_departures')
    created_at          = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-depart_date']

    def __str__(self):
        return f'Departure {self.vessel} from {self.berth} — {self.depart_date}'
```

### 2.3 `SubLetBooking` — transient booking that fills a departure gap

**App:** `berths`

```python
class SubLetBooking(models.Model):
    """
    Links a regular Booking to the TemporaryDeparture gap it fills,
    and records the revenue split calculation.

    Revenue share credit is applied to the berth holder only after the
    transient guest's check-out date has passed (credit_applied_at is null
    until that point). The berth holder portal shows only dates and credit
    amount — no guest PII is exposed.
    """
    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                        related_name='sublet_bookings')
    departure       = models.ForeignKey(TemporaryDeparture, on_delete=models.PROTECT,
                                        related_name='sublet_bookings')
    booking         = models.OneToOneField('reservations.Booking', on_delete=models.PROTECT,
                                           related_name='sublet_record')

    # Calculated at booking confirmation time
    total_revenue       = models.DecimalField(max_digits=10, decimal_places=2)
    holder_share        = models.DecimalField(max_digits=10, decimal_places=2)
    marina_share        = models.DecimalField(max_digits=10, decimal_places=2)

    # Credit applied only after transient check-out — null until credit is posted
    credit_invoice_id   = models.IntegerField(null=True, blank=True,
                                              help_text='billing.Invoice pk of the '
                                                        'credit note issued to the holder')
    credit_applied_at   = models.DateTimeField(null=True, blank=True)

    # Inventory collision — set when departure is closed early while transient is still in berth
    inventory_collision     = models.BooleanField(
        default=False,
        help_text='True when the TemporaryDeparture was closed early while this sub-let '
                  'booking was still active. Triggers Smart Assign relocation.',
    )
    actual_nights_sublet    = models.IntegerField(
        null=True, blank=True,
        help_text='Nights actually completed before relocation. Used for pro-rated '
                  'holder_share when inventory_collision=True.',
    )
    relocation_booking      = models.ForeignKey(
        'reservations.Booking', on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='relocated_from_sublet',
        help_text='New booking created for the transient guest in the replacement berth '
                  'after collision relocation.',
    )

    created_at          = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'SubLet BK-{self.booking_id} in gap {self.departure_id}'
```

### 2.4 `FleetAssignJob` — async job record for fleet placement

**App:** `berths`

Fleet assignment for multiple vessels is NP-Hard (bin-packing variant): 25 vessels × 150 berths with pier-clustering constraints cannot complete within a synchronous HTTP request timeout. The endpoint creates a `FleetAssignJob`, dispatches a Celery task, and returns immediately. The React frontend polls the status endpoint until the job reaches `complete` or `failed`.

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
    status          = models.CharField(max_length=20, choices=STATUS_CHOICES,
                                       default='pending')
    request_payload = models.JSONField(
        help_text='Original POST body: check_in, check_out, vessels list.')
    result_payload  = models.JSONField(
        null=True, blank=True,
        help_text='Scored result: same shape as synchronous scored_berths response.')
    celery_task_id  = models.CharField(max_length=100, blank=True)
    error_detail    = models.TextField(blank=True)
    created_by      = models.ForeignKey('accounts.User', on_delete=models.SET_NULL,
                                        null=True, blank=True,
                                        related_name='fleet_assign_jobs')
    created_at      = models.DateTimeField(auto_now_add=True)
    completed_at    = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'FleetAssignJob {self.pk} — {self.status}'
```

### 2.5 `DockWalkSession` — a single pier-walk event

**App:** `berths`

```python
class DockWalkSession(models.Model):
    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                    related_name='dock_walk_sessions')
    pier        = models.ForeignKey('berths.LogicalPier', on_delete=models.SET_NULL,
                                    null=True, blank=True,
                                    related_name='dock_walk_sessions')
    walked_by   = models.ForeignKey('accounts.User', on_delete=models.SET_NULL,
                                    null=True, blank=True,
                                    related_name='dock_walks')
    started_at  = models.DateTimeField()
    finished_at = models.DateTimeField(null=True, blank=True)

    # JSON snapshot of the berth order at walk start — enables offline replay
    berth_order = models.JSONField(default=list,
                                   help_text='[berth_id, ...] in physical walk order')

    class Meta:
        ordering = ['-started_at']

    def __str__(self):
        return f'DockWalk {self.pier} — {self.started_at:%Y-%m-%d %H:%M}'
```

### 2.6 `DockWalkEntry` — one berth observation within a session

**App:** `berths`

Discrepancy detection compares `observed_occupancy` against the booking state at `observed_at` (the timestamp recorded on the device when the warden made the observation), not the state at sync time. This prevents false-positive alerts when booking state changes between walk and sync.

**Turnaround day guard:** If `observed_at.date()` is a turnaround day for the berth — defined as any date where a `Booking.check_out == observed_date` OR `Booking.check_in == observed_date` exists for that berth — then an `observed_occupancy = 'empty'` observation must **never** generate an `unexpected_empty` discrepancy. Between a departing guest leaving at 09:00 and the next guest arriving at 14:00, the berth is legitimately empty. A dock walk at 11:00 seeing it empty is correct, not alarming. The discrepancy engine must check for this condition before writing any `unexpected_empty` alert:

```python
is_turnaround_day = Booking.objects.filter(
    berth=entry.berth,
    status__in=['confirmed', 'checked_in', 'checked_out'],
).filter(
    models.Q(check_out=entry.observed_at.date()) |
    models.Q(check_in=entry.observed_at.date())
).exists()

if is_turnaround_day and entry.observed_occupancy == 'empty':
    entry.discrepancy = 'none'  # suppress — legitimate gap between check-out and check-in
```

```python
class DockWalkEntry(models.Model):
    OCCUPANCY_CHOICES = [
        ('occupied',   'Occupied'),
        ('empty',      'Empty'),
        ('unknown',    'Unknown'),
    ]
    DISCREPANCY_CHOICES = [
        ('none',            'None'),
        ('unexpected_empty', 'Unexpected Empty'),   # system says occupied, walk sees empty
        ('unexpected_vessel','Unexpected Vessel'),  # system says empty, walk sees vessel
        ('overstay',        'Overstay'),
    ]

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                    related_name='dock_walk_entries')
    session     = models.ForeignKey(DockWalkSession, on_delete=models.CASCADE,
                                    related_name='entries')
    berth       = models.ForeignKey('berths.Berth', on_delete=models.PROTECT,
                                    related_name='dock_walk_entries')

    observed_occupancy  = models.CharField(max_length=20, choices=OCCUPANCY_CHOICES)
    discrepancy         = models.CharField(max_length=25, choices=DISCREPANCY_CHOICES,
                                           default='none')

    # Meter readings
    electric_reading_kwh  = models.DecimalField(max_digits=10, decimal_places=2,
                                                null=True, blank=True)
    water_reading_litres  = models.DecimalField(max_digits=10, decimal_places=2,
                                                null=True, blank=True)

    notes       = models.TextField(blank=True)
    photo       = models.ImageField(upload_to='dock_walk/', null=True, blank=True)

    # Synced from offline — timestamp when the observation was actually made on device
    observed_at = models.DateTimeField()
    synced_at   = models.DateTimeField(auto_now_add=True)

    # If this entry auto-generated an alert, link to it
    alert       = models.ForeignKey('berths.BerthAlert', on_delete=models.SET_NULL,
                                    null=True, blank=True,
                                    related_name='dock_walk_entries')

    class Meta:
        ordering = ['session', 'berth__position_index']
        unique_together = ('session', 'berth')

    def __str__(self):
        return f'Walk entry: {self.berth} — {self.observed_occupancy}'
```

### 2.7 `BerthAlert` — discrepancy, meter anomaly, and non-return alerts

**App:** `berths`

The `meter_anomaly` alert type is included so that unusual spikes in electric or water consumption (relative to the vessel's historical average) generate actionable alerts. Non-return alerts remain in this model and are not mirrored into `VesselMovement`.

```python
class BerthAlert(models.Model):
    TYPE_CHOICES = [
        ('unexpected_empty',   'Unexpected Empty Berth'),
        ('unexpected_vessel',  'Unexpected Vessel in Berth'),
        ('overstay',           'Overstay'),
        ('non_return',         'Vessel Non-Return'),
        ('meter_anomaly',      'Meter Reading Anomaly'),
    ]
    STATUS_CHOICES = [
        ('open',     'Open'),
        ('critical', 'Critical'),    # elevated by task when coastguard_escalation_hours exceeded
        ('resolved', 'Resolved'),
        ('escalated','Escalated'),   # set by manual staff action via escalate-coastguard endpoint
    ]

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                    related_name='berth_alerts')
    alert_type  = models.CharField(max_length=30, choices=TYPE_CHOICES)
    status      = models.CharField(max_length=20, choices=STATUS_CHOICES, default='open')

    berth       = models.ForeignKey('berths.Berth', on_delete=models.SET_NULL,
                                    null=True, blank=True, related_name='alerts')
    vessel      = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL,
                                    null=True, blank=True, related_name='berth_alerts')
    departure   = models.ForeignKey('berths.TemporaryDeparture', on_delete=models.SET_NULL,
                                    null=True, blank=True, related_name='alerts')

    detail      = models.TextField(blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    resolved_by = models.ForeignKey('accounts.User', on_delete=models.SET_NULL,
                                    null=True, blank=True, related_name='resolved_alerts')

    # Coast guard escalation
    coastguard_report_text  = models.TextField(blank=True)
    coastguard_escalated_at = models.DateTimeField(null=True, blank=True)
    coastguard_escalated_by = models.ForeignKey('accounts.User', on_delete=models.SET_NULL,
                                                null=True, blank=True,
                                                related_name='coastguard_escalations')

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Alert {self.alert_type} — {self.vessel or self.berth} ({self.status})'
```

### 2.8 `VesselMovement` — append-only movement log

**App:** `movements` (new dedicated Django app)

This model lives in a new `movements` app rather than in `berths`, keeping `berths` focused on physical infrastructure (coordinates, amenities, geometry) and `movements` focused on vessel logistics.

```python
class VesselMovement(models.Model):
    MOVEMENT_TYPES = [
        ('arrival',           'Arrival'),
        ('departure',         'Departure'),
        ('inter_marina',      'Inter-Marina Transfer'),
        ('haul_out',          'Haul Out'),
        ('relaunch',          'Relaunch'),
        ('berth_change',      'Berth Change'),
        ('temp_departure',    'Temporary Departure'),
        ('temp_return',       'Temporary Return'),
        ('correction',        'Correction'),   # corrective entry for a previous error
    ]

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                        related_name='vessel_movements')
    vessel          = models.ForeignKey('vessels.Vessel', on_delete=models.PROTECT,
                                        related_name='movements')
    movement_type   = models.CharField(max_length=20, choices=MOVEMENT_TYPES)

    berth_from      = models.ForeignKey('berths.Berth', on_delete=models.SET_NULL,
                                        null=True, blank=True,
                                        related_name='movements_from')
    berth_to        = models.ForeignKey('berths.Berth', on_delete=models.SET_NULL,
                                        null=True, blank=True,
                                        related_name='movements_to')

    booking         = models.ForeignKey('reservations.Booking', on_delete=models.SET_NULL,
                                        null=True, blank=True,
                                        related_name='movements')
    departure       = models.ForeignKey('berths.TemporaryDeparture', on_delete=models.SET_NULL,
                                        null=True, blank=True,
                                        related_name='movements')

    # Scheduled vs actual — both nullable so you can record expected movements
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

    def __str__(self):
        return f'{self.movement_type} — {self.vessel} @ {self.actual_at or self.scheduled_at}'
```

Movement records are immutable once created. There is no update or delete endpoint. If an entry was made in error, staff must create a new `VesselMovement` with `movement_type='correction'` and reference the erroneous record in `notes`. Both the original and the correction remain visible in the audit trail.

### 2.9 `BerthListing` — for-sale flag and marketplace listing

**App:** `berths`

Active listings are exposed in the customer-facing portal so that any registered boater can browse and submit an enquiry — functioning as a marina-operated berth marketplace. Marina commission is tracked at the marina level (`Marina.berth_sale_commission_pct`) and an invoice is auto-generated for the commission amount when a listing transitions to `sold`.

```python
class BerthListing(models.Model):
    STATUS_CHOICES = [
        ('active',   'Active'),
        ('under_offer', 'Under Offer'),
        ('sold',     'Sold'),
        ('withdrawn', 'Withdrawn'),
    ]

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                        related_name='berth_listings')
    berth           = models.OneToOneField('berths.Berth', on_delete=models.CASCADE,
                                           related_name='listing')
    seller_member   = models.ForeignKey('members.Member', on_delete=models.SET_NULL,
                                        null=True, blank=True,
                                        related_name='berth_listings')

    asking_price    = models.DecimalField(max_digits=12, decimal_places=2,
                                          null=True, blank=True)
    licence_terms   = models.TextField(blank=True,
                                       help_text='Transfer conditions, licence type, etc.')
    description     = models.TextField(blank=True)
    status          = models.CharField(max_length=20, choices=STATUS_CHOICES,
                                       default='active')

    listed_at       = models.DateTimeField(auto_now_add=True)
    updated_at      = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-listed_at']

    def __str__(self):
        return f'Listing {self.berth} — {self.status}'


class BerthListingEnquiry(models.Model):
    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                        related_name='berth_listing_enquiries')
    listing         = models.ForeignKey(BerthListing, on_delete=models.CASCADE,
                                        related_name='enquiries')
    enquirer_member = models.ForeignKey('members.Member', on_delete=models.SET_NULL,
                                        null=True, blank=True,
                                        related_name='berth_enquiries')
    enquirer_name   = models.CharField(max_length=200, blank=True)
    enquirer_email  = models.EmailField(blank=True)
    enquirer_phone  = models.CharField(max_length=50, blank=True)
    message         = models.TextField(blank=True)
    created_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Enquiry on {self.listing.berth} from {self.enquirer_name or self.enquirer_member}'
```

---

## 3. Changes to Existing Models

### 3.1 `Member` — add sub-let opt-in

**File:** `backend/apps/members/models.py`

```python
# Add to Member:
sublet_opt_in = models.BooleanField(
    default=False,
    help_text='Holder consents to berth being sub-let during temporary absences.',
)
```

### 3.2 `Berth` — add air-draft dimension for smart scoring

**File:** `backend/apps/berths/models.py`

```python
# Add to Berth:
max_air_draft_m = models.DecimalField(
    max_digits=5, decimal_places=2, null=True, blank=True,
    help_text='Standard bridge/powerline clearance in metres at mid-tide. '
              'Vessels exceeding this are ranked normally but flagged with an '
              'amber tidal constraint warning — not hard-excluded.',
)
```

`Vessel.air_draft` already exists. When `Berth.max_air_draft_m` is non-null and `vessel.air_draft > berth.max_air_draft_m`, the berth is **not excluded** — air draft clearance is tide-relative. A 15m mast cannot clear a 14m bridge at high water but easily clears it at low water. Hard-excluding the berth denies revenue that the harbour master knows is achievable. Instead, the scorer adds `"air_draft_warning": true` to the berth's result entry and includes a `"air_draft_warning_text": "Vessel air draft exceeds standard clearance. Transit at low water only — confirm with harbour master."` field. The berth is ranked normally. The harbour master selects it and adds a booking note. No override prompt is shown in the UI; the amber flag on the `SmartAssignPanel` card is sufficient signal.

### 3.3 `Marina` — add approval mode flags, non-return thresholds, and commission

**File:** `backend/apps/accounts/models.py`

```python
# Add to Marina:
require_manager_approval_loa_m = models.DecimalField(
    max_digits=5, decimal_places=1, null=True, blank=True,
    help_text='Bookings with boat_loa >= this value require manager approval. Null = disabled.',
)
require_manager_approval_types = models.JSONField(
    default=list,
    help_text='List of vessel types (e.g. ["commercial", "superyacht"]) that require '
              'manager approval regardless of LOA.',
)
require_approval_for_seasonal = models.BooleanField(
    default=True,
    help_text='All seasonal/annual berth applications require manager approval '
              'regardless of vessel size or type.',
)
document_gate_enabled = models.BooleanField(
    default=False,
    help_text='Prevent status transition to confirmed until insurance, registration, '
              'and waiver are all verified.',
)
non_return_grace_hours = models.IntegerField(
    default=2,
    help_text='Hours after expected return before a non-return alert is generated.',
)
coastguard_escalation_hours = models.IntegerField(
    default=4,
    help_text='Hours after non-return alert before a coast guard escalation report is generated.',
)
berth_sale_commission_pct = models.DecimalField(
    max_digits=5, decimal_places=2, default=0,
    help_text='Marina commission percentage charged on berth sales. '
              'When a BerthListing transitions to sold, an invoice for this '
              'percentage of the asking_price is generated against the seller.',
)
```

### 3.4 `Booking` — add document-gate verification fields

**File:** `backend/apps/reservations/models.py`

The document gate covers three requirements: insurance, registration, and waiver. All three must be verified before `document_gate_cleared` can be set to `True`. Only users with the `marina_manager` or `owner` role may perform the `clear-document-gate` action.

```python
# Add to Booking:
insurance_verified    = models.BooleanField(default=False)
registration_verified = models.BooleanField(default=False)
waiver_verified       = models.BooleanField(default=False)
document_gate_cleared = models.BooleanField(default=False)
document_gate_cleared_by = models.ForeignKey(
    'accounts.User', on_delete=models.SET_NULL,
    null=True, blank=True,
    related_name='document_gate_clearances',
)
document_gate_cleared_at = models.DateTimeField(null=True, blank=True)
```

The existing `Booking.insurance_doc` and `Booking.waiver_signed` fields cover the document upload and guest-facing waiver step respectively. The new fields track the staff verification step. The gate combines both the upload presence and the staff `*_verified` boolean before allowing clearance.

---

## 4. API Contract

All paths are prefixed `/api/v1/`. All views filter by `request.user.marina`. Authentication: session or token (existing pattern).

### 4.1 Smart Assignment

#### `GET /api/v1/berths/smart-assign/`

Score available berths for a given vessel and date window. Returns ranked candidates. Air draft is never a hard exclusion — berths where `vessel.air_draft > berth.max_air_draft_m` are included in results but carry `"air_draft_warning": true` in the response so the harbour master can decide whether to schedule a low-water transit.

Query params: `check_in`, `check_out`, `vessel_id` (optional — pulls dimensions from Vessel record), `boat_loa`, `boat_beam`, `boat_draft`, `air_draft`, `shore_power`, `mooring_pref`

```json
// Response 200
{
  "scored_berths": [
    {
      "berth_id": 12,
      "berth_code": "A-04",
      "pier": "Pontoon A",
      "score": 91.4,
      "score_breakdown": {
        "size_fit": 40.0,
        "gap_min": 21.3,
        "amenity_match": 20.0,
        "pier_cluster": 10.1
      },
      "length_m": "14.0",
      "max_beam_m": "4.5",
      "max_draft_m": "2.2",
      "max_air_draft_m": null,
      "amenities": ["power_30a", "water"],
      "pricing_tier": "Standard",
      "price_per_night": "85.00",
      "air_draft_warning": false,
      "air_draft_warning_text": null
    }
  ],
  "recommended_berth_id": 12
}
// When vessel air draft exceeds berth.max_air_draft_m, the entry instead contains:
// "air_draft_warning": true,
// "air_draft_warning_text": "Vessel air draft exceeds standard clearance. Transit at low water only — confirm with harbour master."
```

#### `POST /api/v1/berths/fleet-assign/`

Optimised placement for a group booking. Fleet assignment is NP-Hard (bin-packing variant): scoring 25 vessels across 150 berths with pier-clustering constraints cannot complete within a synchronous HTTP timeout. The endpoint creates a `FleetAssignJob`, enqueues a Celery worker, and returns immediately with `202 Accepted`.

```json
// Request body (application/json)
{
  "check_in": "2026-07-10",
  "check_out": "2026-07-17",
  "vessels": [
    { "vessel_id": 3 },
    { "boat_loa": 12.5, "boat_beam": 4.0, "boat_draft": 1.8 }
  ]
}
// Response 202 Accepted
{
  "job_id": 42,
  "status": "pending",
  "status_url": "/api/v1/berths/fleet-assign/42/status/"
}
```

#### `GET /api/v1/berths/fleet-assign/{job_id}/status/`

Polling endpoint. The React frontend polls every 2 seconds until `status` is `complete` or `failed`.

```json
// While processing:
{ "job_id": 42, "status": "processing" }

// On completion:
{
  "job_id": 42,
  "status": "complete",
  "result": {
    "cluster_pier": "Pontoon A",
    "pier_score": 87.2,
    "assignments": [
      {
        "vessel_id": 3,
        "scored_berths": [ /* same shape as smart-assign response */ ]
      }
    ]
  }
}

// On failure:
{ "job_id": 42, "status": "failed", "error": "No pier can accommodate all vessels in the requested window." }
```

The Celery worker runs `solve_fleet_assignment(job_id)`, writes `result_payload` + `completed_at` to the `FleetAssignJob` row, and sets `status` to `complete` or `failed`. The worker applies the same per-vessel `SmartBerthScorer` plus a pier-clustering pass that maximises contiguous assignment on a single pier.

#### `GET /api/v1/berths/score-weights/`
#### `PATCH /api/v1/berths/score-weights/`

Retrieve or update `BerthScoreWeights` for the marina.

```json
// PATCH request
{ "w_size_fit": 35, "w_gap_min": 30, "w_amenity_match": 20, "w_pier_cluster": 15 }
// Response 200
{ "w_size_fit": 35, "w_gap_min": 30, "w_amenity_match": 20, "w_pier_cluster": 15, "updated_at": "2026-05-07T10:00:00Z" }
```

### 4.2 Temporary Departure & Sub-letting

Sub-let bookings appear in the main reservations list alongside regular bookings (flagged with a `"sublet": true` field and a "Sub-let" badge in the UI). They are not segregated into a separate tab.

#### `GET /api/v1/berths/temporary-departures/`
#### `POST /api/v1/berths/temporary-departures/`

```json
// POST request
{
  "berth": 12,
  "vessel": 3,
  "member": 7,
  "depart_date": "2026-06-01",
  "expected_return": "2026-06-14",
  "sublet_enabled": true,
  "revenue_share_pct": "50.00",
  "departure_heading": "Azores passage"
}
// Response 201
{
  "id": 1,
  "berth": 12,
  "berth_code": "A-04",
  "vessel": 3,
  "vessel_name": "Serenity",
  "member": 7,
  "member_name": "James Hartley",
  "depart_date": "2026-06-01",
  "expected_return": "2026-06-14",
  "actual_return": null,
  "status": "scheduled",
  "sublet_enabled": true,
  "revenue_share_pct": "50.00",
  "departure_heading": "Azores passage",
  "sublet_bookings": []
}
```

#### `PATCH /api/v1/berths/temporary-departures/{id}/`
#### `POST /api/v1/berths/temporary-departures/{id}/activate/`
#### `POST /api/v1/berths/temporary-departures/{id}/return/`

`activate` transitions status from `scheduled` to `active` and creates a `VesselMovement` record of type `temp_departure`.

`return` sets `actual_return`, transitions to `returned`, and creates a `VesselMovement` of type `temp_return`. Revenue share credits on any associated `SubLetBooking` records are applied only after each transient booking's individual check-out date has passed (handled by the `apply-credit` action, not triggered automatically at return).

**Inventory Collision (early return):** If `actual_return < departure.expected_return` and any linked `SubLetBooking` has a transient `Booking` with `check_out > actual_return`, the view must handle the collision:

1. Flag each affected `SubLetBooking` with `inventory_collision=True`.
2. Compute `actual_nights_sublet = (actual_return - sublet_booking.booking.check_in).days` (minimum 1). Pro-rate the holder credit: `holder_share = berth.pricing_tier.unit_price * actual_nights_sublet * (departure.revenue_share_pct / 100)`.
3. Call `SmartBerthScorer` to find the next best available berth for the transient guest (same dimensions, same remaining nights: `check_in=actual_return`, `check_out=original check_out`).
4. If a replacement berth is found: update the transient `Booking.berth` to the new berth, create a `VesselMovement` of type `berth_change` (berth_from=original berth, berth_to=replacement), and store the updated booking reference in `SubLetBooking.relocation_booking`.
5. If no replacement berth is found: set `inventory_collision=True` on the `SubLetBooking` but do not update the booking berth — surface the unresolved collision as a `BerthAlert` of type `unexpected_vessel` on the original berth so staff can resolve it manually.
6. The response includes an `"inventory_collisions"` array listing affected sub-let booking IDs and whether relocation succeeded.

#### `GET /api/v1/berths/sublet-bookings/`

List all sub-let bookings for the marina. Response includes `departure`, `booking`, `holder_share`, `marina_share`, `credit_applied_at`. The berth holder's portal view of sub-let records shows only sub-let dates and credit amount; no guest PII (name, contact details) is included.

#### `POST /api/v1/berths/sublet-bookings/apply-credit/{id}/`

Trigger credit note creation for a completed sub-let (transient booking must be in `checked_out` status). Creates a billing credit invoice and stamps `credit_applied_at`. Attempting to apply credit before check-out returns a `400 Bad Request`.

### 4.3 Dock Walk

#### `POST /api/v1/berths/dock-walk/sessions/`
#### `GET /api/v1/berths/dock-walk/sessions/`
#### `GET /api/v1/berths/dock-walk/sessions/{id}/`

```json
// POST request
{ "pier": 2, "started_at": "2026-05-07T08:30:00Z" }
// Response 201
{
  "id": 5,
  "pier": 2,
  "pier_name": "Pontoon A",
  "walked_by": 4,
  "started_at": "2026-05-07T08:30:00Z",
  "finished_at": null,
  "berth_order": [12, 13, 14, 15, 16],
  "entries": []
}
```

`berth_order` is computed server-side from `Berth.position_index` order at session creation time; it is embedded so the client can work offline.

#### `POST /api/v1/berths/dock-walk/sessions/{id}/entries/` (bulk)

Accepts a list of observations — designed for offline batch sync. Discrepancy detection compares each entry's `observed_occupancy` against the booking state that was active at `observed_at`, not at the time of sync.

```json
// POST request
{
  "entries": [
    {
      "berth": 12,
      "observed_occupancy": "occupied",
      "electric_reading_kwh": "1420.50",
      "water_reading_litres": null,
      "notes": "",
      "observed_at": "2026-05-07T08:32:00Z"
    },
    {
      "berth": 13,
      "observed_occupancy": "empty",
      "notes": "Gate unlocked",
      "observed_at": "2026-05-07T08:34:00Z"
    }
  ]
}
// Response 201
{
  "created": 2,
  "discrepancies": [
    {
      "berth": 13,
      "berth_code": "A-05",
      "discrepancy": "unexpected_empty",
      "alert_id": 7
    }
  ],
  "meter_anomalies": []
}
```

After discrepancy detection, meter readings are checked against each vessel's historical moving average. If a reading delta is anomalously high (implementation: exceeds 3× the vessel's rolling 30-day average), a `BerthAlert` of type `meter_anomaly` is created and referenced in the `meter_anomalies` response array.

#### `PATCH /api/v1/berths/dock-walk/sessions/{id}/finish/`

Sets `finished_at` on the session.

#### `GET /api/v1/berths/dock-walk/offline-payload/`

Returns the full berth list for all piers plus today's bookings, last meter readings, and current session if one exists — everything the service worker needs to cache for offline use.

```json
{
  "piers": [
    {
      "id": 2,
      "name": "Pontoon A",
      "berths": [
        {
          "id": 12,
          "code": "A-04",
          "position_index": 0,
          "booking_today": { "guest_name": "James Hartley", "check_out": "2026-05-09" },
          "last_electric_kwh": "1418.20",
          "last_water_litres": null
        }
      ]
    }
  ]
}
```

### 4.4 Mooring Movements

All movement endpoints live under the `movements` app URL prefix but are still routed at `/api/v1/berths/movements/` for API consistency. There are no update or delete endpoints; the log is append-only.

#### `GET /api/v1/berths/movements/`

Query params: `date` (ISO date, defaults today), `pier_id`, `vessel_type`, `movement_type`, `completed`

```json
{
  "results": [
    {
      "id": 10,
      "vessel": 3,
      "vessel_name": "Serenity",
      "movement_type": "departure",
      "movement_type_display": "Departure",
      "berth_from": 12,
      "berth_from_code": "A-04",
      "berth_to": null,
      "scheduled_at": "2026-05-07T09:00:00Z",
      "actual_at": null,
      "completed": false,
      "heading": "Azores passage",
      "recorded_by_name": "Tom Marsh"
    }
  ]
}
```

#### `POST /api/v1/berths/movements/`

```json
// Request
{
  "vessel": 3,
  "movement_type": "departure",
  "berth_from": 12,
  "scheduled_at": "2026-05-07T09:00:00Z",
  "heading": "Azores passage"
}
```

#### `PATCH /api/v1/berths/movements/{id}/complete/`

Marks `completed=True`, sets `actual_at` to now (or a provided timestamp). Returns the updated movement. This is the only mutating action on an existing movement record; it does not alter the audit fields.

#### `GET /api/v1/berths/movements/expected-board/`

Returns today's movements grouped into `arrivals` and `departures`, each sorted by `scheduled_at`. Outstanding past-due movements (`scheduled_at` < now and `completed=False`) are flagged with `"overdue": true`.

```json
{
  "date": "2026-05-07",
  "arrivals": [
    { "id": 9, "vessel_name": "Blue Horizon", "scheduled_at": "2026-05-07T14:00:00Z", "completed": false, "overdue": false }
  ],
  "departures": [
    { "id": 10, "vessel_name": "Serenity", "scheduled_at": "2026-05-07T09:00:00Z", "completed": false, "overdue": true }
  ]
}
```

#### `GET /api/v1/berths/movements/traffic-log/`

Same as `movements/` but scoped to a date range and exportable as CSV via `?format=csv`.

### 4.5 Berth Listings

Active listings are returned by a public-facing endpoint accessible to portal-authenticated boaters (read-only). Staff-facing endpoints for creating and managing listings require marina staff authentication.

#### `GET /api/v1/berths/listings/`
#### `POST /api/v1/berths/listings/`

```json
// POST request
{
  "berth": 12,
  "seller_member": 7,
  "asking_price": "95000.00",
  "licence_terms": "Freehold licence, 20-year term, no liveaboard.",
  "description": "Prime A-pontoon berth, 14m × 4.5m, all utilities."
}
// Response 201
{
  "id": 1,
  "berth": 12,
  "berth_code": "A-04",
  "berth_length_m": "14.0",
  "berth_max_beam_m": "4.5",
  "berth_amenities": ["power_30a", "water"],
  "seller_member": 7,
  "seller_name": "James Hartley",
  "asking_price": "95000.00",
  "commission_pct": "3.00",
  "licence_terms": "Freehold licence, 20-year term, no liveaboard.",
  "description": "Prime A-pontoon berth, 14m × 4.5m, all utilities.",
  "status": "active",
  "listed_at": "2026-05-07T10:00:00Z",
  "enquiry_count": 0
}
```

When `status` transitions to `sold`, the system auto-generates an `Invoice` against `seller_member` for `asking_price × marina.berth_sale_commission_pct / 100`.

#### `PATCH /api/v1/berths/listings/{id}/`
#### `GET /api/v1/berths/listings/{id}/enquiries/`
#### `POST /api/v1/berths/listings/{id}/enquiries/`

```json
// POST enquiry
{
  "enquirer_member": null,
  "enquirer_name": "Sarah Bell",
  "enquirer_email": "sarah@example.com",
  "enquirer_phone": "+44 7700 000000",
  "message": "Interested — can we arrange a viewing?"
}
```

### 4.6 Booking Approval Workflows

Manager approval is triggered if any of the following conditions are met:
1. `boat_loa >= Marina.require_manager_approval_loa_m` (when non-null).
2. The vessel type is in `Marina.require_manager_approval_types`.
3. The booking type is `seasonal` and `Marina.require_approval_for_seasonal` is `True`.

When triggered, the booking is created with `status='pending_approval'` regardless of the marina's `booking_mode`.

#### `POST /api/v1/reservations/bookings/{id}/approve/`

Transitions `Booking.status` from `pending_approval` to `awaiting_payment` (Mode A) or `confirmed` (if marina is `instant_booking` and document gate is cleared). Assigns a berth if not already set.

```json
// Request
{ "berth": 12 }
// Response 200
{ "id": 5, "status": "awaiting_payment", "berth": 12, "berth_code": "A-04" }
```

#### `POST /api/v1/reservations/bookings/{id}/reject/`

```json
// Request
{ "reason": "Vessel type not permitted in this marina." }
// Response 200
{ "id": 5, "status": "cancelled" }
```

#### `POST /api/v1/reservations/bookings/{id}/clear-document-gate/`

Restricted to users with the `marina_manager` or `owner` role. Sets `document_gate_cleared=True` only when all three required fields (`insurance_verified`, `registration_verified`, `waiver_verified`) are `True`. Stamps `cleared_by` and `cleared_at`. If the booking is in `pending_approval`, transitions to the next status.

```json
// Request
{ "insurance_verified": true, "registration_verified": true, "waiver_verified": true }
// Response 200
{
  "id": 5,
  "insurance_verified": true,
  "registration_verified": true,
  "waiver_verified": true,
  "document_gate_cleared": true,
  "document_gate_cleared_by": 2,
  "document_gate_cleared_at": "2026-05-07T11:00:00Z"
}
```

The view checks `Marina.document_gate_enabled` before enforcing the gate. Attempting to call this endpoint with a non-manager role returns `403 Forbidden`.

### 4.7 Vessel Non-Return Alerts

#### `GET /api/v1/berths/alerts/`

Query params: `status` (`open`/`resolved`/`escalated`), `alert_type`, `vessel_id`

```json
{
  "results": [
    {
      "id": 7,
      "alert_type": "non_return",
      "status": "open",
      "vessel": 3,
      "vessel_name": "Serenity",
      "vessel_owner_name": "James Hartley",
      "vessel_owner_phone": "+44 7700 000000",
      "departure_id": 1,
      "departure_heading": "Azores passage",
      "expected_return": "2026-06-14",
      "hours_overdue": 6.5,
      "detail": "Vessel has not returned 6.5 hours after expected return.",
      "created_at": "2026-06-14T18:30:00Z"
    }
  ]
}
```

#### `PATCH /api/v1/berths/alerts/{id}/resolve/`

```json
// Request
{ "notes": "Owner called — delayed by weather, returning tomorrow." }
// Response 200
{ "id": 7, "status": "resolved", "resolved_at": "2026-06-14T20:00:00Z" }
```

#### `POST /api/v1/berths/alerts/{id}/escalate-coastguard/`

Generates and stores a coast guard incident report, stamps `coastguard_escalated_at`, transitions alert status to `escalated`. No corresponding `VesselMovement` is created; alerts and movements remain separate audit trails.

```json
// Request
{ "additional_notes": "No AIS signal since departure. Owner uncontactable." }
// Response 200
{
  "id": 7,
  "status": "escalated",
  "coastguard_report_text": "VESSEL NON-RETURN REPORT\n\nVessel: Serenity\nRegistration: ...\nLast departure: 2026-06-01 from Berth A-04\nHeading: Azores passage\nExpected return: 2026-06-14\nOwner: James Hartley, +44 7700 000000\n\nAdditional notes: No AIS signal since departure...",
  "coastguard_escalated_at": "2026-06-14T20:30:00Z"
}
```

#### Background task: `check_non_returns` (Celery beat / management command)

Runs every 30 minutes. Queries `TemporaryDeparture` where `status='active'` and `expected_return < now - grace_hours`. For each, creates a `BerthAlert` of type `non_return` if one does not already exist.

For alerts already open where `created_at < now - coastguard_escalation_hours`, the task **elevates the alert status to `CRITICAL`** (add `'critical'` to `STATUS_CHOICES`) and sends a high-priority push notification to the harbour master. It does **not** auto-generate a coast guard report.

**Rationale:** Auto-escalating SAR protocols from a database timer is a legal and operational liability. A boater might be anchored in the next bay with a flat phone battery. An automatically submitted formal Coast Guard report for a false alarm can result in significant fines for the marina. A human must make the call. The `POST /api/v1/berths/alerts/{id}/escalate-coastguard/` endpoint remains the only mechanism to generate and store a formal escalation report, and it requires a deliberate staff action.

The `CoastGuardReportModal` in the `AlertsPanel` is shown automatically when an alert is in `CRITICAL` status, prompting the harbour master to either resolve the alert (vessel found) or click "Generate Coast Guard Report" to formally escalate.

---

## 5. Frontend Architecture

### 5.1 New Screens

#### `SmartAssignPanel` (component inside `Reservations.jsx` and `SmartBookingModal`)

- Replace the current static berth `<select>` in `SmartBookingModal` with `SmartAssignPanel`.
- Calls `GET /api/v1/berths/smart-assign/` when vessel dimensions and dates are known.
- Renders a ranked list of berths with score badges and a score breakdown tooltip.
- Staff can override: selecting a different berth from the list overrides the suggestion.
- Hook: `useSmartAssign(params)` — React Query query, debounced on dimension input.

#### `MovementsScreen` — new top-level screen

**Sidebar placement:** Under "Operations" section, new item "Movements".

Three tabs:
1. **Expected Board** — day-view with arrivals/departures; uses `GET /api/v1/berths/movements/expected-board/`. Staff click a movement row to mark it complete inline.
2. **Traffic Log** — filterable chronological list; uses `GET /api/v1/berths/movements/traffic-log/`; includes CSV export button.
3. **Log Movement** — form to create a `VesselMovement` record manually.

Components:
- `MovementsScreen` (screen)
- `ExpectedMovementsBoard` — card-based board with `ArrivalCard` and `DepartureCard`
- `TrafficLogTable` — sortable table with filter bar (`PierFilter`, `MovementTypeFilter`, `DateRangePicker`)
- `LogMovementDrawer` — slide-in form

Hook: `useMovements(params)` wrapping `GET /api/v1/berths/movements/`.

#### `DockWalkScreen` — new top-level screen

**Sidebar placement:** Under "Operations" section, new item "Dock Walk".

- Pier selector at top.
- Renders a `BerthWalkCard` for each berth in `position_index` order.
- Each card shows: berth code, current booking guest name + check-out, last meter readings, occupancy toggle (occupied/empty/unknown), meter input fields, photo capture, notes.
- "Sync" button posts all unsaved entries in batch to `/api/v1/berths/dock-walk/sessions/{id}/entries/`.
- Offline: service worker caches the `offline-payload` response; all interactions write to `localStorage` keyed by session id; sync re-POSTs on reconnect.
- Discrepancy results shown inline after sync: red banner on `BerthWalkCard` if a discrepancy was detected.
- Meter anomaly results shown inline after sync: amber banner on `BerthWalkCard` if a meter anomaly alert was generated.

Components:
- `DockWalkScreen` (screen)
- `DockWalkSessionHeader` — pier selector, start/finish controls
- `BerthWalkCard` — individual berth observation card
- `MeterReadingInput` — numeric input with last-reading delta display
- `DiscrepancyBanner` — shown post-sync for flagged berths
- `MeterAnomalyBanner` — amber banner shown post-sync for anomalous readings

Hook: `useDockWalk(sessionId)` — wraps offline-aware state + sync logic.

#### `DepartureScreen` — new top-level screen (or tab within `Reservations.jsx`)

**Sidebar placement:** Under "Reservations" section, new tab/item "Departures".

- List of `TemporaryDeparture` records for the marina.
- Filters: status, member, pier.
- "Register Departure" button opens `RegisterDepartureDrawer`.
- Departure row shows sub-let status: "Sub-let: 3 nights booked / €255 revenue share pending credit".
- "Mark Returned" action on active departures.

Components:
- `DepartureScreen` or `DeparturesTab` (within existing Reservations sidebar)
- `RegisterDepartureDrawer` — slide-in form with berth picker, date picker, sub-let toggle
- `DepartureRow` — row with inline status and sub-let revenue summary

Hook: `useDepartures(params)`.

#### `BerthListingsScreen` — new screen or section in `Infrastructure.jsx`

**Sidebar placement:** Under "Berths" section or within `Infrastructure.jsx` as a new tab "For Sale". A matching read-only "Berths for Sale" tab is also exposed in the customer portal.

- Table of active listings with berth code, dimensions, asking price, enquiry count.
- "Create Listing" button opens `CreateListingModal`.
- Row → detail drawer showing enquiries list.

Components:
- `BerthListingsScreen` or `BerthListingsTab`
- `CreateListingModal`
- `ListingDetailDrawer` with `EnquiryList`

#### `AlertsPanel` — existing or new sidebar widget

A persistent alert badge on the sidebar nav (similar to notification count) for open `BerthAlert` records. Click opens `AlertsDrawer` listing all open alerts with resolve and escalate actions.

Components:
- `AlertsBadge` (nav badge)
- `AlertsDrawer`
- `AlertCard` with resolve and "Escalate to Coast Guard" action button
- `CoastGuardReportModal` — shows pre-populated report text, allows notes, confirms escalation

Hook: `useBerthAlerts(params)`.

### 5.2 Changes to Existing Screens

**`Reservations.jsx` / `SmartBookingModal`:**
- Replace static berth `<select>` with `SmartAssignPanel` (see above).
- Add "Requires Approval" badge to bookings in `pending_approval` status.
- Add `ApprovalActionsBar` component on booking detail: shows "Approve" (with berth picker) and "Reject" buttons when status is `pending_approval`.
- Add `DocumentGatePanel` on booking detail: shows insurance, registration, and waiver verified checkboxes, plus a "Clear Document Gate" button. Visible only when `Marina.document_gate_enabled` is true. The "Clear Document Gate" button is rendered only for users with the `marina_manager` or `owner` role.
- Sub-let bookings appear in the main reservations list with a "Sub-let" badge.

**`Vessels.jsx`:**
- Add non-return alert badge next to vessel name when an open `non_return` alert exists for that vessel.
- Add `ExpectedReturnField` on vessel detail when vessel has an active `TemporaryDeparture`.

---

## 6. Implementation Steps (ordered)

**Step 1 — Database foundations**

1. Add `Member.sublet_opt_in` field (migration in `members` app).
2. Add `Berth.max_air_draft_m` field (migration in `berths` app).
3. Add Marina approval/alert/commission config fields (migration in `accounts` app): `require_manager_approval_loa_m`, `require_manager_approval_types`, `require_approval_for_seasonal`, `document_gate_enabled`, `non_return_grace_hours`, `coastguard_escalation_hours`, `berth_sale_commission_pct`.
4. Add `Booking` document-gate fields including `waiver_verified` (migration in `reservations` app).
5. Create all new models: `BerthScoreWeights`, `TemporaryDeparture`, `SubLetBooking`, `FleetAssignJob`, `DockWalkSession`, `DockWalkEntry`, `BerthAlert`, `BerthListing`, `BerthListingEnquiry` (single migration in `berths` app).
6. Create new `movements` Django app; create `VesselMovement` model and initial migration.
7. Register all new models in `admin.py`.

**Step 2 — Smart assignment scorer**

1. Extract the existing `_score_berths` gap-minimisation logic into a `GapMinScorer` class.
2. Implement `SmartBerthScorer` that blends `GapMinScorer`, `SizeFitScorer`, `AmenityMatchScorer`, and `PierClusterScorer` using weights from `BerthScoreWeights`. Air draft is never a hard exclusion — add `air_draft_warning` flag to results instead.
3. Implement `solve_fleet_assignment(job_id)` as a Celery task using the same per-vessel scorers plus a pier-clustering pass. The task writes `result_payload` and `completed_at` to the `FleetAssignJob` row on success, or writes `error_detail` and sets `status='failed'` on failure.
4. Expose `GET /api/v1/berths/smart-assign/`, `POST /api/v1/berths/fleet-assign/` (returns `202 Accepted` + `job_id`), `GET /api/v1/berths/fleet-assign/{job_id}/status/`, `GET /api/v1/berths/score-weights/`, and `PATCH /api/v1/berths/score-weights/`.
5. Wire `SmartAssignPanel` in the frontend replacing the existing berth `<select>` in `SmartBookingModal`. For fleet assign, display a loading spinner while polling the status endpoint; render results when `status='complete'`.
6. Write unit tests for each scorer dimension; write integration test for fleet-assign polling loop (mock Celery task, verify 202→processing→complete state transitions).

**Step 3 — Booking approval workflows**

1. Add `pending_approval` gate logic to `BookingEngineRequestView`: check `Marina.require_manager_approval_loa_m`, `require_manager_approval_types`, and `require_approval_for_seasonal`; if any fires, create booking with `status='pending_approval'` regardless of `booking_mode`.
2. Implement `ApproveBookingView` and `RejectBookingView` (`POST /api/v1/reservations/bookings/{id}/approve/` and `/reject/`).
3. Implement `ClearDocumentGateView` (`POST /api/v1/reservations/bookings/{id}/clear-document-gate/`) with role check (`marina_manager` or `owner` only) and three-field gate.
4. Add `ApprovalActionsBar` and `DocumentGatePanel` (with role-gated button) to the Reservations frontend.
5. Write serializer tests for approval transitions, seasonal approval trigger, and document gate role enforcement.

**Step 4 — Temporary departure and sub-letting**

1. Implement `TemporaryDepartureViewSet` with `activate` and `return` actions.
2. Implement the inventory collision path in the `return` action: detect active `SubLetBooking` records that extend past `actual_return`; set `inventory_collision=True`; compute `actual_nights_sublet` and pro-rated `holder_share`; call `SmartBerthScorer` for each affected transient guest; update `Booking.berth` and create `berth_change` `VesselMovement` if a replacement berth is found; raise a `BerthAlert` of type `unexpected_vessel` on the original berth if no replacement is found.
3. Implement `SubLetBookingViewSet` with `apply-credit` action (enforcing post-check-out constraint; use `actual_nights_sublet` as the credit basis when `inventory_collision=True`).
4. Extend `compatible_available_berths` to include gap windows from active `TemporaryDeparture` records where `sublet_enabled=True`. When a booking fills a gap, auto-create a `SubLetBooking`, compute the revenue split, and set `"sublet": true` on the booking record.
5. Build `DepartureScreen` / `RegisterDepartureDrawer` frontend.
6. Write tests: sub-let booking creation, revenue split calculation, credit-before-checkout rejection, credit application, early-return collision with successful relocation, early-return collision with no replacement berth (alert raised).

**Step 5 — VesselMovement logging**

1. Implement `VesselMovementViewSet` (no update/delete endpoints) with `complete` action and `expected-board` and `traffic-log` extra actions.
2. Wire movement auto-creation: on `TemporaryDeparture.activate()`, create `temp_departure` movement; on `TemporaryDeparture.return()`, create `temp_return` movement; on `Booking.check_in`, create `arrival` movement; on `Booking.check_out`, create `departure` movement.
3. Build `MovementsScreen` frontend with `ExpectedMovementsBoard`, `TrafficLogTable`, and `LogMovementDrawer`.
4. Write tests for movement auto-creation, append-only enforcement, and the expected-board query.

**Step 6 — Dock walk**

1. Implement `DockWalkSessionViewSet` with bulk-entry endpoint and offline payload endpoint.
2. Implement discrepancy detection in the bulk-entry view: compare `observed_occupancy` against `Booking` state at `observed_at` timestamp; create `BerthAlert` records.
3. Implement meter anomaly detection: compare reading delta against 30-day vessel rolling average; create `BerthAlert` of type `meter_anomaly` when delta exceeds 3× average.
4. Build `DockWalkScreen` frontend with offline service worker cache of the `offline-payload` response, `localStorage` buffering of unsaved entries, `DiscrepancyBanner`, and `MeterAnomalyBanner`.
5. Write integration tests: complete walk sync with a discrepancy triggers `BerthAlert`; meter spike triggers `meter_anomaly` alert.

**Step 7 — Vessel non-return alerts**

1. Implement `BerthAlertViewSet` with `resolve` and `escalate-coastguard` actions.
2. Write `check_non_returns` management command / Celery task.
3. Build `AlertsDrawer` frontend with `AlertCard`, `CoastGuardReportModal`.
4. Add alert badge to nav sidebar.
5. Write task tests: grace period respected, escalation threshold respected, no `VesselMovement` created on non-return.

**Step 8 — Berth listings**

1. Implement `BerthListingViewSet` and `BerthListingEnquiryViewSet`. Add portal-facing read-only listing endpoint.
2. Wire commission invoice auto-generation when listing transitions to `sold`.
3. Build `BerthListingsScreen` frontend (staff) and portal "Berths for Sale" tab (boater-facing).
4. Write tests for listing creation, enquiry submission, and commission invoice generation on sale.

**Step 9 — Polish and cross-cutting**

1. Add `useSmartAssign`, `useMovements`, `useDockWalk`, `useDepartures`, `useBerthAlerts` React Query hooks.
2. Ensure all new endpoints appear in the DRF browsable API and are covered by the existing permission class.
3. Verify multi-tenancy: confirm all new viewsets filter by `request.user.marina`.
4. Add CSV export to traffic log endpoint.
