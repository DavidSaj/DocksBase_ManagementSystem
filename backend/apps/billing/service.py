import datetime
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction
from django.utils import timezone

from .models import Invoice, InvoiceLineItem, Payment
from .signals import invoice_paid


def create_invoice(marina, member=None, source_type='', source_id='', due_date=None):
    year = datetime.date.today().year
    with transaction.atomic():
        last = (
            Invoice.objects.select_for_update()
            .filter(invoice_number__startswith=f'INV-{year}-')
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
            vat_rate=marina.vat_rate,
            due_date=due_date,
        )


def add_line_item(invoice, description, quantity, unit_price):
    if invoice.status != 'draft':
        raise ValueError(f'Cannot add line items to a {invoice.status} invoice.')
    q = Decimal(str(quantity))
    p = Decimal(str(unit_price))
    total_price = (q * p).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    return InvoiceLineItem.objects.create(
        invoice=invoice,
        description=description,
        quantity=q,
        unit_price=p,
        total_price=total_price,
    )


def finalize_invoice(invoice):
    if invoice.status != 'draft':
        raise ValueError(f'Cannot finalize a {invoice.status} invoice.')
    subtotal = sum(item.total_price for item in invoice.items.all())
    tax_total = (subtotal * invoice.vat_rate / 100).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    invoice.subtotal = subtotal
    invoice.tax_total = tax_total
    invoice.total = (subtotal + tax_total).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    invoice.status = 'open'
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
    from .stripe_service import _create_checkout_session
    return _create_checkout_session(invoice)
