from django.db import transaction
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.tenants.models import CommercialUnit, TenantContact, Tenancy, TenancyDocument, RentScheduleEntry, TenancyTask
from apps.tenants.serializers import (
    CommercialUnitSerializer, TenantContactSerializer, TenancySerializer,
    TenancyDocumentSerializer, RentScheduleEntrySerializer, TenancyTaskSerializer,
)
from apps.tenants.services.rent_scheduler import run_rent_scheduler


class MarinaMixin:
    def get_marina(self):
        return self.request.user.marina


class CommercialUnitListCreateView(MarinaMixin, generics.ListCreateAPIView):
    serializer_class = CommercialUnitSerializer

    def get_queryset(self):
        return CommercialUnit.objects.filter(marina=self.get_marina())

    def perform_create(self, serializer):
        serializer.save(marina=self.get_marina())


class CommercialUnitDetailView(MarinaMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = CommercialUnitSerializer

    def get_queryset(self):
        return CommercialUnit.objects.filter(marina=self.get_marina())


class TenantContactListCreateView(MarinaMixin, generics.ListCreateAPIView):
    serializer_class = TenantContactSerializer

    def get_queryset(self):
        return TenantContact.objects.filter(marina=self.get_marina())

    def perform_create(self, serializer):
        serializer.save(marina=self.get_marina())


class TenantContactDetailView(MarinaMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = TenantContactSerializer

    def get_queryset(self):
        return TenantContact.objects.filter(marina=self.get_marina())


class TenancyListCreateView(MarinaMixin, generics.ListCreateAPIView):
    serializer_class = TenancySerializer

    def get_queryset(self):
        return Tenancy.objects.filter(marina=self.get_marina()).select_related('unit', 'tenant')

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        unit_id = serializer.validated_data.get('unit').pk if serializer.validated_data.get('unit') else None
        with transaction.atomic():
            if unit_id:
                Tenancy.objects.select_for_update().filter(unit_id=unit_id, status='active')
            serializer.save(marina=self.get_marina())
        headers = self.get_success_headers(serializer.data)
        return Response(serializer.data, status=status.HTTP_201_CREATED, headers=headers)


class TenancyDetailView(MarinaMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = TenancySerializer

    def get_queryset(self):
        return Tenancy.objects.filter(marina=self.get_marina())


class TenancyDocumentListCreateView(MarinaMixin, generics.ListCreateAPIView):
    serializer_class = TenancyDocumentSerializer

    def get_queryset(self):
        return TenancyDocument.objects.filter(
            marina=self.get_marina(), tenancy_id=self.kwargs['pk']
        )

    def perform_create(self, serializer):
        tenancy = Tenancy.objects.get(pk=self.kwargs['pk'], marina=self.get_marina())
        serializer.save(marina=self.get_marina(), tenancy=tenancy)


class RentScheduleListView(MarinaMixin, generics.ListAPIView):
    serializer_class = RentScheduleEntrySerializer

    def get_queryset(self):
        return RentScheduleEntry.objects.filter(
            marina=self.get_marina(), tenancy_id=self.kwargs['pk']
        )


class RentScheduleGenerateView(MarinaMixin, APIView):
    def post(self, request, pk):
        from django.utils import timezone
        marina = self.get_marina()
        tenancy = Tenancy.objects.get(pk=pk, marina=marina)
        today = timezone.now().date()
        year = request.data.get('year', today.year)
        month = request.data.get('month', today.month)
        run_rent_scheduler(marina, int(year), int(month))
        entries = RentScheduleEntry.objects.filter(tenancy=tenancy, marina=marina)
        return Response(RentScheduleEntrySerializer(entries, many=True).data)


class TenancyTaskListCreateView(MarinaMixin, generics.ListCreateAPIView):
    serializer_class = TenancyTaskSerializer

    def get_queryset(self):
        return TenancyTask.objects.filter(marina=self.get_marina())

    def perform_create(self, serializer):
        serializer.save(marina=self.get_marina())


class TenancyTaskDetailView(MarinaMixin, generics.RetrieveUpdateDestroyAPIView):
    serializer_class = TenancyTaskSerializer

    def get_queryset(self):
        return TenancyTask.objects.filter(marina=self.get_marina())


class RentScheduleGlobalListView(MarinaMixin, generics.ListAPIView):
    """Global rent schedule list across all tenancies — used by the Rent Schedule tab."""
    serializer_class = RentScheduleEntrySerializer

    def get_queryset(self):
        qs = RentScheduleEntry.objects.filter(
            marina=self.get_marina()
        ).select_related('tenancy__unit', 'tenancy__tenant').order_by('due_date')

        status_param = self.request.query_params.get('status')
        if status_param:
            qs = qs.filter(status=status_param)

        tenancy_id = self.request.query_params.get('tenancy')
        if tenancy_id:
            qs = qs.filter(tenancy_id=tenancy_id)

        return qs
