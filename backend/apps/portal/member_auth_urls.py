from django.urls import path

from .member_auth_views import (
    BoaterRefreshView,
    MemberMagicRefreshView,
    MemberMagicVerifyView,
    GuestInstantLoginView,
    UnifiedRequestLinkView,
)

urlpatterns = [
    path('portal/auth/member-magic/verify/',  MemberMagicVerifyView.as_view(),  name='member_magic_verify'),
    path('portal/auth/member-magic/refresh/', MemberMagicRefreshView.as_view(), name='member_magic_refresh'),
    path('portal/auth/boater/refresh/',       BoaterRefreshView.as_view(),      name='boater_refresh'),
    path('portal/auth/guest-instant/',        GuestInstantLoginView.as_view(),  name='guest_instant'),
    path('portal/auth/request-link/',         UnifiedRequestLinkView.as_view(), name='request_link'),
]
