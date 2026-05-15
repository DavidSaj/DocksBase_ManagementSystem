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
    last_transition_at = models.DateTimeField(
        null=True, blank=True,
        help_text='Last time in_basin transitioned. Used to apply hysteresis to prevent edge-flicker.',
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['marina', 'mmsi'],
                name='ais_position_marina_mmsi_uniq',
            ),
        ]
        indexes = [
            models.Index(fields=['marina', '-reported_at'],
                         name='ais_position_marina_reported_idx'),
        ]

    def __str__(self):
        return f'{self.mmsi} @ {self.lat},{self.lng}'


class AISNotificationSent(models.Model):
    """Audit row enforcing one SMS per (booking, kind) for the lifetime of a booking."""
    booking = models.ForeignKey(
        'reservations.Booking', on_delete=models.CASCADE,
        related_name='ais_notifications_sent',
    )
    kind = models.CharField(max_length=30)
    sent_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['booking', 'kind'],
                name='ais_notif_booking_kind_uniq',
            ),
        ]
