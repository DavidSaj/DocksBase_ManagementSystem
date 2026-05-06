from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'DEPRECATED — use sync_ota_bookings instead'

    def handle(self, *args, **options):
        raise SystemExit('sync_mysea_bookings has been removed. Use: python manage.py sync_ota_bookings')
