from decimal import Decimal
from django.db import models
from apps.fuel_dock.models import FuelDockEntry


class Invoice(models.Model):
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('open', 'Open'),
        ('paid', 'Paid'),
        ('void', 'Void'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='invoices')
    member = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='invoices')
    invoice_number = models.CharField(max_length=20, db_index=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='draft')
    source_type = models.CharField(max_length=50, blank=True)
    source_id = models.CharField(max_length=255, blank=True, db_index=True)
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    vat_rate = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True, default=Decimal('0.00'))
    tax_total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    stripe_checkout_session_id = models.CharField(max_length=200, blank=True)
    stripe_payment_intent_id = models.CharField(max_length=200, blank=True)
    billing_period = models.CharField(max_length=7, blank=True, db_index=True)  # "YYYY-MM"
    due_date = models.DateField(null=True, blank=True)
    paid_at = models.DateTimeField(null=True, blank=True)
    pdf_document = models.FileField(upload_to='invoices/', null=True, blank=True)
    booking = models.ForeignKey(
        'reservations.Booking',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='invoices',
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
        unique_together = [('marina', 'invoice_number')]

    def __str__(self):
        return f'{self.invoice_number} ({self.status})'


class InvoiceLineItem(models.Model):
    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='items')
    description = models.CharField(max_length=255)
    quantity = models.DecimalField(max_digits=8, decimal_places=2, default=Decimal('1.00'))
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    total_price = models.DecimalField(max_digits=10, decimal_places=2)
    chargeable_item = models.ForeignKey(
        'ChargeableItem', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='line_items'
    )
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'))

    def __str__(self):
        return f'{self.description} × {self.quantity}'

    @property
    def line_subtotal(self):
        return self.total_price

    @property
    def line_tax(self):
        from decimal import ROUND_HALF_UP
        return (self.total_price * self.tax_rate / 100).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    @property
    def line_total(self):
        return self.line_subtotal + self.line_tax


class Payment(models.Model):
    METHOD_CHOICES = [
        ('cash', 'Cash'),
        ('external_card', 'External Card'),
    ]

    invoice = models.ForeignKey(Invoice, on_delete=models.CASCADE, related_name='payments')
    method = models.CharField(max_length=20, choices=METHOD_CHOICES)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    recorded_by = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True
    )
    paid_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'Payment {self.pk} — {self.invoice}'


class ChargeableItem(models.Model):
    class Category(models.TextChoices):
        BERTH        = 'berth',       'Berth'
        UTILITY      = 'utility',     'Utility'
        SERVICE      = 'service',     'Service'
        RETAIL       = 'retail',      'Retail'
        BOOKING_FEE  = 'booking_fee', 'Booking Fee'

    class PricingModel(models.TextChoices):
        FLAT_FEE            = 'flat_fee',            'Flat Fee'
        PER_NIGHT           = 'per_night',           'Per Night'
        PER_METER_PER_NIGHT = 'per_meter_per_night', 'Per Meter Per Night'
        PER_KWH             = 'per_kwh',             'Per kWh'
        PER_HOUR            = 'per_hour',             'Per Hour'
        PER_METER_FLAT      = 'per_meter_flat',      'Per Meter (flat)'
        PER_LITRE           = 'per_litre',           'Per Litre'

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='chargeable_items')
    name          = models.CharField(max_length=200)
    category      = models.CharField(max_length=20, choices=Category.choices, default=Category.SERVICE)
    pricing_model = models.CharField(max_length=30, choices=PricingModel.choices, default=PricingModel.FLAT_FEE)
    unit_price    = models.DecimalField(max_digits=10, decimal_places=2)
    tax_rate      = models.DecimalField(max_digits=5, decimal_places=2, default=Decimal('0.00'))
    is_active                  = models.BooleanField(default=True)
    show_in_pos                = models.BooleanField(default=False)
    is_mandatory_transient_fee = models.BooleanField(default=False)
    fuel_dock_type = models.CharField(
        max_length=20,
        blank=True,
        default='',
        choices=FuelDockEntry.FUEL_TYPE_CHOICES,
    )
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['category', 'name']

    def __str__(self):
        return f'{self.name} ({self.get_pricing_model_display()})'


class AccountPayment(models.Model):
    METHOD_CHOICES = [
        ('cash',          'Cash'),
        ('external_card', 'External Card'),
        ('bank_transfer', 'Bank Transfer'),
    ]

    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='account_payments')
    member           = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='account_payments')
    amount           = models.DecimalField(max_digits=10, decimal_places=2)
    credit_remaining = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    method           = models.CharField(max_length=20, choices=METHOD_CHOICES)
    recorded_by      = models.ForeignKey('staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True, related_name='recorded_account_payments')
    notes            = models.CharField(max_length=500, blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'AP-{self.pk} — {self.member} (€{self.amount})'


class PaymentAllocation(models.Model):
    payment          = models.ForeignKey(AccountPayment, on_delete=models.CASCADE, related_name='allocations')
    invoice          = models.ForeignKey(Invoice, on_delete=models.PROTECT, related_name='allocations')
    allocated_amount = models.DecimalField(max_digits=10, decimal_places=2)

    class Meta:
        ordering = ['id']

    def __str__(self):
        return f'Alloc {self.pk}: €{self.allocated_amount} → {self.invoice}'
