from django.db import models


class FuelDockEntry(models.Model):
    FUEL_TYPE_CHOICES = [
        ('diesel',   'Diesel'),
        ('petrol',   'Petrol'),
        ('pump_out', 'Pump-out'),
    ]
    STATUS_CHOICES = [
        ('waiting',   'Waiting'),
        ('next',      'Next'),
        ('service',   'Service'),
        ('completed', 'Completed'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='fuel_queue')

    # Relational path
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True, related_name='fuel_entries')
    member = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='fuel_entries')

    # Free-text path
    guest_description = models.CharField(max_length=300, blank=True)
    guest_phone       = models.CharField(max_length=50,  blank=True)

    # Fuel details
    fuel_type         = models.CharField(max_length=20, choices=FUEL_TYPE_CHOICES, blank=True)
    estimated_litres  = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    actual_litres     = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    price_per_litre   = models.DecimalField(max_digits=6, decimal_places=4, null=True, blank=True)
    total_amount      = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    # Queue state
    status     = models.CharField(max_length=20, choices=STATUS_CHOICES, default='waiting')
    fuel_berth = models.ForeignKey(
        'berths.Berth',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='fuel_entries',
    )

    # Timestamps
    arrived_at    = models.DateTimeField(auto_now_add=True)
    service_start = models.DateTimeField(null=True, blank=True)
    completed_at  = models.DateTimeField(null=True, blank=True)

    # Billing outcome (mutually exclusive)
    invoice  = models.ForeignKey('billing.Invoice', on_delete=models.SET_NULL, null=True, blank=True, related_name='fuel_entries')
    pos_paid = models.BooleanField(default=False)

    class Meta:
        ordering = ['arrived_at']

    def __str__(self):
        name = self.vessel.name if self.vessel else self.guest_description
        return f'FQ-{self.pk} — {name} ({self.status})'
