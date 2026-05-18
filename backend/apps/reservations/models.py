from django.db import models


class Booking(models.Model):
    TYPE_CHOICES = [
        ('transient', 'Transient'),
        ('seasonal', 'Seasonal'),
    ]
    STATUS_CHOICES = [
        # Engine pre-operational states
        ('pending_approval', 'Pending Approval'),   # Mode A: berth=null, awaiting admin
        ('awaiting_payment', 'Awaiting Payment'),   # Mode A: berth assigned, Stripe link sent
        ('pending_payment',  'Pending Payment'),    # Mode B: berth assigned, Stripe checkout open
        ('confirmed',        'Confirmed'),           # Both modes: payment received
        # Operational states (existing)
        ('pending',      'Pending'),
        ('checked_in',   'Checked In'),
        ('checked_out',  'Checked Out'),
        ('overstay',     'Overstay'),
        ('no_show',      'No Show'),
        ('cancelled',    'Cancelled'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='bookings')
    berth = models.ForeignKey('berths.Berth', on_delete=models.PROTECT, related_name='bookings', null=True, blank=True)
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.PROTECT, related_name='bookings', null=True, blank=True)
    booking_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='transient')
    check_in = models.DateField()
    check_out = models.DateField()
    nights = models.IntegerField(default=1)
    amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    paid = models.BooleanField(default=False)
    notes = models.TextField(blank=True)

    # Guest / boater contact (set when no linked vessel/member)
    guest_name = models.CharField(max_length=200, blank=True)
    guest_email = models.EmailField(blank=True)
    guest_phone = models.CharField(max_length=50, blank=True)
    vessel_name = models.CharField(max_length=200, blank=True)
    eta = models.TimeField(null=True, blank=True)

    # Boat dimensions for berth compatibility check
    boat_loa = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    boat_beam = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    boat_draft = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    # Portal check-in fields
    waiver_envelope_id = models.CharField(max_length=255, null=True, blank=True)
    waiver_signed = models.BooleanField(default=False)
    insurance_doc = models.FileField(upload_to='insurance/', null=True, blank=True)
    pre_cleared = models.BooleanField(default=False)
    self_checked_in = models.BooleanField(default=False)
    self_checked_in_at = models.DateTimeField(null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    booking_source = models.CharField(max_length=100, default='direct', blank=True)
    mysea_event_uid = models.CharField(max_length=255, blank=True, default='')

    # Track 2 — document gate fields
    insurance_verified = models.BooleanField(default=False)
    registration_verified = models.BooleanField(default=False)
    waiver_verified = models.BooleanField(default=False)
    document_gate_cleared = models.BooleanField(default=False)
    document_gate_cleared_by = models.ForeignKey(
        'accounts.User', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='document_gate_clearances',
    )
    document_gate_cleared_at = models.DateTimeField(null=True, blank=True)

    # Track 2 — sub-let flag
    is_sublet = models.BooleanField(
        default=False,
        help_text='True when this booking fills a TemporaryDeparture sub-let gap.',
    )
    # Track 1 — hourly berthing + dynamic pricing audit
    start_time = models.TimeField(null=True, blank=True)
    end_time = models.TimeField(null=True, blank=True)
    is_hourly = models.BooleanField(default=False)
    dynamic_price_applied = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    # Track 10 — OTA commission
    ota_commission_amount = models.DecimalField(
        max_digits=8, decimal_places=2,
        null=True, blank=True,
        help_text='OTA commission amount retained by the channel.',
    )
    # Accounting & Tax Export — per-booking tax-exempt override.
    # Precedence at invoicing time: Booking.tax_exempt_override → Member.tax_exempt → ChargeableItem.tax_category.
    tax_exempt_override = models.BooleanField(
        default=False,
        help_text=(
            'When True, all invoice lines generated for this booking are zero-tax, '
            'overriding the member-level setting and the chargeable item tax category.'
        ),
    )

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        berth_code = self.berth.code if self.berth else 'unassigned'
        return f'BK-{self.pk} — {self.vessel or self.guest_name} @ {berth_code}'


class BookingRequest(models.Model):
    TYPE_CHOICES = [
        ('transient', 'Transient'),
        ('seasonal',  'Seasonal'),
    ]
    STATUS_CHOICES = [
        ('pending',  'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='booking_requests')

    # Relational path — set when the applicant is a known member
    member = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='booking_requests')
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True, related_name='booking_requests')

    # Free-text path — set when the applicant is a stranger
    guest_name   = models.CharField(max_length=200, blank=True)
    guest_phone  = models.CharField(max_length=50,  blank=True)
    guest_email  = models.CharField(max_length=200, blank=True)
    guest_vessel = models.CharField(max_length=200, blank=True)
    guest_loa    = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)

    # Booking intent
    berth        = models.ForeignKey('berths.Berth', on_delete=models.PROTECT, related_name='booking_requests')
    booking_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='transient')
    start_date   = models.DateField()
    end_date     = models.DateField()
    notes        = models.TextField(blank=True)

    # Lifecycle
    status  = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    booking = models.OneToOneField(Booking, on_delete=models.SET_NULL, null=True, blank=True, related_name='source_request')

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        name = self.member.name if self.member else self.guest_name
        return f'WL-{self.pk} — {name}'

    @property
    def is_stranger(self):
        return self.member is None

    def convert_to_booking(self):
        """Convert a free-text request into Member + Vessel + Booking. Idempotent."""
        if self.booking_id:
            return self.booking

        from apps.members.models import Member
        from apps.vessels.models import Vessel

        if self.is_stranger:
            member = Member.objects.create(
                marina=self.marina,
                name=self.guest_name,
                email=self.guest_email,
                phone=self.guest_phone,
                member_type='transient',
            )
            vessel = Vessel.objects.create(
                marina=self.marina,
                name=self.guest_vessel or f"{self.guest_name}'s Vessel",
                loa=self.guest_loa,
                owner=member,
            )
            self.member = member
            self.vessel = vessel

        nights = (self.end_date - self.start_date).days or 1
        price  = self.berth.pricing_tier.unit_price
        amount = price * nights

        booking = Booking.objects.create(
            marina=self.marina,
            berth=self.berth,
            vessel=self.vessel,
            booking_type=self.booking_type,
            check_in=self.start_date,
            check_out=self.end_date,
            nights=nights,
            amount=amount,
            notes=self.notes,
            status='pending',
        )
        self.booking = booking
        self.status  = 'approved'
        self.save()
        return booking


