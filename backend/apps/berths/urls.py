from django.urls import path
from .views import PierListView, BerthListView, BerthDetailView, MapConfigView

urlpatterns = [
    path('piers/', PierListView.as_view(), name='pier_list'),
    path('berths/', BerthListView.as_view(), name='berth_list'),
    path('berths/<int:pk>/', BerthDetailView.as_view(), name='berth_detail'),
    path('map/config/', MapConfigView.as_view(), name='map_config'),
]
