# backend/apps/reservations/booking_engine.py
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Subquery, OuterRef

from apps.berths.models import Berth
from .models import Booking

ACTIVE_STATUSES = ['awaiting_payment', 'pending_payment', 'confirmed', 'pending', 'checked_in']
SCORING_STATUSES = ACTIVE_STATUSES + ['checked_out', 'overstay']
INFINITE_GAP = timedelta(days=3650)  # treat missing neighbour as 10-year gap


class NoAvailableBerthError(Exception):
    pass


def compatible_available_berths(marina, check_in, check_out, boat_loa=None, boat_beam=None):
    """
    Return a queryset of Berths that:
    1. Physically fit the boat (length_m >= boat_loa, max_beam_m >= boat_beam)
    2. Have no confirmed/active booking that overlaps [check_in, check_out)
    """
    qs = Berth.objects.filter(marina=marina)
    if boat_loa is not None:
        qs = qs.filter(length_m__gte=Decimal(str(boat_loa)))
    if boat_beam is not None:
        qs = qs.filter(max_beam_m__gte=Decimal(str(boat_beam)))

    blocked_ids = (
        Booking.objects.filter(
            marina=marina,
            berth__isnull=False,
            status__in=ACTIVE_STATUSES,
            check_in__lt=check_out,
            check_out__gt=check_in,
        )
        .values_list('berth_id', flat=True)
        .distinct()
    )
    return qs.exclude(id__in=blocked_ids)


def _score_berths(available_berths, check_in, check_out):
    """
    Annotate each berth with the dates of its nearest neighbours and compute
    gap_before + gap_after. Uses ORM subqueries — no full table scan.
    Returns [(score: timedelta, berth), ...] sorted ascending.
    """
    if isinstance(check_in, str):
        check_in = date.fromisoformat(check_in)
    if isinstance(check_out, str):
        check_out = date.fromisoformat(check_out)

    prev_qs = (
        Booking.objects.filter(
            berth=OuterRef('pk'),
            check_out__lte=check_in,
            status__in=SCORING_STATUSES,
        )
        .order_by('-check_out')
        .values('check_out')[:1]
    )
    next_qs = (
        Booking.objects.filter(
            berth=OuterRef('pk'),
            check_in__gte=check_out,
            status__in=SCORING_STATUSES,
        )
        .order_by('check_in')
        .values('check_in')[:1]
    )

    annotated = available_berths.annotate(
        _prev_checkout=Subquery(prev_qs),
        _next_checkin=Subquery(next_qs),
    )

    scored = []
    for berth in annotated:
        gap_before = (check_in - berth._prev_checkout) if berth._prev_checkout else INFINITE_GAP
        gap_after = (berth._next_checkin - check_out) if berth._next_checkin else INFINITE_GAP
        scored.append((gap_before + gap_after, berth))

    scored.sort(key=lambda x: x[0])
    return scored


def create_manual_approval(marina, check_in, check_out, boat_loa, boat_beam, guest_name, guest_email, guest_phone):
    """Mode A: create a Booking with berth=null, status=pending_approval."""
    if isinstance(check_in, str):
        check_in = date.fromisoformat(check_in)
    if isinstance(check_out, str):
        check_out = date.fromisoformat(check_out)

    if check_out <= check_in:
        raise ValueError(f'check_out ({check_out}) must be after check_in ({check_in}).')

    nights = (check_out - check_in).days or 1
    return Booking.objects.create(
        marina=marina,
        berth=None,
        vessel=None,
        check_in=check_in,
        check_out=check_out,
        nights=nights,
        amount=None,
        status='pending_approval',
        boat_loa=boat_loa,
        boat_beam=boat_beam,
        guest_name=guest_name,
        guest_email=guest_email,
        guest_phone=guest_phone,
    )


def run_tetris(marina, check_in, check_out, boat_loa, boat_beam, guest_name, guest_email, guest_phone):
    """
    Mode B: run gap-minimisation, assign berth immediately, return Booking
    with status=pending_payment.
    Raises NoAvailableBerthError if no compatible berth is free.
    """
    if isinstance(check_in, str):
        check_in = date.fromisoformat(check_in)
    if isinstance(check_out, str):
        check_out = date.fromisoformat(check_out)

    if check_out <= check_in:
        raise ValueError(f'check_out ({check_out}) must be after check_in ({check_in}).')

    candidates = compatible_available_berths(marina, check_in, check_out, boat_loa, boat_beam)
    scored = _score_berths(candidates, check_in, check_out)

    if not scored:
        raise NoAvailableBerthError('No compatible berth available for the requested dates.')

    best_berth = scored[0][1]
    nights = (check_out - check_in).days or 1
    price = best_berth.pricing_tier.unit_price
    amount = Decimal(str(price)) * nights

    return Booking.objects.create(
        marina=marina,
        berth=best_berth,
        vessel=None,
        check_in=check_in,
        check_out=check_out,
        nights=nights,
        amount=amount,
        status='pending_payment',
        boat_loa=boat_loa,
        boat_beam=boat_beam,
        guest_name=guest_name,
        guest_email=guest_email,
        guest_phone=guest_phone,
    )
