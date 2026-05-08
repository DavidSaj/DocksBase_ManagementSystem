from django.core.exceptions import ValidationError
from django.db import models


class HaulOut(models.Model):
    STATUS = [
        ('scheduled', 'Scheduled'), ('in_progress', 'In Progress'),
        ('completed', 'Completed'), ('cancelled', 'Cancelled'),
    ]
    TYPE = [('haul_out', 'Haul Out'), ('splash', 'Splash')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='haul_outs')
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.PROTECT)
    haul_type = models.CharField(max_length=20, choices=TYPE, default='haul_out')
    scheduled_at = models.DateTimeField()
    equipment = models.CharField(max_length=200, blank=True)
    crew = models.IntegerField(default=2)
    status = models.CharField(max_length=20, choices=STATUS, default='scheduled')
    assigned_to = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)

    def clean(self):
        if self.vessel_id and self.vessel.marina_id != self.marina_id:
            raise ValidationError('Vessel belongs to a different marina.')

    class Meta:
        ordering = ['-scheduled_at']

    def __str__(self):
        return f'HaulOut #{self.pk} — {self.vessel.name}'


class WorkOrder(models.Model):
    STATUS = [
        ('pending_auth', 'Pending Auth'), ('authorised', 'Authorised'),
        ('in_progress', 'In Progress'), ('completed', 'Completed'),
    ]
    PRIORITY = [('low', 'Low'), ('normal', 'Normal'), ('high', 'High'), ('urgent', 'Urgent')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='work_orders')
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True)
    title = models.CharField(max_length=300)
    category = models.CharField(max_length=100, blank=True)
    description = models.TextField(blank=True)
    priority = models.CharField(max_length=20, choices=PRIORITY, default='normal')
    status = models.CharField(max_length=20, choices=STATUS, default='pending_auth')
    assigned_to = models.CharField(max_length=200, blank=True)
    estimate = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    actual = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    due = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'WO-{self.pk} {self.title}'


class Part(models.Model):
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='parts')
    name = models.CharField(max_length=200)
    part_no = models.CharField(max_length=100, blank=True)
    category = models.CharField(max_length=100, blank=True)
    supplier = models.CharField(max_length=200, blank=True)
    unit_cost = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    sell_price = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    stock = models.IntegerField(default=0)
    par = models.IntegerField(default=0, help_text='Minimum stock level')
    location = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class Tool(models.Model):
    STATUS = [
        ('available', 'Available'),
        ('checked_out', 'Checked Out'),
        ('service_due', 'Service Due'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='tools')
    name = models.CharField(max_length=200)
    category = models.CharField(max_length=100, blank=True)
    serial = models.CharField(max_length=100, blank=True)
    location = models.CharField(max_length=200, blank=True)
    status = models.CharField(max_length=20, choices=STATUS, default='available')
    checked_out_to = models.CharField(max_length=200, blank=True)
    work_order = models.ForeignKey(
        WorkOrder, on_delete=models.SET_NULL, null=True, blank=True
    )
    calibration_due = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class StorageSlot(models.Model):
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='storage_slots')
    lane = models.CharField(max_length=50)
    col = models.CharField(max_length=10)
    tier = models.IntegerField(default=1)  # 1=Ground, 2=Middle, 3=Top
    vessel = models.ForeignKey(
        'vessels.Vessel', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='storage_slot'
    )

    def clean(self):
        if self.vessel_id and self.vessel.marina_id != self.marina_id:
            raise ValidationError('Vessel belongs to a different marina.')

    class Meta:
        ordering = ['lane', 'col', 'tier']
        unique_together = [('marina', 'lane', 'col', 'tier')]

    def __str__(self):
        return f'{self.lane}-{self.col}-T{self.tier}'


