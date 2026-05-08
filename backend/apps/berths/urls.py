from django.urls import path
from rest_framework.routers import DefaultRouter
from .views import (
    PierListCreateView, PierDetailView,
    BerthListCreateView, BerthDetailView,
    BerthAvailabilityView, BerthOccupancyStatsView,
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
    # Track 2 — Berth Intelligence
    SmartAssignView,
    ScoreWeightsView,
    FleetAssignView,
    FleetAssignStatusView,
    TemporaryDepartureViewSet,
    SubLetBookingViewSet,
    DockWalkSessionViewSet,
    DockWalkEntryBulkView,
    DockWalkOfflinePayloadView,
    BerthAlertViewSet,
    BerthListingViewSet,
    BerthListingEnquiryViewSet,
)

router = DefaultRouter()
router.register(r'ota-connections', OTAConnectionViewSet, basename='ota-connection')
router.register(r'berths/berth-categories', BerthCategoryViewSet, basename='berth-category')

urlpatterns = [
    # ── Existing routes ────────────────────────────────────────────────────────
    path('piers/', PierListCreateView.as_view(), name='pier_list'),
    path('piers/<int:pk>/', PierDetailView.as_view(), name='pier_detail'),
    path('logical-piers/', LogicalPierListCreateView.as_view(), name='logical_pier_list'),
    path('logical-piers/<int:pk>/', LogicalPierDetailView.as_view(), name='logical_pier_detail'),
    path('berths/bulk-create/', BulkCreateBerthsView.as_view(), name='berths_bulk_create'),
    path('berths/bulk-pricing/', BulkUpdateBerthPricingView.as_view(), name='berths_bulk_pricing'),
    path('berths/bulk-category/', BulkUpdateBerthCategoryView.as_view(), name='berths_bulk_category'),
    path('berths/ical/<uuid:token>.ics', IcalFeedView.as_view(), name='berths_ical_ota'),
    # Track 2 — Berth Intelligence: availability matrix and occupancy stats
    path('berths/availability/', BerthAvailabilityView.as_view(), name='berth_availability'),
    path('berths/occupancy-stats/', BerthOccupancyStatsView.as_view(), name='berth_occupancy_stats'),
    path('berths/', BerthListCreateView.as_view(), name='berth_list'),
    path('berths/<int:pk>/', BerthDetailView.as_view(), name='berth_detail'),
    path('map/config/', MapConfigView.as_view(), name='map_config'),
    path('broadcast/', BroadcastSMSView.as_view(), name='broadcast_sms'),
    path('amenities/', AmenityListCreateView.as_view(), name='amenity_list'),
    path('amenities/<int:pk>/', AmenityDetailView.as_view(), name='amenity_detail'),

    # ── Track 2 — Smart Assignment ─────────────────────────────────────────────
    path('berths/smart-assign/',                     SmartAssignView.as_view(),              name='smart_assign'),
    path('berths/score-weights/',                    ScoreWeightsView.as_view(),             name='score_weights'),
    path('berths/fleet-assign/',                     FleetAssignView.as_view(),              name='fleet_assign'),
    path('berths/fleet-assign/<int:job_id>/status/', FleetAssignStatusView.as_view(),        name='fleet_assign_status'),

    # ── Track 2 — Temporary Departure & Sub-letting ───────────────────────────
    path('berths/temporary-departures/',
         TemporaryDepartureViewSet.as_view({'get': 'list', 'post': 'create'}),
         name='temporary_departure_list'),
    path('berths/temporary-departures/<int:pk>/',
         TemporaryDepartureViewSet.as_view({'patch': 'partial_update'}),
         name='temporary_departure_detail'),
    path('berths/temporary-departures/<int:pk>/activate/',
         TemporaryDepartureViewSet.as_view({'post': 'activate'}),
         name='temporary_departure_activate'),
    path('berths/temporary-departures/<int:pk>/return/',
         TemporaryDepartureViewSet.as_view({'post': 'return_vessel'}),
         name='temporary_departure_return'),
    path('berths/sublet-bookings/',
         SubLetBookingViewSet.as_view({'get': 'list'}),
         name='sublet_booking_list'),
    path('berths/sublet-bookings/<int:pk>/apply-credit/',
         SubLetBookingViewSet.as_view({'post': 'apply_credit'}),
         name='sublet_booking_apply_credit'),

    # ── Track 2 — Dock Walk ───────────────────────────────────────────────────
    path('berths/dock-walk/sessions/',
         DockWalkSessionViewSet.as_view({'post': 'create', 'get': 'list'}),
         name='dock_walk_session_list'),
    path('berths/dock-walk/sessions/<int:pk>/',
         DockWalkSessionViewSet.as_view({'get': 'retrieve'}),
         name='dock_walk_session_detail'),
    path('berths/dock-walk/sessions/<int:pk>/entries/',
         DockWalkEntryBulkView.as_view(),
         name='dock_walk_entries'),
    path('berths/dock-walk/sessions/<int:pk>/finish/',
         DockWalkSessionViewSet.as_view({'patch': 'finish'}),
         name='dock_walk_session_finish'),
    path('berths/dock-walk/offline-payload/',
         DockWalkOfflinePayloadView.as_view(),
         name='dock_walk_offline_payload'),

    # ── Track 2 — Berth Alerts ────────────────────────────────────────────────
    path('berths/alerts/',
         BerthAlertViewSet.as_view({'get': 'list'}),
         name='berth_alert_list'),
    path('berths/alerts/<int:pk>/resolve/',
         BerthAlertViewSet.as_view({'patch': 'resolve'}),
         name='berth_alert_resolve'),
    path('berths/alerts/<int:pk>/escalate-coastguard/',
         BerthAlertViewSet.as_view({'post': 'escalate_coastguard'}),
         name='berth_alert_escalate_coastguard'),

    # ── Track 2 — Berth Listings ──────────────────────────────────────────────
    path('berths/listings/',
         BerthListingViewSet.as_view({'get': 'list', 'post': 'create'}),
         name='berth_listing_list'),
    path('berths/listings/<int:pk>/',
         BerthListingViewSet.as_view({'patch': 'partial_update'}),
         name='berth_listing_detail'),
    path('berths/listings/<int:listing_pk>/enquiries/',
         BerthListingEnquiryViewSet.as_view({'get': 'list', 'post': 'create'}),
         name='berth_listing_enquiry_list'),
] + router.urls
