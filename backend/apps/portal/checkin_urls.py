from django.urls import path
from .checkin_views import (
    MagicAuthView,
    PortalBookingView,
    PatchDimensionsView,
    SelfCheckinView,
    WaiverView,
    DropboxSignWebhookView,
    InsuranceUploadView,
)

urlpatterns = [
    path('portal/checkin/auth/magic/',                              MagicAuthView.as_view(),            name='portal_magic_auth'),
    path('portal/checkin/bookings/<int:pk>/',                       PortalBookingView.as_view(),         name='portal_booking'),
    path('portal/checkin/bookings/<int:pk>/dimensions/',            PatchDimensionsView.as_view(),       name='portal_dimensions'),
    path('portal/checkin/bookings/<int:pk>/self-checkin/',          SelfCheckinView.as_view(),           name='portal_self_checkin'),
    path('portal/checkin/bookings/<int:pk>/waiver/',                WaiverView.as_view(),               name='portal_waiver'),
    path('portal/checkin/webhooks/dropbox-sign/',                   DropboxSignWebhookView.as_view(),   name='portal_dropbox_webhook'),
    path('portal/checkin/bookings/<int:pk>/insurance/',             InsuranceUploadView.as_view(),      name='portal_insurance'),
]
