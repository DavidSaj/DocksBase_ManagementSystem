from django.contrib import admin

from .models import (
    Activity,
    ActivityBooking,
    ActivityBookingExtra,
    ActivityBookingParticipant,
    ActivityExtra,
    ActivityPricingRule,
    ActivityResourceRequirement,
    AssetReservation,
    CancellationPolicy,
)


class ActivityPricingRuleInline(admin.TabularInline):
    model = ActivityPricingRule
    extra = 0


class ActivityResourceRequirementInline(admin.TabularInline):
    model = ActivityResourceRequirement
    extra = 0


class ActivityExtraInline(admin.TabularInline):
    model = ActivityExtra
    extra = 0


@admin.register(Activity)
class ActivityAdmin(admin.ModelAdmin):
    list_display  = ['name', 'marina', 'category', 'is_active', 'duration_minutes', 'capacity_max']
    list_filter   = ['category', 'is_active']
    search_fields = ['name']
    inlines       = [ActivityPricingRuleInline, ActivityResourceRequirementInline, ActivityExtraInline]


class ActivityBookingParticipantInline(admin.TabularInline):
    model = ActivityBookingParticipant
    extra = 0


class ActivityBookingExtraInline(admin.TabularInline):
    model = ActivityBookingExtra
    extra = 0


@admin.register(ActivityBooking)
class ActivityBookingAdmin(admin.ModelAdmin):
    list_display    = ['pk', 'activity', 'marina', 'start_datetime', 'status', 'participant_count']
    list_filter     = ['status', 'payment_mode']
    search_fields   = ['lead_name', 'lead_email']
    inlines         = [ActivityBookingParticipantInline, ActivityBookingExtraInline]
    readonly_fields = ['invoice', 'created_at', 'end_datetime', 'expires_at']


@admin.register(CancellationPolicy)
class CancellationPolicyAdmin(admin.ModelAdmin):
    list_display = ['name', 'marina', 'full_refund_hours', 'partial_refund_hours',
                    'partial_refund_pct', 'is_default']
    list_filter  = ['marina']


@admin.register(AssetReservation)
class AssetReservationAdmin(admin.ModelAdmin):
    list_display  = ['pk', 'asset', 'activity_booking', 'time_range']
    list_filter   = ['asset']
    readonly_fields = ['time_range']
