"""
apps/sustainability/calculations.py

Pure calculation functions — zero ORM calls.
All functions accept raw Decimal values.
This makes unit testing trivial and keeps business logic decoupled from the DB.

Functions:
  calculate_scope1_co2e()
  calculate_scope2_co2e()
  calculate_scope3_fuel_sold()
  calculate_diversion_rate()
  get_grid_intensity_for_period()
  get_recognized_revenue_for_period()
  compute_ledger_row()
"""

import logging
from decimal import Decimal, ROUND_HALF_UP
from typing import Optional

logger = logging.getLogger(__name__)

# Hard-coded fallback constants (Tier 4)
_UK_GRID_INTENSITY = Decimal('0.23314')  # DEFRA 2023 UK grid
_US_GRID_INTENSITY = Decimal('0.38600')  # EPA eGRID 2022 US average


# ---------------------------------------------------------------------------
# Core emission calculations (pure functions, no ORM)
# ---------------------------------------------------------------------------

def calculate_scope1_co2e(quantity: Decimal, kg_co2e_per_unit: Decimal) -> Decimal:
    """
    Scope 1 direct emissions.
    quantity: fuel consumed in the emission factor's native unit (litre, kg, or kWh).
    Do NOT assume litres — LPG is in kg, natural gas in kWh.
    """
    return (quantity * kg_co2e_per_unit).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)


def calculate_scope2_co2e(kwh_consumed: Decimal, kg_co2e_per_kwh: Decimal) -> Decimal:
    """Scope 2 location-based electricity emissions."""
    return (kwh_consumed * kg_co2e_per_kwh).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)


def calculate_scope3_fuel_sold(actual_litres: Decimal, kg_co2e_per_unit: Decimal) -> Decimal:
    """
    Scope 3 — fuel sold to vessels at the fuel dock.
    Only call with litres from FuelDockEntry rows where is_internal_use=False.
    Internal marina fuel belongs in Scope 1 — counting it here doubles the emissions.
    """
    return (actual_litres * kg_co2e_per_unit).quantize(Decimal('0.0001'), rounding=ROUND_HALF_UP)


def calculate_diversion_rate(total_quantity: Decimal, diverted_quantity: Decimal) -> Decimal:
    """
    Waste diversion rate as a percentage (0.00–100.00).
    Returns 0.00 when total_quantity is zero — never raises ZeroDivisionError.
    """
    if total_quantity == Decimal('0.00') or total_quantity == 0:
        return Decimal('0.00')
    return (diverted_quantity / total_quantity * 100).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


# ---------------------------------------------------------------------------
# Grid intensity fallback hierarchy (may use ORM — called from tasks/views)
# ---------------------------------------------------------------------------

def get_grid_intensity_for_period(marina, period: str) -> tuple[Decimal, str]:
    """
    Returns (kg_co2e_per_kwh, source_label) for the given marina and period.

    Fallback hierarchy:
    1. GridCarbonIntensity with is_manual_override=True for period.
    2. Most recent live API feed (only when live_grid_intensity_enabled=True).
    3. EmissionFactor for electricity for this marina/jurisdiction (static annual).
    4. Hard-coded constant (UK=0.23314, US=0.386).

    Never returns zero. Always logs which tier was used.
    """
    from apps.sustainability.models import GridCarbonIntensity, EmissionFactor
    from datetime import date as date_cls

    # Tier 1: manual override for this period
    override = GridCarbonIntensity.objects.filter(
        marina=marina,
        is_manual_override=True,
        valid_date__startswith=period,
    ).order_by('-valid_date').first()
    if override:
        logger.info("Scope 2 grid intensity: tier 1 (manual override) marina=%s period=%s", marina.pk, period)
        return override.kg_co2e_per_kwh, 'Manual Override'

    # Tier 2: live API feed
    if marina.features.get('live_grid_intensity_enabled', False):
        live = GridCarbonIntensity.objects.filter(
            marina=marina,
            is_manual_override=False,
            valid_date__startswith=period,
        ).order_by('-valid_date').first()
        if live:
            logger.info("Scope 2 grid intensity: tier 2 (live feed) marina=%s period=%s", marina.pk, period)
            return live.kg_co2e_per_kwh, f"National Grid ESO (live) {live.valid_date}"

    # Tier 3: static EmissionFactor for electricity
    year, month = period.split('-')
    period_date = date_cls(int(year), int(month), 1)
    try:
        from apps.sustainability.models import get_active_factor
        factor = get_active_factor(marina, 'electricity', period_date)
        logger.info("Scope 2 grid intensity: tier 3 (static EmissionFactor) marina=%s period=%s", marina.pk, period)
        return factor.kg_co2e_per_unit, f"Emission Factor ({factor.get_source_display()})"
    except Exception:
        pass

    # Tier 4: hard-coded constant
    jurisdiction = getattr(marina, 'jurisdiction', 'UK') or 'UK'
    intensity    = _US_GRID_INTENSITY if jurisdiction.upper() == 'US' else _UK_GRID_INTENSITY
    logger.warning(
        "Scope 2 grid intensity: tier 4 (hard-coded constant) marina=%s period=%s jurisdiction=%s value=%s",
        marina.pk, period, jurisdiction, intensity,
    )
    return intensity, f"Hard-coded constant ({jurisdiction})"


