from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.charter.models import CharterBooking


@receiver(post_save, sender=CharterBooking)
def recompute_commission_on_subtotal_change(sender, instance, created, **kwargs):
    """
    When a CharterBooking's subtotal changes, recompute all pending agent commissions.
    If any commission is already approved/paid, alert staff so they can review.
    Also triggers calculate_commission when status transitions to 'confirmed'.
    """
    if created:
        if instance.status == CharterBooking.Status.CONFIRMED:
            from apps.charter.services import calculate_commission
            transaction.on_commit(lambda: calculate_commission(instance.pk))
        return

    subtotal_changed = instance.tracker.has_changed('subtotal')
    status_changed   = instance.tracker.has_changed('status')

    if subtotal_changed:
        def _recalc():
            pending = instance.agent_commissions.filter(payment_status='pending')
            for commission in pending:
                commission.commission_amount = instance.subtotal * (commission.commission_rate / 100)
                commission.save(update_fields=['commission_amount'])

            already_approved = instance.agent_commissions.filter(payment_status__in=['approved', 'paid'])
            if already_approved.exists():
                try:
                    from apps.accounts.utils import send_staff_alert
                    send_staff_alert(
                        marina_id=instance.marina_id,
                        subject=(
                            f'Commission already approved — Charter #{instance.pk} subtotal changed'
                        ),
                    )
                except (ImportError, AttributeError):
                    pass

        transaction.on_commit(_recalc)

    if status_changed and instance.status == CharterBooking.Status.CONFIRMED:
        from apps.charter.services import calculate_commission
        transaction.on_commit(lambda: calculate_commission(instance.pk))

    if (
        status_changed
        and instance.status == CharterBooking.Status.COMPLETED
        and instance.tracker.previous('status') != CharterBooking.Status.COMPLETED
    ):
        try:
            from apps.housekeeping.services import create_checkout_task
            transaction.on_commit(lambda: create_checkout_task(booking=instance))
        except ImportError:
            pass
