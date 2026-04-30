from django.urls import path
from .views import RestaurantPlaceholderView

urlpatterns = [
    path('restaurant/', RestaurantPlaceholderView.as_view()),
]
