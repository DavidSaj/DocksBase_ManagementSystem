"""
auto_transition_bookings — run once per day (e.g. cron at 14:05 UTC).

  confirmed  + check_in  <= today → checked_in   (berth → occupied)
  checked_in + check_out <  today → checked_out  (berth → available)
  checked_in + check_out == today → overstay     (berth stays occupied)

Usage:
  python manage.py auto_transition_bookings
  python manage.py auto_transition_bookings --dry-run
"""

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone


class Command(BaseCommand):
    help = 'Auto-transition bookings: confirmed→checked_in, checked_in→checked_out/overstay'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Print what would change without writing to the database',
        )

    def handle(self, *args, **options):
        from apps.reservations.models import Booking

        dry = options['dry_run']
        today = timezone.localdate()
        checked_in_count = 0
        checked_out_count = 0
        overstay_count = 0

        with transaction.atomic():
            # confirmed + check_in <= today → checked_in
            to_check_in = Booking.objects.filter(
                status='confirmed',
                check_in__lte=today,
            ).select_related('berth').select_for_update()

            for booking in to_check_in:
                if dry:
                    self.stdout.write(
                        f'[DRY] Would check in booking {booking.pk} (berth {booking.berth_id})'
                    )
                else:
                    booking.status = 'checked_in'
                    booking.save(update_fields=['status'])
                    if booking.berth_id:
                        booking.berth.status = 'occupied'
                        booking.berth.save(update_fields=['status'])
                checked_in_count += 1

            # checked_in + check_out < today → checked_out, berth → available
            to_check_out = Booking.objects.filter(
                status='checked_in',
                check_out__lt=today,
            ).select_related('berth').select_for_update()

            for booking in to_check_out:
                if dry:
                    self.stdout.write(
                        f'[DRY] Would check out booking {booking.pk} (berth {booking.berth_id})'
                    )
                else:
                    booking.status = 'checked_out'
                    booking.save(update_fields=['status'])
                    if booking.berth_id:
                        booking.berth.status = 'available'
                        booking.berth.save(update_fields=['status'])
                checked_out_count += 1

            # checked_in + check_out == today → overstay (no berth change yet)
            to_overstay = Booking.objects.filter(
                status='checked_in',
                check_out=today,
            ).select_for_update()

            for booking in to_overstay:
                if dry:
                    self.stdout.write(
                        f'[DRY] Would mark overstay booking {booking.pk}'
                    )
                else:
                    booking.status = 'overstay'
                    booking.save(update_fields=['status'])
                overstay_count += 1

            if dry:
                transaction.set_rollback(True)

        prefix = '[DRY RUN] ' if dry else ''
        self.stdout.write(
            f'{prefix}Checked in: {checked_in_count} | '
            f'Checked out: {checked_out_count} | '
            f'Overstay: {overstay_count}'
        )
