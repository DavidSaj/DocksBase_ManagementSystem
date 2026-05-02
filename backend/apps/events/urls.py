from django.urls import path
from .views import EventListCreateView, EventDetailView, VenueHireListCreateView, VenueHireDetailView

urlpatterns = [
    path('events/', EventListCreateView.as_view()),
    path('events/<int:pk>/', EventDetailView.as_view()),
    path('venue-hires/', VenueHireListCreateView.as_view()),
    path('venue-hires/<int:pk>/', VenueHireDetailView.as_view()),
]
