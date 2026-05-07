import datetime
import logging

from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status

logger = logging.getLogger(__name__)

from apps.reservations.models import Booking
from apps.reservations.emails import (
    send_booking_request_boater_email,
    send_booking_request_manager_email,
    send_booking_confirmed_email,
)
from django.db import transaction

from apps.reservations.booking_engine import compatible_available_berths, find_date_alternatives, run_tetris, NoAvailableBerthError
from apps.berths.models import Berth, BerthCategory
from django.db.models import Q, Exists, OuterRef
from apps.reservations.serializers import BookingSerializer
from apps.berths.serializers import BerthSerializer
from apps.billing import service as billing_service


def _parse_availability_params(request):
    """
    Parse check_in, check_out, boat_loa, boat_beam, boat_draft from query params.
    Raises KeyError if check_in or check_out are missing.
    Raises ValueError with a human-readable message on any validation failure.
    """
    check_in = request.query_params.get('check_in')
    check_out = request.query_params.get('check_out')
    if not check_in or not check_out:
        raise KeyError('check_in and check_out are required.')

    try:
        ci = datetime.date.fromisoformat(check_in)
        co = datetime.date.fromisoformat(check_out)
    except ValueError:
        raise ValueError('Invalid date format. Use YYYY-MM-DD.')

    if ci >= co:
        raise ValueError('check_out must be after check_in.')

    return (
        ci, co,
        request.query_params.get('boat_loa') or None,
        request.query_params.get('boat_beam') or None,
        request.query_params.get('boat_draft') or None,
    )


class PublicBookingRequestSerializer(serializers.Serializer):
    check_in = serializers.DateField()
    check_out = serializers.DateField()
    guest_name = serializers.CharField(max_length=200)
    guest_email = serializers.EmailField()
    boat_loa = serializers.DecimalField(max_digits=6, decimal_places=2)
    boat_beam = serializers.DecimalField(max_digits=5, decimal_places=2)
    boat_draft = serializers.DecimalField(max_digits=5, decimal_places=2)

    def validate(self, data):
        if data['check_in'] >= data['check_out']:
            raise serializers.ValidationError({'check_out': 'check_out must be after check_in.'})
        if data['check_in'] < datetime.date.today():
            raise serializers.ValidationError({'check_in': 'check_in cannot be in the past.'})
        return data


class PublicBookingCreateView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        if request.tenant is None:
            return Response({'detail': 'Marina not found.'}, status=status.HTTP_404_NOT_FOUND)

        ser = PublicBookingRequestSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        d = ser.validated_data
        booking = Booking.objects.create(
            marina=request.tenant,
            check_in=d['check_in'],
            check_out=d['check_out'],
            nights=(d['check_out'] - d['check_in']).days,
            guest_name=d['guest_name'],
            guest_email=d['guest_email'],
            boat_loa=d['boat_loa'],
            boat_beam=d['boat_beam'],
            boat_draft=d['boat_draft'],
            status='pending_approval',
            booking_type='transient',
        )

        send_booking_request_boater_email(booking)
        send_booking_request_manager_email(booking)

        return Response(
            {
                'booking_id': booking.id,
                'message': 'Request received. The harbour master will review within 24 hours.',
            },
            status=status.HTTP_201_CREATED,
        )


