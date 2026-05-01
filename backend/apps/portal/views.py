from rest_framework import generics, permissions
from apps.accounts.views import IsMarinaStaff
from apps.billing.models import Invoice
from apps.reservations.models import Booking
from .models import AbsenceReport, CraneRequest
from .serializers import PortalInvoiceSerializer, AbsenceReportSerializer, CraneRequestSerializer, CraneRequestStaffSerializer


class IsBoater(permissions.BasePermission):
    message = 'No member profile linked to this account.'

    def has_permission(self, request, view):
        if not (request.user and request.user.is_authenticated and request.user.role == 'boater'):
            return False
        return hasattr(request.user, 'member_profile')


class PortalInvoiceListView(generics.ListAPIView):
    permission_classes = [IsBoater]
    serializer_class = PortalInvoiceSerializer

    def get_queryset(self):
        member = self.request.user.member_profile
        return Invoice.objects.filter(
            member=member,
            marina=self.request.user.marina,
        ).order_by('-issued')


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


class CraneRequestStaffListView(generics.ListAPIView):
    permission_classes = [IsMarinaStaff]
    serializer_class = CraneRequestStaffSerializer
    pagination_class = None

    def get_queryset(self):
        qs = CraneRequest.objects.filter(
            member__marina=self.request.user.marina
        ).select_related('member').order_by('-created_at')
        status = self.request.query_params.get('status')
        if status:
            qs = qs.filter(status=status)
        return qs


class CraneRequestStaffDetailView(generics.UpdateAPIView):
    permission_classes = [IsMarinaStaff]
    serializer_class = CraneRequestStaffSerializer
    http_method_names = ['patch']

    def get_queryset(self):
        return CraneRequest.objects.filter(member__marina=self.request.user.marina)


from .serializers import PortalBerthSerializer

class PortalBerthView(generics.ListAPIView):
    permission_classes = [IsBoater]
    serializer_class = PortalBerthSerializer
    pagination_class = None

    def get_queryset(self):
        member = self.request.user.member_profile
        return Booking.objects.filter(
            vessel__owner=member,
            marina=self.request.user.marina,
            status__in=['checked_in', 'pending'],
        ).select_related('berth__pier').order_by('-check_in')
