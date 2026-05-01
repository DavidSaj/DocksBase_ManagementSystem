from rest_framework import serializers
from .models import Pier, Berth, MarinaMapConfig, Amenity
from apps.billing.models import ChargeableItem


class PierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Pier
        fields = [
            'id', 'code', 'label', 'polygon_points', 'pier_type', 'ghost_slots',
            'canvas_x', 'canvas_y', 'canvas_w', 'canvas_h', 'rotation',
        ]


_ACTIVE_BOOKING_STATUSES = frozenset([
    'confirmed', 'pending', 'awaiting_payment', 'pending_payment',
    'checked_in', 'overstay',
])
_OCCUPIED_STATUSES = frozenset(['checked_in', 'overstay'])


class BerthSerializer(serializers.ModelSerializer):
    pier_code                = serializers.CharField(source='pier.code',              read_only=True, default=None)
    vessel_name              = serializers.CharField(source='vessel.name',            read_only=True, default=None)
    pricing_tier_name        = serializers.CharField(source='pricing_tier.name',      read_only=True, default=None)
    pricing_tier_unit_price  = serializers.DecimalField(
        source='pricing_tier.unit_price',
        max_digits=10,
        decimal_places=2,
        read_only=True,
        allow_null=True,
    )
    is_placed          = serializers.SerializerMethodField()
    effective_status   = serializers.SerializerMethodField()
    pricing_tier = serializers.PrimaryKeyRelatedField(
        queryset=ChargeableItem.objects.filter(category='berth'),
        allow_null=True,
        required=False,
    )

    class Meta:
        model = Berth
        fields = [
            'id', 'code', 'berth_type', 'berth_class', 'operational_type',
            'pier', 'pier_code', 'side', 'position_index',
            'length_m', 'max_draft_m', 'max_beam_m', 'amenities',
            'pricing_tier', 'pricing_tier_name', 'pricing_tier_unit_price',
            'status', 'effective_status', 'vessel', 'vessel_name',
            'local_x', 'local_y', 'position_on_parent', 'is_placed',
        ]
        read_only_fields = ['id', 'pier_code', 'vessel_name', 'is_placed', 'effective_status']

    def get_is_placed(self, obj):
        return obj.pier_id is not None and obj.local_x is not None and obj.local_y is not None

    def get_effective_status(self, obj):
        if obj.status == 'maintenance':
            return 'maintenance'
        # obj.bookings.all() uses the prefetch_related cache — no extra query
        active = [b for b in obj.bookings.all() if b.status in _ACTIVE_BOOKING_STATUSES]
        if not active:
            return obj.status
        if any(b.status in _OCCUPIED_STATUSES for b in active):
            return 'occupied'
        return 'reserved'

    def validate_pricing_tier(self, value):
        if value and value.category != 'berth':
            raise serializers.ValidationError("pricing_tier must be a Berth Rate item.")
        return value


class AmenitySerializer(serializers.ModelSerializer):
    class Meta:
        model = Amenity
        fields = ['id', 'type', 'label', 'canvas_x', 'canvas_y', 'scale', 'rotation']
        read_only_fields = ['id']


class MarinaMapConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = MarinaMapConfig
        fields = ['config', 'updated_at']
        read_only_fields = ['updated_at']
