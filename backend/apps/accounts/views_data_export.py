"""
Marina data-export API.

  POST   /marina/exports/              create a new export, returns the row
  GET    /marina/exports/              list this marina's exports
  GET    /marina/exports/<id>/download/  302-redirect to a signed download URL
                                       (404 if the export isn't ready or expired)

The download view re-signs on every call so a stale URL pasted into a
chat thread can't keep working past the configured retention.
"""

import logging
from datetime import timedelta

from django.core.files.storage import default_storage
from django.http import HttpResponseRedirect
from django.shortcuts import get_object_or_404
from django.utils import timezone

from rest_framework import status as http_status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import DataExport
from apps.accounts.data_export import generate_data_export, EXPORT_TTL_DAYS

logger = logging.getLogger(__name__)

# Rate-limit per marina: no more than one running + a cap on per-day count.
MAX_PENDING_PER_MARINA = 1
MAX_DAILY_PER_MARINA   = 10


def _serialize(export: DataExport):
    return {
        'id':              export.pk,
        'status':          export.status,
        'requested_by':    export.requested_by_id,
        'size_bytes':      export.size_bytes,
        'entity_counts':   export.entity_counts,
        'error_message':   export.error_message,
        'created_at':      export.created_at.isoformat() if export.created_at else None,
        'ready_at':        export.ready_at.isoformat() if export.ready_at else None,
        'expires_at':      export.expires_at.isoformat() if export.expires_at else None,
        'downloadable':    export.status == DataExport.Status.READY
                             and bool(export.file_path)
                             and (not export.expires_at or export.expires_at > timezone.now()),
    }


class DataExportListCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        marina = request.user.marina
        qs = DataExport.objects.filter(marina=marina).order_by('-created_at')[:20]
        return Response({'results': [_serialize(e) for e in qs]})

    def post(self, request):
        marina = request.user.marina
        if marina is None:
            return Response({'detail': 'User is not attached to a marina.'},
                            status=http_status.HTTP_400_BAD_REQUEST)

        # Block if there's already a queued/running export.
        pending = DataExport.objects.filter(
            marina=marina,
            status__in=[DataExport.Status.PENDING, DataExport.Status.RUNNING],
        ).count()
        if pending >= MAX_PENDING_PER_MARINA:
            return Response(
                {'detail': 'An export is already in progress. Please wait for it to finish.'},
                status=http_status.HTTP_409_CONFLICT,
            )

        # Per-day cap to prevent abuse.
        today_count = DataExport.objects.filter(
            marina=marina,
            created_at__gte=timezone.now() - timedelta(days=1),
        ).count()
        if today_count >= MAX_DAILY_PER_MARINA:
            return Response(
                {'detail': 'Daily export limit reached. Try again tomorrow.'},
                status=http_status.HTTP_429_TOO_MANY_REQUESTS,
            )

        export = DataExport.objects.create(
            marina=marina,
            requested_by=request.user,
            status=DataExport.Status.PENDING,
        )
        # Dispatch to Celery. .delay() avoids needing a result backend.
        try:
            generate_data_export.delay(export.pk)
        except Exception:
            # Celery broker may be unavailable — run inline as a fallback so
            # the export still happens. This is fine for low-volume marinas.
            logger.warning('Celery broker unavailable; running export inline.')
            generate_data_export(export.pk)
            export.refresh_from_db()

        return Response(_serialize(export), status=http_status.HTTP_201_CREATED)


class DataExportDownloadView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        marina = request.user.marina
        export = get_object_or_404(DataExport, pk=pk, marina=marina)
        if export.status != DataExport.Status.READY or not export.file_path:
            return Response({'detail': 'Export is not ready.'},
                            status=http_status.HTTP_404_NOT_FOUND)
        if export.expires_at and export.expires_at < timezone.now():
            return Response({'detail': 'Export link has expired.'},
                            status=http_status.HTTP_410_GONE)
        try:
            url = default_storage.url(export.file_path)
        except Exception:
            logger.exception('Failed to build signed URL for export %s', export.pk)
            return Response({'detail': 'Could not generate download link.'},
                            status=http_status.HTTP_500_INTERNAL_SERVER_ERROR)
        return HttpResponseRedirect(url)
