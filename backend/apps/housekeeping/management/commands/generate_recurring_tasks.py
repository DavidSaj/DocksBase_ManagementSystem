"""
Management command: manual runner for generate_recurring_housekeeping_tasks Celery task.

Usage:
    python manage.py generate_recurring_tasks [--dry-run]

In production this is triggered daily by Celery Beat.
Use this command for manual runs, testing, or as a cron fallback.
"""
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Generate mid-stay recurring housekeeping tasks for completed recurring tasks.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Print which tasks would be created without making changes.',
        )

    def handle(self, *args, **options):
        from datetime import timedelta

        from django.utils import timezone

        from apps.housekeeping.models import HousekeepingTask

        recurring = HousekeepingTask.objects.filter(
            recurrence_interval_days__isnull=False,
            status=HousekeepingTask.Status.CLEAN,
            completed_at__isnull=False,
        )

        due = [
            t for t in recurring
            if t.completed_at + timedelta(days=t.recurrence_interval_days) <= timezone.now()
        ]

        if options['dry_run']:
            self.stdout.write(
                self.style.WARNING(
                    f'[DRY RUN] Would create {len(due)} recurring housekeeping tasks.'
                )
            )
            for task in due:
                self.stdout.write(f'  Task #{task.pk} — {task.unit_label}')
            return

        from apps.housekeeping.tasks import generate_recurring_housekeeping_tasks
        result = generate_recurring_housekeeping_tasks()
        self.stdout.write(self.style.SUCCESS(result))
