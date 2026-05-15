from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView, TokenVerifyView
from .views import LoginView, MeView, SendMagicLinkView, ExchangeMagicTokenView, SignupView, VerifyEmailView, ResendVerificationView, OnboardingView, DraftAccountView, ResumeView, ConnectOnboardView, ConnectStatusView
from apps.security.views import MFALoginVerifyView, MFALoginEnrollCompleteView

urlpatterns = [
    path('signup/', SignupView.as_view(), name='signup'),
    path('verify-email/', VerifyEmailView.as_view(), name='verify_email'),
    path('resend-verification/', ResendVerificationView.as_view(), name='resend_verification'),
    path('token/', LoginView.as_view(), name='token_obtain'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('token/verify/', TokenVerifyView.as_view(), name='token_verify'),
    path('token/mfa-verify/', MFALoginVerifyView.as_view(), name='token_mfa_verify'),
    path('token/mfa-enroll-complete/', MFALoginEnrollCompleteView.as_view(), name='token_mfa_enroll_complete'),
    path('me/', MeView.as_view(), name='me'),
    path('magic/send/', SendMagicLinkView.as_view(), name='magic_send'),
    path('magic/exchange/', ExchangeMagicTokenView.as_view(), name='magic_exchange'),
    path('marina/onboarding/', OnboardingView.as_view(), name='onboarding'),
    path('onboarding/draft/',  DraftAccountView.as_view(), name='onboarding_draft'),
    path('onboarding/resume/', ResumeView.as_view(),       name='onboarding_resume'),
    path('connect/onboard/',   ConnectOnboardView.as_view(), name='connect_onboard'),
    path('connect/status/',    ConnectStatusView.as_view(),  name='connect_status'),
]
