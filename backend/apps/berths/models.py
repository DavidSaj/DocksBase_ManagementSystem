import uuid

from django.core.validators import MinValueValidator, MaxValueValidator
from django.db import models


PIER_TYPE_CHOICES = [
    ('concrete',  'Concrete Pier'),
    ('pontoon',   'Wooden Pontoon'),
    ('steel',     'Steel'),
    ('land',      'Land / Grass'),
    ('fuel-dock', 'Fuel Dock'),
    ('gangway',   'Gangway'),
    ('ramp',      'Launch Ramp'),
]


class LogicalPier(models.Model):
    marina     = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='logical_piers')
    name       = models.CharField(max_length=100)
    pier_type  = models.CharField(max_length=20, choices=PIER_TYPE_CHOICES, default='pontoon')
    notes      = models.TextField(blank=True)

    class Meta:
        unique_together = ('marina', 'name')
        ordering = ['name']

    def __str__(self):
        return f'{self.name} ({self.marina})'


class OTAConnection(models.Model):
    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='ota_connections')
    name             = models.CharField(max_length=100)
    slug             = models.SlugField(max_length=100)
    inbound_ical_url = models.URLField(blank=True, default='')
    outbound_token   = models.UUIDField(default=uuid.uuid4, unique=True)
    target_pct       = models.IntegerField(default=20, validators=[MinValueValidator(0), MaxValueValidator(100)])
    auto_allocate    = models.BooleanField(default=False)
    last_synced      = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = ('marina', 'slug')
        ordering = ['name']

    def __str__(self):
        return f'{self.name} ({self.marina})'


AMENITY_SLUGS = {'power_30a', 'power_50a', 'water', 'wifi', 'fuel_nearby', 'pump_out'}


class BerthCategory(models.Model):
    MOORING_CHOICES = [
        ('finger',       'Finger Pontoon'),
        ('alongside',    'Alongside'),
        ('stern_to',     'Stern-to'),
        ('mooring_ball', 'Mooring Ball'),
    ]
    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='berth_categories')
    name         = models.CharField(max_length=100)
    tagline      = models.CharField(max_length=200, blank=True)
    description  = models.TextField(blank=True)
    highlights   = models.JSONField(default=list, blank=True)
    mooring_type = models.CharField(max_length=20, choices=MOORING_CHOICES, default='finger')
    amenities    = models.JSONField(default=list)
    pricing_tier = models.ForeignKey(
        'billing.ChargeableItem',
        on_delete=models.PROTECT,
        limit_choices_to={'category': 'berth'},
        null=True, blank=True,
        related_name='berth_categories',
    )
    sort_order = models.IntegerField(default=0)
    is_active  = models.BooleanField(default=True)

    class Meta:
        ordering = ['sort_order', 'name']
        unique_together = ('marina', 'name')

    def clean(self):
        from django.core.exceptions import ValidationError
        bad = [s for s in (self.amenities or []) if s not in AMENITY_SLUGS]
        if bad:
            raise ValidationError({'amenities': f'Unknown amenity slug(s): {bad}. Allowed: {sorted(AMENITY_SLUGS)}'})

    def __str__(self):
        return f'{self.name} ({self.marina})'


class Pier(models.Model):
    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='piers')
    code           = models.CharField(max_length=50)
    label          = models.CharField(max_length=50, blank=True)
    polygon_points = models.JSONField(default=list)
    pier_type      = models.CharField(max_length=20, choices=PIER_TYPE_CHOICES, default='concrete')
    ghost_slots    = models.JSONField(default=list)
    # ghost_slots format: [{ x, y, rotation, width_m, height_m }, ...]
    # Removed when a real berth is dropped on the slot.
    # Canvas layout fields (center-origin, grid units)
    canvas_x = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    canvas_y = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    canvas_w = models.FloatField(default=2)
    canvas_h = models.FloatField(default=10)
    rotation = models.IntegerField(default=0)
    display_name  = models.CharField(max_length=100, blank=True, default='')
    logical_pier  = models.ForeignKey(
        LogicalPier, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='dock_shapes'
    )
    components    = models.JSONField(default=list)
    # components format: [{"id": "c_9f8a2", "type": "spine"|"finger", "ox": 0, "oy": 0, "w": 10, "h": 2}]
    # ox/oy = offset from pier canvas_x/canvas_y at rotation=0 (grid units, center-based)

    class Meta:
        unique_together = ('marina', 'code')
        ordering = ['code']

    def clean(self):
        from django.core.exceptions import ValidationError
        pts = self.polygon_points
        if pts:
            if not isinstance(pts, list) or len(pts) < 3:
                raise ValidationError({'polygon_points': 'A polygon requires at least 3 points.'})
            if not all(isinstance(p, (list, tuple)) and len(p) == 2 for p in pts):
                raise ValidationError({'polygon_points': 'Each point must be [x, y].'})
        if self.rotation % 45 != 0:
            raise ValidationError({'rotation': 'Rotation must be a multiple of 45 degrees.'})

    def __str__(self):
        return f'{self.marina} — Pier {self.code}'


