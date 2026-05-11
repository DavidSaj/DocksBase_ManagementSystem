from django.db import models


class VesselMovement(models.Model):
    """
    Immutable append-only log of physical vessel movements.
    No DELETE or general PATCH endpoints exist — only the 'complete' action
    (setting completed=True and actual_at) is permitted.

    This is a separate audit trail from BerthAlert — non-return alerts do NOT
    create movement records, and movement records do NOT create alerts.
    """
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
    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                      related_name='vessel_movements')
    vessel        = models.ForeignKey('vessels.Vessel', on_delete=models.PROTECT,
                                      related_name='movements')
    movement_type = models.CharField(max_length=20, choices=MOVEMENT_TYPES)
    berth_from    = models.ForeignKey('berths.Berth', on_delete=models.SET_NULL,
                                      null=True, blank=True, related_name='movements_from')
    berth_to      = models.ForeignKey('berths.Berth', on_delete=models.SET_NULL,
                                      null=True, blank=True, related_name='movements_to')
    booking       = models.ForeignKey('reservations.Booking', on_delete=models.SET_NULL,
                                      null=True, blank=True, related_name='movements')
    departure     = models.ForeignKey('berths.TemporaryDeparture', on_delete=models.SET_NULL,
                                      null=True, blank=True, related_name='movements')
    scheduled_at  = models.DateTimeField(null=True, blank=True)
    actual_at     = models.DateTimeField(null=True, blank=True)
    completed     = models.BooleanField(default=False)
    heading       = models.CharField(max_length=100, blank=True)
    notes         = models.TextField(blank=True)
    recorded_by   = models.ForeignKey('accounts.User', on_delete=models.SET_NULL,
                                      null=True, blank=True,
                                      related_name='recorded_movements')
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.get_movement_type_display()} — {self.vessel} ({self.created_at:%Y-%m-%d})'
