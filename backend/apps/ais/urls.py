from django.urls import path
from .views import InboundETAView

urlpatterns = [
    path('inbound/', InboundETAView.as_view(), name='ais_inbound'),
]
