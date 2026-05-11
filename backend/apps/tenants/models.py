from decimal import Decimal
from django.core.exceptions import ValidationError
from django.db import models


class CommercialUnit(models.Model):
    UNIT_TYPE_CHOICES = [
        ('chandlery',     'Chandlery / Marine Shop'),
        ('workshop',      'Workshop'),
        ('office',        'Office Suite'),
        ('storage',       'Dry Storage Unit'),
        ('retail',        'Retail Unit'),
        ('food_kiosk',    'Food & Beverage Kiosk Plot'),
        ('parking_bay',   'Car Parking Bay'),
        ('trailer_store', 'Boat Trailer Storage'),
    ]

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='commercial_units')
    unit_ref      = models.CharField(max_length=50)
    unit_type     = models.CharField(max_length=30, choices=UNIT_TYPE_CHOICES)
    description   = models.TextField(blank=True)
    area_m2       = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    has_power     = models.BooleanField(default=False)
    has_water     = models.BooleanField(default=False)
    has_broadband = models.BooleanField(default=False)
    is_active     = models.BooleanField(default=True)
    notes         = models.TextField(blank=True)

    class Meta:
        unique_together = ('marina', 'unit_ref')
        ordering = ['unit_type', 'unit_ref']

    def __str__(self):
        return f'{self.unit_ref} — {self.get_unit_type_display()} ({self.marina})'


class TenantContact(models.Model):
    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='tenant_contacts')
    display_name  = models.CharField(max_length=200)
    is_company    = models.BooleanField(default=False)
    company_name  = models.CharField(max_length=200, blank=True)
    contact_name  = models.CharField(max_length=200, blank=True)
    email         = models.EmailField(blank=True)
    phone         = models.CharField(max_length=30, blank=True)
    address       = models.TextField(blank=True)
    vat_number    = models.CharField(max_length=50, blank=True)
    notes         = models.TextField(blank=True)
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['display_name']

    def __str__(self):
        return f'{self.display_name} ({self.marina})'


class Tenancy(models.Model):
    FREQ_CHOICES = [
        ('monthly',   'Monthly'),
        ('quarterly', 'Quarterly'),
        ('annually',  'Annually'),
    ]
    STATUS_CHOICES = [
        ('active',     'Active'),
        ('notice',     'Notice Period'),
        ('expired',    'Expired'),
        ('terminated', 'Terminated'),
    ]

    marina             = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='tenancies')
    unit               = models.ForeignKey(CommercialUnit, on_delete=models.PROTECT, related_name='tenancies')
    tenant             = models.ForeignKey(TenantContact, on_delete=models.PROTECT, related_name='tenancies')
    status             = models.CharField(max_length=20, choices=STATUS_CHOICES, default='active')
    lease_start        = models.DateField()
    lease_end          = models.DateField(null=True, blank=True)
    notice_period_days = models.IntegerField(default=28)
    permitted_use      = models.CharField(max_length=500, blank=True)
    rent_amount        = models.DecimalField(max_digits=10, decimal_places=2)
    rent_frequency     = models.CharField(max_length=20, choices=FREQ_CHOICES, default='monthly')
    service_charge     = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    deposit_amount     = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    next_review_date   = models.DateField(null=True, blank=True)
    review_notes       = models.TextField(blank=True)
    break_clause_date  = models.DateField(null=True, blank=True)
    break_clause_notes = models.CharField(max_length=500, blank=True)

    rent_chargeable_item = models.ForeignKey(
        'billing.ChargeableItem',
        on_delete=models.PROTECT,
        null=True, blank=True,
        related_name='tenancies',
        limit_choices_to={'category': 'rent'},
    )
    deposit_chargeable_item = models.ForeignKey(
        'billing.ChargeableItem',
        on_delete=models.PROTECT,
        null=True, blank=True,
        related_name='deposit_tenancies',
        limit_choices_to={'category': 'deposit'},
    )
    deposit_invoice = models.OneToOneField(
        'billing.Invoice',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='deposit_tenancy',
    )

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-lease_start']

    @property
    def deposit_held(self) -> bool:
        return self.deposit_invoice_id is not None and self.deposit_invoice.status == 'paid'

    def clean(self):
        if self.status == 'active':
            qs = Tenancy.objects.filter(unit=self.unit, status='active')
            if self.pk:
                qs = qs.exclude(pk=self.pk)
            if qs.exists():
                raise ValidationError('This unit already has an active tenancy.')
        if self.lease_end and self.lease_end < self.lease_start:
            raise ValidationError({'lease_end': 'Lease end must be after lease start.'})

    def __str__(self):
        return f'Tenancy: {self.tenant} @ {self.unit} ({self.status})'


