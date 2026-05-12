# backend/apps/reservations/booking_engine.py
from datetime import date, timedelta
from decimal import Decimal
from django.utils import timezone

from django.db import transaction
from django.db.models import Q, Subquery, OuterRef

from apps.berths.models import Berth
from .models import Booking

ACTIVE_STATUSES = ['awaiting_payment', 'pending_payment', 'confirmed', 'pending', 'checked_in']
SCORING_STATUSES = ACTIVE_STATUSES + ['checked_out', 'overstay']
INFINITE_GAP = timedelta(days=3650)  # treat missing neighbour as 10-year gap


class NoAvailableBerthError(Exception):
    pass


def compatible_available_berths(
    marina, check_in, check_out,
    boat_loa=None, boat_beam=None, boat_draft=None,
):
    """
    Return a queryset of Berths that:
    1. Physically fit the boat (length_m >= boat_loa, max_beam_m >= boat_beam, max_draft_m >= boat_draft (NULL max_draft_m = unconstrained, always passes))
    2. Are not in maintenance status
    3. Have no confirmed/active booking that overlaps [check_in, check_out)
    4. Are not assigned to an OTA connection (direct-only berths)
    """
    qs = Berth.objects.filter(marina=marina).exclude(status='maintenance')
    qs = qs.filter(ota_connection__isnull=True)

    if boat_loa is not None:
        qs = qs.filter(length_m__gte=Decimal(str(boat_loa)))
    if boat_beam is not None:
        qs = qs.filter(max_beam_m__gte=Decimal(str(boat_beam)))
    if boat_draft is not None:
        qs = qs.filter(
            Q(max_draft_m__isnull=True) | Q(max_draft_m__gte=Decimal(str(boat_draft)))
        )

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


def create_manual_approval(marina, check_in, check_out, boat_loa, boat_beam, boat_draft=None,
                           guest_name='', guest_email='', guest_phone=''):
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
        boat_draft=boat_draft,
        guest_name=guest_name,
        guest_email=guest_email,
        guest_phone=guest_phone,
    )


def run_tetris(marina, check_in, check_out, boat_loa, boat_beam, boat_draft=None,
               guest_name='', guest_email='', guest_phone='',
               vessel_name='', eta=None, berth_category=None):
    """
    Mode B: run gap-minimisation, assign berth immediately, return Booking
    with status=pending_payment.
    Raises NoAvailableBerthError if no compatible berth is free.

    If berth_category is given, only berths in that category are considered —
    ensuring a guest who paid for a specific category gets a berth in it.

    Uses select_for_update() + collision re-check inside a transaction to guard
    against TOCTOU races: if a concurrent request steals the top-ranked berth
    between scoring and writing, we fall through to the next candidate.
    """
    if isinstance(check_in, str):
        check_in = date.fromisoformat(check_in)
    if isinstance(check_out, str):
        check_out = date.fromisoformat(check_out)
    if check_out <= check_in:
        raise ValueError(f'check_out ({check_out}) must be after check_in ({check_in}).')

    candidates = compatible_available_berths(
        marina, check_in, check_out, boat_loa, boat_beam, boat_draft,
    )
    if berth_category is not None:
        candidates = candidates.filter(category=berth_category)
    scored = _score_berths(candidates, check_in, check_out)
    if not scored:
        raise NoAvailableBerthError('No compatible berth available for the requested dates.')

    nights = (check_out - check_in).days or 1

    with transaction.atomic():
        for _, berth in scored:
            # Acquire a row-level lock on this berth for the duration of the transaction,
            # preventing concurrent run_tetris calls from booking the same berth.
            Berth.objects.select_for_update().get(pk=berth.pk)

            collision = Booking.objects.filter(
                berth=berth,
                status__in=ACTIVE_STATUSES,
                check_in__lt=check_out,
                check_out__gt=check_in,
            ).exists()
            if collision:
                continue

            price = berth.pricing_tier.unit_price
            amount = Decimal(str(price)) * nights
            return Booking.objects.create(
                marina=marina,
                berth=berth,
                vessel=None,
                check_in=check_in,
                check_out=check_out,
                nights=nights,
                amount=amount,
                status='pending_payment',
                boat_loa=boat_loa,
                boat_beam=boat_beam,
                boat_draft=boat_draft,
                guest_name=guest_name,
                guest_email=guest_email,
                guest_phone=guest_phone,
                vessel_name=vessel_name,
                eta=eta,
            )

        raise NoAvailableBerthError('No compatible berth available for the requested dates.')


