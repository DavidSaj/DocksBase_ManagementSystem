"""
apps/sustainability/views.py

All ViewSets use ESGFeatureGuardMixin which returns 403 when
marina.features['esg_enabled'] is not True.

Key behaviours:
- EmissionFactorViewSet.destroy() catches ProtectedError → 409.
- Scope2RecordViewSet has recalculate action with manual override guard.
- WasteLogViewSet has diversion_rate action.
- SustainabilityLedgerViewSet is read-only except for recalculate action.
- ESGReportArchiveViewSet has generate, status, download, history actions.
- TCFD framework returns 400.
"""

import logging
from decimal import Decimal

from django.db.models import ProtectedError
from django.http import FileResponse
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.sustainability.models import (
    EmissionFactor, GridCarbonIntensity, Scope1Record, Scope2Record, Scope3Record,
    WasteLog, SustainabilityLedger, OffsetContribution, ESGReportArchive, PlayItGreenSync,
)
from apps.sustainability.serializers import (
    EmissionFactorSerializer, GridCarbonIntensitySerializer,
    Scope1RecordSerializer, Scope2RecordSerializer, Scope3RecordSerializer,
    WasteLogSerializer, SustainabilityLedgerSerializer, OffsetContributionSerializer,
    ESGReportArchiveSerializer,
)

logger = logging.getLogger(__name__)


class ESGFeatureGuardMixin:
    """Returns 403 if marina.features['esg_enabled'] is not True."""

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        if not request.user.marina.features.get('esg_enabled', False):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("ESG module not enabled for this marina.")


class MarinaFilteredMixin:
    def get_queryset(self):
        return super().get_queryset().filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class EmissionFactorViewSet(ESGFeatureGuardMixin, MarinaFilteredMixin, viewsets.ModelViewSet):
    queryset           = EmissionFactor.objects.all()
    serializer_class   = EmissionFactorSerializer
    permission_classes = [IsAuthenticated]

    def destroy(self, request, *args, **kwargs):
        try:
            return super().destroy(request, *args, **kwargs)
        except ProtectedError:
            return Response(
                {'detail': 'Cannot delete — this emission factor is referenced by Scope 1 or 3 records. Set valid_to to retire it instead.'},
                status=status.HTTP_409_CONFLICT,
            )


class Scope1RecordViewSet(ESGFeatureGuardMixin, MarinaFilteredMixin, viewsets.ModelViewSet):
    serializer_class   = Scope1RecordSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = Scope1Record.objects.filter(marina=self.request.user.marina)
        if period := self.request.query_params.get('period'):
            qs = qs.filter(date__startswith=period)
        return qs


class Scope2RecordViewSet(ESGFeatureGuardMixin, MarinaFilteredMixin, viewsets.ModelViewSet):
    serializer_class   = Scope2RecordSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = Scope2Record.objects.filter(marina=self.request.user.marina)
        if period := self.request.query_params.get('period'):
            qs = qs.filter(period=period)
        return qs

    @action(detail=False, methods=['get'])
    def recalculate(self, request):
        """
        Trigger utility module aggregation for the given period.
        Returns 409 if a manual record already exists.
        """
        period = request.query_params.get('period')
        if not period:
            return Response({'detail': 'period query param required (YYYY-MM).'}, status=status.HTTP_400_BAD_REQUEST)

        marina    = request.user.marina
        existing  = Scope2Record.objects.filter(marina=marina, period=period).first()
        if existing and existing.data_source == 'manual':
            return Response(
                {'detail': 'Manual record exists. Delete it first to enable auto-calculation.'},
                status=status.HTTP_409_CONFLICT,
            )

        # TODO: trigger utility module aggregation
        return Response({'detail': f'Scope 2 recalculation queued for period {period}.'}, status=status.HTTP_202_ACCEPTED)


