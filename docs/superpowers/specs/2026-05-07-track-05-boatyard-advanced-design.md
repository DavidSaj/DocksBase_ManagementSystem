# Track 5 — Boatyard Advanced Features: Design Spec
Date: 2026-05-07
Scope: Boatyard app extensions covering Gantt chart project management, task dependencies and critical path, boat builder / shipyard manufacturing, job packages and template catalogue, batch job posting, warranty management, automatic supplier price file updates, and mobile service truck inventory.

> Spec status: Final — reviewed 2026-05-08

---

## 1. Architectural Goal

The existing `boatyard` app has a solid operational foundation: `WorkOrder`, `Part`, `Tool`, `Contractor`, `HaulOut`, `StorageSlot`, and `LaunchRequest`. Track 5 extends this app into long-duration project management and supply chain territory without replacing or restructuring what exists.

Four design principles govern this track:

1. **Additive, not disruptive.** Every new model is a new table or an additive FK relationship on an existing table. Existing `WorkOrder` rows continue to work unchanged. The Gantt view is a view-mode toggle within the existing Work Orders tab, not a new top-level tab.

2. **Single inventory catalogue, normalised stock levels.** The existing `Part` model represents the catalogue item (name, SKU, price). An `InventoryLevel` pivot model tracks quantity per location (warehouse or truck). There is no separate `TruckPart` model and no split-row strategy.

3. **Background-heavy.** Supplier price imports, warranty claim PDF generation, and critical-path recalculation are async Celery tasks. The API returns a job ID immediately; the client polls or reads the pre-computed result. This keeps the request cycle under the 30-second gateway timeout for large CSV files and prevents Gantt endpoint latency from growing with task-graph size.

4. **Append-only time and materials ledger.** `BatchJobPostLine` is the canonical record of hours and materials charged. `WorkOrder.actual_hours` is computed as an aggregate on read — it is never mutated directly.

---

## 2. Data Models (Django class definitions)

All models live in `backend/apps/boatyard/`. All have `marina = ForeignKey('accounts.Marina', on_delete=models.CASCADE)` unless otherwise noted (the cross-reference is explicit in each class below for implementer clarity).

### 2.1 WorkOrderTask

Sub-tasks within a `WorkOrder`. The Gantt chart renders rows from this model, not from `WorkOrder` directly. The `is_critical` field is written by a Celery task whenever tasks or dependencies change — the Gantt endpoint reads it directly without recomputing.

```python
class WorkOrderTask(models.Model):
    """A schedulable unit of work within a WorkOrder. Gantt rows."""

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='wo_tasks')
    work_order  = models.ForeignKey('WorkOrder', on_delete=models.CASCADE, related_name='tasks')
    title       = models.CharField(max_length=300)
    description = models.TextField(blank=True)

    assigned_to = models.CharField(max_length=200, blank=True)

    planned_start = models.DateField()
    planned_end   = models.DateField()
    actual_start  = models.DateField(null=True, blank=True)
    actual_end    = models.DateField(null=True, blank=True)

    # Baseline is written once when the manager locks the schedule.
    # It never changes after that — it is the comparison reference.
    baseline_start = models.DateField(null=True, blank=True)
    baseline_end   = models.DateField(null=True, blank=True)

    class Status(models.TextChoices):
        NOT_STARTED = 'not_started', 'Not Started'
        IN_PROGRESS = 'in_progress', 'In Progress'
        COMPLETED   = 'completed',   'Completed'
        BLOCKED     = 'blocked',     'Blocked'

    status           = models.CharField(max_length=20, choices=Status.choices, default=Status.NOT_STARTED)
    percent_complete = models.IntegerField(default=0)  # 0–100
    sort_order       = models.IntegerField(default=0)  # controls row order in Gantt

    # Written by Celery task recalculate_critical_path; read by the Gantt endpoint.
    is_critical = models.BooleanField(default=False)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['sort_order', 'planned_start']

    def __str__(self):
        return f'{self.work_order_id} — {self.title}'

    def clean(self):
        if self.planned_end < self.planned_start:
            raise ValidationError('planned_end must be on or after planned_start.')
```

### 2.2 TaskDependency

Encodes finish-to-start (and future dependency types) between `WorkOrderTask` rows. Cycle detection runs in the serializer, not in `clean()`, because it requires a database query across the full dependency graph.

The `dependency_type` field is included now to future-proof the schema. In v1 the serializer rejects any value other than `fs`; Gantt rendering enforces only `fs` semantics.

```python
class TaskDependency(models.Model):
    """Predecessor → successor dependency link."""

    class DependencyType(models.TextChoices):
        FS = 'fs', 'Finish-to-Start'
        SS = 'ss', 'Start-to-Start'
        FF = 'ff', 'Finish-to-Finish'
        SF = 'sf', 'Start-to-Finish'

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='task_dependencies')
    predecessor = models.ForeignKey(WorkOrderTask, on_delete=models.CASCADE, related_name='successors')
    successor   = models.ForeignKey(WorkOrderTask, on_delete=models.CASCADE, related_name='predecessors')

    dependency_type = models.CharField(
        max_length=2,
        choices=DependencyType.choices,
        default=DependencyType.FS,
        help_text='Only fs is enforced in v1. ss/ff/sf are stored but not yet rendered.'
    )
    lag_days = models.IntegerField(default=0, help_text='Positive = delay after predecessor ends.')

    class Meta:
        unique_together = [('predecessor', 'successor')]

    def clean(self):
        if self.predecessor_id == self.successor_id:
            raise ValidationError('A task cannot depend on itself.')
```

### 2.3 BuildProject

A specialised work-order type for boat construction or major refits. One `BuildProject` always owns exactly one `WorkOrder` (the scheduling container).

```python
class BuildProject(models.Model):
    """Boat builder / shipyard construction project."""

    STATUS = [
        ('planning',    'Planning'),
        ('in_build',    'In Build'),
        ('sea_trials',  'Sea Trials'),
        ('completed',   'Completed'),
        ('on_hold',     'On Hold'),
    ]

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='build_projects')
    work_order  = models.OneToOneField('WorkOrder', on_delete=models.PROTECT, related_name='build_project')
    vessel      = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True,
                                    related_name='build_project',
                                    help_text='Populated once the vessel is registered (may be null during build).')

    project_name  = models.CharField(max_length=300)
    hull_number   = models.CharField(max_length=100, blank=True)
    vessel_type   = models.CharField(max_length=200, blank=True)
    loa_m         = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    contract_value = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    status        = models.CharField(max_length=20, choices=STATUS, default='planning')

    keel_laid_date    = models.DateField(null=True, blank=True)
    launch_target_date = models.DateField(null=True, blank=True)
    actual_launch_date = models.DateField(null=True, blank=True)

    notes = models.TextField(blank=True)

    class Meta:
        ordering = ['-keel_laid_date']

    def __str__(self):
        return self.project_name
```

### 2.4 BOMItem (Bill of Materials)

