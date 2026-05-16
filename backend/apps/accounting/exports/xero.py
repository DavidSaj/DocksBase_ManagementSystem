"""Xero sales-invoice CSV export."""

from decimal import Decimal

from django.utils import timezone

from apps.accounting.models import ExportJob, TaxCode

from . import _common


HEADER = [
    'ContactName', 'EmailAddress',
    'InvoiceNumber', 'Reference', 'InvoiceDate', 'DueDate',
    'Description', 'Quantity', 'UnitAmount', 'AccountCode', 'TaxType',
    'Currency',
]


def _xero_tax_type(marina, line) -> str:
    if not line.chargeable_item_id or not line.chargeable_item:
        return ''
    tr = getattr(line.chargeable_item, 'tax_category', None)
    if not tr:
        return ''
    code = TaxCode.objects.filter(marina=marina, tax_rate=tr).first()
    return code.external_xero_code if code else ''


def _contact_email(invoice) -> str:
    if invoice.member_id and invoice.member and invoice.member.email:
        return invoice.member.email
    if invoice.booking_id and getattr(invoice, 'booking', None):
        return getattr(invoice.booking, 'guest_email', '') or ''
    return ''


def _rows(job: ExportJob):
    invoices = list(_common.filter_invoices(job))
    for invoice in invoices:
        sign = _common.sign_for(invoice)
        date_str = invoice.created_at.date().isoformat() if invoice.created_at else ''
        due_str = invoice.due_date.isoformat() if invoice.due_date else ''
        customer = _common.customer_name(invoice)
        email = _contact_email(invoice)
        currency = 'EUR'
        for line in invoice.items.all().order_by('id'):
            category = _common.category_of(line)
            gl_code, _gl_name = _common.gl_mapping_for(job.marina, category)
            qty = (line.quantity or Decimal('1')) * sign
            unit_amount = line.unit_price or Decimal('0.00')
            amount = (line.total_price or Decimal('0.00')) * sign
            tax_amount = line.line_tax * sign
            yield (
                [
                    customer,
                    email,
                    invoice.invoice_number,
                    invoice.source_type or '',
                    date_str,
                    due_str,
                    line.description,
                    _common.quantise(qty),
                    _common.quantise(unit_amount),
                    gl_code,
                    _xero_tax_type(job.marina, line),
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