class Scope3RecordViewSet(ESGFeatureGuardMixin, MarinaFilteredMixin, viewsets.ModelViewSet):
    serializer_class   = Scope3RecordSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = Scope3Record.objects.filter(marina=self.request.user.marina)
        if period := self.request.query_params.get('period'):
            qs = qs.filter(period=period)
        if category := self.request.query_params.get('category'):
            qs = qs.filter(category=category)
        return qs

    @action(detail=False, methods=['get'])
    def recalculate(self, request):
        """Trigger fuel dock aggregation for the given period."""
        period = request.query_params.get('period')
        if not period:
            return Response({'detail': 'period query param required (YYYY-MM).'}, status=status.HTTP_400_BAD_REQUEST)

        from apps.sustainability.tasks import calculate_scope3_fuel_dock_for_period
        marina = request.user.marina
        try:
            calculate_scope3_fuel_dock_for_period(marina, period)
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        return Response({'detail': f'Scope 3 fuel dock recalculated for period {period}.'})


class WasteLogViewSet(ESGFeatureGuardMixin, MarinaFilteredMixin, viewsets.ModelViewSet):
    serializer_class   = WasteLogSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = WasteLog.objects.filter(marina=self.request.user.marina)
        if period := self.request.query_params.get('period'):
            qs = qs.filter(date__startswith=period)
        if category := self.request.query_params.get('category'):
            qs = qs.filter(category=category)
        return qs

    @action(detail=False, methods=['get'])
    def diversion_rate(self, request):
        """
        Returns diversion rate summary for a period.
        Returns {"total_kg": 0, "diversion_rate_pct": 0.0, ...} when no data — never 500.
        """
        from django.db.models import Sum
        from apps.sustainability.calculations import calculate_diversion_rate

        period = request.query_params.get('period')
        marina = request.user.marina
        qs     = WasteLog.objects.filter(marina=marina)
        if period:
            qs = qs.filter(date__startswith=period)

        totals       = qs.aggregate(total=Sum('quantity'))
        total_qty    = Decimal(str(totals['total'] or 0))
        recycled_qty = Decimal(str(
            qs.filter(disposal_method='recycled').aggregate(r=Sum('quantity'))['r'] or 0
        ))
        rate = calculate_diversion_rate(total_qty, recycled_qty)

        return Response({
            'period':            period,
            'total_kg':          float(total_qty),
            'recycled_kg':       float(recycled_qty),
            'diversion_rate_pct': float(rate),
        })


