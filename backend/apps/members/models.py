from django.db import models


class Member(models.Model):
    TYPE_CHOICES = [
        ('seasonal', 'Seasonal'),
        ('transient', 'Transient'),
        ('associate', 'Associate'),
    ]
    INSURANCE_STATUS_CHOICES = [
        ('valid', 'Valid'), ('due_soon', 'Due Soon'), ('expired', 'Expired'), ('missing', 'Missing'),
    ]
    DOCS_STATUS_CHOICES = [
        ('complete', 'Complete'), ('pending', 'Pending'), ('missing', 'Missing'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='members')
    name = models.CharField(max_length=200)
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=30, blank=True)
    member_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='seasonal')
    insurance_status = models.CharField(max_length=20, choices=INSURANCE_STATUS_CHOICES, default='valid')
    docs_status = models.CharField(max_length=20, choices=DOCS_STATUS_CHOICES, default='complete')
    joined_at = models.DateField(null=True, blank=True)
    tags = models.JSONField(default=list, blank=True)

    # Contact
    preferred_name = models.CharField(max_length=100, blank=True)
    nationality = models.CharField(max_length=100, blank=True)
    address = models.TextField(blank=True)
    address_country = models.CharField(max_length=100, blank=True)

    # Emergency contact
    emergency_name = models.CharField(max_length=200, blank=True)
    emergency_relationship = models.CharField(max_length=100, blank=True)
    emergency_phone = models.CharField(max_length=50, blank=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


# JSONField lookups (e.g. tags__contains) require lookup expressions and are excluded intentionally.
ALLOWED_SEGMENT_FILTER_KEYS = {'member_type', 'insurance_status', 'docs_status'}


class Segment(models.Model):
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='segments')
    name = models.CharField(max_length=200)
    description = models.CharField(max_length=500, blank=True)
    filter_params = models.JSONField(default=dict)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name
