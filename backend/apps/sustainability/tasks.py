"""
apps/sustainability/tasks.py

All tasks are plain functions. Uncomment @shared_task when Celery is wired.

Beat schedule (add to CELERY_BEAT_SCHEDULE in settings/base.py):
    'fetch-grid-intensity': {
        'task': 'sustainability.fetch_grid_intensity',
        'schedule': crontab(hour=2, minute=0),          # daily at 02:00 UTC
    },
    'calculate-scope3-fuel-dock': {
        'task': 'sustainability.calculate_scope3_fuel_dock',
        'schedule': crontab(day_of_month=1, hour=3, minute=0),  # monthly
    },
    'roll-sustainability-ledger': {
        'task': 'sustainability.roll_sustainability_ledger',
        'schedule': crontab(hour=4, minute=0),          # nightly at 04:00 UTC
    },
    'sync-play-it-green': {
        'task': 'sustainability.sync_play_it_green',
        'schedule': crontab(day_of_week=0, hour=5, minute=0),   # weekly Sunday 05:00 UTC
    },

Celery task routes (add to settings/base.py):
    CELERY_TASK_ROUTES = {
        'sustainability.generate_esg_report_async': {'queue': 'pdf_generation'},
    }

PDF generation worker (run SEPARATELY from main worker):
    celery -A backend worker \\
        --queues pdf_generation \\
        --concurrency 1 \\
        --max-tasks-per-child 1 \\
        --max-memory-per-child 512000
"""

import logging
import time
import requests
from datetime import date, timedelta
from decimal import Decimal

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Shared helper: Scope 3 fuel dock aggregation for one period
# (Called by Task 2, Task 3, Task 4, and the recalculate API endpoint)
# ---------------------------------------------------------------------------

def calculate_scope3_fuel_dock_for_period(marina, period: str):
    """
    Aggregate completed FuelDockEntry rows for the period by fuel_type and upsert Scope3Record.
    Excludes is_internal_use=True entries (those belong in Scope 1).

    CRITICAL: This helper must be called BEFORE compute_ledger_row() in all callers.
    """
    from apps.fuel_dock.models import FuelDockEntry
    from apps.sustainability.models import Scope3Record, get_active_factor
    from apps.sustainability.calculations import calculate_scope3_fuel_sold
    from django.db.models import Sum

    year, month = period.split('-')
    qs_base = FuelDockEntry.objects.filter(
        marina=marina,
        status='completed',
        is_internal_use=False,
        actual_litres__isnull=False,
        completed_at__year=int(year),
        completed_at__month=int(month),
    )
    excluded_count = FuelDockEntry.objects.filter(
        marina=marina,
        status='completed',
        actual_litres__isnull=True,
        completed_at__year=int(year),
        completed_at__month=int(month),
    ).count()

    for fuel_type in ['diesel', 'petrol']:
        total_litres = qs_base.filter(fuel_type=fuel_type).aggregate(
            s=Sum('actual_litres')
        )['s']
        if not total_litres:
            continue
        try:
            factor = get_active_factor(marina, fuel_type, date(int(year), int(month), 1))
        except Exception:
            logger.exception("No emission factor for %s marina=%s period=%s", fuel_type, marina.pk, period)
            continue

        co2e = calculate_scope3_fuel_sold(Decimal(str(total_litres)), factor.kg_co2e_per_unit)
        Scope3Record.objects.update_or_create(
            marina=marina, period=period,
            category='fuel_sold_vessels', fuel_type=fuel_type,
            defaults={
                'quantity':         total_litres,
                'unit':             'litre',
                'emission_factor':  factor,
                'co2e_kg':          co2e,
                'data_source':      'fuel_dock_auto',
                'source_reference': f"FuelDockEntry period={period} fuel_type={fuel_type}",
                'notes':            f"{excluded_count} entries excluded (null actual_litres).",
            }
        )
        logger.info("Scope3 fuel_sold_vessels upserted marina=%s period=%s fuel=%s litres=%s co2e=%s",
                    marina.pk, period, fuel_type, total_litres, co2e)


# ---------------------------------------------------------------------------
# Task 1: fetch_grid_intensity()  — daily at 02:00 UTC
# ---------------------------------------------------------------------------

