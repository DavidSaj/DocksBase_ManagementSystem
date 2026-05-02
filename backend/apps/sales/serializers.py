from datetime import date
from rest_framework import serializers
from .models import Listing, Lead


class ListingSerializer(serializers.ModelSerializer):
    days_listed = serializers.SerializerMethodField()
    owner_name = serializers.SerializerMethodField()
    est_commission = serializers.SerializerMethodField()

    class Meta:
        model = Listing
        fields = [
            'id', 'name', 'vessel_type', 'make', 'model', 'loa', 'year',
            'price', 'commission_pct', 'owner', 'owner_name', 'location',
            'highlights', 'status', 'listed_at', 'days_listed', 'est_commission',
        ]
        read_only_fields = ['id', 'listed_at', 'days_listed', 'owner_name', 'est_commission']

    def get_days_listed(self, obj):
        if obj.status == 'sold':
            return None
        return (date.today() - obj.listed_at).days

    def get_owner_name(self, obj):
        return obj.owner.name if obj.owner else None

    def get_est_commission(self, obj):
        return round(float(obj.price) * float(obj.commission_pct) / 100, 2)


class LeadSerializer(serializers.ModelSerializer):
    listing_name = serializers.SerializerMethodField()

    class Meta:
        model = Lead
        fields = [
            'id', 'name', 'contact', 'listing', 'listing_name',
            'budget', 'stage', 'source', 'notes', 'last_contact', 'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'listing_name']

    def get_listing_name(self, obj):
        return obj.listing.name if obj.listing else None
