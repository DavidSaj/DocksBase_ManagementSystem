from django.urls import path
from .views import (
    CertificationDetail, CertificationList,
    ShiftDetail, ShiftList,
    StaffDetail, StaffInviteView, StaffList, StaffSetupView,
)

urlpatterns = [
    path('staff/invite/', StaffInviteView.as_view()),
    path('staff/setup/<str:uidb64>/<str:token>/', StaffSetupView.as_view()),
    path('staff/', StaffList.as_view()),
    path('staff/<int:pk>/', StaffDetail.as_view()),
    path('shifts/', ShiftList.as_view()),
    path('shifts/<int:pk>/', ShiftDetail.as_view()),
    path('certifications/', CertificationList.as_view()),
    path('certifications/<int:pk>/', CertificationDetail.as_view()),
]
