from django.urls import path

from apps.charter import views

urlpatterns = [
    # Charter Vessels
    path('charter/vessels/',                           views.CharterVesselListCreateView.as_view(),          name='charter-vessel-list'),
    path('charter/vessels/<int:pk>/',                  views.CharterVesselDetailView.as_view(),              name='charter-vessel-detail'),
    # Management Agreements
    path('charter/agreements/',                        views.CharterManagementAgreementListCreateView.as_view(), name='charter-agreement-list'),
    path('charter/agreements/<int:pk>/',               views.CharterManagementAgreementDetailView.as_view(),    name='charter-agreement-detail'),
    # Charter Bookings
    path('charter/bookings/',                          views.CharterBookingListCreateView.as_view(),         name='charter-booking-list'),
    path('charter/bookings/<int:pk>/',                 views.CharterBookingDetailView.as_view(),             name='charter-booking-detail'),
    path('charter/bookings/<int:pk>/send-agreement/',  views.CharterBookingSendAgreementView.as_view(),      name='charter-booking-send-agreement'),
    path('charter/bookings/<int:pk>/release-deposit/', views.CharterBookingReleaseDepositView.as_view(),     name='charter-booking-release-deposit'),
    # Agent Commissions
    path('charter/commissions/',                       views.CharterAgentCommissionListView.as_view(),       name='charter-commission-list'),
    path('charter/commissions/<int:pk>/',              views.CharterAgentCommissionDetailView.as_view(),     name='charter-commission-detail'),
    # Rental Units
    path('charter/rental-units/',                      views.RentalUnitListCreateView.as_view(),             name='rental-unit-list'),
    path('charter/rental-units/<int:pk>/',             views.RentalUnitDetailView.as_view(),                 name='rental-unit-detail'),
    # Rental Bookings — availability endpoint before <pk> to avoid conflict
    path('charter/rental-bookings/availability/',      views.RentalBookingAvailabilityView.as_view(),        name='rental-booking-availability'),
    path('charter/rental-bookings/',                   views.RentalBookingListCreateView.as_view(),          name='rental-booking-list'),
    path('charter/rental-bookings/<int:pk>/',          views.RentalBookingDetailView.as_view(),              name='rental-booking-detail'),
    # OTA Webhooks (no JWT auth)
    path('charter/webhooks/zizoo/',                    views.ZizooWebhookView.as_view(),                     name='charter-webhook-zizoo'),
    path('charter/webhooks/click-and-boat/',           views.ClickAndBoatWebhookView.as_view(),              name='charter-webhook-click-and-boat'),
    path('charter/webhooks/dropboxsign/',              views.DropboxSignWebhookView.as_view(),               name='charter-webhook-dropboxsign'),
]
