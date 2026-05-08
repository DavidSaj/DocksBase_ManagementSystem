from datetime import date
from decimal import Decimal

from rest_framework import generics, serializers as drf_serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.harbour.models import (
    CommercialMovement,
    HarbourDueInvoice,
    HarbourTariff,
    PortStateControlRecord,
    ShippingAgent,
)
from apps.harbour.serializers import (
    CommercialMovementSerializer,
    HarbourTariffSerializer,
    PortStateControlRecordSerializer,
    ShippingAgentSerializer,
)
from apps.harbour.services.tariff_engine import (
    calculate_and_invoice,
    preview_dues,
    recalculate_movement_invoice,
)
from apps.harbour.services.report_builders import (
    daily_port_report,
    vessel_traffic_report,
)


# ─── Shipping Agents ──────────────────────────────────────────────────────────

class ShippingAgentListCreateView(generics.ListCreateAPIView):
    serializer_class = ShippingAgentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = ShippingAgent.objects.filter(marina=self.request.user.marina)
        if self.request.query_params.get('active_only') == 'true':
            qs = qs.filter(is_active=True)
        return qs

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class ShippingAgentDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ShippingAgentSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return ShippingAgent.objects.filter(marina=self.request.user.marina)


# ─── Harbour Tariffs ──────────────────────────────────────────────────────────

class HarbourTariffListCreateView(generics.ListCreateAPIView):
    serializer_class = HarbourTariffSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = HarbourTariff.objects.filter(marina=self.request.user.marina)
        due_type = self.request.query_params.get('due_type')
        if due_type:
            qs = qs.filter(due_type=due_type)
        vessel_type = self.request.query_params.get('vessel_type')
        if vessel_type:
            qs = qs.filter(vessel_type=vessel_type)
        if self.request.query_params.get('active_only') == 'true':
            qs = qs.filter(is_active=True)
        return qs

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class HarbourTariffDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = HarbourTariffSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return HarbourTariff.objects.filter(marina=self.request.user.marina)


# ─── Commercial Movements ─────────────────────────────────────────────────────

class CommercialMovementListCreateView(generics.ListCreateAPIView):
    serializer_class = CommercialMovementSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = (
            CommercialMovement.objects
            .filter(marina=self.request.user.marina)
            .select_related('shipping_agent', 'berth_assigned')
            .prefetch_related('due_invoices__tariff')
        )
        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        vessel_type = self.request.query_params.get('vessel_type')
        if vessel_type:
            qs = qs.filter(vessel_type=vessel_type)
        return qs

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class CommercialMovementDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = CommercialMovementSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return CommercialMovement.objects.filter(
            marina=self.request.user.marina
        ).select_related('shipping_agent', 'berth_assigned').prefetch_related('due_invoices')


