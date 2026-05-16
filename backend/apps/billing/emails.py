"""
Billing-related email helpers.

These are pure render-and-send functions. The decision of *whether* to send
(rule-gating) lives in apps/billing/receivers.py so signal handlers can short-
circuit before doing any work.
"""

import logging

from django.conf import settings
from django.core.mail import send_mail

logger = logging.getLogger(__name__)


def _invoice_recipient(invoice):
    """
    Resolve (email, display_name) for an invoice. Prefers member, then tenant.
    Returns (None, None) if neither has an email — caller should skip.
    """
    if invoice.member and invoice.member.email:
        return invoice.member.email, invoice.member.name
    if invoice.tenant and invoice.tenant.email:
        name = invoice.tenant.contact_name or invoice.tenant.display_name
        return invoice.tenant.email, name
    return None, None


def _amount_str(invoice):
    currency = getattr(invoice.marina, 'currency', 'EUR') or 'EUR'
    symbol = {'EUR': '€', 'GBP': '£', 'USD': '$', 'CHF': 'CHF '}.get(currency, currency + ' ')
    return f'{symbol}{invoice.total:.2f}'


def send_invoice_issued_email(invoice):
    """Fired when an invoice is newly created with status in {open, unpaid}."""
    to_email, name = _invoice_recipient(invoice)
    if not to_email:
        logger.info('invoice_issued: invoice %s has no recipient email, skipping', invoice.pk)
        return

    marina = invoice.marina
    due = invoice.due_date.strftime('%d %B %Y') if invoice.due_date else 'on receipt'
    amount = _amount_str(invoice)
    greeting = name.split()[0] if name else 'there'

    body = (
        f"Hi {greeting},\n\n"
        f"A new invoice has been issued for your account at {marina.name}.\n\n"
        f"Invoice: {invoice.invoice_number}\n"
        f"Amount due: {amount}\n"
        f"Due date: {due}\n\n"
        f"You can view and pay the invoice from your account.\n\n"
        f"Thanks,\n"
        f"— {marina.name}"
    )

    try:
        send_mail(
            subject=f"Invoice {invoice.invoice_number} — {marina.name}",
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[to_email],
            fail_silently=False,
        )
        logger.info('invoice_issued: emailed invoice %s to %s', invoice.invoice_number, to_email)
    except Exception as exc:
        logger.exception('invoice_issued: send failed for invoice %s: %s', invoice.pk, exc)


def send_payment_received_email(invoice):
    """Fired by the invoice_paid signal — receipt to the payer."""
    to_email, name = _invoice_recipient(invoice)
    if not to_email:
        logger.info('payment_received: invoice %s has no recipient email, skipping', invoice.pk)
        return

    marina = invoice.marina
    amount = _amount_str(invoice)
    greeting = name.split()[0] if name else 'there'
    paid_at = invoice.paid_at.strftime('%d %B %Y') if invoice.paid_at else 'today'

    body = (
        f"Hi {greeting},\n\n"
        f"Thanks — we've received your payment of {amount} for invoice "
        f"{invoice.invoice_number} at {marina.name}.\n\n"
        f"Invoice: {invoice.invoice_number}\n"
        f"Amount paid: {amount}\n"
        f"Date received: {paid_at}\n\n"
        f"This email is your receipt. No further action is required.\n\n"
        f"— {marina.name}"
    )

    try:
        send_mail(
            subject=f"Payment received — {invoice.invoice_number}",
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=[to_email],
            fail_silently=False,
        )
        logger.info('payment_received: emailed receipt for invoice %s to %s', invoice.invoice_number, to_email)
    except Exception as exc:
        logger.exception('payment_received: send failed for invoice %s: %s', invoice.pk, exc)
