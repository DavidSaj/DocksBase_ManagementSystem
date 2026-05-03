import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async
from django.contrib.auth import get_user_model

User = get_user_model()


@database_sync_to_async
def get_marina_id_from_token(token_key):
    try:
        from rest_framework_simplejwt.tokens import AccessToken
        token = AccessToken(token_key)
        user = User.objects.select_related('marina').get(pk=token['user_id'])
        return user.marina_id
    except Exception:
        return None


class BerthStatusConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        token_key = None
        for part in self.scope['query_string'].decode().split('&'):
            if part.startswith('token='):
                token_key = part[6:]
                break

        if not token_key:
            await self.close(code=4001)
            return

        marina_id = await get_marina_id_from_token(token_key)
        if not marina_id:
            await self.close(code=4003)
            return

        self.group_name = f'marina_{marina_id}'
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

    async def disconnect(self, close_code):
        if hasattr(self, 'group_name'):
            await self.channel_layer.group_discard(self.group_name, self.channel_name)

    async def receive(self, text_data=None, bytes_data=None):
        pass  # server-push only, client sends nothing

    async def berth_update(self, event):
        await self.send(text_data=json.dumps(event['data']))
