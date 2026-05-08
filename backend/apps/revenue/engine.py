"""
Yield pricing engine.

Entry point: calculate_booking_price(marina, berth, check_in, check_out, booking_type)
Returns (base_price, applied_price, matching_rule_or_None).
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal, ROUND_HALF_UP
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from apps.accounts.models import Marina
    from apps.berths.models import Berth
    from apps.revenue.models import YieldRule


def _get_base_nightly_rate(marina: 'Marina', berth: 'Berth', check_in: date, booking_type: str) -> Decimal:
    """Resolve base rate from BookingTier for the berth's category and season."""
    from apps.revenue.models import BookingTier

    season = _date_to_season(check_in, marina)
    if berth.category_id:
        tier = (
            BookingTier.objects
            .filter(marina=marina, berth_category_id=berth.category_id, season=season, booking_type=booking_type)
            .first()
        )
        if tier:
            return tier.base_nightly_rate

    # Fall back to berth's direct pricing_tier ChargeableItem
    if berth.pricing_tier_id:
        return berth.pricing_tier.unit_price

    return Decimal('0')


def _date_to_season(check_in: date, marina: 'Marina') -> str:
    """Determine season from check-in date using marina feature flags or default."""
    seasons = marina.features.get('season_config', {})
    peak_months = seasons.get('peak_months', [6, 7, 8])
    shoulder_months = seasons.get('shoulder_months', [4, 5, 9, 10])
    month = check_in.month
    if month in peak_months:
        return 'peak'
    if month in shoulder_months:
        return 'shoulder'
    return 'off'


def _match_rule(rule: 'YieldRule', marina: 'Marina', berth: 'Berth',
                check_in: date, check_out: date, nights: int) -> bool:
    """Return True if the rule's conditions are met for this booking."""
    p = rule.parameters
    rt = rule.rule_type

    if rt == 'occupancy_threshold':
        threshold = p.get('threshold_pct', 80)
        occupancy = _get_current_occupancy_pct(marina)
        return occupancy >= threshold

    if rt == 'seasonal':
        start_m = p.get('start_month', 1)
        end_m = p.get('end_month', 12)
        return start_m <= check_in.month <= end_m

    if rt == 'last_minute':
        days_before = p.get('days_before', 3)
        return (check_in - date.today()).days <= days_before

    if rt == 'length_of_stay':
        min_nights = p.get('min_nights', 7)
        return nights >= min_nights

    if rt == 'early_bird':
        days_ahead = p.get('days_ahead', 60)
        return (check_in - date.today()).days >= days_ahead

    return False


def _get_current_occupancy_pct(marina: 'Marina') -> int:
    """Return current occupancy as integer percentage (0–100)."""
    from apps.reservations.models import Booking
    today = date.today()
    total = marina.total_berths or 1
    occupied = Booking.objects.filter(
        marina=marina,
        status__in=['confirmed', 'checked_in', 'pending'],
        check_in__lte=today,
        check_out__gt=today,
    ).values('berth_id').distinct().count()
    return int(occupied / total * 100)


def calculate_booking_price(
    marina: 'Marina',
    berth: 'Berth',
    check_in: date,
    check_out: date,
    booking_type: str = 'transient',
) -> tuple[Decimal, Decimal, 'YieldRule | None']:
    """
    Calculate base and yield-adjusted price for a potential booking.

    Returns:
        (base_price, applied_price, matching_rule)
        base_price and applied_price are total amounts for the stay (not per-night).
        matching_rule is None if no yield rule applies.
    """
    from apps.revenue.models import YieldRule

    nights = max((check_out - check_in).days, 1)
    nightly_rate = _get_base_nightly_rate(marina, berth, check_in, booking_type)
    base_price = (nightly_rate * nights).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)

    active_rules = (
        YieldRule.objects
        .filter(marina=marina, is_active=True)
        .order_by('-priority', 'name')
    )

    matching_rule = None
    for rule in active_rules:
        if _match_rule(rule, marina, berth, check_in, check_out, nights):
            matching_rule = rule
            break

    if matching_rule:
        applied_price = (base_price * matching_rule.multiplier).quantize(
            Decimal('0.01'), rounding=ROUND_HALF_UP
        )
    else:
        applied_price = base_price

    return base_price, applied_price, matching_rule


def run_waitlist_sniper(marina_id: int, berth_id: int, freed_from: date, freed_to: date) -> int:
    """
    Called after a booking cancellation (via transaction.on_commit).
    Finds the highest-priority WaitlistEntry whose vessel fits the freed berth
    and whose desired dates overlap the freed window.
    Marks the entry as notified (email notification would be dispatched here).
    Returns the number of entries notified.
    """
    from apps.revenue.models import WaitlistEntry
    from apps.berths.models import Berth

    try:
        berth = Berth.objects.select_related('marina').get(pk=berth_id, marina_id=marina_id)
    except Berth.DoesNotExist:
        return 0

    candidates = (
        WaitlistEntry.objects
        .filter(
            marina_id=marina_id,
            is_active=True,
            fulfilled_booking__isnull=True,
            desired_from__lte=freed_to,
        )
        .filter(
            models.Q(desired_to__isnull=True) | models.Q(desired_to__gte=freed_from)
        )
        .select_related('member', 'vessel')
        .order_by('-priority_score', 'created_at')
    )

    # Filter by vessel fit
    notified = 0
    for entry in candidates:
        loa = entry.vessel_loa or (entry.vessel.loa if entry.vessel else None)
        beam = entry.vessel_beam or (entry.vessel.beam if entry.vessel else None)
        draft = entry.vessel_draft or (entry.vessel.draft if entry.vessel else None)

        if berth.length_m and loa and loa > berth.length_m:
            continue
        if berth.max_beam_m and beam and beam > berth.max_beam_m:
            continue
        if berth.max_draft_m and draft and draft > berth.max_draft_m:
            continue

        # TODO: dispatch email/SMS notification to entry.member
        # For now, log the match — notification system (Track 7) will plug in here.
        notified += 1
        break  # offer to top candidate only; re-run sniper if they decline

    return notified
