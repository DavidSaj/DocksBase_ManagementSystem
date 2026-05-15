from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .views import (
    MFADisableView,
    MFAEnrollCompleteView,
    MFAEnrollStartView,
    MFALoginEnrollCompleteView,
    MFALoginVerifyView,
    MFAStatusView,
    IPAllowlistViewSet,
    WhoamiIPView,
    ReverifyEmailRequestView,
    ReverifyEmailConfirmView,
    AuditLogListView,
)

router = DefaultRouter()
router.register(r'security/ip-allowlist', IPAllowlistViewSet, basename='ip-allowlist')

urlpatterns = [
    # MFA settings-flow endpoints
    path('security/mfa/', MFAStatusView.as_view(), name='mfa-status'),
    path('security/mfa/start-enrollment/', MFAEnrollStartView.as_view(), name='mfa-start-enrollment'),
    path('security/mfa/complete-enrollment/', MFAEnrollCompleteView.as_view(), name='mfa-complete-enrollment'),
    path('security/mfa/disable/', MFADisableView.as_view(), name='mfa-disable'),

    # IP allowlist viewset (Task 2)
    path('', include(router.urls)),

    # Whoami-IP helper (Task 2)
    path('security/whoami-ip/', WhoamiIPView.as_view(), name='whoami-ip'),

    # Task 4: Audit log (owner-only, paginated, newest first)
    path('security/audit/', AuditLogListView.as_view(), name='security-audit'),

    # Task 3: Email re-verification endpoints.
    # These paths resolve to /api/v1/auth/reverify-email/... because
    # apps.security.urls is included at path('') under /api/v1/ in config/urls.py.
    path('auth/reverify-email/request/', ReverifyEmailRequestView.as_view(), name='reverify-email-request'),
    path('auth/reverify-email/confirm/', ReverifyEmailConfirmView.as_view(), name='reverify-email-confirm'),
]
