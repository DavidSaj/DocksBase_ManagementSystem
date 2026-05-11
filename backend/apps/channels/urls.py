from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.channels import views

router = DefaultRouter()
router.register(r'ota-channels', views.OTAChannelViewSet, basename='otachannel')

urlpatterns = [
    path('', include(router.urls)),
    path('webhooks/ota/<str:provider>/', views.OTABookingWebhookView.as_view(), name='webhook-ota'),
]
