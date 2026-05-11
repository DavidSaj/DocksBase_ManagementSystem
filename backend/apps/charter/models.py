from decimal import Decimal
from django.db import models
from model_utils import FieldTracker


class CharterVessel(models.Model):
    marina             = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='charter_vessels')
    vessel             = models.OneToOneField('vessels.Vessel', on_delete=models.CASCADE, related_name='charter_profile')
    hourly_rate_item   = models.ForeignKey('billing.ChargeableItem', null=True, blank=True, on_delete=models.SET_NULL, related_name='charter_hourly')
    daily_rate_item    = models.ForeignKey('billing.ChargeableItem', null=True, blank=True, on_delete=models.SET_NULL, related_name='charter_daily')
    weekly_rate_item   = models.ForeignKey('billing.ChargeableItem', null=True, blank=True, on_delete=models.SET_NULL, related_name='charter_weekly')
    cleaning_fee_item  = models.ForeignKey('billing.ChargeableItem', null=True, blank=True, on_delete=models.SET_NULL, related_name='charter_cleaning')
    skipper_fee_item   = models.ForeignKey('billing.ChargeableItem', null=True, blank=True, on_delete=models.SET_NULL, related_name='charter_skipper')
    fuel_inclusive     = models.BooleanField(default=False)
    skipper_required   = models.BooleanField(default=False)
    min_charterer_qual = models.CharField(max_length=200, blank=True)
    security_deposit   = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    max_duration_days  = models.IntegerField(null=True, blank=True)
    is_available       = models.BooleanField(default=True)
    notes              = models.TextField(blank=True)
    created_at         = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['vessel__name']

    def __str__(self):
        return f'Charter: {self.vessel.name}'


class CharterManagementAgreement(models.Model):
    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='charter_management_agreements')
    charter_vessel   = models.ForeignKey(CharterVessel, on_delete=models.CASCADE, related_name='management_agreements')
    member           = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='charter_management_agreements')
    owner_label      = models.CharField(max_length=200, blank=True)
    split_percentage = models.DecimalField(max_digits=5, decimal_places=2)
    commission_rate  = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'))
    valid_from       = models.DateField()
    valid_to         = models.DateField(null=True, blank=True)
    notes            = models.TextField(blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['charter_vessel', 'valid_from']

    def __str__(self):
        return f'{self.charter_vessel.vessel.name} — {self.owner_label or "Marina"} {self.split_percentage}%'

    def clean(self):
        from django.core.exceptions import ValidationError
        from django.utils import timezone

        today = timezone.now().date()
        qs = CharterManagementAgreement.objects.filter(
            charter_vessel=self.charter_vessel,
        ).filter(
            models.Q(valid_to__isnull=True) | models.Q(valid_to__gte=today)
        )
        if self.pk:
            qs = qs.exclude(pk=self.pk)

        existing_sum = sum(a.split_percentage for a in qs)
        total = existing_sum + self.split_percentage
        if total != Decimal('100.00'):
            raise ValidationError(
                f'Active agreements for this vessel must sum to exactly 100%. '
                f'Current sum (excluding this record): {existing_sum}%. '
                f'This record adds {self.split_percentage}% → total would be {total}%.'
            )


class CharterBooking(models.Model):
    class Status(models.TextChoices):
        ENQUIRY   = 'enquiry',   'Enquiry'
        CONFIRMED = 'confirmed', 'Confirmed'
        ACTIVE    = 'active',    'Active (On Charter)'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'

    class DepositStatus(models.TextChoices):
        PENDING   = 'pending',   'Pending'
        HELD      = 'held',      'Held'
        RELEASED  = 'released',  'Released'
        WITHHELD  = 'withheld',  'Partially/Fully Withheld'

    class DepositMechanism(models.TextChoices):
        AUTH_HOLD = 'auth_hold', 'Stripe Auth & Hold (< 7 days)'
        CAPTURED  = 'captured',  'Captured to Card + Credit Account Liability (>= 7 days)'

    class DurationUnit(models.TextChoices):
        HOURLY = 'hourly', 'Hourly'
        DAILY  = 'daily',  'Daily'
        WEEKLY = 'weekly', 'Weekly'

    marina              = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='charter_bookings')
    charter_vessel      = models.ForeignKey(CharterVessel, on_delete=models.PROTECT, related_name='bookings')
    charterer           = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='charter_bookings')
    charterer_name      = models.CharField(max_length=200, blank=True)
    charterer_email     = models.EmailField(blank=True)
    charterer_phone     = models.CharField(max_length=30, blank=True)
    skipper             = models.ForeignKey('staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True, related_name='charter_assignments')
    start_dt            = models.DateTimeField()
    end_dt              = models.DateTimeField()
    duration_unit       = models.CharField(max_length=10, choices=DurationUnit.choices, default=DurationUnit.DAILY)
    rate_applied        = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    fuel_inclusive      = models.BooleanField(default=False)
    cleaning_fee        = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal('0.00'))
    skipper_fee         = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal('0.00'))
    deposit_amount      = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal('0.00'))
    deposit_status      = models.CharField(max_length=20, choices=DepositStatus.choices, default=DepositStatus.PENDING)
    deposit_mechanism   = models.CharField(max_length=20, choices=DepositMechanism.choices, blank=True)
    deposit_stripe_payment_intent = models.CharField(max_length=200, blank=True)
    subtotal            = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    total               = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    channel             = models.CharField(max_length=50, blank=True)
    channel_ref         = models.CharField(max_length=200, blank=True)
    channel_commission  = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal('0.00'))
    invoice             = models.ForeignKey('billing.Invoice', on_delete=models.SET_NULL, null=True, blank=True, related_name='charter_bookings')
    status              = models.CharField(max_length=20, choices=Status.choices, default=Status.ENQUIRY)
    internal_notes      = models.TextField(blank=True)
    created_at          = models.DateTimeField(auto_now_add=True)

    tracker = FieldTracker(fields=['subtotal', 'status'])

    class Meta:
        ordering = ['-start_dt']
        constraints = [
            models.UniqueConstraint(
                fields=['marina', 'channel', 'channel_ref'],
                condition=models.Q(channel_ref__gt=''),
                name='unique_ota_charter_booking_per_marina_channel',
            )
        ]

    def __str__(self):
        return f'Charter #{self.pk} — {self.charter_vessel.vessel.name} ({self.start_dt.date()})'


