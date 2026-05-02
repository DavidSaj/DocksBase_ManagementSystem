from django.urls import path
from .views import MyAccountView, ActivatePortalView

urlpatterns = [
    path('my-account/', MyAccountView.as_view(), name='mobile_my_account'),
    path('activate/',   ActivatePortalView.as_view(), name='mobile_activate'),
]
