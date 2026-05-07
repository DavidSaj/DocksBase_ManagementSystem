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
    description  = models.TextField(blank=True)
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
