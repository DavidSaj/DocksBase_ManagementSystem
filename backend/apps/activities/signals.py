"""
Signal handlers for the activities app.

on_shift_modified: clears instructor assignments when a shift is deleted or changed.
on_participant_count_changed: triggers invoice recalculation when participants are added/removed.

IMPORTANT: The Shift signals are registered in ActivitiesConfig.ready() explicitly
(not via @receiver) to avoid import ordering issues at app startup.
The ActivityBookingParticipant signals use @receiver because that model is local.
"""
from datetime import timedelta

from django.db.models.signals import post_delete, post_save
from django.dispatch import receiver


# Maps Shift.day abbreviations to weekday() offset from week_start (Monday = 0)
_DAY_TO_OFFSET = {
    'mon': 0, 'tue': 1, 'wed': 2,
    'thu': 3, 'fri': 4, 'sat': 5, 'sun': 6,
}


def on_shift_modified(sender, instance, **kwargs):
    """
    When a Shift is deleted or its times change, find every ActivityBooking whose
    assigned_instructor overlaps the now-missing/changed shift window.
    Clear the instructor assignment and fire a high-priority alert.

    Uses proper datetime overlap (start_datetime__lt=shift_end, end_datetime__gt=shift_start)
    — NOT date-only comparison, which would miss cross-midnight bookings.
    """
    from datetime import date, datetime

    import pytz

    from apps.activities.models import ActivityBooking

    day_offset = _DAY_TO_OFFSET.get(instance.day, -1)
    if day_offset < 0:
        return

    week_start = instance.week_start
    if not isinstance(week_start, date):
        week_start = date.fromisoformat(str(week_start))
    shift_date = week_start + timedelta(days=day_offset)

    # Can't build datetimes without start/end times (off-day shifts have null times)
    if instance.start_time is None or instance.end_time is None:
        return

    shift_start = datetime.combine(shift_date, instance.start_time, tzinfo=pytz.utc)
    shift_end   = datetime.combine(shift_date, instance.end_time,   tzinfo=pytz.utc)

    affected = ActivityBooking.objects.filter(
        assigned_instructor=instance.staff_member,
        status=ActivityBooking.Status.CONFIRMED,
        start_datetime__lt=shift_end,   # booking starts before shift ends
        end_datetime__gt=shift_start,   # booking ends after shift starts
    ).select_related('activity')

    if not affected.exists():
        return

    affected_list = list(affected)
    for booking in affected_list:
        booking.assigned_instructor = None
        booking.save(update_fields=['assigned_instructor'])

    activity_names = ', '.join(
        f"'{b.activity.name}' at {b.start_datetime:%H:%M on %d %b}" for b in affected_list
    )
    try:
        from apps.communications.services.alert import send_alert
        send_alert(
            marina_id=instance.staff_member.marina_id,
            alert_type='instructor_conflict',
            priority='high',
            subject='Action Required: Activity instructor removed due to shift change',
            body=(
                f'The shift for {instance.staff_member.name} on {shift_date} was modified or '
                f'deleted. The following activities now have no assigned instructor: '
                f'{activity_names}. Please assign a replacement instructor immediately.'
            ),
        )
    except Exception:
        pass  # send_alert must not block instructor assignment clearance


@receiver(post_save, sender='activities.ActivityBooking')
def _notify_managers_on_request(sender, instance, created, **kwargs):
    """
    When a public submission creates a REQUESTED ActivityBooking, notify the
    marina's managers. Manager-side CONFIRMED bookings do not trigger this.
    """
    if not created:
        return
    from .models import ActivityBooking
    if instance.status != ActivityBooking.Status.REQUESTED:
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
            kind='activity_request',
            title='New activity request',
            body=f'{instance.activity.name} · {instance.lead_name or "Guest"}',
            link_screen='activities',
            link_id=instance.pk,
        )


@receiver(post_save, sender='activities.ActivityBookingParticipant')
@receiver(post_delete, sender='activities.ActivityBookingParticipant')
def on_participant_count_changed(sender, instance, **kwargs):
    """
    Recalculate invoice line items whenever the participant list changes.
    Ensures group discount eligibility is re-evaluated dynamically.
    Skips recalculation if the booking has no invoice yet (during atomic creation).
    """
    from apps.activities.models import ActivityBooking
    from apps.activities.services.billing import recalculate_activity_invoice

    booking = instance.booking
    if booking.status == ActivityBooking.Status.CONFIRMED and booking.invoice_id:
        recalculate_activity_invoice(booking)
