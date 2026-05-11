# Track 5 — Boatyard Advanced: Implementation Plan
Date: 2026-05-08
Spec: `docs/superpowers/specs/2026-05-07-track-05-boatyard-advanced-design.md`

---

## Overview

Track 5 extends the existing `boatyard` app with Gantt/critical-path project management, boat-builder shipyard manufacturing, job-package templates, batch time-and-materials posting, warranty management, supplier price-file imports, and mobile service truck inventory. Every change is additive — no existing models or views are replaced. The existing `WorkOrder`, `Part`, `Tool`, `HaulOut`, `StorageSlot`, `LaunchRequest`, and `Contractor` models remain unchanged except for a data migration that seeds per-location `InventoryLevel` rows from the existing flat `Part.stock` integer field.

---

## Gap Analysis: Existing vs Required

### What exists in `boatyard`

| Model | Fields present | Gaps |
|---|---|---|
| `WorkOrder` | `marina`, `vessel`, `title`, `category`, `description`, `priority`, `status`, `assigned_to`, `estimate`, `actual`, `created_at`, `due`, `notes` | No `actual_hours` annotation path; `actual` field is a mutable Decimal — must be deprecated in favour of computed `Sum('batch_lines__hours')`. No FK to `BuildProject`. |
| `Part` | `marina`, `name`, `part_no`, `category`, `supplier`, `unit_cost`, `sell_price`, `stock` (Integer), `par` (Integer), `location` (CharField) | `stock` and `par` are flat integers, not per-location. `location` is a free-text string. Both will be superseded by `InventoryLevel` + `Location` models. No deletion — field is deprecated in a data migration. |
| `HaulOut` | complete for its scope | No changes needed. |
| `StorageSlot` | complete for its scope | No changes needed. |
| `LaunchRequest` | complete for its scope | No changes needed in this track (Track 6 adds concierge fields). |
| `Tool` | complete for its scope | No changes needed. |
| `Contractor` | complete for its scope | No changes needed. |

### Views / URLs

All existing views use `generics.ListCreateAPIView` and `generics.RetrieveUpdateAPIView` — simple class-based views, no ViewSets, no router. Track 5 will add new ViewSets registered via a DRF router alongside the existing URL patterns. The existing path-based URLs are left unchanged to avoid breaking the frontend.

### What is entirely missing (must be created)

All models listed in the spec: `WorkOrderTask`, `TaskDependency`, `BuildProject`, `BOMItem`, `BuildMilestone`, `JobTemplate`, `JobTemplateTask`, `JobTemplatePart`, `BatchJobPost`, `BatchJobPostLine`, `WarrantyAgreement`, `WarrantyClaim`, `SupplierPriceFile`, `SupplierColumnMap`, `PartPriceHistory`, `Location`, `ServiceTruck`, `InventoryLevel`, `InventoryAnomaly`, `TruckStockTransfer`.

Service functions: `execute_transfer()`, `post_warranty_reimbursement_gl()`, `apply_template_to_work_order()`, `complete_build_milestone()`.

Celery tasks: `recalculate_critical_path`, `import_supplier_price_file`, `generate_warranty_claim_pdf`, `check_truck_restock`.

---

## Models

All models live in `backend/apps/boatyard/models.py` (appended — do not replace the file).

### WorkOrderTask

```python
class WorkOrderTask(models.Model):
    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='wo_tasks')
    work_order   = models.ForeignKey('WorkOrder', on_delete=models.CASCADE, related_name='tasks')
    title        = models.CharField(max_length=300)
    description  = models.TextField(blank=True)
    assigned_to  = models.CharField(max_length=200, blank=True)
    planned_start = models.DateField()
    planned_end   = models.DateField()
    actual_start  = models.DateField(null=True, blank=True)
    actual_end    = models.DateField(null=True, blank=True)
    baseline_start = models.DateField(null=True, blank=True)
    baseline_end   = models.DateField(null=True, blank=True)

    class Status(models.TextChoices):
        NOT_STARTED = 'not_started', 'Not Started'
        IN_PROGRESS = 'in_progress', 'In Progress'
        COMPLETED   = 'completed',   'Completed'
        BLOCKED     = 'blocked',     'Blocked'

    status           = models.CharField(max_length=20, choices=Status.choices, default=Status.NOT_STARTED)
    percent_complete = models.IntegerField(default=0)
    sort_order       = models.IntegerField(default=0)
    is_critical      = models.BooleanField(default=False)  # written by Celery; read by Gantt endpoint
    created_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['sort_order', 'planned_start']

    def clean(self):
        if self.planned_end < self.planned_start:
            raise ValidationError('planned_end must be on or after planned_start.')
```

### TaskDependency

```python
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
        if self.predecessor_id == self.successor_id:
            raise ValidationError('A task cannot depend on itself.')
```

### BuildProject