def assign_berth(marina, check_in, check_out, boat_loa, boat_beam=None,
                 boat_draft=None, berth_category=None):
    """
    Select the best available berth for one cart item.
    Returns (berth, Decimal price) where price = unit_price × nights.
    Raises NoAvailableBerthError if no berth fits.

    MUST be called inside an outer transaction.atomic(). The select_for_update()
    row lock is held until that outer transaction commits or rolls back.
    If any item in a multi-item cart fails, the caller's transaction rolls back,
    releasing all locks and creating zero records.
    """
    if isinstance(check_in, str):
        check_in = date.fromisoformat(check_in)
    if isinstance(check_out, str):
        check_out = date.fromisoformat(check_out)
    if check_out <= check_in:
        raise NoAvailableBerthError('check_out must be after check_in.')

    candidates = compatible_available_berths(
        marina, check_in, check_out, boat_loa, boat_beam, boat_draft,
    )
    if berth_category is not None:
        candidates = candidates.filter(category=berth_category)
    scored = _score_berths(candidates, check_in, check_out)
    if not scored:
        raise NoAvailableBerthError('No compatible berth available for the requested dates.')

    nights = (check_out - check_in).days or 1

    from .models import ReservationItem  # local import avoids circular

    for _, berth in scored:
        # Acquire a row-level lock BEFORE conflict checks.
        # Under PostgreSQL Read Committed isolation, plain .exists() is a
        # non-locking read — two concurrent transactions both see no conflict
        # and both write a ReservationItem (double-booking). select_for_update()
        # serialises concurrent evaluation of the same berth row.
        Berth.objects.select_for_update().get(pk=berth.pk)

        booking_conflict = Booking.objects.filter(
            berth=berth,
            status__in=ACTIVE_STATUSES,
            check_in__lt=check_out,
            check_out__gt=check_in,
        ).exists()
        if booking_conflict:
            continue

        item_conflict = ReservationItem.objects.filter(
            berth=berth,
            status__in=['locked', 'confirmed'],
            check_in__lt=check_out,
            check_out__gt=check_in,
        ).exists()
        if item_conflict:
            continue

        if berth_category is not None:
            price = Decimal(str(berth_category.pricing_tier.unit_price)) * nights
        else:
            price = Decimal(str(berth.pricing_tier.unit_price)) * nights

        return berth, price

    raise NoAvailableBerthError('No compatible berth available for the requested dates.')


ALTERNATIVE_SHIFTS = [-2, -1, 1, 2]     # days to shift check_in, same duration
ALTERNATIVE_DURATIONS = [-1, 1, -2, 2]  # nights delta, same check_in


def find_date_alternatives(marina, check_in, check_out, boat_loa, boat_beam, boat_draft, max_results=4):
    """
    When the exact dates are unavailable, find nearby date windows that do have
    compatible berths. Checks shifted windows (same duration, different start)
    and duration variants (same check_in, ±1 or ±2 nights).
    Returns up to max_results dicts sorted by proximity to the original dates.
    Uses timezone.localdate() for the past-date guard so it respects the server
    timezone rather than Python's date.today().
    """
    if isinstance(check_in, str):
        check_in = date.fromisoformat(check_in)
    if isinstance(check_out, str):
        check_out = date.fromisoformat(check_out)
    original_nights = (check_out - check_in).days
    today = timezone.localdate()
    candidates = []

    for delta in ALTERNATIVE_SHIFTS:
        new_in = check_in + timedelta(days=delta)
        new_out = new_in + timedelta(days=original_nights)
        if new_in < today:
            continue
        scored = _score_berths(
            compatible_available_berths(marina, new_in, new_out, boat_loa, boat_beam, boat_draft).select_related('pricing_tier'),
            new_in, new_out,
        )
        if scored:
            berth = scored[0][1]
            if not berth.pricing_tier:
                continue  # skip unpriced berths; try next permutation
            candidates.append({
                'check_in': new_in,
                'check_out': new_out,
                'nights': original_nights,
                'price_per_night': berth.pricing_tier.unit_price,
                'total': berth.pricing_tier.unit_price * original_nights,
            })

    for delta in ALTERNATIVE_DURATIONS:
        new_nights = original_nights + delta
        if new_nights < 1:
            continue
        new_out = check_in + timedelta(days=new_nights)
        scored = _score_berths(
            compatible_available_berths(marina, check_in, new_out, boat_loa, boat_beam, boat_draft).select_related('pricing_tier'),
            check_in, new_out,
        )
        if scored:
            berth = scored[0][1]
            if not berth.pricing_tier:
                continue  # skip unpriced berths; try next permutation
            candidates.append({
                'check_in': check_in,
                'check_out': new_out,
                'nights': new_nights,
                'price_per_night': berth.pricing_tier.unit_price,
                'total': berth.pricing_tier.unit_price * new_nights,
            })

    candidates.sort(
        key=lambda c: abs((c['check_in'] - check_in).days) + abs(c['nights'] - original_nights)
    )
    return candidates[:max_results]
