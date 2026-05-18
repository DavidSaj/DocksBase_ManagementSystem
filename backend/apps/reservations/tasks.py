"""
apps/reservations/tasks.py

Celery tasks for the reservations module.

Beat schedule entries (in config/settings/base.py CELERY_BEAT_SCHEDULE):
  'send-overstay-alerts':     daily at 08:00 UTC
  'send-prearival-reminders': daily at 10:00 UTC
"""

import logging
from datetime import timedelta

from celery import shared_task
from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Task 1: send_overstay_alerts  (daily, 08:00 UTC)
# ---------------------------------------------------------------------------

@shared_task(bind=True, name='reservations.send_overstay_alerts')
def send_overstay_alerts(self):
    """
    Daily digest: for each marina, email owner/manager users a list of bookings
    where check_out has passed but the booking is still confirmed or checked_in.

    Idempotent — no state is mutated; safe to run multiple times per day.
    """
    from apps.reservations.models import Booking
    from apps.accounts.models import User

    today = timezone.now().date()

    overstays = (
        Booking.objects
        .filter(status__in=['confirmed', 'checked_in'], check_out__lt=today)
        .select_related('marina', 'berth', 'vessel')
        .order_by('marina_id', 'check_out')
    )

    # Mutate status to 'overstay' before emailing, so the database reflects reality.
    overstay_ids = list(overstays.values_list('pk', flat=True))
    if not overstay_ids:
        logger.info('send_overstay_alerts: no overstays detected for %s', today)
        return
    Booking.objects.filter(pk__in=overstay_ids, status='checked_in').update(status='overstay')
    logger.info('send_overstay_alerts: marked %d checked_in bookings as overstay', len(overstay_ids))

    overstays = (
        Booking.objects
        .filter(pk__in=overstay_ids)
        .select_related('marina', 'berth', 'vessel')
        .order_by('marina_id', 'check_out')
    )

    if not overstays.exists():
        logger.info('send_overstay_alerts: no overstays detected for %s', today)
        return

    # Group by marina
    by_marina: dict = {}
    for booking in overstays:
        by_marina.setdefault(booking.marina_id, {'marina': booking.marina, 'bookings': []})
        by_marina[booking.marina_id]['bookings'].append(booking)

    from apps.accounts.notifications import rule_enabled

    for marina_id, data in by_marina.items():
        marina = data['marina']
        bookings = data['bookings']

        if not rule_enabled(marina, 'booking_overstay_alert', 'email'):
            logger.info('send_overstay_alerts: rule disabled for marina %s, skipping', marina)
            continue

        recipients = list(
            User.objects.filter(marina=marina, role__in=['owner', 'manager'])
            .values_list('email', flat=True)
        )
        if not recipients:
            logger.info(
                'send_overstay_alerts: no owner/manager users for marina %s, skipping',
                marina,
            )
            continue

        count = len(bookings)

        # Build plain-text table
        rows = []
        rows.append(
            f"{'BK #':<10} {'Vessel':<25} {'Berth':<10} "
            f"{'Check-out':<12} {'Days Overdue':>12}"
        )
        rows.append('-' * 73)
        for bk in bookings:
            days_over = (today - bk.check_out).days
            vessel_label = (
                bk.vessel.name if bk.vessel else bk.vessel_name or '—'
            )
            berth_code = bk.berth.code if bk.berth else '—'
            rows.append(
                f"BK-{bk.pk:<7} {vessel_label:<25} {berth_code:<10} "
                f"{bk.check_out!s:<12} {days_over:>12}"
            )

        table = '\n'.join(rows)

        body = (
            f"Overstay Alert — {marina.name}\n"
            f"Date: {today}\n\n"
            f"{count} vessel{'s' if count != 1 else ''} may be overstaying at {marina.name}. "
            f"{'Their' if count != 1 else 'Its'} scheduled departure date has passed "
            f"but {'they have' if count != 1 else 'it has'} not been checked out.\n\n"
            f"{table}\n\n"
            f"Review in DocksBase: {getattr(settings, 'FRONTEND_URL', '')}/reservations\n\n"
            f"— DocksBase"
        )

        try:
            send_mail(
                subject=f"{count} possible overstay{'s' if count != 1 else ''} — {marina.name}",
                message=body,
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=recipients,
                fail_silently=False,
            )
            logger.info(
                'send_overstay_alerts: sent digest for marina %s (%d vessels) to %s',
                marina, count, recipients,
            )
        except Exception as exc:
            logger.exception(
                'send_overstay_alerts: failed to send for marina %s: %s',
                marina, exc,
            )