```python
class BOMItem(models.Model):
    """One line in a build project's Bill of Materials."""

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='bom_items')
    build_project = models.ForeignKey(BuildProject, on_delete=models.CASCADE, related_name='bom_items')
    part          = models.ForeignKey('Part', on_delete=models.SET_NULL, null=True, blank=True,
                                      help_text='Link to Part catalogue; null for bespoke items.')
    description   = models.CharField(max_length=300)
    quantity      = models.DecimalField(max_digits=10, decimal_places=3)
    unit          = models.CharField(max_length=50, blank=True, help_text='e.g. kg, m, unit')

    unit_cost_at_order = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    supplier           = models.CharField(max_length=200, blank=True)

    class ProcurementStatus(models.TextChoices):
        NOT_ORDERED = 'not_ordered', 'Not Ordered'
        ORDERED     = 'ordered',     'Ordered'
        RECEIVED    = 'received',    'Received'
        CONSUMED    = 'consumed',    'Consumed'

    procurement_status = models.CharField(max_length=20, choices=ProcurementStatus.choices, default=ProcurementStatus.NOT_ORDERED)
    expected_delivery  = models.DateField(null=True, blank=True)

    class Meta:
        ordering = ['description']

    @property
    def line_cost(self):
        if self.unit_cost_at_order and self.quantity:
            return self.unit_cost_at_order * self.quantity
        return None
```

### 2.5 BuildMilestone

Stage payment trigger points within a `BuildProject`. Completing a milestone creates a `billing.Invoice` via the existing invoice pipeline — no separate `BuildInvoice` model is introduced. The `invoice` OneToOneField bridges the project management domain to the financial domain cleanly without forking the billing pipeline.

```python
class BuildMilestone(models.Model):
    """A contractual milestone that triggers a stage payment invoice."""

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='build_milestones')
    build_project = models.ForeignKey(BuildProject, on_delete=models.CASCADE, related_name='milestones')

    name             = models.CharField(max_length=200)  # e.g. 'Keel Laid', 'Hull Complete'
    description      = models.TextField(blank=True)
    planned_date     = models.DateField()
    actual_date      = models.DateField(null=True, blank=True)
    payment_amount   = models.DecimalField(max_digits=12, decimal_places=2)
    payment_due_days = models.IntegerField(default=14, help_text='Days after milestone achieved before payment is due.')

    # FK to billing.Invoice created when milestone is marked complete.
    invoice = models.OneToOneField(
        'billing.Invoice', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='build_milestone'
    )
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ['sort_order', 'planned_date']

    def __str__(self):
        return f'{self.build_project.project_name} — {self.name}'
```

### 2.6 JobTemplate

A reusable bundle of tasks and parts that seeds a new `WorkOrder` quickly.

```python
class JobTemplate(models.Model):
    """A saved bundle of tasks + parts for quick work order entry."""

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='job_templates')
    name        = models.CharField(max_length=300)   # e.g. 'Annual Service — Inboard Diesel'
    category    = models.CharField(max_length=100, blank=True)
    description = models.TextField(blank=True)
    is_active   = models.BooleanField(default=True)

    # Estimated total labour hours across all template tasks
    estimated_total_hours = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class JobTemplateTask(models.Model):
    """One task row within a JobTemplate."""

    template    = models.ForeignKey(JobTemplate, on_delete=models.CASCADE, related_name='tasks')
    title       = models.CharField(max_length=300)
    description = models.TextField(blank=True)
    duration_days = models.IntegerField(default=1)
    estimated_hours = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    sort_order  = models.IntegerField(default=0)

    class Meta:
        ordering = ['sort_order']


class JobTemplatePart(models.Model):
    """One part / material line within a JobTemplate."""

    template  = models.ForeignKey(JobTemplate, on_delete=models.CASCADE, related_name='parts')
    part      = models.ForeignKey('Part', on_delete=models.SET_NULL, null=True, blank=True)
    description = models.CharField(max_length=300)  # fallback if part is null
    quantity  = models.DecimalField(max_digits=10, decimal_places=3, default=1)

    class Meta:
        ordering = ['description']
```

### 2.7 BatchJobPost

Records a batch time-and-materials posting across multiple work orders. `BatchJobPostLine` is the canonical, append-only ledger of hours and materials. `WorkOrder.actual_hours` is never mutated directly — it is computed at query time as `Sum('batch_lines__hours')`.

```python
class BatchJobPost(models.Model):
    """A single posting operation that fans out to many WorkOrders."""

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='batch_posts')
    posted_by   = models.CharField(max_length=200, blank=True)
    posted_at   = models.DateTimeField(auto_now_add=True)
    notes       = models.TextField(blank=True)

    class Meta:
        ordering = ['-posted_at']


class BatchJobPostLine(models.Model):
    """
    One work order's allocation within a BatchJobPost. Canonical time ledger.

    work_order_task links the posting to a specific Gantt task. When tasks exist
    on a work order, the posting UI must surface the task picker so mechanics
    select which task they are billing time against. This field is optional to
    remain backwards-compatible with simple single-task work orders, but it is
    the only way for the Gantt chart to show task-level actual_hours / actual_cost
    in tooltips. Without it the Gantt is a schedule-only chart with no financial
    intelligence attached to individual tasks.
    """

    batch         = models.ForeignKey(BatchJobPost, on_delete=models.CASCADE, related_name='lines')
    work_order    = models.ForeignKey('WorkOrder', on_delete=models.CASCADE, related_name='batch_lines')
    # Optional — required by the UI when the work order has WorkOrderTask rows
    work_order_task = models.ForeignKey(
        'WorkOrderTask', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='post_lines',
        help_text='Which Gantt task this posting is billed against. '
                  'Required when the work order has tasks; optional otherwise.',
    )
    hours         = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    material_cost = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    description   = models.CharField(max_length=300, blank=True)
```

### 2.8 WarrantyAgreement

Manufacturer-level warranty terms. The `pdf_template_url` field stores the path to the manufacturer's official fillable PDF form, uploaded by the yard manager. The Celery PDF generation task stamps WorkOrder variables onto this form rather than generating a generic DocksBase-branded document.

```python
class WarrantyAgreement(models.Model):
    """Terms of a warranty arrangement with one manufacturer or supplier."""

    marina            = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='warranty_agreements')
    manufacturer_name = models.CharField(max_length=200)
    contact_name      = models.CharField(max_length=200, blank=True)
    contact_email     = models.EmailField(blank=True)
    contact_phone     = models.CharField(max_length=50, blank=True)

    covers_parts   = models.BooleanField(default=True)
    covers_labour  = models.BooleanField(default=False)
    labour_rate_cap = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True,
                                          help_text='Max hourly labour rate reimbursed by manufacturer.')
    reimbursement_rate_pct = models.DecimalField(max_digits=5, decimal_places=2, default=100,
                                                  help_text='% of claim reimbursed (e.g. 80 for 80%).')
    avg_processing_days = models.IntegerField(null=True, blank=True)
    submission_instructions = models.TextField(blank=True)

    # Manager uploads the manufacturer's official fillable PDF claim form here.
    # The Celery task stamps WorkOrder data onto this template.
    # If null, a standard DocksBase PDF is generated as fallback.
    pdf_template_url = models.URLField(
        blank=True,
        help_text='S3/media path for the manufacturer\'s official claim PDF template.'
    )

    is_active  = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['manufacturer_name']

    def __str__(self):
        return self.manufacturer_name
```

### 2.9 WarrantyClaim

One claim submission against a `WarrantyAgreement`, linked to a `WorkOrder`.

