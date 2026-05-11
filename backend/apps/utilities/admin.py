from django.contrib import admin

from .models import (
    BollardFaultLog,
    BollardSwitchEvent,
    MeterOutageAlert,
    MeterReading,
    ServiceBollard,
    SmartMeter,
    UtilityIntegration,
    UtilityWallet,
    UtilityWalletTransaction,
    WashToken,
)


@admin.register(UtilityIntegration)
class UtilityIntegrationAdmin(admin.ModelAdmin):
    list_display  = ['marina', 'vendor', 'is_active', 'last_sync_at', 'last_sync_ok']
    list_filter   = ['vendor', 'is_active']
    readonly_fields = ['last_sync_at', 'last_sync_ok', 'last_sync_error']
    # NOTE: credentials field is encrypted — not displayed in raw form.
    # Edit credentials only via Django shell or a purpose-built staff tool.


@admin.register(SmartMeter)
class SmartMeterAdmin(admin.ModelAdmin):
    list_display   = ['device_id', 'label', 'vendor', 'meter_type', 'berth', 'is_active', 'is_online', 'last_polled']
    list_filter    = ['vendor', 'meter_type', 'is_active', 'is_online', 'marina']
    search_fields  = ['device_id', 'label']
    readonly_fields = ['last_polled', 'is_online']


@admin.register(MeterReading)
class MeterReadingAdmin(admin.ModelAdmin):
    list_display  = ['meter', 'recorded_at', 'source', 'reading_kwh', 'reading_m3']
    list_filter   = ['source', 'meter__meter_type']
    search_fields = ['meter__device_id', 'meter__label']
    readonly_fields = ['recorded_at']
    # NOTE: this table can be very large. Avoid full-table admin actions.
    # Consider restricting date range filters in production.


@admin.register(MeterOutageAlert)
class MeterOutageAlertAdmin(admin.ModelAdmin):
    list_display  = ['meter', 'started_at', 'resolved_at', 'notified']
    list_filter   = ['notified']
    readonly_fields = ['started_at']


@admin.register(UtilityWallet)
class UtilityWalletAdmin(admin.ModelAdmin):
    list_display   = ['member', 'marina', 'balance', 'low_balance_threshold', 'auto_deduct_enabled']
    list_filter    = ['auto_deduct_enabled', 'marina']
    search_fields  = ['member__name']
    readonly_fields = ['balance', 'last_low_balance_alert']


@admin.register(UtilityWalletTransaction)
class UtilityWalletTransactionAdmin(admin.ModelAdmin):
    list_display  = ['wallet', 'tx_type', 'amount', 'balance_after', 'created_at']
    list_filter   = ['tx_type']
    readonly_fields = ['created_at', 'balance_after']


@admin.register(ServiceBollard)
class ServiceBollardAdmin(admin.ModelAdmin):
    list_display  = ['label', 'marina', 'berth', 'status', 'has_remote_switch', 'vendor']
    list_filter   = ['status', 'has_remote_switch', 'marina']
    search_fields = ['label', 'vendor_device_id']


@admin.register(BollardFaultLog)
class BollardFaultLogAdmin(admin.ModelAdmin):
    list_display   = ['bollard', 'fault_type', 'reported_at', 'resolved_at', 'work_order']
    list_filter    = ['fault_type']
    readonly_fields = ['reported_at', 'work_order']


@admin.register(BollardSwitchEvent)
class BollardSwitchEventAdmin(admin.ModelAdmin):
    list_display   = ['bollard', 'action', 'triggered_by', 'success', 'created_at']
    list_filter    = ['action', 'success']
    readonly_fields = ['created_at', 'vendor_response']


@admin.register(WashToken)
class WashTokenAdmin(admin.ModelAdmin):
    list_display   = ['token_code', 'facility', 'member', 'status', 'issued_at', 'redeemed_at']
    list_filter    = ['facility', 'status']
    search_fields  = ['token_code']
    readonly_fields = ['token_code', 'issued_at', 'redeemed_at']
