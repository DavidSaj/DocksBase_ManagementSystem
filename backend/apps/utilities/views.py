"""
Utilities app views.

Marina scoping: all querysets filter by request.user's marina via
get_queryset(). Staff-only endpoints check IsAuthenticated + marina membership.

Special views:
  OfgemReportView       — returns StreamingHttpResponse with CSV bytes
  WashTokenRedeemView   — unauthenticated, resolved via X-Hardware-ID /
                          X-Marina-API-Key header (hardware kiosk)
"""

import logging
from datetime import date

from django.db import transaction
from django.http import StreamingHttpResponse
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.utilities.models import (
    BollardFaultLog,
    MeterOutageAlert,
    MeterReading,
    ServiceBollard,
    SmartMeter,
    UtilityWallet,
    UtilityWalletTransaction,
    WashToken,
)
from apps.utilities.serializers import (
    BollardFaultLogSerializer,
    BollardSwitchSerializer,
    MeterOutageAlertSerializer,
    MeterReadingCreateSerializer,
    MeterReadingSerializer,
    ServiceBollardSerializer,
    StripeTopUpSerializer,
    UtilityWalletSerializer,
    WalletTopUpSerializer,
    WashTokenRedeemSerializer,
    WashTokenSerializer,
    SmartMeterSerializer,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _marina(request):
    """Return the marina for the authenticated user."""
    return request.user.marina


def resolve_marina_from_header(request):
    """
    Resolve marina from X-Hardware-ID or X-Marina-API-Key header.
    Used by WashTokenRedeemView (kiosk-initiated, no JWT).
    Raises PermissionDenied if header is missing or invalid.
    """
    from apps.accounts.models import Marina

    hardware_id = request.headers.get('X-Hardware-ID', '').strip()
    api_key     = request.headers.get('X-Marina-API-Key', '').strip()

    if not hardware_id and not api_key:
        raise PermissionDenied('X-Hardware-ID or X-Marina-API-Key header required.')

    # Lookup by API key (stored on Marina model — extend as needed)
    if api_key:
        try:
            return Marina.objects.get(api_key=api_key)
        except (Marina.DoesNotExist, AttributeError):
            raise PermissionDenied('Invalid X-Marina-API-Key.')

    # Fallback: hardware_id maps to marina via a separate HardwareDevice registry
    # (not yet implemented — extend here when HardwareDevice model is added)
    raise PermissionDenied('Could not resolve marina from provided headers.')


# ---------------------------------------------------------------------------
# SmartMeter ViewSet
# ---------------------------------------------------------------------------

class SmartMeterViewSet(viewsets.ModelViewSet):
    """
    GET  /api/v1/utilities/smart-meters/              List meters; filter: ?berth=, ?is_online=false
    POST /api/v1/utilities/smart-meters/              Register new meter
    PATCH /api/v1/utilities/smart-meters/{id}/        Update meter config

    Custom actions:
      GET  .../readings/     Paginated readings; filter: ?from=, ?to=
      POST .../readings/     Manual reading entry
      GET  .../trend/        Aggregated hourly trend JSON for charts
    """
    serializer_class   = SmartMeterSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = SmartMeter.objects.filter(marina=_marina(self.request)).select_related('berth')
        berth = self.request.query_params.get('berth')
        if berth:
            qs = qs.filter(berth_id=berth)
        is_online = self.request.query_params.get('is_online')
        if is_online is not None:
            qs = qs.filter(is_online=(is_online.lower() != 'false'))
        return qs

    def perform_create(self, serializer):
        serializer.save(marina=_marina(self.request))

    # ------------------------------------------------------------------
    # Readings sub-resource
    # ------------------------------------------------------------------

    @action(detail=True, methods=['get', 'post'], url_path='readings')
    def readings(self, request, pk=None):
        meter = self.get_object()

        if request.method == 'GET':
            qs = MeterReading.objects.filter(meter=meter)
            from_dt = request.query_params.get('from')
            to_dt   = request.query_params.get('to')
            if from_dt:
                qs = qs.filter(recorded_at__gte=from_dt)
            if to_dt:
                qs = qs.filter(recorded_at__lte=to_dt)
            serializer = MeterReadingSerializer(qs, many=True)
            return Response(serializer.data)

        # POST — manual entry
        serializer = MeterReadingCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(meter=meter)
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    # ------------------------------------------------------------------
    # Hourly trend for charts
    # ------------------------------------------------------------------

    @action(detail=True, methods=['get'], url_path='trend')
    def trend(self, request, pk=None):
        from django.db.models import Sum
        from django.db.models.functions import Trunc

        meter   = self.get_object()
        from_dt = request.query_params.get('from')
        to_dt   = request.query_params.get('to')

        qs = MeterReading.objects.filter(meter=meter)
        if from_dt:
            qs = qs.filter(recorded_at__gte=from_dt)
        if to_dt:
            qs = qs.filter(recorded_at__lte=to_dt)

        trend = (
            qs.annotate(hour=Trunc('recorded_at', 'hour'))
            .values('hour')
            .annotate(total_kwh=Sum('reading_kwh'), total_m3=Sum('reading_m3'))
            .order_by('hour')
        )

        return Response(list(trend))


# ---------------------------------------------------------------------------
# MeterOutageAlert ViewSet (read-only — created by outage_service)
# ---------------------------------------------------------------------------

class MeterOutageAlertViewSet(viewsets.ReadOnlyModelViewSet):
    """
    GET /api/v1/utilities/outage-alerts/   Active (unresolved) outage alerts
    """
    serializer_class   = MeterOutageAlertSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        marina = _marina(self.request)
        qs = MeterOutageAlert.objects.filter(
            meter__marina=marina, resolved_at__isnull=True
        ).select_related('meter')
        return qs


# ---------------------------------------------------------------------------
# OFGEM Report View
# ---------------------------------------------------------------------------

class OfgemReportView(APIView):
    """
    GET /api/v1/utilities/ofgem-report/?from=2026-01-01&to=2026-01-31
    Returns a streaming CSV download.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from_str = request.query_params.get('from')
        to_str   = request.query_params.get('to')

        if not from_str or not to_str:
            return Response({'detail': '?from and ?to query params are required (YYYY-MM-DD).'}, status=400)

        try:
            date_from = date.fromisoformat(from_str)
            date_to   = date.fromisoformat(to_str)
        except ValueError:
            return Response({'detail': 'Invalid date format. Use YYYY-MM-DD.'}, status=400)

        from apps.utilities.services.ofgem_service import generate_ofgem_report

        csv_bytes = generate_ofgem_report(_marina(request).pk, date_from, date_to)

        response = StreamingHttpResponse(
            streaming_content=iter([csv_bytes]),
            content_type='text/csv',
        )
        response['Content-Disposition'] = (
            f'attachment; filename="ofgem_report_{from_str}_{to_str}.csv"'
        )
        return response


# ---------------------------------------------------------------------------
# UtilityWallet ViewSet
# ---------------------------------------------------------------------------

class UtilityWalletViewSet(viewsets.ReadOnlyModelViewSet):
    """
    GET /api/v1/utilities/wallets/          List wallets; filter: ?member=
    GET /api/v1/utilities/wallets/{id}/     Wallet detail + transaction ledger
    POST .../top-up/                        Staff manual top-up
    POST .../stripe-top-up/                 Initiate Stripe Payment Intent
    POST .../stripe-confirm/                Confirm payment + credit wallet
    """
    serializer_class   = UtilityWalletSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = UtilityWallet.objects.filter(marina=_marina(self.request)).select_related('member')
        member = self.request.query_params.get('member')
        if member:
            qs = qs.filter(member_id=member)
        return qs

    @action(detail=True, methods=['post'], url_path='top-up')
    def top_up(self, request, pk=None):
        wallet = self.get_object()
        serializer = WalletTopUpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        from apps.utilities.services.wallet_service import credit_wallet
        from apps.utilities.models import UtilityWalletTransaction

        updated = credit_wallet(
            wallet,
            amount=serializer.validated_data['amount'],
            tx_type=UtilityWalletTransaction.TxType.STAFF_LOAD,
            description=serializer.validated_data['description'],
        )
        return Response(UtilityWalletSerializer(updated).data)

    @action(detail=True, methods=['post'], url_path='stripe-top-up')
    def stripe_top_up(self, request, pk=None):
        """
        Create a Stripe PaymentIntent for the requested amount.
        Returns: {client_secret, payment_intent_id}
        """
        wallet = self.get_object()
        serializer = StripeTopUpSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        amount_pence = int(serializer.validated_data['amount'] * 100)
        marina       = wallet.marina

        try:
            import stripe
            stripe.api_key = marina.stripe_account_id  # or from settings

            intent = stripe.PaymentIntent.create(
                amount=amount_pence,
                currency=marina.currency.lower(),
                metadata={
                    'wallet_id': wallet.pk,
                    'member_id': wallet.member_id,
                    'marina_id': marina.pk,
                },
            )
            return Response({
                'client_secret': intent.client_secret,
                'payment_intent_id': intent.id,
            })
        except ImportError:
            return Response({'detail': 'Stripe not installed.'}, status=501)
        except Exception as exc:
            logger.exception('Stripe PaymentIntent creation failed for wallet %s', wallet.pk)
            return Response({'detail': str(exc)}, status=502)

    @action(detail=True, methods=['post'], url_path='stripe-confirm')
    def stripe_confirm(self, request, pk=None):
        """
        Confirm a Stripe PaymentIntent and credit the wallet.
        Body: {payment_intent_id}
        """
        wallet             = self.get_object()
        payment_intent_id  = request.data.get('payment_intent_id', '').strip()

        if not payment_intent_id:
            return Response({'detail': 'payment_intent_id is required.'}, status=400)

        try:
            import stripe
            intent = stripe.PaymentIntent.retrieve(payment_intent_id)

            if intent.status != 'succeeded':
                return Response({'detail': f'Payment not succeeded (status={intent.status}).'}, status=400)

            amount = intent.amount / 100  # pence -> pounds

            from apps.utilities.services.wallet_service import credit_wallet
            from apps.utilities.models import UtilityWalletTransaction

            updated = credit_wallet(
                wallet,
                amount=amount,
                tx_type=UtilityWalletTransaction.TxType.TOP_UP,
                description='Stripe top-up via portal',
                stripe_payment_intent=payment_intent_id,
            )
            return Response(UtilityWalletSerializer(updated).data)
        except ImportError:
            return Response({'detail': 'Stripe not installed.'}, status=501)
        except Exception as exc:
            logger.exception('Stripe confirm failed for wallet %s', wallet.pk)
            return Response({'detail': str(exc)}, status=502)


# ---------------------------------------------------------------------------
# ServiceBollard ViewSet
# ---------------------------------------------------------------------------

class ServiceBollardViewSet(viewsets.ModelViewSet):
    """
    GET  /api/v1/utilities/bollards/             Bollard registry
    POST /api/v1/utilities/bollards/             Register bollard
    PATCH /api/v1/utilities/bollards/{id}/       Update bollard
    POST .../switch/                             Remote on/off
    GET  .../fault-logs/                         Fault history
    POST .../fault-logs/                         Log fault
    """
    serializer_class   = ServiceBollardSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return ServiceBollard.objects.filter(marina=_marina(self.request)).select_related('berth', 'smart_meter')

    def perform_create(self, serializer):
        serializer.save(marina=_marina(self.request))

    @action(detail=True, methods=['post'], url_path='switch')
    def switch(self, request, pk=None):
        bollard    = self.get_object()
        serializer = BollardSwitchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        from apps.utilities.services.bollard_service import switch_bollard

        try:
            vendor_response = switch_bollard(
                bollard,
                action=serializer.validated_data['action'],
                triggered_by=request.user,
                reason=serializer.validated_data.get('reason', ''),
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=400)

        return Response({'success': True, 'vendor_response': vendor_response})

    @action(detail=True, methods=['get', 'post'], url_path='fault-logs')
    def fault_logs(self, request, pk=None):
        bollard = self.get_object()

        if request.method == 'GET':
            qs = BollardFaultLog.objects.filter(bollard=bollard)
            return Response(BollardFaultLogSerializer(qs, many=True).data)

        # POST
        serializer = BollardFaultLogSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        serializer.save(bollard=bollard)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------
# WashToken ViewSet
# ---------------------------------------------------------------------------

class WashTokenViewSet(viewsets.ModelViewSet):
    """
    GET  /api/v1/utilities/wash-tokens/          Token list; filter: ?status=, ?facility=
    POST /api/v1/utilities/wash-tokens/          Generate + sell token; creates InvoiceLineItem
    """
    serializer_class   = WashTokenSerializer
    permission_classes = [IsAuthenticated]
    http_method_names  = ['get', 'post', 'head', 'options']  # No PUT/PATCH/DELETE

    def get_queryset(self):
        qs     = WashToken.objects.filter(marina=_marina(self.request)).select_related('member')
        status = self.request.query_params.get('status')
        fac    = self.request.query_params.get('facility')
        if status:
            qs = qs.filter(status=status)
        if fac:
            qs = qs.filter(facility=fac)
        return qs

    def perform_create(self, serializer):
        import secrets
        import string

        # Generate 6-char uppercase alphanumeric token_code unique within marina
        marina = _marina(self.request)
        alphabet = string.ascii_uppercase + string.digits
        for _ in range(20):
            code = ''.join(secrets.choice(alphabet) for _ in range(6))
            if not WashToken.objects.filter(marina=marina, token_code=code).exists():
                serializer.save(marina=marina, token_code=code)
                return
        raise ValidationError('Could not generate unique token code. Try again.')


# ---------------------------------------------------------------------------
# WashToken Redeem View (hardware-initiated — no JWT)
# ---------------------------------------------------------------------------

class WashTokenRedeemView(APIView):
    """
    POST /api/v1/utilities/wash-tokens/redeem/

    Resolves marina from X-Hardware-ID or X-Marina-API-Key header.
    Uses select_for_update() inside transaction.atomic() to prevent
    double-redemption under concurrent requests.

    Returns 400 with code 'token_already_redeemed' if status != 'issued'.
    """
    permission_classes = []  # No JWT required — hardware-initiated
    authentication_classes = []

    def post(self, request):
        marina = resolve_marina_from_header(request)

        serializer = WashTokenRedeemSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        token_code = serializer.validated_data['token_code']

        with transaction.atomic():
            try:
                token = WashToken.objects.select_for_update().get(
                    marina=marina, token_code=token_code
                )
            except WashToken.DoesNotExist:
                return Response({'detail': 'Invalid token code.'}, status=400)

            if token.status != 'issued':
                return Response({'detail': 'token_already_redeemed'}, status=400)

            if token.expires_at and token.expires_at < timezone.now():
                return Response({'detail': 'Token has expired.'}, status=400)

            token.status      = 'redeemed'
            token.redeemed_at = timezone.now()
            token.save(update_fields=['status', 'redeemed_at'])

        return Response({
            'facility':   token.facility,
            'token_code': token.token_code,
        })
