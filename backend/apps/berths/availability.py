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
