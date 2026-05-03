from django.urls import re_path
from .consumers import BerthStatusConsumer

websocket_urlpatterns = [
    re_path(r'^ws/berths/$', BerthStatusConsumer.as_asgi()),
]
