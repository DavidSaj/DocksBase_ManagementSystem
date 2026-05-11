import datetime

from django.conf import settings
from django.core.mail import send_mail
from django.db import transaction
from rest_framework import generics, status as http_status
from rest_framework.filters import SearchFilter
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django_filters.rest_framework import DjangoFilterBackend

from apps.berths.models import Berth
from apps.billing import service as billing_service
from apps.billing.models import ChargeableItem, Invoice as InvoiceModel
from django.db.models import Sum
from .booking_engine import (
    NoAvailableBerthError,
    compatible_available_berths,
    create_manual_approval,
    run_tetris,
)
from .emails import send_approve_email, send_reject_email
from .models import Booking, BookingRequest
from .serializers import (
    AssignBerthSerializer,
    BookingEngineRequestSerializer,
    BookingRequestSerializer,
    BookingSerializer,
)


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
        price     = berth.pricing_tier.unit_price if berth else None
        amount    = (price * nights) if price is not None else None
        serializer.save(marina=self.request.user.marina, nights=nights, amount=amount)
        # Auto-generate a draft invoice from the price book (best-effort — never blocks the booking)
        try:
            billing_service.calculate_booking_invoice(serializer.instance)
        except Exception:
            pass


class BookingDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = BookingSerializer

    def get_queryset(self):
        return Booking.objects.filter(marina=self.request.user.marina)

    def perform_update(self, serializer):
        current = self.get_object()
        new_status = serializer.validated_data.get('status', current.status)

        # Enforce state machine for the two operational transitions staff can trigger.
        if new_status == 'checked_in' and current.status not in ('confirmed', 'pending', 'no_show'):
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'status': f'Cannot check in from status "{current.status}".'})
        if new_status == 'checked_out' and current.status not in ('checked_in', 'overstay'):
            from rest_framework.exceptions import ValidationError
            raise ValidationError({'status': f'Cannot check out from status "{current.status}".'})

        with transaction.atomic():
            instance = serializer.save()
            if instance.status == 'checked_out':
                draft = InvoiceModel.objects.filter(
                    marina=self.request.user.marina,
                    source_type='berth_booking',
                    source_id=str(instance.id),
                    status='draft',
                ).first()
                if draft and draft.items.exists():
                    try:
                        billing_service.finalize_invoice(draft)
                    except Exception:
                        pass  # invoice transitioned out of draft concurrently or billing error


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
        check_in  = request.query_params.get('check_in')
        check_out = request.query_params.get('check_out')
        if not check_in or not check_out:
            return Response({'detail': 'check_in and check_out are required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        boat_loa   = request.query_params.get('boat_loa') or None
        boat_beam  = request.query_params.get('boat_beam') or None
        boat_draft = request.query_params.get('boat_draft') or None

        try:
            berths = compatible_available_berths(
                marina=request.user.marina,
                check_in=check_in,
                check_out=check_out,
                boat_loa=boat_loa,
                boat_beam=boat_beam,
                boat_draft=boat_draft,
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
    Mode B → pending_payment (berth assigned, billing invoice + Stripe checkout URL returned).
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
                boat_draft=d.get('boat_draft'),
                guest_name=d.get('guest_name', ''),
                guest_email=d.get('guest_email', ''),
                guest_phone=d.get('guest_phone', ''),
            )
            return Response(BookingSerializer(booking).data, status=http_status.HTTP_201_CREATED)

        # Mode B: auto_tetris — assign berth, create invoice, return checkout URL
        try:
            with transaction.atomic():
                booking = run_tetris(
                    marina=marina,
                    check_in=d['check_in'],
                    check_out=d['check_out'],
                    boat_loa=d.get('boat_loa'),
                    boat_beam=d.get('boat_beam'),
                    boat_draft=d.get('boat_draft'),
                    guest_name=d.get('guest_name', ''),
                    guest_email=d.get('guest_email', ''),
                    guest_phone=d.get('guest_phone', ''),
                )
                nights_label = f'{booking.nights} night{"s" if booking.nights != 1 else ""}'
                due_date = datetime.date.today() + datetime.timedelta(days=marina.payment_terms)
                inv = billing_service.create_invoice(
                    marina,
                    member=booking.vessel.owner if booking.vessel else None,
                    source_type='berth_booking',
                    source_id=str(booking.id),
                    due_date=due_date,
                )
                if not booking.amount:
                    raise ValueError('Berth has no price set — cannot create invoice.')
                billing_service.add_line_item(
                    inv,
                    description=f'Berth {booking.berth.code} — {nights_label} @ {booking.berth.pricing_tier.unit_price}/night',
                    quantity=1,
                    unit_price=booking.amount,
                )
                billing_service.finalize_invoice(inv)
                inv.booking = booking
                inv.save(update_fields=['booking'])
                checkout_url = billing_service.create_stripe_checkout_session(inv)
        except NoAvailableBerthError as e:
            return Response({'detail': str(e)}, status=http_status.HTTP_409_CONFLICT)
        except ValueError as e:
            return Response({'detail': str(e)}, status=http_status.HTTP_400_BAD_REQUEST)
        except Exception:
            return Response(
                {'detail': 'Payment provider error. Please try again.'},
                status=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response(
            {'booking': BookingSerializer(booking).data, 'checkout_url': checkout_url},
            status=http_status.HTTP_201_CREATED,
        )


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
            return Response(
                {'detail': 'Only pending_approval bookings can be assigned a berth.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

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

        from apps.billing.models import Invoice as InvoiceModel
        existing_invoice = InvoiceModel.objects.filter(
            marina=request.user.marina,
            source_type='berth_booking',
            source_id=str(booking.id),
        ).exclude(status='void').first()
        if existing_invoice:
            return Response(
                {'detail': 'An invoice already exists for this booking.'},
                status=http_status.HTTP_409_CONFLICT,
            )

        nights = booking.nights or 1
        price = berth.pricing_tier.unit_price
        amount = price * nights
        due_date = datetime.date.today() + datetime.timedelta(days=request.user.marina.payment_terms)
        nights_label = f'{nights} night{"s" if nights != 1 else ""}'

        try:
            with transaction.atomic():
                booking.berth = berth
                booking.amount = amount
                booking.status = 'awaiting_payment'
                booking.save(update_fields=['berth', 'amount', 'status'])

                inv = billing_service.create_invoice(
                    request.user.marina,
                    member=booking.vessel.owner if booking.vessel else None,
                    source_type='berth_booking',
                    source_id=str(booking.id),
                    due_date=due_date,
                )
                billing_service.add_line_item(
                    inv,
                    description=f'Berth {berth.code} — {nights_label} @ {berth.pricing_tier.unit_price}/night',
                    quantity=1,
                    unit_price=amount,
                )
                billing_service.finalize_invoice(inv)
                inv.booking = booking
                inv.save(update_fields=['booking'])
                checkout_url = billing_service.create_stripe_checkout_session(inv)
        except Exception:
            return Response(
                {'detail': 'Payment provider error. Please try again.'},
                status=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        email_address = booking.guest_email or (
            booking.vessel.owner.email if booking.vessel and booking.vessel.owner else None
        )
        if email_address:
            send_mail(
                subject='Your DocksBase Booking — Pay Now',
                message=(
                    f"Hello {booking.guest_name or 'there'},\n\n"
                    f"Your berth ({berth.code}) has been assigned for "
                    f"{booking.check_in} – {booking.check_out}.\n\n"
                    f"Please complete payment here:\n{checkout_url}"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[email_address],
                fail_silently=True,
            )

        return Response(BookingSerializer(booking).data, status=http_status.HTTP_200_OK)


class ApproveBookingView(APIView):
    """
    POST /api/v1/bookings/<pk>/approve/   { "berth_id": 42 }
    Manager assigns berth + sends Stripe payment link. Collision-safe.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            booking = Booking.objects.get(pk=pk, marina=request.user.marina)
        except Booking.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        if booking.status != 'pending_approval':
            return Response(
                {'detail': 'Booking is not pending approval.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        berth_id = request.data.get('berth_id')
        if not berth_id:
            return Response({'detail': 'berth_id is required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        marina = request.user.marina

        try:
            with transaction.atomic():
                # Lock the berth row to serialize concurrent approve requests.
                try:
                    berth = Berth.objects.select_for_update().get(pk=berth_id, marina=marina)
                except Berth.DoesNotExist:
                    return Response(
                        {'detail': 'Berth does not belong to this marina.'},
                        status=http_status.HTTP_400_BAD_REQUEST,
                    )

                # Collision check inside the lock — safe against concurrent approvals.
                collision = Booking.objects.filter(
                    berth=berth,
                    status__in=('awaiting_payment', 'confirmed', 'checked_in'),
                    check_in__lt=booking.check_out,
                    check_out__gt=booking.check_in,
                ).exists()
                if collision:
                    return Response(
                        {'detail': 'Berth is already booked for these dates.'},
                        status=http_status.HTTP_409_CONFLICT,
                    )

                if not hasattr(berth, 'pricing_tier') or berth.pricing_tier is None:
                    return Response(
                        {'detail': 'Berth has no pricing tier configured.'},
                        status=http_status.HTTP_400_BAD_REQUEST,
                    )

                nights = booking.nights or (booking.check_out - booking.check_in).days or 1
                berth_cost = berth.pricing_tier.unit_price * nights
                fees = ChargeableItem.objects.filter(
                    marina=marina, category='booking_fee'
                ).aggregate(total=Sum('unit_price'))['total'] or 0
                total = berth_cost + fees

                nights_label = f'{nights} night{"s" if nights != 1 else ""}'
                due_date = datetime.date.today() + datetime.timedelta(days=marina.payment_terms)

                booking.berth = berth
                booking.amount = total
                booking.status = 'awaiting_payment'
                booking.save(update_fields=['berth', 'amount', 'status'])

                inv = billing_service.create_invoice(
                    marina,
                    source_type='berth_booking',
                    source_id=str(booking.id),
                    due_date=due_date,
                )
                billing_service.add_line_item(
                    inv,
                    description=f'Berth {berth.code} — {nights_label} @ {berth.pricing_tier.unit_price}/night',
                    quantity=1,
                    unit_price=berth_cost,
                )
                for fee_item in ChargeableItem.objects.filter(marina=marina, category='booking_fee'):
                    billing_service.add_line_item(
                        inv,
                        description=fee_item.name,
                        quantity=1,
                        unit_price=fee_item.unit_price,
                    )
                billing_service.finalize_invoice(inv)

                inv.booking = booking
                inv.save(update_fields=['booking'])

                checkout_url = billing_service.create_stripe_checkout_session(inv)
        except Exception:
            return Response(
                {'detail': 'Payment provider error. Please try again.'},
                status=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        send_approve_email(booking, checkout_url=checkout_url)
        return Response({'checkout_url': checkout_url}, status=http_status.HTTP_200_OK)


class RejectBookingView(APIView):
    """
    POST /api/v1/bookings/<pk>/reject/   { "reason": "..." }
    Manager rejects a pending_approval booking.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            booking = Booking.objects.get(pk=pk, marina=request.user.marina)
        except Booking.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        if booking.status != 'pending_approval':
            return Response(
                {'detail': 'Booking is not pending approval.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        reason = request.data.get('reason', '')
        booking.status = 'cancelled'
        booking.save(update_fields=['status'])

        send_reject_email(booking, reason=reason)
        return Response({'detail': 'Booking rejected.'}, status=http_status.HTTP_200_OK)


# ── Track 2 — Document Gate ────────────────────────────────────────────────────

class ClearDocumentGateView(APIView):
    """
    POST /api/v1/bookings/<pk>/clear-document-gate/
    Body: { insurance_verified: true, registration_verified: true, waiver_verified: true }

    Only marina_manager or owner can call this.
    Requires marina.document_gate_enabled = True.
    After clearing, transitions pending_approval bookings to the next state.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        from django.utils import timezone as tz

        if request.user.role not in ('marina_manager', 'owner', 'manager'):
            return Response(
                {'detail': 'Only marina managers or owners can clear the document gate.'},
                status=http_status.HTTP_403_FORBIDDEN,
            )

        try:
            booking = Booking.objects.get(pk=pk, marina=request.user.marina)
        except Booking.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        marina = request.user.marina
        if not marina.document_gate_enabled:
            return Response(
                {'detail': 'Document gate is not enabled for this marina.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        insurance    = request.data.get('insurance_verified', False)
        registration = request.data.get('registration_verified', False)
        waiver       = request.data.get('waiver_verified', False)

        if not (insurance and registration and waiver):
            return Response(
                {'detail': 'All three documents (insurance, registration, waiver) must be verified.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        booking.insurance_verified       = True
        booking.registration_verified    = True
        booking.waiver_verified          = True
        booking.document_gate_cleared    = True
        booking.document_gate_cleared_by = request.user
        booking.document_gate_cleared_at = tz.now()

        # If booking is pending_approval and document gate is now cleared,
        # allow the approval flow to continue.
        update_fields = [
            'insurance_verified', 'registration_verified', 'waiver_verified',
            'document_gate_cleared', 'document_gate_cleared_by', 'document_gate_cleared_at',
        ]

        booking.save(update_fields=update_fields)
        return Response(BookingSerializer(booking).data, status=http_status.HTTP_200_OK)