class LaunchRequest(models.Model):
    STATUS = [
        ('pending', 'Pending'), ('scheduled', 'Scheduled'),
        ('launching', 'Launching'), ('retrieved', 'Retrieved'),
    ]
    REQUEST_TYPE = [
        ('launch', 'Launch'),
        ('retrieval', 'Retrieval'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='launch_requests')
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.PROTECT, related_name='launch_requests')
    slot = models.ForeignKey(
        StorageSlot, on_delete=models.SET_NULL,
        null=True, blank=True, related_name='launch_requests'
    )
    equipment = models.CharField(max_length=200, blank=True)
    assigned_to = models.CharField(max_length=200, blank=True)
    status = models.CharField(max_length=20, choices=STATUS, default='pending')
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    # --- Track 6 additions (added via migration 0003) ---
    request_type          = models.CharField(max_length=20, choices=REQUEST_TYPE, default='launch')
    scheduled_for         = models.DateTimeField(null=True, blank=True)
    confirmed_by_customer = models.BooleanField(default=False)
    confirmation_deadline = models.DateTimeField(null=True, blank=True)
    arrived_at            = models.DateTimeField(null=True, blank=True)
    no_show               = models.BooleanField(default=False)
    no_show_fee_line      = models.ForeignKey(
        'billing.InvoiceLineItem', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='no_show_launch_requests',
    )
    pick_ticket_complete  = models.BooleanField(default=False)

    def clean(self):
        if self.vessel_id and self.vessel.marina_id != self.marina_id:
            raise ValidationError('Vessel belongs to a different marina.')

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        return f'{self.get_request_type_display()} — {self.vessel.name}'


# ---------------------------------------------------------------------------
# Track 6: Concierge catalogue
# ---------------------------------------------------------------------------

class ConciergeCatalogueItem(models.Model):
    """
    Catalogue of forklift/yard services that can be attached to a LaunchRequest
    as a PickTicket (e.g. antifoul check, wash-down, engine flush).
    """

    class ServiceTiming(models.TextChoices):
        BEFORE_LAUNCH   = 'before_launch',   'Before Launch'
        AFTER_RETRIEVAL = 'after_retrieval',  'After Retrieval'
        AT_PICKUP       = 'at_pickup',        'At Customer Pick-up'

    marina            = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='concierge_items')
    name              = models.CharField(max_length=200)
    description       = models.TextField(blank=True)
    timing            = models.CharField(max_length=20, choices=ServiceTiming.choices, default='before_launch')
    estimated_minutes = models.IntegerField(default=15)
    chargeable_item   = models.ForeignKey('billing.ChargeableItem', on_delete=models.PROTECT, related_name='concierge_items')
    is_active         = models.BooleanField(default=True)
    sort_order        = models.IntegerField(default=0)

    class Meta:
        ordering = ['sort_order', 'name']
        unique_together = ('marina', 'name')

    def __str__(self):
        return self.name


class PickTicket(models.Model):
    """One pick-ticket per LaunchRequest (1:1). Created when customer confirms."""

    launch_request = models.OneToOneField(LaunchRequest, on_delete=models.CASCADE, related_name='pick_ticket')
    created_at     = models.DateTimeField(auto_now_add=True)
    completed_at   = models.DateTimeField(null=True, blank=True)
    assigned_to    = models.CharField(max_length=200, blank=True)

    def __str__(self):
        return f'PickTicket #{self.pk} for LaunchRequest #{self.launch_request_id}'


class PickTicketLine(models.Model):
    class LineStatus(models.TextChoices):
        PENDING = 'pending', 'Pending'
        DONE    = 'done',    'Done'
        SKIPPED = 'skipped', 'Skipped'

    pick_ticket    = models.ForeignKey(PickTicket, on_delete=models.CASCADE, related_name='lines')
    catalogue_item = models.ForeignKey(ConciergeCatalogueItem, on_delete=models.PROTECT)
    status         = models.CharField(max_length=20, choices=LineStatus.choices, default='pending')
    completed_at   = models.DateTimeField(null=True, blank=True)
    invoice_line   = models.ForeignKey(
        'billing.InvoiceLineItem', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='pick_ticket_lines',
    )
    notes          = models.TextField(blank=True)

    class Meta:
        ordering = ['catalogue_item__sort_order']

    def __str__(self):
        return f'{self.catalogue_item.name} ({self.get_status_display()})'


