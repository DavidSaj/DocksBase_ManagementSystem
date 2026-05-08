"""
Management command: backfill HousekeepingTask records for past charter checkouts.

RUN THIS ONLY AFTER TRACK 9 MERGES and HOUSEKEEPING_CHARTER_TRIGGER_ENABLED is set to True.

Usage:
    python manage.py backfill_housekeeping_tasks [--marina-id=<id>] [--dry-run]

This command is idempotent: it checks for an existing HousekeepingTask with
source_type='charter_checkout' and source_id=<charter_booking_id> before creating.
Safe to run multiple times.
"""
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = (
        'Backfill HousekeepingTask records for past charter checkouts that occurred '
        'before HOUSEKEEPING_CHARTER_TRIGGER_ENABLED was set to True. '
        'Run only after Track 9 merges.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--marina-id',
            type=int,
            help='Limit backfill to a specific marina (by PK). Defaults to all marinas.',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Print what would be created without actually creating records.',
        )

    def handle(self, *args, **options):
        from django.conf import settings

        if not getattr(settings, 'HOUSEKEEPING_CHARTER_TRIGGER_ENABLED', False):
            self.stdout.write(
                self.style.ERROR(
                    'HOUSEKEEPING_CHARTER_TRIGGER_ENABLED is not True. '
                    'Set it in settings before running this command.'
                )
            )
            return

        try:
            from apps.charter.models import CharterBooking  # noqa: F401 — Track 9 model
        except ImportError:
            self.stdout.write(
                self.style.ERROR(
                    'apps.charter is not installed. '
                    'This command can only run after Track 9 merges.'
                )
            )
            return

        from apps.charter.models import CharterBooking
        from apps.housekeeping.models import HousekeepingTask

        qs = CharterBooking.objects.filter(status='checked_out').select_related('vessel')
        if options.get('marina_id'):
            qs = qs.filter(marina_id=options['marina_id'])

        created_count = 0
        skipped_count = 0

        for charter in qs:
            already_exists = HousekeepingTask.objects.filter(
                source_type=HousekeepingTask.SourceType.CHARTER_CHECKOUT,
                source_id=str(charter.pk),
            ).exists()

            if already_exists:
                skipped_count += 1
                continue

            vessel_label = getattr(charter.vessel, 'name', str(charter.vessel_id))
            vessel_id    = charter.vessel_id

            if options['dry_run']:
                self.stdout.write(
                    f'[DRY RUN] Would create task for CharterBooking #{charter.pk} '
                    f'vessel: {vessel_label}'
                )
                created_count += 1
                continue

            HousekeepingTask.objects.create(
                marina=charter.marina,
                source_type=HousekeepingTask.SourceType.CHARTER_CHECKOUT,
                source_id=str(charter.pk),
                unit_type=HousekeepingTask.UnitType.VESSEL,
                unit_id=str(vessel_id),
                unit_label=vessel_label,
                status=HousekeepingTask.Status.DIRTY,
                target_ready_by=getattr(charter, 'next_checkin_datetime', None),
            )
            created_count += 1

        summary = (
            f'{"[DRY RUN] " if options["dry_run"] else ""}'
            f'Created {created_count} tasks, skipped {skipped_count} (already existed).'
        )
        self.stdout.write(self.style.SUCCESS(summary))
