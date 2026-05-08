"""
apps/boatyard/serializers/operations_serializers.py
Track 5 — ServiceBay, LiftOperation, PaintRecord, PartsInventoryItem, Subcontractor.
"""

from rest_framework import serializers

from ..models import (
    LiftOperation,
    PaintRecord,
    PartsInventoryItem,
    ServiceBay,
    Subcontractor,
)


class ServiceBaySerializer(serializers.ModelSerializer):
    class Meta:
        model = ServiceBay
        fields = ['id', 'name', 'bay_type', 'capacity', 'is_active', 'notes']
        read_only_fields = ['id']


class LiftOperationSerializer(serializers.ModelSerializer):
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, allow_null=True)

    class Meta:
        model = LiftOperation
        fields = [
            'id', 'vessel', 'vessel_name', 'lift_type', 'status',
            'scheduled_at', 'completed_at', 'equipment', 'operator',
            'boat_weight_t', 'notes',
        ]
        read_only_fields = ['id']


class PaintRecordSerializer(serializers.ModelSerializer):
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, allow_null=True)

    class Meta:
        model = PaintRecord
        fields = [
            'id', 'vessel', 'vessel_name', 'paint_type', 'product_name',
            'colour', 'applied_date', 'applied_by', 'coats', 'area_sqm', 'notes',
        ]
        read_only_fields = ['id']


class PartsInventoryItemSerializer(serializers.ModelSerializer):
    is_low = serializers.SerializerMethodField()

    class Meta:
        model = PartsInventoryItem
        fields = [
            'id', 'name', 'sku', 'category', 'supplier', 'unit_cost',
            'quantity', 'reorder_point', 'location', 'is_active', 'is_low',
        ]
        read_only_fields = ['id']

    def get_is_low(self, obj):
        return obj.quantity <= obj.reorder_point


class SubcontractorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Subcontractor
        fields = [
            'id', 'company', 'contact_name', 'email', 'phone',
            'trade', 'hourly_rate', 'insurance_expiry', 'is_active', 'notes',
        ]
        read_only_fields = ['id']
