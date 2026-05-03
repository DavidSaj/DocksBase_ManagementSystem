from django.db.models.signals import post_save
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


@receiver(post_save, sender='berths.Berth')
def on_berth_save(sender, instance, **kwargs):
    _push_berth_update(instance)
