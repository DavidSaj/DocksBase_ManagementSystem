from django.contrib import admin

from apps.charter.models import (
    CharterAgentCommission,
    CharterAgreement,
    CharterBooking,
    CharterManagementAgreement,
    CharterVessel,
    CharterVesselOTAMapping,
    RentalBooking,
    RentalUnit,
)


@admin.register(CharterVessel)
class CharterVesselAdmin(admin.ModelAdmin):
    list_display = ['vessel', 'marina', 'is_available', 'skipper_required', 'fuel_inclusive']
    list_filter  = ['marina', 'is_available', 'skipper_required']
    raw_id_fields = ['vessel', 'hourly_rate_item', 'daily_rate_item', 'weekly_rate_item',
                     'cleaning_fee_item', 'skipper_fee_item']
    search_fields = ['vessel__name']


@admin.register(CharterManagementAgreement)
class CharterManagementAgreementAdmin(admin.ModelAdmin):
    list_display  = ['charter_vessel', 'owner_label', 'split_percentage', 'commission_rate', 'valid_from', 'valid_to']
    list_filter   = ['marina', 'charter_vessel']
    raw_id_fields = ['charter_vessel', 'member']


@admin.register(CharterBooking)
class CharterBookingAdmin(admin.ModelAdmin):
    list_display   = ['pk', 'charter_vessel', 'charterer_name', 'start_dt', 'end_dt', 'status', 'channel', 'deposit_mechanism', 'deposit_status']
    list_filter    = ['marina', 'status', 'channel', 'deposit_mechanism', 'deposit_status']
    search_fields  = ['charterer_name', 'charterer_email', 'channel_ref']
    raw_id_fields  = ['charter_vessel', 'charterer', 'skipper', 'invoice']
    date_hierarchy = 'start_dt'


@admin.register(CharterAgreement)
class CharterAgreementAdmin(admin.ModelAdmin):
    list_display  = ['booking', 'signed_at', 'created_at']
    raw_id_fields = ['booking', 'envelope']


@admin.register(CharterAgentCommission)
class CharterAgentCommissionAdmin(admin.ModelAdmin):
    list_display  = ['booking', 'agent_name', 'commission_rate', 'commission_amount', 'payment_status', 'paid_at']
    list_filter   = ['payment_status', 'marina']
    raw_id_fields = ['booking']
    search_fields = ['agent_name', 'agent_email']


@admin.register(CharterVesselOTAMapping)
class CharterVesselOTAMappingAdmin(admin.ModelAdmin):
    list_display  = ['channel', 'ota_vessel_id', 'charter_vessel', 'marina']
    list_filter   = ['marina', 'channel']
    raw_id_fields = ['charter_vessel']


@admin.register(RentalUnit)
class RentalUnitAdmin(admin.ModelAdmin):
    list_display  = ['name', 'marina', 'unit_type', 'turnaround_minutes', 'is_active']
    list_filter   = ['marina', 'unit_type', 'is_active']
    raw_id_fields = ['hourly_rate_item', 'halfday_rate_item', 'fullday_rate_item']


@admin.register(RentalBooking)
class RentalBookingAdmin(admin.ModelAdmin):
    list_display   = ['pk', 'rental_unit', 'customer_name', 'start_dt', 'end_dt', 'status', 'total', 'online_booking']
    list_filter    = ['marina', 'status', 'online_booking']
    search_fields  = ['customer_name', 'customer_email']
    raw_id_fields  = ['rental_unit', 'member', 'invoice']
    date_hierarchy = 'start_dt'
