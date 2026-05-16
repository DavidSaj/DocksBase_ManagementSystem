from django.contrib import admin
from apps.communications.models import (
    MessageLog, WhatsAppTemplate, Journey, JourneyStep,
    JourneyEnrollment, JourneyStepLog, AlertRoute,
    DotdigitalConfig, DotdigitalSegmentMapping,
    EmailCampaign, EmailCampaignVariant, ABTest,
    ReviewRequest, ReviewConfig,
    Broadcast, BroadcastRecipient,
)


@admin.register(Broadcast)
class BroadcastAdmin(admin.ModelAdmin):
    list_display = ['pk', 'marina', 'title', 'channel', 'status', 'previewed_count', 'sent_at']
    list_filter = ['channel', 'status']
    search_fields = ['title', 'body']
    readonly_fields = ['created_at', 'previewed_at', 'sent_at', 'completed_at']


@admin.register(BroadcastRecipient)
class BroadcastRecipientAdmin(admin.ModelAdmin):
    list_display = ['pk', 'broadcast', 'channel', 'address', 'status', 'delivered_at']
    list_filter = ['channel', 'status']
    search_fields = ['address']


@admin.register(MessageLog)
class MessageLogAdmin(admin.ModelAdmin):
    list_display = ['pk', 'marina', 'channel', 'recipient', 'status', 'created_at']
    list_filter = ['channel', 'status', 'direction']
    search_fields = ['recipient', 'subject']
    readonly_fields = ['created_at', 'sent_at']


@admin.register(WhatsAppTemplate)
class WhatsAppTemplateAdmin(admin.ModelAdmin):
    list_display = ['meta_name', 'language_code', 'status', 'marina']
    list_filter = ['status', 'language_code']
    search_fields = ['meta_name']


class JourneyStepInline(admin.TabularInline):
    model = JourneyStep
    extra = 0
    ordering = ['order']


@admin.register(Journey)
class JourneyAdmin(admin.ModelAdmin):
    list_display = ['name', 'marina', 'trigger_event', 'is_active', 'created_at']
    list_filter = ['is_active', 'trigger_event']
    search_fields = ['name']
    inlines = [JourneyStepInline]


@admin.register(JourneyStep)
class JourneyStepAdmin(admin.ModelAdmin):
    list_display = ['pk', 'journey', 'order', 'step_type', 'channel']
    list_filter = ['step_type', 'channel']


@admin.register(JourneyEnrollment)
class JourneyEnrollmentAdmin(admin.ModelAdmin):
    list_display = ['pk', 'journey', 'member', 'status', 'current_step_order', 'next_step_due_at']
    list_filter = ['status']


@admin.register(JourneyStepLog)
class JourneyStepLogAdmin(admin.ModelAdmin):
    list_display = ['pk', 'enrollment', 'journey_step', 'skipped', 'gate_timed_out', 'executed_at']
    list_filter = ['skipped', 'gate_timed_out']


@admin.register(AlertRoute)
class AlertRouteAdmin(admin.ModelAdmin):
    list_display = ['marina', 'platform', 'alert_type', 'is_active']
    list_filter = ['platform', 'alert_type', 'is_active']


@admin.register(DotdigitalConfig)
class DotdigitalConfigAdmin(admin.ModelAdmin):
    list_display = ['marina', 'region', 'sync_enabled', 'last_sync_at']
    exclude = ['api_password']


@admin.register(DotdigitalSegmentMapping)
class DotdigitalSegmentMappingAdmin(admin.ModelAdmin):
    list_display = ['marina', 'segment', 'dotdigital_book_id', 'last_sync_count']


class EmailCampaignVariantInline(admin.TabularInline):
    model = EmailCampaignVariant
    extra = 0


@admin.register(EmailCampaign)
class EmailCampaignAdmin(admin.ModelAdmin):
    list_display = ['name', 'marina', 'status', 'scheduled_at', 'sent_at', 'total_sent']
    list_filter = ['status']
    inlines = [EmailCampaignVariantInline]


@admin.register(EmailCampaignVariant)
class EmailCampaignVariantAdmin(admin.ModelAdmin):
    list_display = ['campaign', 'label', 'sent_count', 'open_count', 'click_count']


@admin.register(ABTest)
class ABTestAdmin(admin.ModelAdmin):
    list_display = ['campaign', 'winner_metric', 'winner_action', 'winner_variant', 'winner_sent_at']


@admin.register(ReviewRequest)
class ReviewRequestAdmin(admin.ModelAdmin):
    list_display = ['pk', 'marina', 'platform', 'status', 'member', 'sent_at']
    list_filter = ['platform', 'status']


@admin.register(ReviewConfig)
class ReviewConfigAdmin(admin.ModelAdmin):
    list_display = ['marina', 'enabled', 'delay_hours', 'send_channel', 'negative_threshold']
