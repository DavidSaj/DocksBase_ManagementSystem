from django.urls import path
from .views import (
    TaskList, TaskDetail,
    IncidentList, IncidentDetail,
    AssetList, AssetDetail,
    DefectList, DefectDetail, DefectCreateTaskView,
    MaintenanceTaskList, MaintenanceTaskDetail,
)

urlpatterns = [
    path('tasks/', TaskList.as_view()),
    path('tasks/<int:pk>/', TaskDetail.as_view()),
    path('incidents/', IncidentList.as_view()),
    path('incidents/<int:pk>/', IncidentDetail.as_view()),
    path('assets/', AssetList.as_view()),
    path('assets/<int:pk>/', AssetDetail.as_view()),
    path('defects/', DefectList.as_view()),
    path('defects/<int:pk>/', DefectDetail.as_view()),
    path('defects/<int:pk>/create-task/', DefectCreateTaskView.as_view()),
    path('maintenance-tasks/', MaintenanceTaskList.as_view()),
    path('maintenance-tasks/<int:pk>/', MaintenanceTaskDetail.as_view()),
]
