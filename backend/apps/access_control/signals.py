"""
apps/access_control/signals.py

AccessCard post_save → hardware revoke dispatched inside transaction.on_commit().
This guarantees the hardware call fires ONLY after the DB write commits —
never during a rolled-back transaction.
"""

import logging

from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)


@receiver(post_save, sender='access_control.AccessCard')
def on_access_card_saved(sender, instance, created, **kwargs):
    """
    When a card transitions to is_active=False (with deactivated_at set),
    dispatch a hardware revoke task inside on_commit.

    Uses deactivated_at as the is_active=False signal (set together in all
    deactivation paths) so we don't fire revoke on cards that were always inactive.
    """
    if not instance.is_active and instance.deactivated_at:
        card_id = instance.pk

        def _dispatch_revoke():
            from apps.access_control.tasks import revoke_access_on_card_deactivate
            try:
                revoke_access_on_card_deactivate(card_id=card_id)
            except Exception:
                logger.exception("Hardware revoke failed for card_id=%s", card_id)

        transaction.on_commit(_dispatch_revoke)
        logger.debug("Queued hardware revoke for card_id=%s (fires on_commit)", card_id)
