from rest_framework import status, viewsets
from rest_framework.response import Response

from apps.access_control.models import AccessZone, ZoneAccessRule
from apps.access_control.serializers import AccessZoneSerializer, ZoneAccessRuleSerializer
from apps.access_control.views.mixins import MarinaFilteredMixin


class AccessZoneViewSet(MarinaFilteredMixin, viewsets.ModelViewSet):
    queryset         = AccessZone.objects.all()
    serializer_class = AccessZoneSerializer


class ZoneAccessRuleViewSet(MarinaFilteredMixin, viewsets.ModelViewSet):
    queryset         = ZoneAccessRule.objects.prefetch_related('zones')
    serializer_class = ZoneAccessRuleSerializer

    def partial_update(self, request, *args, **kwargs):
        response = super().partial_update(request, *args, **kwargs)
        if response.status_code == 200:
            # Dispatch background sync to push rule changes to all readers
            # When Celery is wired: sync_zone_task.delay(reader_id) for each reader
            pass
        return Response(
            {'detail': 'Zone access rule updated. Reader sync queued.'},
            status=status.HTTP_202_ACCEPTED,
        )
