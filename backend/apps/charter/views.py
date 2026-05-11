from datetime import timedelta

from django.db import transaction
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.charter.models import (
    CharterAgentCommission,
    CharterAgreement,
    CharterBooking,
    CharterManagementAgreement,
    CharterVessel,
    RentalBooking,
    RentalUnit,
)
from apps.charter.serializers import (
    CharterAgentCommissionSerializer,
    CharterAgreementSerializer,
    CharterBookingSerializer,
    CharterManagementAgreementSerializer,
    CharterVesselSerializer,
    RentalBookingSerializer,
    RentalUnitSerializer,
)
from apps.charter.services import check_rental_availability


# ─── Charter Vessels ──────────────────────────────────────────────────────────

class CharterVesselListCreateView(generics.ListCreateAPIView):
    serializer_class = CharterVesselSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return CharterVessel.objects.filter(
            marina=self.request.user.marina
        ).select_related('vessel')

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class CharterVesselDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = CharterVesselSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return CharterVessel.objects.filter(marina=self.request.user.marina)


# ─── Management Agreements ────────────────────────────────────────────────────

class CharterManagementAgreementListCreateView(generics.ListCreateAPIView):
    serializer_class = CharterManagementAgreementSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = CharterManagementAgreement.objects.filter(
            marina=self.request.user.marina
        ).select_related('charter_vessel__vessel', 'member')
        vessel_id = self.request.query_params.get('charter_vessel')
        if vessel_id:
            qs = qs.filter(charter_vessel_id=vessel_id)
        return qs

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class CharterManagementAgreementDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = CharterManagementAgreementSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return CharterManagementAgreement.objects.filter(marina=self.request.user.marina)


# ─── Charter Bookings ─────────────────────────────────────────────────────────

class CharterBookingListCreateView(generics.ListCreateAPIView):
    serializer_class = CharterBookingSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = CharterBooking.objects.filter(
            marina=self.request.user.marina
        ).select_related('charter_vessel__vessel', 'charterer', 'skipper')

        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)

        vessel_id = self.request.query_params.get('charter_vessel')
        if vessel_id:
            qs = qs.filter(charter_vessel_id=vessel_id)

        return qs

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class CharterBookingDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = CharterBookingSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return CharterBooking.objects.filter(marina=self.request.user.marina)


