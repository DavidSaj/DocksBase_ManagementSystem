import logging

from django.conf import settings
from django.core.mail import send_mail

from apps.portal.checkin_utils import make_magic_url

_log = logging.getLogger(__name__)


def send_booking_request_boater_email(booking):
    marina = booking.marina
    nights = (booking.check_out - booking.check_in).days
    send_mail(
        subject=f'Booking request received — {marina.name}',
        message=(
            f'Hi {booking.guest_name or "there"},\n\n'
            f'We have received your booking request at {marina.name}.\n\n'
            f'Dates: {booking.check_in} – {booking.check_out} ({nights} night{"s" if nights != 1 else ""})\n'
            f'Vessel dimensions: LOA {booking.boat_loa}m × beam {booking.boat_beam}m × draft {booking.boat_draft}m\n\n'
            f'The harbour master will review your request within 24 hours.\n\n'
            f'— {marina.name}'
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[booking.guest_email],
        fail_silently=True,
    )


def send_booking_request_manager_email(booking):
    from apps.accounts.models import User
    marina = booking.marina
    recipients = list(
        User.objects.filter(marina=marina, role__in=['owner', 'manager'])
        .values_list('email', flat=True)
    )
    if not recipients:
        return
    nights = (booking.check_out - booking.check_in).days
    send_mail(
        subject=f'New booking request — {booking.guest_name or "Guest"}',
        message=(
            f'A new transient booking request has been submitted.\n\n'
            f'Guest: {booking.guest_name or "—"} ({booking.guest_email})\n'
            f'Dates: {booking.check_in} – {booking.check_out} ({nights} night{"s" if nights != 1 else ""})\n'
            f'Vessel: LOA {booking.boat_loa}m × beam {booking.boat_beam}m × draft {booking.boat_draft}m\n\n'
            f'Review in the Reservations screen: {getattr(settings, "FRONTEND_URL", "")}/reservations\n\n'
            f'— DocksBase'
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=recipients,
        fail_silently=True,
    )


def send_approve_email(booking, checkout_url):
    marina = booking.marina
    send_mail(
        subject='Your berth is reserved — complete payment',
        message=(
            f'Hi {booking.guest_name or "there"},\n\n'
            f'Great news! {marina.name} has assigned you a berth for '
            f'{booking.check_in} – {booking.check_out}.\n\n'
            f'Total due: {booking.amount}\n\n'
            f'Please complete your payment using the secure link below. '
            f'This link expires in 24 hours.\n\n'
            f'{checkout_url}\n\n'
            f'— {marina.name}'
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[booking.guest_email],
        fail_silently=True,
    )


def send_reject_email(booking, reason):
    marina = booking.marina
    send_mail(
        subject=f'Booking request update — {marina.name}',
        message=(
            f'Hi {booking.guest_name or "there"},\n\n'
            f'Unfortunately we are unable to accommodate your booking request '
            f'for {booking.check_in} – {booking.check_out}.\n\n'
            f'Reason: {reason}\n\n'
            f'We apologise for any inconvenience.\n\n'
            f'— {marina.name}'
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[booking.guest_email],
        fail_silently=True,
    )


def send_booking_confirmed_email(booking):
    from apps.accounts.emails import _base, _h1, _p, _btn, _divider, _small, _NAVY, _MUTED, _TEXT
    marina    = booking.marina
    magic_url = make_magic_url(booking)
    print(f'\n{"="*60}\nBOARDING PASS URL (copy exactly):\n{magic_url}\n{"="*60}\n', flush=True)
    guest     = booking.guest_name or 'there'
    berth     = booking.berth.code if booking.berth else '—'
    check_in  = booking.check_in.strftime('%d %B %Y')
    check_out = booking.check_out.strftime('%d %B %Y')
    nights    = booking.nights
    amount    = f'€{booking.amount:.2f}' if booking.amount is not None else '—'

    vessel_row = f'<strong>Vessel:</strong> {booking.vessel_name}<br/>' if booking.vessel_name else ''
    eta_row    = f'<strong>ETA:</strong> {booking.eta.strftime("%H:%M")}<br/>' if booking.eta else ''

    contact_parts = []
    if getattr(marina, 'contact_email', None):
        contact_parts.append(marina.contact_email)
    if getattr(marina, 'phone', None):
        contact_parts.append(marina.phone)
    contact_line = ' · '.join(contact_parts) if contact_parts else ''

    html = _base(
        preheader=f"Your berth at {marina.name} is confirmed — see you on {check_in}.",
        body_html=(
            _h1("Your booking is confirmed") +
            _p(f"Hi {guest},") +
            _p(f"Great news — your berth at <strong>{marina.name}</strong> is confirmed and payment has been received.") +
            f"""<table cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 24px;border:1px solid rgba(0,0,0,0.08);border-radius:8px;overflow:hidden;">
              <tr style="background:#f8f8f8;"><td style="padding:10px 16px;font-size:12px;font-weight:600;color:{_MUTED};text-transform:uppercase;letter-spacing:0.5px;">Booking details</td></tr>
              <tr><td style="padding:12px 16px;font-size:14px;color:{_TEXT};border-top:1px solid rgba(0,0,0,0.06);">
                <strong>Booking ID:</strong> BK-{booking.pk}<br/>
                <strong>Marina:</strong> {marina.name}<br/>
                <strong>Berth:</strong> {berth}<br/>
                {vessel_row}
                <strong>Arrival:</strong> {check_in}{(' at ' + booking.eta.strftime('%H:%M')) if booking.eta else ''}<br/>
                <strong>Departure:</strong> {check_out}<br/>
                <strong>Nights:</strong> {nights}<br/>
                <strong>Amount paid:</strong> {amount}
              </td></tr>
            </table>""" +
            (f'<p style="font-size:14px;color:{_MUTED};margin:0 0 24px;">Need help? Contact the marina: <a href="mailto:{marina.contact_email}" style="color:{_NAVY};">{contact_line}</a></p>' if contact_line else '') +
            _p("Use the button below to access your digital boarding pass, complete pre-arrival checks, and find your berth on arrival.") +
            _btn(magic_url, "Open Boarding Pass →") +
            _divider() +
            _small("This link is personal — please don't share it. It expires after 72 hours but you can request a new one at any time.")
        ),
    )

    vessel_txt = f'Vessel: {booking.vessel_name}\n' if booking.vessel_name else ''
    eta_txt    = f'ETA: {booking.eta.strftime("%H:%M")}\n' if booking.eta else ''
    contact_txt = f'Questions? Contact the marina: {contact_line}\n\n' if contact_line else ''

    send_mail(
        subject=f"Booking confirmed — {marina.name}, {check_in}",
        message=(
            f"Hi {guest},\n\n"
            f"Your booking at {marina.name} is confirmed.\n\n"
            f"Booking ID: BK-{booking.pk}\n"
            f"Berth: {berth}\n"
            f"{vessel_txt}"
            f"Arrival: {check_in}"
            f"{(' at ' + booking.eta.strftime('%H:%M')) if booking.eta else ''}\n"
            f"Departure: {check_out}\n"
            f"{eta_txt}"
            f"Nights: {nights}\n"
            f"Amount paid: {amount}\n\n"
            f"{contact_txt}"
            f"Open your boarding pass: {magic_url}\n\n"
            "This link expires in 72 hours.\n\n"
            f"— {marina.name}"
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[booking.guest_email],
        html_message=html,
        fail_silently=True,
    )
