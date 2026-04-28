from rest_framework import serializers
from .models import FuelDockEntry


class FuelDockEntrySerializer(serializers.ModelSerializer):
    vessel_name  = serializers.CharField(source='vessel.name',  read_only=True, default=None)
    member_name  = serializers.CharField(source='member.name',  read_only=True, default=None)
    member_phone = serializers.CharField(source='member.phone', read_only=True, default=None)

    class Meta:
        model = FuelDockEntry
        fields = [
            'id', 'vessel', 'vessel_name', 'member', 'member_name', 'member_phone',
            'guest_description', 'guest_phone',
            'fuel_type', 'estimated_litres', 'actual_litres', 'price_per_litre', 'total_amount',
            'status', 'fuel_berth',
            'arrived_at', 'service_start', 'completed_at',
            'invoice', 'pos_paid',
        ]
        read_only_fields = [
            'id', 'vessel_name', 'member_name', 'member_phone',
            'total_amount', 'arrived_at', 'service_start', 'completed_at',
            'invoice', 'pos_paid',
        ]