class Berth(models.Model):
    STATUS_CHOICES = [
        ('available', 'Available'),
        ('occupied', 'Occupied'),
        ('reserved', 'Reserved'),
        ('maintenance', 'Maintenance'),
    ]
    SIDE_CHOICES = [
        ('port', 'Port'),
        ('starboard', 'Starboard'),
    ]
    BERTH_CLASS_CHOICES = [
        ('standard',    'Standard'),
        ('operational', 'Operational'),
    ]
    OPERATIONAL_TYPE_CHOICES = [
        ('',          '—'),
        ('fuel_dock', 'Fuel Dock'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='berths')
    pier   = models.ForeignKey(Pier, on_delete=models.SET_NULL, related_name='berths',
                               null=True, blank=True)   # null = unplaced on canvas
    code           = models.CharField(max_length=10)
    pier_label     = models.CharField(
        max_length=50, blank=True,
        help_text=(
            'Human-readable pier label set by the map editor pier-grouping tool. '
            'Used by access_control.ZoneAccessRule(link_to_berth_pier=True) to match '
            'a member\'s berth to an AccessZone by name.'
        ),
    )
    berth_type     = models.CharField(max_length=50, blank=True, default='')
    berth_class      = models.CharField(max_length=20, choices=BERTH_CLASS_CHOICES, default='standard')
    operational_type = models.CharField(max_length=30, choices=OPERATIONAL_TYPE_CHOICES, blank=True, default='')
    side           = models.CharField(max_length=10, choices=SIDE_CHOICES, default='port')
    position_index = models.IntegerField(default=0)
    length_m       = models.DecimalField(max_digits=6, decimal_places=1, null=True, blank=True)
    max_draft_m    = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    max_beam_m     = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    amenities      = models.JSONField(default=list, blank=True)
    pricing_tier = models.ForeignKey(
        'billing.ChargeableItem',
        on_delete=models.PROTECT,
        limit_choices_to={'category': 'berth'},
        related_name='berths',
        null=True,
        blank=True,
    )
    status  = models.CharField(max_length=20, choices=STATUS_CHOICES, default='available')
    vessel  = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL,
                                null=True, blank=True, related_name='current_berth')
    # Canvas layout fields (local to parent pier, grid units, center-based)
    local_x            = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    local_y            = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    position_on_parent = models.CharField(max_length=50, blank=True, default='')
    # For compound piers: stores component UUID (e.g. "c_1b3e7")
    # For simple piers: empty string

    ota_connection = models.ForeignKey(
        OTAConnection, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='berths'
    )
    channel_locked = models.BooleanField(default=False)
    category = models.ForeignKey(
        BerthCategory,
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='berths',
    )
    # Track 2 — air draft clearance (amber warning only, never a hard exclusion)
    max_air_draft_m = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True,
        help_text=(
            'Standard bridge/powerline clearance in metres at mid-tide. '
            'Vessels exceeding this are flagged with an amber warning, not hard-excluded.'
        ),
    )
    # Track 1 — revenue intelligence yield tier
    booking_tier = models.ForeignKey(
        'revenue_intelligence.BookingTier',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='berths',
    )
    # Track 10 — berth ownership / marketplace
    owner = models.ForeignKey(
        'members.Member',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='owned_berths',
    )
    lease_expiry = models.DateField(null=True, blank=True)

    class Meta:
        unique_together = ('marina', 'code')
        ordering = ['pier__code', 'position_index']

    def __str__(self):
        return f'Berth {self.code} ({self.marina})'


class Amenity(models.Model):
    AMENITY_TYPES = [
        ('harbour_master', 'Harbour Master'),
        ('fuel',           'Fuel Pump'),
        ('toilets',        'Toilets'),
        ('showers',        'Showers'),
        ('restaurant',     'Restaurant'),
        ('parking',        'Parking'),
        ('electricity',    'Electricity'),
        ('water',          'Water'),
        ('gate',           'Security Gate'),
        ('waste',          'Waste Disposal'),
        ('chandlery',      'Chandlery'),
        ('first_aid',      'First Aid'),
    ]
    marina   = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='amenities')
    type     = models.CharField(max_length=30, choices=AMENITY_TYPES)
    label    = models.CharField(max_length=100, blank=True)
    canvas_x = models.FloatField(null=True, blank=True)
    canvas_y = models.FloatField(null=True, blank=True)
    scale    = models.FloatField(default=1.0)
    rotation = models.FloatField(default=0)

    class Meta:
        ordering = ['type']

    def __str__(self):
        return f'{self.get_type_display()} ({self.marina})'


class MarinaMapConfig(models.Model):
    marina = models.OneToOneField('accounts.Marina', on_delete=models.CASCADE, related_name='map_config')
    config = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'Map config — {self.marina}'


