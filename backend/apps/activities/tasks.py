from celery import shared_task
from django.utils import timezone


@shared_task
def sweep_expired_direct_bookings():
    """
    Runs every 5 minutes. Cancels expired direct-payment bookings whose draft invoices
    were never confirmed (e.g., walk-up customer walked away mid-payment).

    For each expired booking:
      1. Deletes AssetReservation rows, releasing the equipment.
      2. Voids the draft invoice.
      3. Marks booking as cancelled with reason.

    A booking expires when: payment_mode='direct', status='confirmed',
    invoice.status='draft', and expires_at < now().
    """
    from apps.activities.models import ActivityBooking

    expired = ActivityBooking.objects.filter(
        status=ActivityBooking.Status.CONFIRMED,
        payment_mode=ActivityBooking.PaymentMode.DIRECT,
        invoice__status='draft',
        expires_at__lt=timezone.now(),
    ).select_related('invoice')

    cancelled_count = 0
    for booking in expired:
        booking.asset_reservations.all().delete()
        if booking.invoice:
            booking.invoice.status = 'void'
            booking.invoice.save(update_fields=['status'])
        booking.status = ActivityBooking.Status.CANCELLED
        booking.cancellation_reason = 'Expired — direct payment not completed within 15 minutes.'
        booking.cancelled_at = timezone.now()
        booking.save(update_fields=['status', 'cancellation_reason', 'cancelled_at'])
        cancelled_count += 1

    return f'Swept {cancelled_count} expired direct-payment bookings.'
