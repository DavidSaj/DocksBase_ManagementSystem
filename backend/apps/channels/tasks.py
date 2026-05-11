from celery import shared_task


@shared_task(name='channels.push_ota_availability')
def push_ota_availability():
    from apps.channels.models import OTAChannel
    from apps.channels.ota.factory import get_adapter
    from datetime import date, timedelta
    from django.utils import timezone
    date_from = date.today()
    date_to = date_from + timedelta(days=90)
    for channel in OTAChannel.objects.filter(is_active=True).select_related('marina'):
        berths = list(channel.marina.berths.all())
        adapter = get_adapter(channel)
        try:
            adapter.push_availability(berths=berths, date_from=date_from, date_to=date_to)
            channel.last_push_at = timezone.now()
            channel.save(update_fields=['last_push_at'])
        except Exception:
            pass


@shared_task(bind=True, max_retries=3, default_retry_delay=30)
def push_ota_availability_delta(self, berth_id, date_from, date_to):
    from apps.berths.models import Berth
    from apps.channels.models import OTAChannel
    from apps.channels.ota.factory import get_adapter
    from datetime import date as _date
    from django.utils import timezone
    berth = Berth.objects.select_related('marina').get(pk=berth_id)
    channels = OTAChannel.objects.filter(marina=berth.marina, is_active=True)
    for channel in channels:
        adapter = get_adapter(channel)
        try:
            adapter.push_availability(
                berths=[berth],
                date_from=_date.fromisoformat(date_from),
                date_to=_date.fromisoformat(date_to),
            )
            channel.last_push_at = timezone.now()
            channel.save(update_fields=['last_push_at'])
        except Exception as exc:
            raise self.retry(exc=exc)


@shared_task(name='channels.pull_ota_bookings')
def pull_ota_bookings():
    from apps.channels.models import OTAChannel
    from apps.channels.ota.factory import get_adapter
    from apps.channels.services.ota import import_ota_booking
    from django.utils import timezone
    for channel in OTAChannel.objects.filter(is_active=True).select_related('marina'):
        adapter = get_adapter(channel)
        since = channel.last_pull_at or timezone.now()
        try:
            raw_bookings = adapter.pull_bookings(since=since)
            for raw in raw_bookings:
                import_ota_booking(channel, raw)
            channel.last_pull_at = timezone.now()
            channel.save(update_fields=['last_pull_at'])
        except Exception:
            pass
