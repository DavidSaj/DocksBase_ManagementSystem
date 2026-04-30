from .models import Booking


def on_invoice_paid(sender, invoice, **kwargs):
    if invoice.source_type == 'berth_booking' and invoice.source_id:
        Booking.objects.filter(pk=invoice.source_id).update(status='confirmed')
