from django.db.models.signals import post_save
from django.dispatch import receiver
from .models import Booking


def on_invoice_paid(sender, invoice, **kwargs):
    if invoice.source_type == 'berth_booking' and invoice.source_id:
        Booking.objects.filter(pk=invoice.source_id).update(status='confirmed')


@receiver(post_save, sender=Booking, dispatch_uid='reservations.on_booking_save')
def on_booking_save(sender, instance, **kwargs):
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
