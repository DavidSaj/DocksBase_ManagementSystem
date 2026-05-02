from rest_framework import serializers
from .models import Pier, Berth, MarinaMapConfig


class PierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Pier
        fields = [
            'id', 'code', 'label', 'polygon_points', 'pier_type', 'ghost_slots',
            'canvas_x', 'canvas_y', 'canvas_w', 'canvas_h', 'rotation',
        ]


class BerthSerializer(serializers.ModelSerializer):
    pier_code   = serializers.CharField(source='pier.code', read_only=True, default=None)
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, default=None)
    is_placed   = serializers.SerializerMethodField()

    class Meta:
        model = Berth
        fields = [
            'id', 'code', 'pier', 'pier_code', 'side', 'position_index',
            'length_m', 'max_draft_m', 'max_beam_m', 'amenities',
            'price_per_night', 'status', 'vessel', 'vessel_name',
            'local_x', 'local_y', 'position_on_parent', 'is_placed',
        ]
        read_only_fields = ['id', 'pier_code', 'vessel_name', 'is_placed']

    def get_is_placed(self, obj):
        return obj.pier_id is not None and obj.local_x is not None and obj.local_y is not None


class MarinaMapConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = MarinaMapConfig
        fields = ['config', 'updated_at']
        read_only_fields = ['updated_at']
