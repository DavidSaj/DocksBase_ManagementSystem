from django.urls import path
from .views import SalesPlaceholderView

urlpatterns = [
    path('sales/', SalesPlaceholderView.as_view()),
]
