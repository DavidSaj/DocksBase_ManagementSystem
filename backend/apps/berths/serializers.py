from rest_framework import serializers
from .models import Pier, Berth, MarinaMapConfig


class PierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Pier
        fields = ['id', 'code', 'label', 'cx']


class BerthSerializer(serializers.ModelSerializer):
    pier_code = serializers.CharField(source='pier.code', read_only=True)
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, default=None)

    class Meta:
        model = Berth
        fields = [
            'id', 'code', 'pier', 'pier_code', 'side', 'position_index',
            'length_m', 'max_draft_m', 'max_beam_m', 'amenities',
            'price_per_night', 'status', 'vessel', 'vessel_name',
        ]
        read_only_fields = ['id', 'pier_code', 'vessel_name']


class MarinaMapConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = MarinaMapConfig
        fields = ['config', 'updated_at']
        read_only_fields = ['updated_at']
