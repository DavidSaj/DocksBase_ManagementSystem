"""Generic CSV export — one row per InvoiceLineItem."""

from decimal import Decimal

from django.utils import timezone

from apps.accounting.models import ExportJob

from . import _common


HEADER = [
    'date', 'invoice_number', 'customer', 'category', 'gl_code',
    'subtotal', 'tax', 'total', 'payment_method', 'payout_id',
]


def _rows(job: ExportJob):
    invoices = list(_common.filter_invoices(job))
    for invoice in invoices:
        sign = _common.sign_for(invoice)
        payment_method = _common.payment_method_for(invoice)
        payout_id = _common.payout_id_for(invoice)
        date_str = invoice.created_at.date().isoformat() if invoice.created_at else ''
        cust = _common.customer_name(invoice)
        for line in invoice.items.all().order_by('id'):
            category = _common.category_of(line)
            gl_code, _gl_name = _common.gl_mapping_for(job.marina, category)
            subtotal = (line.total_price or Decimal('0.00')) * sign
            tax = line.line_tax * sign
            total = subtotal + tax
            yield (
                [
                    date_str,
                    invoice.invoice_number,
                    cust,
                    category,
                    gl_code,
                    _common.quantise(subtotal),
                    _common.quantise(tax),
                    _common.quantise(total),
                    payment_method,
                    payout_id,
                ],
                subtotal, tax, total,
            )


def generate(job: ExportJob) -> None:
    job.status = ExportJob.Status.RUNNING
    job.started_at = timezone.now()
    job.save(update_fields=['status', 'started_at'])
    try:
        _common.write_csv_to_job(job, HEADER, _rows(job))
        _common.mark_complete(job)
    except Exception as exc:  # pragma: no cover - defensive
        _common.mark_failed(job, exc)
        raise
