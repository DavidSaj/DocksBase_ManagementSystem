import datetime
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.utils import timezone

from .models import Invoice, InvoiceLineItem, Payment
from .signals import invoice_paid


def create_invoice(marina, member=None, source_type='', source_id='', due_date=None, billing_period=''):
    year = datetime.date.today().year
    with transaction.atomic():
        last = (
            Invoice.objects.select_for_update()
            .filter(marina=marina, invoice_number__startswith=f'INV-{year}-')
            .order_by('-invoice_number')
            .first()
        )
        seq = (int(last.invoice_number.split('-')[2]) + 1) if last else 1
        return Invoice.objects.create(
            marina=marina,
            member=member,
            invoice_number=f'INV-{year}-{seq:04d}',
            status='draft',
            source_type=source_type,
            source_id=str(source_id) if source_id else '',
            vat_rate=None,
            due_date=due_date,
            billing_period=billing_period,
        )


def add_line_item(invoice, description, quantity, unit_price, tax_rate=None, chargeable_item=None):
    if invoice.status != 'draft':
        raise ValueError(f'Cannot add line items to a {invoice.status} invoice.')
    q = Decimal(str(quantity))
    p = Decimal(str(unit_price))
    r = Decimal(str(tax_rate)) if tax_rate is not None else Decimal('0.00')
    total_price = (q * p).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    return InvoiceLineItem.objects.create(
        invoice=invoice,
        description=description,
        quantity=q,
        unit_price=p,
        total_price=total_price,
        tax_rate=r,
        chargeable_item=chargeable_item,
    )


def add_line_item_from_catalog(invoice, chargeable_item, quantity):
    """Snapshot price and tax from ChargeableItem at the moment of invoicing."""
    return add_line_item(
        invoice=invoice,
        description=chargeable_item.name,
        quantity=quantity,
        unit_price=chargeable_item.unit_price,
        tax_rate=chargeable_item.tax_rate,
        chargeable_item=chargeable_item,
    )


def calculate_booking_invoice(booking):
    """
    Find the best-match ChargeableItem for a booking and create a draft invoice.
    Returns the invoice or None if no suitable item is found.
    Never raises — caller wraps in try/except.
    """
    from .models import ChargeableItem
    from decimal import Decimal as D

    item = ChargeableItem.objects.filter(
        marina=booking.marina,
        category='berth',
        is_active=True,
    ).order_by('created_at').first()

    if not item:
        return None

    nights = (booking.check_out - booking.check_in).days
    if nights <= 0:
        return None

    loa = booking.boat_loa
    if loa is None and booking.vessel_id:
        loa = booking.vessel.loa

    if item.pricing_model == 'per_meter_per_night':
        if not loa:
            return None
        quantity = D(str(loa)) * D(str(nights))
        description = f'Berth — {loa}m × {nights} nights'
    elif item.pricing_model == 'per_night':
        quantity = D(str(nights))
        description = f'Berth — {nights} nights'
    else:
        quantity = D('1')
        description = 'Berth fee'

    # Resolve member
    member = None
    if getattr(booking, 'member', None):
        member = booking.member
    elif booking.vessel_id and hasattr(booking.vessel, 'owner') and booking.vessel.owner_id:
        try:
            from apps.members.models import Member
            member = Member.objects.filter(pk=booking.vessel.owner_id).first()
        except Exception:
            pass

    invoice = create_invoice(
        marina=booking.marina,
        member=member,
        source_type='booking',
        source_id=str(booking.pk),
    )
    add_line_item(
        invoice=invoice,
        description=description,
        quantity=quantity,
        unit_price=item.unit_price,
        tax_rate=item.tax_rate,
        chargeable_item=item,
    )
    return invoice


def finalize_invoice(invoice):
    if invoice.status != 'draft':
        raise ValueError(f'Cannot finalize a {invoice.status} invoice.')
    items = list(invoice.items.all())
    subtotal  = sum((i.total_price for i in items), Decimal('0.00'))
    tax_total = sum((i.line_tax    for i in items), Decimal('0.00'))
    invoice.subtotal  = subtotal.quantize(Decimal('0.01'),  rounding=ROUND_HALF_UP)
    invoice.tax_total = tax_total.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    invoice.total     = (subtotal + tax_total).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    invoice.status    = 'open'
    invoice.save(update_fields=['subtotal', 'tax_total', 'total', 'status'])
    return invoice


def mark_paid_manual(invoice, method, recorded_by=None):
    if invoice.status != 'open':
        raise ValueError(f'Cannot mark a {invoice.status} invoice as paid.')
    if method not in ('cash', 'external_card'):
        raise ValueError(f"Invalid payment method '{method}'. Use 'cash' or 'external_card'.")
    with transaction.atomic():
        Payment.objects.create(invoice=invoice, method=method, amount=invoice.total, recorded_by=recorded_by)
        invoice.status = 'paid'
        invoice.paid_at = timezone.now()
        invoice.save(update_fields=['status', 'paid_at'])
        invoice_paid.send(sender=Invoice, invoice=invoice)
    return invoice


def void_invoice(invoice):
    if invoice.status not in ('draft', 'open'):
        raise ValueError(f'Cannot void a {invoice.status} invoice.')
    invoice.status = 'void'
    invoice.save(update_fields=['status'])
    return invoice


def create_stripe_checkout_session(invoice):
    if invoice.status != 'open':
        raise ValueError(f'Cannot create Stripe session for a {invoice.status} invoice.')
    if not invoice.marina.stripe_account_id:
        raise ValueError('This marina has not connected a payment account yet.')
    from .stripe_service import _create_checkout_session
    return _create_checkout_session(invoice)


def create_payment_intent(marina, amount_cents, currency, metadata=None):
    """Creates a Stripe PaymentIntent on the marina's Connect account. Returns client_secret."""
    from .stripe_service import create_payment_intent as _create_payment_intent
    return _create_payment_intent(marina, amount_cents, currency, metadata)
