from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.reservations.models import Booking


@receiver(post_save, sender=Booking)
def on_booking_cancelled(sender, instance, **kwargs):
    """Trigger waitlist sniper when a booking is cancelled, after commit."""
    if instance.status != 'cancelled':
        return

    freed_from = instance.check_in
    freed_to = instance.check_out
    marina_id = instance.marina_id
    berth_id = instance.berth_id

    if not berth_id:
        return

    def _run():
        from apps.revenue.engine import run_waitlist_sniper
        run_waitlist_sniper(
            marina_id=marina_id,
            berth_id=berth_id,
            freed_from=freed_from,
            freed_to=freed_to,
        )

    transaction.on_commit(_run)
