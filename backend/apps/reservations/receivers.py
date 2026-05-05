from django.db.models.signals import post_save
from django.dispatch import receiver
from .models import Booking


def on_invoice_paid(sender, invoice, **kwargs):
    if invoice.source_type == 'berth_booking' and invoice.source_id:
        Booking.objects.filter(pk=invoice.source_id).update(status='confirmed')


@receiver(post_save, sender=Booking, dispatch_uid='reservations.on_booking_save')
def on_booking_save(sender, instance, **kwargs):
    """
    When a booking is released (checked_out or cancelled) and has a berth,
    run the smart allocator to re-evaluate that berth's channel assignment.
    Only fires when the status field was actually updated.
    """
    update_fields = kwargs.get('update_fields')
    if update_fields is not None and 'status' not in update_fields:
        return
    if instance.status not in ('checked_out', 'cancelled'):
        return
    if not instance.berth_id:
        return
    marina = instance.marina
    if not marina.auto_allocate_inventory:
        return
    from apps.berths.allocator import run_smart_allocator
    instance.berth.refresh_from_db(fields=['sales_channel', 'status'])
    run_smart_allocator(marina, instance.berth)
