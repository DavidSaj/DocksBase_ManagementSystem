from django.urls import path
from .checkin_views import (
    MagicAuthView,
    PortalBookingView,
    PatchDimensionsView,
    SelfCheckinView,
)

urlpatterns = [
    path('portal/checkin/auth/magic/',                          MagicAuthView.as_view(),       name='portal_magic_auth'),
    path('portal/checkin/bookings/<int:pk>/',                   PortalBookingView.as_view(),   name='portal_booking'),
    path('portal/checkin/bookings/<int:pk>/dimensions/',        PatchDimensionsView.as_view(), name='portal_dimensions'),
    path('portal/checkin/bookings/<int:pk>/self-checkin/',      SelfCheckinView.as_view(),     name='portal_self_checkin'),
]
