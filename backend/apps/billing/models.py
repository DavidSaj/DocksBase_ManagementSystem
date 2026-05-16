from decimal import Decimal
from django.db import models
from apps.fuel_dock.models import FuelDockEntry


class TaxRate(models.Model):
    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='tax_rates')
    name        = models.CharField(max_length=100)
    rate        = models.DecimalField(max_digits=5, decimal_places=2)
    is_default  = models.BooleanField(default=False)
    is_archived = models.BooleanField(default=False)
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('marina', 'name')]
        ordering = ['-rate']

    def __str__(self):
        return f'{self.name} ({self.rate}%)'


class Invoice(models.Model):
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('unpaid', 'Unpaid'),
        ('open', 'Open'),
        ('paid', 'Paid'),
        ('void', 'Void'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='invoices')
    member = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='invoices')
    tenant = models.ForeignKey(
        'tenants.TenantContact',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='invoices',
    )
    invoice_number = models.CharField(max_length=20, db_index=True)
    status = models.CharField(max_length=10, choices=STATUS_CHOICES, default='draft')
    source_type = models.CharField(max_length=50, blank=True)
    source_id = models.CharField(max_length=255, blank=True, db_index=True)
    subtotal = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    tax_total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    total = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    stripe_checkout_session_id = models.CharField(max_length=200, blank=True)
    stripe_payment_intent_id = models.CharField(max_length=200, blank=True)
    payment_intent_status = models.CharField(
        max_length=30, blank=True, default='',
        help_text="Stripe PaymentIntent status snapshot: '', 'pending', "
                  "'processing', 'requires_action', 'succeeded', 'canceled'. "
                  "Quick Charge blocks new lines while in-flight.",
    )
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
    reservation = models.ForeignKey(
        'reservations.Reservation',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='invoices',
    )
    invoice_type = models.CharField(
        max_length=20,
        choices=[('invoice', 'Invoice'), ('credit_note', 'Credit Note')],
        default='invoice',
    )
    related_invoice = models.ForeignKey(
        'self',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='credit_notes',
        help_text='For credit notes: points to the original invoice being neutralised.',
    )
    shipping_agent = models.ForeignKey(
        'harbour.ShippingAgent',
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
    # ── Quick-Charge audit & undo support ─────────────────────────────────
    added_by = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='added_invoice_lines',
    )
    source = models.CharField(max_length=30, blank=True, default='')
    notes = models.CharField(max_length=255, blank=True, default='')
    undo_token = models.CharField(max_length=64, blank=True, default='', db_index=True)
    created_at = models.DateTimeField(auto_now_add=True, null=True)

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
        BERTH        = 'berth',        'Berth'
        UTILITY      = 'utility',      'Utility'
        SERVICE      = 'service',      'Service'
        RETAIL       = 'retail',       'Retail'
        BOOKING_FEE  = 'booking_fee',  'Booking Fee'
        FUEL         = 'fuel',         'Fuel'
        REPAIR       = 'repair',       'Repair'
        COURSE       = 'course',       'Course'
        LOYALTY      = 'loyalty',      'Loyalty Redemption'
        SUBSCRIPTION = 'subscription', 'Subscription'
        PENALTY      = 'penalty',      'Penalty'
        DEPOSIT      = 'deposit',      'Deposit'
        RENT         = 'rent',         'Rent'
        OFFSET       = 'offset',       'Carbon Offset'
        COMMISSION     = 'commission',     'Commission'
        CHARTER        = 'charter',        'Charter Fee'
        HARBOUR_TARIFF = 'harbour_tariff', 'Harbour Tariff'

    class PricingModel(models.TextChoices):
        FLAT_FEE            = 'flat_fee',            'Flat Fee'
        PER_NIGHT           = 'per_night',           'Per Night'
        PER_METER_PER_NIGHT = 'per_meter_per_night', 'Per Meter Per Night'
        PER_KWH             = 'per_kwh',             'Per kWh'
        PER_HOUR            = 'per_hour',             'Per Hour'
        PER_METER_FLAT      = 'per_meter_flat',      'Per Meter (flat)'
        PER_LITRE           = 'per_litre',           'Per Litre'
        PER_WEEK            = 'per_week',            'Per Week'
        PER_PASSENGER       = 'per_passenger',       'Per Passenger'
        PER_GROSS_TON       = 'per_gross_ton',       'Per Gross Ton'
        PER_TON_DISTANCE    = 'per_ton_distance',    'Per Ton × Distance'

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='chargeable_items')
    name          = models.CharField(max_length=200)
    category      = models.CharField(max_length=20, choices=Category.choices, default=Category.SERVICE)
    pricing_model = models.CharField(max_length=30, choices=PricingModel.choices, default=PricingModel.FLAT_FEE)
    unit_price    = models.DecimalField(max_digits=10, decimal_places=2)
    tax_category  = models.ForeignKey(
        'billing.TaxRate',
        on_delete=models.PROTECT,
        related_name='chargeable_items',
    )
    is_active                  = models.BooleanField(default=True)
    show_in_pos                = models.BooleanField(default=False)
    show_in_quick_charge       = models.BooleanField(
        default=False,
        help_text='Surfaces this item in the staff Quick Charge PWA grid.',
    )
    qty_variable               = models.BooleanField(
        default=False,
        help_text='If True, the Quick Charge UI renders a quantity stepper; '
                  'otherwise the item is single-tap qty=1.',
    )
    is_mandatory_transient_fee = models.BooleanField(default=False)
    # Coupons/loyalty points must NOT apply to offset certificates or deposit items.
    is_discountable = models.BooleanField(
        default=True,
        help_text='Set False for deposit and carbon-offset items to block coupon/loyalty discounts.',
    )
    is_upsell_eligible = models.BooleanField(
        default=False,
        help_text='Mark items that can be offered as upsells during booking or check-in.',
    )
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


