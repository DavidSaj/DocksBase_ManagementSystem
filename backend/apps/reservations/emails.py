from django.conf import settings
from django.core.mail import send_mail

from apps.portal.checkin_utils import make_magic_url


def send_booking_request_boater_email(booking):
    marina = booking.marina
    nights = (booking.check_out - booking.check_in).days
    send_mail(
        f'Booking request received — {marina.name}',
        (
            f'Hi {booking.guest_name or "there"},\n\n'
            f'We have received your booking request at {marina.name}.\n\n'
            f'Dates: {booking.check_in} – {booking.check_out} ({nights} night{"s" if nights != 1 else ""})\n'
            f'Vessel dimensions: LOA {booking.boat_loa}m × beam {booking.boat_beam}m × draft {booking.boat_draft}m\n\n'
            f'The harbour master will review your request within 24 hours.\n\n'
            f'— {marina.name}'
        ),
        settings.DEFAULT_FROM_EMAIL,
        [booking.guest_email],
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
        f'New booking request — {booking.guest_name or "Guest"}',
        (
            f'A new transient booking request has been submitted.\n\n'
            f'Guest: {booking.guest_name or "—"} ({booking.guest_email})\n'
            f'Dates: {booking.check_in} – {booking.check_out} ({nights} night{"s" if nights != 1 else ""})\n'
            f'Vessel: LOA {booking.boat_loa}m × beam {booking.boat_beam}m × draft {booking.boat_draft}m\n\n'
            f'Review in the Reservations screen: {getattr(settings, "FRONTEND_URL", "")}/reservations\n\n'
            f'— DocksBase'
        ),
        settings.DEFAULT_FROM_EMAIL,
        recipients,
        fail_silently=True,
    )


def send_approve_email(booking, checkout_url):
    marina = booking.marina
    send_mail(
        f'Your berth is reserved — complete payment',
        (
            f'Hi {booking.guest_name or "there"},\n\n'
            f'Great news! {marina.name} has assigned you a berth for '
            f'{booking.check_in} – {booking.check_out}.\n\n'
            f'Total due: {booking.amount}\n\n'
            f'Please complete your payment using the secure link below. '
            f'This link expires in 24 hours.\n\n'
            f'{checkout_url}\n\n'
            f'— {marina.name}'
        ),
        settings.DEFAULT_FROM_EMAIL,
        [booking.guest_email],
        fail_silently=True,
    )


def send_reject_email(booking, reason):
    marina = booking.marina
    send_mail(
        f'Booking request update — {marina.name}',
        (
            f'Hi {booking.guest_name or "there"},\n\n'
            f'Unfortunately we are unable to accommodate your booking request '
            f'for {booking.check_in} – {booking.check_out}.\n\n'
            f'Reason: {reason}\n\n'
            f'We apologise for any inconvenience.\n\n'
            f'— {marina.name}'
        ),
        settings.DEFAULT_FROM_EMAIL,
        [booking.guest_email],
        fail_silently=True,
    )


def send_booking_confirmed_email(booking):
    marina = booking.marina
    magic_url = make_magic_url(booking)
    send_mail(
        f'Booking confirmed — {marina.name}',
        (
            f'Hi {booking.guest_name or "there"},\n\n'
            f'Your booking at {marina.name} is confirmed!\n\n'
            f'Dates: {booking.check_in} – {booking.check_out}\n'
            f'Berth: {booking.berth.code if booking.berth else "—"}\n\n'
            f'Click the link below to access your pre-arrival checklist and check in:\n\n'
            f'{magic_url}\n\n'
            f'This link is personal to you and expires in 72 hours.\n\n'
            f'— {marina.name}'
        ),
        settings.DEFAULT_FROM_EMAIL,
        [booking.guest_email],
        fail_silently=True,
    )
