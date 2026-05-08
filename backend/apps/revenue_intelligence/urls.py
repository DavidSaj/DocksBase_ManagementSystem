from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AdrView,
    BookingTierViewSet,
    CompetitorRateViewSet,
    DeferredRevenueView,
    ForecastView,
    HourlyBerthConfigViewSet,
    PacingView,
    RevpabView,
    UpgradeCampaignViewSet,
    UpsellOfferViewSet,
    WaitlistEntryViewSet,
    WaitlistOfferViewSet,
    YieldPreviewView,
    YieldRuleViewSet,
)

router = DefaultRouter()
router.register(r'revenue/booking-tiers', BookingTierViewSet, basename='booking-tier')
router.register(r'revenue/yield-rules', YieldRuleViewSet, basename='yield-rule')
router.register(r'revenue/hourly-configs', HourlyBerthConfigViewSet, basename='hourly-berth-config')
router.register(r'revenue/upgrade-campaigns', UpgradeCampaignViewSet, basename='upgrade-campaign')
router.register(r'revenue/upsell-offers', UpsellOfferViewSet, basename='upsell-offer')
router.register(r'revenue/waitlist', WaitlistEntryViewSet, basename='waitlist-entry')
router.register(r'revenue/waitlist-offers', WaitlistOfferViewSet, basename='waitlist-offer')
router.register(r'revenue/competitor-rates', CompetitorRateViewSet, basename='competitor-rate')

urlpatterns = [
    path('', include(router.urls)),

    # Yield preview (no persistence)
    path('revenue/yield-preview/', YieldPreviewView.as_view(), name='yield-preview'),

    # Analytics
    path('revenue/analytics/adr/', AdrView.as_view(), name='revenue-adr'),
    path('revenue/analytics/revpab/', RevpabView.as_view(), name='revenue-revpab'),
    path('revenue/analytics/pacing/', PacingView.as_view(), name='revenue-pacing'),
    path('revenue/analytics/forecast/', ForecastView.as_view(), name='revenue-forecast'),
    path('revenue/analytics/deferred/', DeferredRevenueView.as_view(), name='revenue-deferred'),
]