```python
class WarrantyClaim(models.Model):
    """A warranty claim submitted to a manufacturer."""

    class Status(models.TextChoices):
        DRAFT       = 'draft',       'Draft'
        SUBMITTED   = 'submitted',   'Submitted'
        ACKNOWLEDGED = 'acknowledged', 'Acknowledged'
        APPROVED    = 'approved',    'Approved'
        REIMBURSED  = 'reimbursed',  'Reimbursed'
        REJECTED    = 'rejected',    'Rejected'
        CLOSED      = 'closed',      'Closed'

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='warranty_claims')
    agreement   = models.ForeignKey(WarrantyAgreement, on_delete=models.PROTECT, related_name='claims')
    work_order  = models.ForeignKey('WorkOrder', on_delete=models.PROTECT, related_name='warranty_claims')

    claim_reference   = models.CharField(max_length=100, blank=True, help_text='Manufacturer reference number.')
    parts_claimed     = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    labour_claimed    = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_claimed     = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    amount_reimbursed = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)

    status     = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    submitted_at   = models.DateTimeField(null=True, blank=True)
    reimbursed_at  = models.DateTimeField(null=True, blank=True)

    # PDF document stored via S3; URL set by the Celery generation task.
    claim_document_url = models.URLField(blank=True)

    # GL linkage — set automatically when status transitions to 'reimbursed'.
    # A warranty reimbursement is a financial event: manufacturer pays the marina
    # real money. Without a JournalEntry the AR record is missing from the GL,
    # the marina's bank reconciliation will show an unexplained €2,500 receipt,
    # and the financial audit will fail.
    # The journal entry credits a "Warranty Revenue / COGS Offset" GL account
    # and debits the marina's AR or bank clearing account.
    journal_entry = models.OneToOneField(
        'billing.JournalEntry', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='warranty_claim',
        help_text='Set automatically when status transitions to reimbursed.',
    )

    notes = models.TextField(blank=True)

    class Meta:
        ordering = ['-submitted_at']

    @property
    def variance(self):
        """Positive = marina absorbed the difference; negative = over-reimbursed."""
        if self.amount_reimbursed is not None:
            return self.total_claimed - self.amount_reimbursed
        return None
```

### 2.10 SupplierPriceFile

Import job metadata. Per-part price history is stored in `PartPriceHistory`. Column mapping is persisted per supplier in `SupplierColumnMap` so the manager only completes the mapping wizard once per supplier.

```python
class SupplierPriceFile(models.Model):
    """Record of one supplier price file import job."""

    class ImportFormat(models.TextChoices):
        CSV = 'csv', 'CSV'
        EDI = 'edi', 'EDI (EDIFACT/X12)'
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
    file_url       = models.URLField(blank=True, help_text='S3/media path for uploaded file.')
    api_endpoint   = models.URLField(blank=True, help_text='Populated for API-format feeds.')

    # Threshold above which a price increase is flagged for manager review (%).
    flag_threshold_pct = models.DecimalField(max_digits=5, decimal_places=2, default=10)

    status         = models.CharField(max_length=20, choices=ImportStatus.choices, default=ImportStatus.PENDING_MAPPING)
    rows_processed = models.IntegerField(default=0)
    rows_updated   = models.IntegerField(default=0)
    rows_flagged   = models.IntegerField(default=0)
    error_detail   = models.TextField(blank=True)

    imported_by  = models.CharField(max_length=200, blank=True)
    queued_at    = models.DateTimeField(auto_now_add=True)
    completed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ['-queued_at']


class SupplierColumnMap(models.Model):
    """Saved column-mapping for a supplier's CSV format. Written by the mapping wizard."""

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='supplier_column_maps')
    supplier_name = models.CharField(max_length=200)

    # Stores a JSON object mapping DocksBase field names to supplier CSV column headers.
    # e.g. {"part_no": "SKU_NUM", "unit_cost": "PRICE_EX_VAT", "supplier": "VENDOR"}
    mapping       = models.JSONField(default=dict)

    updated_at    = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('marina', 'supplier_name')]

    def __str__(self):
        return f'{self.supplier_name} column map'


class PartPriceHistory(models.Model):
    """One price change record on a Part, created by an import or manual edit."""

    marina     = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='part_price_history')
    part       = models.ForeignKey('Part', on_delete=models.CASCADE, related_name='price_history')
    price_file = models.ForeignKey(SupplierPriceFile, on_delete=models.SET_NULL,
                                   null=True, blank=True, related_name='price_changes',
                                   help_text='Null for manual price edits.')
    old_unit_cost = models.DecimalField(max_digits=8, decimal_places=2, null=True, blank=True)
    new_unit_cost = models.DecimalField(max_digits=8, decimal_places=2)
    change_pct    = models.DecimalField(max_digits=7, decimal_places=2, null=True, blank=True)
    is_flagged    = models.BooleanField(default=False)
    applied       = models.BooleanField(default=False,
                                        help_text='False = pending manager approval for flagged increases.')
    recorded_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-recorded_at']
```

### 2.11 Location, InventoryLevel, and ServiceTruck

The `Part` model represents the catalogue item (name, SKU, price). Inventory quantities per physical location are tracked by an `InventoryLevel` pivot model. A `Location` record can be the main warehouse or any `ServiceTruck`. This design keeps catalogue data clean: price changes on `Part` propagate correctly to all location stock without orphaned rows.

```python
class Location(models.Model):
    """A physical inventory location — either the main warehouse or a service truck."""

    class LocationType(models.TextChoices):
        WAREHOUSE = 'warehouse', 'Main Warehouse'
        TRUCK     = 'truck',     'Service Truck'

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='locations')
    location_type = models.CharField(max_length=20, choices=LocationType.choices)
    name          = models.CharField(max_length=200)  # e.g. 'Main Warehouse', 'Van 1 — Marine Electric'

    class Meta:
        ordering = ['location_type', 'name']

    def __str__(self):
        return self.name


class ServiceTruck(models.Model):
    """A mobile service vehicle. Linked to a Location record for inventory purposes."""

    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='service_trucks')
    location     = models.OneToOneField(Location, on_delete=models.PROTECT, related_name='truck')
    registration = models.CharField(max_length=50, blank=True)
    assigned_to  = models.CharField(max_length=200, blank=True)
    is_active    = models.BooleanField(default=True)

    class Meta:
        ordering = ['location__name']

    def __str__(self):
        return self.location.name


class InventoryLevel(models.Model):
    """
    Quantity of a Part at a specific Location. The normalised stock record.

    Negative stock policy: `quantity` is deliberately allowed to go below zero.
    Inventory systems drift — a mechanic may physically hold a part that was
    never logged as a transfer, or a unit may have been damaged without a
    write-off being posted. Enforcing a >= 0 database constraint blocks the
    mechanic from continuing their job because of an administrative discrepancy.

    Instead: the transfer view allows the decrement to proceed even if it
    results in a negative `quantity`, but immediately creates an
    `InventoryAnomaly` record flagging the location for a cycle-count. The
    parts manager resolves the discrepancy by posting an inventory adjustment
    (a corrective `TruckStockTransfer` with `notes='Cycle count correction'`).
    """

    marina   = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='inventory_levels')
    part     = models.ForeignKey('Part', on_delete=models.CASCADE, related_name='inventory_levels')
    location = models.ForeignKey(Location, on_delete=models.CASCADE, related_name='inventory_levels')
    quantity = models.DecimalField(max_digits=10, decimal_places=3, default=0)
    # No >= 0 database constraint — negative stock is permitted; see docstring above.
    par      = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True,
                                   help_text='Minimum stock level. Below this triggers a restock alert.')

    class Meta:
        unique_together = [('part', 'location')]
        ordering = ['location', 'part']

    def __str__(self):
        return f'{self.part} @ {self.location}'


class InventoryAnomaly(models.Model):
    """
    Alert record created when an InventoryLevel.quantity drops below zero.
    Signals to the parts manager that a cycle-count and adjustment are needed.
    The mechanic's transfer is not blocked — operational continuity is preserved.
    """

    class Status(models.TextChoices):
        OPEN     = 'open',     'Open — Cycle Count Required'
        RESOLVED = 'resolved', 'Resolved (Adjustment Posted)'

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='inventory_anomalies')
    inventory_level = models.ForeignKey(InventoryLevel, on_delete=models.CASCADE, related_name='anomalies')
    transfer      = models.ForeignKey('TruckStockTransfer', on_delete=models.SET_NULL,
                                      null=True, blank=True, related_name='anomalies',
                                      help_text='The transfer that caused the negative stock.')
    quantity_after = models.DecimalField(max_digits=10, decimal_places=3,
                                         help_text='Negative quantity that triggered this anomaly.')
    status        = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    resolved_by   = models.CharField(max_length=200, blank=True)
    resolved_at   = models.DateTimeField(null=True, blank=True)
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Anomaly: {self.inventory_level} @ {self.quantity_after}'
```

