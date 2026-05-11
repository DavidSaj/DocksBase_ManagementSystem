"""
Management command: generate_utility_invoices

Generates monthly utility invoices for all active marina members.
This is a synchronous entry point — Celery Beat wiring comes in a later track.

Usage:
  python manage.py generate_utility_invoices --marina <marina_id> --month YYYY-MM

Example:
  python manage.py generate_utility_invoices --marina 1 --month 2026-04
"""

from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Generate monthly utility invoices for all active marina members.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--marina',
            type=int,
            required=True,
            help='Marina ID to generate invoices for.',
        )
        parser.add_argument(
            '--month',
            type=str,
            required=True,
            help='Billing month in YYYY-MM format (e.g. 2026-04).',
        )

    def handle(self, *args, **options):
        marina_id  = options['marina']
        month_str  = options['month']

        # Validate month format
        import re
        if not re.match(r'^\d{4}-\d{2}$', month_str):
            raise CommandError(f'--month must be in YYYY-MM format, got: {month_str!r}')

        # Validate marina exists
        from apps.accounts.models import Marina
        try:
            marina = Marina.objects.get(pk=marina_id)
        except Marina.DoesNotExist:
            raise CommandError(f'Marina with id={marina_id} does not exist.')

        self.stdout.write(
            f'Generating utility invoices for marina: {marina.name} (id={marina_id}), '
            f'month: {month_str} ...'
        )

        from apps.utilities.services.wallet_service import generate_monthly_utility_invoices
        generate_monthly_utility_invoices(
            marina_id=marina_id,
            month_str=month_str,
        )

        self.stdout.write(self.style.SUCCESS('Done.'))
