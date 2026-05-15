from django.urls import path
from .public_views import (
    PublicActivityListView, PublicActivitySlotsView, PublicActivityRequestView,
)

urlpatterns = [
    path('activities/',                              PublicActivityListView.as_view(),    name='public-activity-list'),
    path('activities/<int:activity_id>/slots/',      PublicActivitySlotsView.as_view(),   name='public-activity-slots'),
    path('activity-requests/',                       PublicActivityRequestView.as_view(), name='public-activity-request'),
]
