import datetime

from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status

from apps.reservations.models import Booking
from apps.reservations.emails import (
    send_booking_request_boater_email,
    send_booking_request_manager_email,
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
