from rest_framework import serializers
from .models import VesselMovement


class VesselMovementSerializer(serializers.ModelSerializer):
    vessel_name          = serializers.CharField(source='vessel.name', read_only=True)
    berth_from_code      = serializers.CharField(source='berth_from.code', read_only=True, default=None)
    berth_to_code        = serializers.CharField(source='berth_to.code', read_only=True, default=None)
    movement_type_display = serializers.CharField(source='get_movement_type_display', read_only=True)
    recorded_by_name     = serializers.SerializerMethodField()

    class Meta:
        model = VesselMovement
        fields = [
            'id', 'marina', 'vessel', 'vessel_name',
            'movement_type', 'movement_type_display',
            'berth_from', 'berth_from_code',
            'berth_to', 'berth_to_code',
            'booking', 'departure',
            'scheduled_at', 'actual_at', 'completed',
            'heading', 'notes',
            'recorded_by', 'recorded_by_name',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'marina']

    def get_recorded_by_name(self, obj):
        if obj.recorded_by:
            return f'{obj.recorded_by.first_name} {obj.recorded_by.last_name}'.strip() or obj.recorded_by.email
        return None
