from django.urls import path
from .views import (
    PierListCreateView, PierDetailView,
    BerthListCreateView, BerthDetailView,
    MapConfigView,
    BulkCreateBerthsView,
    BulkUpdateBerthPricingView,
    BroadcastSMSView,
    AmenityListCreateView, AmenityDetailView,
    IcalFeedView,
)

urlpatterns = [
    path('piers/', PierListCreateView.as_view(), name='pier_list'),
    path('piers/<int:pk>/', PierDetailView.as_view(), name='pier_detail'),
    path('berths/bulk-create/', BulkCreateBerthsView.as_view(), name='berths_bulk_create'),
    path('berths/bulk-pricing/', BulkUpdateBerthPricingView.as_view(), name='berths_bulk_pricing'),
    path('berths/ical/mysea.ics', IcalFeedView.as_view(), name='berths_ical_mysea'),
    path('berths/', BerthListCreateView.as_view(), name='berth_list'),
    path('berths/<int:pk>/', BerthDetailView.as_view(), name='berth_detail'),
    path('map/config/', MapConfigView.as_view(), name='map_config'),
    path('broadcast/', BroadcastSMSView.as_view(), name='broadcast_sms'),
    path('amenities/', AmenityListCreateView.as_view(), name='amenity_list'),
    path('amenities/<int:pk>/', AmenityDetailView.as_view(), name='amenity_detail'),
]
