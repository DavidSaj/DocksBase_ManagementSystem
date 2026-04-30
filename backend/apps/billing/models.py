from django.db import models


class Invoice(models.Model):
    TYPE_CHOICES = [
        ('berth_fee', 'Berth Fee'), ('fuel', 'Fuel'), ('utility', 'Utility'),
        ('boatyard', 'Boatyard'), ('restaurant', 'Restaurant'), ('other', 'Other'),
    ]
    STATUS_CHOICES = [
        ('paid', 'Paid'), ('unpaid', 'Unpaid'), ('overdue', 'Overdue'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='invoices')
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True, related_name='invoices')
    member = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='invoices')
    booking = models.ForeignKey('reservations.Booking', on_delete=models.SET_NULL, null=True, blank=True, related_name='invoices')
    invoice_type = models.CharField(max_length=30, choices=TYPE_CHOICES, default='berth_fee')
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    issued = models.DateField()
    due = models.DateField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='unpaid')

    class Meta:
        ordering = ['-issued']

    def __str__(self):
        return f'INV-{self.pk} ({self.status})'


class Payment(models.Model):
    METHOD_CHOICES = [
        ('card', 'Card'), ('cash', 'Cash'), ('bank_transfer', 'Bank Transfer'),
        ('marina_account', 'Marina Account'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='payments')
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='payments')
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    method = models.CharField(max_length=30, choices=METHOD_CHOICES, default='card')
    paid_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'Payment {self.pk} — {self.invoice}'
