from rest_framework import serializers
from .models import Pier, Berth, MarinaMapConfig, Amenity, MapPrefab, PIER_TYPE_CHOICES


class PierSerializer(serializers.ModelSerializer):
    berth_count = serializers.SerializerMethodField()
    pier_type = serializers.ChoiceField(choices=[c[0] for c in PIER_TYPE_CHOICES], default='concrete')

    class Meta:
        model = Pier
        fields = [
            'id', 'code', 'label',
            'polygon_points',
            'pier_type',
            'ghost_slots',
            'berth_count',
        ]
        read_only_fields = ['id', 'berth_count']

    def get_berth_count(self, obj):
        return obj.berths.count()

    def validate_ghost_slots(self, value):
        required_keys = {'x', 'y', 'rotation', 'width_m', 'height_m'}
        for i, slot in enumerate(value):
            if not isinstance(slot, dict):
                raise serializers.ValidationError(f'Slot {i} must be an object.')
            missing = required_keys - slot.keys()
            if missing:
                raise serializers.ValidationError(f'Slot {i} missing keys: {missing}.')
            for key in required_keys:
                if not isinstance(slot[key], (int, float)):
                    raise serializers.ValidationError(f'Slot {i}.{key} must be numeric.')
        return value


class AmenitySerializer(serializers.ModelSerializer):
    class Meta:
        model = Amenity
        fields = ['id', 'label', 'type', 'canvas_x', 'canvas_y', 'scale', 'rotation']
        read_only_fields = ['id']


class BerthSerializer(serializers.ModelSerializer):
    pier_code = serializers.CharField(source='pier.code', read_only=True)
    pier_label = serializers.CharField(source='pier.label', read_only=True, default='')
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, default=None)
    unmapped = serializers.SerializerMethodField()

    class Meta:
        model = Berth
        fields = [
            'id', 'code', 'pier', 'pier_code', 'pier_label',
            'side', 'position_index',
            'length_m', 'max_draft_m', 'max_beam_m', 'amenities', 'price_per_night',
            'status', 'vessel', 'vessel_name',
            'canvas_x', 'canvas_y', 'canvas_rotation',
            'unmapped',
        ]
        read_only_fields = ['id', 'pier_code', 'pier_label', 'vessel_name', 'unmapped']

    def get_unmapped(self, obj):
        return obj.canvas_x is None or obj.canvas_y is None


class BulkGenerateSerializer(serializers.Serializer):
    prefix = serializers.CharField(max_length=5)
    start = serializers.IntegerField(min_value=1)
    end = serializers.IntegerField(min_value=1)
    length_m = serializers.DecimalField(max_digits=6, decimal_places=1, required=False, allow_null=True)
    max_beam_m = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    max_draft_m = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    price_per_night = serializers.DecimalField(max_digits=8, decimal_places=2, required=False, allow_null=True)
    amenities = serializers.ListField(child=serializers.CharField(), required=False, default=list)

    def validate(self, data):
        if data['end'] < data['start']:
            raise serializers.ValidationError('end must be >= start')
        if (data['end'] - data['start'] + 1) > 200:
            raise serializers.ValidationError('Cannot generate more than 200 berths at once')
        return data


class MarinaMapConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = MarinaMapConfig
        fields = ['config', 'updated_at']
        read_only_fields = ['updated_at']


class MapPrefabSerializer(serializers.ModelSerializer):
    class Meta:
        model = MapPrefab
        fields = [
            'id', 'name', 'pier_type',
            'polygon_points', 'berth_slots',
            'label_template', 'is_base', 'created_at',
        ]
        read_only_fields = ['id', 'is_base', 'created_at']

    def validate_polygon_points(self, value):
        if not isinstance(value, list) or len(value) < 3:
            raise serializers.ValidationError('polygon_points must be a list of at least 3 points.')
        for point in value:
            if not (isinstance(point, list) and len(point) == 2 and
                    all(isinstance(c, (int, float)) for c in point)):
                raise serializers.ValidationError('Each point must be [x, y] with numeric values.')
        return value

    def validate_berth_slots(self, value):
        if not isinstance(value, list):
            raise serializers.ValidationError('berth_slots must be a list.')
        required_keys = {'x', 'y', 'rotation', 'width_m', 'height_m'}
        for slot in value:
            if not isinstance(slot, dict):
                raise serializers.ValidationError('Each slot must be an object.')
            missing = required_keys - slot.keys()
            if missing:
                raise serializers.ValidationError(f'Slot missing keys: {missing}')
            for k in required_keys:
                if not isinstance(slot[k], (int, float)):
                    raise serializers.ValidationError(f'Slot key {k!r} must be numeric.')
        return value
