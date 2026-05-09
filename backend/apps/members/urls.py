from django.urls import path
from .views import (
    MemberListCreateView, MemberDetailView,
    SegmentListCreateView, SegmentDetailView,
    BerthAgreementPDFView,
)

urlpatterns = [
    path('members/', MemberListCreateView.as_view(), name='member_list'),
    path('members/<int:pk>/', MemberDetailView.as_view(), name='member_detail'),
    path('members/<int:member_id>/berth-agreement-pdf/', BerthAgreementPDFView.as_view(), name='berth_agreement_pdf'),
    path('segments/', SegmentListCreateView.as_view(), name='segment_list'),
    path('segments/<int:pk>/', SegmentDetailView.as_view(), name='segment_detail'),
]
