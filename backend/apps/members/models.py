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
    boater_user = models.OneToOneField(
        'accounts.User',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='member_profile',
    )

    # Contact
    preferred_name = models.CharField(max_length=100, blank=True)
    nationality = models.CharField(max_length=100, blank=True)
    address = models.TextField(blank=True)
    address_country = models.CharField(max_length=100, blank=True)

    # Emergency contact
    emergency_name = models.CharField(max_length=200, blank=True)
    emergency_relationship = models.CharField(max_length=100, blank=True)
    emergency_phone = models.CharField(max_length=50, blank=True)

    # Sub-letting consent (Track 2 — Berth Intelligence)
    sublet_opt_in = models.BooleanField(
        default=False,
        help_text='Holder consents to berth being sub-let during temporary absences.',
    )

    # Track 3 — Customer Intelligence
    is_archived = models.BooleanField(default=False)
    merged_into = models.ForeignKey(
        'self', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='archived_duplicates',
    )

    # Track 7 — Communications
    whatsapp_opt_in = models.BooleanField(
        default=False,
        help_text='Member has opted in to receive WhatsApp messages.',
    )

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


# ── Track 3 additions ─────────────────────────────────────────────────────────

class DuplicateFlag(models.Model):
    class MatchRule(models.TextChoices):
        EMAIL = 'email', 'Matching Email'
        PHONE = 'phone', 'Matching Phone'
        VESSEL_NAME = 'vessel_name', 'Vessel Name + Similar Member Name'

    class Status(models.TextChoices):
        PENDING = 'pending', 'Pending Review'
        MERGED = 'merged', 'Merged'
        DISMISSED = 'dismissed', 'Dismissed (Not a Duplicate)'

    marina     = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='duplicate_flags')
    member_a   = models.ForeignKey('Member', on_delete=models.CASCADE, related_name='duplicate_flags_as_a')
    member_b   = models.ForeignKey('Member', on_delete=models.CASCADE, related_name='duplicate_flags_as_b')
    match_rule = models.CharField(max_length=30, choices=MatchRule.choices)
    status     = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    reviewed_by = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='reviewed_duplicate_flags',
    )
    reviewed_at = models.DateTimeField(null=True, blank=True)
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('member_a', 'member_b')]
        ordering = ['-created_at']

    def __str__(self):
        return f'DuplicateFlag {self.pk}: {self.member_a} / {self.member_b} ({self.status})'


class SecondaryContact(models.Model):
    class Routing(models.TextChoices):
        INVOICES  = 'invoices',  'Invoices'
        GENERAL   = 'general',   'General Correspondence'
        EMERGENCY = 'emergency', 'Emergency'

    marina   = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='secondary_contacts')
    member   = models.ForeignKey('Member', on_delete=models.CASCADE, related_name='secondary_contacts')
    vessel   = models.ForeignKey(
        'vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='secondary_contacts',
    )
    name     = models.CharField(max_length=200)
    role     = models.CharField(max_length=100, blank=True)
    email    = models.EmailField(blank=True)
    phone    = models.CharField(max_length=30, blank=True)
    routing  = models.CharField(max_length=20, choices=Routing.choices, default=Routing.GENERAL)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.name} ({self.get_routing_display()}) — {self.member}'


class LeadScore(models.Model):
    marina  = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='lead_scores')
    member  = models.OneToOneField('Member', on_delete=models.CASCADE, related_name='lead_score')
    score   = models.IntegerField(default=0)
    portal_login_30d   = models.BooleanField(default=False)
    email_opens_30d    = models.IntegerField(default=0)
    booking_widget_14d = models.BooleanField(default=False)
    vessel_loa_match   = models.BooleanField(default=False)
    recalculated_at    = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-score']

    def __str__(self):
        return f'LeadScore {self.score} — {self.member}'


class SurveyResponse(models.Model):
    marina    = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='survey_responses')
    member    = models.ForeignKey('Member', on_delete=models.CASCADE, related_name='survey_responses')
    booking   = models.ForeignKey(
        'reservations.Booking', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='survey_responses',
    )
    nps_score  = models.IntegerField()
    comments   = models.TextField(blank=True)
    alert_sent = models.BooleanField(default=False)
    token_used = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'NPS {self.nps_score} — {self.member}'
