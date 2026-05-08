"""
Utilities app URL configuration.

Include in config/urls.py:
  path('api/v1/utilities/', include('apps.utilities.urls')),

Note: wash-tokens/redeem/ is listed BEFORE router.urls so the exact path
is matched before the router's {id}/ pattern. Django URL resolution is
first-match, so order matters here.
"""

from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    MeterOutageAlertViewSet,
    OfgemReportView,
    ServiceBollardViewSet,
    SmartMeterViewSet,
    UtilityWalletViewSet,
    WashTokenRedeemView,
    WashTokenViewSet,
)

router = DefaultRouter()
router.register(r'smart-meters',   SmartMeterViewSet,        basename='smart-meter')
router.register(r'outage-alerts',  MeterOutageAlertViewSet,  basename='outage-alert')
router.register(r'wallets',        UtilityWalletViewSet,     basename='utility-wallet')
router.register(r'bollards',       ServiceBollardViewSet,    basename='service-bollard')
router.register(r'wash-tokens',    WashTokenViewSet,         basename='wash-token')

# Explicit paths BEFORE router.urls (first-match wins)
urlpatterns = [
    path('ofgem-report/',         OfgemReportView.as_view(),      name='ofgem-report'),
    path('wash-tokens/redeem/',   WashTokenRedeemView.as_view(),  name='wash-token-redeem'),
] + router.urls
