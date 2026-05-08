from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from apps.access_control.models import AccessReader
from apps.access_control.serializers import AccessReaderSerializer
from apps.access_control.views.mixins import MarinaFilteredMixin


class AccessReaderViewSet(MarinaFilteredMixin, viewsets.ModelViewSet):
    queryset         = AccessReader.objects.select_related('zone')
    serializer_class = AccessReaderSerializer

    @action(detail=True, methods=['post'])
    def sync(self, request, pk=None):
        """
        Dispatch a zone sync task for this reader → 202 Accepted.
        The task pushes the current allowed-credential list to the hardware.
        """
        reader = self.get_object()
        from apps.access_control.tasks import sync_zone_task
        # sync_zone_task.delay(reader.pk)  # when Celery is wired
        sync_zone_task(reader_id=reader.pk)
        return Response(
            {'detail': f'Sync queued for reader {reader.reader_uid}.'},
            status=status.HTTP_202_ACCEPTED,
        )