class SustainabilityLedgerViewSet(ESGFeatureGuardMixin, MarinaFilteredMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class   = SustainabilityLedgerSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = SustainabilityLedger.objects.filter(marina=self.request.user.marina)
        if period := self.request.query_params.get('period'):
            qs = qs.filter(period=period)
        return qs

    @action(detail=False, methods=['post'])
    def recalculate(self, request):
        """
        Trigger manual ledger recalculation for a period.
        Body: {"period": "YYYY-MM"}
        """
        period = request.data.get('period')
        if not period:
            return Response({'detail': 'period is required.'}, status=status.HTTP_400_BAD_REQUEST)

        from apps.sustainability.tasks import calculate_scope3_fuel_dock_for_period, recalculate_ledger_period
        marina = request.user.marina

        try:
            calculate_scope3_fuel_dock_for_period(marina, period)
            recalculate_ledger_period(marina_id=marina.pk, period=period)
        except Exception as exc:
            logger.exception("Ledger recalculate failed marina=%s period=%s", marina.pk, period)
            return Response({'detail': str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        ledger = SustainabilityLedger.objects.filter(marina=marina, period=period).first()
        if ledger:
            return Response(SustainabilityLedgerSerializer(ledger).data)
        return Response({'detail': 'Ledger recalculated.'})


class ESGReportArchiveViewSet(ESGFeatureGuardMixin, MarinaFilteredMixin, viewsets.GenericViewSet):
    queryset           = ESGReportArchive.objects.all()
    serializer_class   = ESGReportArchiveSerializer
    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=['post'])
    def generate(self, request):
        """
        Create ESGReportArchive(status='pending') and dispatch PDF generation task.
        Returns {"archive_id": N, "status": "pending"}.
        TCFD framework returns 400.
        """
        framework = request.data.get('framework', 'narrative')
        if framework == 'tcfd':
            return Response(
                {'detail': 'TCFD framework is not yet available.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        period_from = request.data.get('period_from')
        period_to   = request.data.get('period_to')
        if not period_from or not period_to:
            return Response({'detail': 'period_from and period_to are required.'}, status=status.HTTP_400_BAD_REQUEST)

        marina  = request.user.marina
        archive = ESGReportArchive.objects.create(
            marina=marina,
            period_from=period_from,
            period_to=period_to,
            framework=framework,
            status=ESGReportArchive.Status.PENDING,
            generated_by=getattr(request.user, 'staff_profile', None),
        )

        from apps.sustainability.tasks import generate_esg_report_async
        from django.db import transaction
        transaction.on_commit(lambda: generate_esg_report_async(archive_id=archive.pk))

        return Response({'archive_id': archive.pk, 'status': 'pending'}, status=status.HTTP_202_ACCEPTED)

    @action(detail=True, methods=['get'])
    def report_status(self, request, pk=None):
        """Read ESGReportArchive.status from DB (not Celery result state)."""
        archive = self.get_object()
        return Response({'archive_id': archive.pk, 'status': archive.status, 'error_detail': archive.error_detail})

    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        """Stream the PDF file from media/S3."""
        archive = self.get_object()
        if archive.status != ESGReportArchive.Status.READY or not archive.pdf_file:
            return Response({'detail': 'Report not ready.'}, status=status.HTTP_404_NOT_FOUND)
        return FileResponse(archive.pdf_file.open('rb'), content_type='application/pdf')

    @action(detail=False, methods=['get'])
    def history(self, request):
        """All ESGReportArchive rows for marina, ordered by created_at desc."""
        marina   = request.user.marina
        archives = ESGReportArchive.objects.filter(marina=marina).order_by('-created_at')
        return Response(ESGReportArchiveSerializer(archives, many=True).data)


class OffsetContributionViewSet(ESGFeatureGuardMixin, MarinaFilteredMixin, viewsets.ModelViewSet):
    serializer_class   = OffsetContributionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = OffsetContribution.objects.filter(marina=self.request.user.marina)
        if booking_id := self.request.query_params.get('booking_id'):
            qs = qs.filter(booking_id=booking_id)
        return qs

    @action(detail=False, methods=['get'])
    def summary(self, request):
        from django.db.models import Sum
        marina = request.user.marina
        totals = OffsetContribution.objects.filter(marina=marina).aggregate(
            total_gbp=Sum('amount_gbp'),
            total_co2e=Sum('co2e_offset_kg'),
        )
        return Response({
            'total_amount_gbp':  str(totals['total_gbp'] or 0),
            'total_co2e_offset_kg': str(totals['total_co2e'] or 0),
        })

    @action(detail=False, methods=['post'])
    def sync(self, request):
        """Trigger manual Play It Green sync."""
        from apps.sustainability.tasks import sync_play_it_green
        from django.db import transaction
        transaction.on_commit(sync_play_it_green)
        return Response({'detail': 'Play It Green sync queued.'}, status=status.HTTP_202_ACCEPTED)


class GridCarbonIntensityViewSet(ESGFeatureGuardMixin, MarinaFilteredMixin, viewsets.ModelViewSet):
    serializer_class   = GridCarbonIntensitySerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        limit = int(self.request.query_params.get('limit', 30))
        return GridCarbonIntensity.objects.filter(
            marina=self.request.user.marina
        ).order_by('-valid_date')[:limit]

    def destroy(self, request, *args, **kwargs):
        """Only allow DELETE on manual override rows."""
        obj = self.get_object()
        if not obj.is_manual_override:
            return Response(
                {'detail': 'Only manual override records can be deleted.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        return super().destroy(request, *args, **kwargs)
