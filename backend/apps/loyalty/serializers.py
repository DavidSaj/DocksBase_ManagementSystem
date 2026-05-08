from decimal import Decimal
from rest_framework import serializers

from apps.loyalty.models import (
    CouponCode,
    CreditTransaction,
    LoyaltyMembership,
    LoyaltyTier,
    MemberCreditAccount,
    PointsLedger,
    ReferralCode,
    ReferralUse,
)


class LoyaltyTierSerializer(serializers.ModelSerializer):
    class Meta:
        model = LoyaltyTier
        fields = [
            'id', 'name', 'rank', 'qualification_basis', 'threshold',
            'berth_discount_pct', 'points_multiplier', 'priority_berth_allocation',
            'complimentary_services', 'requalification_policy', 'grace_period_days',
            'is_active',
        ]


class LoyaltyMembershipSerializer(serializers.ModelSerializer):
    member_name = serializers.CharField(source='member.name', read_only=True)
    tier_name = serializers.SerializerMethodField()
    tier_rank = serializers.SerializerMethodField()

    class Meta:
        model = LoyaltyMembership
        fields = [
            'id', 'member', 'member_name', 'tier', 'tier_name', 'tier_rank',
            'points_balance', 'lifetime_spend', 'qualifying_stays',
            'tier_achieved_at', 'tier_expires_at', 'last_activity_at', 'created_at',
        ]
        read_only_fields = [
            'points_balance', 'lifetime_spend', 'qualifying_stays',
            'tier_achieved_at', 'tier_expires_at', 'last_activity_at', 'created_at',
        ]

    def get_tier_name(self, obj):
        return obj.tier.name if obj.tier else None

    def get_tier_rank(self, obj):
        return obj.tier.rank if obj.tier else None


class PointsLedgerSerializer(serializers.ModelSerializer):
    membership = serializers.IntegerField(source='membership_id', read_only=True)
    member_name = serializers.SerializerMethodField()

    class Meta:
        model = PointsLedger
        fields = [
            'id', 'membership', 'member_name', 'entry_type', 'points', 'balance_after',
            'description', 'invoice', 'created_at', 'created_by',
        ]
        read_only_fields = fields

    def get_member_name(self, obj):
        try:
            return obj.membership.member.name
        except Exception:
            return None


class ReferralCodeSerializer(serializers.ModelSerializer):
    member_name = serializers.CharField(source='member.name', read_only=True)
    uses_count = serializers.SerializerMethodField()

    class Meta:
        model = ReferralCode
        fields = [
            'id', 'member', 'member_name', 'code',
            'referrer_benefit_type', 'referrer_benefit_value',
            'referee_benefit_type', 'referee_benefit_value',
            'uses_count', 'is_active', 'created_at',
        ]
        read_only_fields = ['uses_count', 'created_at']

    def get_uses_count(self, obj):
        return obj.uses.count()


class ReferralUseSerializer(serializers.ModelSerializer):
    # Expose the code string directly (frontend reads r.code ?? r.referral_code_code)
    code = serializers.CharField(source='referral_code.code', read_only=True)
    # Expose the referrer's name via referral_code → member
    referrer_name = serializers.SerializerMethodField()
    referee_member_name = serializers.SerializerMethodField()

    class Meta:
        model = ReferralUse
        fields = [
            'id', 'referral_code', 'code',
            'referrer_name', 'referee_member', 'referee_member_name',
            'referee_booking',
            'benefit_status', 'referrer_benefit_applied_at',
            'referee_benefit_applied_at', 'created_at',
        ]
        read_only_fields = fields

    def get_referrer_name(self, obj):
        try:
            return obj.referral_code.member.name
        except Exception:
            return None

    def get_referee_member_name(self, obj):
        try:
            return obj.referee_member.name if obj.referee_member else None
        except Exception:
            return None


class CouponCodeSerializer(serializers.ModelSerializer):
    is_currently_valid = serializers.SerializerMethodField()

    class Meta:
        model = CouponCode
        fields = [
            'id', 'code', 'description', 'discount_type', 'discount_value',
            'max_uses', 'uses_count', 'valid_from', 'valid_to',
            'is_active', 'applicable_categories', 'is_currently_valid', 'created_at',
        ]
        read_only_fields = ['uses_count', 'created_at']

    def get_is_currently_valid(self, obj):
        return obj.is_valid()


class MemberCreditAccountSerializer(serializers.ModelSerializer):
    member_name = serializers.CharField(source='member.name', read_only=True)

    class Meta:
        model = MemberCreditAccount
        fields = ['id', 'member', 'member_name', 'balance', 'updated_at']
        read_only_fields = ['balance', 'updated_at']


class CreditTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = CreditTransaction
        fields = ['id', 'delta', 'description', 'invoice', 'created_at']
        read_only_fields = fields


# ── Input serializers ─────────────────────────────────────────────────────────

class ApplyCouponSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=50)
    invoice = serializers.IntegerField()


class RedeemPointsSerializer(serializers.Serializer):
    membership = serializers.IntegerField()
    points = serializers.IntegerField(min_value=1)
    invoice = serializers.IntegerField()


class EarnPointsSerializer(serializers.Serializer):
    membership = serializers.IntegerField()
    points = serializers.IntegerField(min_value=1)
    invoice = serializers.IntegerField(required=False, allow_null=True)
    description = serializers.CharField(max_length=255, required=False, default='')
    entry_type = serializers.ChoiceField(
        choices=PointsLedger.EntryType.choices,
        default=PointsLedger.EntryType.EARN,
    )


class AdjustPointsSerializer(serializers.Serializer):
    membership = serializers.IntegerField()
    points = serializers.IntegerField()  # Can be negative
    description = serializers.CharField(max_length=255)


class TopUpCreditSerializer(serializers.Serializer):
    member = serializers.IntegerField()
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal('0.01'))
    description = serializers.CharField(max_length=255, required=False, default='')
