"""
Billing services for activity bookings.

All money flows through billing.ChargeableItem -> billing.InvoiceLineItem.
No raw prices are stored on Activity or ActivityBooking models.
"""
import logging
from collections import Counter
from decimal import Decimal

from django.db import transaction

from apps.activities.models import ActivityBooking, ActivityPricingRule
from apps.billing.models import Invoice, InvoiceLineItem

logger = logging.getLogger('apps.activities')


def create_activity_invoice(booking):
    """
    Create a draft Invoice + InvoiceLineItem rows from ActivityPricingRule.chargeable_item
    references. Must be called inside transaction.atomic() — partial creation is invalid state.

    Applies group discount as a negative InvoiceLineItem when participant_count >= threshold.
    Extras are billed per their linked ChargeableItem unit price.
    """
    from apps.billing.service import create_invoice, add_line_item_from_catalog

    activity = booking.activity
    participants = booking.participants.all()

    type_counts = Counter(p.customer_type for p in participants)
    # If no participants recorded, treat booking itself as a single guest entry
    if not type_counts:
        type_counts = Counter({'guest': booking.participant_count})

    invoice = create_invoice(
        marina=booking.marina,
        member=booking.member,
        source_type='activity_booking',
        source_id=str(booking.pk),
    )

    for customer_type, count in type_counts.items():
        try:
            rule = activity.pricing_rules.get(customer_type=customer_type)
        except ActivityPricingRule.DoesNotExist:
            # Fall back to guest pricing if no specific rule exists
            try:
                rule = activity.pricing_rules.get(customer_type='guest')
            except ActivityPricingRule.DoesNotExist:
                continue
        add_line_item_from_catalog(invoice, rule.chargeable_item, quantity=count)

    # Group discount: negative InvoiceLineItem when participant_count >= threshold
    if (activity.group_discount_threshold and
            booking.participant_count >= activity.group_discount_threshold and
            activity.group_discount_pct):
        subtotal = sum(
            (item.total_price for item in invoice.items.all()),
            Decimal('0.00')
        )
        discount_amount = -(subtotal * activity.group_discount_pct / 100).quantize(Decimal('0.01'))
        InvoiceLineItem.objects.create(
            invoice=invoice,
            description=f'Group Discount ({activity.group_discount_pct}%)',
            quantity=1,
            unit_price=discount_amount,
            total_price=discount_amount,
        )

    # Extras
    for booking_extra in booking.booking_extras.select_related('extra__chargeable_item').all():
        add_line_item_from_catalog(
            invoice,
            booking_extra.extra.chargeable_item,
            quantity=booking_extra.quantity,
        )

    return invoice


def recalculate_activity_invoice(booking):
    """
    Wipe and fully recompute all InvoiceLineItem rows for a booking.
    Called whenever the participant list changes (participant added or removed).

    Blocks recalculation if invoice is already sent or paid — immutable invoices
    must not be mutated. Fires an in-app alert to staff instead.

    Must be called inside transaction.atomic() (the signals that call this are
    wrapped individually, but callers should also wrap if calling directly).
    """
    from apps.billing.service import add_line_item_from_catalog

    if not booking.invoice_id:
        return

    invoice = Invoice.objects.select_for_update().get(pk=booking.invoice_id)

    if invoice.status in ('sent', 'paid', 'unpaid', 'open'):
        _alert_immutable_invoice(booking, invoice)
        return

    with transaction.atomic():
        invoice.items.all().delete()

        participants = booking.participants.all()
        type_counts  = Counter(p.customer_type for p in participants)
        if not type_counts:
            type_counts = Counter({'guest': booking.participant_count})
        activity = booking.activity

        for customer_type, count in type_counts.items():
            try:
                rule = activity.pricing_rules.get(customer_type=customer_type)
            except ActivityPricingRule.DoesNotExist:
                try:
                    rule = activity.pricing_rules.get(customer_type='guest')
                except ActivityPricingRule.DoesNotExist:
                    continue
            add_line_item_from_catalog(invoice, rule.chargeable_item, quantity=count)

        if (activity.group_discount_threshold and
                booking.participant_count >= activity.group_discount_threshold and
                activity.group_discount_pct):
            subtotal = sum(
                (item.total_price for item in invoice.items.all()),
                Decimal('0.00')
            )
            discount_amount = -(subtotal * activity.group_discount_pct / 100).quantize(
                Decimal('0.01'))
            InvoiceLineItem.objects.create(
                invoice=invoice,
                description=f'Group Discount ({activity.group_discount_pct}%)',
                quantity=1,
                unit_price=discount_amount,
                total_price=discount_amount,
            )

        recalculate_invoice_totals(invoice)


def recalculate_invoice_totals(invoice):
    """Recompute subtotal / tax_total / total from current line items."""
    from decimal import ROUND_HALF_UP
    items = list(invoice.items.all())
    subtotal  = sum((i.total_price for i in items), Decimal('0.00'))
    tax_total = sum((i.line_tax    for i in items), Decimal('0.00'))
    invoice.subtotal  = subtotal.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    invoice.tax_total = tax_total.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    invoice.total     = (subtotal + tax_total).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    invoice.save(update_fields=['subtotal', 'tax_total', 'total'])


def _alert_immutable_invoice(booking, invoice):
    """Log a warning for staff — the invoice cannot be recalculated automatically."""
    logger.warning(
        'Participant count changed on ActivityBooking #%s after invoice #%s was issued '
        '(status: %s). Manual review required.',
        booking.pk, invoice.invoice_number, invoice.status,
    )
    try:
        from apps.communications.services.alert import send_alert
        send_alert(
            marina_id=booking.marina_id,
            alert_type='stock_low',  # closest available type; add 'invoice_discrepancy' later
            subject='Activity Invoice Manual Review Required',
            body=(
                f'Participant count changed on ActivityBooking #{booking.pk} after '
                f'Invoice {invoice.invoice_number} ({invoice.status}) was issued. '
                f'Manual review required.'
            ),
        )
    except Exception:
        pass


def compute_cancellation_refund(booking):
    """
    Applies CancellationPolicy tiers based on hours until activity start.
    Returns the refund amount (Decimal). Returns 0.00 if no policy or no invoice.

    Tiers:
      hours >= full_refund_hours  -> 100% refund
      hours >= partial_refund_hours -> partial_refund_pct% refund
      else                          -> no refund
    """
    from django.utils import timezone

    if not booking.activity.cancellation_policy or not booking.invoice_id:
        return Decimal('0.00')

    policy = booking.activity.cancellation_policy
    hours_until_start = (booking.start_datetime - timezone.now()).total_seconds() / 3600
    invoice_total = booking.invoice.total

    if hours_until_start >= policy.full_refund_hours:
        return invoice_total
    elif hours_until_start >= policy.partial_refund_hours:
        return (invoice_total * policy.partial_refund_pct / 100).quantize(Decimal('0.01'))
    else:
        return Decimal('0.00')
