"""
Signal receivers that auto-create VesselMovement records when a Booking
transitions to 'checked_in' or 'checked_out'.

We store the pre-save status in pre_save so that post_save can detect
the transition direction without an extra database hit.

All VesselMovement.objects.create() calls are wrapped in transaction.on_commit()
so the FK rows are guaranteed to be committed before the movement is written.
"""
from django.db import transaction
from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver
from django.utils import timezone


@receiver(pre_save, sender='reservations.Booking')
def capture_pre_save_status(sender, instance, **kwargs):
    """Store the current DB status so post_save can detect transitions."""
    if instance.pk:
        try:
            instance._pre_status = sender.objects.get(pk=instance.pk).status
        except sender.DoesNotExist:
            instance._pre_status = None
    else:
        instance._pre_status = None


@receiver(post_save, sender='reservations.Booking')
def auto_create_movement_on_status_change(sender, instance, created, **kwargs):
    old = getattr(instance, '_pre_status', None)
    new = instance.status

    if old == new:
        return

    if new == 'checked_in' and old != 'checked_in':
        def _create():
            from apps.movements.models import VesselMovement
            VesselMovement.objects.create(
                marina=instance.marina,
                vessel=instance.vessel,
                movement_type='arrival',
                berth_to=instance.berth,
                booking=instance,
                actual_at=timezone.now(),
                completed=True,
            )
        transaction.on_commit(_create)

    elif new == 'checked_out' and old != 'checked_out':
        def _create():
            from apps.movements.models import VesselMovement
            VesselMovement.objects.create(
                marina=instance.marina,
                vessel=instance.vessel,
                movement_type='departure',
                berth_from=instance.berth,
                booking=instance,
                actual_at=timezone.now(),
                completed=True,
            )
        transaction.on_commit(_create)
