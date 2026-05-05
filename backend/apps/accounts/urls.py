from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView, TokenVerifyView
from .views import LoginView, MeView, SendMagicLinkView, ExchangeMagicTokenView, SignupView, VerifyEmailView, ResendVerificationView, OnboardingView, ChannelSettingsView, DraftAccountView

urlpatterns = [
    path('signup/', SignupView.as_view(), name='signup'),
    path('verify-email/', VerifyEmailView.as_view(), name='verify_email'),
    path('resend-verification/', ResendVerificationView.as_view(), name='resend_verification'),
    path('token/', LoginView.as_view(), name='token_obtain'),
    path('token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('token/verify/', TokenVerifyView.as_view(), name='token_verify'),
    path('me/', MeView.as_view(), name='me'),
    path('magic/send/', SendMagicLinkView.as_view(), name='magic_send'),
    path('magic/exchange/', ExchangeMagicTokenView.as_view(), name='magic_exchange'),
    path('marina/onboarding/', OnboardingView.as_view(), name='onboarding'),
    path('marina/channel-settings/', ChannelSettingsView.as_view(), name='channel_settings'),
    path('onboarding/draft/', DraftAccountView.as_view(), name='onboarding_draft'),
]