class MovementCalculateDuesView(APIView):
    """
    GET /harbour/movements/<pk>/calculate-dues/
    Returns a preview of applicable dues without creating any records.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            movement = CommercialMovement.objects.get(pk=pk, marina=request.user.marina)
        except CommercialMovement.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        if not movement.eta and not movement.actual_arrival:
            return Response(
                {'detail': 'Movement has no ETA or actual arrival date — cannot calculate dues.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        preview = preview_dues(movement)
        return Response(preview)


class MovementGenerateInvoiceView(APIView):
    """
    POST /harbour/movements/<pk>/generate-invoice/
    Generates or regenerates a harbour dues invoice for the movement.
    If an invoice already exists, issues a credit note and creates a new one.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            movement = CommercialMovement.objects.get(pk=pk, marina=request.user.marina)
        except CommercialMovement.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        if not movement.eta and not movement.actual_arrival:
            return Response(
                {'detail': 'Movement has no ETA or actual arrival date — cannot invoice.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        has_existing = movement.due_invoices.exists()

        if has_existing:
            credit_note, new_invoice = recalculate_movement_invoice(movement)
            return Response({
                'status': 'recalculated',
                'credit_note_id': credit_note.pk if credit_note else None,
                'invoice_id': new_invoice.pk,
                'invoice_number': new_invoice.invoice_number,
                'total': str(new_invoice.total),
            })
        else:
            invoice = calculate_and_invoice(movement)
            return Response({
                'status': 'created',
                'invoice_id': invoice.pk,
                'invoice_number': invoice.invoice_number,
                'total': str(invoice.total),
            }, status=status.HTTP_201_CREATED)


# ─── PSC Records ──────────────────────────────────────────────────────────────

class PortStateControlRecordListCreateView(generics.ListCreateAPIView):
    serializer_class = PortStateControlRecordSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = PortStateControlRecord.objects.filter(
            marina=self.request.user.marina
        ).select_related('movement')
        outcome = self.request.query_params.get('outcome')
        if outcome:
            qs = qs.filter(outcome=outcome)
        return qs

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class PortStateControlRecordDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = PortStateControlRecordSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return PortStateControlRecord.objects.filter(marina=self.request.user.marina)


# ─── Reports ──────────────────────────────────────────────────────────────────

class VesselTrafficReportView(APIView):
    """GET /harbour/reports/vessel-traffic/?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        date_from_str = request.query_params.get('date_from')
        date_to_str   = request.query_params.get('date_to')

        if not date_from_str or not date_to_str:
            return Response(
                {'detail': 'date_from and date_to query params are required (YYYY-MM-DD).'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            date_from = date.fromisoformat(date_from_str)
            date_to   = date.fromisoformat(date_to_str)
        except ValueError:
            return Response({'detail': 'Invalid date format. Use YYYY-MM-DD.'}, status=status.HTTP_400_BAD_REQUEST)

        if date_from > date_to:
            return Response({'detail': 'date_from must be <= date_to.'}, status=status.HTTP_400_BAD_REQUEST)

        data = vessel_traffic_report(request.user.marina, date_from, date_to)
        return Response({'date_from': date_from_str, 'date_to': date_to_str, 'movements': data})


class DailyPortReportView(APIView):
    """GET /harbour/reports/daily-port-report/?date=YYYY-MM-DD"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        date_str = request.query_params.get('date')
        if not date_str:
            return Response(
                {'detail': 'date query param is required (YYYY-MM-DD).'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            report_date = date.fromisoformat(date_str)
        except ValueError:
            return Response({'detail': 'Invalid date format. Use YYYY-MM-DD.'}, status=status.HTTP_400_BAD_REQUEST)

        data = daily_port_report(request.user.marina, report_date)
        return Response({'date': date_str, 'vessels_in_port': data})


# ─── Harbour Dues (simplified frontend façade) ────────────────────────────────
#
# The frontend "Harbour Dues" tab uses a simplified form that logs a due against
# a vessel name without requiring a full CommercialMovement workflow.  We map
# this to CommercialMovement so no extra model/migration is needed.
#
# Frontend POST body:  vessel_name, due_type, amount, shipping_agent (id|null), notes
# Frontend list response expected fields: vessel_name, due_type, agent_name, amount, status, created_at


class HarbourDueListSerializer(drf_serializers.Serializer):
    """Read-only serializer that shapes a CommercialMovement for the dues list."""
    id          = drf_serializers.IntegerField()
    vessel_name = drf_serializers.CharField()
    due_type    = drf_serializers.SerializerMethodField()
    agent_name  = drf_serializers.SerializerMethodField()
    amount      = drf_serializers.SerializerMethodField()
    status      = drf_serializers.CharField()
    created_at  = drf_serializers.DateTimeField()

    def get_due_type(self, obj):
        # Store due_type in cargo_type field (free-text, no migration needed)
        return obj.cargo_type or 'harbour_dues'

    def get_agent_name(self, obj):
        if obj.shipping_agent:
            return obj.shipping_agent.name
        return obj.agent_name or None

    def get_amount(self, obj):
        # Sum calculated_amount from attached due invoices; fall back to cargo_weight_mt
        total = obj.due_invoices.aggregate(
            t=__import__('django.db.models', fromlist=['Sum']).Sum('calculated_amount')
        )['t']
        if total is not None:
            return str(total)
        # Fallback: amount stored in cargo_weight_mt by create view
        if obj.cargo_weight_mt is not None:
            return str(obj.cargo_weight_mt)
        return None


class HarbourDueListCreateView(APIView):
    """
    GET  /harbour/dues/   — list movements that represent logged dues
    POST /harbour/dues/   — log a new harbour due (creates a CommercialMovement)
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        marina = request.user.marina
        # Dues are movements that have cargo_type set (used as due_type store)
        qs = (
            CommercialMovement.objects
            .filter(marina=marina)
            .exclude(cargo_type='')
            .select_related('shipping_agent')
            .prefetch_related('due_invoices')
            .order_by('-created_at')
        )
        serializer = HarbourDueListSerializer(qs, many=True)
        return Response(serializer.data)

    def post(self, request):
        marina = request.user.marina
        vessel_name = request.data.get('vessel_name', '')
        due_type    = request.data.get('due_type', 'harbour_dues')
        amount      = request.data.get('amount')
        agent_id    = request.data.get('shipping_agent')
        notes       = request.data.get('notes', '')

        if not vessel_name:
            return Response({'detail': 'vessel_name is required.'}, status=status.HTTP_400_BAD_REQUEST)

        agent = None
        if agent_id:
            try:
                agent = ShippingAgent.objects.get(pk=agent_id, marina=marina)
            except ShippingAgent.DoesNotExist:
                return Response({'detail': 'Shipping agent not found.'}, status=status.HTTP_400_BAD_REQUEST)

        movement = CommercialMovement.objects.create(
            marina=marina,
            vessel_name=vessel_name,
            vessel_type='cargo',       # required field — default
            cargo_type=due_type,       # repurpose cargo_type to store due_type key
            cargo_weight_mt=Decimal(str(amount)) if amount else None,
            shipping_agent=agent,
            agent_name=agent.name if agent else '',
            notes=notes,
            status=CommercialMovement.MovementStatus.EXPECTED,
        )

        return Response(HarbourDueListSerializer(movement).data, status=status.HTTP_201_CREATED)


class HarbourDueSummaryView(APIView):
    """GET /harbour/dues/summary/ — quick KPI summary for the harbour dues tab."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from django.db.models import Sum, Count
        from django.utils import timezone

        marina = request.user.marina
        now = timezone.now()
        month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

        dues_qs = CommercialMovement.objects.filter(marina=marina).exclude(cargo_type='')

        mtd_total = dues_qs.filter(created_at__gte=month_start).aggregate(
            t=Sum('cargo_weight_mt')
        )['t'] or Decimal('0')

        # "Outstanding" = EXPECTED status with an amount
        outstanding = dues_qs.filter(status='expected').aggregate(
            t=Sum('cargo_weight_mt')
        )['t'] or Decimal('0')

        # "Invoiced" = movements that have linked due_invoices
        invoiced = HarbourDueInvoice.objects.filter(
            marina=marina
        ).aggregate(t=Sum('calculated_amount'))['t'] or Decimal('0')

        vessel_calls = CommercialMovement.objects.filter(marina=marina).count()

        return Response({
            'total_mtd':   str(mtd_total),
            'outstanding': str(outstanding),
            'invoiced':    str(invoiced),
            'vessel_calls': vessel_calls,
        })
