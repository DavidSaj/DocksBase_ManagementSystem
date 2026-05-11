"""
apps/access_control/services/card_lifecycle.py

Card lifecycle management: activation, deactivation, expiry sweep.

deactivate_expired_cards_for_marina() is called by the daily Celery task.
Each card is saved individually to trigger the post_save signal, which
dispatches the hardware revoke via transaction.on_commit().
"""

import logging
from datetime import date

from django.utils import timezone

logger = logging.getLogger(__name__)


def deactivate_expired_cards_for_marina(marina) -> int:
    """
    Find all active cards whose valid_to date has passed and deactivate them.
    Each card is saved individually so the post_save signal fires per card,
    which schedules the hardware revoke via transaction.on_commit().

    Returns the number of cards deactivated.
    """
    from apps.access_control.models import AccessCard
    from apps.access_control.tasks import revoke_access_on_card_deactivate

    today = date.today()
    expired_cards = AccessCard.objects.filter(
        marina=marina,
        is_active=True,
        valid_to__lt=today,
    )

    count = 0
    for card in expired_cards:
        card.is_active           = False
        card.deactivated_at      = timezone.now()
        card.deactivation_reason = 'Expired (valid_to date passed)'
        card.save(update_fields=['is_active', 'deactivated_at', 'deactivation_reason'])
        # Signal will also dispatch this, but be explicit for clarity when
        # calling the service directly (e.g. from management commands).
        revoke_access_on_card_deactivate(card_id=card.pk)
        count += 1
        logger.info("AccessCard %s deactivated (expired valid_to=%s)", card.pk, card.valid_to)

    return count


def activate_card(card, granted_by=None) -> bool:
    """
    Activate a card and dispatch HAL grant_access calls for all zones
    the card's member is entitled to.

    Returns True on success.
    """
    from apps.access_control.models import AccessReader
    from apps.access_control.hal.factory import get_rfid_adapter
    from apps.access_control.hal.base import CardCredential
    from django.db import transaction

    card.is_active = True
    card.save(update_fields=['is_active'])

    adapter    = get_rfid_adapter(card.marina)
    credential = CardCredential(card_uid=card.card_uid, facility_code=card.facility_code, member_id=card.member_id)

    readers = AccessReader.objects.filter(marina=card.marina, is_active=True)
    for reader in readers:
        def _grant(r_uid=reader.reader_uid, cred=credential):
            adapter.grant_access(r_uid, cred)

        transaction.on_commit(_grant)

    logger.info("AccessCard %s activated for member %s", card.pk, card.member_id)
    return True


def deactivate_card(card, reason: str = '') -> bool:
    """
    Deactivate a card immediately. The post_save signal dispatches hardware revoke.
    """
    card.is_active           = False
    card.deactivated_at      = timezone.now()
    card.deactivation_reason = reason or 'Manually deactivated'
    card.save(update_fields=['is_active', 'deactivated_at', 'deactivation_reason'])
    logger.info("AccessCard %s deactivated reason=%r", card.pk, reason)
    return True
