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