```python
class BuildProject(models.Model):
    STATUS = [
        ('planning', 'Planning'), ('in_build', 'In Build'),
        ('sea_trials', 'Sea Trials'), ('completed', 'Completed'), ('on_hold', 'On Hold'),
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
```

### BOMItem

```python
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
    supplier           = models.CharField(max_length=200, blank=True)
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

### BuildMilestone

```python
class BuildMilestone(models.Model):
    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='build_milestones')
    build_project = models.ForeignKey(BuildProject, on_delete=models.CASCADE, related_name='milestones')
    name             = models.CharField(max_length=200)
    description      = models.TextField(blank=True)
    planned_date     = models.DateField()
    actual_date      = models.DateField(null=True, blank=True)
    payment_amount   = models.DecimalField(max_digits=12, decimal_places=2)
    payment_due_days = models.IntegerField(default=14)
    invoice = models.OneToOneField(
        'billing.Invoice', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='build_milestone'
    )
    sort_order = models.IntegerField(default=0)

    class Meta:
        ordering = ['sort_order', 'planned_date']
```

### JobTemplate / JobTemplateTask / JobTemplatePart

```python
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


class JobTemplateTask(models.Model):
    template      = models.ForeignKey(JobTemplate, on_delete=models.CASCADE, related_name='tasks')
    title         = models.CharField(max_length=300)
    description   = models.TextField(blank=True)
    duration_days = models.IntegerField(default=1)
    estimated_hours = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    sort_order    = models.IntegerField(default=0)

    class Meta:
        ordering = ['sort_order']


class JobTemplatePart(models.Model):
    template    = models.ForeignKey(JobTemplate, on_delete=models.CASCADE, related_name='parts')
    part        = models.ForeignKey('Part', on_delete=models.SET_NULL, null=True, blank=True)
    description = models.CharField(max_length=300)
    quantity    = models.DecimalField(max_digits=10, decimal_places=3, default=1)

    class Meta:
        ordering = ['description']
```

### BatchJobPost / BatchJobPostLine

```python
class BatchJobPost(models.Model):
    marina    = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='batch_posts')
    posted_by = models.CharField(max_length=200, blank=True)
    posted_at = models.DateTimeField(auto_now_add=True)
    notes     = models.TextField(blank=True)

    class Meta:
        ordering = ['-posted_at']


class BatchJobPostLine(models.Model):
    batch          = models.ForeignKey(BatchJobPost, on_delete=models.CASCADE, related_name='lines')
    work_order     = models.ForeignKey('WorkOrder', on_delete=models.CASCADE, related_name='batch_lines')
    work_order_task = models.ForeignKey(
        'WorkOrderTask', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='post_lines'
    )
    hours         = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    material_cost = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    description   = models.CharField(max_length=300, blank=True)
```

### WarrantyAgreement / WarrantyClaim

```python
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


class WarrantyClaim(models.Model):
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
        'billing.JournalEntry', on_delete=models.SET_NULL,
        null=True, blank=True, related_name='warranty_claim'
    )
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ['-submitted_at']

    @property
    def variance(self):
        if self.amount_reimbursed is not None:
            return self.total_claimed - self.amount_reimbursed
        return None
```

### SupplierPriceFile / SupplierColumnMap / PartPriceHistory

```python
class SupplierPriceFile(models.Model):
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


class SupplierColumnMap(models.Model):
    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='supplier_column_maps')
    supplier_name = models.CharField(max_length=200)
    mapping       = models.JSONField(default=dict)
    updated_at    = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('marina', 'supplier_name')]


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
```

### Location / ServiceTruck / InventoryLevel / InventoryAnomaly

```python
class Location(models.Model):
    class LocationType(models.TextChoices):
        WAREHOUSE = 'warehouse', 'Main Warehouse'
        TRUCK     = 'truck',     'Service Truck'

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='locations')
    location_type = models.CharField(max_length=20, choices=LocationType.choices)
    name          = models.CharField(max_length=200)

    class Meta:
        ordering = ['location_type', 'name']


class ServiceTruck(models.Model):
    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='service_trucks')
    location     = models.OneToOneField(Location, on_delete=models.PROTECT, related_name='truck')
    registration = models.CharField(max_length=50, blank=True)
    assigned_to  = models.CharField(max_length=200, blank=True)
    is_active    = models.BooleanField(default=True)

    class Meta:
        ordering = ['location__name']


class InventoryLevel(models.Model):
    marina   = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='inventory_levels')
    part     = models.ForeignKey('Part', on_delete=models.CASCADE, related_name='inventory_levels')
    location = models.ForeignKey(Location, on_delete=models.CASCADE, related_name='inventory_levels')
    quantity = models.DecimalField(max_digits=10, decimal_places=3, default=0)
    # No >= 0 constraint — negative stock is allowed; creates InventoryAnomaly
    par      = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True)

    class Meta:
        unique_together = [('part', 'location')]
        ordering = ['location', 'part']