**No changes to the existing `Part` model** beyond ensuring it has no `truck` FK (that column is not added). Existing `Part.stock` can be deprecated in favour of `InventoryLevel` rows during a data migration step — see Section 7.

### 2.12 TruckStockTransfer

Records movement of parts between truck and warehouse. Updates `InventoryLevel` quantities atomically.

```python
class TruckStockTransfer(models.Model):
    """A movement of parts between inventory locations (warehouse ↔ truck)."""

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
```

Transfer creation decrements `InventoryLevel.quantity` at the source location and increments it at the destination, wrapped in a database transaction. Before decrementing or incrementing, the service function must acquire row-level locks on both the source and destination `InventoryLevel` rows using `select_for_update()`:

```python
with transaction.atomic():
    levels = InventoryLevel.objects.select_for_update().filter(
        part=transfer.part,
        location__in=[source_location, destination_location],
    )
    source_level = levels.get(location=source_location)
    dest_level   = levels.get(location=destination_location)
    source_level.quantity -= transfer.quantity
    dest_level.quantity   += transfer.quantity
    source_level.save(update_fields=['quantity'])
    dest_level.save(update_fields=['quantity'])
```

This prevents two concurrent transfers involving the same part at the same location from producing a lost-update race condition — without the lock, both workers would read the same starting quantity and each write back an independently decremented value, resulting in only one decrement being applied instead of two.

**There is no `>= 0` enforcement** — if the source quantity goes negative the transfer succeeds, but the service function immediately creates an `InventoryAnomaly` record for that location and sends a notification to the parts manager. This preserves operational continuity: the mechanic continues working while the stock discrepancy is flagged for a cycle-count. A single `Part` retains one catalogue row regardless of how its stock is distributed across locations.

---

## 3. Gantt Chart Architecture

The Gantt chart is the most complex new UI component in this track. This section specifies the data contract, rendering strategy, interaction model, and dependency visualisation in enough detail for a single implementer to build it without further design decisions.

### 3.1 Placement within the Work Orders Tab

The Gantt is a view-mode toggle within the existing Work Orders tab — it is not a separate top-level tab. A segmented control with three options — **List | Kanban | Gantt** — sits at the top-right of the Work Orders tab header. Switching to Gantt replaces the card/list view with the Gantt chart for the currently selected (or first) work order. This keeps the tab bar at 12 items and preserves the information-architecture rule that tabs represent distinct operational domains.

### 3.2 Library Decision

Use **`frappe-gantt-react`** (wrapping `frappe-gantt`) as the rendering base:

- Renders task bars with pure SVG — dependency arrows are native SVG `<path>` elements.
- The bar drag callback exposes `task`, `start`, `end` cleanly.
- Actively maintained with existing usage in Django/React stacks.
- No licence fee; bundle ~1.1 MB.

Custom SVG from scratch is explicitly rejected: the dependency arrow routing (avoiding bar overlap, horizontal elbow routing) is non-trivial and would consume disproportionate implementation time.

If `frappe-gantt` is rejected on review (licensing changes or bundle size constraints), the fallback is **`react-beautiful-gantt`**. If both are rejected, implement a minimal custom SVG Gantt with straight diagonal arrows only, no elbow routing — document this limitation prominently.

### 3.3 Data Format the Component Expects

The Gantt component receives a `tasks` array in the shape below. This is the normalised format passed into `<FrappeGantt>`.

```ts
interface GanttTask {
  id: string;               // "task-{WorkOrderTask.id}"
  name: string;             // WorkOrderTask.title
  start: string;            // ISO date "YYYY-MM-DD" — planned_start or actual_start if in progress
  end: string;              // ISO date "YYYY-MM-DD" — planned_end or actual_end if completed
  progress: number;         // 0–100, from percent_complete
  dependencies: string;     // comma-separated predecessor GanttTask ids, e.g. "task-3,task-7"
  assignedTo: string;       // assigned_to text — rendered in bar tooltip
  status: string;           // not_started | in_progress | completed | blocked
  dependencyType: string;   // "fs" | "ss" | "ff" | "sf" — included for future renderer use
  // Extended fields for baseline overlay (rendered as a second bar):
  baselineStart?: string;   // baseline_start, may be absent
  baselineEnd?: string;     // baseline_end, may be absent
  isCritical: boolean;      // pre-computed on WorkOrderTask.is_critical; read directly by endpoint
}
```

The API returns this shape directly from a dedicated endpoint (see Section 4). The frontend does not compute critical path.

### 3.4 Rendering Layers

The Gantt component renders three visual layers on a shared SVG canvas:

1. **Baseline bars** — thin grey rectangles at 30% opacity, drawn first (bottom layer). Rendered only when both `baselineStart` and `baselineEnd` are present. Positioned using the same pixel-per-day scale the library exposes via its internal config.

2. **Task bars** — main coloured rectangles. Colour mapping:
   - `not_started` → `var(--gray)` (muted)
   - `in_progress` → `var(--navy)` (primary)
   - `completed` → `var(--green)`
   - `blocked` → `var(--orange)`
   - Critical path override: any task where `isCritical === true` renders in `var(--red)` regardless of status.
   - Slippage indicator: if `planned_end` is in the past and status is not `completed`, add a diagonal red stripe fill to the bar.

3. **Dependency arrows** — SVG `<path>` elements drawn last (top layer). Each arrow connects the right edge of the predecessor bar to the left edge of the successor bar with an L-shaped elbow path. Elbow route: right → right-margin → vertical → left-margin → left. Arrows on the critical path are drawn in red at 2 px stroke; all others in `rgba(0,0,0,0.3)` at 1 px.

### 3.5 Drag-to-Reschedule

Drag interaction uses `frappe-gantt`'s built-in drag callback. The interaction model is **optimistic UI with confirmed save**:

1. User begins dragging a task bar. The bar moves visually immediately (optimistic).
2. On drag end, `onDateChange(task, start, end)` fires.
3. The frontend immediately updates local React Query cache with the new dates (`queryClient.setQueryData`).
4. A `PATCH /api/v1/boatyard/work-order-tasks/{id}/` request fires with `{ planned_start, planned_end }`.
5. If the PATCH succeeds (200), the cache is invalidated to pull in the freshly-written `isCritical` values (the save triggers the Celery critical-path task) and any cascaded date updates for dependent tasks.
6. If the PATCH fails (400 / 409), the optimistic update is reverted — the cache is reset to the pre-drag snapshot — and a toast error is shown: "Reschedule blocked: [server error message]".

Dragging a task bar that has a predecessor does not automatically cascade the predecessor's dates. The server validates that the new date does not violate the dependency (successor cannot start before predecessor ends + lag). If violated, the server returns `400 { "detail": "Task cannot start before predecessor 'Hull Prep' completes." }` and the optimistic revert fires.

