"""
Berth availability service — lower-level helpers used by SmartBerthScorer
and the booking engine.

For full smart ranking use SmartBerthScorer in scorer.py.
This module provides standalone date-range overlap queries.
"""
import datetime

from django.db.models import Q

CONFLICTING_STATUSES = ('awaiting_payment', 'confirmed', 'checked_in', 'pending_payment')


def get_conflicting_booking_ids(marina, check_in: datetime.date, check_out: datetime.date):
    """
    Return a queryset of berth IDs that have at least one confirmed/active booking
    overlapping the [check_in, check_out) half-open interval.

    Overlap condition (half-open intervals):
        existing.check_in  < requested.check_out
        existing.check_out > requested.check_in
    """
    from apps.reservations.models import Booking

    return (
        Booking.objects.filter(
            marina=marina,
            status__in=CONFLICTING_STATUSES,
            check_in__lt=check_out,
            check_out__gt=check_in,
        )
        .exclude(berth__isnull=True)
        .values_list('berth_id', flat=True)
    )


def get_available_berths_queryset(marina, check_in: datetime.date, check_out: datetime.date,
                                   loa=None, beam=None, draft=None):
    """
    Return a Berth queryset that is physically available for the window.
    Applies optional dimension filters (hard exclusions only — no scoring).

    Does NOT include sublet gaps — use SmartBerthScorer.get_available_berths() for that.
    """
    from .models import Berth

    conflicting = get_conflicting_booking_ids(marina, check_in, check_out)

    qs = Berth.objects.filter(
        marina=marina,
        berth_class='standard',
    ).exclude(
        status='maintenance',
    ).exclude(
        id__in=conflicting,
    )

    if loa is not None:
        qs = qs.filter(length_m__gte=loa)
    if beam is not None:
        qs = qs.filter(max_beam_m__gte=beam)
    if draft is not None:
        qs = qs.filter(max_draft_m__gte=draft)

    return qs


def berth_is_available(berth, check_in: datetime.date, check_out: datetime.date) -> bool:
    """
    Point check: is a specific berth free for the given window?
    Does NOT check against TemporaryDeparture windows.
    """
    from apps.reservations.models import Booking

    return not Booking.objects.filter(
        berth=berth,
        status__in=CONFLICTING_STATUSES,
        check_in__lt=check_out,
        check_out__gt=check_in,
    ).exists()


def berth_lease_inventory_filter(qs, check_in: datetime.date, check_out: datetime.date):
    """Exclude berths held by an active seasonal lease, except those whose
    holder has opened a sublet window that fully contains the requested
    [check_in, check_out) interval.

    Spec: ``2026-05-17-seasonal-berths-design.md`` §4.2. This filter is the
    single source of truth for "is a leased berth available for transient
    booking?" and is called by both the legacy allocator
    (``compatible_available_berths``) and the smart scorer
    (``SmartBerthScorer.get_available_berths``) so the two cannot drift.

    Predicate (per spec):
        available IF
            no active lease overlaps [ci, co)
          OR
            active lease overlaps AND a sublet-enabled TemporaryDeparture
            (status in {scheduled, active}, depart_date <= ci, expected_return >= co)
            fully contains [ci, co)

    Notes
    -----
    * "Active lease" means ``BerthLease.status`` in
      ``apps.seasons.models.LEASE_LIVE_STATUSES`` — i.e. anything not
      ``ended``/``renewed``/``cancelled``/``defaulted``. The lease window is
      ``[start_date, end_date]`` inclusive on both ends; the request window
      is ``[ci, co)`` half-open, matching the Tetris convention.
    * Half-open overlap with the inclusive lease window:
      ``lease.start_date < co AND lease.end_date >= ci``.
    """
    # Late imports avoid app-loading order issues and keep `apps.berths` free
    # of a hard dependency on `apps.seasons` at module import time.
    from apps.berths.models import TemporaryDeparture
    from apps.seasons.models import BerthLease, LEASE_LIVE_STATUSES

    leased_berth_ids = set(
        BerthLease.objects.filter(
            status__in=LEASE_LIVE_STATUSES,
            start_date__lt=check_out,
            end_date__gte=check_in,
        ).values_list('berth_id', flat=True)
    )
    if not leased_berth_ids:
        return qs

    sublet_open_berth_ids = set(
        TemporaryDeparture.objects.filter(
            berth_id__in=leased_berth_ids,
            sublet_enabled=True,
            status__in=('scheduled', 'active'),
            depart_date__lte=check_in,
            expected_return__gte=check_out,
        ).values_list('berth_id', flat=True)
    )

    blocked = leased_berth_ids - sublet_open_berth_ids
    if not blocked:
        return qs
    return qs.exclude(id__in=blocked)
