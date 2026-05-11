"""
Cancellation service for activity bookings.

cancel_activity_booking() is the single entry point for cancelling a booking.
It atomically: computes the refund, marks the booking cancelled, and releases asset reservations.
"""
from django.db import transaction
from django.utils import timezone

from apps.activities.models import ActivityBooking
from apps.activities.services.billing import compute_cancellation_refund


def cancel_activity_booking(booking, reason=''):
    """
    Cancel an ActivityBooking, applying the cancellation policy's refund tiers.

    Atomically:
      1. Computes the refund amount based on hours until activity start.
      2. Updates booking status to CANCELLED with timestamp and reason.
      3. Deletes all AssetReservation rows, releasing the equipment.

    Returns a dict with {'refund_amount': str}.
    Does NOT process the refund payment — that must be handled manually or via a payment service.
    """
    with transaction.atomic():
        refund_amount = compute_cancellation_refund(booking)

        booking.status              = ActivityBooking.Status.CANCELLED
        booking.cancelled_at        = timezone.now()
        booking.cancellation_reason = reason
        booking.refund_amount       = refund_amount
        booking.save(update_fields=['status', 'cancelled_at', 'cancellation_reason', 'refund_amount'])

        # Release all asset reservations so the equipment can be re-booked
        booking.asset_reservations.all().delete()

    return {'refund_amount': str(refund_amount)}
