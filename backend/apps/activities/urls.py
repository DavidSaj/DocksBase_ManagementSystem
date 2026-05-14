from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    ActivityBookingViewSet,
    ActivityResourceRequirementViewSet,
    ActivityViewSet,
    CancellationPolicyViewSet,
)

router = DefaultRouter()
router.register('activity-catalogue',              ActivityViewSet,                    basename='activity')
router.register('activity-bookings',               ActivityBookingViewSet,             basename='activity-booking')
router.register('activity-cancellation-policies',  CancellationPolicyViewSet,          basename='activity-cancellation-policy')
router.register('activity-resource-requirements',  ActivityResourceRequirementViewSet, basename='activity-resource-requirement')

urlpatterns = [path('', include(router.urls))]
