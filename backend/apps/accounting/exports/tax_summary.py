"""Tax-summary CSV export grouped by jurisdiction × tax code."""

from collections import defaultdict
from decimal import Decimal

from django.utils import timezone

from apps.accounting.models import ExportJob, TaxCode

from . import _common


HEADER = [
    'country', 'state', 'county', 'city',
    'tax_code_name', 'reportable_category', 'rate',
    'taxable_sales', 'exempt_sales', 'tax_collected', 'invoice_count',
]


def _bucket_for(marina, line):
    """Return a (jurisdiction-key, code-meta) tuple for grouping."""
    tax_rate = None
    if line.chargeable_item_id and line.chargeable_item:
        tax_rate = getattr(line.chargeable_item, 'tax_category', None)
    code = (
        TaxCode.objects.filter(marina=marina, tax_rate=tax_rate).first()
        if tax_rate else None
    )
    if code:
        key = (code.jurisdiction_country, code.jurisdiction_state,
               code.jurisdiction_county, code.jurisdiction_city, code.id)
        meta = {
            'country': code.jurisdiction_country,
            'state': code.jurisdiction_state,
            'county': code.jurisdiction_county,
            'city': code.jurisdiction_city,
            'name': code.name,
            'reportable_category': code.reportable_category,
            'rate': code.rate,
        }
    else:
        rate = line.tax_rate or Decimal('0.00')
        name = f'Uncategorised — {rate}%'
        key = ('', '', '', '', f'uncat-{rate}')
        meta = {
            'country': '', 'state': '', 'county': '', 'city': '',
            'name': name, 'reportable_category': 'sales_tax', 'rate': rate,
        }
    return key, meta


def build_rows(job: ExportJob):
    """Pure function: yields rows for the tax summary, used by both the CSV and the API."""
    invoices = list(_common.filter_invoices(job))
    buckets = {}            # key -> meta + accumulators
    invoice_ids = defaultdict(set)

    for invoice in invoices:
        sign = _common.sign_for(invoice)
        for line in invoice.items.all().order_by('id'):
            key, meta = _bucket_for(job.marina, line)
            entry = buckets.setdefault(key, {**meta,
                                            'taxable_sales': Decimal('0.00'),
                                            'exempt_sales': Decimal('0.00'),
                                            'tax_collected': Decimal('0.00')})
            subtotal = (line.total_price or Decimal('0.00')) * sign
            tax = line.line_tax * sign
            if (line.tax_rate or Decimal('0')) == 0:
                entry['exempt_sales'] += subtotal
            else:
                entry['taxable_sales'] += subtotal
            entry['tax_collected'] += tax
            invoice_ids[key].add(invoice.id)

    for key, entry in buckets.items():
        yield {
            **entry,
            'invoice_count': len(invoice_ids[key]),
        }


def _rows(job: ExportJob):
    for r in build_rows(job):
        row = [
            r['country'], r['state'], r['county'], r['city'],
            r['name'], r['reportable_category'], r['rate'],
            _common.quantise(r['taxable_sales']),
            _common.quantise(r['exempt_sales']),
            _common.quantise(r['tax_collected']),
            r['invoice_count'],
        ]
        yield (row,
               r['taxable_sales'] + r['exempt_sales'],
               r['tax_collected'],
               r['taxable_sales'] + r['exempt_sales'] + r['tax_collected'])


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
