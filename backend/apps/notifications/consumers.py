import json
import logging
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from rest_framework_simplejwt.tokens import AccessToken
from django.contrib.auth import get_user_model

logger = logging.getLogger(__name__)
User = get_user_model()


class NotificationConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        token_str = self.scope['query_string'].decode()
        token_str = dict(
            part.split('=', 1) for part in token_str.split('&') if '=' in part
        ).get('token', '')

        user = await self._get_user(token_str)
        if user is None:
            await self.close(code=4001)
            return

        self.user = user
        self.group_name = f'notif_user_{user.pk}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        # Send last 20 unread notifications on connect
        notifs = await self._get_recent(user)
        await self.send(text_data=json.dumps({'type': 'initial', 'notifications': notifs}))

    async def disconnect(self, code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def notification_send(self, event):
        payload = {k: v for k, v in event.items() if k != 'type'}
        await self.send(text_data=json.dumps({'type': 'notification', **payload}))

    async def receive(self, text_data=None, bytes_data=None):
        pass

    @database_sync_to_async
    def _get_user(self, token_str):
        try:
            data = AccessToken(token_str)
            return User.objects.get(pk=data['user_id'])
        except Exception:
            return None

    @database_sync_to_async
    def _get_recent(self, user):
        from .models import Notification
        from .serializers import NotificationSerializer
        qs = Notification.objects.filter(recipient=user, read=False).order_by('-created_at')[:20]
        return NotificationSerializer(qs, many=True).data
