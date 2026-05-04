import datetime
import hmac
import hashlib

from django.conf import settings
from django.core import signing
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.reservations.models import Booking
from .checkin_auth import PortalTokenAuthentication
from .checkin_serializers import PortalBookingSerializer
from .checkin_utils import (
    decode_magic_token, make_portal_token,
    evaluate_pre_cleared,
)


class MagicAuthView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        token = request.data.get('token')
        if not token:
            return Response({'detail': 'token required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            payload = decode_magic_token(token)
        except signing.BadSignature:
            return Response({'detail': 'Invalid or expired link.'}, status=status.HTTP_401_UNAUTHORIZED)

        try:
            booking = Booking.objects.select_related('marina').get(
                pk=payload['booking_id'],
                guest_email=payload['boater_email'],
            )
        except Booking.DoesNotExist:
            return Response({'detail': 'Booking not found.'}, status=status.HTTP_401_UNAUTHORIZED)

        session_token = make_portal_token(
            booking_id=booking.id,
            marina_slug=booking.marina.slug,
            boater_email=booking.guest_email,
        )
        return Response({
            'token': session_token,
            'booking_id': booking.id,
            'marina_slug': booking.marina.slug,
        })


class PortalBookingMixin:
    authentication_classes = [PortalTokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get_booking(self, request, pk):
        if request.user.booking_id != pk:
            return None, Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)
        try:
            return Booking.objects.select_related('marina', 'berth', 'berth__pier').get(pk=pk), None
        except Booking.DoesNotExist:
            return None, Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)


class PortalBookingView(PortalBookingMixin, APIView):
    def get(self, request, pk):
        booking, err = self.get_booking(request, pk)
        if err:
            return err
        return Response(PortalBookingSerializer(booking).data)


class PatchDimensionsView(PortalBookingMixin, APIView):
    def patch(self, request, pk):
        booking, err = self.get_booking(request, pk)
        if err:
            return err

        allowed = {'boat_loa', 'boat_beam', 'boat_draft'}
        fields_to_save = list(allowed & set(request.data.keys()))
        for field in fields_to_save:
            setattr(booking, field, request.data[field])
        if fields_to_save:
            booking.save(update_fields=fields_to_save)

        evaluate_pre_cleared(booking)
        booking.refresh_from_db()
        return Response(PortalBookingSerializer(booking).data)


class SelfCheckinView(PortalBookingMixin, APIView):
    def post(self, request, pk):
        booking, err = self.get_booking(request, pk)
        if err:
            return err

        if not booking.pre_cleared:
            return Response(
                {'detail': 'Pre-clearance not complete.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not booking.self_checked_in:
            booking.self_checked_in = True
            booking.self_checked_in_at = timezone.now()
            booking.status = 'checked_in'
            booking.save(update_fields=['self_checked_in', 'self_checked_in_at', 'status'])

        return Response(PortalBookingSerializer(booking).data)
