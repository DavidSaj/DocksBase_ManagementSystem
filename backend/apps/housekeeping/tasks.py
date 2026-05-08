from celery import shared_task


@shared_task
def generate_recurring_housekeeping_tasks():
    """
    Daily task. Creates mid-stay recurring housekeeping tasks for active bookings
    whose recurrence interval has elapsed. Self-contained — does not import from charter.

    Finds all CLEAN tasks with a recurrence_interval_days set. If the next due date
    (completed_at + interval) is now or in the past, creates a new DIRTY task.
    """
    from datetime import timedelta

    from django.utils import timezone

    from apps.housekeeping.models import HousekeepingTask

    recurring = HousekeepingTask.objects.filter(
        recurrence_interval_days__isnull=False,
        status=HousekeepingTask.Status.CLEAN,
        completed_at__isnull=False,
    )

    created_count = 0
    for task in recurring:
        next_due = task.completed_at + timedelta(days=task.recurrence_interval_days)
        if next_due <= timezone.now():
            HousekeepingTask.objects.create(
                marina=task.marina,
                source_type=HousekeepingTask.SourceType.MID_STAY_RECURRING,
                source_id=task.source_id,
                unit_type=task.unit_type,
                unit_id=task.unit_id,
                unit_label=task.unit_label,
                status=HousekeepingTask.Status.DIRTY,
                recurrence_interval_days=task.recurrence_interval_days,
            )
            created_count += 1

    return f'Generated {created_count} recurring housekeeping tasks.'
