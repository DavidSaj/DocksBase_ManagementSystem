from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone


class Command(BaseCommand):
    help = 'Release locked ReservationItems whose locked_until has passed'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Print what would change without writing to the database',
        )

    def handle(self, *args, **options):
        from apps.reservations.models import Reservation, ReservationItem

        dry = options['dry_run']
        now = timezone.now()
        expired_count = 0

        expired_reservations = Reservation.objects.filter(
            status='pending_checkout',
            locked_until__lt=now,
        ).select_for_update()

        with transaction.atomic():
            for reservation in expired_reservations:
                if dry:
                    self.stdout.write(
                        f'[DRY] Would expire reservation {reservation.pk} '
                        f'(locked_until={reservation.locked_until})'
                    )
                else:
                    ReservationItem.objects.filter(
                        reservation=reservation, status='locked'
                    ).update(status='released')
                    reservation.status = 'abandoned'
                    reservation.save(update_fields=['status'])
                expired_count += 1

            if dry:
                transaction.set_rollback(True)

        prefix = '[DRY RUN] ' if dry else ''
        self.stdout.write(f'{prefix}Expired reservations: {expired_count}')
