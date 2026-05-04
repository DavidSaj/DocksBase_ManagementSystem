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


class Pier(models.Model):
    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='piers')
    code           = models.CharField(max_length=10)
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

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='berths')
    pier   = models.ForeignKey(Pier, on_delete=models.SET_NULL, related_name='berths',
                               null=True, blank=True)   # null = unplaced on canvas
    code           = models.CharField(max_length=10)
    berth_type     = models.CharField(max_length=50, blank=True, default='')
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
    )
    status  = models.CharField(max_length=20, choices=STATUS_CHOICES, default='available')
    vessel  = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL,
                                null=True, blank=True, related_name='current_berth')
    # Canvas layout fields (local to parent pier, grid units, center-based)
    local_x            = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    local_y            = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    position_on_parent = models.JSONField(null=True, blank=True)
    # position_on_parent format: {"side": "port"|"starboard", "slot_index": int}

    class Meta:
        unique_together = ('marina', 'code')
        ordering = ['pier__code', 'position_index']

    def __str__(self):
        return f'Berth {self.code} ({self.marina})'


class MarinaMapConfig(models.Model):
    marina = models.OneToOneField('accounts.Marina', on_delete=models.CASCADE, related_name='map_config')
    config = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'Map config — {self.marina}'
