"""
Endpoints for Accounting & Tax Export + Stripe Payout reconciliation.

  POST /api/v1/accounting/exports/                 — create an export.
  GET  /api/v1/accounting/exports/                 — list recent exports.
  GET  /api/v1/accounting/exports/<id>/            — single export.
  GET  /api/v1/accounting/exports/<id>/download/   — stream the file.
  GET  /api/v1/accounting/payouts/                 — list Stripe payouts.
  GET  /api/v1/accounting/payouts/<id>/            — single payout.
  GET  /api/v1/accounting/tax-summary/             — JSON jurisdiction roll-up.
  CRUD /api/v1/accounting/gl-mappings/
  CRUD /api/v1/accounting/tax-codes/

Sync vs async: branched purely on (end_date - start_date). <= 31 days → run
the generator inline and return the job (with file URL) immediately. >= 32
days → leave the job queued and return it for the client to poll.

Per the spec's locked decisions, there is NO COUNT(*) pre-query and NO
rolling-12-months / YTD preset.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from django.http import FileResponse, Http404, JsonResponse
from rest_framework import serializers, viewsets, status as http_status
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounting.exports import get_generator
from apps.accounting.exports.tax_summary import build_rows as _tax_summary_rows
from apps.accounting.models import ExportJob, GLCodeMapping, Payout, PayoutLine, TaxCode


SYNC_THRESHOLD_DAYS = 31  # locked: ≤31 → sync, ≥32 → async.


def _marina(request):
    return request.user.marina


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------

class ExportJobSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()

    class Meta:
        model = ExportJob
        fields = [
            'id', 'format', 'start_date', 'end_date', 'category_filter',
            'status', 'file_url', 'row_count',
            'total_gross', 'total_tax', 'total_net',
            'error_detail', 'created_at', 'started_at', 'completed_at',
        ]
        read_only_fields = [
            'status', 'file_url', 'row_count',
            'total_gross', 'total_tax', 'total_net',
            'error_detail', 'created_at', 'started_at', 'completed_at',
        ]

    def get_file_url(self, obj):
        if obj.file and obj.status == ExportJob.Status.COMPLETED:
            return obj.file.url
        return None


class PayoutLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = PayoutLine
        fields = [
            'id', 'type', 'stripe_balance_txn_id', 'stripe_charge_id',
            'stripe_payment_intent_id', 'invoice', 'gross_amount',
            'fee_amount', 'net_amount', 'currency', 'description',
            'created_at_stripe',
        ]


class PayoutSerializer(serializers.ModelSerializer):
    lines = PayoutLineSerializer(many=True, read_only=True)

    class Meta:
        model = Payout
        fields = [
            'id', 'stripe_payout_id', 'stripe_account_id', 'amount', 'currency',
            'arrival_date', 'created_at_stripe', 'status', 'bank_account_last4',
            'gross_amount', 'fee_amount', 'reconciled', 'synced_at', 'lines',
        ]


class GLCodeMappingSerializer(serializers.ModelSerializer):
    class Meta:
        model = GLCodeMapping
        fields = [
            'id', 'chargeable_category', 'gl_account',
            'external_gl_code', 'external_gl_name',
            'cost_centre', 'is_active', 'created_at', 'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']


class TaxCodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaxCode
        fields = [
            'id', 'name', 'rate',
            'jurisdiction_country', 'jurisdiction_state',
            'jurisdiction_county', 'jurisdiction_city',
            'reportable_category', 'tax_rate',
            'external_qbo_code', 'external_xero_code',
            'effective_from', 'effective_to', 'is_active',
            'created_at',
        ]
        read_only_fields = ['created_at']


# ---------------------------------------------------------------------------
# ViewSets / views
# ---------------------------------------------------------------------------

class ExportJobViewSet(viewsets.ModelViewSet):
    serializer_class = ExportJobSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        return ExportJob.objects.filter(marina=_marina(self.request))

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        start = serializer.validated_data['start_date']
        end = serializer.validated_data['end_date']
        fmt = serializer.validated_data['format']
        if end < start:
            return Response(
                {'detail': 'end_date must be >= start_date.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        category_filter = serializer.validated_data.get('category_filter') or []

        # Resolve staff member, if available.
        requested_by = None
        sm = getattr(request.user, 'staff_member', None)
        if sm is not None:
            requested_by = sm

        job = ExportJob.objects.create(
            marina=_marina(request),
            requested_by=requested_by,
            format=fmt,
            start_date=start,
            end_date=end,
            category_filter=category_filter,
        )

        span_days = (end - start).days
        if span_days <= SYNC_THRESHOLD_DAYS:
            try:
                get_generator(fmt)(job)
            except Exception:
                job.refresh_from_db()

        job.refresh_from_db()
        data = self.get_serializer(job).data
        return Response(data, status=http_status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'])
    def download(self, request, pk=None):
        job = self.get_object()
        if job.status != ExportJob.Status.COMPLETED or not job.file:
            raise Http404('Export not ready.')
        response = FileResponse(job.file.open('rb'), content_type='text/csv')
        filename = f'export-{job.pk}-{job.format}.csv'
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response


class PayoutViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PayoutSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = Payout.objects.filter(marina=_marina(self.request)).prefetch_related('lines')
        reconciled = self.request.query_params.get('reconciled')
        status_q = self.request.query_params.get('status')
        if reconciled is not None:
            qs = qs.filter(reconciled=reconciled.lower() in ('1', 'true', 'yes'))
        if status_q:
            qs = qs.filter(status=status_q)
        arr_gte = self.request.query_params.get('arrival_date__gte')
        if arr_gte:
            qs = qs.filter(arrival_date__gte=arr_gte)
        return qs


class GLCodeMappingViewSet(viewsets.ModelViewSet):
    serializer_class = GLCodeMappingSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return GLCodeMapping.objects.filter(marina=_marina(self.request))

    def perform_create(self, serializer):
        serializer.save(marina=_marina(self.request))


class TaxCodeViewSet(viewsets.ModelViewSet):
    serializer_class = TaxCodeSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return TaxCode.objects.filter(marina=_marina(self.request))

    def perform_create(self, serializer):
        serializer.save(marina=_marina(self.request))


class TaxSummaryView(APIView):
    """JSON jurisdiction roll-up. Single arbitrary date range only (no presets)."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        start_q = request.query_params.get('start') or request.query_params.get('start_date')
        end_q = request.query_params.get('end') or request.query_params.get('end_date')
        if not (start_q and end_q):
            return Response(
                {'detail': "Both 'start' and 'end' query parameters are required."},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        try:
            start = datetime.date.fromisoformat(start_q)
            end = datetime.date.fromisoformat(end_q)
        except ValueError:
            return Response({'detail': 'Invalid ISO date.'},
                            status=http_status.HTTP_400_BAD_REQUEST)

        # Build an in-memory job stub for the generator's filter logic.
        fake_job = ExportJob(
            marina=_marina(request),
            format=ExportJob.Format.TAX_SUMMARY_CSV,
            start_date=start,
            end_date=end,
            category_filter=[],
        )

        grouped = {}
        grand_total = Decimal('0.00')
        for row in _tax_summary_rows(fake_job):
            juris_key = (row['country'], row['state'], row['county'], row['city'])
            bucket = grouped.setdefault(juris_key, {
                'country': row['country'],
                'state': row['state'],
                'county': row['county'],
                'city': row['city'],
                'totals': [],
            })
            bucket['totals'].append({
                'tax_code_name': row['name'],
                'reportable_category': row['reportable_category'],
                'rate': str(row['rate']),
                'taxable_sales': str(row['taxable_sales']),
                'exempt_sales': str(row['exempt_sales']),
                'tax_collected': str(row['tax_collected']),
                'invoice_count': row['invoice_count'],
            })
            grand_total += Decimal(row['tax_collected'])

        return Response({
            'period': {'start': start.isoformat(), 'end': end.isoformat()},
            'by_jurisdiction': list(grouped.values()),
            'grand_total_tax_collected': str(grand_total),
        })