class TenancyDocument(models.Model):
    DOC_TYPE_CHOICES = [
        ('lease_agreement',    'Lease Agreement'),
        ('guarantor',          'Guarantor Document'),
        ('planning_permission','Planning Permission'),
        ('compliance_cert',    'Compliance Certificate'),
        ('insurance',          'Insurance Certificate'),
        ('correspondence',     'Correspondence'),
        ('other',              'Other'),
    ]

    tenancy     = models.ForeignKey(Tenancy, on_delete=models.CASCADE, related_name='documents')
    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='tenancy_documents')
    doc_type    = models.CharField(max_length=30, choices=DOC_TYPE_CHOICES)
    file        = models.FileField(upload_to='tenancy_docs/')
    filename    = models.CharField(max_length=255, blank=True)
    expires_at  = models.DateField(null=True, blank=True)
    notes       = models.CharField(max_length=500, blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-uploaded_at']

    def __str__(self):
        return f'{self.get_doc_type_display()} — {self.tenancy}'


class RentScheduleEntry(models.Model):
    STATUS_CHOICES = [
        ('scheduled', 'Scheduled'),
        ('invoiced',  'Invoiced'),
        ('cancelled', 'Cancelled'),
    ]

    tenancy           = models.ForeignKey(Tenancy, on_delete=models.CASCADE, related_name='schedule_entries')
    marina            = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='rent_schedule_entries')
    period_ref        = models.CharField(max_length=20)
    due_date          = models.DateField()
    amount            = models.DecimalField(max_digits=10, decimal_places=2)
    status            = models.CharField(max_length=20, choices=STATUS_CHOICES, default='scheduled')
    invoice           = models.OneToOneField(
        'billing.Invoice',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='rent_schedule_entry',
    )
    is_pro_rata         = models.BooleanField(default=False)
    pro_rata_days       = models.PositiveIntegerField(null=True, blank=True)
    pro_rata_total_days = models.PositiveIntegerField(null=True, blank=True)
    created_at          = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['due_date']
        unique_together = ('tenancy', 'period_ref')

    def __str__(self):
        return f'Rent {self.period_ref} — {self.tenancy} ({self.status})'


class TenancyTask(models.Model):
    STATUS_CHOICES = [
        ('open',        'Open'),
        ('in_progress', 'In Progress'),
        ('done',        'Done'),
        ('cancelled',   'Cancelled'),
    ]
    TYPE_CHOICES = [
        ('rent_review',   'Rent Review'),
        ('lease_renewal', 'Lease Renewal'),
        ('compliance',    'Compliance Check'),
        ('general',       'General'),
    ]

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='tenancy_tasks')
    tenancy     = models.ForeignKey(Tenancy, on_delete=models.CASCADE, related_name='tasks', null=True, blank=True)
    task_type   = models.CharField(max_length=30, choices=TYPE_CHOICES, default='general')
    title       = models.CharField(max_length=300)
    due_date    = models.DateField(null=True, blank=True)
    assigned_to = models.ForeignKey('accounts.User', on_delete=models.SET_NULL, null=True, blank=True, related_name='tenancy_tasks')
    status      = models.CharField(max_length=20, choices=STATUS_CHOICES, default='open')
    notes       = models.TextField(blank=True)
    created_at  = models.DateTimeField(auto_now_add=True)
    updated_at  = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['due_date', 'created_at']

    def __str__(self):
        return f'{self.title} ({self.get_status_display()})'
