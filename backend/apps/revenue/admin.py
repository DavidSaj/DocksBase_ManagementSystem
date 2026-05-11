from django.contrib import admin
from apps.revenue.models import BookingTier, WaitlistEntry, YieldApplication, YieldRule


@admin.register(BookingTier)
class BookingTierAdmin(admin.ModelAdmin):
    list_display = ['marina', 'berth_category', 'season', 'booking_type', 'base_nightly_rate', 'min_stay_nights']
    list_filter = ['marina', 'season', 'booking_type']


@admin.register(YieldRule)
class YieldRuleAdmin(admin.ModelAdmin):
    list_display = ['marina', 'name', 'rule_type', 'multiplier', 'priority', 'is_active']
    list_filter = ['marina', 'rule_type', 'is_active']
    list_editable = ['priority', 'is_active']


@admin.register(YieldApplication)
class YieldApplicationAdmin(admin.ModelAdmin):
    list_display = ['marina', 'booking', 'rule', 'base_price', 'applied_price', 'applied_at']
    list_filter = ['marina', 'rule']
    readonly_fields = ['marina', 'booking', 'rule', 'base_price', 'applied_price', 'applied_at']


@admin.register(WaitlistEntry)
class WaitlistEntryAdmin(admin.ModelAdmin):
    list_display = ['marina', 'member', 'vessel', 'desired_from', 'booking_type', 'priority_score', 'is_active']
    list_filter = ['marina', 'booking_type', 'is_active']
    readonly_fields = ['priority_score', 'fulfilled_booking', 'created_at']
