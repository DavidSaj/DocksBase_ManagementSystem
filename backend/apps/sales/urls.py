from django.urls import path
from .views import ListingListCreateView, ListingDetailView, LeadListCreateView, LeadDetailView

urlpatterns = [
    path('listings/', ListingListCreateView.as_view()),
    path('listings/<int:pk>/', ListingDetailView.as_view()),
    path('leads/', LeadListCreateView.as_view()),
    path('leads/<int:pk>/', LeadDetailView.as_view()),
]
