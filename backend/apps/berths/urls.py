from django.urls import path
from .views import (
    PierListCreateView, PierDetailView,
    BerthListCreateView, BerthDetailView,
    BulkGenerateBerthsView,
    MapConfigView,
)

urlpatterns = [
    path('piers/', PierListCreateView.as_view(), name='pier_list'),
    path('piers/<int:pk>/', PierDetailView.as_view(), name='pier_detail'),
    path('piers/<int:pk>/bulk-generate/', BulkGenerateBerthsView.as_view(), name='bulk_generate_berths'),
    path('berths/', BerthListCreateView.as_view(), name='berth_list'),
    path('berths/<int:pk>/', BerthDetailView.as_view(), name='berth_detail'),
    path('map/config/', MapConfigView.as_view(), name='map_config'),
]
