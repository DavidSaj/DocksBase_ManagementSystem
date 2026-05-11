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
        subprotocols = self.scope.get('subprotocols', [])
        token_str = subprotocols[0] if subprotocols else ''

        user = await self._get_user(token_str)
        if user is None:
            await self.close(code=4001)
            return

        self.user = user
        self.group_name = f'notif_user_{user.pk}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept(subprotocol=token_str if token_str else None)

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