# ---------------------------------------------------------------------------
# Track 6: Forklift device token
# ---------------------------------------------------------------------------

class ForkliftDeviceToken(models.Model):
    """
    Long-lived device token for a shared forklift tablet.

    Auth pattern: X-Forklift-Device-Token header.
    Operator identity is captured per-action via operator_pin or staff assignment —
    not via a per-session user context (the tablet is shared hardware).

    NEVER delete a retired token — set is_active=False to preserve the audit trail.
    Token value is generated server-side using secrets.token_urlsafe(48).
    """

    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='forklift_device_tokens')
    label        = models.CharField(max_length=100)
    token        = models.CharField(max_length=64, unique=True, db_index=True)
    is_active    = models.BooleanField(default=True)
    created_by   = models.ForeignKey('accounts.User', on_delete=models.SET_NULL, null=True, blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['label']

    def __str__(self):
        status = 'active' if self.is_active else 'revoked'
        return f'{self.label} ({status})'


# ---------------------------------------------------------------------------
# Track 6: Battery charge request
# ---------------------------------------------------------------------------

class BatteryChargeRequest(models.Model):
    class ChargeStatus(models.TextChoices):
        QUEUED      = 'queued',      'Queued'
        IN_PROGRESS = 'in_progress', 'Charging'
        COMPLETE    = 'complete',    'Complete'
        NOTIFIED    = 'notified',    'Owner Notified'

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='battery_charge_requests')
    vessel        = models.ForeignKey('vessels.Vessel', on_delete=models.PROTECT, related_name='battery_charge_requests')
    storage_slot  = models.ForeignKey(StorageSlot, on_delete=models.SET_NULL, null=True, blank=True)
    status        = models.CharField(max_length=20, choices=ChargeStatus.choices, default='queued')
    requested_at  = models.DateTimeField(auto_now_add=True)
    started_at    = models.DateTimeField(null=True, blank=True)
    completed_at  = models.DateTimeField(null=True, blank=True)
    notes         = models.TextField(blank=True)
    invoice_line  = models.ForeignKey(
        'billing.InvoiceLineItem', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='battery_charge_requests',
    )

    class Meta:
        ordering = ['requested_at']

    def __str__(self):
        return f'BatteryCharge — {self.vessel.name} ({self.get_status_display()})'


# ---------------------------------------------------------------------------
# Existing model
# ---------------------------------------------------------------------------

class Contractor(models.Model):
    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='contractors')
    name = models.CharField(max_length=200)
    trade = models.CharField(max_length=200, blank=True)
    working_on = models.CharField(max_length=200, blank=True)
    access_start = models.DateField()
    access_end = models.DateField(null=True, blank=True)
    vessel_owner = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ['access_start']

    def __str__(self):
        return self.name


# ---------------------------------------------------------------------------
# Track 5 — Advanced Boatyard Models
# ---------------------------------------------------------------------------

class WorkOrderTask(models.Model):
    class Status(models.TextChoices):
        NOT_STARTED = 'not_started', 'Not Started'
        IN_PROGRESS = 'in_progress', 'In Progress'
        COMPLETED   = 'completed',   'Completed'
        BLOCKED     = 'blocked',     'Blocked'

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='wo_tasks')
    work_order    = models.ForeignKey('WorkOrder', on_delete=models.CASCADE, related_name='tasks')
    title         = models.CharField(max_length=300)
    description   = models.TextField(blank=True)
    assigned_to   = models.CharField(max_length=200, blank=True)
    planned_start = models.DateField()
    planned_end   = models.DateField()
    actual_start  = models.DateField(null=True, blank=True)
    actual_end    = models.DateField(null=True, blank=True)
    baseline_start = models.DateField(null=True, blank=True)
    baseline_end   = models.DateField(null=True, blank=True)
    status           = models.CharField(max_length=20, choices=Status.choices, default=Status.NOT_STARTED)
    percent_complete = models.IntegerField(default=0)
    sort_order       = models.IntegerField(default=0)
    is_critical      = models.BooleanField(default=False)
    created_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['sort_order', 'planned_start']

    def clean(self):
        from django.core.exceptions import ValidationError
        if self.planned_end < self.planned_start:
            raise ValidationError('planned_end must be on or after planned_start.')

    def __str__(self):
        return f'{self.title} (WO-{self.work_order_id})'


