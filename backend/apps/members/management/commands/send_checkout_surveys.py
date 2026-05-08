"""
Management command: send_checkout_surveys

Finds bookings that checked out 23–25 hours ago and have no SurveyResponse yet,
then sends a signed token survey link to the member's email.

The survey URL is: {SITE_URL}/surveys/nps/?token=<signed_token>
Token is signed using Django's TimestampSigner (configurable max age via
SURVEY_TOKEN_MAX_AGE setting, default 7 days).

Usage:
    python manage.py send_checkout_surveys [--dry-run]
"""
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone


class Command(BaseCommand):
    help = 'Send post-checkout NPS survey emails to members checked out 23-25h ago.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Report eligible bookings without sending emails.',
        )

    def handle(self, *args, **options):
        from django.conf import settings
        from django.core.mail import send_mail
        from django.core.signing import TimestampSigner

        from apps.members.models import SurveyResponse

        dry_run = options['dry_run']
        now = timezone.now()
        window_start = now - timedelta(hours=25)
        window_end = now - timedelta(hours=23)

        try:
            from apps.reservations.models import Booking
        except ImportError:
            self.stderr.write('reservations app not available.')
            return

        # Find checked-out bookings in the 23–25h window with no survey yet
        bookings = (
            Booking.objects.filter(
                status='checked_out',
                actual_checkout__gte=window_start,
                actual_checkout__lte=window_end,
            )
            .select_related('member', 'marina')
            .exclude(
                survey_responses__isnull=False
            )
        )

        site_url = getattr(settings, 'SITE_URL', 'https://app.docksbase.com')
        survey_token_max_age = getattr(settings, 'SURVEY_TOKEN_MAX_AGE', 60 * 60 * 24 * 7)  # 7 days
        signer = TimestampSigner()

        sent = 0
        skipped = 0

        for booking in bookings:
            member = booking.member
            if not member:
                skipped += 1
                continue

            email = getattr(member, 'email', '')
            if not email:
                skipped += 1
                continue

            # Sign a payload: booking_id:member_id
            payload = f'{booking.pk}:{member.pk}'
            token = signer.sign(payload)

            survey_url = f'{site_url}/surveys/nps/?token={token}'

            if dry_run:
                self.stdout.write(
                    f'[DRY RUN] Would send survey to {email} for booking {booking.pk}'
                )
                sent += 1
                continue

            subject = f'How was your stay at {booking.marina.name}?'
            message = (
                f'Dear {member.name},\n\n'
                f'Thank you for choosing {booking.marina.name}. '
                f'We would love to hear about your experience.\n\n'
                f'Please take 30 seconds to rate your stay:\n'
                f'{survey_url}\n\n'
                f'This link expires in 7 days.\n\n'
                f'The {booking.marina.name} Team'
            )

            try:
                send_mail(
                    subject=subject,
                    message=message,
                    from_email=None,
                    recipient_list=[email],
                    fail_silently=False,
                )
                sent += 1
            except Exception as exc:
                self.stderr.write(
                    f'Failed to send survey email to {email} (booking {booking.pk}): {exc}'
                )
                skipped += 1

        verb = '[DRY RUN] Would send' if dry_run else 'Sent'
        self.stdout.write(
            self.style.SUCCESS(
                f'{verb} {sent} survey email(s). Skipped {skipped} (no email or no member).'
            )
        )
