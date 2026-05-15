from rest_framework import serializers

from .models import APIKey


class APIKeyReadSerializer(serializers.ModelSerializer):
    status = serializers.CharField(read_only=True)  # uses model property

    class Meta:
        model = APIKey
        fields = [
            'id', 'name', 'key_prefix', 'last_four', 'status',
            'expires_at', 'last_used_at', 'created_at',
        ]
        read_only_fields = fields


class APIKeyCreateSerializer(serializers.ModelSerializer):
    class Meta:
        model = APIKey
        fields = ['name', 'expires_at']

    def validate_name(self, value):
        if not value.strip():
            raise serializers.ValidationError('Name is required.')
        return value.strip()


class APIKeyCreatedSerializer(serializers.ModelSerializer):
    """
    Serializer used only for the create response.
    Includes the transient `key` field set on the in-memory instance.
    The raw key is NEVER read from the DB; it's set before serialization.
    """
    status = serializers.CharField(read_only=True)
    key = serializers.SerializerMethodField()

    class Meta:
        model = APIKey
        fields = [
            'id', 'name', 'key_prefix', 'last_four', 'status',
            'expires_at', 'last_used_at', 'created_at', 'key',
        ]
        read_only_fields = fields

    def get_key(self, obj):
        # The raw key is injected as a transient attribute before serialization
        return getattr(obj, '_raw_key', None)
