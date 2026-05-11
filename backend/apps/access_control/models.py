"""
apps/access_control/models.py

Track 11 — Security & Physical Access Control
All 13 models in FK-dependency order.

Key invariants:
- AccessCard.member FK is NEVER changed on an existing row. Card recycling creates
  a new row (new PK), preserving the AccessEvent audit chain.
- BiometricEnrolment with pending_deletion=True is invisible to the default manager;
  physical terminal wipe is async via Celery.
- Hardware revoke is ALWAYS dispatched inside transaction.on_commit(), never inline.
- All endpoints filter by request.user.marina.
"""

from apps.accounting.fields import EncryptedCharField

from django.db import models

from apps.members.models import Member


# ---------------------------------------------------------------------------
# 1. AccessZone
# ---------------------------------------------------------------------------

class AccessZone(models.Model):
    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='access_zones')
    name          = models.CharField(max_length=100)   # e.g. "Pier A", "Shower Block"
    description   = models.CharField(max_length=300, blank=True)
    is_restricted = models.BooleanField(default=False)  # True = staff-only areas

    class Meta:
        ordering        = ['name']
        unique_together = ['marina', 'name']

    def __str__(self):
        return self.name


# ---------------------------------------------------------------------------
# 2. AccessReader
# ---------------------------------------------------------------------------

class AccessReader(models.Model):
    HARDWARE_TYPE = [
        ('rfid',      'RFID/NFC Reader'),
        ('anpr',      'ANPR Camera'),
        ('biometric', 'Biometric Terminal'),
        ('keypad',    'PIN Keypad'),
    ]

    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='access_readers')
    zone           = models.ForeignKey(AccessZone, on_delete=models.PROTECT, related_name='readers')
    reader_uid     = models.CharField(max_length=100)
    location_label = models.CharField(max_length=200)
    hardware_type  = models.CharField(max_length=20, choices=HARDWARE_TYPE, default='rfid')
    ip_address     = models.GenericIPAddressField(null=True, blank=True)
    last_heartbeat = models.DateTimeField(null=True, blank=True)
    is_active      = models.BooleanField(default=True)
    notes          = models.TextField(blank=True)

    class Meta:
        unique_together = ['marina', 'reader_uid']

    def __str__(self):
        return f"{self.location_label} ({self.reader_uid})"


# ---------------------------------------------------------------------------
# 3. ZoneAccessRule
# ---------------------------------------------------------------------------

class ZoneAccessRule(models.Model):
    marina             = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='zone_rules')
    member_type        = models.CharField(max_length=20, choices=Member.TYPE_CHOICES)
    zones              = models.ManyToManyField(AccessZone, blank=True, related_name='rules')
    link_to_berth_pier = models.BooleanField(
        default=False,
        help_text=(
            "When True, ignore zones M2M. Instead check whether the member's active "
            "Booking/Contract berth pier_label matches the AccessZone name."
        ),
    )
    allowed_piers      = models.JSONField(
        default=list,
        blank=True,
        help_text=(
            "Explicit pier label allow-list when link_to_berth_pier=True and you want "
            "to restrict to a subset of piers regardless of the member's berth assignment. "
            "Empty list = all piers permitted (berth assignment is the only gate)."
        ),
    )

    class Meta:
        unique_together = ['marina', 'member_type']

    def __str__(self):
        return f"{self.marina} — {self.member_type}"


# ---------------------------------------------------------------------------
# 4. AccessCard
# ---------------------------------------------------------------------------

class AccessCard(models.Model):
    SUBTYPE_CHOICES = [
        ('owner',      'Owner'),
        ('crew',       'Crew'),
        ('family',     'Family'),
        ('contractor', 'Contractor'),
    ]

    marina              = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='access_cards')
    # INVARIANT: member FK is NEVER changed on an existing row.
    # Recycled plastic cards get a NEW AccessCard row (new PK).
    member              = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='access_cards')
    card_uid            = models.CharField(max_length=100)       # Physical RFID card UID (hex)
    facility_code       = models.CharField(max_length=20, blank=True)
    label               = models.CharField(max_length=100, blank=True)  # "Owner card", "Crew — John"
    sub_type            = models.CharField(max_length=20, choices=SUBTYPE_CHOICES, default='owner')
    is_active           = models.BooleanField(default=False)     # Activated on contract start
    zones_override      = models.ManyToManyField(
        AccessZone, blank=True, related_name='card_overrides',
        help_text="If set, overrides ZoneAccessRule for this card only.",
    )
    valid_from          = models.DateField(null=True, blank=True)
    valid_to            = models.DateField(null=True, blank=True)
    issued_at           = models.DateTimeField(auto_now_add=True)
    deactivated_at      = models.DateTimeField(null=True, blank=True)
    deactivation_reason = models.CharField(max_length=200, blank=True)

    class Meta:
        # Only one ACTIVE card per (marina, card_uid) is permitted.
        # Inactive/historical duplicates are allowed to preserve the audit trail.
        constraints = [
            models.UniqueConstraint(
                fields=['marina', 'card_uid'],
                condition=models.Q(is_active=True),
                name='unique_active_card_uid_per_marina',
            )
        ]

    def __str__(self):
        return f"{self.member.name} — {self.label or self.card_uid}"


