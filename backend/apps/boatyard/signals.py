"""
Boatyard app signals — Track 6 additions.

PickTicketLine.post_save:
  Sets pick_ticket_complete=True on LaunchRequest when all lines are done/skipped.
  Uses transaction.on_commit() so the flag update is durable before any
  downstream reads.

BatteryChargeRequest.post_save:
  Sends notification to vessel owner when status transitions to 'complete'.
  Wrapped in transaction.on_commit() — notification fires only after the
  status change is committed.
"""

import logging

from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)


@receiver(post_save, sender='boatyard.PickTicketLine')
def update_pick_ticket_complete(sender, instance, **kwargs):
    """
    Set pick_ticket_complete on LaunchRequest when all PickTicketLines
    are done or skipped.
    """
    def _check():
        try:
            pick_ticket = instance.pick_ticket
            lines       = pick_ticket.lines.all()
            if lines.exists() and all(line.status in ('done', 'skipped') for line in lines):
                from apps.boatyard.models import LaunchRequest
                LaunchRequest.objects.filter(pk=pick_ticket.launch_request_id).update(
                    pick_ticket_complete=True
                )
                logger.info(
                    'pick_ticket_complete=True set on LaunchRequest %s',
                    pick_ticket.launch_request_id,
                )
        except Exception:
            logger.exception(
                'update_pick_ticket_complete failed for PickTicketLine %s', instance.pk
            )

    transaction.on_commit(_check)


@receiver(post_save, sender='boatyard.BatteryChargeRequest')
def notify_battery_charge_complete(sender, instance, **kwargs):
    """
    Send notification to vessel owner when battery charge is marked complete.
    Fires only on the 'complete' status — ignores all other save events.
    """
    if instance.status != 'complete':
        return

    def _notify():
        try:
            vessel = instance.vessel
            member = getattr(vessel, 'member', None)
            if not member:
                return

            # Attempt to use the comms/notifications app if available
            try:
                from apps.accounts.notifications import send_notification
                send_notification(
                    recipient=member,
                    subject='Battery Charge Complete',
                    body=(
                        f'Your vessel {vessel.name} battery charge is complete '
                        f'and ready for collection.'
                    ),
                )
            except ImportError:
                logger.warning(
                    'notifications module not available — BatteryChargeRequest %s complete for vessel %s',
                    instance.pk, vessel.name,
                )
        except Exception:
            logger.exception(
                'notify_battery_charge_complete failed for BatteryChargeRequest %s', instance.pk
            )

    transaction.on_commit(_notify)


# ---------------------------------------------------------------------------
# Track 5 — WorkOrder task / dependency signals
# ---------------------------------------------------------------------------

@receiver(post_save, sender='boatyard.WorkOrderTask')
def on_task_saved(sender, instance, **kwargs):
    """
    Trigger critical path recalculation whenever a WorkOrderTask is saved.
    Uses a 5-second countdown so rapid successive saves are collapsed.
    """
    from .tasks import recalculate_critical_path
    recalculate_critical_path.apply_async(
        args=[instance.work_order_id],
        countdown=5,
    )


@receiver(post_save, sender='boatyard.TaskDependency')
def on_dependency_saved(sender, instance, **kwargs):
    """
    Trigger critical path recalculation whenever a TaskDependency is saved.
    """
    from .tasks import recalculate_critical_path
    recalculate_critical_path.apply_async(
        args=[instance.predecessor.work_order_id],
        countdown=5,
    )
