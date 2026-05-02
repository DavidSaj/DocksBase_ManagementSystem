from django.db import models


PIER_TYPE_CHOICES = [
    ('concrete', 'Concrete Pier'),
    ('pontoon',  'Wooden Pontoon'),
    ('land',     'Land / Grass'),
]


class Pier(models.Model):
    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='piers')
    code           = models.CharField(max_length=50)
    label          = models.CharField(max_length=50, blank=True)
    polygon_points = models.JSONField(default=list)
    # Format: [[x1,y1],[x2,y2],...] in meters. Empty list = unmapped.
    pier_type      = models.CharField(max_length=20, choices=PIER_TYPE_CHOICES, default='concrete')
    ghost_slots    = models.JSONField(default=list)
    # ghost_slots format: [{ x, y, rotation, width_m, height_m }, ...]
    # x, y in metres (canvas origin). Removed when a real berth is dropped on the slot.

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
    pier = models.ForeignKey(Pier, on_delete=models.CASCADE, related_name='berths')
    code = models.CharField(max_length=10)
    side = models.CharField(max_length=10, choices=SIDE_CHOICES, default='port')
    position_index = models.IntegerField(default=0)
    length_m = models.DecimalField(max_digits=6, decimal_places=1, null=True, blank=True)
    max_draft_m = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    max_beam_m = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    amenities = models.JSONField(default=list, blank=True)
    price_per_night = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='available')
    canvas_x = models.FloatField(null=True, blank=True)
    canvas_y = models.FloatField(null=True, blank=True)
    canvas_rotation = models.FloatField(default=0)
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True, related_name='current_berth')

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


class MapPrefab(models.Model):
    marina         = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='prefabs',
        null=True, blank=True,
    )  # null for is_base=True prefabs
    name           = models.CharField(max_length=100)
    pier_type      = models.CharField(max_length=20, choices=PIER_TYPE_CHOICES)
    polygon_points = models.JSONField()
    # Normalized to origin: bounding box min = [0,0]. Drop offset applied at render time.
    berth_slots    = models.JSONField(default=list)
    # format: [{ x, y, rotation, width_m, height_m }, ...] — also normalized to origin
    label_template = models.CharField(max_length=50, blank=True)
    is_base        = models.BooleanField(default=False)
    created_at     = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-is_base', 'name']

    def __str__(self):
        return f'Prefab: {self.name}'
