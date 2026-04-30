# backend/apps/reservations/views.py
import stripe
from stripe import SignatureVerificationError as StripeSignatureError
from django.conf import settings
from django.core.mail import send_mail
from django.http import HttpResponse
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import generics, serializers as drf_serializers, status as http_status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter

from apps.berths.models import Berth
from apps.billing.models import Invoice
from .booking_engine import (
    NoAvailableBerthError,
    compatible_available_berths,
    create_manual_approval,
    run_tetris,
)
from .models import Booking, BookingRequest
from .serializers import (
    AssignBerthSerializer,
    BookingEngineRequestSerializer,
    BookingRequestSerializer,
    BookingSerializer,
)

import datetime
from django.db import transaction

stripe.api_key = settings.STRIPE_SECRET_KEY


# ── Existing CRUD views ────────────────────────────────────────────────────────

class BookingListCreateView(generics.ListCreateAPIView):
    serializer_class = BookingSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ['status', 'booking_type', 'paid']
    search_fields = ['vessel__name', 'berth__code', 'guest_name']

    def get_queryset(self):
        return Booking.objects.filter(marina=self.request.user.marina).select_related(
            'vessel', 'vessel__owner', 'berth'
        )

    def perform_create(self, serializer):
        check_in  = serializer.validated_data['check_in']
        check_out = serializer.validated_data['check_out']
        berth     = serializer.validated_data.get('berth')
        nights    = (check_out - check_in).days or 1
        price     = berth.price_per_night if berth else None
        amount    = (price * nights) if price is not None else None
        serializer.save(marina=self.request.user.marina, nights=nights, amount=amount)


class BookingDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = BookingSerializer

    def get_queryset(self):
        return Booking.objects.filter(marina=self.request.user.marina)


class BookingRequestListCreateView(generics.ListCreateAPIView):
    serializer_class = BookingRequestSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['status', 'booking_type']

    def get_queryset(self):
        return BookingRequest.objects.filter(marina=self.request.user.marina).select_related(
            'member', 'vessel', 'berth', 'booking'
        )

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class BookingRequestDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = BookingRequestSerializer

    def get_queryset(self):
        return BookingRequest.objects.filter(marina=self.request.user.marina)


class ConvertBookingRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            req = BookingRequest.objects.get(pk=pk, marina=request.user.marina)
        except BookingRequest.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        if req.status == 'rejected':
            return Response({'detail': 'Cannot convert a rejected request.'}, status=http_status.HTTP_400_BAD_REQUEST)

        booking = req.convert_to_booking()
        return Response(BookingSerializer(booking).data, status=http_status.HTTP_200_OK)


# ── Booking Engine views ───────────────────────────────────────────────────────

class AvailableBerthsView(APIView):
    """GET /api/v1/bookings/available-berths/ — returns compatible berths with gap scores."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        check_in = request.query_params.get('check_in')
        check_out = request.query_params.get('check_out')
        if not check_in or not check_out:
            return Response({'detail': 'check_in and check_out are required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        boat_loa = request.query_params.get('boat_loa') or None
        boat_beam = request.query_params.get('boat_beam') or None

        try:
            berths = compatible_available_berths(
                marina=request.user.marina,
                check_in=check_in,
                check_out=check_out,
                boat_loa=float(boat_loa) if boat_loa else None,
                boat_beam=float(boat_beam) if boat_beam else None,
            )
        except ValueError as e:
            return Response({'detail': str(e)}, status=http_status.HTTP_400_BAD_REQUEST)

        from apps.berths.serializers import BerthSerializer
        return Response(BerthSerializer(berths, many=True).data)


class BookingEngineRequestView(APIView):
    """
    POST /api/v1/bookings/engine-request/
    Boater submits a booking request. Branches on marina.booking_mode.
    Mode A → pending_approval (no berth, no payment yet).
    Mode B → pending_payment (berth assigned, Stripe checkout URL returned).
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        ser = BookingEngineRequestSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=http_status.HTTP_400_BAD_REQUEST)

        d = ser.validated_data
        marina = request.user.marina

        if marina.booking_mode == 'manual_approval':
            booking = create_manual_approval(
                marina=marina,
                check_in=d['check_in'],
                check_out=d['check_out'],
                boat_loa=d.get('boat_loa'),
                boat_beam=d.get('boat_beam'),
                guest_name=d.get('guest_name', ''),
                guest_email=d.get('guest_email', ''),
                guest_phone=d.get('guest_phone', ''),
            )
            return Response(BookingSerializer(booking).data, status=http_status.HTTP_201_CREATED)

        # Mode B: auto_tetris
        try:
            with transaction.atomic():
                booking = run_tetris(
                    marina=marina,
                    check_in=d['check_in'],
                    check_out=d['check_out'],
                    boat_loa=d.get('boat_loa'),
                    boat_beam=d.get('boat_beam'),
                    guest_name=d.get('guest_name', ''),
                    guest_email=d.get('guest_email', ''),
                    guest_phone=d.get('guest_phone', ''),
                )
                Invoice.objects.create(
                    marina=marina,
                    booking=booking,
                    invoice_type='berth_fee',
                    amount=booking.amount or 0,
                    issued=datetime.date.today(),
                    due=datetime.date.today() + datetime.timedelta(days=marina.payment_terms),
                    status='unpaid',
                )
                checkout_url = _create_stripe_session(booking, marina)
        except NoAvailableBerthError as e:
            return Response({'detail': str(e)}, status=http_status.HTTP_409_CONFLICT)
        except stripe.StripeError:
            return Response({'detail': 'Payment provider error. Please try again.'}, status=http_status.HTTP_503_SERVICE_UNAVAILABLE)

        data = BookingSerializer(booking).data
        data['checkout_url'] = checkout_url
        return Response(data, status=http_status.HTTP_201_CREATED)


