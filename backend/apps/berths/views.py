from rest_framework import generics, status as http_status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django.shortcuts import get_object_or_404
from django.db import IntegrityError
from django.db.models import Q

from apps.admin_portal.permissions import IsSafeModeReadOnly
from .models import Pier, Berth, MarinaMapConfig, Amenity, MapPrefab
from .serializers import (
    PierSerializer, BerthSerializer,
    BulkGenerateSerializer, MarinaMapConfigSerializer,
    AmenitySerializer, MapPrefabSerializer,
)


def resolve_pier_code(marina, code_template):
    """Replace {n} in code_template with the next available integer for this marina."""
    if '{n}' not in code_template:
        return code_template
    prefix, suffix = code_template.split('{n}', 1)
    existing = set(
        Pier.objects.filter(marina=marina).values_list('code', flat=True)
    )
    for n in range(1, 10_000):
        candidate = f'{prefix}{n}{suffix}'
        if candidate not in existing:
            return candidate
    from rest_framework.exceptions import ValidationError
    raise ValidationError({'code': 'Could not find an available pier code slot.'})


class PierListCreateView(generics.ListCreateAPIView):
    serializer_class = PierSerializer
    pagination_class = None  # canvas client needs all piers in one response

    def get_queryset(self):
        return Pier.objects.filter(marina=self.request.user.marina).prefetch_related('berths')

    def perform_create(self, serializer):
        marina = self.request.user.marina
        raw_code = serializer.validated_data.get('code', '')
        for _ in range(10):
            resolved_code = resolve_pier_code(marina, raw_code)
            try:
                serializer.save(marina=marina, code=resolved_code)
                return
            except IntegrityError:
                pass  # concurrent request claimed this slot; retry with next n
        from rest_framework.exceptions import ValidationError
        raise ValidationError({'code': 'Could not allocate a unique pier code after retries.'})


class PierDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = PierSerializer

    def get_queryset(self):
        return Pier.objects.filter(marina=self.request.user.marina).prefetch_related('berths')


class BerthListCreateView(generics.ListCreateAPIView):
    serializer_class = BerthSerializer
    filterset_fields = ['status', 'pier']
    pagination_class = None  # canvas client needs all berths in one response

    def get_queryset(self):
        return Berth.objects.filter(marina=self.request.user.marina).select_related(
            'pier', 'vessel'
        )

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class BerthDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = BerthSerializer

    def get_queryset(self):
        return Berth.objects.filter(marina=self.request.user.marina)


class BulkGenerateBerthsView(APIView):
    """POST /piers/{pk}/bulk-generate/ — create many berths for a pier in one request."""
    permission_classes = [IsAuthenticated, IsSafeModeReadOnly]

    def post(self, request, pk):
        pier = get_object_or_404(Pier, pk=pk, marina=request.user.marina)
        ser = BulkGenerateSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=http_status.HTTP_400_BAD_REQUEST)

        d = ser.validated_data
        marina = request.user.marina

        existing_codes = set(
            Berth.objects.filter(marina=marina).values_list('code', flat=True)
        )

        to_create = []
        for i in range(d['start'], d['end'] + 1):
            code = f"{d['prefix']}{i}"
            if code not in existing_codes:
                to_create.append(Berth(
                    marina=marina,
                    pier=pier,
                    code=code,
                    length_m=d.get('length_m'),
                    max_beam_m=d.get('max_beam_m'),
                    max_draft_m=d.get('max_draft_m'),
                    price_per_night=d.get('price_per_night'),
                    amenities=d.get('amenities', []),
                    position_index=i,
                    # canvas coords intentionally None — unmapped until editor places them
                ))

        created = Berth.objects.bulk_create(to_create)
        # bulk_create doesn't return PKs on all backends; re-fetch to include ids
        codes = [b.code for b in created]
        created_with_ids = list(
            Berth.objects.filter(marina=marina, code__in=codes).select_related('pier', 'vessel')
        )
        return Response(
            BerthSerializer(created_with_ids, many=True).data,
            status=http_status.HTTP_201_CREATED,
        )


class MapConfigView(generics.RetrieveUpdateAPIView):
    serializer_class = MarinaMapConfigSerializer

    def get_object(self):
        obj, _ = MarinaMapConfig.objects.get_or_create(marina=self.request.user.marina)
        return obj


class AmenityListCreateView(generics.ListCreateAPIView):
    serializer_class = AmenitySerializer
    pagination_class = None

    def get_queryset(self):
        return Amenity.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class AmenityDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = AmenitySerializer

    def get_queryset(self):
        return Amenity.objects.filter(marina=self.request.user.marina)


class MapPrefabListCreateView(generics.ListCreateAPIView):
    serializer_class = MapPrefabSerializer
    pagination_class = None

    def get_queryset(self):
        marina = self.request.user.marina
        return MapPrefab.objects.filter(Q(marina=marina) | Q(is_base=True))

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina, is_base=False)


class MapPrefabDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = MapPrefabSerializer

    def get_queryset(self):
        marina = self.request.user.marina
        return MapPrefab.objects.filter(Q(marina=marina) | Q(is_base=True))

    def get_object(self):
        obj = super().get_object()
        if self.request.method not in ('GET', 'HEAD', 'OPTIONS') and obj.is_base:
            raise PermissionDenied('Base prefabs cannot be modified.')
        return obj
