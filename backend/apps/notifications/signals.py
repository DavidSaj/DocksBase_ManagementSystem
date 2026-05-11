"""
Signal handlers for action-required notifications.

Registered via:
  - apps.notifications.apps.NotificationsConfig.ready()
  - apps.reservations.apps.ReservationsConfig.ready()
  - apps.maintenance.apps.MaintenanceConfig.ready()
"""

from django.db.models.signals import pre_save, post_save
from django.dispatch import receiver


# ---------------------------------------------------------------------------
# BookingRequest → notify marina managers/admins/owners on new request
# ---------------------------------------------------------------------------

@receiver(post_save, sender='reservations.BookingRequest')
def on_booking_request_created(sender, instance, created, **kwargs):
    if not created:
        return
    from apps.accounts.models import User
    from apps.notifications.utils import notify

    recipients = User.objects.filter(
        marina=instance.marina, role__in=['manager', 'admin', 'owner']
    )
    vessel_label = (
        instance.vessel.name if instance.vessel else instance.guest_name or 'Unknown'
    )
    booking_type = (
        instance.get_booking_type_display()
        if hasattr(instance, 'get_booking_type_display')
        else ''
    )
    for user in recipients:
        notify(
            marina=instance.marina,
            recipient=user,
            kind='booking_request',
            title='New booking request',
            body=f'{vessel_label} · {booking_type}',
            link_screen='reservations',
            link_id=instance.pk,
        )


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

    from apps.accounts.models import User
    from apps.notifications.utils import notify

    recipients = User.objects.filter(
        marina=instance.marina, role__in=['manager', 'admin', 'owner']
    )
    for user in recipients:
        notify(
            marina=instance.marina,
            recipient=user,
            kind='maintenance_assigned',
            title='Maintenance task assigned',
            body=f'{instance.assigned_to} · {instance.text[:80]}',
            link_screen='maintenance',
            link_id=instance.pk,
        )
