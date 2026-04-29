from django.urls import path
from .views import (
    HaulOutList, HaulOutDetail,
    StorageSlotList, StorageSlotDetail,
    LaunchRequestList, LaunchRequestDetail,
    WorkOrderList, WorkOrderDetail,
    PartList, PartDetail,
    ToolList, ToolDetail,
    ContractorList, ContractorDetail,
)

urlpatterns = [
    path('haul-outs/', HaulOutList.as_view()),
    path('haul-outs/<int:pk>/', HaulOutDetail.as_view()),
    path('storage-slots/', StorageSlotList.as_view()),
    path('storage-slots/<int:pk>/', StorageSlotDetail.as_view()),
    path('launch-requests/', LaunchRequestList.as_view()),
    path('launch-requests/<int:pk>/', LaunchRequestDetail.as_view()),
    path('work-orders/', WorkOrderList.as_view()),
    path('work-orders/<int:pk>/', WorkOrderDetail.as_view()),
    path('parts/', PartList.as_view()),
    path('parts/<int:pk>/', PartDetail.as_view()),
    path('tools/', ToolList.as_view()),
    path('tools/<int:pk>/', ToolDetail.as_view()),
    path('contractors/', ContractorList.as_view()),
    path('contractors/<int:pk>/', ContractorDetail.as_view()),
]
