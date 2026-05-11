from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.access_control.models import (
    SpendAuthorisationRule, SpendAuthorisationRequest, FraudAnomalyAlert,
)
from apps.access_control.serializers import (
    SpendAuthorisationRuleSerializer, SpendAuthorisationRequestSerializer,
    FraudAnomalyAlertSerializer,
)
from apps.access_control.views.mixins import MarinaFilteredMixin


class SpendAuthorisationRuleViewSet(MarinaFilteredMixin, viewsets.ModelViewSet):
    queryset           = SpendAuthorisationRule.objects.all()
    serializer_class   = SpendAuthorisationRuleSerializer
    permission_classes = [IsAuthenticated]


class SpendAuthorisationRequestViewSet(MarinaFilteredMixin, viewsets.ModelViewSet):
    queryset           = SpendAuthorisationRequest.objects.select_related('rule', 'requested_by', 'approver')
    serializer_class   = SpendAuthorisationRequestSerializer
    permission_classes = [IsAuthenticated]

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        req = self.get_object()
        if req.status not in ('pending', 'suspended'):
            return Response({'detail': f'Cannot approve a request with status={req.status}.'}, status=status.HTTP_400_BAD_REQUEST)
        req.status       = 'approved'
        req.actioned_at  = timezone.now()
        req.approver     = getattr(request.user, 'staff_profile', None)
        req.approver_note = request.data.get('note', '')
        req.save(update_fields=['status', 'actioned_at', 'approver', 'approver_note'])
        return Response(SpendAuthorisationRequestSerializer(req, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def deny(self, request, pk=None):
        req = self.get_object()
        if req.status not in ('pending', 'suspended'):
            return Response({'detail': f'Cannot deny a request with status={req.status}.'}, status=status.HTTP_400_BAD_REQUEST)
        req.status        = 'denied'
        req.actioned_at   = timezone.now()
        req.approver      = getattr(request.user, 'staff_profile', None)
        req.approver_note = request.data.get('note', '')
        req.save(update_fields=['status', 'actioned_at', 'approver', 'approver_note'])
        return Response(SpendAuthorisationRequestSerializer(req, context={'request': request}).data)

    @action(detail=True, methods=['post'])
    def suspend(self, request, pk=None):
        """Path A — Park Transaction: free the terminal, handle approval async."""
        req = self.get_object()
        if req.status != 'pending':
            return Response({'detail': 'Only pending requests can be suspended.'}, status=status.HTTP_400_BAD_REQUEST)
        req.status       = 'suspended'
        req.suspended_at = timezone.now()
        req.save(update_fields=['status', 'suspended_at'])
        return Response(SpendAuthorisationRequestSerializer(req, context={'request': request}).data)

    @action(detail=True, methods=['post'], url_path='force-override')
    def force_override(self, request, pk=None):
        """
        Path B — Force Override: staff bypasses the approval gate.
        Auto-creates FraudAnomalyAlert(alert_type='forced_override') for retrospective sign-off.
        """
        req = self.get_object()
        if req.status not in ('pending', 'suspended'):
            return Response({'detail': f'Cannot force-override with status={req.status}.'}, status=status.HTTP_400_BAD_REQUEST)

        staff = getattr(request.user, 'staff_profile', None)
        now   = timezone.now()

        alert = FraudAnomalyAlert.objects.create(
            marina=req.marina,
            alert_type='forced_override',
            staff_member=staff,
            period_start=now,
            period_end=now,
            event_count=1,
            total_amount=req.amount,
            resolution_note=f"Force override on SpendAuthorisationRequest #{req.pk}.",
        )

        req.status               = 'overridden'
        req.override_forced_by   = staff
        req.override_forced_at   = now
        req.override_fraud_alert = alert
        req.save(update_fields=['status', 'override_forced_by', 'override_forced_at', 'override_fraud_alert'])

        return Response(
            {
                'detail': 'Force override applied. Fraud alert created for retrospective sign-off.',
                'fraud_alert_id': alert.pk,
            },
            status=status.HTTP_200_OK,
        )


class FraudAnomalyAlertViewSet(MarinaFilteredMixin, viewsets.ModelViewSet):
    serializer_class   = FraudAnomalyAlertSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = FraudAnomalyAlert.objects.filter(marina=self.request.user.marina)
        if self.request.query_params.get('unresolved') != 'false':
            qs = qs.filter(resolved_at__isnull=True)
        return qs

    @action(detail=True, methods=['post'])
    def resolve(self, request, pk=None):
        alert = self.get_object()
        note  = request.data.get('resolution_note', '').strip()
        if not note:
            return Response({'resolution_note': 'This field is required.'}, status=status.HTTP_400_BAD_REQUEST)
        alert.resolved_at   = timezone.now()
        alert.resolved_by   = getattr(request.user, 'staff_profile', None)
        alert.resolution_note = note
        alert.save(update_fields=['resolved_at', 'resolved_by', 'resolution_note'])
        return Response(FraudAnomalyAlertSerializer(alert, context={'request': request}).data)
