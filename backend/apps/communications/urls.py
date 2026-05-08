from django.urls import include, path
from rest_framework.routers import DefaultRouter
from rest_framework_nested import routers as nested_routers

from apps.communications import views

router = DefaultRouter()
router.register(r'message-templates', views.MessageTemplateViewSet, basename='messagetemplate')
router.register(r'messages', views.MessageLogViewSet, basename='messagelog')
router.register(r'whatsapp-templates', views.WhatsAppTemplateViewSet, basename='whatsapptemplate')
router.register(r'alert-routes', views.AlertRouteViewSet, basename='alertroute')
router.register(r'journeys', views.JourneyViewSet, basename='journey')
router.register(r'campaigns', views.EmailCampaignViewSet, basename='emailcampaign')
router.register(r'dotdigital/segments', views.DotdigitalSegmentMappingViewSet, basename='dotdigitalsegment')

# Nested: /journeys/{journey_pk}/steps/
journey_router = nested_routers.NestedDefaultRouter(router, r'journeys', lookup='journey')
journey_router.register(r'steps', views.JourneyStepViewSet, basename='journey-step')

urlpatterns = [
    path('', include(router.urls)),
    path('', include(journey_router.urls)),
    path('review-requests/', views.ReviewRequestListView.as_view(), name='review-requests'),
    path('review-config/', views.ReviewConfigView.as_view(), name='review-config'),
    path('dotdigital/config/', views.DotdigitalConfigView.as_view(), name='dotdigital-config'),
    path('dotdigital/sync/', views.DotdigitalSyncView.as_view(), name='dotdigital-sync'),
    path('webhooks/whatsapp/', views.WhatsAppWebhookView.as_view(), name='webhook-whatsapp'),
    path('webhooks/email/', views.EmailWebhookView.as_view(), name='webhook-email'),
]
