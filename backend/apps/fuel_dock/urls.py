from django.urls import path
from .views import FuelQueueListCreateView, FuelQueueDetailView

urlpatterns = [
    path('fuel-dock/queue/',          FuelQueueListCreateView.as_view(), name='fuel_queue_list'),
    path('fuel-dock/queue/<int:pk>/', FuelQueueDetailView.as_view(),    name='fuel_queue_detail'),
]
