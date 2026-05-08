from rest_framework import serializers
from apps.marketplace.models import BerthListing, BerthListingPhoto, BerthEnquiry, ExchangeListing, ExchangeAgreement


class BerthListingPhotoSerializer(serializers.ModelSerializer):
    class Meta:
        model = BerthListingPhoto
        fields = '__all__'
        read_only_fields = ['marina', 'uploaded_at']


class BerthListingSerializer(serializers.ModelSerializer):
    photos = BerthListingPhotoSerializer(many=True, read_only=True)

    class Meta:
        model = BerthListing
        fields = '__all__'
        read_only_fields = ['marina', 'published_at', 'created_at', 'updated_at']


class PublicBerthListingSerializer(serializers.ModelSerializer):
    asking_price_display = serializers.SerializerMethodField()
    photos = BerthListingPhotoSerializer(many=True, read_only=True)

    def get_asking_price_display(self, obj):
        return str(obj.asking_price) if obj.show_asking_price else 'P.O.A.'

    class Meta:
        model = BerthListing
        fields = [
            'id', 'berth', 'headline', 'description', 'asking_price_display',
            'length_m', 'max_beam_m', 'max_draft_m', 'has_power', 'has_water',
            'photos', 'published_at',
        ]


class BerthEnquirySerializer(serializers.ModelSerializer):
    class Meta:
        model = BerthEnquiry
        fields = '__all__'
        read_only_fields = ['marina', 'created_at']


class ExchangeListingSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExchangeListing
        fields = '__all__'
        read_only_fields = ['marina', 'created_at']


class ExchangeAgreementSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExchangeAgreement
        fields = '__all__'
        read_only_fields = ['marina', 'agreed_at', 'created_at']
