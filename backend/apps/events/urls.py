from django.urls import path
from .views import EventsPlaceholderView

urlpatterns = [
    path('events/', EventsPlaceholderView.as_view()),
]
