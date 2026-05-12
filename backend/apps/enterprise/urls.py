from django.urls import path
from .views import MeView, GroupOverviewView

urlpatterns = [
    path('me/',                             MeView.as_view(),          name='enterprise_me'),
    path('groups/<int:pk>/overview/',       GroupOverviewView.as_view(), name='enterprise_overview'),
]
