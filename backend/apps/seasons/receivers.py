"""
apps/seasons/receivers.py — wires the lease_access_revoked signal to an
audit log entry.  The actual hardware integration (HAL → ANPR / key fob
controllers) is implemented in apps.access_control and registers its own
receiver.  This stub guarantees the signal has at least one observer in
tests and exposes a hook other apps can subscribe to.
"""
import logging

from django.dispatch import receiver

from .signals import lease_access_revoked, lease_status_changed

logger = logging.getLogger(__name__)


@receiver(lease_access_revoked)
def _log_access_revoke(sender, lease, reason, **kwargs):
    logger.info(
        'lease_access_revoked lease=%s berth=%s member=%s reason=%s',
        lease.pk, lease.berth_id, lease.member_id, reason,
    )


@receiver(lease_status_changed)
def _log_status_change(sender, lease, old_status, new_status, **kwargs):
    logger.debug(
        'lease_status_changed lease=%s %s → %s',
        lease.pk, old_status, new_status,
    )