class TaskDependency(models.Model):
    class DependencyType(models.TextChoices):
        FS = 'fs', 'Finish-to-Start'
        SS = 'ss', 'Start-to-Start'
        FF = 'ff', 'Finish-to-Finish'
        SF = 'sf', 'Start-to-Finish'

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='task_dependencies')
    predecessor = models.ForeignKey(WorkOrderTask, on_delete=models.CASCADE, related_name='successors')
    successor   = models.ForeignKey(WorkOrderTask, on_delete=models.CASCADE, related_name='predecessors')
    dependency_type = models.CharField(max_length=2, choices=DependencyType.choices, default=DependencyType.FS)
    lag_days = models.IntegerField(default=0)

    class Meta:
        unique_together = [('predecessor', 'successor')]

    def clean(self):
        from django.core.exceptions import ValidationError
        if self.predecessor_id == self.successor_id:
            raise ValidationError('A task cannot depend on itself.')

    def __str__(self):
        return f'Task {self.predecessor_id} → {self.successor_id} ({self.dependency_type})'


class BuildProject(models.Model):
    STATUS = [
        ('planning',   'Planning'),
        ('in_build',   'In Build'),
        ('sea_trials', 'Sea Trials'),
        ('completed',  'Completed'),
        ('on_hold',    'On Hold'),
    ]

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='build_projects')
    work_order    = models.OneToOneField('WorkOrder', on_delete=models.PROTECT, related_name='build_project')
    vessel        = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True, related_name='build_project')
    project_name  = models.CharField(max_length=300)
    hull_number   = models.CharField(max_length=100, blank=True)
    vessel_type   = models.CharField(max_length=200, blank=True)
    loa_m         = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    contract_value = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    status        = models.CharField(max_length=20, choices=STATUS, default='planning')
    keel_laid_date     = models.DateField(null=True, blank=True)
    launch_target_date = models.DateField(null=True, blank=True)
    actual_launch_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ['-keel_laid_date']

    def __str__(self):
        return self.project_name


class BOMItem(models.Model):
    class ProcurementStatus(models.TextChoices):
        NOT_ORDERED = 'not_ordered', 'Not Ordered'
        ORDERED     = 'ordered',     'Ordered'
        RECEIVED    = 'received',    'Received'
        CONSUMED    = 'consumed',    'Consumed'

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='bom_items')
    build_project = models.ForeignKey(BuildProject, on_delete=models.CASCADE, related_name='bom_items')
    part          = models.ForeignKey('Part', on_delete=models.SET_NULL, null=True, blank=True)
    description   = models.CharField(max_length=300)
    quantity      = models.DecimalField(max_digits=10, decimal_places=3)
    unit          = models.CharField(max_length=50, blank=True)
    unit_cost_at_order = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    supplier      = models.CharField(max_length=200, blank=True)
    procurement_status = models.CharField(max_length=20, choices=ProcurementStatus.choices, default=ProcurementStatus.NOT_ORDERED)
    expected_delivery  = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ['description']

    @property
    def line_cost(self):
        if self.unit_cost_at_order and self.quantity:
            return self.unit_cost_at_order * self.quantity
        return None

    def __str__(self):
        return self.description


