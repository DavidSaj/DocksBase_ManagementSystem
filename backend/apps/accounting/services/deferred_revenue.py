"""
apps/accounting/services/deferred_revenue.py

Deferred revenue lifecycle helpers.
"""

from decimal import Decimal

from django.db import transaction
from django.utils.timezone import now


def adjust_deferred_entry(entry, refunded_amount: Decimal) -> None:
    """
    Reduce a DeferredRevenueEntry by refunded_amount.
    Updates earned_amount, deferred_amount, and cancels the entry if fully consumed.
    Also posts the corresponding GL credit note entry.

    This function is idempotent with respect to the final state: calling it twice
    for the same refund would double-count; callers must ensure single invocation
    (guard at booking cancellation signal level).
    """
    from apps.accounting.services.gl_posting import post_deferred_refund_gl

    with transaction.atomic():
        entry.refunded_amount += refunded_amount
        entry.total_amount    -= refunded_amount
        entry.deferred_amount  = max(
            entry.total_amount - entry.earned_amount, Decimal('0.00')
        )
        if entry.deferred_amount <= 0:
            entry.is_fully_recognised = True
            entry.cancelled_at = now()
        entry.save(update_fields=[
            'refunded_amount',
            'total_amount',
            'deferred_amount',
            'is_fully_recognised',
            'cancelled_at',
        ])
        post_deferred_refund_gl(entry, refunded_amount)
