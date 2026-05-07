from django.urls import path
from apps.portal.views import MarinaPublicView
from apps.portal.public_booking_views import (
    PublicBookingCreateView,
    PublicAvailableBerthsView,
    PublicAvailabilityAlternativesView,
    PublicEngineRequestView,
    PublicBerthCategoriesView,
)

urlpatterns = [
    path('marina/',                             MarinaPublicView.as_view(),                    name='public-marina'),
    path('bookings/',                           PublicBookingCreateView.as_view(),             name='public-booking-create'),
    path('bookings/available-berths/',          PublicAvailableBerthsView.as_view(),           name='public-available-berths'),
    path('bookings/availability-alternatives/', PublicAvailabilityAlternativesView.as_view(),  name='public-availability-alternatives'),
    path('bookings/berth-categories/',           PublicBerthCategoriesView.as_view(),           name='public-berth-categories'),
    path('bookings/engine-request/',            PublicEngineRequestView.as_view(),             name='public-engine-request'),
]