class BuildMilestone(models.Model):
    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='build_milestones')
    build_project = models.ForeignKey(BuildProject, on_delete=models.CASCADE, related_name='milestones')
    name          = models.CharField(max_length=200)
    description   = models.TextField(blank=True)
    planned_date  = models.DateField()
    actual_date   = models.DateField(null=True, blank=True)
    payment_amount   = models.DecimalField(max_digits=12, decimal_places=2)
    payment_due_days = models.IntegerField(default=14)
    # FK to billing.Invoice — requires billing app migration to be applied first.
    invoice = models.OneToOneField(
        'billing.Invoice', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='build_milestone',
    )
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ['sort_order', 'planned_date']

    def __str__(self):
        return f'{self.name} ({self.build_project})'


class JobTemplate(models.Model):
    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='job_templates')
    name        = models.CharField(max_length=300)
    category    = models.CharField(max_length=100, blank=True)
    description = models.TextField(blank=True)
    is_active   = models.BooleanField(default=True)
    estimated_total_hours = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    created_at  = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class JobTemplateTask(models.Model):
    template      = models.ForeignKey(JobTemplate, on_delete=models.CASCADE, related_name='tasks')
    title         = models.CharField(max_length=300)
    description   = models.TextField(blank=True)
    duration_days = models.IntegerField(default=1)
    estimated_hours = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    sort_order    = models.IntegerField(default=0)

    class Meta:
        ordering = ['sort_order']

    def __str__(self):
        return self.title


class JobTemplatePart(models.Model):
    template    = models.ForeignKey(JobTemplate, on_delete=models.CASCADE, related_name='parts')
    part        = models.ForeignKey('Part', on_delete=models.SET_NULL, null=True, blank=True)
    description = models.CharField(max_length=300)
    quantity    = models.DecimalField(max_digits=10, decimal_places=3, default=1)

    class Meta:
        ordering = ['description']

    def __str__(self):
        return self.description


class BatchJobPost(models.Model):
    marina    = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='batch_posts')
    posted_by = models.CharField(max_length=200, blank=True)
    posted_at = models.DateTimeField(auto_now_add=True)
    notes     = models.TextField(blank=True)

    class Meta:
        ordering = ['-posted_at']

    def __str__(self):
        return f'BatchPost #{self.pk} by {self.posted_by}'


class BatchJobPostLine(models.Model):
    batch           = models.ForeignKey(BatchJobPost, on_delete=models.CASCADE, related_name='lines')
    work_order      = models.ForeignKey('WorkOrder', on_delete=models.CASCADE, related_name='batch_lines')
    work_order_task = models.ForeignKey(WorkOrderTask, on_delete=models.SET_NULL, null=True, blank=True, related_name='post_lines')
    hours           = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    material_cost   = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    description     = models.CharField(max_length=300, blank=True)

    def __str__(self):
        return f'Line #{self.pk} — WO-{self.work_order_id}'


class WarrantyAgreement(models.Model):
    marina            = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='warranty_agreements')
    manufacturer_name = models.CharField(max_length=200)
    contact_name      = models.CharField(max_length=200, blank=True)
    contact_email     = models.EmailField(blank=True)
    contact_phone     = models.CharField(max_length=50, blank=True)
    covers_parts      = models.BooleanField(default=True)
    covers_labour     = models.BooleanField(default=False)
    labour_rate_cap   = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    reimbursement_rate_pct = models.DecimalField(max_digits=5, decimal_places=2, default=100)
    avg_processing_days    = models.IntegerField(null=True, blank=True)
    submission_instructions = models.TextField(blank=True)
    pdf_template_url  = models.URLField(blank=True)
    is_active         = models.BooleanField(default=True)
    created_at        = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['manufacturer_name']

    def __str__(self):
        return self.manufacturer_name