# @shared_task
def fetch_grid_intensity():
    """
    Fetch yesterday's grid carbon intensity from National Grid ESO API (UK)
    or static eGRID data (US) for all marinas with live_grid_intensity_enabled=True.
    """
    import urllib.request
    import json
    from apps.accounts.models import Marina
    from apps.sustainability.models import GridCarbonIntensity
    from django.utils import timezone

    yesterday = (timezone.now().date() - timedelta(days=1)).isoformat()

    for marina in Marina.objects.filter(features__live_grid_intensity_enabled=True):
        # Skip if manual override already exists for yesterday
        if GridCarbonIntensity.objects.filter(marina=marina, valid_date=yesterday, is_manual_override=True).exists():
            continue

        jurisdiction = getattr(marina, 'jurisdiction', 'UK') or 'UK'
        try:
            if jurisdiction.upper() == 'UK':
                url = f"https://api.carbonintensity.org.uk/intensity/date/{yesterday}"
                with urllib.request.urlopen(url, timeout=10) as resp:
                    data = json.loads(resp.read())
                values = [
                    pt['intensity']['actual']
                    for pt in data.get('data', [])
                    if pt.get('intensity', {}).get('actual') is not None
                ]
                if not values:
                    continue
                avg_g_per_kwh = sum(values) / len(values)
                kg_per_kwh = Decimal(str(avg_g_per_kwh / 1000)).quantize(Decimal('0.000001'))
                GridCarbonIntensity.objects.update_or_create(
                    marina=marina, valid_date=yesterday,
                    defaults={
                        'grid_source':     'ng_eso',
                        'kg_co2e_per_kwh': kg_per_kwh,
                        'is_manual_override': False,
                        'fetched_at':      timezone.now(),
                    }
                )
                logger.info("Grid intensity updated marina=%s date=%s kg/kWh=%s", marina.pk, yesterday, kg_per_kwh)
            # US: static eGRID — skip live fetch (no public real-time API)

        except Exception:
            logger.exception("fetch_grid_intensity failed marina=%s date=%s", marina.pk, yesterday)

        time.sleep(1)  # courtesy sleep between marinas


# ---------------------------------------------------------------------------
# Task 2: calculate_scope3_fuel_dock()  — 1st of month at 03:00 UTC
# ---------------------------------------------------------------------------

# @shared_task
def calculate_scope3_fuel_dock():
    """Monthly Scope 3 fuel dock aggregation for all ESG-enabled marinas."""
    from apps.accounts.models import Marina
    from django.utils import timezone

    today      = timezone.now().date()
    prev_month = today.replace(day=1) - timedelta(days=1)
    period     = prev_month.strftime('%Y-%m')

    for marina in Marina.objects.filter(features__esg_enabled=True):
        try:
            calculate_scope3_fuel_dock_for_period(marina, period)
        except Exception:
            logger.exception("calculate_scope3_fuel_dock failed marina=%s period=%s", marina.pk, period)


# ---------------------------------------------------------------------------
# Task 3: roll_sustainability_ledger()  — nightly at 04:00 UTC
# ---------------------------------------------------------------------------

# @shared_task
def roll_sustainability_ledger():
    """
    Nightly ledger roll-up for all ESG-enabled marinas.
    Processes current and previous period.
    Always re-aggregates Scope 3 fuel dock first.
    Respects manual Scope 2 override (never overwrites data_source='manual').
    """
    from apps.accounts.models import Marina
    from apps.sustainability.models import Scope2Record, SustainabilityLedger
    from apps.sustainability.calculations import compute_ledger_row
    from django.utils import timezone

    today        = timezone.now().date()
    current_period = today.strftime('%Y-%m')
    prev_date    = today.replace(day=1) - timedelta(days=1)
    prev_period  = prev_date.strftime('%Y-%m')

    for marina in Marina.objects.filter(features__esg_enabled=True):
        for period in [current_period, prev_period]:
            try:
                # Step 1: Re-aggregate Scope 3 fuel dock first
                calculate_scope3_fuel_dock_for_period(marina, period)

                # Step 2: Scope 2 manual override guard
                existing_s2 = Scope2Record.objects.filter(marina=marina, period=period).first()
                if existing_s2 and existing_s2.data_source == 'manual':
                    logger.info("Skipping Scope 2 auto-aggregation for marina=%s period=%s — manual record exists", marina.pk, period)
                else:
                    # TODO: run utility module aggregation → write Scope2Record when utility module is available
                    pass

                # Step 3: Compute ledger row
                row_data = compute_ledger_row(marina.pk, period)

                # Step 4: Upsert ledger
                SustainabilityLedger.objects.update_or_create(
                    marina=marina, period=period, defaults=row_data,
                )
                logger.info("Ledger rolled marina=%s period=%s total_co2e=%s", marina.pk, period, row_data['total_co2e_kg'])
            except Exception:
                logger.exception("roll_sustainability_ledger failed marina=%s period=%s", marina.pk, period)


