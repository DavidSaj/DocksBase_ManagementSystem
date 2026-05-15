"""
Status-transition services for ActivityBooking.

confirm_requested_booking() — validates capacity (CONFIRMED-only), attaches assets/invoice,
    transitions REQUESTED → CONFIRMED. Atomic with select_for_update on the Activity row.

reject_requested_booking() — transitions REQUESTED → CANCELLED with reason + cancelled_at.
"""
from django.db import transaction
from django.db.models import Sum
from django.utils import timezone as djtz

from ..models import Activity, ActivityBooking


class CapacityExceeded(Exception):
    def __init__(self, remaining: int):
        self.remaining = remaining
        super().__init__(f'Only {remaining} seats remaining in this slot.')


def _confirmed_seats(activity_id, start_dt):
    agg = ActivityBooking.objects.filter(
        activity_id=activity_id, start_datetime=start_dt,
        status=ActivityBooking.Status.CONFIRMED,
    ).aggregate(total=Sum('participant_count'))
    return agg['total'] or 0


@transaction.atomic
def confirm_requested_booking(booking: ActivityBooking) -> ActivityBooking:
    if booking.status != ActivityBooking.Status.REQUESTED:
        raise ValueError(f'Booking #{booking.pk} is not in REQUESTED status.')

    activity = Activity.objects.select_for_update().get(pk=booking.activity_id)
    already = _confirmed_seats(activity.pk, booking.start_datetime)
    remaining = activity.capacity_max - already
    if booking.participant_count > remaining:
        raise CapacityExceeded(max(remaining, 0))

    from .booking import attach_assets_and_invoice
    attach_assets_and_invoice(booking)

    booking.status = ActivityBooking.Status.CONFIRMED
    booking.save(update_fields=['status'])
    return booking


@transaction.atomic
def reject_requested_booking(booking: ActivityBooking, reason: str = '') -> ActivityBooking:
    if booking.status != ActivityBooking.Status.REQUESTED:
        raise ValueError(f'Booking #{booking.pk} is not in REQUESTED status.')
    booking.status = ActivityBooking.Status.CANCELLED
    booking.cancellation_reason = reason or 'rejected_by_marina'
    booking.cancelled_at = djtz.now()
    booking.save(update_fields=['status', 'cancellation_reason', 'cancelled_at'])
    return booking
