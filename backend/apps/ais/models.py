from django.db import models


class VesselPosition(models.Model):
    """
    Latest known AIS position for a vessel within a marina's tracking area.
    Upserted on every poll cycle; one row per (marina, mmsi).
    """

    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='ais_positions',
    )
    mmsi = models.CharField(max_length=20, db_index=True)
    vessel = models.ForeignKey(
        'vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='ais_positions',
        help_text='Set when MMSI matches a known marina vessel.',
    )

    lat         = models.DecimalField(max_digits=9, decimal_places=6)
    lng         = models.DecimalField(max_digits=9, decimal_places=6)
    speed_kn    = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    course_deg  = models.IntegerField(null=True, blank=True)
    heading_deg = models.IntegerField(null=True, blank=True)
    nav_status  = models.CharField(max_length=30, blank=True)

    reported_at = models.DateTimeField()
    received_at = models.DateTimeField(auto_now=True)
    source      = models.CharField(max_length=30, default='marinetraffic')

    # Set by event detection (Phase 2). Phase 1 always leaves this False.
    in_basin    = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['marina', 'mmsi'],
                name='ais_position_marina_mmsi_uniq',
            ),
        ]
        indexes = [
            models.Index(fields=['marina', '-reported_at'],
                         name='ais_pos_marina_reported_idx'),
        ]

    def __str__(self):
        return f'{self.mmsi} @ {self.lat},{self.lng}'