# ---------------------------------------------------------------------------
# Task 4: recalculate_ledger_period()  — on-demand (triggered by staleness signals)
# ---------------------------------------------------------------------------

# @shared_task
def recalculate_ledger_period(marina_id: int, period: str):
    """
    On-demand recalculation for a specific marina/period.
    Triggered by staleness signals with a 30-second countdown.
    Same steps as one iteration of roll_sustainability_ledger().
    """
    from apps.accounts.models import Marina
    from apps.sustainability.models import Scope2Record, SustainabilityLedger
    from apps.sustainability.calculations import compute_ledger_row

    try:
        marina = Marina.objects.get(pk=marina_id)
    except Marina.DoesNotExist:
        logger.warning("recalculate_ledger_period: marina %s not found", marina_id)
        return

    calculate_scope3_fuel_dock_for_period(marina, period)
    row_data = compute_ledger_row(marina_id, period)
    SustainabilityLedger.objects.update_or_create(
        marina=marina, period=period, defaults=row_data,
    )
    logger.info("Ledger recalculated marina=%s period=%s", marina_id, period)


# ---------------------------------------------------------------------------
# Task 5: sync_play_it_green()  — weekly Sunday at 05:00 UTC
# ---------------------------------------------------------------------------

# @shared_task
def sync_play_it_green():
    """
    Sync OffsetContribution records with Play It Green API.
    Push: unsynced contributions (pig_contribution_id='').
    Pull: contributions missing certificate_url.
    """
    import urllib.request
    import json
    from apps.accounts.models import Marina
    from apps.sustainability.models import OffsetContribution, PlayItGreenSync
    from django.utils import timezone

    for marina in Marina.objects.all():
        api_key = marina.features.get('pig_api_key', '')
        if not api_key:
            logger.debug("PIG sync skipped — no api_key for marina=%s", marina.pk)
            continue

        headers = {'Authorization': f'Bearer {api_key}', 'Content-Type': 'application/json'}

        # PUSH: unsynced contributions
        unsynced = list(OffsetContribution.objects.filter(marina=marina, pig_contribution_id=''))
        if unsynced:
            payload = json.dumps([
                {'amount_gbp': str(c.amount_gbp), 'marina_ref': str(c.pk)}
                for c in unsynced
            ]).encode()
            try:
                req  = urllib.request.Request('https://api.playitgreen.com/v1/contributions', data=payload, headers=headers, method='POST')
                with urllib.request.urlopen(req, timeout=15) as resp:
                    result = json.loads(resp.read())
                    for c, r in zip(unsynced, result.get('contributions', [])):
                        c.pig_contribution_id = r.get('id', '')
                        c.units_purchased     = r.get('units', None)
                        c.unit_type           = r.get('unit_type', '')
                        c.synced_at           = timezone.now()
                        c.save(update_fields=['pig_contribution_id', 'units_purchased', 'unit_type', 'synced_at'])
                    PlayItGreenSync.objects.create(
                        marina=marina, direction='push', status='success',
                        records_count=len(unsynced), total_gbp=sum(c.amount_gbp for c in unsynced),
                    )
            except Exception as exc:
                logger.exception("PIG push failed marina=%s", marina.pk)
                PlayItGreenSync.objects.create(
                    marina=marina, direction='push', status='failed',
                    records_count=len(unsynced), error_detail=str(exc)[:500],
                )

        # PULL: missing certificate URLs
        uncertified = OffsetContribution.objects.filter(
            marina=marina, certificate_url=''
        ).exclude(pig_contribution_id='')
        for c in uncertified:
            try:
                req  = urllib.request.Request(
                    f'https://api.playitgreen.com/v1/contributions/{c.pig_contribution_id}/certificate',
                    headers=headers,
                )
                with urllib.request.urlopen(req, timeout=15) as resp:
                    result = json.loads(resp.read())
                    c.certificate_url = result.get('url', '')
                    c.co2e_offset_kg  = result.get('co2e_offset_kg', None)
                    c.save(update_fields=['certificate_url', 'co2e_offset_kg'])
            except Exception:
                logger.warning("PIG certificate pull failed contribution=%s", c.pk)


