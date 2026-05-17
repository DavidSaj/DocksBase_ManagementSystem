"""
Signal receivers that translate billing events into notification dispatches.

Rule-gating happens here so the email helpers stay dumb / reusable.
"""

import logging

from django.db.models.signals import post_save
from django.dispatch import receiver
from django.db import transaction

from apps.accounts.notifications import rule_enabled
from .emails import send_invoice_issued_email, send_payment_received_email
from .models import Invoice
from .signals import invoice_paid

logger = logging.getLogger(__name__)


@receiver(post_save, sender=Invoice, dispatch_uid='billing.notify_invoice_issued')
def on_invoice_created(sender, instance, created, **kwargs):
    """
    Newly-created invoices in an issued state (open/unpaid) trigger the
    ``payment_invoice_issued`` notification. Draft creations are silent —
    they fire again on the transition to open/unpaid (handled by a later
    save with ``created=False``, intentionally not covered to avoid emailing
    the customer every time staff edits a line item).
    """
    if not created:
        return
    if instance.status not in ('open', 'unpaid'):
        return
    if not rule_enabled(instance.marina, 'payment_invoice_issued', 'email'):
        return
    transaction.on_commit(lambda: send_invoice_issued_email(instance))


def on_invoice_paid_notify(sender, invoice, **kwargs):
    """Receiver for the ``invoice_paid`` custom signal in apps/billing/signals.py."""
    # Allow the caller (e.g. offline-payment flow) to suppress receipt email.
    if kwargs.get('send_receipt', True) is False:
        return
    if not rule_enabled(invoice.marina, 'payment_received', 'email'):
        return
    transaction.on_commit(lambda: send_payment_received_email(invoice))


invoice_paid.connect(on_invoice_paid_notify, dispatch_uid='billing.notify_payment_received')
