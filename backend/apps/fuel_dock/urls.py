from django.urls import path
from .views import (
    FuelQueueListCreateView, FuelQueueDetailView,
    FuelProductListView, FuelProductPriceUpdateView, FuelPriceChangeListView,
)

urlpatterns = [
    path('fuel-dock/queue/',                       FuelQueueListCreateView.as_view(),    name='fuel_queue_list'),
    path('fuel-dock/queue/<int:pk>/',              FuelQueueDetailView.as_view(),        name='fuel_queue_detail'),
    path('fuel-dock/products/',                    FuelProductListView.as_view(),        name='fuel_product_list'),
    path('fuel-dock/products/<int:pk>/price/',     FuelProductPriceUpdateView.as_view(), name='fuel_product_price'),
    path('fuel-dock/price-history/',               FuelPriceChangeListView.as_view(),    name='fuel_price_history'),
]
