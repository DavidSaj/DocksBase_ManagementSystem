from django.contrib import admin

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


@admin.register(BookingTier)
class BookingTierAdmin(admin.ModelAdmin):
    list_display = ['name', 'marina', 'display_order', 'rate_premium_pct', 'is_active', 'created_at']
    list_filter = ['marina', 'is_active']
    search_fields = ['name', 'marina__name']
    ordering = ['marina', 'display_order', 'name']


@admin.register(YieldRule)
class YieldRuleAdmin(admin.ModelAdmin):
    list_display = [
        'name', 'marina', 'trigger_type', 'action_type', 'action_value',
        'priority', 'pricing_model_scope', 'is_active', 'created_at',
    ]
    list_filter = ['marina', 'trigger_type', 'action_type', 'pricing_model_scope', 'is_active']
    search_fields = ['name', 'marina__name']
    ordering = ['marina', 'priority', 'name']


@admin.register(YieldApplication)
class YieldApplicationAdmin(admin.ModelAdmin):
    list_display = [
        'booking', 'marina', 'rule_name_snapshot', 'base_price',
        'computed_price', 'floor_ceiling_clamped', 'applied_at',
    ]
    list_filter = ['marina', 'floor_ceiling_clamped']
    search_fields = ['rule_name_snapshot', 'booking__id']
    readonly_fields = ['applied_at']


@admin.register(HourlyBerthConfig)
class HourlyBerthConfigAdmin(admin.ModelAdmin):
    list_display = [
        'berth', 'marina', 'min_duration_minutes', 'max_duration_minutes',
        'increment_minutes', 'pricing_item', 'is_active',
    ]
    list_filter = ['marina', 'is_active', 'increment_minutes']
    search_fields = ['berth__code', 'marina__name']


@admin.register(UpgradeCampaign)
class UpgradeCampaignAdmin(admin.ModelAdmin):
    list_display = [
        'booking', 'marina', 'from_tier', 'to_tier', 'differential_amount',
        'status', 'sent_at', 'expires_at', 'created_at',
    ]
    list_filter = ['marina', 'status']
    search_fields = ['booking__id', 'marina__name']
    readonly_fields = ['created_at']


@admin.register(UpsellOffer)
class UpsellOfferAdmin(admin.ModelAdmin):
    list_display = [
        'booking', 'marina', 'chargeable_item', 'trigger_event',
        'discount_pct', 'status', 'sent_at', 'redeemed_at', 'created_at',
    ]
    list_filter = ['marina', 'trigger_event', 'status']
    search_fields = ['booking__id', 'chargeable_item__name']
    readonly_fields = ['created_at']


@admin.register(WaitlistEntry)
class WaitlistEntryAdmin(admin.ModelAdmin):
    list_display = [
        'email', 'name', 'marina', 'booking_tier', 'vessel_length_m',
        'desired_check_in', 'desired_check_out', 'is_active', 'created_at',
    ]
    list_filter = ['marina', 'is_active', 'booking_tier']
    search_fields = ['email', 'name', 'marina__name']
    readonly_fields = ['created_at']


@admin.register(WaitlistOffer)
class WaitlistOfferAdmin(admin.ModelAdmin):
    list_display = [
        'waitlist_entry', 'marina', 'berth', 'check_in', 'check_out',
        'discounted_price', 'status', 'sent_at', 'expires_at', 'created_at',
    ]
    list_filter = ['marina', 'status']
    search_fields = ['waitlist_entry__email', 'berth__code']
    readonly_fields = ['created_at']


@admin.register(CompetitorRate)
class CompetitorRateAdmin(admin.ModelAdmin):
    list_display = [
        'competitor_name', 'marina', 'rate_per_night', 'vessel_length_m',
        'valid_from', 'valid_until', 'source', 'scraped_at', 'created_at',
    ]
    list_filter = ['marina', 'source']
    search_fields = ['competitor_name', 'marina__name']
    readonly_fields = ['created_at', 'scraped_at']