class WarrantyClaim(models.Model):
    class Status(models.TextChoices):
        DRAFT        = 'draft',        'Draft'
        SUBMITTED    = 'submitted',    'Submitted'
        ACKNOWLEDGED = 'acknowledged', 'Acknowledged'
        APPROVED     = 'approved',     'Approved'
        REIMBURSED   = 'reimbursed',   'Reimbursed'
        REJECTED     = 'rejected',     'Rejected'
        CLOSED       = 'closed',       'Closed'

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='warranty_claims')
    agreement   = models.ForeignKey(WarrantyAgreement, on_delete=models.PROTECT, related_name='claims')
    work_order  = models.ForeignKey('WorkOrder', on_delete=models.PROTECT, related_name='warranty_claims')
    claim_reference   = models.CharField(max_length=100, blank=True)
    parts_claimed     = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    labour_claimed    = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_claimed     = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    amount_reimbursed = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    status        = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    submitted_at  = models.DateTimeField(null=True, blank=True)
    reimbursed_at = models.DateTimeField(null=True, blank=True)
    claim_document_url = models.URLField(blank=True)
    journal_entry = models.OneToOneField(
        'accounting.JournalEntry',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='warranty_claim',
    )
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ['-submitted_at']

    @property
    def variance(self):
        if self.amount_reimbursed is not None:
            return self.total_claimed - self.amount_reimbursed
        return None

    def __str__(self):
        return f'WarrantyClaim #{self.pk} ({self.status})'


class SupplierPriceFile(models.Model):
    class ImportFormat(models.TextChoices):
        CSV = 'csv', 'CSV'
        EDI = 'edi', 'EDI'
        API = 'api', 'API Feed'

    class ImportStatus(models.TextChoices):
        PENDING_MAPPING = 'pending_mapping', 'Pending Column Mapping'
        QUEUED          = 'queued',          'Queued'
        PROCESSING      = 'processing',      'Processing'
        COMPLETED       = 'completed',       'Completed'
        FAILED          = 'failed',          'Failed'

    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='price_files')
    supplier_name  = models.CharField(max_length=200)
    import_format  = models.CharField(max_length=10, choices=ImportFormat.choices)
    file_url       = models.URLField(blank=True)
    api_endpoint   = models.URLField(blank=True)
    flag_threshold_pct = models.DecimalField(max_digits=5, decimal_places=2, default=10)
    status         = models.CharField(max_length=20, choices=ImportStatus.choices, default=ImportStatus.PENDING_MAPPING)
    rows_processed = models.IntegerField(default=0)
    rows_updated   = models.IntegerField(default=0)
    rows_flagged   = models.IntegerField(default=0)
    error_detail   = models.TextField(blank=True)
    imported_by    = models.CharField(max_length=200, blank=True)
    queued_at      = models.DateTimeField(auto_now_add=True)
    completed_at   = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-queued_at']

    def __str__(self):
        return f'{self.supplier_name} ({self.status})'


class SupplierColumnMap(models.Model):
    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='supplier_column_maps')
    supplier_name = models.CharField(max_length=200)
    mapping       = models.JSONField(default=dict)
    updated_at    = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('marina', 'supplier_name')]

    def __str__(self):
        return f'ColumnMap: {self.supplier_name} (marina {self.marina_id})'


class PartPriceHistory(models.Model):
    marina     = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='part_price_history')
    part       = models.ForeignKey('Part', on_delete=models.CASCADE, related_name='price_history')
    price_file = models.ForeignKey(SupplierPriceFile, on_delete=models.SET_NULL, null=True, blank=True, related_name='price_changes')
    old_unit_cost = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    new_unit_cost = models.DecimalField(max_digits=8, decimal_places=2)
    change_pct    = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    is_flagged    = models.BooleanField(default=False)
    applied       = models.BooleanField(default=False)
    recorded_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-recorded_at']

    def __str__(self):
        return f'PriceHistory: {self.part} @ {self.recorded_at:%Y-%m-%d}'


class Location(models.Model):
    class LocationType(models.TextChoices):
        WAREHOUSE = 'warehouse', 'Main Warehouse'
        TRUCK     = 'truck',     'Service Truck'

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='locations')
    location_type = models.CharField(max_length=20, choices=LocationType.choices)
    name          = models.CharField(max_length=200)

    class Meta:
        ordering = ['location_type', 'name']

    def __str__(self):
        return f'{self.name} ({self.location_type})'