**Dependency arrows are not draggable.** Only task bars drag.

### 3.6 Locking the Baseline

A "Lock Baseline" button appears above the Gantt when no baseline is recorded (`baselineStart` is null on all tasks for that work order). Clicking it calls `POST /api/v1/boatyard/work-orders/{id}/lock-baseline/`. The server copies `planned_start → baseline_start` and `planned_end → baseline_end` for all tasks in the work order atomically. After this point the baseline fields are read-only — the UI does not expose a way to reset them. (The Django admin can reset if needed.)

### 3.7 Zoom and Navigation

Three zoom levels: **Day**, **Week** (default), **Month**. Toggle buttons in the Gantt toolbar. `frappe-gantt` supports these natively via the `viewMode` prop.

### 3.8 Dependency Creation UI

Right-clicking a task bar opens a context menu with "Add Dependency". The user then clicks a second task bar to set it as the predecessor. The frontend calls `POST /api/v1/boatyard/task-dependencies/` with `{ predecessor: taskId, successor: clickedId, dependency_type: "fs" }`. If the server detects a cycle, it returns `400 { "detail": "This dependency would create a cycle." }` and the arrow is not drawn.

---

## 4. API Contract

All endpoints are under `/api/v1/boatyard/`. All ViewSets use standard DRF ModelViewSet with `marina` injected from `request.user.marina` in `get_queryset`.

### 4.1 WorkOrderTask CRUD

```
GET    /api/v1/boatyard/work-order-tasks/          ?work_order={id}
POST   /api/v1/boatyard/work-order-tasks/
GET    /api/v1/boatyard/work-order-tasks/{id}/
PATCH  /api/v1/boatyard/work-order-tasks/{id}/
DELETE /api/v1/boatyard/work-order-tasks/{id}/
```

`GET ?work_order={id}` returns all tasks for one work order, sorted by `sort_order`.

**Gantt data endpoint** (returns the full GanttTask shape with pre-computed `isCritical` read directly from `WorkOrderTask.is_critical`):

```
GET /api/v1/boatyard/work-orders/{id}/gantt/
```

Response:

```json
{
  "work_order_id": 42,
  "baseline_locked": true,
  "tasks": [
    {
      "id": "task-17",
      "name": "Hull Preparation",
      "start": "2026-06-01",
      "end": "2026-06-10",
      "progress": 100,
      "dependencies": "",
      "dependencyType": "fs",
      "assignedTo": "J. Byrne",
      "status": "completed",
      "baselineStart": "2026-06-01",
      "baselineEnd": "2026-06-08",
      "isCritical": true,
      "actualHours": 10.0,
      "actualCost": 850.00,
      "estimatedHours": 8.0
    }
  ]
}
```

`actualHours` and `actualCost` are computed via database aggregation on `BatchJobPostLine` filtered by `work_order_task_id`. They are computed once in the Gantt endpoint view using a single `annotate()` call across all tasks for the work order — not in a Python loop. The tooltip in `GanttChart.jsx` renders these values as a mini cost card: "Hours: 10.0 / 8.0 est. | Cost: €850.00".

**Lock baseline action:**

```
POST /api/v1/boatyard/work-orders/{id}/lock-baseline/
```

Returns `200 { "locked": true, "tasks_updated": 8 }`. Returns `409` if baseline is already locked.

### 4.2 TaskDependency CRUD

```
GET    /api/v1/boatyard/task-dependencies/   ?work_order={id}
POST   /api/v1/boatyard/task-dependencies/
DELETE /api/v1/boatyard/task-dependencies/{id}/
```

`POST` body includes `dependency_type` (defaults to `"fs"`). The serializer rejects any value other than `"fs"` in v1 with `400 { "detail": "Only finish-to-start dependencies are supported in v1." }`. Cycle detection runs before saving (see Section 6.1). On successful save, the Celery critical-path task is fired for the affected work order.

### 4.3 BuildProject CRUD

```
GET    /api/v1/boatyard/build-projects/
POST   /api/v1/boatyard/build-projects/
GET    /api/v1/boatyard/build-projects/{id}/
PATCH  /api/v1/boatyard/build-projects/{id}/
```

No DELETE — build projects are completed or put on hold, never deleted.

**BOM nested endpoint:**

```
GET    /api/v1/boatyard/build-projects/{id}/bom/
POST   /api/v1/boatyard/build-projects/{id}/bom/
PATCH  /api/v1/boatyard/build-projects/{id}/bom/{item_id}/
DELETE /api/v1/boatyard/build-projects/{id}/bom/{item_id}/
```

**Milestones nested endpoint:**

```
GET    /api/v1/boatyard/build-projects/{id}/milestones/
POST   /api/v1/boatyard/build-projects/{id}/milestones/
PATCH  /api/v1/boatyard/build-projects/{id}/milestones/{milestone_id}/
```

**Mark milestone complete (triggers invoice creation):**

```
POST /api/v1/boatyard/build-projects/{id}/milestones/{milestone_id}/complete/
```

Request body: `{ "actual_date": "2026-07-15" }`. Server creates a `billing.Invoice` with one line item (milestone payment), sets `milestone.invoice` FK, returns `{ "invoice_id": 301 }`. The existing `Invoice` model is used — no `BuildInvoice` model is introduced.

### 4.4 JobTemplate CRUD

```
GET    /api/v1/boatyard/job-templates/         ?is_active=true
POST   /api/v1/boatyard/job-templates/
GET    /api/v1/boatyard/job-templates/{id}/
PATCH  /api/v1/boatyard/job-templates/{id}/
```

Response includes nested `tasks` and `parts` arrays.

**Apply template to a work order:**

```
POST /api/v1/boatyard/work-orders/{id}/apply-template/
```

Request body: `{ "template_id": 5, "start_date": "2026-07-01" }`. Server creates `WorkOrderTask` rows from the template tasks (dates computed from `start_date + duration_days`), then fires the Celery critical-path task. Returns `{ "tasks_created": 4, "parts_suggested": 6 }`. Parts are not automatically added to the work order — they are returned as suggestions for the technician to confirm.

### 4.5 Batch Job Post

```
POST /api/v1/boatyard/batch-job-posts/
```

Request body:

```json
{
  "notes": "Morning shift — Yard Team Alpha",
  "lines": [
    { "work_order": 12, "work_order_task": 17, "hours": 2.5, "material_cost": null, "description": "Anti-foul prep" },
    { "work_order": 17, "work_order_task": null, "hours": 1.0, "material_cost": 85.00, "description": "Bottom paint materials" }
  ]
}
```

Server creates `BatchJobPost` and `BatchJobPostLine` rows. If `work_order.tasks.exists()` and `work_order_task` is null, the server returns `400 { "detail": "work_order_task is required when the work order has tasks." }` — this enforces task-level cost capture for project work orders.

`WorkOrder.actual_hours` is not mutated — it is computed on read via `Sum('batch_lines__hours')`. Task-level actuals are similarly computed: `WorkOrderTask.actual_hours = Sum('post_lines__hours')`, `WorkOrderTask.actual_cost = Sum('post_lines__material_cost') + Sum('post_lines__hours') * hourly_rate`. These aggregates are returned in the Gantt endpoint response (see Section 4.1) and in the Gantt task bar tooltip.

Returns `201 { "batch_id": 99, "lines_posted": 2 }`.

```
GET /api/v1/boatyard/batch-job-posts/          ?work_order={id}
GET /api/v1/boatyard/batch-job-posts/{id}/
```

