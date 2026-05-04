from django.urls import path
from .checkin_views import (
    MagicAuthView,
    PortalBookingView,
)

urlpatterns = [
    path('portal/checkin/auth/magic/',          MagicAuthView.as_view(),       name='portal_magic_auth'),
    path('portal/checkin/bookings/<int:pk>/',   PortalBookingView.as_view(),   name='portal_booking'),
]
