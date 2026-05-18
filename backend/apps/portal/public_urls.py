from django.urls import path, include
from apps.portal.views import MarinaPublicView
from apps.portal.public_booking_views import (
    PublicBookingCreateView,
    PublicAvailableBerthsView,
    PublicAvailabilityAlternativesView,
    PublicEngineRequestView,
    PublicBerthCategoriesView,
    PublicBerthIntentView,
)
from apps.reservations.public_reservation_views import (
    ReservationIntentView,
    ReservationConfirmView,
    InsuranceUploadView,
)

urlpatterns = [
    path('marina/',                             MarinaPublicView.as_view(),                    name='public-marina'),
    path('bookings/',                           PublicBookingCreateView.as_view(),             name='public-booking-create'),
    path('bookings/available-berths/',          PublicAvailableBerthsView.as_view(),           name='public-available-berths'),
    path('bookings/availability-alternatives/', PublicAvailabilityAlternativesView.as_view(),  name='public-availability-alternatives'),
    path('bookings/berth-categories/',          PublicBerthCategoriesView.as_view(),           name='public-berth-categories'),
    path('bookings/intent/',                    PublicBerthIntentView.as_view(),               name='public-berth-intent'),
    path('bookings/engine-request/',            PublicEngineRequestView.as_view(),             name='public-engine-request'),
    path('reservations/intent/',                ReservationIntentView.as_view(),               name='public-reservation-intent'),
    path('reservations/confirm/',               ReservationConfirmView.as_view(),              name='public-reservation-confirm'),
    path('reservations/insurance-upload/',      InsuranceUploadView.as_view(),                 name='public-reservation-insurance-upload'),
    path('', include('apps.activities.public_urls')),
]