### 4.6 Warranty

```
GET    /api/v1/boatyard/warranty-agreements/
POST   /api/v1/boatyard/warranty-agreements/
PATCH  /api/v1/boatyard/warranty-agreements/{id}/

GET    /api/v1/boatyard/warranty-claims/       ?work_order={id}&status=submitted
POST   /api/v1/boatyard/warranty-claims/
PATCH  /api/v1/boatyard/warranty-claims/{id}/
```

**GL posting on reimbursement:** When `PATCH /api/v1/boatyard/warranty-claims/{id}/` transitions `status` to `'reimbursed'`, the view must save the status change and then enqueue the GL posting as a dedicated Celery task via `transaction.on_commit`:

```python
transaction.on_commit(lambda: post_warranty_gl_entry.delay(claim_id=instance.pk))
```

Using `transaction.on_commit` ensures the GL task only fires after the `WarrantyClaim` status change is committed to the database — a Celery worker that starts immediately would otherwise race against the open transaction and read the old status. The dedicated Celery task `post_warranty_gl_entry` must:
1. Creates a `billing.JournalEntry` with `source_type='warranty_reimbursement'`, `source_id=claim.pk`.
2. Posts: **Dr** AR / Bank Clearing account (asset increases — money owed or received) for `amount_reimbursed`; **Cr** "Warranty Revenue / COGS Offset" GL account for `amount_reimbursed`.
3. Sets `claim.journal_entry = je` and saves.

The marina accountant maps which GL accounts to use via `Marina.warranty_gl_account` (AR/clearing) and `Marina.warranty_cogs_offset_account` — both nullable FKs to `billing.Account`, added as Marina model fields in this track.

**Upload manufacturer PDF template to a WarrantyAgreement:**

```
POST /api/v1/boatyard/warranty-agreements/{id}/upload-template/
```

Request: multipart form with `file` (PDF). Server stores the file in S3 and sets `warranty_agreement.pdf_template_url`. Returns `200 { "pdf_template_url": "..." }`.

**Submit claim (generates PDF and advances status):**

```
POST /api/v1/boatyard/warranty-claims/{id}/submit/
```

Returns immediately with `{ "job_id": "celery-task-uuid" }`. Client polls `GET /api/v1/boatyard/warranty-claims/{id}/` until `status !== 'draft'`.

### 4.7 Supplier Price File Import (Two-Step Wizard)

**Step 1 — Upload and parse headers:**

```
POST /api/v1/boatyard/supplier-price-files/
```

Request: multipart form with `file` (CSV/EDI) and `supplier_name`, or JSON with `api_endpoint` and `supplier_name`. Server creates a `SupplierPriceFile` record (status=`pending_mapping`), parses headers from the file, and returns:

```json
{
  "price_file_id": 55,
  "detected_headers": ["SKU_NUM", "VENDOR", "PRICE_EX_VAT", "DESCRIPTION"],
  "suggested_mapping": {
    "part_no":    "SKU_NUM",
    "supplier":   "VENDOR",
    "unit_cost":  "PRICE_EX_VAT"
  },
  "mapping_saved": true
}
```

`suggested_mapping` is generated by matching detected headers against the saved `SupplierColumnMap` for this supplier (exact match) or by heuristic keyword matching against DocksBase field names (fuzzy fallback). `mapping_saved: true` means a prior mapping was found and applied automatically — the wizard may skip straight to confirmation.

**Step 2 — Confirm mapping and start import:**

```
POST /api/v1/boatyard/supplier-price-files/{id}/confirm-mapping/
```

Request body:

```json
{
  "mapping": {
    "part_no":   "SKU_NUM",
    "supplier":  "VENDOR",
    "unit_cost": "PRICE_EX_VAT"
  }
}
```

Server saves the mapping to `SupplierColumnMap` (upsert by `marina` + `supplier_name`), updates `SupplierPriceFile.status` to `queued`, and enqueues the Celery import task. Returns `202 { "price_file_id": 55 }`.

```
GET /api/v1/boatyard/supplier-price-files/{id}/        # poll for status
GET /api/v1/boatyard/supplier-price-files/{id}/flagged/ # flagged price increases pending approval
```

**Approve flagged increase:**

```
POST /api/v1/boatyard/part-price-history/{id}/approve/
```

Sets `PartPriceHistory.applied = True` and updates `Part.unit_cost`.

### 4.8 Service Truck Inventory

```
GET    /api/v1/boatyard/service-trucks/
POST   /api/v1/boatyard/service-trucks/
PATCH  /api/v1/boatyard/service-trucks/{id}/

GET    /api/v1/boatyard/inventory-levels/?location={location_id}   # stock at a specific location
GET    /api/v1/boatyard/inventory-levels/?part={part_id}           # all locations for a part

POST   /api/v1/boatyard/truck-stock-transfers/   # move parts between truck and warehouse
GET    /api/v1/boatyard/truck-stock-transfers/   ?truck={id}
```

`TruckStockTransfer` creation updates `InventoryLevel.quantity` at both the source and destination locations atomically in a database transaction. The `Part` catalogue row is untouched.

---

## 5. Frontend Architecture

### 5.1 Integration into Existing Boatyard Screen

The existing `Boatyard.jsx` tab bar has 8 tabs. Track 5 adds 4 new tabs and one view-mode toggle within the existing Work Orders tab:

| Position | Tab key | Tab label | New? |
|---|---|---|---|
| 1–8 | existing | unchanged | No |
| 9 | `build` | Build Projects | Yes |
| 10 | `templates` | Job Templates | Yes |
| 11 | `warranty` | Warranty | Yes |
| 12 | `trucks` | Service Trucks | Yes |

**Work Orders tab (tab 1) gains a view-mode segmented control:** `List | Kanban | Gantt`. Selecting Gantt renders `GanttChart.jsx` inside the Work Orders tab content area. The tab bar remains at 12 items.

The batch job post and supplier price file import are not separate tabs — they are modal/drawer actions accessible from within the Work Orders tab (batch post) and the Parts tab (price file upload).

### 5.2 Component Map

```
Boatyard.jsx                          ← existing, add view-mode toggle + new tab branches
│
├── WorkOrdersTab.jsx (existing)      ← add ViewModeToggle (List|Kanban|Gantt)
│   ├── WorkOrderList.jsx             ← existing (List mode)
│   ├── WorkOrderKanban.jsx           ← existing (Kanban mode)
│   ├── GanttTab.jsx                  ← new (Gantt mode, rendered inside Work Orders tab)
│   │   ├── GanttToolbar.jsx          ← zoom toggle, lock baseline button, WO selector
│   │   ├── GanttChart.jsx            ← wraps FrappeGantt, handles drag callbacks
│   │   ├── TaskFormDrawer.jsx        ← create/edit WorkOrderTask
│   │   └── DependencyModal.jsx       ← "click second task" interaction for link creation
│   └── BatchPostModal.jsx            ← new (accessed via "Batch Post" button in tab header)
│
├── BuildProjectsTab.jsx              ← new
│   ├── BuildProjectList.jsx
│   ├── BuildProjectFormDrawer.jsx    ← create/edit project + work order stub
│   ├── BOMTable.jsx                  ← inline editable BOM for a selected project
│   └── MilestoneTimeline.jsx         ← ordered milestone list with "Mark Complete" actions
│
├── JobTemplatesTab.jsx               ← new
│   ├── TemplateList.jsx
│   ├── TemplateFormDrawer.jsx        ← create/edit template with task + part sub-rows
│   └── ApplyTemplateModal.jsx        ← pick template + start date → apply to a WO
│
├── WarrantyTab.jsx                   ← new
│   ├── WarrantyAgreementList.jsx
│   ├── WarrantyAgreementDrawer.jsx   ← includes PDF template upload field
│   ├── WarrantyClaimList.jsx
│   └── WarrantyClaimDrawer.jsx       ← create claim, submit action, status tracking
│
└── ServiceTrucksTab.jsx              ← new
    ├── TruckList.jsx
    ├── TruckInventoryTable.jsx       ← InventoryLevel rows filtered by location={truck.location_id}
    └── TransferModal.jsx             ← move parts to/from truck
```

