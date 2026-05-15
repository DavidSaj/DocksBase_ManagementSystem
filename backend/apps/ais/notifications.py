"""
AIS Phase 2 notification dispatch.

In-app notifications go through apps.notifications.utils.notify.
SMS goes through the existing apps.fuel_dock.notifications.notify_sms stub.
SMS is throttled to one per (booking, kind) via AISNotificationSent.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.ais.models import AISNotificationSent
from apps.fuel_dock.notifications import notify_sms
from apps.notifications.utils import notify
from apps.staff.models import Shift

logger = logging.getLogger(__name__)

_WEEKDAY = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']


def on_duty_harbourmaster(marina):
    """Return the StaffMember on shift today whose role contains 'harbour'."""
    now = timezone.now()
    day = _WEEKDAY[now.weekday()]
    week_start = now.date() - timedelta(days=now.weekday())
    shift = (
        Shift.objects
        .filter(
            marina=marina,
            week_start=week_start,
            day=day,
            is_off=False,
            staff_member__role__icontains='harbour',
        )
        .exclude(staff_member__phone='')
        .select_related('staff_member')
        .first()
    )
    return shift.staff_member if shift else None


def _send_sms_once(booking, kind: str, message: str):
    hm = on_duty_harbourmaster(booking.marina)
    if hm is None:
        logger.warning(
            'ais.sms.no_recipient marina=%s booking=%s kind=%s',
            booking.marina_id, booking.id, kind,
        )
        return
    try:
        with transaction.atomic():
            AISNotificationSent.objects.create(booking=booking, kind=kind)
    except IntegrityError:
        return  # already sent
    notify_sms(hm.phone, message)


def notify_auto_checkin(booking, *, recipient):
    vessel = booking.vessel.name if booking.vessel else (booking.vessel_name or 'Vessel')
    guest = booking.guest_name or 'Guest'
    berth_code = booking.berth.code if booking.berth_id else '—'
    when = timezone.localtime().strftime('%H:%M')
    title = f'Auto check-in: {vessel}'
    body = f'{vessel} ({guest}) arrived at {when}. Berth {berth_code}.'
    notify(
        marina=booking.marina, recipient=recipient,
        kind='ais_auto_checkin', title=title, body=body,
        link_screen='bookings', link_id=booking.id,
    )
    _send_sms_once(booking, 'ais_auto_checkin', body)


def notify_auto_checkout(booking, *, recipient):
    vessel = booking.vessel.name if booking.vessel else (booking.vessel_name or 'Vessel')
    when = timezone.localtime().strftime('%H:%M')
    title = f'Auto check-out: {vessel}'
    body = f'{vessel} departed at {when}. Turnaround triggered.'
    notify(
        marina=booking.marina, recipient=recipient,
        kind='ais_auto_checkout', title=title, body=body,
        link_screen='bookings', link_id=booking.id,
    )
    _send_sms_once(booking, 'ais_auto_checkout', body)


def notify_no_show(booking, *, recipient):
    vessel = booking.vessel.name if booking.vessel else (booking.vessel_name or 'Vessel')
    guest = booking.guest_name or 'Guest'
    eta_label = booking.eta.strftime('%H:%M') if booking.eta else '18:00'
    title = f'Possible no-show: {vessel}'
    body = f'{vessel} ({guest}) expected by {eta_label} — no AIS contact.'
    notify(
        marina=booking.marina, recipient=recipient,
        kind='ais_no_show_predicted', title=title, body=body,
        link_screen='bookings', link_id=booking.id,
    )
    # No SMS for no-shows — too low urgency.
