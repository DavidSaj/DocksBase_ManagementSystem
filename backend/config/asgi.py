import os

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')

from django.core.asgi import get_asgi_application
django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter
from django.urls import re_path
from apps.berths.routing import websocket_urlpatterns as berths_ws
from apps.notifications.consumers import NotificationConsumer

websocket_urlpatterns = berths_ws + [
    re_path(r'^ws/notifications/$', NotificationConsumer.as_asgi()),
]

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    'websocket': URLRouter(websocket_urlpatterns),
})
