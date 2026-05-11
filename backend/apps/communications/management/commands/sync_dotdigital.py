from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Sync member segments to Dotdigital address books.'

    def handle(self, *args, **options):
        # Stub — implement full sync in services/dotdigital.py
        self.stdout.write(self.style.WARNING('Dotdigital sync not yet implemented. Add logic to services/dotdigital.py.'))
