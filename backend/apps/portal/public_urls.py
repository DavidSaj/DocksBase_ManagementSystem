from django.urls import path
from apps.portal.views import MarinaPublicView
from apps.portal.public_booking_views import PublicBookingCreateView

urlpatterns = [
    path('marina/', MarinaPublicView.as_view(), name='public-marina'),
    path('bookings/', PublicBookingCreateView.as_view(), name='public-booking-create'),
]
