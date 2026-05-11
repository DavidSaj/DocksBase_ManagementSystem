import logging
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer
from .models import Notification

logger = logging.getLogger(__name__)


def notify(*, marina, recipient, kind, title, body, link_screen, link_id=None):
    notif = Notification.objects.create(
        marina=marina,
        recipient=recipient,
        kind=kind,
        title=title,
        body=body,
        link_screen=link_screen,
        link_id=link_id,
    )
    _push_to_ws(notif)
    return notif


def _push_to_ws(notif):
    layer = get_channel_layer()
    if layer is None:
        return
    group = f'notif_user_{notif.recipient_id}'
    payload = {
        'type': 'notification.send',
        'id': notif.pk,
        'kind': notif.kind,
        'title': notif.title,
        'body': notif.body,
        'link_screen': notif.link_screen,
        'link_id': notif.link_id,
        'read': notif.read,
        'created_at': notif.created_at.isoformat(),
    }
    try:
        async_to_sync(layer.group_send)(group, payload)
    except Exception as exc:
        logger.warning('notifications: WebSocket push failed for user %s: %s', notif.recipient_id, exc)
