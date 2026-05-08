from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Pull new bookings from all active OTA channels.'

    def handle(self, *args, **options):
        from apps.channels.models import OTAChannel
        from apps.channels.ota.factory import get_adapter
        from apps.channels.services.ota import import_ota_booking
        from django.utils import timezone

        channels = OTAChannel.objects.filter(is_active=True).select_related('marina')
        for channel in channels:
            adapter = get_adapter(channel)
            since = channel.last_pull_at or timezone.now()
            try:
                raw_bookings = adapter.pull_bookings(since=since)
                for raw in raw_bookings:
                    import_ota_booking(channel, raw)
                channel.last_pull_at = timezone.now()
                channel.save(update_fields=['last_pull_at'])
                self.stdout.write(f'Pulled {len(raw_bookings)} bookings from {channel}')
            except Exception as e:
                self.stderr.write(f'Failed {channel}: {e}')
        self.stdout.write(self.style.SUCCESS('Done.'))
