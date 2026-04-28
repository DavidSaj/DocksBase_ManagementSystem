from rest_framework import generics
from rest_framework.filters import SearchFilter
from django_filters.rest_framework import DjangoFilterBackend
from .models import Member, Segment
from .serializers import MemberSerializer, SegmentSerializer


class MemberListCreateView(generics.ListCreateAPIView):
    serializer_class = MemberSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ['member_type', 'insurance_status', 'docs_status']
    search_fields = ['name', 'email']

    def get_queryset(self):
        return Member.objects.filter(marina=self.request.user.marina).prefetch_related('vessels')

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class MemberDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = MemberSerializer

    def get_queryset(self):
        return Member.objects.filter(marina=self.request.user.marina)


class SegmentListCreateView(generics.ListCreateAPIView):
    serializer_class = SegmentSerializer

    def get_queryset(self):
        return Segment.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class SegmentDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = SegmentSerializer

    def get_queryset(self):
        return Segment.objects.filter(marina=self.request.user.marina)