class ServiceTruck(models.Model):
    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='service_trucks')
    location     = models.OneToOneField(Location, on_delete=models.PROTECT, related_name='truck')
    registration = models.CharField(max_length=50, blank=True)
    assigned_to  = models.CharField(max_length=200, blank=True)
    is_active    = models.BooleanField(default=True)

    class Meta:
        ordering = ['location__name']

    def __str__(self):
        return f'{self.location.name} ({self.registration})'


class InventoryLevel(models.Model):
    marina   = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='inventory_levels')
    part     = models.ForeignKey('Part', on_delete=models.CASCADE, related_name='inventory_levels')
    location = models.ForeignKey(Location, on_delete=models.CASCADE, related_name='inventory_levels')
    quantity = models.DecimalField(max_digits=10, decimal_places=3, default=0)
    par      = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True)

    class Meta:
        unique_together = [('part', 'location')]
        ordering = ['location', 'part']

    def __str__(self):
        return f'{self.part} @ {self.location} (qty={self.quantity})'


class InventoryAnomaly(models.Model):
    class Status(models.TextChoices):
        OPEN     = 'open',     'Open — Cycle Count Required'
        RESOLVED = 'resolved', 'Resolved'

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='inventory_anomalies')
    inventory_level = models.ForeignKey(InventoryLevel, on_delete=models.CASCADE, related_name='anomalies')
    transfer        = models.ForeignKey(
        'TruckStockTransfer', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='anomalies',
    )
    quantity_after  = models.DecimalField(max_digits=10, decimal_places=3)
    status          = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    resolved_by     = models.CharField(max_length=200, blank=True)
    resolved_at     = models.DateTimeField(null=True, blank=True)
    created_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Anomaly #{self.pk} ({self.status})'


class TruckStockTransfer(models.Model):
    class Direction(models.TextChoices):
        TO_TRUCK   = 'to_truck',   'Warehouse → Truck'
        FROM_TRUCK = 'from_truck', 'Truck → Warehouse'

    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='truck_transfers')
    truck          = models.ForeignKey(ServiceTruck, on_delete=models.CASCADE, related_name='transfers')
    part           = models.ForeignKey('Part', on_delete=models.CASCADE, related_name='truck_transfers')
    direction      = models.CharField(max_length=20, choices=Direction.choices)
    quantity       = models.DecimalField(max_digits=10, decimal_places=3)
    transferred_by = models.CharField(max_length=200, blank=True)
    transferred_at = models.DateTimeField(auto_now_add=True)
    notes          = models.TextField(blank=True)

    class Meta:
        ordering = ['-transferred_at']

    def __str__(self):
        return f'Transfer #{self.pk}: {self.direction} {self.quantity}× {self.part}'


# ---------------------------------------------------------------------------
# Track 5 — Service Operations (new models, require migration)
# ---------------------------------------------------------------------------