# ---------------------------------------------------------------------------
# Task 6: create_offset_contribution()  — on-demand (invoice paid signal)
# ---------------------------------------------------------------------------

# @shared_task
def create_offset_contribution(line_item_id: int):
    """
    Create OffsetContribution for a paid InvoiceLineItem with category='offset'.
    Triggered by on_invoice_paid signal via transaction.on_commit().
    Handles GBP conversion when marina currency != GBP.
    """
    from apps.billing.models import InvoiceLineItem
    from apps.sustainability.models import OffsetContribution
    from django.utils import timezone

    try:
        line = InvoiceLineItem.objects.select_related(
            'invoice', 'invoice__marina', 'chargeable_item'
        ).get(pk=line_item_id)
    except InvoiceLineItem.DoesNotExist:
        logger.warning("create_offset_contribution: line_item %s not found", line_item_id)
        return

    if line.unit_price <= 0:
        return  # guard re-checked here

    marina = line.invoice.marina
    amount = Decimal(str(line.unit_price * line.quantity))

    # Try to get the associated booking (if the invoice has one)
    booking = getattr(line.invoice, 'booking', None)

    OffsetContribution.objects.create(
        marina=marina,
        booking=booking,
        invoice_line_item=line,
        amount_gbp=amount,
        partner='play_it_green',
    )
    logger.info("OffsetContribution created for line_item=%s amount=£%s", line_item_id, amount)


# ---------------------------------------------------------------------------
# Task 7: generate_esg_report_async()  — on-demand, pdf_generation queue
# ---------------------------------------------------------------------------

# @shared_task(
#     name='sustainability.generate_esg_report_async',
#     queue='pdf_generation',      # MANDATORY: dedicated queue
#     acks_late=True,              # requeue if worker killed mid-task
#     reject_on_worker_lost=True,  # requeue on OOM kill
# )
def generate_esg_report_async(archive_id: int):
    """
    Generate ESG report PDF for the given ESGReportArchive.
    MUST run on the dedicated 'pdf_generation' Celery queue with:
        --concurrency 1
        --max-tasks-per-child 1
        --max-memory-per-child 512000
    """
    from django.core.files.base import ContentFile
    from django.utils import timezone
    from apps.sustainability.models import ESGReportArchive
    from apps.sustainability.pdf_report import generate_esg_report_pdf

    try:
        archive = ESGReportArchive.objects.get(pk=archive_id)
    except ESGReportArchive.DoesNotExist:
        logger.error("generate_esg_report_async: archive %s not found", archive_id)
        return

    try:
        pdf_bytes = generate_esg_report_pdf(archive)
        slug      = getattr(archive.marina, 'slug', str(archive.marina_id))
        filename  = f"{slug}-esg-report-{archive.period_from}-{archive.period_to}.pdf"
        archive.pdf_file.save(filename, ContentFile(pdf_bytes), save=False)
        archive.status       = ESGReportArchive.Status.READY
        archive.generated_at = timezone.now()
        archive.save(update_fields=['pdf_file', 'status', 'generated_at'])
        logger.info("ESGReport %s generated successfully", archive_id)
    except Exception as exc:
        archive.status       = ESGReportArchive.Status.FAILED
        archive.error_detail = str(exc)[:500]
        archive.save(update_fields=['status', 'error_detail'])
        logger.exception("ESGReport %s generation failed", archive_id)
        raise  # re-raise so Celery marks the task as failed
