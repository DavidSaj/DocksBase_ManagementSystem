from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.communications import views

router = DefaultRouter()
router.register(r'message-templates', views.MessageTemplateViewSet, basename='messagetemplate')
router.register(r'messages', views.MessageLogViewSet, basename='messagelog')
router.register(r'whatsapp-templates', views.WhatsAppTemplateViewSet, basename='whatsapptemplate')
router.register(r'alert-routes', views.AlertRouteViewSet, basename='alertroute')
router.register(r'journeys', views.JourneyViewSet, basename='journey')
router.register(r'campaigns', views.EmailCampaignViewSet, basename='emailcampaign')
router.register(r'dotdigital/segments', views.DotdigitalSegmentMappingViewSet, basename='dotdigitalsegment')

urlpatterns = [
    path('', include(router.urls)),
    # Journey steps nested route — explicit paths instead of drf-nested-routers
    path('journeys/<int:journey_pk>/steps/', views.JourneyStepViewSet.as_view({'get': 'list', 'post': 'create'}), name='journey-steps-list'),
    path('journeys/<int:journey_pk>/steps/<int:pk>/', views.JourneyStepViewSet.as_view({'get': 'retrieve', 'patch': 'partial_update', 'delete': 'destroy'}), name='journey-steps-detail'),
    path('review-requests/', views.ReviewRequestListView.as_view(), name='review-requests'),
    path('review-config/', views.ReviewConfigView.as_view(), name='review-config'),
    path('dotdigital/config/', views.DotdigitalConfigView.as_view(), name='dotdigital-config'),
    path('dotdigital/sync/', views.DotdigitalSyncView.as_view(), name='dotdigital-sync'),
    path('webhooks/whatsapp/', views.WhatsAppWebhookView.as_view(), name='webhook-whatsapp'),
    path('webhooks/email/', views.EmailWebhookView.as_view(), name='webhook-email'),
]