# ---------------------------------------------------------------------------
# Task 2: send_prearival_reminders  (daily, 10:00 UTC)
# ---------------------------------------------------------------------------

@shared_task(bind=True, name='reservations.send_prearival_reminders')
def send_prearival_reminders(self):
    """
    Daily: send a pre-arrival HTML reminder to each guest whose booking
    check_in is tomorrow and whose status is 'confirmed'.

    Skips bookings with no guest_email.
    Idempotent — repeated runs on the same day send the same email again,
    which is acceptable for a reminder (no sent_at flag on Booking model).
    """
    from apps.reservations.models import Booking
    from apps.accounts.emails import _base, _h1, _p, _btn, _divider, _small, _NAVY, _MUTED, _TEXT
    from apps.portal.checkin_utils import make_magic_url

    today = timezone.now().date()
    tomorrow = today + timedelta(days=1)

    arrivals = (
        Booking.objects
        .filter(status='confirmed', check_in=tomorrow)
        .select_related('marina', 'berth', 'vessel')
    )

    if not arrivals.exists():
        logger.info('send_prearival_reminders: no confirmed arrivals for %s', tomorrow)
        return

    sent = 0
    skipped = 0

    from apps.accounts.notifications import rule_enabled

    for booking in arrivals:
        if not booking.guest_email:
            logger.debug(
                'send_prearival_reminders: skipping BK-%s — no guest_email', booking.pk
            )
            skipped += 1
            continue

        marina = booking.marina
        if not rule_enabled(marina, 'booking_arrival_reminder_24h', 'email'):
            skipped += 1
            continue
        guest = booking.guest_name or 'there'
        berth = booking.berth.code if booking.berth else '—'
        check_in_fmt = booking.check_in.strftime('%d %B %Y')
        check_out_fmt = booking.check_out.strftime('%d %B %Y')
        nights = booking.nights
        amount = f'€{booking.amount:.2f}' if booking.amount is not None else '—'
        vessel_row = f'<strong>Vessel:</strong> {booking.vessel_name}<br/>' if booking.vessel_name else ''
        eta_row = (
            f'<strong>ETA:</strong> {booking.eta.strftime("%H:%M")}<br/>'
            if booking.eta else ''
        )

        try:
            magic_url = make_magic_url(booking)
        except Exception as exc:
            logger.warning(
                'send_prearival_reminders: could not build magic URL for BK-%s: %s',
                booking.pk, exc,
            )
            magic_url = getattr(settings, 'PORTAL_BASE_URL', 'https://portal.docksbase.com')

        html = _base(
            preheader=f"Your stay at {marina.name} starts tomorrow — here's everything you need.",
            body_html=(
                _h1("Your stay starts tomorrow") +
                _p(f"Hi {guest},") +
                _p(
                    f"Just a reminder that your berth at <strong>{marina.name}</strong> "
                    f"is ready for you tomorrow, <strong>{check_in_fmt}</strong>."
                ) +
                f"""<table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 24px;border:1px solid rgba(0,0,0,0.08);border-radius:8px;overflow:hidden;">
  <tr style="background:#f8f8f8;"><td style="padding:10px 16px;font-size:12px;font-weight:600;color:{_MUTED};text-transform:uppercase;letter-spacing:0.5px;">Booking summary</td></tr>
  <tr><td style="padding:12px 16px;font-size:14px;color:{_TEXT};border-top:1px solid rgba(0,0,0,0.06);">
    <strong>Booking ID:</strong> BK-{booking.pk}<br/>
    <strong>Marina:</strong> {marina.name}<br/>
    <strong>Berth:</strong> {berth}<br/>
    {vessel_row}
    <strong>Arrival:</strong> {check_in_fmt}{(' at ' + booking.eta.strftime('%H:%M')) if booking.eta else ''}<br/>
    <strong>Departure:</strong> {check_out_fmt}<br/>
    <strong>Nights:</strong> {nights}<br/>
    <strong>Total:</strong> {amount}
  </td></tr>
</table>""" +
                _p(
                    "Use the button below to open your boarding pass, complete any outstanding "
                    "pre-arrival checks, and get directions to your berth."
                ) +
                _btn(magic_url, "Open Boarding Pass →") +
                _divider() +
                _small(
                    "This link is personal — please don't share it. "
                    "It expires after 72 hours but you can request a new one at any time."
                )
            ),
        )

        vessel_txt = f'Vessel: {booking.vessel_name}\n' if booking.vessel_name else ''
        eta_txt = f'ETA: {booking.eta.strftime("%H:%M")}\n' if booking.eta else ''

        try:
            send_mail(
                subject=f"Your stay at {marina.name} starts tomorrow",
                message=(
                    f"Hi {guest},\n\n"
                    f"Just a reminder that your berth at {marina.name} is ready for you "
                    f"tomorrow, {check_in_fmt}.\n\n"
                    f"Booking ID: BK-{booking.pk}\n"
                    f"Berth: {berth}\n"
                    f"{vessel_txt}"
                    f"Arrival: {check_in_fmt}"
                    f"{(' at ' + booking.eta.strftime('%H:%M')) if booking.eta else ''}\n"
                    f"Departure: {check_out_fmt}\n"
                    f"{eta_txt}"
                    f"Nights: {nights}\n"
                    f"Total: {amount}\n\n"
                    f"Open your boarding pass: {magic_url}\n\n"
                    "This link expires in 72 hours.\n\n"
                    f"— {marina.name}"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[booking.guest_email],
                html_message=html,
                fail_silently=False,
            )
            sent += 1
            logger.info(
                'send_prearival_reminders: reminder sent for BK-%s to %s',
                booking.pk, booking.guest_email,
            )
        except Exception as exc:
            logger.exception(
                'send_prearival_reminders: failed to send for BK-%s: %s',
                booking.pk, exc,
            )

    logger.info(
        'send_prearival_reminders: completed for %s — sent=%d skipped=%d',
        tomorrow, sent, skipped,
    )


# ---------------------------------------------------------------------------
# Task 3: send_departure_reminders  (daily, 09:00 UTC)
# ---------------------------------------------------------------------------

@shared_task(bind=True, name='reservations.send_departure_reminders')
def send_departure_reminders(self):
    """
    Daily: for each confirmed/checked-in booking whose check_out is tomorrow,
    email the guest a short reminder to settle up and depart on time.

    Idempotent — re-runs on the same day re-send the same email (no sent_at
    flag on Booking). Acceptable for a reminder.
    """
    from apps.reservations.models import Booking
    from apps.accounts.notifications import rule_enabled

    today = timezone.now().date()
    tomorrow = today + timedelta(days=1)

    departures = (
        Booking.objects
        .filter(status__in=['confirmed', 'checked_in'], check_out=tomorrow)
        .select_related('marina', 'berth', 'vessel')
    )

    if not departures.exists():
        logger.info('send_departure_reminders: no departures for %s', tomorrow)
        return

    sent = 0
    skipped = 0

    for booking in departures:
        if not booking.guest_email:
            skipped += 1
            continue
        marina = booking.marina
        if not rule_enabled(marina, 'booking_departure_reminder', 'email'):
            skipped += 1
            continue

        guest = booking.guest_name or 'there'
        check_out_fmt = booking.check_out.strftime('%d %B %Y')
        berth = booking.berth.code if booking.berth else '—'
        contact_parts = []
        if getattr(marina, 'contact_email', None):
            contact_parts.append(marina.contact_email)
        if getattr(marina, 'phone', None):
            contact_parts.append(marina.phone)
        contact_line = ' · '.join(contact_parts) if contact_parts else ''
        contact_txt = f'Questions? Contact the marina: {contact_line}\n\n' if contact_line else ''

        try:
            send_mail(
                subject=f"Reminder: your departure from {marina.name} is tomorrow",
                message=(
                    f"Hi {guest},\n\n"
                    f"Just a reminder that your stay at {marina.name} ends tomorrow, "
                    f"{check_out_fmt}.\n\n"
                    f"Booking ID: BK-{booking.pk}\n"
                    f"Berth: {berth}\n"
                    f"Departure date: {check_out_fmt}\n\n"
                    f"Please settle any outstanding charges at the office before you cast off "
                    f"and let the harbour master know once you're clear of the berth so we can "
                    f"release the slip.\n\n"
                    f"{contact_txt}"
                    f"Fair winds,\n"
                    f"— {marina.name}"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[booking.guest_email],
                fail_silently=False,
            )
            sent += 1
        except Exception as exc:
            logger.exception(
                'send_departure_reminders: failed to send for BK-%s: %s',
                booking.pk, exc,
            )

    logger.info(
        'send_departure_reminders: completed for %s — sent=%d skipped=%d',
        tomorrow, sent, skipped,
    )


# ---------------------------------------------------------------------------
# Task 4: auto_no_show  (daily, 22:00 UTC)
# ---------------------------------------------------------------------------

@shared_task(bind=True, name='reservations.auto_no_show')
def auto_no_show(self):
    """
    Nightly at 22:00 UTC: transient bookings still in 'confirmed' state whose
    check_in date is today or earlier are marked 'no_show'.

    The marina keeps the payment. The berth is immediately released back into
    inventory so late walk-up arrivals can be assigned the slip.

    Only affects transient bookings — seasonal contracts are never auto-voided.
    """
    from apps.reservations.models import Booking

    today = timezone.now().date()

    updated = (
        Booking.objects
        .filter(status='confirmed', booking_type='transient', check_in__lte=today)
        .update(status='no_show')
    )

    if updated:
        logger.info('auto_no_show: marked %d booking(s) as no_show for date %s', updated, today)
    else:
        logger.info('auto_no_show: no confirmed transient arrivals to mark for %s', today)


# ---------------------------------------------------------------------------
# Task 5: purge_expired_insurance_uploads  (hourly)
# ---------------------------------------------------------------------------

from django.core.files.storage import default_storage
from .models import InsuranceUploadToken


@shared_task(bind=True, name='reservations.purge_expired_insurance_uploads')
def purge_expired_insurance_uploads(self=None):
    """
    Hourly defensive backstop for the insurance-upload temp directory:
      - Unconsumed tokens older than 24h: delete the tmp file and the row.
      - Consumed tokens older than 30d: delete the row.
      - For any consumed token, if the tmp file still exists, delete it.
    """
    now = timezone.now()
    unconsumed_cutoff = now - timedelta(hours=24)
    consumed_cutoff   = now - timedelta(days=30)

    for tok in InsuranceUploadToken.objects.filter(
        consumed_at__isnull=True, created_at__lt=unconsumed_cutoff,
    ):
        try:
            if default_storage.exists(tok.file_path):
                default_storage.delete(tok.file_path)
        except Exception:
            logger.exception('Failed to delete expired insurance tmp file: %s', tok.file_path)
        tok.delete()

    InsuranceUploadToken.objects.filter(
        consumed_at__isnull=False, consumed_at__lt=consumed_cutoff,
    ).delete()

    for tok in InsuranceUploadToken.objects.filter(consumed_at__isnull=False):
        try:
            if default_storage.exists(tok.file_path):
                default_storage.delete(tok.file_path)
        except Exception:
            logger.exception('Failed to delete leftover consumed insurance tmp file: %s', tok.file_path)
