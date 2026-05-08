from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from apps.access_control.models import ANPRCamera, VehicleRegistration, ANPREvent
from apps.access_control.serializers import (
    ANPRCameraSerializer, VehicleRegistrationSerializer, ANPREventSerializer,
)
from apps.access_control.views.mixins import MarinaFilteredMixin


class ANPRFeatureGuardMixin:
    """Returns 403 if marina.features['anpr_enabled'] is not True."""

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not request.user.marina.features.get('anpr_enabled', False):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("ANPR module not enabled for this marina.")


class ANPRCameraViewSet(ANPRFeatureGuardMixin, MarinaFilteredMixin, viewsets.ModelViewSet):
    queryset         = ANPRCamera.objects.select_related('zone')
    serializer_class = ANPRCameraSerializer
    permission_classes = [IsAuthenticated]

    # Exclude DELETE — ANPR cameras are deactivated, not deleted
    http_method_names = ['get', 'post', 'patch', 'head', 'options']


class VehicleRegistrationViewSet(ANPRFeatureGuardMixin, MarinaFilteredMixin, viewsets.ModelViewSet):
    serializer_class = VehicleRegistrationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = VehicleRegistration.objects.select_related('member').filter(marina=self.request.user.marina)
        if member_id := self.request.query_params.get('member'):
            qs = qs.filter(member_id=member_id)
        return qs


class ANPREventViewSet(ANPRFeatureGuardMixin, MarinaFilteredMixin, viewsets.ModelViewSet):
    """
    ANPR audit log. Read-only except PATCH is allowed to update staff_reviewed flag.
    DELETE is disabled — ANPR events are immutable audit records.
    """
    serializer_class = ANPREventSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'patch', 'head', 'options']

    def get_queryset(self):
        qs     = ANPREvent.objects.select_related('camera', 'vehicle', 'matched_member')
        qs     = qs.filter(marina=self.request.user.marina)
        params = self.request.query_params

        if plate := params.get('plate'):
            qs = qs.filter(plate_detected__icontains=plate)
        if member_id := params.get('member'):
            qs = qs.filter(matched_member_id=member_id)
        if camera_id := params.get('camera'):
            qs = qs.filter(camera_id=camera_id)
        if granted := params.get('access_granted'):
            qs = qs.filter(access_granted=granted.lower() == 'true')
        if params.get('unrecognised') == 'true':
            qs = qs.filter(matched_member__isnull=True)
        if from_dt := params.get('from'):
            qs = qs.filter(occurred_at__gte=from_dt)
        if to_dt := params.get('to'):
            qs = qs.filter(occurred_at__lte=to_dt)

        return qs
