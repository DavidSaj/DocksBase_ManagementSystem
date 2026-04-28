from rest_framework import serializers
from .models import Booking


class BookingSerializer(serializers.ModelSerializer):
    vessel_name = serializers.CharField(source='vessel.name', read_only=True)
    berth_code = serializers.CharField(source='berth.code', read_only=True)
    owner_name = serializers.CharField(source='vessel.owner.name', read_only=True, default=None)

    class Meta:
        model = Booking
        fields = [
            'id', 'berth', 'berth_code', 'vessel', 'vessel_name', 'owner_name',
            'booking_type', 'check_in', 'check_out', 'nights', 'amount',
            'status', 'paid', 'notes', 'created_at',
        ]
        read_only_fields = ['id', 'vessel_name', 'berth_code', 'owner_name', 'nights', 'amount', 'created_at']
