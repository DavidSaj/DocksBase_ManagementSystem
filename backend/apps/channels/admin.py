from django.contrib import admin
from apps.channels.models import OTAChannel, OTABooking


@admin.register(OTAChannel)
class OTAChannelAdmin(admin.ModelAdmin):
    list_display = ['marina', 'provider', 'is_active', 'pricing_policy', 'last_push_at', 'last_pull_at']
    list_filter = ['provider', 'is_active', 'pricing_policy']
    search_fields = ['marina__name', 'property_id']
    # api_key and api_secret are intentionally excluded from admin display
    exclude = ['api_key', 'api_secret']
    readonly_fields = ['created_at', 'last_push_at', 'last_pull_at']


@admin.register(OTABooking)
class OTABookingAdmin(admin.ModelAdmin):
    list_display = ['ota_ref', 'channel', 'booking', 'commission_pct', 'commission_amount', 'imported_at']
    list_filter = ['channel__provider']
    search_fields = ['ota_ref']
    readonly_fields = ['imported_at']
