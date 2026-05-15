from django.db import models
from django.conf import settings


class Notification(models.Model):
    KIND_CHOICES = [
        ('booking_request',         'Booking Request'),
        ('overdue_invoice',         'Overdue Invoice'),
        ('maintenance_assigned',    'Maintenance Assigned'),
        ('ais_auto_checkin',        'AIS Auto Check-in'),
        ('ais_auto_checkout',       'AIS Auto Check-out'),
        ('ais_no_show_predicted',   'AIS No-Show Predicted'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='notifications')
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='notifications')
    kind = models.CharField(max_length=30, choices=KIND_CHOICES)
    title = models.CharField(max_length=200)
    body = models.CharField(max_length=500)
    link_screen = models.CharField(max_length=50)
    link_id = models.IntegerField(null=True, blank=True)
    read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.kind} → {self.recipient_id}'
