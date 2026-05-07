from django.urls import path
from rest_framework.routers import DefaultRouter
from .views import (
    PierListCreateView, PierDetailView,
    BerthListCreateView, BerthDetailView,
    MapConfigView,
    BulkCreateBerthsView,
    BulkUpdateBerthPricingView,
    BulkUpdateBerthCategoryView,
    BroadcastSMSView,
    AmenityListCreateView, AmenityDetailView,
    IcalFeedView,
    OTAConnectionViewSet,
    BerthCategoryViewSet,
    LogicalPierListCreateView, LogicalPierDetailView,
)

router = DefaultRouter()
router.register(r'ota-connections', OTAConnectionViewSet, basename='ota-connection')
router.register(r'berths/berth-categories', BerthCategoryViewSet, basename='berth-category')

urlpatterns = [
    path('piers/', PierListCreateView.as_view(), name='pier_list'),
    path('piers/<int:pk>/', PierDetailView.as_view(), name='pier_detail'),
    path('logical-piers/', LogicalPierListCreateView.as_view(), name='logical_pier_list'),
    path('logical-piers/<int:pk>/', LogicalPierDetailView.as_view(), name='logical_pier_detail'),
    path('berths/bulk-create/', BulkCreateBerthsView.as_view(), name='berths_bulk_create'),
    path('berths/bulk-pricing/', BulkUpdateBerthPricingView.as_view(), name='berths_bulk_pricing'),
    path('berths/bulk-category/', BulkUpdateBerthCategoryView.as_view(), name='berths_bulk_category'),
    path('berths/ical/<uuid:token>.ics', IcalFeedView.as_view(), name='berths_ical_ota'),
    path('berths/', BerthListCreateView.as_view(), name='berth_list'),
    path('berths/<int:pk>/', BerthDetailView.as_view(), name='berth_detail'),
    path('map/config/', MapConfigView.as_view(), name='map_config'),
    path('broadcast/', BroadcastSMSView.as_view(), name='broadcast_sms'),
    path('amenities/', AmenityListCreateView.as_view(), name='amenity_list'),
    path('amenities/<int:pk>/', AmenityDetailView.as_view(), name='amenity_detail'),
] + router.urls
