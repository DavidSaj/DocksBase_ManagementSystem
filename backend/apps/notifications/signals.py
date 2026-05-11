"""
Signal handlers for action-triggered notifications.

Registered via:
  - apps.notifications.apps.NotificationsConfig.ready()
  - apps.reservations.apps.ReservationsConfig.ready()
  - apps.maintenance.apps.MaintenanceConfig.ready()

Signals only enqueue a Celery task via transaction.on_commit().
The Celery worker handles all notify() calls, keeping the HTTP
request thread free of Redis latency.
"""

from django.db import transaction
from django.db.models.signals import pre_save, post_save
from django.dispatch import receiver


# ---------------------------------------------------------------------------
# BookingRequest → notify marina managers/admins/owners on new request
# ---------------------------------------------------------------------------

@receiver(post_save, sender='reservations.BookingRequest')
def on_booking_request_created(sender, instance, created, **kwargs):
    if not created:
        return
    from apps.notifications.tasks import dispatch_booking_request
    transaction.on_commit(lambda: dispatch_booking_request.delay(instance.pk))


# ---------------------------------------------------------------------------
# maintenance.Task → notify when assigned_to goes from blank → non-blank
# ---------------------------------------------------------------------------

@receiver(pre_save, sender='maintenance.Task')
def cache_old_assigned_to(sender, instance, **kwargs):
    """Snapshot the current DB value of assigned_to before the save."""
    if instance.pk:
        try:
            instance._old_assigned_to = sender.objects.get(pk=instance.pk).assigned_to
        except sender.DoesNotExist:
            instance._old_assigned_to = ''
    else:
        instance._old_assigned_to = ''


@receiver(post_save, sender='maintenance.Task')
def on_maintenance_task_assigned(sender, instance, created, **kwargs):
    """Fire when assigned_to changes from blank to non-blank on an existing task."""
    old = getattr(instance, '_old_assigned_to', '')
    if created or not instance.assigned_to or old:
        return
    from apps.notifications.tasks import dispatch_maintenance_assigned
    transaction.on_commit(lambda: dispatch_maintenance_assigned.delay(instance.pk))
