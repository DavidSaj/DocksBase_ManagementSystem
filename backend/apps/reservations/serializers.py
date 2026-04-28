from rest_framework import serializers
from .models import Booking, BookingRequest


class BookingSerializer(serializers.ModelSerializer):
    vessel_name = serializers.CharField(source='vessel.name', read_only=True)
    berth_code  = serializers.CharField(source='berth.code',  read_only=True)
    owner_name  = serializers.CharField(source='vessel.owner.name', read_only=True, default=None)

    class Meta:
        model = Booking
        fields = [
            'id', 'berth', 'berth_code', 'vessel', 'vessel_name', 'owner_name',
            'booking_type', 'check_in', 'check_out', 'nights', 'amount',
            'status', 'paid', 'notes', 'created_at',
        ]
        read_only_fields = ['id', 'vessel_name', 'berth_code', 'owner_name', 'nights', 'amount', 'created_at']


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
