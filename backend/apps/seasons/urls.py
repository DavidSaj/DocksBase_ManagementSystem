from django.urls import include, path
from rest_framework.routers import DefaultRouter

from . import views

router = DefaultRouter()
router.register(r'seasons', views.SeasonViewSet, basename='season')
router.register(r'seasonal-rate-cards', views.SeasonalRateCardViewSet,
                basename='seasonal-rate-card')
router.register(r'instalment-plans', views.InstalmentPlanViewSet,
                basename='instalment-plan')
router.register(r'leases', views.BerthLeaseViewSet, basename='lease')

urlpatterns = [
    path('', include(router.urls)),
    path(
        'leases/<int:lease_pk>/instalments/<int:sequence>/mark-paid/',
        views.LeaseInstalmentMarkPaidView.as_view(),
        name='lease-instalment-mark-paid',
    ),
]
