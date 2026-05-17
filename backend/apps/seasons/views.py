"""
apps/seasons/views.py — DRF endpoints for Phase 2.

Endpoints (mounted at /api/v1/ via apps.seasons.urls):

    GET/POST   /seasons/
    GET/PUT/PATCH/DELETE /seasons/{pk}/
    GET/POST   /seasonal-rate-cards/
    GET/POST   /instalment-plans/
    GET/POST   /leases/                       (POST → wizard payload)
    GET        /leases/{pk}/
    POST       /leases/{pk}/transition/       (body: target, reason)
    POST       /leases/{pk}/issue-deposit-invoice/
    POST       /leases/{pk}/instalments/{seq}/mark-paid/
"""
from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from apps.berths.models import Berth
from apps.members.models import Member
from apps.vessels.models import Vessel

from . import services
from .models import (
    BerthLease,
    InstalmentPlan,
    LeaseInstalment,
    Season,
    SeasonalRateCard,
)
from .serializers import (
    BerthLeaseSerializer,
    InstalmentPlanSerializer,
    LeaseCreateSerializer,
    LeaseTransitionSerializer,
    SeasonalRateCardSerializer,
    SeasonSerializer,
)


class SeasonViewSet(viewsets.ModelViewSet):
    queryset = Season.objects.all()
    serializer_class = SeasonSerializer
    permission_classes = [IsAuthenticated]


class SeasonalRateCardViewSet(viewsets.ModelViewSet):
    queryset = SeasonalRateCard.objects.all()
    serializer_class = SeasonalRateCardSerializer
    permission_classes = [IsAuthenticated]


class InstalmentPlanViewSet(viewsets.ModelViewSet):
    queryset = InstalmentPlan.objects.all()
    serializer_class = InstalmentPlanSerializer
    permission_classes = [IsAuthenticated]


class BerthLeaseViewSet(viewsets.ModelViewSet):
    queryset = BerthLease.objects.all().prefetch_related('instalments')
    serializer_class = BerthLeaseSerializer
    permission_classes = [IsAuthenticated]
    http_method_names = ['get', 'post', 'patch', 'delete', 'head', 'options']

    def create(self, request, *args, **kwargs):
        wiz = LeaseCreateSerializer(data=request.data)
        wiz.is_valid(raise_exception=True)
        d = wiz.validated_data
        try:
            member = Member.objects.get(pk=d['member'])
            berth = Berth.objects.get(pk=d['berth'])
            season = Season.objects.get(pk=d['season'])
        except (Member.DoesNotExist, Berth.DoesNotExist, Season.DoesNotExist) as e:
            return Response({'detail': str(e)}, status=status.HTTP_404_NOT_FOUND)

        rate_card = None
        if d.get('rate_card'):
            try:
                rate_card = SeasonalRateCard.objects.get(pk=d['rate_card'])
            except SeasonalRateCard.DoesNotExist:
                return Response({'detail': 'rate_card not found'},
                                status=status.HTTP_404_NOT_FOUND)
        plan = None
        if d.get('instalment_plan'):
            try:
                plan = InstalmentPlan.objects.get(pk=d['instalment_plan'])
            except InstalmentPlan.DoesNotExist:
                return Response({'detail': 'instalment_plan not found'},
                                status=status.HTTP_404_NOT_FOUND)
        vessel = None
        if d.get('vessel'):
            try:
                vessel = Vessel.objects.get(pk=d['vessel'])
            except Vessel.DoesNotExist:
                return Response({'detail': 'vessel not found'},
                                status=status.HTTP_404_NOT_FOUND)

        try:
            lease = services.create_lease(
                member=member, berth=berth, season=season,
                rate_card=rate_card, instalment_plan=plan, vessel=vessel,
                start_date=d.get('start_date'), end_date=d.get('end_date'),
                tax_exempt_override=d.get('tax_exempt_override'),
                auto_renewal_enabled=d.get('auto_renewal_enabled'),
                source=d.get('source', 'manual'),
                created_by=request.user if request.user.is_authenticated else None,
                notes=d.get('notes', ''),
            )
        except services.OverlappingLeaseError as e:
            return Response({'detail': str(e)},
                            status=status.HTTP_409_CONFLICT)
        return Response(BerthLeaseSerializer(lease).data,
                        status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['post'])
    def transition(self, request, pk=None):
        lease = self.get_object()
        s = LeaseTransitionSerializer(data=request.data)
        s.is_valid(raise_exception=True)
        try:
            services.transition_lease(
                lease, s.validated_data['target'],
                by=request.user if request.user.is_authenticated else None,
                reason=s.validated_data.get('reason', ''),
            )
        except services.InvalidLeaseTransition as e:
            return Response({'detail': str(e)},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response(BerthLeaseSerializer(lease).data)

    @action(detail=True, methods=['post'], url_path='issue-deposit-invoice')
    def issue_deposit_invoice(self, request, pk=None):
        lease = self.get_object()
        invoice = services.issue_deposit_invoice(lease)
        return Response(
            {'invoice_id': invoice.pk, 'invoice_number': invoice.invoice_number},
            status=status.HTTP_201_CREATED,
        )


class LeaseInstalmentMarkPaidView(generics.GenericAPIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, lease_pk, sequence):
        try:
            instalment = LeaseInstalment.objects.get(
                lease_id=lease_pk, sequence=sequence,
            )
        except LeaseInstalment.DoesNotExist:
            return Response({'detail': 'instalment not found'},
                            status=status.HTTP_404_NOT_FOUND)
        method = request.data.get('method', 'cash')
        try:
            services.mark_instalment_paid(
                instalment, method=method,
                recorded_by=getattr(request.user, 'staff_member', None),
            )
        except ValueError as e:
            return Response({'detail': str(e)},
                            status=status.HTTP_400_BAD_REQUEST)
        return Response({
            'instalment_id': instalment.pk, 'status': instalment.status,
        })