class ServiceBay(models.Model):
    """Physical service bays / work areas in the boatyard."""
    class BayType(models.TextChoices):
        GENERAL    = 'general',    'General'
        ELECTRICAL = 'electrical', 'Electrical'
        MECHANICAL = 'mechanical', 'Mechanical'
        PAINT      = 'paint',      'Paint / Spray'
        WELDING    = 'welding',    'Welding'
        RIGGING    = 'rigging',    'Rigging'

    marina    = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                   related_name='service_bays')
    name      = models.CharField(max_length=200)
    bay_type  = models.CharField(max_length=20, choices=BayType.choices, default=BayType.GENERAL)
    capacity  = models.DecimalField(max_digits=6, decimal_places=1, null=True, blank=True,
                                    help_text='Max LOA in metres')
    is_active = models.BooleanField(default=True)
    notes     = models.TextField(blank=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f'{self.name} ({self.bay_type})'


class LiftOperation(models.Model):
    """Individual crane / travelift operations (distinct from simple HaulOut scheduling)."""
    class LiftType(models.TextChoices):
        HAUL_OUT    = 'haul_out',    'Haul-out'
        SPLASH      = 'splash',      'Splash / Launch'
        TRAVEL_LIFT = 'travel_lift', 'Travel Lift Transfer'
        CRANE       = 'crane',       'Crane Lift'

    class Status(models.TextChoices):
        SCHEDULED  = 'scheduled',  'Scheduled'
        IN_PROGRESS = 'in_progress', 'In Progress'
        COMPLETED  = 'completed',  'Completed'
        CANCELLED  = 'cancelled',  'Cancelled'

    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                      related_name='lift_operations')
    vessel       = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL,
                                      null=True, blank=True, related_name='lift_operations')
    lift_type    = models.CharField(max_length=20, choices=LiftType.choices)
    status       = models.CharField(max_length=20, choices=Status.choices, default=Status.SCHEDULED)
    scheduled_at = models.DateTimeField()
    completed_at = models.DateTimeField(null=True, blank=True)
    equipment    = models.CharField(max_length=200, blank=True)
    operator     = models.CharField(max_length=200, blank=True)
    boat_weight_t = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    notes        = models.TextField(blank=True)

    class Meta:
        ordering = ['-scheduled_at']

    def __str__(self):
        return f'{self.lift_type} — {self.scheduled_at.date()}'


class PaintRecord(models.Model):
    """Paint application records for vessels."""
    class PaintType(models.TextChoices):
        ANTIFOUL = 'antifoul', 'Antifoul'
        TOPSIDE  = 'topside',  'Topside'
        PRIMER   = 'primer',   'Primer'
        GELCOAT  = 'gelcoat',  'Gelcoat'
        VARNISH  = 'varnish',  'Varnish'
        OTHER    = 'other',    'Other'

    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                      related_name='paint_records')
    vessel       = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL,
                                      null=True, blank=True, related_name='paint_records')
    paint_type   = models.CharField(max_length=20, choices=PaintType.choices)
    product_name = models.CharField(max_length=200, blank=True)
    colour       = models.CharField(max_length=100, blank=True)
    applied_date = models.DateField()
    applied_by   = models.CharField(max_length=200, blank=True)
    coats        = models.PositiveIntegerField(default=1)
    area_sqm     = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    notes        = models.TextField(blank=True)

    class Meta:
        ordering = ['-applied_date']

    def __str__(self):
        return f'{self.paint_type} on {self.vessel or "unknown"} — {self.applied_date}'


class PartsInventoryItem(models.Model):
    """
    Boatyard-specific parts inventory (distinct from the core Part model which is
    work-order consumables). Tracks stock, reorder levels, and supplier info.
    """
    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                       related_name='parts_inventory')
    name          = models.CharField(max_length=300)
    sku           = models.CharField(max_length=100, blank=True)
    category      = models.CharField(max_length=100, blank=True)
    supplier      = models.CharField(max_length=200, blank=True)
    unit_cost     = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    quantity      = models.PositiveIntegerField(default=0)
    reorder_point = models.PositiveIntegerField(default=0)
    location      = models.CharField(max_length=200, blank=True)
    is_active     = models.BooleanField(default=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f'{self.name} ({self.quantity} in stock)'


class Subcontractor(models.Model):
    """External subcontractors and specialist firms used by the boatyard."""
    marina            = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE,
                                          related_name='subcontractors')
    company           = models.CharField(max_length=300)
    contact_name      = models.CharField(max_length=200, blank=True)
    email             = models.EmailField(blank=True)
    phone             = models.CharField(max_length=50, blank=True)
    trade             = models.CharField(max_length=200, blank=True,
                                          help_text='e.g. Marine Electrical, Rigging')
    hourly_rate       = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    insurance_expiry  = models.DateField(null=True, blank=True)
    is_active         = models.BooleanField(default=True)
    notes             = models.TextField(blank=True)

    class Meta:
        ordering = ['company']

    def __str__(self):
        return self.company
