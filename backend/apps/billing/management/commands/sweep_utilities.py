"""
Management command: sweep_utilities

Ops-facing wrapper around `apps.billing.utility_sweep.sweep_pending_utility_charges`.
Lets operators trigger the sweep manually (e.g. mid-month catch-up, recovery
from a failed beat run) without going through Celery.

Usage:
  python manage.py sweep_utilities
  python manage.py sweep_utilities --marina-id 3
  python manage.py sweep_utilities --dry-run
"""

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = (
        'Sweep PendingUtilityCharge rows into draft invoices. '
        'Wraps apps.billing.utility_sweep.sweep_pending_utility_charges.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--marina-id',
            type=int,
            default=None,
            help='Restrict the sweep to a single marina.',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            default=False,
            help='Compute the sweep plan and roll the transaction back.',
        )

    def handle(self, *args, **options):
        from apps.billing.utility_sweep import sweep_pending_utility_charges

        marina_id = options.get('marina_id')
        dry_run = options.get('dry_run', False)

        marina_ids = [marina_id] if marina_id else None
        result = sweep_pending_utility_charges(marina_ids=marina_ids, dry_run=dry_run)

        prefix = '[DRY-RUN] ' if dry_run else ''
        self.stdout.write(self.style.SUCCESS(
            f'{prefix}sweep_utilities: '
            f'rows_swept={result.rows_swept} '
            f'lines_added={result.lines_added} '
            f'invoices_created={result.invoices_created} '
            f'invoices_appended={result.invoices_appended} '
            f'marinas={result.marinas}'
        ))
