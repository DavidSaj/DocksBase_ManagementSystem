from rest_framework import serializers
from apps.billing.models import ChargeableItem
from .models import FuelDockEntry, FuelPriceChange


class FuelProductSerializer(serializers.ModelSerializer):
    fuel_dock_type_label = serializers.CharField(source='get_fuel_dock_type_display', read_only=True)

    class Meta:
        model  = ChargeableItem
        fields = ['id', 'name', 'unit_price', 'pricing_model', 'fuel_dock_type', 'fuel_dock_type_label']
        read_only_fields = fields


class FuelPriceChangeSerializer(serializers.ModelSerializer):
    item_name        = serializers.CharField(source='item.name',         read_only=True)
    fuel_dock_type   = serializers.CharField(source='item.fuel_dock_type', read_only=True)
    changed_by_name  = serializers.CharField(source='changed_by.name',   read_only=True, default=None)

    class Meta:
        model  = FuelPriceChange
        fields = ['id', 'item', 'item_name', 'fuel_dock_type',
                  'old_price', 'new_price', 'changed_by', 'changed_by_name',
                  'note', 'changed_at']
        read_only_fields = fields


class FuelDockEntrySerializer(serializers.ModelSerializer):
    vessel_name     = serializers.CharField(source='vessel.name',      read_only=True, default=None)
    member_name     = serializers.CharField(source='member.name',      read_only=True, default=None)
    member_phone    = serializers.CharField(source='member.phone',     read_only=True, default=None)
    fuel_berth_code = serializers.CharField(source='fuel_berth.code',  read_only=True, default=None)

    class Meta:
        model = FuelDockEntry
        fields = [
            'id', 'vessel', 'vessel_name', 'member', 'member_name', 'member_phone',
            'guest_description', 'guest_phone',
            'fuel_type', 'estimated_litres', 'actual_litres', 'price_per_litre', 'total_amount',
            'status', 'fuel_berth', 'fuel_berth_code',
            'arrived_at', 'service_start', 'completed_at',
            'invoice', 'pos_paid',
        ]
        read_only_fields = [
            'id', 'vessel_name', 'member_name', 'member_phone', 'fuel_berth_code',
            'arrived_at', 'service_start', 'completed_at',
            'invoice', 'pos_paid',
        ]
