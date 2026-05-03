from rest_framework import serializers
from .models import Pier, Berth, MarinaMapConfig
from apps.billing.models import ChargeableItem


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
    pricing_tier = serializers.PrimaryKeyRelatedField(
        queryset=ChargeableItem.objects.filter(category='berth'),
        allow_null=True,
        required=False,
    )

    class Meta:
        model = Berth
        fields = [
            'id', 'code', 'pier', 'pier_code', 'side', 'position_index',
            'length_m', 'max_draft_m', 'max_beam_m', 'amenities',
            'pricing_tier', 'status', 'vessel', 'vessel_name',
            'local_x', 'local_y', 'position_on_parent', 'is_placed',
        ]
        read_only_fields = ['id', 'pier_code', 'vessel_name', 'is_placed']

    def get_is_placed(self, obj):
        return obj.pier_id is not None and obj.local_x is not None and obj.local_y is not None

    def validate_pricing_tier(self, value):
        if value and value.category != 'berth':
            raise serializers.ValidationError("pricing_tier must be a Berth Rate item.")
        return value


class MarinaMapConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = MarinaMapConfig
        fields = ['config', 'updated_at']
        read_only_fields = ['updated_at']
