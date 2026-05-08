"""
apps/sustainability/signals.py

Staleness signals: post_save/post_delete on Scope1/2/3 and WasteLog models
→ _flag_ledger_stale_and_queue() via transaction.on_commit().

Invoice paid signal: create OffsetContribution for offset line items.

Redis deduplication (cache.add) prevents duplicate recalculation tasks within 60 seconds.
"""

import logging

from django.db import transaction
from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)


def _flag_ledger_stale_and_queue(marina_id: int, period: str):
    """
    Mark the SustainabilityLedger row stale and queue a recalculation task.
    Redis deduplication prevents duplicate tasks within a 60-second window.
    on_commit ensures the signal fires only after the triggering write commits.
    """
    def _do():
        from django.core.cache import cache
        from apps.sustainability.models import SustainabilityLedger
        from apps.sustainability.tasks import recalculate_ledger_period

        dedupe_key = f'ledger:recalc:{marina_id}:{period}'
        if not cache.add(dedupe_key, '1', timeout=60):
            logger.debug("Ledger recalc dedupe hit for marina=%s period=%s — skipping", marina_id, period)
            return  # duplicate dispatch within 60s window

        SustainabilityLedger.objects.filter(
            marina_id=marina_id, period=period,
        ).update(is_stale=True)

        # recalculate_ledger_period.apply_async(args=[marina_id, period], countdown=30)
        # Until Celery is wired, call directly (30s countdown is advisory)
        recalculate_ledger_period(marina_id=marina_id, period=period)
        logger.debug("Ledger recalc queued for marina=%s period=%s", marina_id, period)

    transaction.on_commit(_do)


# ---------------------------------------------------------------------------
# Scope 1 staleness
# ---------------------------------------------------------------------------

@receiver(post_save,   sender='sustainability.Scope1Record')
@receiver(post_delete, sender='sustainability.Scope1Record')
def scope1_changed(sender, instance, **kwargs):
    _flag_ledger_stale_and_queue(instance.marina_id, instance.date.strftime('%Y-%m'))


# ---------------------------------------------------------------------------
# Scope 2 staleness
# ---------------------------------------------------------------------------

@receiver(post_save,   sender='sustainability.Scope2Record')
@receiver(post_delete, sender='sustainability.Scope2Record')
def scope2_changed(sender, instance, **kwargs):
    _flag_ledger_stale_and_queue(instance.marina_id, instance.period)


# ---------------------------------------------------------------------------
# Scope 3 staleness
# ---------------------------------------------------------------------------

@receiver(post_save,   sender='sustainability.Scope3Record')
@receiver(post_delete, sender='sustainability.Scope3Record')
def scope3_changed(sender, instance, **kwargs):
    _flag_ledger_stale_and_queue(instance.marina_id, instance.period)


# ---------------------------------------------------------------------------
# WasteLog staleness
# ---------------------------------------------------------------------------

@receiver(post_save,   sender='sustainability.WasteLog')
@receiver(post_delete, sender='sustainability.WasteLog')
def waste_changed(sender, instance, **kwargs):
    _flag_ledger_stale_and_queue(instance.marina_id, instance.date.strftime('%Y-%m'))


# ---------------------------------------------------------------------------
# Invoice paid → OffsetContribution
# ---------------------------------------------------------------------------

@receiver(post_save, sender='billing.Invoice')
def on_invoice_paid_create_offset(sender, instance, **kwargs):
    """
    On invoice payment, create OffsetContribution for each offset line item.

    Guards:
    1. Invoice must have status='paid'.
    2. Line item chargeable_item.category must be 'offset'.
    3. line.unit_price must be > 0 (coupon/loyalty/manual zero guard).
    """
    if instance.status != 'paid':
        return

    for line in instance.items.filter(
        chargeable_item__category='offset'
    ).select_related('chargeable_item'):
        if line.unit_price <= 0:
            logger.warning(
                "Offset line item %s has unit_price=%s on paid Invoice %s — "
                "OffsetContribution NOT created. Investigate discount/coupon application.",
                line.pk, line.unit_price, instance.pk,
            )
            continue

        def _create(lid=line.pk):
            from apps.sustainability.tasks import create_offset_contribution
            create_offset_contribution(line_item_id=lid)

        transaction.on_commit(_create)
