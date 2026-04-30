from django.db import models
from django.core.exceptions import ValidationError


class AbsenceReport(models.Model):
    TYPE_CHOICES = [
        ('day_trip', 'Day Trip'),
        ('overnight', 'Overnight'),
        ('extended', 'Extended'),
    ]

    member  = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='absence_reports')
    absence_type = models.CharField(max_length=20, choices=TYPE_CHOICES)
    departure    = models.DateField()
    return_date  = models.DateField()
    notes        = models.TextField(blank=True)

    def clean(self):
        if self.departure and self.return_date and self.return_date < self.departure:
            raise ValidationError({'return_date': 'Return date must be on or after the departure date.'})

    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"{self.member.name} absent {self.departure}–{self.return_date}"


class CraneRequest(models.Model):
    SERVICE_CHOICES = [
        ('launch', 'Launch'),
        ('haul_out', 'Haul-out'),
        ('both', 'Launch & Haul-out'),
    ]
    STATUS_CHOICES = [
        ('requested', 'Requested'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ]

    member        = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='crane_requests')
    service_type  = models.CharField(max_length=20, choices=SERVICE_CHOICES)
    requested_date = models.DateField()
    notes         = models.TextField(blank=True)
    status        = models.CharField(max_length=20, choices=STATUS_CHOICES, default='requested')
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f"CraneRequest({self.member.name}, {self.service_type}, {self.requested_date})"
