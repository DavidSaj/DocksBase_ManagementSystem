from rest_framework import serializers
from .models import HaulOut, WorkOrder, Part, Tool, StorageSlot, LaunchRequest, Contractor


class HaulOutSerializer(serializers.ModelSerializer):
    vessel_name = serializers.CharField(source='vessel.name', read_only=True)

    class Meta:
        model = HaulOut
        fields = [
            'id', 'vessel', 'vessel_name', 'haul_type', 'scheduled_at',
            'equipment', 'crew', 'status', 'assigned_to', 'notes',
        ]


class StorageSlotSerializer(serializers.ModelSerializer):
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, default='')

    class Meta:
        model = StorageSlot
        fields = ['id', 'lane', 'col', 'tier', 'vessel', 'vessel_name']


class LaunchRequestSerializer(serializers.ModelSerializer):
    vessel_name = serializers.CharField(source='vessel.name', read_only=True)
    slot_label = serializers.SerializerMethodField()

    def get_slot_label(self, obj):
        return str(obj.slot) if obj.slot else ''

    class Meta:
        model = LaunchRequest
        fields = [
            'id', 'vessel', 'vessel_name', 'slot', 'slot_label',
            'equipment', 'assigned_to', 'status', 'notes', 'created_at',
        ]
        read_only_fields = ['created_at']


class WorkOrderSerializer(serializers.ModelSerializer):
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, default='')

    class Meta:
        model = WorkOrder
        fields = [
            'id', 'vessel', 'vessel_name', 'title', 'category', 'description',
            'priority', 'status', 'assigned_to', 'estimate', 'actual',
            'created_at', 'due', 'notes',
        ]
        read_only_fields = ['created_at']


class PartSerializer(serializers.ModelSerializer):
    class Meta:
        model = Part
        fields = [
            'id', 'name', 'part_no', 'category', 'supplier',
            'unit_cost', 'sell_price', 'stock', 'par', 'location',
        ]


class ToolSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tool
        fields = [
            'id', 'name', 'category', 'serial', 'location',
            'status', 'checked_out_to', 'work_order', 'calibration_due',
        ]


class ContractorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contractor
        fields = [
            'id', 'name', 'trade', 'working_on',
            'access_start', 'access_end', 'vessel_owner',
        ]
