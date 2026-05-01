from django.db import models


class Pier(models.Model):
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='piers')
    code = models.CharField(max_length=10)
    label = models.CharField(max_length=50, blank=True)
    polygon_points = models.JSONField(
        default=list, blank=True,
        help_text='List of [x, y] pairs defining the pier polygon on the canvas',
    )

    class Meta:
        unique_together = ('marina', 'code')
        ordering = ['code']

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
    canvas_width = models.FloatField(default=4)
    canvas_height = models.FloatField(default=12)
    canvas_rotation = models.FloatField(default=0)
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True, related_name='current_berth')

    class Meta:
        unique_together = ('marina', 'code')
        ordering = ['pier__code', 'position_index']

    def __str__(self):
        return f'Berth {self.code} ({self.marina})'


class Amenity(models.Model):
    TYPE_CHOICES = [
        ('fuel', 'Fuel'),
        ('electricity', 'Electricity'),
        ('water', 'Water'),
        ('wifi', 'WiFi'),
        ('toilet', 'Toilet'),
        ('shower', 'Shower'),
        ('laundry', 'Laundry'),
        ('parking', 'Parking'),
        ('restaurant', 'Restaurant'),
        ('shop', 'Shop'),
        ('pump_out', 'Pump Out'),
        ('crane', 'Crane'),
        ('other', 'Other'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='amenities')
    label = models.CharField(max_length=100)
    type = models.CharField(max_length=30, choices=TYPE_CHOICES, default='other')
    canvas_x = models.FloatField(null=True, blank=True)
    canvas_y = models.FloatField(null=True, blank=True)
    scale = models.FloatField(default=1.0)
    rotation = models.FloatField(default=0.0)

    class Meta:
        ordering = ['label']

    def __str__(self):
        return f'{self.label} ({self.marina})'


class MarinaMapConfig(models.Model):
    marina = models.OneToOneField('accounts.Marina', on_delete=models.CASCADE, related_name='map_config')
    config = models.JSONField(default=dict)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'Map config — {self.marina}'