class CharterBookingSendAgreementView(APIView):
    """POST /charter/bookings/<pk>/send-agreement/ — create a CharterAgreement and send via Dropbox Sign."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            booking = CharterBooking.objects.get(pk=pk, marina=request.user.marina)
        except CharterBooking.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        if hasattr(booking, 'agreement'):
            return Response(
                {'detail': 'Agreement already exists for this booking.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        agreement = CharterAgreement.objects.create(
            marina=booking.marina,
            booking=booking,
        )

        # Dropbox Sign envelope creation (delegates to existing documents app)
        try:
            from apps.documents.models import DocTemplate, Envelope
            template = DocTemplate.objects.filter(
                marina=booking.marina,
                category='charter_agreement',
            ).first()
            if template:
                envelope = Envelope.objects.create(
                    marina=booking.marina,
                    template=template,
                    recipient=booking.charterer,
                    vessel=booking.charter_vessel.vessel,
                )
                agreement.envelope = envelope
                agreement.save(update_fields=['envelope'])
        except Exception:
            pass  # Non-fatal — agreement record still created

        serializer = CharterAgreementSerializer(agreement)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class CharterBookingReleaseDepositView(APIView):
    """POST /charter/bookings/<pk>/release-deposit/ — release or withhold security deposit."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            booking = CharterBooking.objects.get(pk=pk, marina=request.user.marina)
        except CharterBooking.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        action = request.data.get('action')
        amount = request.data.get('amount')

        if action not in ('release', 'withhold'):
            return Response(
                {'detail': "action must be 'release' or 'withhold'."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if booking.deposit_status not in (
            CharterBooking.DepositStatus.HELD,
        ):
            return Response(
                {'detail': 'Deposit is not in a held state.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if action == 'release':
            new_status = CharterBooking.DepositStatus.RELEASED
        else:
            new_status = CharterBooking.DepositStatus.WITHHELD

        booking.deposit_status = new_status
        booking.save(update_fields=['deposit_status'])

        return Response({'deposit_status': booking.deposit_status})


# ─── Agent Commissions ────────────────────────────────────────────────────────

class CharterAgentCommissionListView(generics.ListAPIView):
    serializer_class = CharterAgentCommissionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = CharterAgentCommission.objects.filter(
            marina=self.request.user.marina
        ).select_related('booking__charter_vessel__vessel')

        payment_status = self.request.query_params.get('payment_status')
        if payment_status:
            qs = qs.filter(payment_status=payment_status)
        return qs


class CharterAgentCommissionDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = CharterAgentCommissionSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return CharterAgentCommission.objects.filter(marina=self.request.user.marina)


# ─── Rental Units ─────────────────────────────────────────────────────────────

class RentalUnitListCreateView(generics.ListCreateAPIView):
    serializer_class = RentalUnitSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = RentalUnit.objects.filter(marina=self.request.user.marina)
        if self.request.query_params.get('active_only') == 'true':
            qs = qs.filter(is_active=True)
        return qs

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class RentalUnitDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = RentalUnitSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return RentalUnit.objects.filter(marina=self.request.user.marina)


# ─── Rental Bookings ──────────────────────────────────────────────────────────

class RentalBookingListCreateView(generics.ListCreateAPIView):
    serializer_class = RentalBookingSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = RentalBooking.objects.filter(
            marina=self.request.user.marina
        ).select_related('rental_unit', 'member')

        status_filter = self.request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)

        unit_id = self.request.query_params.get('rental_unit')
        if unit_id:
            qs = qs.filter(rental_unit_id=unit_id)

        return qs

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class RentalBookingDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = RentalBookingSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return RentalBooking.objects.filter(marina=self.request.user.marina)


class RentalBookingAvailabilityView(APIView):
    """GET /charter/rental-bookings/availability/?unit=<id>&date=<YYYY-MM-DD>"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from datetime import datetime, date as date_type
        import pytz

        unit_id = request.query_params.get('unit')
        date_str = request.query_params.get('date')

        if not unit_id or not date_str:
            return Response(
                {'detail': 'unit and date query params are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            unit = RentalUnit.objects.get(pk=unit_id, marina=request.user.marina)
        except RentalUnit.DoesNotExist:
            return Response({'detail': 'Rental unit not found.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            query_date = date_type.fromisoformat(date_str)
        except ValueError:
            return Response({'detail': 'Invalid date format. Use YYYY-MM-DD.'}, status=status.HTTP_400_BAD_REQUEST)

        day_start = datetime.combine(query_date, datetime.min.time(), tzinfo=pytz.UTC)
        day_end = day_start + timedelta(days=1)
        buffer = timedelta(minutes=unit.turnaround_minutes)

        with transaction.atomic():
            bookings = RentalBooking.objects.select_for_update().filter(
                rental_unit=unit,
                start_dt__lt=day_end,
                end_dt__gt=day_start,
            ).exclude(status='cancelled').order_by('start_dt')

            slots = []
            for b in bookings:
                slots.append({
                    'booking_id': b.pk,
                    'status': b.status,
                    'start_dt': b.start_dt.isoformat(),
                    'end_dt': b.end_dt.isoformat(),
                    'buffer_before': (b.start_dt - buffer).isoformat(),
                    'buffer_after': (b.end_dt + buffer).isoformat(),
                    'customer_name': b.customer_name,
                })

        # Rate preview
        rate_preview = {}
        if unit.hourly_rate_item:
            rate_preview['hourly'] = str(unit.hourly_rate_item.unit_price)
        if unit.halfday_rate_item:
            rate_preview['halfday'] = str(unit.halfday_rate_item.unit_price)
        if unit.fullday_rate_item:
            rate_preview['fullday'] = str(unit.fullday_rate_item.unit_price)

        return Response({
            'unit_id': unit.pk,
            'unit_name': unit.name,
            'date': date_str,
            'turnaround_minutes': unit.turnaround_minutes,
            'occupied_slots': slots,
            'rate_preview': rate_preview,
        })


# ─── OTA Webhook Views ────────────────────────────────────────────────────────

class ZizooWebhookView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        from apps.charter.ota.zizoo import ZizooAdapter
        adapter = ZizooAdapter()

        if not adapter.verify_signature(request):
            return Response({'detail': 'Invalid signature.'}, status=status.HTTP_401_UNAUTHORIZED)

        try:
            booking_data = adapter.parse_booking(request.data)
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return _process_ota_booking(booking_data, adapter, request)


class ClickAndBoatWebhookView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        from apps.charter.ota.click_and_boat import ClickAndBoatAdapter
        adapter = ClickAndBoatAdapter()

        if not adapter.verify_signature(request):
            return Response({'detail': 'Invalid signature.'}, status=status.HTTP_401_UNAUTHORIZED)

        try:
            booking_data = adapter.parse_booking(request.data)
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return _process_ota_booking(booking_data, adapter, request)


class DropboxSignWebhookView(APIView):
    """Handle Dropbox Sign signature_request_signed events."""
    permission_classes = [AllowAny]

    def post(self, request):
        event_type = (
            request.data.get('event', {}).get('event_type')
            or request.data.get('event_type', '')
        )

        if event_type != 'signature_request_signed':
            return Response({'status': 'ignored'})

        dropboxsign_request_id = (
            request.data.get('signature_request', {}).get('signature_request_id', '')
        )

        try:
            agreement = CharterAgreement.objects.select_related('booking').get(
                envelope__dropboxsign_request_id=dropboxsign_request_id
            )
        except CharterAgreement.DoesNotExist:
            return Response({'detail': 'Agreement not found.'}, status=status.HTTP_404_NOT_FOUND)

        now = timezone.now()
        agreement.signed_at = now
        agreement.save(update_fields=['signed_at'])

        booking = agreement.booking
        if booking.status == CharterBooking.Status.ENQUIRY:
            booking.status = CharterBooking.Status.CONFIRMED
            booking.save(update_fields=['status'])

            from apps.charter.services import calculate_commission
            transaction.on_commit(lambda: calculate_commission(booking.pk))

        return Response({'status': 'ok'})


def _process_ota_booking(booking_data, adapter, request):
    """Shared logic for creating/updating/cancelling bookings from OTA webhooks."""
    from apps.charter.models import CharterVesselOTAMapping
    from apps.accounts.models import Marina

    # Find the marina — OTA webhooks must identify the marina somehow.
    # Fallback: look up via OTA vessel mapping.
    mapping = CharterVesselOTAMapping.objects.filter(
        channel=adapter.channel_name,
        ota_vessel_id=booking_data.ota_vessel_id,
    ).select_related('marina', 'charter_vessel').first()

    if not mapping:
        return Response(
            {'detail': f'No vessel mapping found for OTA vessel {booking_data.ota_vessel_id}.'},
            status=status.HTTP_404_NOT_FOUND,
        )

    marina = mapping.marina
    charter_vessel = mapping.charter_vessel

    if booking_data.is_cancellation:
        updated = CharterBooking.objects.filter(
            marina=marina,
            channel=adapter.channel_name,
            channel_ref=booking_data.ota_booking_ref,
        ).update(status=CharterBooking.Status.CANCELLED)
        return Response({'status': 'cancelled', 'updated': updated})

    booking, created = CharterBooking.objects.update_or_create(
        marina=marina,
        channel=adapter.channel_name,
        channel_ref=booking_data.ota_booking_ref,
        defaults={
            'charter_vessel': charter_vessel,
            'charterer_name': booking_data.charterer_name,
            'charterer_email': booking_data.charterer_email,
            'charterer_phone': booking_data.charterer_phone,
            'start_dt': booking_data.start_dt,
            'end_dt': booking_data.end_dt,
            'channel_commission': booking_data.channel_commission,
            'status': CharterBooking.Status.CONFIRMED,
        },
    )

    return Response(
        {'status': 'created' if created else 'updated', 'booking_id': booking.pk},
        status=status.HTTP_200_OK,
    )
