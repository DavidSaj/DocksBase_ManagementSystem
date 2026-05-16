"""QuickBooks Online sales-invoice CSV export."""

from decimal import Decimal

from django.utils import timezone

from apps.accounting.models import ExportJob, TaxCode

from . import _common


HEADER = [
    'InvoiceNo', 'Customer', 'InvoiceDate', 'DueDate', 'Terms',
    'Location', 'Memo',
    'Item(Product/Service)', 'ItemDescription', 'ItemQuantity', 'ItemRate', 'ItemAmount',
    'ItemTaxCode', 'ItemTaxAmount',
    'Currency',
]


def _qbo_tax_code(marina, line) -> str:
    """Look up TaxCode.external_qbo_code for the line's billing.TaxRate, if any."""
    if not line.chargeable_item_id or not line.chargeable_item:
        return ''
    tr = getattr(line.chargeable_item, 'tax_category', None)
    if not tr:
        return ''
    code = TaxCode.objects.filter(marina=marina, tax_rate=tr).first()
    return code.external_qbo_code if code else ''


def _rows(job: ExportJob):
    invoices = list(_common.filter_invoices(job))
    for invoice in invoices:
        sign = _common.sign_for(invoice)
        date_str = invoice.created_at.date().isoformat() if invoice.created_at else ''
        due_str = invoice.due_date.isoformat() if invoice.due_date else ''
        customer = _common.customer_name(invoice)
        currency = 'EUR'  # marina base; multi-currency out of scope per spec §3
        for line in invoice.items.all().order_by('id'):
            category = _common.category_of(line)
            _gl_code, gl_name = _common.gl_mapping_for(job.marina, category)
            qty = (line.quantity or Decimal('1')) * sign
            rate = line.unit_price or Decimal('0.00')
            amount = (line.total_price or Decimal('0.00')) * sign
            tax_amount = line.line_tax * sign
            yield (
                [
                    invoice.invoice_number,
                    customer,
                    date_str,
                    due_str,
                    '',                  # Terms
                    '',                  # Location
                    invoice.source_type or '',  # Memo
                    gl_name or category,
                    line.description,
                    _common.quantise(qty),
                    _common.quantise(rate),
                    _common.quantise(amount),
                    _qbo_tax_code(job.marina, line),
                    _common.quantise(tax_amount),
                    currency,
                ],
                amount, tax_amount, amount + tax_amount,
            )


def generate(job: ExportJob) -> None:
    job.status = ExportJob.Status.RUNNING
    job.started_at = timezone.now()
    job.save(update_fields=['status', 'started_at'])
    try:
        _common.write_csv_to_job(job, HEADER, _rows(job))
        _common.mark_complete(job)
    except Exception as exc:  # pragma: no cover
        _common.mark_failed(job, exc)
        raise
