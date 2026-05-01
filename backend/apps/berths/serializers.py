from rest_framework import serializers
from .models import Pier, Berth, MarinaMapConfig, Amenity


class PierSerializer(serializers.ModelSerializer):
    berth_count = serializers.SerializerMethodField()

    class Meta:
        model = Pier
        fields = [
            'id', 'code', 'label',
            'polygon_points',
            'berth_count',
        ]
        read_only_fields = ['id', 'berth_count']

    def get_berth_count(self, obj):
        return obj.berths.count()


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
            'canvas_x', 'canvas_y', 'canvas_width', 'canvas_height', 'canvas_rotation',
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