# ---------------------------------------------------------------------------
# 5. CCTVCamera (defined before AccessEvent which references it)
# ---------------------------------------------------------------------------

class CCTVCamera(models.Model):
    marina               = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='cctv_cameras')
    zone                 = models.ForeignKey(AccessZone, on_delete=models.PROTECT, related_name='cctv_cameras')
    camera_uid           = models.CharField(max_length=100)   # NVR channel or RTSP stream ID
    location_label       = models.CharField(max_length=200)
    nvr_ip               = models.GenericIPAddressField(null=True, blank=True)
    nvr_channel          = models.IntegerField(null=True, blank=True)
    viewer_url_template  = models.CharField(
        max_length=500, blank=True,
        help_text="URL template. Use {timestamp_iso} and {camera_uid} as placeholders.",
    )
    is_active            = models.BooleanField(default=True)

    class Meta:
        unique_together = ['marina', 'camera_uid']

    def __str__(self):
        return f"{self.location_label} ({self.camera_uid})"


# ---------------------------------------------------------------------------
# 6. AccessEvent  (immutable audit log)
# ---------------------------------------------------------------------------

class AccessEvent(models.Model):
    CREDENTIAL_TYPE = [
        ('card',  'RFID Card'),
        ('face',  'Biometric Face'),
        ('anpr',  'ANPR Plate'),
        ('pin',   'PIN Code'),
    ]

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='access_events')
    reader          = models.ForeignKey(AccessReader, on_delete=models.SET_NULL, null=True, related_name='events')
    credential_type = models.CharField(max_length=10, choices=CREDENTIAL_TYPE)
    card            = models.ForeignKey(AccessCard, on_delete=models.SET_NULL, null=True, blank=True, related_name='events')
    member          = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='access_events')
    raw_credential  = models.CharField(
        max_length=100, blank=True,
        help_text="Card UID, plate string, or 'biometric'. Never raw biometric data.",
    )
    granted         = models.BooleanField()
    denial_reason   = models.CharField(max_length=200, blank=True)
    occurred_at     = models.DateTimeField(db_index=True)
    cctv_cameras    = models.ManyToManyField(CCTVCamera, blank=True, related_name='access_events')

    class Meta:
        ordering = ['-occurred_at']
        indexes  = [
            models.Index(fields=['marina', 'occurred_at']),
            models.Index(fields=['marina', 'member', 'occurred_at']),
            models.Index(fields=['marina', 'reader', 'occurred_at']),
        ]

    def __str__(self):
        status = 'GRANTED' if self.granted else 'DENIED'
        return f"[{status}] {self.occurred_at:%Y-%m-%d %H:%M} — {self.reader}"


# ---------------------------------------------------------------------------
# 7. ANPRCamera
# ---------------------------------------------------------------------------

class ANPRCamera(models.Model):
    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='anpr_cameras')
    zone           = models.ForeignKey(AccessZone, on_delete=models.PROTECT, related_name='anpr_cameras')
    camera_uid     = models.CharField(max_length=100)
    location_label = models.CharField(max_length=200)
    ip_address     = models.GenericIPAddressField(null=True, blank=True)
    last_frame_at  = models.DateTimeField(null=True, blank=True)
    is_active      = models.BooleanField(default=True)

    class Meta:
        unique_together = ['marina', 'camera_uid']

    def __str__(self):
        return f"{self.location_label} ({self.camera_uid})"


# ---------------------------------------------------------------------------
# 8. VehicleRegistration
# ---------------------------------------------------------------------------

class VehicleRegistration(models.Model):
    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='vehicle_registrations')
    member        = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='vehicles')
    plate_number  = models.CharField(max_length=20)   # Normalised: uppercase, no spaces
    make          = models.CharField(max_length=100, blank=True)
    model         = models.CharField(max_length=100, blank=True)
    colour        = models.CharField(max_length=50, blank=True)
    is_active     = models.BooleanField(default=True)
    registered_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ['marina', 'plate_number']

    def save(self, *args, **kwargs):
        self.plate_number = self.plate_number.upper().replace(' ', '')
        super().save(*args, **kwargs)

    def __str__(self):
        return f"{self.plate_number} — {self.member.name}"


# ---------------------------------------------------------------------------
# 9. ANPREvent  (immutable audit log)
# ---------------------------------------------------------------------------

