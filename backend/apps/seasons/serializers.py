from rest_framework import serializers

from .models import (
    BerthLease,
    InstalmentPlan,
    LeaseInstalment,
    Season,
    SeasonalRateCard,
)


class SeasonSerializer(serializers.ModelSerializer):
    class Meta:
        model = Season
        fields = [
            'id', 'marina', 'name', 'season_type',
            'start_date', 'end_date',
            'is_default_for_new_leases',
            'default_rate_card', 'default_instalment_plan',
            'auto_renewal_enabled', 'waitlist_drain_priority',
            'is_tax_exempt_default', 'is_archived', 'notes',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class SeasonalRateCardSerializer(serializers.ModelSerializer):
    class Meta:
        model = SeasonalRateCard
        fields = [
            'id', 'marina', 'season', 'name',
            'min_length_m', 'max_length_m', 'berth_category',
            'season_total', 'deposit_amount', 'tax_rate', 'is_active',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class InstalmentPlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = InstalmentPlan
        fields = [
            'id', 'marina', 'name', 'frequency', 'instalment_count',
            'first_due_offset_days', 'deposit_first', 'is_active',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class LeaseInstalmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaseInstalment
        fields = [
            'id', 'lease', 'sequence', 'due_date', 'amount',
            'invoice', 'status', 'issued_at', 'paid_at',
        ]
        read_only_fields = fields


class BerthLeaseSerializer(serializers.ModelSerializer):
    instalments = LeaseInstalmentSerializer(many=True, read_only=True)

    class Meta:
        model = BerthLease
        fields = [
            'id', 'marina', 'berth', 'member', 'vessel', 'season',
            'rate_card', 'season_total', 'deposit_amount',
            'start_date', 'end_date',
            'status', 'status_changed_at', 'at_risk',
            'deposit_paid_at', 'deposit_forfeited',
            'prior_lease', 'renewal_offered_at', 'renewal_response',
            'auto_renewal_enabled',
            'instalment_plan', 'tax_exempt_override',
            'source', 'waitlist_offer', 'notes',
            'created_at', 'updated_at',
            'instalments',
        ]
        read_only_fields = [
            'id', 'status_changed_at', 'deposit_paid_at',
            'deposit_forfeited', 'created_at', 'updated_at',
            'instalments',
        ]


class LeaseCreateSerializer(serializers.Serializer):
    """Wizard payload — service layer assembles the lease."""
    member = serializers.IntegerField()
    berth = serializers.IntegerField()
    season = serializers.IntegerField()
    rate_card = serializers.IntegerField(required=False, allow_null=True)
    instalment_plan = serializers.IntegerField(required=False, allow_null=True)
    vessel = serializers.IntegerField(required=False, allow_null=True)
    start_date = serializers.DateField(required=False)
    end_date = serializers.DateField(required=False)
    tax_exempt_override = serializers.BooleanField(required=False)
    auto_renewal_enabled = serializers.BooleanField(required=False)
    source = serializers.ChoiceField(
        choices=['manual', 'waitlist_offer', 'renewal'],
        default='manual',
    )
    notes = serializers.CharField(required=False, allow_blank=True)


class LeaseTransitionSerializer(serializers.Serializer):
    target = serializers.ChoiceField(
        choices=[
            'accepted', 'deposit_paid', 'active', 'ending', 'ended',
            'renewed', 'cancelled', 'defaulted',
        ],
    )
    reason = serializers.CharField(required=False, allow_blank=True)
