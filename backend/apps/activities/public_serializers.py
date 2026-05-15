from rest_framework import serializers
from .models import Activity


class PublicActivitySerializer(serializers.ModelSerializer):
    photo_url  = serializers.SerializerMethodField()
    price_from = serializers.SerializerMethodField()

    class Meta:
        model = Activity
        fields = [
            'id', 'name', 'description', 'category', 'duration_minutes',
            'capacity_min', 'capacity_max', 'min_age', 'photo_url',
            'season_start', 'season_end', 'price_from',
        ]

    def get_photo_url(self, obj):
        return obj.photo.url if obj.photo else None

    def get_price_from(self, obj):
        prices = [
            rule.chargeable_item.unit_price
            for rule in obj.pricing_rules.all()
            if rule.chargeable_item_id
        ]
        return min(prices) if prices else None


class PublicActivityRequestSerializer(serializers.Serializer):
    marina_slug       = serializers.SlugField()
    activity_id       = serializers.IntegerField()
    start_datetime    = serializers.DateTimeField()
    participant_count = serializers.IntegerField(min_value=1)
    lead_name         = serializers.CharField(max_length=200)
    lead_email        = serializers.EmailField()
    lead_phone        = serializers.CharField(max_length=30, required=False, allow_blank=True)
    notes             = serializers.CharField(required=False, allow_blank=True)
    captcha_token     = serializers.CharField()
