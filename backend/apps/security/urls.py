from django.urls import path

from .views import (
    MFADisableView,
    MFAEnrollCompleteView,
    MFAEnrollStartView,
    MFALoginEnrollCompleteView,
    MFALoginVerifyView,
    MFAStatusView,
)

urlpatterns = [
    path('security/mfa/', MFAStatusView.as_view(), name='mfa-status'),
    path('security/mfa/start-enrollment/', MFAEnrollStartView.as_view(), name='mfa-start-enrollment'),
    path('security/mfa/complete-enrollment/', MFAEnrollCompleteView.as_view(), name='mfa-complete-enrollment'),
    path('security/mfa/disable/', MFADisableView.as_view(), name='mfa-disable'),
]
