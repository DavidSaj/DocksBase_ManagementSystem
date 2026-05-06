from django.db.models.signals import pre_save, post_save
from django.dispatch import receiver


def _push_berth_update(berth):
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer
        channel_layer = get_channel_layer()
        if not channel_layer:
            return
        async_to_sync(channel_layer.group_send)(
            f'marina_{berth.marina_id}',
            {
                'type': 'berth_update',
                'data': {
                    'type': 'berth_update',
                    'berth_id': berth.id,
                    'status': berth.status,
                    'pier': berth.pier_id,
                    'local_x': str(berth.local_x) if berth.local_x is not None else None,
                    'local_y': str(berth.local_y) if berth.local_y is not None else None,
                },
            }
        )
    except Exception:
        pass  # never crash a save because of a push failure


@receiver(pre_save, sender='berths.Berth')
def on_berth_pre_save(sender, instance, **kwargs):
    """Capture previous status so post_save can detect maintenance→available transitions."""
    update_fields = kwargs.get('update_fields')
    if update_fields is not None and 'status' not in update_fields:
        # status isn't changing — no need to fetch previous value
        instance._prev_status = None
        return
    if instance.pk:
        from apps.berths.models import Berth
        prev = Berth.objects.filter(pk=instance.pk).values_list('status', flat=True).first()
        instance._prev_status = prev
    else:
        instance._prev_status = None


@receiver(post_save, sender='berths.Berth')
def on_berth_save(sender, instance, created, **kwargs):
    _push_berth_update(instance)

    update_fields = kwargs.get('update_fields')
    if update_fields and 'ota_connection' in update_fields and len(update_fields) == 1:
        return  # allocator .update() — skip to avoid loops
    prev = getattr(instance, '_prev_status', None)
    if prev == 'maintenance' and instance.status != 'maintenance':
        marina = instance.marina
        from apps.berths.models import OTAConnection
        if OTAConnection.objects.filter(marina=marina).exists():
            from apps.berths.allocator import run_smart_allocator
            run_smart_allocator(marina, instance)
