"""
apps/accounting/signals.py

GL posting signals for billing events.

All Celery task dispatches use transaction.on_commit() to ensure the task
is only enqueued after the database transaction has been committed
(prevents tasks running against uncommitted data).
"""

from django.db import transaction
from django.dispatch import receiver
from django.db.models.signals import post_save


@receiver(post_save, sender='billing.Invoice')
def post_invoice_to_gl(sender, instance, created, **kwargs):
    """
    When an Invoice transitions to 'unpaid' status:
      1. Post the invoice to the GL (via transaction.on_commit).
      2. Dispatch credit_auto_deduct Celery task.
    """
    if instance.status == 'unpaid':
        from apps.accounting.services.gl_posting import post_invoice_gl
        transaction.on_commit(lambda: post_invoice_gl(instance))

        # Dispatch credit auto-deduct task
        from apps.accounting.tasks import credit_auto_deduct
        transaction.on_commit(lambda: credit_auto_deduct.delay(instance.pk))


@receiver(post_save, sender='billing.Payment')
def post_payment_to_gl(sender, instance, created, **kwargs):
    """
    When a new Payment is created, post the corresponding GL entry.
    Only fires on creation (not updates).
    """
    if not created:
        return
    from apps.accounting.services.gl_posting import post_payment_gl
    transaction.on_commit(lambda: post_payment_gl(instance))


@receiver(post_save, sender='reservations.Booking')
def handle_booking_cancellation(sender, instance, **kwargs):
    """
    When a Booking is cancelled, adjust any associated DeferredRevenueEntry
    records (write-off remaining deferred amount).
    """
    if instance.status == 'cancelled':
        from apps.accounting.models import DeferredRevenueEntry
        from apps.accounting.services.deferred_revenue import adjust_deferred_entry

        entries = DeferredRevenueEntry.objects.filter(
            invoice__booking=instance,
            is_fully_recognised=False,
            cancelled_at__isnull=True,
        )
        for entry in entries:
            # Refund the full remaining deferred (unrecognised) portion
            transaction.on_commit(
                lambda e=entry: adjust_deferred_entry(e, e.deferred_amount)
            )
