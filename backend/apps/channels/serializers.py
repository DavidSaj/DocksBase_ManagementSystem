from rest_framework import serializers
from apps.channels.models import OTAChannel, OTABooking


class OTAChannelSerializer(serializers.ModelSerializer):
    class Meta:
        model = OTAChannel
        fields = [
            'id', 'marina', 'provider', 'is_active', 'property_id',
            'pricing_policy', 'pricing_delta_pct',
            'last_push_at', 'last_pull_at', 'created_at',
        ]
        read_only_fields = ['marina', 'last_push_at', 'last_pull_at', 'created_at']
        # api_key and api_secret are intentionally excluded from read responses


class OTAChannelWriteSerializer(serializers.ModelSerializer):
    """Use this serializer for create/update to accept api_key and api_secret."""
    class Meta:
        model = OTAChannel
        fields = [
            'id', 'provider', 'is_active', 'api_key', 'api_secret', 'property_id',
            'pricing_policy', 'pricing_delta_pct',
        ]
        extra_kwargs = {
            'api_key': {'write_only': True},
            'api_secret': {'write_only': True},
        }


class OTABookingSerializer(serializers.ModelSerializer):
    class Meta:
        model = OTABooking
        fields = '__all__'
        read_only_fields = ['channel', 'imported_at']
