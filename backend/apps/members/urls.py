from django.urls import path
from .views import MemberListCreateView, MemberDetailView, SegmentListCreateView, SegmentDetailView

urlpatterns = [
    path('members/', MemberListCreateView.as_view(), name='member_list'),
    path('members/<int:pk>/', MemberDetailView.as_view(), name='member_detail'),
    path('segments/', SegmentListCreateView.as_view(), name='segment_list'),
    path('segments/<int:pk>/', SegmentDetailView.as_view(), name='segment_detail'),
]
