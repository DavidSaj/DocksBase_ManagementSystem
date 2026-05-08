from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.revenue.models import BookingTier, WaitlistEntry, YieldApplication, YieldRule
from apps.revenue.serializers import (
    BookingTierSerializer,
    PriceCalculatorSerializer,
    WaitlistEntrySerializer,
    YieldApplicationSerializer,
    YieldRuleSerializer,
)


class BookingTierListCreateView(generics.ListCreateAPIView):
    serializer_class = BookingTierSerializer

    def get_queryset(self):
        return BookingTier.objects.filter(marina=self.request.user.marina).select_related('berth_category')

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class BookingTierDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = BookingTierSerializer

    def get_queryset(self):
        return BookingTier.objects.filter(marina=self.request.user.marina)


class YieldRuleListCreateView(generics.ListCreateAPIView):
    serializer_class = YieldRuleSerializer

    def get_queryset(self):
        return YieldRule.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class YieldRuleDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = YieldRuleSerializer

    def get_queryset(self):
        return YieldRule.objects.filter(marina=self.request.user.marina)


class YieldApplicationListView(generics.ListAPIView):
    serializer_class = YieldApplicationSerializer

    def get_queryset(self):
        return (
            YieldApplication.objects
            .filter(marina=self.request.user.marina)
            .select_related('booking', 'rule')
            .order_by('-applied_at')
        )


class WaitlistEntryListCreateView(generics.ListCreateAPIView):
    serializer_class = WaitlistEntrySerializer

    def get_queryset(self):
        qs = WaitlistEntry.objects.filter(marina=self.request.user.marina).select_related('member', 'vessel')
        if self.request.query_params.get('active_only') == 'true':
            qs = qs.filter(is_active=True, fulfilled_booking__isnull=True)
        return qs

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class WaitlistEntryDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = WaitlistEntrySerializer

    def get_queryset(self):
        return WaitlistEntry.objects.filter(marina=self.request.user.marina)


class PriceCalculatorView(APIView):
    """
    POST /api/v1/revenue/calculate-price/
    Calculate yield-adjusted price for a hypothetical booking.
    Used by the booking UI before creating the booking.
    """
    def post(self, request):
        serializer = PriceCalculatorSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        result = serializer.calculate(marina=request.user.marina)
        return Response(result, status=status.HTTP_200_OK)


class OccupancyView(APIView):
    """
    GET /api/v1/revenue/occupancy/
    Returns current occupancy percentage and daily occupancy for the next 30 days.
    Used by the yield dashboard.
    """
    def get(self, request):
        from datetime import date, timedelta
        from apps.reservations.models import Booking

        marina = request.user.marina
        today = date.today()

        days = []
        for i in range(30):
            d = today + timedelta(days=i)
            occupied = Booking.objects.filter(
                marina=marina,
                status__in=['confirmed', 'checked_in', 'pending', 'pending_approval', 'awaiting_payment'],
                check_in__lte=d,
                check_out__gt=d,
            ).values('berth_id').distinct().count()
            total = marina.total_berths or 1
            days.append({
                'date': d.isoformat(),
                'occupied_berths': occupied,
                'total_berths': total,
                'occupancy_pct': round(occupied / total * 100, 1),
            })

        return Response({'occupancy_by_day': days})
