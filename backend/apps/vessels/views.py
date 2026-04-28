from rest_framework import generics
from rest_framework.generics import get_object_or_404
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter
from .models import Vessel, InsuranceRecord, SafetyEquipment, VesselCertificate
from .serializers import VesselSerializer, InsuranceSerializer, SafetySerializer, VesselCertificateSerializer


class VesselListCreateView(generics.ListCreateAPIView):
    serializer_class = VesselSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ['vessel_type', 'ais_active']
    search_fields = ['name', 'reg', 'mmsi']

    def get_queryset(self):
        return Vessel.objects.filter(marina=self.request.user.marina).select_related('insurance', 'safety', 'owner')

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class VesselDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = VesselSerializer

    def get_queryset(self):
        return Vessel.objects.filter(marina=self.request.user.marina).select_related('insurance', 'safety', 'owner')


class VesselInsuranceView(generics.RetrieveUpdateAPIView):
    serializer_class = InsuranceSerializer
    http_method_names = ['get', 'put', 'head', 'options']

    def get_object(self):
        vessel = get_object_or_404(Vessel, pk=self.kwargs['pk'], marina=self.request.user.marina)
        obj, _ = InsuranceRecord.objects.get_or_create(vessel=vessel, marina=self.request.user.marina)
        return obj


class VesselSafetyView(generics.RetrieveUpdateAPIView):
    serializer_class = SafetySerializer
    http_method_names = ['get', 'put', 'head', 'options']

    def get_object(self):
        vessel = get_object_or_404(Vessel, pk=self.kwargs['pk'], marina=self.request.user.marina)
        obj, _ = SafetyEquipment.objects.get_or_create(vessel=vessel, marina=self.request.user.marina)
        return obj


class VesselCertificateListView(generics.ListCreateAPIView):
    serializer_class = VesselCertificateSerializer

    def get_queryset(self):
        get_object_or_404(Vessel, pk=self.kwargs['pk'], marina=self.request.user.marina)
        return VesselCertificate.objects.filter(
            marina=self.request.user.marina,
            vessel_id=self.kwargs['pk'],
        )

    def perform_create(self, serializer):
        # get_queryset's ownership check does not run on create; this is the authoritative write gate.
        vessel = get_object_or_404(Vessel, pk=self.kwargs['pk'], marina=self.request.user.marina)
        serializer.save(marina=self.request.user.marina, vessel=vessel)


class VesselCertificateDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = VesselCertificateSerializer

    def get_object(self):
        return get_object_or_404(
            VesselCertificate,
            pk=self.kwargs['cert_pk'],
            vessel_id=self.kwargs['pk'],
            marina=self.request.user.marina,
        )