**Parts tab additions (no new tab):**

- Add "Import Price File" button → opens `PriceFileUploadDrawer.jsx`: file picker + supplier name + threshold %. On submit, POST to the price file endpoint. If `mapping_saved: false`, the drawer advances to the column-mapping step (a two-column UI matching detected CSV headers to DocksBase fields). Once confirmed, polling begins and a status indicator shows import progress. A "Flagged Increases" badge appears on the Parts tab when `PartPriceHistory.is_flagged=True AND applied=False` rows exist.

### 5.3 Data Hooks

Follow the existing hook pattern in the codebase (`useWorkOrders.js`, etc.).

```
hooks/
  useWorkOrderTasks.js          ← CRUD + gantt data fetch
  useTaskDependencies.js
  useBuildProjects.js
  useJobTemplates.js
  useBatchJobPosts.js
  useWarrantyAgreements.js
  useWarrantyClaims.js
  useSupplierPriceFiles.js
  useServiceTrucks.js
  useInventoryLevels.js
  useTruckTransfers.js
```

Each hook exposes the list query, plus named mutation functions (`createX`, `updateX`, `deleteX` where applicable). All mutations invalidate the relevant query key on success and show a toast.

### 5.4 GanttChart.jsx Detail

```jsx
// Pseudocode for key behaviours

import FrappeGantt from 'frappe-gantt-react';

export function GanttChart({ workOrderId }) {
  const { ganttData, isLoading } = useWorkOrderTasks(workOrderId);
  const { updateTask } = useWorkOrderTasks(workOrderId);
  const queryClient = useQueryClient();

  // Optimistic drag handler
  function handleDateChange(task, start, end) {
    const snapshot = queryClient.getQueryData(['gantt', workOrderId]);
    // Optimistic update
    queryClient.setQueryData(['gantt', workOrderId], prev => ({
      ...prev,
      tasks: prev.tasks.map(t =>
        t.id === task.id ? { ...t, start, end } : t
      )
    }));
    // Confirmed save
    updateTask(task.id, { planned_start: start, planned_end: end })
      .catch(() => {
        queryClient.setQueryData(['gantt', workOrderId], snapshot);
        toast.error('Reschedule blocked — dependency constraint violated.');
      })
      .then(() => {
        queryClient.invalidateQueries(['gantt', workOrderId]);
      });
  }

  return (
    <FrappeGantt
      tasks={ganttData?.tasks ?? []}
      viewMode={viewMode}
      onDateChange={handleDateChange}
      onProgressChange={(task, progress) => updateTask(task.id, { percent_complete: progress })}
    />
  );
}
```

Baseline bars are rendered as an SVG overlay injected into the Gantt container after the library renders its own bars. Use a `useLayoutEffect` that queries the Gantt SVG and appends `<rect>` elements at the baseline positions using the same pixel-per-day scale the library exposes via its internal config.

---

## 6. Background Jobs

All Celery tasks live in `backend/apps/boatyard/tasks.py`.

### 6.1 Cycle Detection (synchronous, in serializer)

Not a background job — runs inline in `TaskDependencySerializer.validate()`:

```python
def _has_cycle(self, predecessor_id: int, successor_id: int, marina_id: int) -> bool:
    """BFS from successor_id; returns True if predecessor_id is reachable."""
    visited = set()
    queue = [successor_id]
    while queue:
        node = queue.pop(0)
        if node == predecessor_id:
            return True
        if node in visited:
            continue
        visited.add(node)
        children = TaskDependency.objects.filter(
            predecessor_id=node, marina_id=marina_id
        ).values_list('successor_id', flat=True)
        queue.extend(children)
    return False
```

### 6.2 Critical Path Computation (async Celery, cached on write)

Critical path is computed by a Celery task that fires whenever a `WorkOrderTask` date or a `TaskDependency` is saved. The result is written to `WorkOrderTask.is_critical` directly. The Gantt endpoint reads these pre-computed values with an O(1) query per task — no CPU work at read time.

**Race condition hazard:** Applying a `JobTemplate` to a work order creates N tasks and N-1 dependencies in rapid succession. Without protection, this fires N + (N-1) concurrent Celery tasks — all pulling the same DAG, all computing the same critical path, all attempting a `bulk_update` on the same rows simultaneously. Under PostgreSQL's row-level locking this causes cascading deadlocks and silent failures for the workers that lose the lock race.

**Two-tier mitigation:**

**Tier 1 — Redis lock inside the task (protects single-task work orders and staggered edits):**

```python
@shared_task
def recalculate_critical_path(work_order_id: int):
    """
    Acquires a Redis lock before touching the database. Workers that cannot
    acquire the lock within 2 seconds abort silently — the lock holder will
    finish and write the correct result.

    1. Attempt to acquire lock:critical_path:{work_order_id} (TTL 30s, nx=True).
       Lock timeout must exceed the worst-case computation time for the critical path (recommend 30s minimum; tune upward if complex price matrix computation takes longer).
    2. If lock NOT acquired within 2 seconds: return immediately (another worker is running).
    3. If lock acquired:
       a. Load all WorkOrderTask rows for this work order.
       b. Load all TaskDependency rows for this work order.
       c. Topological sort + forward pass to compute early finish for each task.
       d. Tasks on the longest path: is_critical=True. All others: False.
       e. Bulk-update WorkOrderTask.is_critical in a single query.
       f. Release lock.
    If a cycle is detected (data integrity issue): set all is_critical=False,
    log a warning — do not raise.
    """
```

**Tier 2 — Bulk-operation bypass (protects template application and baseline locking):**

The `apply-template` and `lock-baseline` actions must **not** trigger `post_save` signals on `WorkOrderTask` and `TaskDependency`. Instead they use `bulk_create` (which does not fire Django signals) and fire exactly one `recalculate_critical_path.delay(work_order_id)` call after the transaction commits. This eliminates the N-task signal storm at the source.

Implementation note: wrap the bulk creation in `transaction.on_commit(lambda: recalculate_critical_path.delay(work_order_id))` so the task only fires after the rows are committed and visible to the Celery worker.

### 6.3 Supplier Price File Import (async Celery)

```python
@shared_task(bind=True, max_retries=3)
def import_supplier_price_file(self, price_file_id: int):
    """
    1. Load SupplierPriceFile record and its confirmed SupplierColumnMap.
    2. Fetch file from S3 or call API endpoint.
    3. Parse rows using the confirmed column mapping
       (CSV: pandas read_csv; EDI: custom parser; API: requests.get + JSON).
    4. For each row: match Part by part_no + supplier, compute change_pct.
    5. If change_pct > flag_threshold_pct: create PartPriceHistory(applied=False, is_flagged=True).
    6. Else: create PartPriceHistory(applied=True), update Part.unit_cost immediately.
    7. Update SupplierPriceFile.status, rows_processed, rows_updated, rows_flagged, completed_at.
    """
```

