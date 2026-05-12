import datetime
import logging
from decimal import Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

import stripe

from apps.billing import service as billing_service
from apps.berths.models import BerthCategory
from .booking_engine import assign_berth, NoAvailableBerthError
from .emails import send_reservation_confirmed_email
from .models import Reservation, ReservationItem

logger = logging.getLogger(__name__)


class CartItemSerializer(serializers.Serializer):
    berth_category_id = serializers.IntegerField(allow_null=True, required=False)
    boat_loa          = serializers.DecimalField(max_digits=6, decimal_places=2)
    boat_beam         = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    boat_draft        = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    vessel_name       = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')


class ReservationIntentSerializer(serializers.Serializer):
    check_in    = serializers.DateField()
    check_out   = serializers.DateField()
    guest_name  = serializers.CharField(max_length=200)
    guest_email = serializers.EmailField()
    guest_phone = serializers.CharField(max_length=50, required=False, allow_blank=True, default='')
    items       = CartItemSerializer(many=True, min_length=1)

    def validate(self, data):
        if data['check_in'] >= data['check_out']:
            raise serializers.ValidationError({'check_out': 'check_out must be after check_in.'})
        if data['check_in'] < datetime.date.today():
            raise serializers.ValidationError({'check_in': 'check_in cannot be in the past.'})
        return data