# ── Track 3 — Debt management models ─────────────────────────────────────────

class DunningTemplate(models.Model):
    marina     = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='dunning_templates')
    level      = models.IntegerField()
    subject    = models.CharField(max_length=500)
    body_html  = models.TextField()
    created_by = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True,
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('marina', 'level')]
        ordering = ['marina', 'level']

    def __str__(self):
        return f'Dunning Level {self.level} — {self.marina}'


class DebtNote(models.Model):
    class ContactMethod(models.TextChoices):
        PHONE     = 'phone',     'Phone Call'
        EMAIL     = 'email',     'Email'
        IN_PERSON = 'in_person', 'In Person'
        LETTER    = 'letter',    'Letter'

    class Outcome(models.TextChoices):
        PROMISE_TO_PAY = 'promise_to_pay', 'Promise to Pay'
        DISPUTED       = 'disputed',       'Disputed'
        NO_CONTACT     = 'no_contact',     'No Contact Made'
        PAID           = 'paid',           'Paid in Full'

    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='debt_notes')
    member         = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='debt_notes')
    invoices       = models.ManyToManyField('Invoice', blank=True, related_name='debt_notes')
    contact_method = models.CharField(max_length=20, choices=ContactMethod.choices)
    outcome        = models.CharField(max_length=30, choices=Outcome.choices)
    notes          = models.TextField(blank=True)
    promised_payment_date = models.DateField(null=True, blank=True)
    created_by     = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='debt_notes',
    )
    created_at     = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'DebtNote {self.pk} — {self.member} ({self.outcome})'


class DunningLetter(models.Model):
    class Status(models.TextChoices):
        DRAFT   = 'draft',   'Draft'
        SENT    = 'sent',    'Sent'
        BOUNCED = 'bounced', 'Bounced'

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='dunning_letters')
    member        = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='dunning_letters')
    invoices      = models.ManyToManyField('Invoice', blank=True, related_name='dunning_letters')
    level         = models.IntegerField()
    status        = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    demand_amount = models.DecimalField(max_digits=10, decimal_places=2)
    pdf_document  = models.FileField(upload_to='dunning_letters/', null=True, blank=True)
    send_via      = models.CharField(max_length=20, default='email')
    generated_by  = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='dunning_letters',
    )
    generated_at  = models.DateTimeField(auto_now_add=True)
    sent_at       = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-generated_at']

    def __str__(self):
        return f'DunningLetter L{self.level} — {self.member} ({self.status})'


class DebtEscalation(models.Model):
    class Status(models.TextChoices):
        OPEN     = 'open',     'Open'
        RESOLVED = 'resolved', 'Resolved'
        REFERRED = 'referred', 'Referred to Agency'

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='debt_escalations')
    member      = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='debt_escalations')
    invoices    = models.ManyToManyField('Invoice', blank=True, related_name='debt_escalations')
    escalate_to = models.CharField(max_length=100, blank=True)
    status      = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    notes       = models.TextField(blank=True)
    created_by  = models.ForeignKey(
        'staff.StaffMember', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='debt_escalations',
    )
    created_at  = models.DateTimeField(auto_now_add=True)
    resolved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'DebtEscalation {self.pk} — {self.member} ({self.status})'


# ── Quick-Charge idempotency ──────────────────────────────────────────────────

class IdempotencyKey(models.Model):
    """Globally-unique idempotency key (per platform, not per marina).

    Source-scoped so different feature areas can reuse the table.  The
    `key` column is UNIQUE across the entire table — Gemini's "cross-marina
    replay" trap fix from the spec.
    """
    key = models.CharField(max_length=64, unique=True, db_index=True)
    source = models.CharField(max_length=30, db_index=True)
    response_json = models.JSONField(default=dict, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Idem({self.source}:{self.key})'


# ── Refunds ──────────────────────────────────────────────────────────────────

class Refund(models.Model):
    class Reason(models.TextChoices):
        DUPLICATE             = 'duplicate',             'Duplicate'
        FRAUDULENT            = 'fraudulent',            'Fraudulent'
        REQUESTED_BY_CUSTOMER = 'requested_by_customer', 'Requested by Customer'
        OTHER                 = 'other',                 'Other'

    class Status(models.TextChoices):
        PENDING          = 'pending',          'Pending'
        SUCCEEDED        = 'succeeded',        'Succeeded'
        FAILED           = 'failed',           'Failed'
        REQUIRES_ACTION  = 'requires_action',  'Requires Action'
        MANUAL_REQUIRED  = 'manual_required',  'Manual Required'

    marina = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='refunds'
    )
    invoice = models.ForeignKey(
        Invoice, on_delete=models.SET_NULL, null=True, blank=True, related_name='refunds'
    )
    stripe_payment_intent_id = models.CharField(max_length=200, blank=True)
    stripe_refund_id = models.CharField(max_length=200, blank=True, db_index=True)
    amount_cents = models.IntegerField()
    currency = models.CharField(max_length=10, default='eur')
    reason = models.CharField(max_length=30, choices=Reason.choices, default=Reason.OTHER)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    requested_by = models.ForeignKey(
        'accounts.User', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='requested_refunds',
    )
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Refund {self.pk} — {self.amount_cents}c ({self.status})'


# ── Track 7 — Coupon models ───────────────────────────────────────────────────
# NOTE: CouponCode already exists in apps/loyalty/models.py (added by a previous track).
# Skipping duplicate definition here — use apps.loyalty.models.CouponCode as the
# single source of truth. See INSTALL.md for details.
