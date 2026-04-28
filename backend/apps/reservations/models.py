from django.db import models


class Booking(models.Model):
    TYPE_CHOICES = [
        ('transient', 'Transient'),
        ('seasonal', 'Seasonal'),
    ]
    STATUS_CHOICES = [
        ('pending',     'Pending'),
        ('checked_in',  'Checked In'),
        ('checked_out', 'Checked Out'),
        ('overstay',    'Overstay'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='bookings')
    berth = models.ForeignKey('berths.Berth', on_delete=models.PROTECT, related_name='bookings')
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.PROTECT, related_name='bookings')
    booking_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='transient')
    check_in = models.DateField()
    check_out = models.DateField()
    nights = models.IntegerField(default=1)
    amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    paid = models.BooleanField(default=False)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'BK-{self.pk} — {self.vessel} @ {self.berth}'