class ReservationIntentView(APIView):
    """
    POST /api/v1/public/reservations/intent/

    Runs the tetris algorithm for all cart items inside a single atomic
    transaction, creates Reservation + ReservationItems with status='locked',
    then creates a Stripe PaymentIntent. No records are created if any item
    cannot be placed — the entire transaction rolls back.

    For non-auto_tetris marinas, delegates to _handle_manual() which creates
    a pending_review Reservation with unassigned items and no Stripe payment.
    """
    authentication_classes = []
    permission_classes = [AllowAny]

    def _handle_manual(self, request, marina):
        ser = ReservationIntentSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)
        d = ser.validated_data
        check_in  = d['check_in']
        check_out = d['check_out']
        nights    = (check_out - check_in).days

        with transaction.atomic():
            reservation = Reservation.objects.create(
                marina=marina,
                guest_name=d['guest_name'],
                guest_email=d['guest_email'],
                guest_phone=d.get('guest_phone', ''),
                status='pending_review',
                booking_source='portal',
            )
            for item in d['items']:
                ReservationItem.objects.create(
                    reservation=reservation,
                    berth=None,
                    check_in=check_in,
                    check_out=check_out,
                    nights=nights,
                    vessel_name=item.get('vessel_name', ''),
                    boat_loa=item.get('boat_loa'),
                    boat_beam=item.get('boat_beam'),
                    boat_draft=item.get('boat_draft'),
                    status='unassigned',
                )
        return Response({
            'reservation_id': reservation.pk,
            'reference': f'RES-{reservation.pk}',
            'requires_payment': False,
            'status': 'pending_review',
        }, status=status.HTTP_201_CREATED)

    def post(self, request):
        if request.tenant is None:
            return Response({'detail': 'Marina not found.'}, status=status.HTTP_404_NOT_FOUND)

        marina = request.tenant
        if marina.booking_mode != 'auto_tetris':
            return self._handle_manual(request, marina)

        ser = ReservationIntentSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        d = ser.validated_data
        check_in  = d['check_in']
        check_out = d['check_out']
        nights    = (check_out - check_in).days

        # Resolve categories upfront (outside the transaction) so FK lookups
        # don't hold locks longer than necessary.
        categories = {}
        for item in d['items']:
            cat_id = item.get('berth_category_id')
            if cat_id and cat_id not in categories:
                try:
                    categories[cat_id] = BerthCategory.objects.select_related(
                        'pricing_tier'
                    ).get(pk=cat_id, marina=marina, is_active=True)
                except BerthCategory.DoesNotExist:
                    return Response(
                        {'detail': f'Berth category {cat_id} not found.'},
                        status=status.HTTP_400_BAD_REQUEST,
                    )

        failed_vessel = None
        try:
            with transaction.atomic():
                reservation = Reservation.objects.create(
                    marina=marina,
                    guest_name=d['guest_name'],
                    guest_email=d['guest_email'],
                    guest_phone=d.get('guest_phone', ''),
                    status='pending_checkout',
                    locked_until=timezone.now() + datetime.timedelta(minutes=15),
                    booking_source='portal',
                )

                item_records = []
                for item in d['items']:
                    cat_id = item.get('berth_category_id')
                    cat = categories.get(cat_id) if cat_id else None
                    vessel_name = item.get('vessel_name', '')

                    try:
                        berth, price = assign_berth(
                            marina=marina,
                            check_in=check_in,
                            check_out=check_out,
                            boat_loa=item['boat_loa'],
                            boat_beam=item.get('boat_beam'),
                            boat_draft=item.get('boat_draft'),
                            berth_category=cat,
                        )
                    except NoAvailableBerthError:
                        failed_vessel = vessel_name or f"vessel with LOA {item['boat_loa']}m"
                        raise  # triggers atomic rollback

                    item_records.append(ReservationItem(
                        reservation=reservation,
                        berth=berth,
                        check_in=check_in,
                        check_out=check_out,
                        nights=nights,
                        item_price=price,
                        boat_loa=item['boat_loa'],
                        boat_beam=item.get('boat_beam'),
                        boat_draft=item.get('boat_draft'),
                        vessel_name=vessel_name,
                        status='locked',
                    ))

                ReservationItem.objects.bulk_create(item_records)

                total = sum(r.item_price for r in item_records)
                reservation.total_price = total
                reservation.save(update_fields=['total_price'])

                # Create the Stripe PaymentIntent AFTER locking inventory.
                amount_cents = int(round(float(total) * 100))
                client_secret = billing_service.create_payment_intent(
                    marina=marina,
                    amount_cents=amount_cents,
                    currency=marina.currency.lower() if marina.currency else 'eur',
                    metadata={'reservation_id': str(reservation.pk)},
                )
                # client_secret format: "pi_xxx_secret_yyy" — extract the intent ID.
                pi_id = client_secret.rsplit('_secret_', 1)[0]
                reservation.stripe_payment_intent_id = pi_id
                reservation.save(update_fields=['stripe_payment_intent_id'])

        except NoAvailableBerthError:
            detail = (
                f'No available berth for {failed_vessel} on those dates.'
                if failed_vessel
                else 'No available berth for the requested dates.'
            )
            return Response({'detail': detail}, status=status.HTTP_409_CONFLICT)
        except Exception:
            logger.exception('ReservationIntentView: unexpected error')
            return Response(
                {'detail': 'Payment provider error. Please try again.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        items_data = [
            {
                'berth_code': item.berth.code if item.berth_id else None,
                'nights': item.nights,
                'item_price': str(item.item_price),
            }
            for item in item_records
        ]

        return Response(
            {
                'reservation_id': reservation.pk,
                'reference': f'RES-{reservation.pk}',
                'requires_payment': True,
                'client_secret': client_secret,
                'total': str(reservation.total_price),
                'locked_until': reservation.locked_until.isoformat(),
                'items': items_data,
            },
            status=status.HTTP_201_CREATED,
        )


class ReservationConfirmSerializer(serializers.Serializer):
    reservation_id    = serializers.IntegerField()
    payment_intent_id = serializers.CharField(max_length=200)


class ReservationConfirmView(APIView):
    """
    POST /api/v1/public/reservations/confirm/

    Verifies Stripe payment and flips reservation to confirmed.
    Uses atomic DB update as the email gate — only the process that wins
    the UPDATE sends the confirmation email, preventing duplicate emails
    when the client and Stripe webhook fire simultaneously.
    """
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        if request.tenant is None:
            return Response({'detail': 'Marina not found.'}, status=status.HTTP_404_NOT_FOUND)

        marina = request.tenant
        ser = ReservationConfirmSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        d = ser.validated_data
        try:
            reservation = Reservation.objects.select_related('marina').get(
                pk=d['reservation_id'],
                stripe_payment_intent_id=d['payment_intent_id'],
                marina=marina,
            )
        except Reservation.DoesNotExist:
            return Response({'detail': 'Reservation not found.'}, status=status.HTTP_404_NOT_FOUND)

        if reservation.status == 'abandoned':
            return Response(
                {'detail': 'This reservation has expired. Please start a new booking.'},
                status=status.HTTP_409_CONFLICT,
            )

        # Verify payment with Stripe on the marina's Connect account.
        try:
            pi = stripe.PaymentIntent.retrieve(
                d['payment_intent_id'],
                stripe_account=marina.stripe_account_id or None,
                api_key=settings.STRIPE_SECRET_KEY,
            )
        except Exception:
            logger.exception('ReservationConfirmView: Stripe retrieve failed')
            return Response({'detail': 'Could not verify payment.'}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        if pi.status != 'succeeded':
            return Response(
                {'detail': 'Payment not yet confirmed.'},
                status=status.HTTP_402_PAYMENT_REQUIRED,
            )

        # Atomic gate: only the process that successfully flips pending_checkout → confirmed
        # sends the email. If the webhook already confirmed, updated_count == 0 (no-op).
        updated_count = Reservation.objects.filter(
            pk=reservation.pk, status='pending_checkout'
        ).update(status='confirmed', paid=True)

        if updated_count > 0:
            ReservationItem.objects.filter(
                reservation=reservation, status='locked'
            ).update(status='confirmed')
            reservation.refresh_from_db()
            try:
                send_reservation_confirmed_email(reservation)
            except Exception:
                logger.exception('ReservationConfirmView: failed to send confirmation email')

        reservation.refresh_from_db()
        first_item = reservation.items.first()
        return Response({
            'reservation_id': reservation.pk,
            'status': reservation.status,
            'reference': f'RES-{reservation.pk}',
            'guest_name': reservation.guest_name,
            'check_in': str(first_item.check_in) if first_item else None,
            'check_out': str(first_item.check_out) if first_item else None,
        })
