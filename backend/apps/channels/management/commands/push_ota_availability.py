from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Push availability for all active OTA channels (90-day window).'

    def handle(self, *args, **options):
        from apps.channels.models import OTAChannel
        from apps.channels.ota.factory import get_adapter
        from datetime import date, timedelta
        from django.utils import timezone

        date_from = date.today()
        date_to = date_from + timedelta(days=90)
        channels = OTAChannel.objects.filter(is_active=True).select_related('marina')
        for channel in channels:
            berths = list(channel.marina.berths.all())
            adapter = get_adapter(channel)
            try:
                adapter.push_availability(berths=berths, date_from=date_from, date_to=date_to)
                channel.last_push_at = timezone.now()
                channel.save(update_fields=['last_push_at'])
                self.stdout.write(f'Pushed: {channel}')
            except Exception as e:
                self.stderr.write(f'Failed {channel}: {e}')
        self.stdout.write(self.style.SUCCESS('Done.'))
