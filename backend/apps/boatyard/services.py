"""
apps/boatyard/services.py
Track 5 — Boatyard Advanced service layer.

All public functions are thin orchestration helpers that keep business logic
out of views and signals.  Heavy lifting (PDF generation, GL posting) is
delegated to Celery tasks so views remain fast.
"""

import datetime
import logging
from decimal import Decimal

from django.db import transaction

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Truck-stock transfer
# ---------------------------------------------------------------------------

def execute_transfer(transfer) -> None:
    """
    Atomically move stock between warehouse and a service truck.

    Acquires row-level locks on both InventoryLevel rows before updating
    quantities.  If the source quantity would go negative after the move an
    InventoryAnomaly is created (quantity_after records the resulting balance
    *before* it is clamped to zero so that cycle-count staff know the discrepancy).

    The transfer object must already be saved; this function never saves it.
    """
    from .models import InventoryLevel, InventoryAnomaly, Location

    with transaction.atomic():
        truck_location = transfer.truck.location

        # Resolve warehouse location for this marina
        warehouse_qs = Location.objects.filter(
            marina=transfer.marina,
            location_type=Location.LocationType.WAREHOUSE,
        )
        if not warehouse_qs.exists():
            raise ValueError(
                f'No warehouse Location found for marina {transfer.marina_id}.'
            )
        warehouse_location = warehouse_qs.first()

        if transfer.direction == 'to_truck':
            src_location = warehouse_location
            dst_location = truck_location
        else:
            src_location = truck_location
            dst_location = warehouse_location

        # get_or_create then lock — two-step avoids gap-locking issues
        src_level, _ = InventoryLevel.objects.get_or_create(
            marina=transfer.marina,
            part=transfer.part,
            location=src_location,
            defaults={'quantity': Decimal('0')},
        )
        dst_level, _ = InventoryLevel.objects.get_or_create(
            marina=transfer.marina,
            part=transfer.part,
            location=dst_location,
            defaults={'quantity': Decimal('0')},
        )

        # Lock both rows in a consistent order to avoid deadlocks
        levels = InventoryLevel.objects.select_for_update().filter(
            pk__in=sorted([src_level.pk, dst_level.pk])
        )
        locked = {lv.pk: lv for lv in levels}
        src_level = locked[src_level.pk]
        dst_level = locked[dst_level.pk]

        new_src_qty = src_level.quantity - transfer.quantity

        if new_src_qty < 0:
            # Record the anomaly but still allow the transfer (negative qty
            # signals a cycle-count discrepancy, not a hard block).
            InventoryAnomaly.objects.create(
                marina=transfer.marina,
                inventory_level=src_level,
                transfer=transfer,
                quantity_after=new_src_qty,
            )
            logger.warning(
                'Negative inventory after transfer %s: part=%s location=%s qty_after=%s',
                transfer.pk, transfer.part_id, src_location.pk, new_src_qty,
            )

        src_level.quantity = new_src_qty
        dst_level.quantity = dst_level.quantity + transfer.quantity
        src_level.save(update_fields=['quantity'])
        dst_level.save(update_fields=['quantity'])


# ---------------------------------------------------------------------------
# Job template application
# ---------------------------------------------------------------------------

def apply_template_to_work_order(work_order, template, start_date) -> dict:
    """
    Instantiate a JobTemplate's tasks onto a WorkOrder.

    Tasks are scheduled sequentially: each task starts the day after the
    previous task ends (simple sequential scheduling).  Actual CPM is
    computed asynchronously by the recalculate_critical_path Celery task.

    Returns a dict with ``tasks_created`` count.
    """
    from .models import WorkOrderTask
    from .tasks import recalculate_critical_path

    if isinstance(start_date, str):
        start_date = datetime.date.fromisoformat(start_date)

    template_tasks = list(template.tasks.order_by('sort_order'))
    if not template_tasks:
        return {'tasks_created': 0}

    tasks_to_create = []
    cursor = start_date
    for idx, tt in enumerate(template_tasks):
        duration = max(tt.duration_days, 1)
        task_end = cursor + datetime.timedelta(days=duration - 1)
        tasks_to_create.append(
            WorkOrderTask(
                marina=work_order.marina,
                work_order=work_order,
                title=tt.title,
                description=tt.description,
                planned_start=cursor,
                planned_end=task_end,
                sort_order=tt.sort_order if tt.sort_order else idx,
            )
        )
        cursor = task_end + datetime.timedelta(days=1)

    with transaction.atomic():
        created = WorkOrderTask.objects.bulk_create(tasks_to_create)
        transaction.on_commit(
            lambda: recalculate_critical_path.delay(work_order.pk)
        )

    return {'tasks_created': len(created)}


# ---------------------------------------------------------------------------
# Build milestone completion
# ---------------------------------------------------------------------------

def complete_build_milestone(milestone, actual_date) -> object:
    """
    Mark a BuildMilestone as complete, create a draft Invoice for its payment
    amount, and link the invoice back to the milestone.

    Returns the newly created Invoice.

    Requires billing.Invoice and billing.InvoiceLineItem to exist.
    """
    from billing.models import Invoice, InvoiceLineItem  # noqa — lazy import

    if isinstance(actual_date, str):
        actual_date = datetime.date.fromisoformat(actual_date)

    with transaction.atomic():
        # Generate a sequential invoice number within the marina
        existing_count = Invoice.objects.filter(
            marina=milestone.marina
        ).count()
        invoice_number = f'M-{milestone.build_project_id:05d}-{existing_count + 1:04d}'

        due_date = actual_date + datetime.timedelta(days=milestone.payment_due_days)

        invoice = Invoice.objects.create(
            marina=milestone.marina,
            invoice_number=invoice_number,
            status='draft',
            source_type='build_milestone',
            source_id=str(milestone.pk),
            subtotal=milestone.payment_amount,
            total=milestone.payment_amount,
            due_date=due_date,
        )

        InvoiceLineItem.objects.create(
            invoice=invoice,
            description=f'Build Milestone: {milestone.name}',
            quantity=Decimal('1.00'),
            unit_price=milestone.payment_amount,
            total_price=milestone.payment_amount,
        )

        milestone.actual_date = actual_date
        milestone.invoice = invoice
        milestone.save(update_fields=['actual_date', 'invoice'])

    return invoice
