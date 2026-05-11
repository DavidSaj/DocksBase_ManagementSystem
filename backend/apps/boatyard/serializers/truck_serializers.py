"""
apps/boatyard/serializers/truck_serializers.py
Track 5 — Location, ServiceTruck, InventoryLevel, InventoryAnomaly,
           TruckStockTransfer serializers.
"""

from rest_framework import serializers

from ..models import (
    Location, ServiceTruck, InventoryLevel,
    InventoryAnomaly, TruckStockTransfer,
)


class LocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Location
        fields = ['id', 'location_type', 'name']


class ServiceTruckSerializer(serializers.ModelSerializer):
    location_name = serializers.CharField(source='location.name', read_only=True)

    class Meta:
        model = ServiceTruck
        fields = [
            'id', 'location', 'location_name',
            'registration', 'assigned_to', 'is_active',
        ]


class InventoryLevelSerializer(serializers.ModelSerializer):
    part_name     = serializers.CharField(source='part.name',     read_only=True)
    location_name = serializers.CharField(source='location.name', read_only=True)
    below_par     = serializers.SerializerMethodField()

    def get_below_par(self, obj):
        if obj.par is not None:
            return obj.quantity < obj.par
        return False

    class Meta:
        model = InventoryLevel
        fields = [
            'id', 'part', 'part_name', 'location', 'location_name',
            'quantity', 'par', 'below_par',
        ]


class InventoryAnomalySerializer(serializers.ModelSerializer):
    class Meta:
        model = InventoryAnomaly
        fields = [
            'id', 'inventory_level', 'transfer',
            'quantity_after', 'status', 'resolved_by', 'resolved_at',
            'created_at',
        ]
        read_only_fields = ['created_at']


class TruckStockTransferSerializer(serializers.ModelSerializer):
    class Meta:
        model = TruckStockTransfer
        fields = [
            'id', 'truck', 'part', 'direction',
            'quantity', 'transferred_by', 'transferred_at', 'notes',
        ]
        read_only_fields = ['transferred_at']
