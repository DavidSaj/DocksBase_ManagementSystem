"""
Utilities app URL configuration.

Include in config/urls.py:
  path('api/v1/utilities/', include('apps.utilities.urls')),

Note: wash-tokens/redeem/ and meter setup paths are listed BEFORE router.urls so
the exact paths are matched before the router's {id}/ patterns. Django URL
resolution is first-match, so order matters here.
"""

from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    DeviceReadingsView,
    DeviceTokenView,
    DockwalkListView,
    DockwalkReadingView,
    MeterOutageAlertViewSet,
    MeterWebhookKeyRotateView,
    MeterWebhookKeyView,
    OfgemReportView,
    ServiceBollardViewSet,
    SmartMeterViewSet,
    UtilityIntegrationViewSet,
    UtilityWalletViewSet,
    WashTokenRedeemView,
    WashTokenViewSet,
    WebhookReadingsView,
)

router = DefaultRouter()
router.register(r'smart-meters',   SmartMeterViewSet,         basename='smart-meter')
router.register(r'integrations',   UtilityIntegrationViewSet, basename='utility-integration')
router.register(r'outage-alerts',  MeterOutageAlertViewSet,   basename='outage-alert')
router.register(r'wallets',        UtilityWalletViewSet,      basename='utility-wallet')
router.register(r'bollards',       ServiceBollardViewSet,     basename='service-bollard')
router.register(r'wash-tokens',    WashTokenViewSet,          basename='wash-token')

# Explicit paths BEFORE router.urls (first-match wins)
urlpatterns = [
    path('ofgem-report/',                       OfgemReportView.as_view(),           name='ofgem-report'),
    path('wash-tokens/redeem/',                 WashTokenRedeemView.as_view(),       name='wash-token-redeem'),

    # Meter setup
    path('webhook-key/',                        MeterWebhookKeyView.as_view(),       name='meter-webhook-key'),
    path('webhook-key/rotate/',                 MeterWebhookKeyRotateView.as_view(), name='meter-webhook-key-rotate'),
    path('smart-meters/<int:pk>/device-token/', DeviceTokenView.as_view(),           name='smart-meter-device-token'),

    # Ingest endpoints (auth via headers, not JWT)
    path('webhook/readings/',                   WebhookReadingsView.as_view(),       name='webhook-readings'),
    path('devices/readings/',                   DeviceReadingsView.as_view(),        name='device-readings'),

    # Dockwalk staff endpoints
    path('dockwalk/',                           DockwalkListView.as_view(),          name='dockwalk-list'),
    path('dockwalk/<int:meter_id>/reading/',    DockwalkReadingView.as_view(),       name='dockwalk-reading'),
] + router.urls
