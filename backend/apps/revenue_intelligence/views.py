"""
Views for Revenue Intelligence.

All ViewSets scope to the authenticated user's marina.
Analytics views return aggregated data for the marina.
"""

from __future__ import annotations

import logging
from datetime import date, timedelta
from decimal import Decimal

from django.db import models as db_models, transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .engine import YieldEngine
from .models import (
    BookingTier,
    CompetitorRate,
    HourlyBerthConfig,
    UpgradeCampaign,
    UpsellOffer,
    WaitlistEntry,
    WaitlistOffer,
    YieldApplication,
    YieldRule,
)
from .serializers import (
    BookingTierSerializer,
    CompetitorRateSerializer,
    HourlyBerthConfigSerializer,
    UpgradeCampaignSerializer,
    UpsellOfferSerializer,
    WaitlistEntrySerializer,
    WaitlistOfferSerializer,
    YieldApplicationSerializer,
    YieldRuleSerializer,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Mixins
# ---------------------------------------------------------------------------

class MarinaScopedMixin:
    """Filter all querysets to the authenticated user's marina."""

    permission_classes = [IsAuthenticated]

    def get_marina(self):
        return self.request.user.marina

    def get_queryset(self):
        return self.queryset.filter(marina=self.get_marina())

    def perform_create(self, serializer):
        serializer.save(marina=self.get_marina())


# ---------------------------------------------------------------------------
# CRUD ViewSets
# ---------------------------------------------------------------------------

class BookingTierViewSet(MarinaScopedMixin, viewsets.ModelViewSet):
    queryset = BookingTier.objects.all()
    serializer_class = BookingTierSerializer


class YieldRuleViewSet(MarinaScopedMixin, viewsets.ModelViewSet):
    queryset = YieldRule.objects.select_related('booking_tier').all()
    serializer_class = YieldRuleSerializer


class HourlyBerthConfigViewSet(MarinaScopedMixin, viewsets.ModelViewSet):
    queryset = HourlyBerthConfig.objects.select_related('berth', 'pricing_item').all()
    serializer_class = HourlyBerthConfigSerializer


class UpgradeCampaignViewSet(MarinaScopedMixin, viewsets.ModelViewSet):
    queryset = UpgradeCampaign.objects.select_related(
        'booking', 'from_tier', 'to_tier', 'offered_berth'
    ).all()
    serializer_class = UpgradeCampaignSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    def partial_update(self, request, *args, **kwargs):
        """On status → accepted: reassign berth on booking and create InvoiceLineItem."""
        instance = self.get_object()
        new_status = request.data.get('status')

        response = super().partial_update(request, *args, **kwargs)

        if new_status == UpgradeCampaign.Status.ACCEPTED and instance.status != UpgradeCampaign.Status.ACCEPTED:
            instance.refresh_from_db()
            self._handle_upgrade_accepted(instance)

        return response

    def _handle_upgrade_accepted(self, campaign: UpgradeCampaign):
        """Reassign berth on booking and issue an InvoiceLineItem for the differential."""
        from apps.billing.models import Invoice, InvoiceLineItem

        booking = campaign.booking

        # Reassign berth to the offered berth.
        if campaign.offered_berth:
            booking.berth = campaign.offered_berth
            booking.save(update_fields=['berth'])

        # Create or find the invoice for this booking.
        invoice = (
            Invoice.objects.filter(booking=booking, marina=campaign.marina)
            .order_by('-created_at')
            .first()
        )
        if invoice is None:
            logger.warning(
                'UpgradeCampaign accepted but no invoice found for booking %s', booking.pk
            )
            return

        InvoiceLineItem.objects.create(
            invoice=invoice,
            description=f'Berth upgrade: {campaign.from_tier} → {campaign.to_tier}',
            quantity=Decimal('1.00'),
            unit_price=campaign.differential_amount,
            total_price=campaign.differential_amount,
        )

        # Mark responded_at.
        campaign.responded_at = timezone.now()
        campaign.save(update_fields=['responded_at'])


class UpsellOfferViewSet(MarinaScopedMixin, viewsets.ModelViewSet):
    queryset = UpsellOffer.objects.select_related('booking', 'chargeable_item').all()
    serializer_class = UpsellOfferSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        return qs

    def partial_update(self, request, *args, **kwargs):
        """On status → redeemed: compute charge and create InvoiceLineItem."""
        instance = self.get_object()
        new_status = request.data.get('status')

        response = super().partial_update(request, *args, **kwargs)

        if new_status == UpsellOffer.Status.REDEEMED and instance.status != UpsellOffer.Status.REDEEMED:
            instance.refresh_from_db()
            self._handle_upsell_redeemed(instance)

        return response

    def _handle_upsell_redeemed(self, offer: UpsellOffer):
        """Create an InvoiceLineItem for the redeemed upsell charge."""
        from apps.billing.models import Invoice, InvoiceLineItem

        item = offer.chargeable_item
        unit_price = item.unit_price
        if offer.discount_pct:
            unit_price = unit_price * (1 - offer.discount_pct / 100)

        invoice = (
            Invoice.objects.filter(booking=offer.booking, marina=offer.marina)
            .order_by('-created_at')
            .first()
        )
        if invoice is None:
            logger.warning(
                'UpsellOffer redeemed but no invoice found for booking %s', offer.booking_id
            )
            return

        line = InvoiceLineItem.objects.create(
            invoice=invoice,
            description=f'Upsell: {item.name}',
            quantity=Decimal('1.00'),
            unit_price=unit_price,
            total_price=unit_price,
            chargeable_item=item,
        )

        offer.invoice_line_item = line
        offer.redeemed_at = timezone.now()
        offer.save(update_fields=['invoice_line_item', 'redeemed_at'])


class WaitlistEntryViewSet(MarinaScopedMixin, viewsets.ModelViewSet):
    queryset = WaitlistEntry.objects.select_related('booking_tier').all()
    serializer_class = WaitlistEntrySerializer


class WaitlistOfferViewSet(MarinaScopedMixin, viewsets.ModelViewSet):
    queryset = WaitlistOffer.objects.select_related('waitlist_entry', 'berth').all()
    serializer_class = WaitlistOfferSerializer


class CompetitorRateViewSet(MarinaScopedMixin, viewsets.ModelViewSet):
    queryset = CompetitorRate.objects.all()
    serializer_class = CompetitorRateSerializer


# ---------------------------------------------------------------------------
# Yield Preview (no persistence)
# ---------------------------------------------------------------------------

class YieldPreviewView(APIView):
    """POST — run the YieldEngine for a given berth + dates without saving."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from apps.berths.models import Berth

        marina = request.user.marina
        data = request.data

        required = ['berth_id', 'check_in', 'check_out', 'booking_type']
        missing = [f for f in required if not data.get(f)]
        if missing:
            return Response(
                {'detail': f'Missing required fields: {", ".join(missing)}'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            berth = Berth.objects.get(pk=data['berth_id'], marina=marina)
        except Berth.DoesNotExist:
            return Response({'detail': 'Berth not found.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            check_in = date.fromisoformat(data['check_in'])
            check_out = date.fromisoformat(data['check_out'])
        except ValueError:
            return Response(
                {'detail': 'check_in and check_out must be ISO date strings (YYYY-MM-DD).'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        is_hourly = bool(data.get('is_hourly', False))
        duration_minutes = data.get('duration_minutes')

        engine = YieldEngine(marina)
        result = engine.compute(
            berth=berth,
            check_in=check_in,
            check_out=check_out,
            booking_type=data['booking_type'],
            is_hourly=is_hourly,
            duration_minutes=int(duration_minutes) if duration_minutes else None,
        )

        # Serialise Decimal values for JSON.
        return Response({k: str(v) if isinstance(v, Decimal) else v for k, v in result.items()})


# ---------------------------------------------------------------------------
# Analytics views
# ---------------------------------------------------------------------------

class _AnalyticsBase(APIView):
    """Base class for analytics endpoints. Resolves marina and date range."""

    permission_classes = [IsAuthenticated]

    def _parse_range(self, request):
        """Return (date_from, date_to) from query params, defaulting to current month."""
        today = date.today()
        date_from_str = request.query_params.get('date_from')
        date_to_str = request.query_params.get('date_to')
        try:
            date_from = date.fromisoformat(date_from_str) if date_from_str else today.replace(day=1)
            date_to = date.fromisoformat(date_to_str) if date_to_str else today
        except ValueError:
            date_from = today.replace(day=1)
            date_to = today
        return date_from, date_to


class AdrView(_AnalyticsBase):
    """Average Daily Rate for the marina in the given date range."""

    def get(self, request):
        from apps.reservations.models import Booking

        marina = request.user.marina
        date_from, date_to = self._parse_range(request)

        bookings = Booking.objects.filter(
            marina=marina,
            check_in__gte=date_from,
            check_in__lte=date_to,
            booking_type='transient',
            status__in=['confirmed', 'checked_in', 'checked_out'],
        )

        total_revenue = bookings.aggregate(
            total=db_models.Sum('amount')
        )['total'] or Decimal('0')
        nights = bookings.aggregate(
            nights=db_models.Sum('nights')
        )['nights'] or 0

        adr = (total_revenue / nights) if nights else Decimal('0')

        return Response({
            'date_from': date_from,
            'date_to': date_to,
            'adr': str(adr.quantize(Decimal('0.01'))),
            'total_revenue': str(total_revenue),
            'total_nights': nights,
        })


class RevpabView(_AnalyticsBase):
    """Revenue Per Available Berth (RevPAB) for the marina."""

    def get(self, request):
        from apps.berths.models import Berth
        from apps.reservations.models import Booking

        marina = request.user.marina
        date_from, date_to = self._parse_range(request)

        period_days = (date_to - date_from).days + 1
        available_berths = Berth.objects.filter(
            marina=marina, berth_class='standard'
        ).count()
        available_berth_nights = available_berths * period_days

        bookings = Booking.objects.filter(
            marina=marina,
            check_in__gte=date_from,
            check_in__lte=date_to,
            booking_type='transient',
            status__in=['confirmed', 'checked_in', 'checked_out'],
        )
        total_revenue = bookings.aggregate(
            total=db_models.Sum('amount')
        )['total'] or Decimal('0')

        revpab = (
            total_revenue / available_berth_nights
            if available_berth_nights
            else Decimal('0')
        )

        return Response({
            'date_from': date_from,
            'date_to': date_to,
            'revpab': str(revpab.quantize(Decimal('0.01'))),
            'total_revenue': str(total_revenue),
            'available_berth_nights': available_berth_nights,
        })


class PacingView(_AnalyticsBase):
    """Booking pacing: how far ahead bookings are being made vs. prior period."""

    def get(self, request):
        from apps.reservations.models import Booking

        marina = request.user.marina
        date_from, date_to = self._parse_range(request)

        # Days-in-advance histogram for bookings created in the window.
        bookings = Booking.objects.filter(
            marina=marina,
            created_at__date__gte=date_from,
            created_at__date__lte=date_to,
            booking_type='transient',
        ).annotate(
            days_advance=db_models.ExpressionWrapper(
                db_models.F('check_in') - db_models.F('created_at__date'),
                output_field=db_models.IntegerField(),
            )
        ).values('days_advance')

        # Build a simple bucketed histogram.
        buckets = {'0-7': 0, '8-14': 0, '15-30': 0, '31-60': 0, '60+': 0}
        for row in bookings:
            d = row.get('days_advance') or 0
            if d <= 7:
                buckets['0-7'] += 1
            elif d <= 14:
                buckets['8-14'] += 1
            elif d <= 30:
                buckets['15-30'] += 1
            elif d <= 60:
                buckets['31-60'] += 1
            else:
                buckets['60+'] += 1

        return Response({'date_from': date_from, 'date_to': date_to, 'pacing': buckets})


class ForecastView(_AnalyticsBase):
    """Simple 30-day revenue forecast based on current confirmed bookings."""

    def get(self, request):
        from apps.reservations.models import Booking

        marina = request.user.marina
        today = date.today()
        forecast_end = today + timedelta(days=30)

        bookings = Booking.objects.filter(
            marina=marina,
            check_in__gte=today,
            check_in__lte=forecast_end,
            booking_type='transient',
            status__in=['confirmed', 'awaiting_payment', 'pending_payment'],
        )
        projected = bookings.aggregate(
            total=db_models.Sum('amount')
        )['total'] or Decimal('0')

        count = bookings.count()

        return Response({
            'forecast_from': today,
            'forecast_to': forecast_end,
            'projected_revenue': str(projected),
            'booking_count': count,
        })


class DeferredRevenueView(_AnalyticsBase):
    """Deferred (unearned) revenue: confirmed future bookings not yet checked in."""

    def get(self, request):
        from apps.reservations.models import Booking

        marina = request.user.marina
        today = date.today()

        bookings = Booking.objects.filter(
            marina=marina,
            check_in__gt=today,
            status__in=['confirmed'],
            paid=True,
        )
        deferred = bookings.aggregate(
            total=db_models.Sum('amount')
        )['total'] or Decimal('0')

        return Response({
            'as_of': today,
            'deferred_revenue': str(deferred),
            'booking_count': bookings.count(),
        })