class ANPREvent(models.Model):
    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='anpr_events')
    camera         = models.ForeignKey(ANPRCamera, on_delete=models.SET_NULL, null=True, related_name='events')
    plate_detected = models.CharField(max_length=20)
    vehicle        = models.ForeignKey(VehicleRegistration, on_delete=models.SET_NULL, null=True, blank=True, related_name='anpr_events')
    matched_member = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='anpr_events')
    access_granted = models.BooleanField()
    confidence     = models.FloatField(default=1.0)
    occurred_at    = models.DateTimeField(db_index=True)
    staff_reviewed = models.BooleanField(default=False)
    staff_reviewer = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='reviewed_anpr_events',
    )

    class Meta:
        ordering = ['-occurred_at']
        indexes  = [
            models.Index(fields=['marina', 'occurred_at']),
            models.Index(fields=['marina', 'plate_detected']),
        ]

    def __str__(self):
        return f"ANPR {self.plate_detected} @ {self.occurred_at:%Y-%m-%d %H:%M}"


# ---------------------------------------------------------------------------
# 10. BiometricEnrolmentManager + BiometricEnrolment
# ---------------------------------------------------------------------------

class BiometricEnrolmentManager(models.Manager):
    """Default manager — excludes rows pending GDPR deletion."""
    def get_queryset(self):
        return super().get_queryset().filter(pending_deletion=False)


class BiometricEnrolment(models.Model):
    """
    Stores ONLY an opaque encrypted template handle from the biometric terminal SDK.
    No raw biometric data, no facial images, no feature vectors stored in DocksBase.
    Schema defined now; terminal SDK integration deferred to v2.
    """
    SUBJECT_TYPE   = [('member', 'Member'), ('staff', 'Staff')]
    CONSENT_METHOD = [
        ('portal',    'Boater Portal'),
        ('staff_app', 'Staff App'),
        ('admin',     'Admin UI'),
    ]

    marina                = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='biometric_enrolments')
    subject_type          = models.CharField(max_length=10, choices=SUBJECT_TYPE)
    member                = models.OneToOneField(
        'members.Member', on_delete=models.CASCADE,
        null=True, blank=True, related_name='biometric_enrolment',
    )
    staff_member          = models.OneToOneField(
        'staff.StaffMember', on_delete=models.CASCADE,
        null=True, blank=True, related_name='biometric_enrolment',
    )
    terminal_uid          = models.CharField(max_length=100)
    # Opaque SDK handle — never raw biometric data
    template_handle       = EncryptedCharField(max_length=500)
    consent_given_at      = models.DateTimeField()
    consent_ip            = models.GenericIPAddressField(null=True, blank=True)
    consent_method        = models.CharField(max_length=20, choices=CONSENT_METHOD)
    enrolled_at           = models.DateTimeField(auto_now_add=True)
    revoked_at            = models.DateTimeField(null=True, blank=True)

    # GDPR Art. 17 resilient deletion fields
    pending_deletion       = models.BooleanField(
        default=False,
        help_text="Set True immediately on DELETE. Hidden from all UI via default manager.",
    )
    pending_deletion_since = models.DateTimeField(
        null=True, blank=True,
        help_text="Timestamp of DELETE request. Task escalates after 24h stall.",
    )

    objects     = BiometricEnrolmentManager()  # excludes pending_deletion=True
    all_objects = models.Manager()             # unfiltered — Celery deletion task only

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(subject_type='member', member__isnull=False, staff_member__isnull=True) |
                    models.Q(subject_type='staff',  staff_member__isnull=False, member__isnull=True)
                ),
                name='biometric_enrolment_subject_consistency',
            )
        ]

    def __str__(self):
        subject = self.member or self.staff_member
        return f"BiometricEnrolment — {subject} @ {self.terminal_uid}"


# ---------------------------------------------------------------------------
# 11. SpendAuthorisationRule
# ---------------------------------------------------------------------------

class SpendAuthorisationRule(models.Model):
    ACTION_CHOICES = [
        ('discount',  'Discount'),
        ('write_off', 'Write-off'),
        ('refund',    'Refund'),
        ('override',  'Price Override'),
    ]
    ROLE_CHOICES = [
        ('staff',   'Staff'),
        ('manager', 'Manager'),
        ('owner',   'Owner'),
    ]

    marina                 = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='spend_rules')
    role                   = models.CharField(max_length=20, choices=ROLE_CHOICES)
    action_type            = models.CharField(max_length=20, choices=ACTION_CHOICES)
    threshold_amount       = models.DecimalField(max_digits=10, decimal_places=2)
    requires_approver_role = models.CharField(
        max_length=20,
        choices=[('manager', 'Manager'), ('owner', 'Owner')],
    )

    class Meta:
        unique_together = ['marina', 'role', 'action_type']

    def __str__(self):
        return f"{self.marina} — {self.role}/{self.action_type} > £{self.threshold_amount}"


