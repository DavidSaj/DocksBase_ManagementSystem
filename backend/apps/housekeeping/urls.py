from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    ChecklistTemplateViewSet,
    CleaningScheduleViewSet,
    ConsumableStockViewSet,
    HousekeepingMatrixView,
    HousekeepingTaskViewSet,
    LinenInventoryViewSet,
)

router = DefaultRouter()
router.register('tasks',               HousekeepingTaskViewSet,   basename='housekeeping-task')
router.register('checklist-templates', ChecklistTemplateViewSet,   basename='checklist-template')
router.register('cleaning-schedules',  CleaningScheduleViewSet,   basename='cleaning-schedule')
router.register('linen',               LinenInventoryViewSet,     basename='linen-inventory')
router.register('consumables',         ConsumableStockViewSet,    basename='consumable-stock')

urlpatterns = [
    path('', include(router.urls)),
    path('matrix/', HousekeepingMatrixView.as_view(), name='housekeeping-matrix'),
]
