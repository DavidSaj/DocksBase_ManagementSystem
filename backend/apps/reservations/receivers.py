from django.db.models.signals import post_save
from django.dispatch import receiver
from .models import Booking


def on_invoice_paid(sender, invoice, **kwargs):
    # Single source of truth for Booking.paid: flip on linked-invoice payment.
    # Supports both the legacy source_type='berth_booking' linkage and the
    # direct Invoice.booking FK.
    booking_ids = set()
    if invoice.source_type == 'berth_booking' and invoice.source_id:
        try:
            booking_ids.add(int(invoice.source_id))
        except (TypeError, ValueError):
            pass
    if getattr(invoice, 'booking_id', None):
        booking_ids.add(invoice.booking_id)
    if not booking_ids:
        return
    Booking.objects.filter(pk__in=booking_ids).update(
        status='confirmed', paid=True,
    )


@receiver(post_save, sender=Booking, dispatch_uid='reservations.on_booking_save')
def on_booking_save(sender, instance, **kwargs):
    update_fields = kwargs.get('update_fields')
    if update_fields is not None and 'status' not in update_fields:
        return
    if instance.status not in ('checked_out', 'cancelled'):
        return
    if not instance.berth_id:
        return
    marina = instance.marina
    from apps.berths.models import OTAConnection
    if not OTAConnection.objects.filter(marina=marina).exists():
        return
    from apps.berths.allocator import run_smart_allocator
    instance.berth.refresh_from_db(fields=['ota_connection', 'status', 'channel_locked'])
    run_smart_allocator(marina, instance.berth)
