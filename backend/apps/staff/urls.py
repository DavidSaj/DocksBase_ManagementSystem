from django.urls import path
from .views import StaffPlaceholderView

urlpatterns = [
    path('staff/', StaffPlaceholderView.as_view()),
]
