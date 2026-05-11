"""
apps/sustainability/pdf_report.py

WeasyPrint ESG report builder.

generate_esg_report_pdf(archive) → bytes

This function is designed to be wrapped in a Celery task that runs on the
dedicated 'pdf_generation' queue with --concurrency 1 --max-tasks-per-child 1.
All exceptions propagate — the caller (generate_esg_report_async task) catches
them and sets ESGReportArchive.status='failed' with error_detail.

TCFD framework raises ValueError — guard in the view prevents it reaching this function,
but the task will handle it gracefully by setting error_detail.
"""

import logging

from django.conf import settings
from django.template.loader import render_to_string

logger = logging.getLogger(__name__)


def _get_prior_year_ledger(marina, archive):
    """
    Retrieve prior-year ledger rows for year-on-year comparison.
    Returns None when no prior-year data exists (UI renders 'Not available' notice).
    """
    from apps.sustainability.models import SustainabilityLedger

    # Shift period_from/to back by 12 months
    try:
        from_year, from_month = archive.period_from.split('-')
        to_year,   to_month   = archive.period_to.split('-')
        prior_from = f"{int(from_year) - 1}-{from_month}"
        prior_to   = f"{int(to_year)   - 1}-{to_month}"
    except Exception:
        return None

    qs = SustainabilityLedger.objects.filter(
        marina=marina,
        period__gte=prior_from,
        period__lte=prior_to,
    )
    return qs if qs.exists() else None


def generate_esg_report_pdf(archive) -> bytes:
    """
    Render the ESG report HTML templates to PDF bytes using WeasyPrint.
    Returns raw PDF bytes. Caller saves to media storage.
    Raises on any error — caller sets ESGReportArchive.error_detail.

    TCFD framework raises ValueError — this is caught by the task.
    """
    if archive.framework == 'tcfd':
        raise ValueError("TCFD framework is not yet available.")

    from weasyprint import HTML

    from apps.sustainability.models import (
        Scope1Record, Scope2Record, Scope3Record, WasteLog,
        OffsetContribution, SustainabilityLedger,
    )

    marina = archive.marina

    ledger_rows = SustainabilityLedger.objects.filter(
        marina=marina,
        period__gte=archive.period_from,
        period__lte=archive.period_to,
    ).order_by('period')

    scope1_data = Scope1Record.objects.filter(
        marina=marina,
        date__gte=f"{archive.period_from}-01",
        date__lte=f"{archive.period_to}-31",
    ).order_by('date')

    scope2_data = Scope2Record.objects.filter(
        marina=marina,
        period__gte=archive.period_from,
        period__lte=archive.period_to,
    ).order_by('period')

    scope3_data = Scope3Record.objects.filter(
        marina=marina,
        period__gte=archive.period_from,
        period__lte=archive.period_to,
    ).order_by('period', 'category')

    waste_data = WasteLog.objects.filter(
        marina=marina,
        date__gte=f"{archive.period_from}-01",
        date__lte=f"{archive.period_to}-31",
    ).order_by('date')

    offset_data = OffsetContribution.objects.filter(
        marina=marina,
    ).order_by('-created_at')

    from apps.sustainability.calculations import calculate_diversion_rate
    from decimal import Decimal
    from django.db.models import Sum

    total_waste    = waste_data.aggregate(t=Sum('quantity'))['t'] or Decimal('0')
    recycled_waste = waste_data.filter(disposal_method='recycled').aggregate(t=Sum('quantity'))['t'] or Decimal('0')
    diversion_rate = calculate_diversion_rate(total_waste, recycled_waste)

    prior_year_ledger = _get_prior_year_ledger(marina, archive)

    context = {
        'marina':           marina,
        'archive':          archive,
        'ledger_rows':      ledger_rows,
        'scope1_data':      scope1_data,
        'scope2_data':      scope2_data,
        'scope3_data':      scope3_data,
        'waste_data':       waste_data,
        'offset_data':      offset_data,
        'diversion_rate':   diversion_rate,
        'prior_year_ledger': prior_year_ledger,
        'gri':              archive.framework == 'gri',
        'module_activated': ledger_rows.order_by('period').values_list('period', flat=True).first(),
    }

    html_str = render_to_string('sustainability/esg_report.html', context)

    if archive.framework == 'gri':
        gri_str  = render_to_string('sustainability/esg_report_gri_annex.html', context)
        html_str += gri_str

    base_url = getattr(settings, 'MEDIA_ROOT', None) or '/'
    return HTML(string=html_str, base_url=str(base_url)).write_pdf()