class Reservation(models.Model):
    STATUS_CHOICES = [
        ('pending_approval',  'Pending Approval'),
        ('awaiting_payment',  'Awaiting Payment'),
        ('pending_payment',   'Pending Payment'),
        ('pending_checkout',  'Pending Checkout'),   # tetris ran, inventory locked
        ('confirmed',         'Confirmed'),
        ('pending',           'Pending'),
        ('checked_in',        'Checked In'),
        ('checked_out',       'Checked Out'),
        ('overstay',          'Overstay'),
        ('no_show',           'No Show'),
        ('cancelled',         'Cancelled'),
        ('abandoned',         'Abandoned'),           # lock expired, inventory released
        ('pending_review',    'Pending Manager Review'),
    ]

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='reservations')
    member          = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='reservations')
    guest_name      = models.CharField(max_length=200, blank=True)
    guest_email     = models.EmailField(blank=True)
    guest_phone     = models.CharField(max_length=50, blank=True)
    status          = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    paid            = models.BooleanField(default=False)
    total_price     = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    stripe_payment_intent_id = models.CharField(max_length=200, blank=True)
    locked_until    = models.DateTimeField(null=True, blank=True)
    waiver_envelope_id = models.CharField(max_length=255, null=True, blank=True)
    waiver_signed   = models.BooleanField(default=False)
    self_checked_in    = models.BooleanField(default=False)
    self_checked_in_at = models.DateTimeField(null=True, blank=True)
    booking_source  = models.CharField(max_length=100, default='direct', blank=True)
    notes           = models.TextField(blank=True)
    legacy_booking  = models.OneToOneField(
        'reservations.Booking',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='reservation',
    )
    created_at      = models.DateTimeField(auto_now_add=True)

    # Phase 1 booking-flow additions (spec 2026-05-18)
    estimated_arrival_time = models.TimeField(null=True, blank=True)
    special_requests = models.TextField(blank=True, default='')

    SHORE_POWER_CHOICES = [
        ('16A',  '16A'),
        ('32A',  '32A'),
        ('63A',  '63A'),
        ('none', 'None'),
    ]
    shore_power_amperage = models.CharField(
        max_length=8, choices=SHORE_POWER_CHOICES, null=True, blank=True,
    )

    terms_accepted_at = models.DateTimeField(null=True, blank=True)
    terms_version = models.CharField(max_length=32, blank=True, default='')

    billing_street = models.CharField(max_length=200, blank=True, default='')
    billing_city = models.CharField(max_length=100, blank=True, default='')
    billing_postcode = models.CharField(max_length=20, blank=True, default='')
    billing_country = models.CharField(max_length=2, blank=True, default='')

    company_name = models.CharField(max_length=200, blank=True, default='')
    vat_number = models.CharField(max_length=50, blank=True, default='')
    promo_code = models.CharField(max_length=50, blank=True, default='')

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        name = self.member.name if self.member_id else self.guest_name
        return f'RES-{self.pk} — {name}'