class PublicAvailableBerthsView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        if request.tenant is None:
            return Response({'detail': 'Marina not found.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            ci, co, boat_loa, boat_beam, boat_draft = _parse_availability_params(request)
        except KeyError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except ValueError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        try:
            berths = compatible_available_berths(
                marina=request.tenant,
                check_in=ci,
                check_out=co,
                boat_loa=boat_loa,
                boat_beam=boat_beam,
                boat_draft=boat_draft,
            ).prefetch_related('bookings')
        except ValueError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(BerthSerializer(berths, many=True).data)


class PublicAvailabilityAlternativesView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        if request.tenant is None:
            return Response({'detail': 'Marina not found.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            ci, co, boat_loa, boat_beam, boat_draft = _parse_availability_params(request)
        except KeyError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except ValueError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        try:
            alternatives = find_date_alternatives(
                marina=request.tenant,
                check_in=ci,
                check_out=co,
                boat_loa=boat_loa,
                boat_beam=boat_beam,
                boat_draft=boat_draft,
            )
        except ValueError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        result = [
            {
                'check_in': str(a['check_in']),
                'check_out': str(a['check_out']),
                'nights': a['nights'],
                'price_per_night': str(a['price_per_night']),
                'total': str(a['total']),
            }
            for a in alternatives
        ]
        return Response(result)


class PublicEngineRequestSerializer(serializers.Serializer):
    check_in          = serializers.DateField()
    check_out         = serializers.DateField()
    guest_name        = serializers.CharField(max_length=200)
    guest_email       = serializers.EmailField()
    guest_phone       = serializers.CharField(max_length=30, required=False, allow_blank=True)
    boat_loa          = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, allow_null=True)
    boat_beam         = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    boat_draft        = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    vessel_name        = serializers.CharField(max_length=200, required=False, allow_blank=True)
    eta                = serializers.TimeField(required=False, allow_null=True)
    berth_category_id  = serializers.IntegerField(required=False, allow_null=True)
    payment_intent_id  = serializers.CharField(max_length=200, required=False, allow_blank=True)

    def validate(self, data):
        if data['check_in'] >= data['check_out']:
            raise serializers.ValidationError({'check_out': 'check_out must be after check_in.'})
        if data['check_in'] < datetime.date.today():
            raise serializers.ValidationError({'check_in': 'check_in cannot be in the past.'})
        return data


class PublicEngineRequestView(APIView):
    """POST /api/v1/public/bookings/engine-request/"""
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        if request.tenant is None:
            return Response({'detail': 'Marina not found.'}, status=status.HTTP_404_NOT_FOUND)

        marina = request.tenant
        if marina.booking_mode != 'auto_tetris':
            return Response({'detail': 'This marina does not accept online bookings.'}, status=status.HTTP_400_BAD_REQUEST)

        ser = PublicEngineRequestSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        d = ser.validated_data
        category_id = d.get('berth_category_id')
        payment_intent_id = d.get('payment_intent_id', '')
        cat = None
        if category_id:
            try:
                cat = BerthCategory.objects.get(pk=category_id, marina=marina, is_active=True)
            except BerthCategory.DoesNotExist:
                return Response({'detail': 'Berth category not found.'}, status=status.HTTP_400_BAD_REQUEST)

        # Category flow: payment already collected via PaymentIntent before this call.
        # Skip invoice/checkout creation — booking goes straight to confirmed.
        pre_paid = bool(cat and payment_intent_id)

        try:
            with transaction.atomic():
                booking = run_tetris(
                    marina=marina,
                    check_in=d['check_in'],
                    check_out=d['check_out'],
                    boat_loa=d.get('boat_loa'),
                    boat_beam=d.get('boat_beam'),
                    boat_draft=d.get('boat_draft'),
                    guest_name=d['guest_name'],
                    guest_email=d['guest_email'],
                    guest_phone=d.get('guest_phone', ''),
                )
                if cat:
                    booking.notes = (booking.notes or '') + f'\nCategory: {cat.name}'
                    booking.save(update_fields=['notes'])

                if pre_paid:
                    # Mark booking confirmed immediately; record the PaymentIntent ID in notes.
                    booking.status = 'confirmed'
                    booking.notes = (booking.notes or '') + f'\nPaymentIntent: {payment_intent_id}'
                    booking.save(update_fields=['status', 'notes'])
                    try:
                        send_booking_confirmed_email(booking)
                    except Exception:
                        logger.exception('PublicEngineRequestView: failed to send booking confirmed email')
                    checkout_url = None
                else:
                    booking.berth = Berth.objects.select_related('pricing_tier').get(pk=booking.berth_id)
                    nights_label = f'{booking.nights} night{"s" if booking.nights != 1 else ""}'
                    due_date = datetime.date.today() + datetime.timedelta(days=marina.payment_terms)
                    inv = billing_service.create_invoice(
                        marina,
                        member=None,
                        source_type='berth_booking',
                        source_id=str(booking.id),
                        due_date=due_date,
                    )
                    if not booking.amount:
                        raise RuntimeError('Berth has no price set — cannot create invoice.')
                    billing_service.add_line_item(
                        inv,
                        description=f'Berth — {nights_label} @ {booking.berth.pricing_tier.unit_price}/night',
                        quantity=1,
                        unit_price=booking.amount,
                    )
                    billing_service.finalize_invoice(inv)
                    inv.booking = booking
                    inv.save(update_fields=['booking'])
                    checkout_url = billing_service.create_stripe_checkout_session(inv)
        except NoAvailableBerthError as e:
            return Response({'detail': str(e)}, status=status.HTTP_409_CONFLICT)
        except ValueError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            logger.exception('PublicEngineRequestView: unexpected error during checkout session creation')
            return Response(
                {'detail': 'Payment provider error. Please try again.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response(
            {'booking': BookingSerializer(booking).data, 'checkout_url': checkout_url},
            status=status.HTTP_201_CREATED,
        )


class PublicBerthIntentSerializer(serializers.Serializer):
    berth_category_id = serializers.IntegerField()
    check_in          = serializers.DateField()
    check_out         = serializers.DateField()

    def validate(self, data):
        if data['check_in'] >= data['check_out']:
            raise serializers.ValidationError({'check_out': 'check_out must be after check_in.'})
        return data


class PublicBerthIntentView(APIView):
    """POST /api/v1/public/bookings/intent/ — creates Stripe PaymentIntent for a category."""
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        if request.tenant is None:
            return Response({'detail': 'Marina not found.'}, status=status.HTTP_404_NOT_FOUND)

        ser = PublicBerthIntentSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        d = ser.validated_data
        marina = request.tenant

        try:
            cat = BerthCategory.objects.select_related('pricing_tier').get(
                pk=d['berth_category_id'],
                marina=marina,
                is_active=True,
            )
        except BerthCategory.DoesNotExist:
            return Response({'detail': 'Berth category not found or inactive.'}, status=status.HTTP_400_BAD_REQUEST)

        if cat.pricing_tier is None:
            return Response({'detail': 'This category has no price configured.'}, status=status.HTTP_400_BAD_REQUEST)

        nights = (d['check_out'] - d['check_in']).days
        price_per_night = cat.pricing_tier.unit_price
        total = price_per_night * nights
        amount_cents = int(round(float(total) * 100))

        try:
            client_secret = billing_service.create_payment_intent(
                marina=marina,
                amount_cents=amount_cents,
                currency=marina.currency,
                metadata={
                    'berth_category_id': str(cat.id),
                    'check_in': str(d['check_in']),
                    'check_out': str(d['check_out']),
                    'marina_id': str(marina.id),
                },
            )
        except Exception:
            logger.exception('PublicBerthIntentView: Stripe error')
            return Response({'detail': 'Payment provider error.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        return Response({
            'client_secret': client_secret,
            'nights': nights,
            'price_per_night': f'{price_per_night:.2f}',
            'total': f'{total:.2f}',
        })


class PublicBerthCategoriesView(APIView):
    """GET /api/v1/public/bookings/berth-categories/"""
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        if request.tenant is None:
            return Response({'detail': 'Marina not found.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            ci, co, boat_loa, boat_beam, boat_draft = _parse_availability_params(request)
        except KeyError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except ValueError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        # Berths occupied during the requested window
        conflicting_bookings = Booking.objects.filter(
            berth=OuterRef('pk'),
            status__in=['pending_payment', 'confirmed', 'checked_in'],
            check_in__lt=co,
            check_out__gt=ci,
        )

        # Available berths: standard class, fits boat, no conflict, has a category
        try:
            dim_filter = Q()
            if boat_loa:
                dim_filter &= Q(length_m__gte=float(boat_loa))
            if boat_beam:
                dim_filter &= Q(max_beam_m__gte=float(boat_beam))
            if boat_draft:
                dim_filter &= Q(max_draft_m__gte=float(boat_draft))
        except ValueError:
            return Response({'detail': 'Boat dimensions must be numeric.'}, status=status.HTTP_400_BAD_REQUEST)

        available_berths = Berth.objects.filter(
            marina=request.tenant,
            berth_class='standard',
            status__in=['available', 'reserved'],
            category__isnull=False,
        ).filter(dim_filter).exclude(Exists(conflicting_bookings))

        # Group by category — only active categories with a pricing tier
        categories = BerthCategory.objects.filter(
            marina=request.tenant,
            is_active=True,
            pricing_tier__isnull=False,
        ).select_related('pricing_tier')

        result = []
        for cat in categories:
            count = available_berths.filter(category=cat).count()
            if count == 0:
                continue
            result.append({
                'id': cat.id,
                'name': cat.name,
                'description': cat.description,
                'mooring_type': cat.mooring_type,
                'amenities': cat.amenities,
                'price_per_night': f'{cat.pricing_tier.unit_price:.2f}',
                'available_count': count,
            })

        return Response(result)
