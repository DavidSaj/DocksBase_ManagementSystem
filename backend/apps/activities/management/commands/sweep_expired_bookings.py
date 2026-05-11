"""
Management command: manual runner for sweep_expired_direct_bookings Celery task.

Usage:
    python manage.py sweep_expired_bookings [--dry-run]

In production this is triggered automatically every 5 minutes by Celery Beat.
Use this command for manual runs, testing, or as a cron fallback if Celery is not running.
"""
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Cancel expired direct-payment activity bookings and release their asset reservations.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Print which bookings would be cancelled without making changes.',
        )

    def handle(self, *args, **options):
        from django.utils import timezone
        from apps.activities.models import ActivityBooking

        expired_qs = ActivityBooking.objects.filter(
            status=ActivityBooking.Status.CONFIRMED,
            payment_mode=ActivityBooking.PaymentMode.DIRECT,
            invoice__status='draft',
            expires_at__lt=timezone.now(),
        ).select_related('invoice')

        count = expired_qs.count()

        if options['dry_run']:
            self.stdout.write(
                self.style.WARNING(
                    f'[DRY RUN] Would cancel {count} expired direct-payment bookings.'
                )
            )
            for booking in expired_qs:
                self.stdout.write(
                    f'  Booking #{booking.pk} — {booking.activity} at {booking.start_datetime} '
                    f'(expired: {booking.expires_at})'
                )
            return

        from apps.activities.tasks import sweep_expired_direct_bookings
        result = sweep_expired_direct_bookings()
        self.stdout.write(self.style.SUCCESS(result))