class ReservationItem(models.Model):
    TYPE_CHOICES = [
        ('transient', 'Transient'),
        ('seasonal',  'Seasonal'),
    ]

    reservation     = models.ForeignKey(Reservation, on_delete=models.CASCADE, related_name='items')
    berth           = models.ForeignKey('berths.Berth', on_delete=models.PROTECT, null=True, blank=True, related_name='reservation_items')
    vessel          = models.ForeignKey('vessels.Vessel', on_delete=models.PROTECT, null=True, blank=True, related_name='reservation_items')
    vessel_name     = models.CharField(max_length=200, blank=True)
    booking_type    = models.CharField(max_length=20, choices=TYPE_CHOICES, default='transient')
    check_in        = models.DateField()
    check_out       = models.DateField()
    nights          = models.IntegerField(default=1)
    item_price      = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    boat_loa        = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    boat_beam       = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    boat_draft      = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    eta             = models.TimeField(null=True, blank=True)
    is_sublet       = models.BooleanField(default=False)
    is_hourly       = models.BooleanField(default=False)
    start_time      = models.TimeField(null=True, blank=True)
    end_time        = models.TimeField(null=True, blank=True)
    dynamic_price_applied  = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    ota_commission_amount  = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    mysea_event_uid = models.CharField(max_length=255, blank=True, default='')
    insurance_doc   = models.FileField(upload_to='insurance/', null=True, blank=True)
    pre_cleared     = models.BooleanField(default=False)
    insurance_verified   = models.BooleanField(default=False)
    registration_verified = models.BooleanField(default=False)
    waiver_verified = models.BooleanField(default=False)
    document_gate_cleared    = models.BooleanField(default=False)
    document_gate_cleared_by = models.ForeignKey(
        'accounts.User', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='reservation_item_gate_clearances',
    )
    document_gate_cleared_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    status = models.CharField(
        max_length=20,
        choices=[
            ('locked',    'Locked'),
            ('confirmed', 'Confirmed'),
            ('released',  'Released'),
            ('unassigned', 'Unassigned'),
        ],
        default='confirmed',
    )

    # Phase 1 vessel-detail additions (spec 2026-05-18)
    boat_air_draft = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    vessel_registration = models.CharField(max_length=50, blank=True, default='')
    vessel_flag = models.CharField(max_length=2, blank=True, default='')
    crew_count = models.PositiveSmallIntegerField(null=True, blank=True)
    insurance_certificate = models.FileField(
        upload_to='reservations/insurance/%Y/%m/',
        null=True, blank=True,
    )

    class Meta:
        ordering = ['check_in']

    def __str__(self):
        berth_code = self.berth.code if self.berth_id else 'unassigned'
        return f'ITEM-{self.pk} @ {berth_code} ({self.check_in} → {self.check_out})'


class InsuranceUploadToken(models.Model):
    """
    Short-lived token issued by POST /public/reservations/insurance-upload/
    so the booking flow can upload an insurance PDF before the reservation
    record exists. The token is redeemed atomically inside the intent view,
    which copies the file into the corresponding ReservationItem.insurance_certificate.
    The tmp file is deleted via transaction.on_commit; a defensive Celery task
    purges any stragglers + rows past TTL.
    """
    token = models.CharField(max_length=64, unique=True, db_index=True)
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    file_path = models.CharField(max_length=500)   # MEDIA_ROOT-relative
    mime_type = models.CharField(max_length=64)
    size_bytes = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)
    consumed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=['created_at'])]

    def __str__(self):
        return f'InsuranceUploadToken({self.token[:8]}, marina={self.marina_id})'
