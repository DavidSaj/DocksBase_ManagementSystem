from rest_framework import generics, permissions
from apps.billing.models import Invoice
from .models import AbsenceReport, CraneRequest
from .serializers import PortalInvoiceSerializer, AbsenceReportSerializer, CraneRequestSerializer


class IsBoater(permissions.BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role == 'boater')


class PortalInvoiceListView(generics.ListAPIView):
    permission_classes = [IsBoater]
    serializer_class = PortalInvoiceSerializer

    def get_queryset(self):
        member = self.request.user.member_profile
        return Invoice.objects.filter(member=member).order_by('-issued')


class AbsenceReportCreateView(generics.CreateAPIView):
    permission_classes = [IsBoater]
    serializer_class = AbsenceReportSerializer

    def perform_create(self, serializer):
        member = self.request.user.member_profile
        serializer.save(member=member)


class CraneRequestListCreateView(generics.ListCreateAPIView):
    permission_classes = [IsBoater]
    serializer_class = CraneRequestSerializer

    def get_queryset(self):
        member = self.request.user.member_profile
        return CraneRequest.objects.filter(member=member)

    def perform_create(self, serializer):
        member = self.request.user.member_profile
        serializer.save(member=member)
