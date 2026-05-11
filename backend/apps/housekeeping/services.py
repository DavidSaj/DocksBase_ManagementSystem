"""
Service layer for housekeeping operations.

All linen inventory mutations use F() expressions inside transaction.atomic()
to prevent lost updates under concurrent housekeeper task completions (e.g. mobile devices).
"""
import logging

from django.db import transaction
from django.db.models import F

logger = logging.getLogger('apps.housekeeping')


def mark_linen_dirty(inventory_id, qty=1):
    """
    Atomic linen inventory update. Moves `qty` units from clean to dirty.

    Uses F() expression to prevent lost updates under concurrent housekeeper
    task completions on mobile devices. After the atomic update, re-fetches
    with select_for_update to check the laundry threshold and create a laundry
    task if needed. An existence guard prevents duplicate laundry tasks.

    Raises ValueError if qty <= 0.
    """
    from apps.housekeeping.models import HousekeepingTask, LinenInventory

    if qty <= 0:
        raise ValueError('qty must be positive.')

    with transaction.atomic():
        # Atomic increment — eliminates read-modify-write race condition
        LinenInventory.objects.filter(pk=inventory_id).update(
            qty_dirty=F('qty_dirty') + qty,
            qty_clean=F('qty_clean') - qty,
        )
        # Re-fetch with lock to get committed value for threshold check
        inventory = LinenInventory.objects.select_for_update().get(pk=inventory_id)

        if inventory.qty_dirty >= inventory.laundry_threshold:
            # Existence guard: only create if no open laundry task already exists
            already_open = HousekeepingTask.objects.filter(
                marina=inventory.marina,
                source_type=HousekeepingTask.SourceType.LAUNDRY,
                unit_id=str(inventory.linen_set_id),
                status__in=[
                    HousekeepingTask.Status.DIRTY,
                    HousekeepingTask.Status.IN_PROGRESS,
                    HousekeepingTask.Status.READY_INSPECTION,
                ],
            ).exists()

            if not already_open:
                HousekeepingTask.objects.create(
                    marina=inventory.marina,
                    source_type=HousekeepingTask.SourceType.LAUNDRY,
                    unit_type=HousekeepingTask.UnitType.FACILITY,
                    unit_id=str(inventory.linen_set_id),
                    unit_label=f'Laundry: {inventory.linen_set.name}',
                    priority=HousekeepingTask.Priority.HIGH,
                )


def escalate_to_defect(task, description, severity):
    """
    Creates a maintenance.Defect from a housekeeping task.
    Notifies Maintenance Manager in-app and optionally via Track 7 CRITICAL_DEFECT AlertRoute.

    Returns the created Defect instance.
    """
    from apps.maintenance.models import Defect

    reporter_name = task.assigned_to.name if task.assigned_to else 'Housekeeping'

    full_description = f'{description}\n\n[Escalated from Housekeeping Task #{task.pk}]'
    defect = Defect.objects.create(
        marina=task.marina,
        location=task.unit_label,
        description=full_description,
        severity=severity,
        reporter=reporter_name,
        status='open',
    )

    try:
        from apps.communications.services.alert import send_alert
        send_alert(
            marina_id=task.marina_id,
            alert_type='critical_defect',
            subject=f'Defect Escalated from Housekeeping: {task.unit_label}',
            body=(
                f'{description} (Severity: {severity}). '
                f'Task #{task.pk}, Unit: {task.unit_label}.'
            ),
        )
    except Exception:
        pass

    return defect


def populate_task_checklist(task):
    """
    Pre-populate TaskChecklistCompletion rows from ChecklistItem templates
    matching the task's unit_type. Called when a task is first assigned.
    Uses bulk_create for efficiency — avoids N+1 inserts.
    """
    from apps.housekeeping.models import ChecklistItem, TaskChecklistCompletion

    templates = ChecklistItem.objects.filter(
        marina=task.marina,
        unit_type=task.unit_type,
        is_active=True,
    )
    TaskChecklistCompletion.objects.bulk_create([
        TaskChecklistCompletion(task=task, checklist_item=item)
        for item in templates
    ])


def advance_task_status(task):
    """
    Advance the HousekeepingTask through its status machine:
      dirty -> in_progress -> ready_inspection -> clean -> ready_guest

    On transition to in_progress: sets started_at.
    On transition to clean: sets completed_at; triggers mark_linen_dirty if applicable.
    On any invalid transition: raises ValueError.

    Returns the updated HousekeepingTask.
    """
    from django.utils import timezone
    from apps.housekeeping.models import HousekeepingTask

    STATUS = HousekeepingTask.Status
    TRANSITIONS = {
        STATUS.DIRTY:            STATUS.IN_PROGRESS,
        STATUS.IN_PROGRESS:      STATUS.READY_INSPECTION,
        STATUS.READY_INSPECTION: STATUS.CLEAN,
        STATUS.CLEAN:            STATUS.READY_GUEST,
    }

    if task.status == STATUS.READY_GUEST:
        raise ValueError('Task is already in the terminal state (ready_guest).')

    next_status = TRANSITIONS.get(task.status)
    if next_status is None:
        raise ValueError(f'Cannot advance from status "{task.status}".')

    update_fields = ['status']

    if next_status == STATUS.IN_PROGRESS and not task.started_at:
        task.started_at = timezone.now()
        update_fields.append('started_at')

    if next_status == STATUS.CLEAN:
        task.completed_at = timezone.now()
        update_fields.append('completed_at')

    task.status = next_status
    task.save(update_fields=update_fields)

    return task
