from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    ActivityBookingViewSet,
    ActivityResourceRequirementViewSet,
    ActivityViewSet,
    CancellationPolicyViewSet,
)

router = DefaultRouter()
router.register('catalogue',                    ActivityViewSet,                    basename='activity')
router.register('bookings',                     ActivityBookingViewSet,             basename='activity-booking')
router.register('cancellation-policies',        CancellationPolicyViewSet,         basename='cancellation-policy')
router.register('activity-resource-requirements', ActivityResourceRequirementViewSet, basename='activity-resource-requirement')

urlpatterns = [path('', include(router.urls))]
