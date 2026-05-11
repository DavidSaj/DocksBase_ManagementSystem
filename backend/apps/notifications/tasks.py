import logging
from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(bind=True, name='notifications.dispatch_booking_request')
def dispatch_booking_request(self, booking_request_id):
    from apps.reservations.models import BookingRequest
    from apps.accounts.models import User
    from apps.notifications.utils import notify
    try:
        instance = BookingRequest.objects.select_related('marina', 'vessel').get(pk=booking_request_id)
    except BookingRequest.DoesNotExist:
        logger.warning('dispatch_booking_request: BookingRequest %s not found', booking_request_id)
        return

    vessel_label = instance.vessel.name if instance.vessel else instance.guest_name or 'Unknown'
    booking_type = instance.get_booking_type_display()
    recipients = list(User.objects.filter(
        marina=instance.marina, role__in=['manager', 'admin', 'owner']
    ))
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
    logger.info('dispatch_booking_request: notified %d users for BookingRequest %s', len(recipients), booking_request_id)


@shared_task(bind=True, name='notifications.dispatch_maintenance_assigned')
def dispatch_maintenance_assigned(self, task_id):
    from apps.maintenance.models import Task as MaintenanceTask
    from apps.accounts.models import User
    from apps.notifications.utils import notify
    try:
        instance = MaintenanceTask.objects.select_related('marina').get(pk=task_id)
    except MaintenanceTask.DoesNotExist:
        logger.warning('dispatch_maintenance_assigned: Task %s not found', task_id)
        return

    if not instance.assigned_to:
        return

    recipients = list(User.objects.filter(
        marina=instance.marina, role__in=['manager', 'admin', 'owner']
    ))
    text_preview = (instance.text or '')[:80]
    for user in recipients:
        notify(
            marina=instance.marina,
            recipient=user,
            kind='maintenance_assigned',
            title='Maintenance task assigned',
            body=f'{instance.assigned_to} · {text_preview}',
            link_screen='maintenance',
            link_id=instance.pk,
        )
    logger.info('dispatch_maintenance_assigned: notified %d users for Task %s', len(recipients), task_id)
