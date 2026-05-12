from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status as http_status
from django.shortcuts import get_object_or_404
from django.db.models import Sum
from decimal import Decimal

from apps.accounts.models import MarinaGroup, MarinaGroupUserRole
from apps.billing.models import Invoice
from .permissions import IsGroupAdmin
from .serializers import GroupSummarySerializer, build_marina_card


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        roles = MarinaGroupUserRole.objects.filter(
            user=request.user
        ).select_related('group')
        groups = [r.group for r in roles]
        return Response({'groups': GroupSummarySerializer(groups, many=True).data})


class GroupOverviewView(APIView):
    permission_classes = [IsAuthenticated, IsGroupAdmin]

    def get(self, request, pk):
        group = get_object_or_404(MarinaGroup, pk=pk)
        marinas = [m.marina for m in group.memberships.select_related('marina').all()]
        cards = [build_marina_card(m) for m in marinas]

        total_berths = sum(m.total_berths for m in marinas)
        total_active = sum(c['active_bookings'] for c in cards)
        total_outstanding = Invoice.objects.filter(
            marina__in=marinas, status__in=['unpaid', 'open']
        ).aggregate(t=Sum('total'))['t'] or Decimal('0')

        from config.plans import PLAN_MONTHLY_PRICES
        total_mrr = sum(
            PLAN_MONTHLY_PRICES.get(m.plan, 0) for m in marinas
        )

        return Response({
            'kpis': {
                'total_berths': total_berths,
                'total_active_bookings': total_active,
                'total_mrr': str(total_mrr),
                'total_outstanding': str(total_outstanding),
            },
            'marinas': cards,
        })
