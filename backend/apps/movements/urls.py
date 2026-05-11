from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import VesselMovementViewSet

router = DefaultRouter()
router.register(r'berths/movements', VesselMovementViewSet, basename='vessel-movement')

urlpatterns = router.urls
