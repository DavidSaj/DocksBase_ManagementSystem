from django.contrib import admin
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


@admin.register(LoyaltyTier)
class LoyaltyTierAdmin(admin.ModelAdmin):
    list_display = ['marina', 'name', 'rank', 'qualification_basis', 'threshold', 'berth_discount_pct', 'is_active']
    list_filter = ['marina', 'qualification_basis', 'requalification_policy', 'is_active']


@admin.register(LoyaltyMembership)
class LoyaltyMembershipAdmin(admin.ModelAdmin):
    list_display = ['marina', 'member', 'tier', 'points_balance', 'lifetime_spend', 'qualifying_stays', 'last_activity_at']
    list_filter = ['marina', 'tier']
    readonly_fields = ['points_balance', 'lifetime_spend', 'qualifying_stays', 'tier_achieved_at', 'tier_expires_at', 'last_activity_at', 'created_at']


@admin.register(PointsLedger)
class PointsLedgerAdmin(admin.ModelAdmin):
    list_display = ['membership', 'entry_type', 'points', 'balance_after', 'description', 'created_at']
    list_filter = ['entry_type']
    readonly_fields = ['membership', 'entry_type', 'points', 'balance_after', 'description', 'invoice', 'line_item', 'created_by', 'created_at']


@admin.register(ReferralCode)
class ReferralCodeAdmin(admin.ModelAdmin):
    list_display = ['marina', 'member', 'code', 'referrer_benefit_type', 'referrer_benefit_value', 'is_active']
    list_filter = ['marina', 'is_active']


@admin.register(ReferralUse)
class ReferralUseAdmin(admin.ModelAdmin):
    list_display = ['referral_code', 'referee_member', 'benefit_status', 'created_at']
    list_filter = ['benefit_status']
    readonly_fields = ['referral_code', 'referee_member', 'referee_booking', 'created_at']


@admin.register(CouponCode)
class CouponCodeAdmin(admin.ModelAdmin):
    list_display = ['marina', 'code', 'discount_type', 'discount_value', 'uses_count', 'is_active']
    list_filter = ['marina', 'discount_type', 'is_active']


@admin.register(MemberCreditAccount)
class MemberCreditAccountAdmin(admin.ModelAdmin):
    list_display = ['marina', 'member', 'balance', 'updated_at']
    list_filter = ['marina']
    readonly_fields = ['balance', 'updated_at']


@admin.register(CreditTransaction)
class CreditTransactionAdmin(admin.ModelAdmin):
    list_display = ['account', 'delta', 'description', 'invoice', 'created_at']
    readonly_fields = ['account', 'delta', 'description', 'invoice', 'created_at']
