# backend/apps/reservations/serializers.py
from rest_framework import serializers
from .models import Booking, BookingRequest


class BookingSerializer(serializers.ModelSerializer):
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, default=None)
    berth_code  = serializers.CharField(source='berth.code',  read_only=True, default=None)
    owner_name  = serializers.CharField(source='vessel.owner.name', read_only=True, default=None)

    class Meta:
        model = Booking
        fields = [
            'id', 'berth', 'berth_code', 'vessel', 'vessel_name', 'owner_name',
            'booking_type', 'check_in', 'check_out', 'nights', 'amount',
            'status', 'paid', 'notes',
            'guest_name', 'guest_email', 'guest_phone',
            'boat_loa', 'boat_beam', 'stripe_session_id',
            'created_at',
        ]
        read_only_fields = [
            'id', 'vessel_name', 'berth_code', 'owner_name',
            'nights', 'amount', 'stripe_session_id', 'created_at',
        ]


class BookingEngineRequestSerializer(serializers.Serializer):
    check_in   = serializers.DateField()
    check_out  = serializers.DateField()
    boat_loa   = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, allow_null=True)
    boat_beam  = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    guest_name  = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')
    guest_email = serializers.EmailField(required=False, allow_blank=True, default='')
    guest_phone = serializers.CharField(max_length=50, required=False, allow_blank=True, default='')

    def validate(self, data):
        if data['check_out'] <= data['check_in']:
            raise serializers.ValidationError('check_out must be after check_in.')
        return data


class AssignBerthSerializer(serializers.Serializer):
    berth_id = serializers.IntegerField()


class BookingRequestSerializer(serializers.ModelSerializer):
    member_name = serializers.CharField(source='member.name', read_only=True, default=None)
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, default=None)
    berth_code  = serializers.CharField(source='berth.code',  read_only=True)
    booking_id  = serializers.PrimaryKeyRelatedField(source='booking', read_only=True)

    class Meta:
        model = BookingRequest
        fields = [
            'id', 'member', 'member_name', 'vessel', 'vessel_name',
            'guest_name', 'guest_phone', 'guest_email', 'guest_vessel', 'guest_loa',
            'berth', 'berth_code', 'booking_type', 'start_date', 'end_date', 'notes',
            'status', 'booking_id', 'created_at',
        ]
        read_only_fields = ['id', 'member_name', 'vessel_name', 'berth_code', 'booking_id', 'created_at']
