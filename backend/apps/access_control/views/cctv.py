from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated

from apps.access_control.models import CCTVCamera
from apps.access_control.serializers import CCTVCameraSerializer
from apps.access_control.views.mixins import MarinaFilteredMixin


class CCTVCameraViewSet(MarinaFilteredMixin, viewsets.ModelViewSet):
    queryset           = CCTVCamera.objects.select_related('zone')
    serializer_class   = CCTVCameraSerializer
    permission_classes = [IsAuthenticated]
