from django.db import models


class Event(models.Model):
    STATUS = [('upcoming', 'Upcoming'), ('active', 'Active'), ('completed', 'Completed'), ('cancelled', 'Cancelled')]
    TYPE = [('race', 'Race'), ('rally', 'Rally'), ('social', 'Social'), ('corporate', 'Corporate'), ('other', 'Other')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='events')
    name = models.CharField(max_length=300)
    event_type = models.CharField(max_length=20, choices=TYPE, default='other')
    location = models.CharField(max_length=200, blank=True)
    organiser = models.CharField(max_length=200, blank=True)
    contact = models.CharField(max_length=200, blank=True)
    start_date = models.DateField()
    end_date = models.DateField()
    attendance = models.IntegerField(default=0)
    fleet_count = models.IntegerField(default=0)
    berths_blocked = models.IntegerField(default=0)
    status = models.CharField(max_length=20, choices=STATUS, default='upcoming')
    revenue = models.DecimalField(max_digits=10, decimal_places=2, default=0)


class VenueHire(models.Model):
    STATUS = [('available', 'Available'), ('booked', 'Booked'), ('maintenance', 'Maintenance')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='venue_hires')
    name = models.CharField(max_length=200)
    capacity_seated = models.IntegerField(default=0)
    capacity_standing = models.IntegerField(default=0)
    facilities = models.JSONField(default=list, blank=True)
    day_rate = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    hourly_rate = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS, default='available')
