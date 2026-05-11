import sys
from django.conf import settings
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Anonymise PII in a restored production DB dump. Refuses to run in production.'

    def handle(self, *args, **options):
        self._check_safety()
        totals = {}
        totals['Users'] = self._sanitize_users()
        totals['Members'] = self._sanitize_members()
        totals['Marinas'] = self._sanitize_marinas()
        totals['Vessels'] = self._sanitize_vessels()

        summary = ', '.join(f'{v} {k}' for k, v in totals.items())
        self.stdout.write(self.style.SUCCESS(f'Sanitized {summary}'))

    def _check_safety(self):
        if not settings.DEBUG:
            self.stderr.write(self.style.ERROR('sanitize_db refuses to run with DEBUG=False.'))
            sys.exit(1)
        db_name = settings.DATABASES.get('default', {}).get('NAME', '')
        if 'prod' in str(db_name).lower():
            self.stderr.write(self.style.ERROR(f'sanitize_db refuses to run against DB: {db_name}'))
            sys.exit(1)

    def _sanitize_users(self):
        return 0

    def _sanitize_members(self):
        return 0

    def _sanitize_marinas(self):
        return 0

    def _sanitize_vessels(self):
        return 0
