from django.contrib import admin

from apps.harbour.models import (
    CommercialMovement,
    HarbourDueInvoice,
    HarbourTariff,
    PortStateControlRecord,
    ShippingAgent,
)


@admin.register(ShippingAgent)
class ShippingAgentAdmin(admin.ModelAdmin):
    list_display  = ['name', 'marina', 'contact_name', 'email', 'phone', 'is_active']
    list_filter   = ['marina', 'is_active']
    search_fields = ['name', 'contact_name', 'email', 'vat_number']


@admin.register(HarbourTariff)
class HarbourTariffAdmin(admin.ModelAdmin):
    list_display  = [
        'due_type', 'vessel_type', 'flag_state', 'min_gt', 'max_gt',
        'base_fee', 'multiplier_fee', 'effective_from', 'effective_to', 'is_active',
    ]
    list_filter   = ['marina', 'due_type', 'vessel_type', 'is_active']
    raw_id_fields = ['chargeable_item']


@admin.register(CommercialMovement)
class CommercialMovementAdmin(admin.ModelAdmin):
    list_display   = [
        'vessel_name', 'imo_number', 'flag', 'vessel_type',
        'gross_tonnage', 'eta', 'etd', 'status', 'psc_flag',
    ]
    list_filter    = ['marina', 'status', 'vessel_type', 'psc_flag']
    search_fields  = ['vessel_name', 'imo_number', 'flag']
    raw_id_fields  = ['shipping_agent', 'berth_assigned']
    date_hierarchy = 'eta'


@admin.register(HarbourDueInvoice)
class HarbourDueInvoiceAdmin(admin.ModelAdmin):
    list_display  = ['movement', 'due_type', 'tariff', 'quantity', 'calculated_amount', 'invoice']
    list_filter   = ['due_type', 'marina']
    raw_id_fields = ['movement', 'tariff', 'invoice']


@admin.register(PortStateControlRecord)
class PortStateControlRecordAdmin(admin.ModelAdmin):
    list_display  = ['movement', 'inspection_date', 'inspector_name', 'authority', 'outcome']
    list_filter   = ['outcome', 'marina']
    search_fields = ['movement__vessel_name', 'inspector_name', 'authority']
    raw_id_fields = ['movement']
