"""
Utilities app signals.

BollardFaultLog.post_save:
  Auto-creates a boatyard.WorkOrder when a bollard fault is logged.
  Uses transaction.on_commit() to dispatch after the outer transaction
  commits — prevents orphaned WorkOrders if the outer atomic() rolls back.
"""

import logging

from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.utilities.models import BollardFaultLog

logger = logging.getLogger(__name__)


@receiver(post_save, sender=BollardFaultLog)
def create_work_order_for_fault(sender, instance, created, **kwargs):
    """
    Auto-create a boatyard.WorkOrder when a bollard fault is logged.

    Wrapped in transaction.on_commit() so the WorkOrder is only written
    after the fault record is durably committed — safe under atomic().
    """
    if not created or instance.work_order_id:
        # Either an update, or WorkOrder already linked (e.g. set in a migration)
        return

    def _create():
        try:
            from apps.boatyard.models import WorkOrder

            wo = WorkOrder.objects.create(
                marina=instance.bollard.marina,
                title=(
                    f'Bollard Fault: {instance.bollard.label} — '
                    f'{instance.get_fault_type_display()}'
                ),
                category='electrical',
                description=instance.description,
                priority='high',
                status='pending_auth',
            )
            # Re-fetch to avoid stale state after the commit
            BollardFaultLog.objects.filter(pk=instance.pk).update(work_order=wo)
            logger.info(
                'Created WorkOrder %s for BollardFaultLog %s', wo.pk, instance.pk
            )
        except Exception:
            logger.exception(
                'Failed to create WorkOrder for BollardFaultLog %s', instance.pk
            )

    transaction.on_commit(_create)