# ── Track 2 — Berth Intelligence models ───────────────────────────────────────

class BerthScoreWeights(models.Model):
    """
    Per-marina tuning knobs for SmartBerthScorer.
    The four weights must always sum to 100 — enforced by clean().
    A default row is auto-created for every marina via data migration.
    """
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
            raise ValidationError(
                f'Score weights must sum to 100 (got {total}).'
            )

    def __str__(self):
        return f'Score weights — {self.marina}'


class BerthAlert(models.Model):
    """
    Operational alert raised by dock walk discrepancy detection or the
    check_non_returns background task.  Separate audit trail from VesselMovement.
    Coast guard fields are only populated by the explicit staff API action.
    """
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
    marina     = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                   related_name='berth_alerts')
    alert_type = models.CharField(max_length=30, choices=TYPE_CHOICES)
    status     = models.CharField(max_length=20, choices=STATUS_CHOICES, default='open')
    berth      = models.ForeignKey('berths.Berth', on_delete=models.SET_NULL,
                                   null=True, blank=True, related_name='alerts')
    vessel     = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL,
                                   null=True, blank=True, related_name='berth_alerts')
    departure  = models.ForeignKey('berths.TemporaryDeparture', on_delete=models.SET_NULL,
                                   null=True, blank=True, related_name='alerts')
    detail     = models.TextField(blank=True)
    resolved_at  = models.DateTimeField(null=True, blank=True)
    resolved_by  = models.ForeignKey('accounts.User', on_delete=models.SET_NULL,
                                     null=True, blank=True, related_name='resolved_alerts')
    # Coast guard escalation — only populated by the explicit staff API action,
    # never by the check_non_returns background task.
    coastguard_report_text  = models.TextField(blank=True)
    coastguard_escalated_at = models.DateTimeField(null=True, blank=True)
    coastguard_escalated_by = models.ForeignKey(
        'accounts.User', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='coastguard_escalations',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.get_alert_type_display()} — {self.status} ({self.marina})'


class TemporaryDeparture(models.Model):
    """
    Tracks when a berth holder temporarily vacates their berth.
    If sublet_enabled=True the berth can be booked by transient guests during the window,
    with revenue split between the marina and holder per revenue_share_pct.
    """
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
    status            = models.CharField(max_length=20, choices=STATUS_CHOICES, default='scheduled')
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

    def __str__(self):
        return f'Departure — {self.vessel} from {self.berth} ({self.depart_date})'


class SubLetBooking(models.Model):
    """
    Links a transient Booking to the TemporaryDeparture that opened the berth.
    Revenue split is calculated at booking creation and re-pro-rated if the
    holder returns early (inventory_collision=True).
    """
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

    def __str__(self):
        return f'SubLet — {self.booking} via {self.departure}'


class FleetAssignJob(models.Model):
    """
    Async fleet-assignment job executed by the solve_fleet_assignment Celery task.
    Created in the API view; the Celery task dispatch is wrapped in transaction.on_commit().
    """
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

    def __str__(self):
        return f'FleetAssignJob #{self.pk} — {self.status} ({self.marina})'


class DockWalkSession(models.Model):
    """
    A single dock walk audit session for one pier, conducted by one staff member.
    berth_order stores the physical walk order (berth PKs sorted by position_index).
    """
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

    def __str__(self):
        return f'DockWalk — {self.pier} @ {self.started_at:%Y-%m-%d %H:%M}'


class DockWalkEntry(models.Model):
    """
    Individual berth observation recorded during a DockWalkSession.
    Discrepancy detection runs server-side when entries are bulk-submitted.
    """
    OCCUPANCY_CHOICES = [
        ('occupied', 'Occupied'),
        ('empty',    'Empty'),
        ('unknown',  'Unknown'),
    ]
    DISCREPANCY_CHOICES = [
        ('none',              'None'),
        ('unexpected_empty',  'Unexpected Empty'),
        ('unexpected_vessel', 'Unexpected Vessel'),
        ('overstay',          'Overstay'),
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
    alert                = models.ForeignKey(
        BerthAlert, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='dock_walk_entries',
    )

    class Meta:
        ordering = ['session', 'berth__position_index']
        unique_together = ('session', 'berth')

    def __str__(self):
        return f'Entry — {self.berth} @ {self.observed_at:%H:%M} ({self.observed_occupancy})'


class BerthListing(models.Model):
    """
    A berth listed for sale via the DocksBase marketplace.
    Commission invoice auto-generated when status transitions to 'sold'.
    """
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

    def __str__(self):
        return f'Listing — {self.berth} ({self.status})'


class BerthListingEnquiry(models.Model):
    """
    Enquiry submitted against a BerthListing by a portal-authenticated boater or guest.
    Seller PII is never exposed to the enquirer via the portal serializer.
    """
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

    def __str__(self):
        return f'Enquiry — {self.listing} from {self.enquirer_name or self.enquirer_email}'
