from decimal import Decimal

from rest_framework import serializers

from .models import (
    BookingTier,
    CompetitorRate,
    HourlyBerthConfig,
    UpgradeCampaign,
    UpsellOffer,
    WaitlistEntry,
    WaitlistOffer,
    YieldApplication,
    YieldRule,
)


class BookingTierSerializer(serializers.ModelSerializer):
    class Meta:
        model = BookingTier
        fields = [
            'id', 'marina', 'name', 'display_order', 'rate_premium_pct',
            'description', 'is_active', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class YieldRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = YieldRule
        fields = [
            'id', 'marina', 'name', 'booking_tier',
            'trigger_type', 'action_type', 'action_value',
            'occupancy_scope', 'occupancy_threshold_pct',
            'days_to_arrival_lte', 'days_in_advance_gte', 'gap_max_nights',
            'floor_price', 'ceiling_price', 'pricing_model_scope',
            'applies_to_booking_type',
            'valid_from', 'valid_until', 'priority', 'is_active', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']

    def validate_action_value(self, value):
        if value <= Decimal('0'):
            raise serializers.ValidationError('action_value must be greater than 0.')
        return value

    def validate(self, data):
        trigger = data.get('trigger_type') or getattr(self.instance, 'trigger_type', None)

        # Ensure at least one trigger parameter is supplied for the chosen trigger type.
        if trigger == YieldRule.TriggerType.OCCUPANCY_THRESHOLD:
            threshold = data.get(
                'occupancy_threshold_pct',
                getattr(self.instance, 'occupancy_threshold_pct', None),
            )
            if threshold is None:
                raise serializers.ValidationError(
                    {'occupancy_threshold_pct': 'Required for occupancy_threshold trigger.'}
                )

        elif trigger == YieldRule.TriggerType.DAYS_TO_ARRIVAL:
            lte = data.get(
                'days_to_arrival_lte',
                getattr(self.instance, 'days_to_arrival_lte', None),
            )
            if lte is None:
                raise serializers.ValidationError(
                    {'days_to_arrival_lte': 'Required for days_to_arrival trigger.'}
                )

        elif trigger == YieldRule.TriggerType.DAYS_IN_ADVANCE:
            gte = data.get(
                'days_in_advance_gte',
                getattr(self.instance, 'days_in_advance_gte', None),
            )
            if gte is None:
                raise serializers.ValidationError(
                    {'days_in_advance_gte': 'Required for days_in_advance trigger.'}
                )

        elif trigger == YieldRule.TriggerType.GAP_FILL:
            gap = data.get(
                'gap_max_nights',
                getattr(self.instance, 'gap_max_nights', None),
            )
            if gap is None:
                raise serializers.ValidationError(
                    {'gap_max_nights': 'Required for gap_fill trigger.'}
                )

        return data


class YieldApplicationSerializer(serializers.ModelSerializer):
    class Meta:
        model = YieldApplication
        fields = [
            'id', 'marina', 'booking', 'rule', 'rule_name_snapshot',
            'base_price', 'computed_price', 'floor_ceiling_clamped', 'applied_at',
        ]
        read_only_fields = ['id', 'applied_at']


class HourlyBerthConfigSerializer(serializers.ModelSerializer):
    berth_name        = serializers.CharField(source='berth.code', read_only=True)
    pricing_item_name = serializers.CharField(source='pricing_item.name', read_only=True, allow_null=True)
    # The frontend sends/reads eligible_booking_types but the model stores this
    # as a comma-separated string on the model field of the same name.
    # If the migration adding the field hasn't run yet this will return None safely.
    eligible_booking_types = serializers.CharField(
        max_length=200, required=False, allow_blank=True, default='transient'
    )

    class Meta:
        model = HourlyBerthConfig
        fields = [
            'id', 'marina', 'berth', 'berth_name',
            'min_duration_minutes', 'max_duration_minutes',
            'increment_minutes', 'pricing_item', 'pricing_item_name',
            'eligible_booking_types', 'is_active',
        ]
        read_only_fields = ['id', 'berth_name', 'pricing_item_name']



class UpgradeCampaignSerializer(serializers.ModelSerializer):
    # Nested tier objects — the frontend reads u.from_tier?.name / u.to_tier?.name
    from_tier = BookingTierSerializer(read_only=True)
    to_tier   = BookingTierSerializer(read_only=True)
    from_tier_id = serializers.PrimaryKeyRelatedField(
        queryset=BookingTier.objects.all(), source='from_tier',
        write_only=True, allow_null=True, required=False,
    )
    to_tier_id = serializers.PrimaryKeyRelatedField(
        queryset=BookingTier.objects.all(), source='to_tier',
        write_only=True, allow_null=True, required=False,
    )
    # Display fields the frontend uses
    guest_name         = serializers.SerializerMethodField()
    offered_berth_name = serializers.CharField(source='offered_berth.code', read_only=True, allow_null=True)

    class Meta:
        model = UpgradeCampaign
        fields = [
            'id', 'marina', 'booking', 'guest_name',
            'from_tier', 'from_tier_id',
            'to_tier', 'to_tier_id',
            'offered_berth', 'offered_berth_name',
            'differential_amount', 'checkout_link', 'status',
            'sent_at', 'responded_at', 'expires_at', 'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'guest_name', 'offered_berth_name']

    def get_guest_name(self, obj):
        try:
            booking = obj.booking
            if hasattr(booking, 'member') and booking.member:
                return booking.member.name
            if hasattr(booking, 'guest_name') and booking.guest_name:
                return booking.guest_name
        except Exception:
            pass
        return None


class UpsellOfferSerializer(serializers.ModelSerializer):
    chargeable_item_name = serializers.CharField(
        source='chargeable_item.name', read_only=True, allow_null=True
    )

    class Meta:
        model = UpsellOffer
        fields = [
            'id', 'marina', 'booking', 'chargeable_item', 'chargeable_item_name',
            'trigger_event', 'offer_text', 'discount_pct', 'status',
            'sent_at', 'redeemed_at', 'expires_at', 'invoice_line_item', 'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'chargeable_item_name']


class WaitlistEntrySerializer(serializers.ModelSerializer):
    # The frontend sends/reads desired_from and desired_to.
    # Map them to the model's desired_check_in / desired_check_out.
    desired_from = serializers.DateField(source='desired_check_in', allow_null=True, required=False)
    desired_to   = serializers.DateField(source='desired_check_out', allow_null=True, required=False)

    class Meta:
        model = WaitlistEntry
        fields = [
            'id', 'marina', 'email', 'name', 'vessel_length_m',
            'booking_tier',
            'desired_from', 'desired_to',      # frontend aliases
            'desired_check_in', 'desired_check_out',  # also expose canonical names
            'is_active', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class WaitlistOfferSerializer(serializers.ModelSerializer):
    class Meta:
        model = WaitlistOffer
        fields = [
            'id', 'marina', 'waitlist_entry', 'berth', 'check_in', 'check_out',
            'discounted_price', 'stripe_checkout_url', 'status',
            'sent_at', 'expires_at', 'claimed_at', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class CompetitorRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = CompetitorRate
        fields = [
            'id', 'marina', 'competitor_name', 'competitor_url', 'vessel_length_m',
            'rate_per_night', 'valid_from', 'valid_until', 'source', 'scraped_at',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'scraped_at']