Unmatched rows are skipped and counted in `error_detail` as a JSON log: `[{"row": 5, "part_no": "XYZ-99", "reason": "no match"}]`.

### 6.4 Warranty Claim PDF Generation (async Celery)

```python
@shared_task(bind=True)
def generate_warranty_claim_pdf(self, claim_id: int):
    """
    1. Load WarrantyClaim + WarrantyAgreement + WorkOrder.
    2. If WarrantyAgreement.pdf_template_url is set:
         - Download manufacturer's fillable PDF from S3.
         - Use pdfrw (or equivalent) to stamp WorkOrder variables into form fields.
    3. If pdf_template_url is empty (fallback):
         - Render a standard DocksBase claim PDF using WeasyPrint from a Django template.
    4. Upload the completed PDF to S3; set WarrantyClaim.claim_document_url.
    5. Set WarrantyClaim.status = 'submitted', submitted_at = now().
    6. Send email to WarrantyAgreement.contact_email with the PDF attached.
    """
```

### 6.5 Truck Restock Alert (Celery Beat, daily)

```python
@shared_task
def check_truck_restock():
    """
    For each marina:
    1. Find InventoryLevel rows where location.location_type='truck'
       and quantity < par (and par is not null) — under-par restock alert.
    2. Find InventoryLevel rows where quantity < 0 — negative stock alert
       (in case an InventoryAnomaly record was not sent in real-time,
        e.g. if the notification service was down at transfer time).
       For each: ensure an open InventoryAnomaly record exists; if not, create one.
    3. Collate both lists into a single email to the marina parts manager
       with two sections: "Restock Required" and "Negative Stock — Cycle Count Needed".
    """
```

Runs daily at 07:00 marina local time via Celery Beat. Uses the existing notification infrastructure if present; falls back to a simple email via Django's mail backend.

---

## 7. Implementation Steps (ordered)

Steps respect migration dependencies. Do not reorder.

1. **Add `WorkOrderTask` and `TaskDependency` models** — write and run migrations. `TaskDependency` includes the `dependency_type` field (default `"fs"`). Verify `clean()` on `WorkOrderTask`.

2. **Add `Location`, `ServiceTruck`, `InventoryLevel`, and `InventoryAnomaly` models** — migration. No `>= 0` constraint on `InventoryLevel.quantity` — the field is a plain `DecimalField`. Create a warehouse `Location` row per marina as part of a data migration. Migrate existing `Part.stock` values to `InventoryLevel` rows linked to the warehouse `Location`.

3. **Add `TruckStockTransfer` model** — migration. Implement `execute_transfer(transfer)` in `boatyard/services.py`: inside `transaction.atomic()`, lock both source and destination `InventoryLevel` rows with `select_for_update()` before decrementing/incrementing quantities (see Section 2.12 for the code pattern). After committing, if source quantity < 0: create `InventoryAnomaly(inventory_level=source_level, transfer=transfer, quantity_after=source_level.quantity)` and send an immediate notification to the parts manager.

4. **Add `BuildProject`, `BOMItem`, `BuildMilestone` models** — migration. `BuildProject.work_order` is a `OneToOneField` to the existing `WorkOrder`; no changes to `WorkOrder` itself.

5. **Add `JobTemplate`, `JobTemplateTask`, `JobTemplatePart` models** — migration.

6. **Add `BatchJobPost` and `BatchJobPostLine` models** — migration. Ensure `WorkOrder.actual_hours` is removed as a mutable field or deprecated; compute it via annotation.

7. **Add `WarrantyAgreement` and `WarrantyClaim` models** — migration. `WarrantyAgreement` includes `pdf_template_url`. `WarrantyClaim` includes `journal_entry` OneToOneField to `billing.JournalEntry`. Add `warranty_gl_account` and `warranty_cogs_offset_account` nullable FK fields to the `Marina` model (pointing to `billing.Account`) in the same migration. Implement `post_warranty_reimbursement_gl(claim)` in `boatyard/services.py`; wire it in the `WarrantyClaimViewSet.partial_update` method when the status field transitions to `'reimbursed'`.

8. **Add `SupplierPriceFile`, `SupplierColumnMap`, and `PartPriceHistory` models** — migration.

9. **Write serializers** — one serializer module per group: `tasks_serializers.py`, `build_serializers.py`, `template_serializers.py`, `warranty_serializers.py`, `pricing_serializers.py`, `truck_serializers.py`. Include `TaskDependencySerializer.validate()` with cycle detection and `dependency_type` enforcement. Include header-parsing logic in the price file serializer.

10. **Write ViewSets and register URLs** — add to `backend/apps/boatyard/urls.py`. Implement: Gantt action (reads `is_critical` from DB), lock-baseline action, apply-template action, milestone-complete action, price file confirm-mapping action, warranty template upload action.

11. **Write Celery tasks** — `recalculate_critical_path`, `import_supplier_price_file`, `generate_warranty_claim_pdf`, `check_truck_restock`. Wire `post_save` signals for `WorkOrderTask` and `TaskDependency` to trigger `recalculate_critical_path` with a 5-second countdown (`apply_async(countdown=5)`) so rapid consecutive edits coalesce into one worker run. The task itself acquires `lock:critical_path:{work_order_id}` via Redis `SET NX PX 30000` before processing; workers that cannot acquire the lock within 2 seconds abort. The `apply-template` and `lock-baseline` actions bypass signals entirely — they use `bulk_create` and fire one `recalculate_critical_path.delay()` via `transaction.on_commit`. Register `check_truck_restock` in Celery Beat schedule.

12. **Install `frappe-gantt-react`** — add to `frontend/package.json`.

13. **Add view-mode segmented control to Work Orders tab** — `List | Kanban | Gantt` toggle in the tab header. Route `Gantt` mode to `GanttTab.jsx`.

14. **Build `GanttChart.jsx` and `GanttToolbar.jsx`** — implement drag handler with optimistic UI per Section 3.5. Implement baseline SVG overlay via `useLayoutEffect`.

15. **Build `DependencyModal.jsx`** — implement two-click flow for creating `TaskDependency` via right-click context menu.

16. **Build `TaskFormDrawer.jsx`** — create/edit `WorkOrderTask` fields.

17. **Build `BuildProjectsTab.jsx`** and sub-components — `BOMTable` as inline editable; `MilestoneTimeline` with "Mark Complete" button triggering the `complete/` endpoint.

18. **Build `JobTemplatesTab.jsx`** — template list, form drawer, `ApplyTemplateModal`.

19. **Build `WarrantyTab.jsx`** — agreement list (including PDF template upload field in the drawer), claim list, claim drawer with submit button.

20. **Build `ServiceTrucksTab.jsx`** — truck list, `TruckInventoryTable` (InventoryLevel rows filtered by location), `TransferModal`.

21. **Add Batch Post to Work Orders tab** — `BatchPostModal.jsx` with dynamic rows.

22. **Add Price File Import to Parts tab** — `PriceFileUploadDrawer.jsx` with two-step column-mapping wizard (auto-skip if saved mapping found), polling status, and flagged-increase approval flow.

23. **Register all new tabs in `Boatyard.jsx`** — extend the tab bar array (12 total); add conditional renders.

24. **Write all data hooks** — one hook file per domain (Section 5.3).

25. **Manual QA pass** — test drag-to-reschedule with dependency constraint violation; test cycle detection rejection; test price file mapping wizard (new supplier and returning supplier); test warranty PDF generation with and without manufacturer template; test milestone complete → invoice creation; test truck restock alert with InventoryLevel below par.