class AssignBerthView(APIView):
    """
    POST /api/v1/bookings/<pk>/assign-berth/
    Admin assigns a berth to a pending_approval booking.
    Validates physical compatibility, creates Invoice, fires Stripe Checkout link via email.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            booking = Booking.objects.get(pk=pk, marina=request.user.marina)
        except Booking.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        if booking.status != 'pending_approval':
            return Response({'detail': 'Only pending_approval bookings can be assigned a berth.'}, status=http_status.HTTP_400_BAD_REQUEST)

        ser = AssignBerthSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=http_status.HTTP_400_BAD_REQUEST)

        try:
            berth = Berth.objects.get(pk=ser.validated_data['berth_id'], marina=request.user.marina)
        except Berth.DoesNotExist:
            return Response({'detail': 'Berth not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        # Validate physical compatibility
        if booking.boat_loa and berth.length_m and berth.length_m < booking.boat_loa:
            return Response({'detail': 'Berth is too short for this boat.'}, status=http_status.HTTP_400_BAD_REQUEST)
        if booking.boat_beam and berth.max_beam_m and berth.max_beam_m < booking.boat_beam:
            return Response({'detail': 'Berth beam limit too narrow for this boat.'}, status=http_status.HTTP_400_BAD_REQUEST)

        nights = booking.nights or 1
        price = berth.price_per_night
        amount = (price * nights) if price is not None else 0

        try:
            with transaction.atomic():
                booking.berth = berth
                booking.amount = amount
                booking.status = 'awaiting_payment'
                booking.save(update_fields=['berth', 'amount', 'status'])

                Invoice.objects.create(
                    marina=request.user.marina,
                    booking=booking,
                    invoice_type='berth_fee',
                    amount=amount,
                    issued=datetime.date.today(),
                    due=datetime.date.today() + datetime.timedelta(days=request.user.marina.payment_terms),
                    status='unpaid',
                )

                checkout_url = _create_stripe_session(booking, request.user.marina)
        except stripe.StripeError:
            return Response({'detail': 'Payment provider error. Please try again.'}, status=http_status.HTTP_503_SERVICE_UNAVAILABLE)

        if booking.guest_email:
            send_mail(
                subject=f'Your DocksBase Booking — Pay Now',
                message=(
                    f"Hello {booking.guest_name or 'there'},\n\n"
                    f"Your berth ({berth.code}) has been assigned for "
                    f"{booking.check_in} – {booking.check_out}.\n\n"
                    f"Please complete payment here:\n{checkout_url}"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[booking.guest_email],
                fail_silently=True,
            )

        return Response(BookingSerializer(booking).data, status=http_status.HTTP_200_OK)


@method_decorator(csrf_exempt, name='dispatch')
class StripeWebhookView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        payload = request.body
        sig_header = request.META.get('HTTP_STRIPE_SIGNATURE', '')

        try:
            event = stripe.Webhook.construct_event(payload, sig_header, settings.STRIPE_WEBHOOK_SECRET)
        except (ValueError, StripeSignatureError):
            return HttpResponse(status=400)

        if event['type'] == 'checkout.session.completed':
            session = event['data']['object']
            booking_id = session.get('metadata', {}).get('booking_id')
            if booking_id:
                try:
                    booking = Booking.objects.get(id=booking_id)
                    booking.status = 'confirmed'
                    booking.paid = True
                    booking.save(update_fields=['status', 'paid'])
                    Invoice.objects.filter(booking=booking).update(status='paid')
                except Booking.DoesNotExist:
                    pass

        return HttpResponse(status=200)


# ── Helper ─────────────────────────────────────────────────────────────────────

def _create_stripe_session(booking, marina):
    """Create a Stripe Checkout Session for a booking; save session ID; return checkout URL."""
    nights_label = f'{booking.nights} night{"s" if booking.nights != 1 else ""}'
    berth_code = booking.berth.code if booking.berth else 'TBD'
    session = stripe.checkout.Session.create(
        payment_method_types=['card'],
        line_items=[{
            'price_data': {
                'currency': marina.currency.lower(),
                'product_data': {'name': f'Berth {berth_code} — {nights_label}'},
                'unit_amount': int(round((booking.amount or 0) * 100)),
            },
            'quantity': 1,
        }],
        mode='payment',
        success_url=f'{settings.FRONTEND_URL}/booking/success?session_id={{CHECKOUT_SESSION_ID}}',
        cancel_url=f'{settings.FRONTEND_URL}/booking/cancelled',
        metadata={'booking_id': str(booking.id)},
    )
    booking.stripe_session_id = session.id
    booking.save(update_fields=['stripe_session_id'])
    return session.url
