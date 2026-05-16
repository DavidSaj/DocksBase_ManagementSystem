"""Helpers shared between the CSV export generators."""

from __future__ import annotations

import csv
import io
from decimal import Decimal, ROUND_HALF_UP
from typing import Iterable

from django.core.files.base import ContentFile
from django.utils import timezone

from apps.accounting.models import ExportJob, GLCodeMapping, Payout
from apps.billing.models import Invoice, InvoiceLineItem


Q01 = Decimal('0.01')


def quantise(value) -> Decimal:
    return Decimal(value).quantize(Q01, rounding=ROUND_HALF_UP)


def filter_invoices(job: ExportJob):
    """Return the queryset of invoices that fall inside the job's date range."""
    qs = (
        Invoice.objects
        .filter(marina=job.marina, created_at__date__gte=job.start_date,
                created_at__date__lte=job.end_date)
        .exclude(status='draft')
        .select_related('member', 'booking', 'tenant')
        .prefetch_related('items', 'items__chargeable_item',
                          'items__chargeable_item__tax_category',
                          'payments')
        .order_by('created_at', 'invoice_number', 'id')
    )
    if job.category_filter:
        qs = qs.filter(items__chargeable_item__category__in=job.category_filter).distinct()
    return qs


def gl_mapping_for(marina, category: str) -> tuple[str, str]:
    """Return (external_gl_code, external_gl_name) for the marina + category."""
    if not category:
        return ('UNMAPPED', '')
    mapping = GLCodeMapping.objects.filter(
        marina=marina, chargeable_category=category
    ).first()
    if not mapping or not mapping.external_gl_code:
        return ('UNMAPPED', mapping.external_gl_name if mapping else '')
    return (mapping.external_gl_code, mapping.external_gl_name)


def category_of(line: InvoiceLineItem) -> str:
    if line.chargeable_item_id and line.chargeable_item:
        return line.chargeable_item.category or 'service'
    return 'service'


def customer_name(invoice: Invoice) -> str:
    if invoice.member_id and invoice.member:
        return invoice.member.name
    if invoice.tenant_id and getattr(invoice, 'tenant', None):
        return getattr(invoice.tenant, 'name', '')
    if invoice.booking_id and getattr(invoice, 'booking', None):
        return getattr(invoice.booking, 'guest_name', '') or ''
    return ''


def customer_id(invoice: Invoice) -> str:
    if invoice.member_id:
        return f'M{invoice.member_id}'
    if invoice.tenant_id:
        return f'T{invoice.tenant_id}'
    if invoice.booking_id:
        return f'B{invoice.booking_id}'
    return ''


def payment_method_for(invoice: Invoice) -> str:
    """Return a stable 'how this invoice got paid' label."""
    if invoice.stripe_payment_intent_id:
        return 'stripe'
    payment = next(iter(invoice.payments.all()), None)
    if payment:
        return payment.method
    return ''


def payment_date_for(invoice: Invoice) -> str:
    if invoice.paid_at:
        return invoice.paid_at.date().isoformat()
    return ''


def payout_id_for(invoice: Invoice) -> str:
    """Best-effort lookup: a PayoutLine pointing at this invoice."""
    line = invoice.payout_lines.all().first() if hasattr(invoice, 'payout_lines') else None
    if line and line.payout_id:
        return line.payout.stripe_payout_id
    return ''


def sign_for(invoice: Invoice) -> int:
    """Credit notes export as negatives."""
    return -1 if invoice.invoice_type == 'credit_note' else 1


def write_csv_to_job(job: ExportJob, header: list, rows: Iterable[list]) -> tuple[int, Decimal, Decimal, Decimal]:
    """Stream rows into a CSV, attach to job.file, return aggregate totals."""
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator='\n')
    writer.writerow(header)

    row_count = 0
    total_gross = Decimal('0.00')
    total_tax = Decimal('0.00')
    total_net = Decimal('0.00')

    # Per generator: row_iter yields (csv_row_list, subtotal, tax, total) tuples.
    for record in rows:
        if isinstance(record, tuple) and len(record) == 4:
            csv_row, subtotal, tax, total = record
            total_net += Decimal(subtotal or 0)
            total_tax += Decimal(tax or 0)
            total_gross += Decimal(total or 0)
        else:
            csv_row = record
        writer.writerow(csv_row)
        row_count += 1

    job.file.save(f'export-{job.pk}-{job.format}.csv', ContentFile(buf.getvalue().encode('utf-8')))
    job.row_count = row_count
    job.total_gross = quantise(total_gross)
    job.total_tax = quantise(total_tax)
    job.total_net = quantise(total_net)
    return row_count, total_gross, total_tax, total_net


def mark_complete(job: ExportJob) -> None:
    job.status = ExportJob.Status.COMPLETED
    job.completed_at = timezone.now()
    job.save()


def mark_failed(job: ExportJob, exc: Exception) -> None:
    job.status = ExportJob.Status.FAILED
    job.completed_at = timezone.now()
    job.error_detail = f'{type(exc).__name__}: {exc}'
    job.save()