# ---------------------------------------------------------------------------
# Revenue recognition (ORM, with graceful fallback)
# ---------------------------------------------------------------------------

def get_recognized_revenue_for_period(marina_id: int, period: str) -> Decimal:
    """
    Revenue denominator for intensity metrics.

    Uses DeferredRevenueRecognitionLog (Track 4) when available.
    Falls back to gross Invoice.total with a warning log.

    CRITICAL: Never aggregate Invoice.total directly for intensity metrics
    in caller code — always call this function.
    """
    try:
        from apps.revenue.models import DeferredRevenueRecognitionLog
        recognised = DeferredRevenueRecognitionLog.objects.filter(
            marina_id=marina_id,
            period=period,
        ).aggregate(total=models_sum('recognised_amount'))['total']
        return Decimal(str(recognised or 0))
    except Exception:
        logger.warning(
            "DeferredRevenueRecognitionLog unavailable for marina_id=%s period=%s — "
            "using gross Invoice total. Deploy Track 4 for accurate revenue recognition.",
            marina_id, period,
        )

    # Fallback: gross invoice total for the period
    try:
        from apps.billing.models import Invoice
        from django.db.models import Sum as models_sum_fallback
        total = Invoice.objects.filter(
            marina_id=marina_id,
            billing_period=period,
            status='paid',
        ).aggregate(t=models_sum_fallback('total'))['t']
        return Decimal(str(total or 0))
    except Exception:
        logger.exception("Could not compute revenue for marina_id=%s period=%s", marina_id, period)
        return Decimal('0')


def _models_sum(field):
    from django.db.models import Sum
    return Sum(field)


# Alias for internal use in get_recognized_revenue_for_period
models_sum = _models_sum


# ---------------------------------------------------------------------------
# Ledger row aggregation (ORM)
# ---------------------------------------------------------------------------

def compute_ledger_row(marina_id: int, period: str) -> dict:
    """
    Aggregate all scope totals, revenue, and berth-nights for a marina/period.
    Returns a dict ready to upsert into SustainabilityLedger.

    IMPORTANT: Callers MUST call calculate_scope3_fuel_dock_for_period(marina, period)
    FIRST to ensure Scope 3 is current before computing the ledger.
    """
    from decimal import Decimal as D
    from django.db.models import Sum
    from apps.sustainability.models import (
        Scope1Record, Scope2Record, Scope3Record, OffsetContribution,
    )
    from apps.reservations.models import Booking

    def agg(qs, field):
        result = qs.aggregate(t=Sum(field))['t']
        return D(str(result or 0))

    scope1 = agg(Scope1Record.objects.filter(marina_id=marina_id, date__startswith=period), 'co2e_kg')
    scope2 = agg(Scope2Record.objects.filter(marina_id=marina_id, period=period), 'co2e_kg')
    scope3 = agg(Scope3Record.objects.filter(marina_id=marina_id, period=period), 'co2e_kg')
    total  = scope1 + scope2 + scope3

    revenue      = get_recognized_revenue_for_period(marina_id, period)
    offset_co2e  = agg(OffsetContribution.objects.filter(marina_id=marina_id), 'co2e_offset_kg')

    # Berth-nights: count Booking records that overlap the period
    year, month  = period.split('-')
    from datetime import date
    period_start = date(int(year), int(month), 1)
    import calendar
    last_day     = calendar.monthrange(int(year), int(month))[1]
    period_end   = date(int(year), int(month), last_day)

    berth_nights = Booking.objects.filter(
        marina_id=marina_id,
        status='confirmed',
        arrival_date__lte=period_end,
        departure_date__gte=period_start,
    ).count()

    # Intensity metrics (null when denominator is zero)
    intensity_per_gbp         = (total / revenue).quantize(D('0.000001'), rounding=ROUND_HALF_UP) if revenue > 0 else None
    intensity_per_berth_night = (total / D(berth_nights)).quantize(D('0.0001'), rounding=ROUND_HALF_UP) if berth_nights > 0 else None

    return {
        'scope1_co2e_kg':          scope1,
        'scope2_co2e_kg':          scope2,
        'scope3_co2e_kg':          scope3,
        'total_co2e_kg':           total,
        'revenue_gbp':             revenue,
        'berth_nights':            berth_nights,
        'co2e_kg_per_gbp_revenue': intensity_per_gbp,
        'co2e_kg_per_berth_night': intensity_per_berth_night,
        'offset_co2e_kg':          offset_co2e,
        'is_stale':                False,
    }