# ---------------------------------------------------------------------------
# 12. FraudAnomalyAlert  (defined before SpendAuthorisationRequest which FKs to it)
# ---------------------------------------------------------------------------

class FraudAnomalyAlert(models.Model):
    ALERT_TYPE = [
        ('repeated_discount',          'Repeated Discounts'),
        ('large_write_off',            'Large Write-off'),
        ('unusual_refund',             'Unusual Refund Pattern'),
        ('after_hours_sale',           'After-hours Sale'),
        ('forced_override',            'Force-approved spend — retrospective sign-off required'),
        ('biometric_deletion_stalled', 'Biometric terminal unreachable — GDPR deletion pending > 24 h'),
        ('duplicate_card',             'Duplicate Active Card Detected'),
        ('unusual_spend',              'Unusual Spend Pattern'),
    ]

    marina             = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='fraud_alerts')
    alert_type         = models.CharField(max_length=30, choices=ALERT_TYPE)
    staff_member       = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL,
        null=True, related_name='fraud_alerts',
    )
    period_start       = models.DateTimeField()
    period_end         = models.DateTimeField()
    event_count        = models.IntegerField()
    total_amount       = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    threshold_exceeded = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    sent_at            = models.DateTimeField(auto_now_add=True)
    resolved_at        = models.DateTimeField(null=True, blank=True)
    resolved_by        = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='resolved_fraud_alerts',
    )
    resolution_note    = models.TextField(blank=True)

    class Meta:
        ordering = ['-sent_at']

    def __str__(self):
        return f"[{self.alert_type}] {self.marina} — {self.sent_at:%Y-%m-%d}"


# ---------------------------------------------------------------------------
# 13. SpendAuthorisationRequest
# ---------------------------------------------------------------------------

class SpendAuthorisationRequest(models.Model):
    STATUS_CHOICES = [
        ('pending',    'Pending — POS terminal blocked'),
        ('suspended',  'Parked — terminal freed, awaiting manager'),
        ('overridden', 'Force-approved by staff — retrospective sign-off required'),
        ('approved',   'Approved'),
        ('denied',     'Denied'),
        ('expired',    'Expired'),
    ]

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='spend_requests')
    rule          = models.ForeignKey(SpendAuthorisationRule, on_delete=models.PROTECT, related_name='requests')
    action_type   = models.CharField(max_length=20, choices=SpendAuthorisationRule.ACTION_CHOICES)
    amount        = models.DecimalField(max_digits=10, decimal_places=2)
    description   = models.TextField()
    requested_by  = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL,
        null=True, related_name='spend_requests_made',
    )
    approver      = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='spend_requests_actioned',
    )
    status        = models.CharField(max_length=12, choices=STATUS_CHOICES, default='pending')
    requested_at  = models.DateTimeField(auto_now_add=True)
    actioned_at   = models.DateTimeField(null=True, blank=True)
    approver_note = models.TextField(blank=True)

    # Path A — Park Transaction
    suspended_at  = models.DateTimeField(null=True, blank=True)

    # Path B — Force Override
    override_forced_by   = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='forced_spend_overrides',
    )
    override_forced_at   = models.DateTimeField(null=True, blank=True)
    override_fraud_alert = models.OneToOneField(
        FraudAnomalyAlert, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='spend_override_request',
    )

    # Financial document references — explicit FKs, no GFK
    invoice         = models.ForeignKey(
        'billing.Invoice', on_delete=models.CASCADE,
        null=True, blank=True, related_name='spend_requests',
    )
    fuel_dock_entry = models.ForeignKey(
        'fuel_dock.FuelDockEntry', on_delete=models.CASCADE,
        null=True, blank=True, related_name='spend_requests',
    )
    # NOTE: apps/sales/models.py currently has no Sale/POSOrder model (only Listing and Lead).
    # This FK is commented out pending the POS feature track. When a POS model is added,
    # uncomment and create a migration.
    # pos_order = models.ForeignKey(
    #     'sales.Sale', on_delete=models.CASCADE,
    #     null=True, blank=True, related_name='spend_requests',
    # )

    class Meta:
        ordering = ['-requested_at']
        constraints = [
            models.CheckConstraint(
                condition=(
                    models.Q(invoice__isnull=False) |
                    models.Q(fuel_dock_entry__isnull=False)
                    # | models.Q(pos_order__isnull=False)  # uncomment when POS model exists
                ),
                name='spend_auth_requires_financial_reference',
            )
        ]

    def __str__(self):
        return f"SpendRequest #{self.pk} [{self.status}] £{self.amount}"
