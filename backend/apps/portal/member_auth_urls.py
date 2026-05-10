from django.urls import path

from .member_auth_views import (
    MemberMagicRefreshView,
    MemberMagicRequestView,
    MemberMagicVerifyView,
)

urlpatterns = [
    path('portal/auth/member-magic/request/', MemberMagicRequestView.as_view(), name='member_magic_request'),
    path('portal/auth/member-magic/verify/',  MemberMagicVerifyView.as_view(),  name='member_magic_verify'),
    path('portal/auth/member-magic/refresh/', MemberMagicRefreshView.as_view(), name='member_magic_refresh'),
]