class CharterAgreement(models.Model):
    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='charter_agreements')
    booking      = models.OneToOneField(CharterBooking, on_delete=models.CASCADE, related_name='agreement')
    envelope     = models.ForeignKey('documents.Envelope', on_delete=models.SET_NULL, null=True, blank=True, related_name='charter_agreements')
    signed_at    = models.DateTimeField(null=True, blank=True)
    charterer_ip = models.GenericIPAddressField(null=True, blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'Agreement — Charter #{self.booking_id}'


class CharterAgentCommission(models.Model):
    class PaymentStatus(models.TextChoices):
        PENDING  = 'pending',  'Pending'
        APPROVED = 'approved', 'Approved'
        PAID     = 'paid',     'Paid'

    marina            = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='charter_agent_commissions')
    booking           = models.ForeignKey(CharterBooking, on_delete=models.CASCADE, related_name='agent_commissions')
    agent_name        = models.CharField(max_length=200)
    agent_email       = models.EmailField(blank=True)
    commission_rate   = models.DecimalField(max_digits=5, decimal_places=2)
    commission_amount = models.DecimalField(max_digits=8, decimal_places=2)
    payment_status    = models.CharField(max_length=20, choices=PaymentStatus.choices, default=PaymentStatus.PENDING)
    paid_at           = models.DateField(null=True, blank=True)
    notes             = models.TextField(blank=True)
    created_at        = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'Commission — {self.agent_name} / Charter #{self.booking_id}'


class CharterVesselOTAMapping(models.Model):
    """Maps an OTA's internal vessel ID to a DocksBase CharterVessel."""
    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='ota_vessel_mappings')
    charter_vessel = models.ForeignKey(CharterVessel, on_delete=models.CASCADE, related_name='ota_mappings')
    channel        = models.CharField(max_length=50)       # e.g. 'zizoo', 'click_and_boat'
    ota_vessel_id  = models.CharField(max_length=200)

    class Meta:
        unique_together = [('marina', 'channel', 'ota_vessel_id')]
        ordering = ['channel', 'ota_vessel_id']

    def __str__(self):
        return f'{self.channel}:{self.ota_vessel_id} → {self.charter_vessel}'


class RentalUnit(models.Model):
    class UnitType(models.TextChoices):
        ELECTRIC_BOAT  = 'electric_boat',  'Electric Day Boat'
        PEDAL_BOAT     = 'pedal_boat',     'Pedal Boat'
        KAYAK          = 'kayak',          'Kayak'
        PADDLEBOARD    = 'paddleboard',    'Paddleboard'
        SAILING_DINGHY = 'sailing_dinghy', 'Sailing Dinghy'
        OTHER          = 'other',          'Other'

    marina             = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='rental_units')
    name               = models.CharField(max_length=200)
    unit_type          = models.CharField(max_length=30, choices=UnitType.choices)
    colour             = models.CharField(max_length=7, default='#3b82f6')
    hourly_rate_item   = models.ForeignKey('billing.ChargeableItem', null=True, blank=True, on_delete=models.SET_NULL, related_name='rental_hourly')
    halfday_rate_item  = models.ForeignKey('billing.ChargeableItem', null=True, blank=True, on_delete=models.SET_NULL, related_name='rental_halfday')
    fullday_rate_item  = models.ForeignKey('billing.ChargeableItem', null=True, blank=True, on_delete=models.SET_NULL, related_name='rental_fullday')
    turnaround_minutes = models.PositiveIntegerField(default=15)
    is_active          = models.BooleanField(default=True)
    notes              = models.TextField(blank=True)
    created_at         = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['unit_type', 'name']

    def __str__(self):
        return self.name


class RentalBooking(models.Model):
    class Status(models.TextChoices):
        RESERVED  = 'reserved',  'Reserved'
        ACTIVE    = 'active',    'Active'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'

    marina                = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='rental_bookings')
    rental_unit           = models.ForeignKey(RentalUnit, on_delete=models.PROTECT, related_name='bookings')
    member                = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='rental_bookings')
    customer_name         = models.CharField(max_length=200, blank=True)
    customer_email        = models.EmailField(blank=True)
    customer_phone        = models.CharField(max_length=30, blank=True)
    start_dt              = models.DateTimeField()
    end_dt                = models.DateTimeField()
    duration_minutes      = models.IntegerField()
    rate_applied          = models.DecimalField(max_digits=8, decimal_places=2)
    total                 = models.DecimalField(max_digits=8, decimal_places=2)
    invoice               = models.ForeignKey('billing.Invoice', on_delete=models.SET_NULL, null=True, blank=True, related_name='rental_bookings')
    status                = models.CharField(max_length=20, choices=Status.choices, default=Status.RESERVED)
    online_booking        = models.BooleanField(default=False)
    stripe_payment_intent = models.CharField(max_length=200, blank=True)
    notes                 = models.TextField(blank=True)
    created_at            = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-start_dt']

    def __str__(self):
        return f'Rental #{self.pk} — {self.rental_unit.name} ({self.start_dt.strftime("%Y-%m-%d %H:%M")})'