class InventoryAnomaly(models.Model):
    class Status(models.TextChoices):
        OPEN     = 'open',     'Open — Cycle Count Required'
        RESOLVED = 'resolved', 'Resolved (Adjustment Posted)'

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='inventory_anomalies')
    inventory_level = models.ForeignKey(InventoryLevel, on_delete=models.CASCADE, related_name='anomalies')
    transfer        = models.ForeignKey('TruckStockTransfer', on_delete=models.SET_NULL, null=True, blank=True, related_name='anomalies')
    quantity_after  = models.DecimalField(max_digits=10, decimal_places=3)
    status          = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    resolved_by     = models.CharField(max_length=200, blank=True)
    resolved_at     = models.DateTimeField(null=True, blank=True)
    created_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
```

### TruckStockTransfer

```python
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
```

### Marina model additions

Add two nullable FK fields to `accounts.Marina` (in the Track 5 WarrantyClaim migration or a standalone accounts migration):

```python
# In accounts/models.py — append to Marina class
warranty_gl_account           = models.ForeignKey('billing.Account', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
warranty_cogs_offset_account  = models.ForeignKey('billing.Account', on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
```

---

## Service Layer

File: `backend/apps/boatyard/services.py`

### execute_transfer(transfer: TruckStockTransfer) -> None

```python
def execute_transfer(transfer: TruckStockTransfer) -> None:
    """
    Atomically move stock between warehouse and truck InventoryLevel rows.
    Uses select_for_update() on BOTH rows before any mutation to prevent
    lost-update races. Creates InventoryAnomaly if source goes negative.
    """
    truck_location = transfer.truck.location
    warehouse_location = Location.objects.get(
        marina=transfer.marina, location_type=Location.LocationType.WAREHOUSE
    )
    source_location = warehouse_location if transfer.direction == 'to_truck' else truck_location
    dest_location   = truck_location if transfer.direction == 'to_truck' else warehouse_location

    with transaction.atomic():
        levels = InventoryLevel.objects.select_for_update().filter(
            part=transfer.part,
            location__in=[source_location, dest_location],
        )
        source_level = levels.get(location=source_location)
        dest_level   = levels.get(location=dest_location)
        source_level.quantity -= transfer.quantity
        dest_level.quantity   += transfer.quantity
        source_level.save(update_fields=['quantity'])
        dest_level.save(update_fields=['quantity'])

        if source_level.quantity < 0:
            InventoryAnomaly.objects.create(
                marina=transfer.marina,
                inventory_level=source_level,
                transfer=transfer,
                quantity_after=source_level.quantity,
            )
            # Notify parts manager (email or in-app) via existing notification service
            _notify_negative_stock(source_level, transfer)
```

### apply_template_to_work_order(work_order, template, start_date) -> dict

```python
def apply_template_to_work_order(work_order, template, start_date):
    """
    Creates WorkOrderTask rows from template tasks using bulk_create
    (no post_save signals fire). Fires exactly one recalculate_critical_path
    via transaction.on_commit after commit.
    Returns {"tasks_created": N, "parts_suggested": M}
    """
    from datetime import timedelta
    tasks_to_create = []
    offset = 0
    for tmpl_task in template.tasks.order_by('sort_order'):
        tasks_to_create.append(WorkOrderTask(
            marina=work_order.marina,
            work_order=work_order,
            title=tmpl_task.title,
            description=tmpl_task.description,
            planned_start=start_date + timedelta(days=offset),
            planned_end=start_date + timedelta(days=offset + tmpl_task.duration_days - 1),
            sort_order=tmpl_task.sort_order,
            estimated_hours=tmpl_task.estimated_hours,
        ))
        offset += tmpl_task.duration_days

    with transaction.atomic():
        WorkOrderTask.objects.bulk_create(tasks_to_create)
        transaction.on_commit(
            lambda: recalculate_critical_path.delay(work_order.pk)
        )

    parts = list(template.parts.select_related('part'))
    return {'tasks_created': len(tasks_to_create), 'parts_suggested': len(parts)}
```

### complete_build_milestone(milestone, actual_date) -> Invoice

```python
def complete_build_milestone(milestone, actual_date):
    """
    Sets milestone.actual_date, creates a billing.Invoice with one line item,
    sets milestone.invoice FK, saves both. Returns the Invoice.
    """
    from apps.billing.models import Invoice, InvoiceLineItem
    from django.utils import timezone
    from datetime import timedelta

    with transaction.atomic():
        invoice = Invoice.objects.create(
            marina=milestone.marina,
            member=milestone.build_project.vessel.owner if milestone.build_project.vessel else None,
            due_date=actual_date + timedelta(days=milestone.payment_due_days),
            status='draft',
        )
        InvoiceLineItem.objects.create(
            invoice=invoice,
            description=f'{milestone.build_project.project_name} — {milestone.name}',
            quantity=1,
            unit_price=milestone.payment_amount,
            total=milestone.payment_amount,
        )
        milestone.actual_date = actual_date
        milestone.invoice = invoice
        milestone.save(update_fields=['actual_date', 'invoice'])
    return invoice
```

### post_warranty_reimbursement_gl(claim_id: int) -> None

Called via `transaction.on_commit(lambda: post_warranty_gl_entry.delay(claim_id=instance.pk))` in the ViewSet when status transitions to `'reimbursed'`. Implementation lives in `tasks.py` as a Celery task:

```python
@shared_task
def post_warranty_gl_entry(claim_id: int):
    from apps.billing.models import JournalEntry
    claim = WarrantyClaim.objects.select_related('marina', 'agreement').get(pk=claim_id)
    if claim.status != 'reimbursed' or claim.journal_entry_id:
        return
    marina = claim.marina
    je = JournalEntry.objects.create(
        marina=marina,
        source_type='warranty_reimbursement',
        source_id=claim.pk,
        amount=claim.amount_reimbursed,
        debit_account=marina.warranty_gl_account,   # AR / Bank Clearing
        credit_account=marina.warranty_cogs_offset_account,  # Warranty Revenue / COGS Offset
        description=f'Warranty reimbursement — Claim #{claim.pk}',
    )
    claim.journal_entry = je
    claim.save(update_fields=['journal_entry'])
```

---

## API Endpoints

File: `backend/apps/boatyard/views.py` (append new ViewSets) + `backend/apps/boatyard/urls.py` (add router)

Switch to a DRF `DefaultRouter` alongside the existing function/path-based URLs. All new ViewSets inject `marina` from `request.user.marina` in `get_queryset` and `perform_create`.

### WorkOrderTask

| Method | URL | Notes |
|---|---|---|
| GET | `/api/v1/boatyard/work-order-tasks/` | Filter: `?work_order={id}` |
| POST | `/api/v1/boatyard/work-order-tasks/` | |
| GET | `/api/v1/boatyard/work-order-tasks/{id}/` | |
| PATCH | `/api/v1/boatyard/work-order-tasks/{id}/` | PATCH triggers `recalculate_critical_path.apply_async(args=[wo_id], countdown=5)` via `post_save` signal |
| DELETE | `/api/v1/boatyard/work-order-tasks/{id}/` | |
| GET | `/api/v1/boatyard/work-orders/{id}/gantt/` | Custom action; returns `GanttTask` shape with `is_critical` read from DB, `actualHours`/`actualCost` via `annotate()` |
| POST | `/api/v1/boatyard/work-orders/{id}/lock-baseline/` | Copies `planned_start/end → baseline_start/end` for all tasks atomically; returns `409` if already locked |
| POST | `/api/v1/boatyard/work-orders/{id}/apply-template/` | Body: `{template_id, start_date}`; uses `apply_template_to_work_order()`; returns `{tasks_created, parts_suggested}` |

### TaskDependency

| Method | URL | Notes |
|---|---|---|
| GET | `/api/v1/boatyard/task-dependencies/` | Filter: `?work_order={id}` (join through predecessor__work_order) |
| POST | `/api/v1/boatyard/task-dependencies/` | Serializer validates: only `fs` type in v1; BFS cycle detection before save; fires `recalculate_critical_path` |
| DELETE | `/api/v1/boatyard/task-dependencies/{id}/` | |

### BuildProject

| Method | URL | Notes |
|---|---|---|
| GET/POST | `/api/v1/boatyard/build-projects/` | No DELETE |
| GET/PATCH | `/api/v1/boatyard/build-projects/{id}/` | |
| GET/POST | `/api/v1/boatyard/build-projects/{id}/bom/` | Nested BOMItem |
| PATCH/DELETE | `/api/v1/boatyard/build-projects/{id}/bom/{item_id}/` | |
| GET/POST | `/api/v1/boatyard/build-projects/{id}/milestones/` | |
| PATCH | `/api/v1/boatyard/build-projects/{id}/milestones/{milestone_id}/` | |
| POST | `/api/v1/boatyard/build-projects/{id}/milestones/{milestone_id}/complete/` | Body: `{actual_date}`; calls `complete_build_milestone()`; returns `{invoice_id}` |

### JobTemplate

| Method | URL | Notes |
|---|---|---|
| GET/POST | `/api/v1/boatyard/job-templates/` | Filter: `?is_active=true` |
| GET/PATCH | `/api/v1/boatyard/job-templates/{id}/` | Response includes nested `tasks` and `parts` arrays |

### Batch Job Post

| Method | URL | Notes |
|---|---|---|
| POST | `/api/v1/boatyard/batch-job-posts/` | Validates `work_order_task` required when WO has tasks; returns `{batch_id, lines_posted}` |
| GET | `/api/v1/boatyard/batch-job-posts/` | Filter: `?work_order={id}` |
| GET | `/api/v1/boatyard/batch-job-posts/{id}/` | |

### Warranty

| Method | URL | Notes |
|---|---|---|
| GET/POST | `/api/v1/boatyard/warranty-agreements/` | |
| PATCH | `/api/v1/boatyard/warranty-agreements/{id}/` | |
| POST | `/api/v1/boatyard/warranty-agreements/{id}/upload-template/` | Multipart PDF upload; saves to S3; sets `pdf_template_url` |
| GET | `/api/v1/boatyard/warranty-claims/` | Filter: `?work_order={id}&status=submitted` |
| POST | `/api/v1/boatyard/warranty-claims/` | |
| PATCH | `/api/v1/boatyard/warranty-claims/{id}/` | On `status → reimbursed`: fires `post_warranty_gl_entry.delay` via `transaction.on_commit` |
| POST | `/api/v1/boatyard/warranty-claims/{id}/submit/` | Returns `{job_id}` immediately; enqueues `generate_warranty_claim_pdf` |

### Supplier Price File

| Method | URL | Notes |
|---|---|---|
| POST | `/api/v1/boatyard/supplier-price-files/` | Step 1: upload file + supplier name; returns `{price_file_id, detected_headers, suggested_mapping, mapping_saved}` |
| GET | `/api/v1/boatyard/supplier-price-files/{id}/` | Poll for import status |
| POST | `/api/v1/boatyard/supplier-price-files/{id}/confirm-mapping/` | Step 2: upserts `SupplierColumnMap`, queues `import_supplier_price_file` task, returns `202` |
| GET | `/api/v1/boatyard/supplier-price-files/{id}/flagged/` | Flagged `PartPriceHistory` rows pending approval |
| POST | `/api/v1/boatyard/part-price-history/{id}/approve/` | Sets `applied=True`, updates `Part.unit_cost` |

### Service Truck Inventory

| Method | URL | Notes |
|---|---|---|
| GET/POST | `/api/v1/boatyard/service-trucks/` | |
| PATCH | `/api/v1/boatyard/service-trucks/{id}/` | |
| GET | `/api/v1/boatyard/inventory-levels/` | Filter: `?location={id}` or `?part={id}` |
| POST | `/api/v1/boatyard/truck-stock-transfers/` | Calls `execute_transfer()`; creates `InventoryAnomaly` if source goes negative |
| GET | `/api/v1/boatyard/truck-stock-transfers/` | Filter: `?truck={id}` |

---

## Serializers

Create separate serializer modules to keep the file manageable:

| File | Contains |
|---|---|
| `boatyard/serializers/tasks_serializers.py` | `WorkOrderTaskSerializer`, `TaskDependencySerializer` (with BFS cycle detection in `validate()`), `GanttTaskSerializer` |
| `boatyard/serializers/build_serializers.py` | `BuildProjectSerializer`, `BOMItemSerializer`, `BuildMilestoneSerializer` |
| `boatyard/serializers/template_serializers.py` | `JobTemplateSerializer` (with nested tasks + parts), `JobTemplateTaskSerializer`, `JobTemplatePartSerializer` |
| `boatyard/serializers/batch_serializers.py` | `BatchJobPostSerializer`, `BatchJobPostLineSerializer` |
| `boatyard/serializers/warranty_serializers.py` | `WarrantyAgreementSerializer`, `WarrantyClaimSerializer` |
| `boatyard/serializers/pricing_serializers.py` | `SupplierPriceFileSerializer`, `SupplierColumnMapSerializer`, `PartPriceHistorySerializer` |
| `boatyard/serializers/truck_serializers.py` | `LocationSerializer`, `ServiceTruckSerializer`, `InventoryLevelSerializer`, `InventoryAnomalySerializer`, `TruckStockTransferSerializer` |

The `TaskDependencySerializer.validate()` method must:
1. Reject `dependency_type != 'fs'` with `ValidationError('Only finish-to-start dependencies are supported in v1.')`.
2. Run `_has_cycle(predecessor_id, successor_id, marina_id)` BFS (code in spec Section 6.1) and reject cycles with `ValidationError('This dependency would create a cycle.')`.

---

## Celery Tasks

File: `backend/apps/boatyard/tasks.py`

### recalculate_critical_path(work_order_id)

- Acquire Redis lock `lock:critical_path:{work_order_id}` with `SET NX PX 30000`.
- If lock not acquired within 2 s: return silently.
- Load all `WorkOrderTask` and `TaskDependency` rows for the work order.
- Topological sort (Kahn's algorithm) + forward pass to compute earliest finish per task.
- Tasks on the longest path: `is_critical=True`; all others: `False`.
- `WorkOrderTask.objects.bulk_update(tasks, ['is_critical'])`.
- Release lock.
- If cycle detected in data: set all `is_critical=False`, log warning — do not raise.

### import_supplier_price_file(price_file_id)

- `bind=True, max_retries=3`.
- Load `SupplierPriceFile` + its `SupplierColumnMap`.
- Fetch file from S3 / call API.
- Parse with `pandas.read_csv` (CSV) or custom parser (EDI) using confirmed column mapping.
- For each row: match `Part` by `part_no` + `supplier`. Compute `change_pct`.
- If `change_pct > flag_threshold_pct`: create `PartPriceHistory(applied=False, is_flagged=True)`.
- Else: create `PartPriceHistory(applied=True)` and update `Part.unit_cost`.
- Update `SupplierPriceFile` counters and status.
- Unmatched rows: append to `error_detail` as JSON log.

### generate_warranty_claim_pdf(claim_id)

- Load `WarrantyClaim` + `WarrantyAgreement` + `WorkOrder`.
- If `WarrantyAgreement.pdf_template_url` set: download fillable PDF from S3, stamp with `pdfrw`.
- Else: render standard DocksBase claim PDF using WeasyPrint + Django template.
- Upload completed PDF to S3; set `claim.claim_document_url`.
- Set `claim.status = 'submitted'`, `claim.submitted_at = now()`.
- Send email to `WarrantyAgreement.contact_email` with PDF attached.

### check_truck_restock()

- Celery Beat: daily at 07:00 marina local time.
- Find `InventoryLevel` rows: `location__location_type='truck'` AND `quantity < par` AND `par IS NOT NULL`.
- Find `InventoryLevel` rows: `quantity < 0` — ensure open `InventoryAnomaly` exists for each.
- Collate into a single email to parts manager with two sections: "Restock Required" and "Negative Stock — Cycle Count Needed".

---

## Signals

File: `backend/apps/boatyard/signals.py` (new file; register in `apps.py` `ready()`).

```python
from django.db.models.signals import post_save
from django.dispatch import receiver

@receiver(post_save, sender=WorkOrderTask)
def on_task_saved(sender, instance, **kwargs):
    from .tasks import recalculate_critical_path
    recalculate_critical_path.apply_async(
        args=[instance.work_order_id], countdown=5
    )

@receiver(post_save, sender=TaskDependency)
def on_dependency_saved(sender, instance, **kwargs):
    from .tasks import recalculate_critical_path
    recalculate_critical_path.apply_async(
        args=[instance.predecessor.work_order_id], countdown=5
    )
```

**Important:** `bulk_create` in `apply_template_to_work_order()` and `lock-baseline` action do NOT fire these signals (Django design). Those code paths fire `recalculate_critical_path.delay()` directly via `transaction.on_commit`.

Register in `backend/apps/boatyard/apps.py`:

```python
class BoatyardConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.boatyard'

    def ready(self):
        import apps.boatyard.signals  # noqa
```

---

## Admin

File: `backend/apps/boatyard/admin.py` (append).

```python
@admin.register(WorkOrderTask)
class WorkOrderTaskAdmin(admin.ModelAdmin):
    list_display = ['work_order', 'title', 'status', 'planned_start', 'planned_end', 'is_critical']
    list_filter  = ['status', 'is_critical', 'marina']
    search_fields = ['title', 'work_order__title']

@admin.register(BuildProject)
class BuildProjectAdmin(admin.ModelAdmin):
    list_display = ['project_name', 'status', 'keel_laid_date', 'launch_target_date']
    list_filter  = ['status', 'marina']

@admin.register(WarrantyClaim)
class WarrantyClaimAdmin(admin.ModelAdmin):
    list_display = ['pk', 'agreement', 'work_order', 'status', 'total_claimed', 'amount_reimbursed']
    list_filter  = ['status', 'marina']

@admin.register(InventoryLevel)
class InventoryLevelAdmin(admin.ModelAdmin):
    list_display = ['part', 'location', 'quantity', 'par']
    list_filter  = ['marina', 'location__location_type']

@admin.register(InventoryAnomaly)
class InventoryAnomalyAdmin(admin.ModelAdmin):
    list_display = ['inventory_level', 'quantity_after', 'status', 'created_at']
    list_filter  = ['status', 'marina']

@admin.register(ServiceTruck)
class ServiceTruckAdmin(admin.ModelAdmin):
    list_display = ['location', 'registration', 'assigned_to', 'is_active']

@admin.register(SupplierPriceFile)
class SupplierPriceFileAdmin(admin.ModelAdmin):
    list_display = ['supplier_name', 'import_format', 'status', 'rows_processed', 'rows_flagged', 'queued_at']

@admin.register(PartPriceHistory)
class PartPriceHistoryAdmin(admin.ModelAdmin):
    list_display = ['part', 'old_unit_cost', 'new_unit_cost', 'change_pct', 'is_flagged', 'applied', 'recorded_at']
    list_filter  = ['is_flagged', 'applied']
```

---

## Settings / URL Wiring

### Settings

Add to `config/settings/base.py`:

```python
# Celery (if not already present from another track)
CELERY_BROKER_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
CELERY_RESULT_BACKEND = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')

CELERY_BEAT_SCHEDULE = {
    # ... existing tasks ...
    'check-truck-restock-daily': {
        'task': 'apps.boatyard.tasks.check_truck_restock',
        'schedule': crontab(hour=7, minute=0),
    },
}
```

Add `X-Forklift-Device-Token` to `CORS_ALLOW_HEADERS` (also needed for Track 6).

### URLs

In `backend/apps/boatyard/urls.py`, add a DRF router and prefix it with `boatyard/`:

```python
from rest_framework.routers import DefaultRouter
from .viewsets import (
    WorkOrderTaskViewSet, TaskDependencyViewSet, BuildProjectViewSet,
    JobTemplateViewSet, BatchJobPostViewSet, WarrantyAgreementViewSet,
    WarrantyClaimViewSet, SupplierPriceFileViewSet, PartPriceHistoryViewSet,
    ServiceTruckViewSet, InventoryLevelViewSet, TruckStockTransferViewSet,
)

router = DefaultRouter()
router.register(r'boatyard/work-order-tasks', WorkOrderTaskViewSet, basename='wo-task')
router.register(r'boatyard/task-dependencies', TaskDependencyViewSet, basename='task-dep')
router.register(r'boatyard/build-projects', BuildProjectViewSet, basename='build-project')
router.register(r'boatyard/job-templates', JobTemplateViewSet, basename='job-template')
router.register(r'boatyard/batch-job-posts', BatchJobPostViewSet, basename='batch-post')
router.register(r'boatyard/warranty-agreements', WarrantyAgreementViewSet, basename='warranty-agreement')
router.register(r'boatyard/warranty-claims', WarrantyClaimViewSet, basename='warranty-claim')
router.register(r'boatyard/supplier-price-files', SupplierPriceFileViewSet, basename='price-file')
router.register(r'boatyard/part-price-history', PartPriceHistoryViewSet, basename='price-history')
router.register(r'boatyard/service-trucks', ServiceTruckViewSet, basename='service-truck')
router.register(r'boatyard/inventory-levels', InventoryLevelViewSet, basename='inventory-level')
router.register(r'boatyard/truck-stock-transfers', TruckStockTransferViewSet, basename='truck-transfer')

urlpatterns = [
    # ... existing path() entries unchanged ...
] + router.urls
```

In `config/urls.py`, the existing `path('', include('apps.boatyard.urls'))` already includes boatyard — no change needed there.

---

## Migration Notes

- **Migration 1** (WorkOrderTask + TaskDependency): straightforward new tables.
- **Migration 2** (Location + ServiceTruck + InventoryLevel + InventoryAnomaly): add tables. Include a `RunPython` data migration that, for each marina, creates one `Location(location_type='warehouse', name='Main Warehouse')` and then creates `InventoryLevel` rows from existing `Part.stock` values — `InventoryLevel(marina=part.marina, part=part, location=warehouse_location, quantity=part.stock, par=part.par)`.
- **Migration 3** (TruckStockTransfer): add table after InventoryLevel exists.
- **Migration 4** (BuildProject + BOMItem + BuildMilestone): requires `billing.Invoice` FK — confirm billing app migrations are applied first.
- **Migration 5** (JobTemplate + JobTemplateTask + JobTemplatePart): standalone.
- **Migration 6** (BatchJobPost + BatchJobPostLine): requires WorkOrder and WorkOrderTask to exist.
- **Migration 7** (WarrantyAgreement + WarrantyClaim + Marina GL fields): requires `billing.JournalEntry` and `billing.Account` to exist. Add `warranty_gl_account` and `warranty_cogs_offset_account` to `accounts.Marina` in this migration.
- **Migration 8** (SupplierPriceFile + SupplierColumnMap + PartPriceHistory): standalone.
- After all migrations: `Part.stock` and `Part.location` (CharField) are deprecated but not dropped. Drop them in a cleanup migration after v1 validation.

---

## Implementation Order

Follow this exact sequence — each step depends on the previous ones being deployed.

1. **Append `WorkOrderTask` and `TaskDependency` to `models.py`** — write migration (`0002_workordertask_taskdependency.py`). Run and verify. Add `clean()` validations. Update `apps.py` to load signals module.

2. **Append `Location`, `ServiceTruck`, `InventoryLevel`, `InventoryAnomaly` to `models.py`** — write migration (`0003_location_inventorylevel.py`) with `RunPython` data migration seeding warehouse `Location` rows and `InventoryLevel` rows from `Part.stock`.

3. **Append `TruckStockTransfer` to `models.py`** — migration `0004_truckstocktransfer.py`. Write `execute_transfer()` in `services.py`.

4. **Append `BuildProject`, `BOMItem`, `BuildMilestone` to `models.py`** — migration `0005_build_project.py`. Write `complete_build_milestone()` in `services.py`.

5. **Append `JobTemplate`, `JobTemplateTask`, `JobTemplatePart` to `models.py`** — migration `0006_job_templates.py`. Write `apply_template_to_work_order()` in `services.py`.

6. **Append `BatchJobPost` and `BatchJobPostLine` to `models.py`** — migration `0007_batch_post.py`. Add computed `actual_hours` property annotation pattern to `WorkOrderViewSet`.

7. **Add `warranty_gl_account` and `warranty_cogs_offset_account` to `accounts.Marina`** and append `WarrantyAgreement` and `WarrantyClaim` to `boatyard/models.py` — migration `0008_warranty.py`. Write `post_warranty_reimbursement_gl()` / `post_warranty_gl_entry` Celery task.

8. **Append `SupplierPriceFile`, `SupplierColumnMap`, `PartPriceHistory` to `models.py`** — migration `0009_supplier_price_file.py`.

9. **Create `boatyard/serializers/` package** — one file per domain (7 files). Implement BFS cycle detection in `TaskDependencySerializer.validate()`.

10. **Create `boatyard/viewsets.py`** (new file) — implement all 12 ViewSets. Implement custom actions: `gantt`, `lock_baseline`, `apply_template`, `complete_milestone`, `confirm_mapping`, `upload_template`, `submit` (claim), `approve` (price history).

11. **Extend `boatyard/urls.py`** — add DRF router with all 12 ViewSet registrations. Leave existing `path()` entries in place.

12. **Write `boatyard/tasks.py`** — implement `recalculate_critical_path` (with Redis lock), `import_supplier_price_file`, `generate_warranty_claim_pdf`, `check_truck_restock`. Wire `check_truck_restock` to Celery Beat.

13. **Write `boatyard/signals.py`** — `post_save` handlers for `WorkOrderTask` and `TaskDependency`. Register in `apps.py`.

14. **Update `boatyard/admin.py`** — register all 8 new models.

15. **Install frontend dependencies** — `npm install frappe-gantt-react` in `frontend/`.

16. **Add view-mode segmented control to Work Orders tab** — modify `WorkOrdersTab.jsx` to render `List | Kanban | Gantt` toggle. Route Gantt mode to new `GanttTab.jsx`.

17. **Build `GanttTab.jsx`, `GanttChart.jsx`, `GanttToolbar.jsx`** — implement drag-to-reschedule with optimistic UI (spec Section 3.5). Implement baseline SVG overlay via `useLayoutEffect`. Implement zoom levels (Day/Week/Month).

18. **Build `DependencyModal.jsx`** — two-click right-click context menu flow for creating `TaskDependency`.

19. **Build `TaskFormDrawer.jsx`** — create/edit `WorkOrderTask`.

20. **Build `BuildProjectsTab.jsx`** — `BuildProjectList`, `BuildProjectFormDrawer`, `BOMTable` (inline editable), `MilestoneTimeline` with "Mark Complete" button.

21. **Build `JobTemplatesTab.jsx`** — `TemplateList`, `TemplateFormDrawer` (nested tasks + parts sub-rows), `ApplyTemplateModal`.

22. **Build `WarrantyTab.jsx`** — `WarrantyAgreementList`, `WarrantyAgreementDrawer` (includes PDF template upload field), `WarrantyClaimList`, `WarrantyClaimDrawer` with submit button and status polling.

23. **Build `ServiceTrucksTab.jsx`** — `TruckList`, `TruckInventoryTable` (InventoryLevel rows filtered by `location`), `TransferModal`.

24. **Add `BatchPostModal.jsx`** to Work Orders tab — dynamic line rows; validates task picker when WO has tasks.

25. **Add `PriceFileUploadDrawer.jsx`** to Parts tab — two-step column-mapping wizard (auto-skip if saved mapping found), import progress polling, flagged-increase approval flow with badge.

26. **Register new tabs in `Boatyard.jsx`** — extend tab bar to 12 items (Build, Templates, Warranty, Trucks); add conditional render branches.

27. **Write all data hooks** — `useWorkOrderTasks.js`, `useTaskDependencies.js`, `useBuildProjects.js`, `useJobTemplates.js`, `useBatchJobPosts.js`, `useWarrantyAgreements.js`, `useWarrantyClaims.js`, `useSupplierPriceFiles.js`, `useServiceTrucks.js`, `useInventoryLevels.js`, `useTruckTransfers.js`.

28. **Manual QA pass** — test: drag-to-reschedule with dependency constraint violation; cycle detection rejection; price file mapping wizard (new supplier + returning supplier); warranty PDF with/without manufacturer template; milestone complete → invoice creation; truck restock alert with InventoryLevel below par; negative stock → InventoryAnomaly creation.
