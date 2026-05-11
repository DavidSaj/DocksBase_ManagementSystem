from django.contrib import admin

from apps.sustainability.models import (
    EmissionFactor, GridCarbonIntensity, Scope1Record, Scope2Record, Scope3Record,
    WasteLog, SustainabilityLedger, OffsetContribution, ESGReportArchive, PlayItGreenSync,
)


@admin.register(EmissionFactor)
class EmissionFactorAdmin(admin.ModelAdmin):
    list_display  = ['marina', 'energy_type', 'kg_co2e_per_unit', 'unit', 'valid_from', 'valid_to', 'source']
    list_filter   = ['energy_type', 'source', 'jurisdiction']
    search_fields = ['marina__name']


@admin.register(GridCarbonIntensity)
class GridCarbonIntensityAdmin(admin.ModelAdmin):
    list_display  = ['marina', 'valid_date', 'kg_co2e_per_kwh', 'grid_source', 'is_manual_override']
    list_filter   = ['grid_source', 'is_manual_override']
    search_fields = ['marina__name']


@admin.register(Scope1Record)
class Scope1RecordAdmin(admin.ModelAdmin):
    list_display    = ['marina', 'date', 'source', 'fuel_type', 'quantity', 'unit', 'co2e_kg']
    list_filter     = ['source', 'fuel_type']
    readonly_fields = ['unit', 'co2e_kg']   # computed on save


@admin.register(Scope2Record)
class Scope2RecordAdmin(admin.ModelAdmin):
    list_display  = ['marina', 'period', 'kwh_consumed', 'co2e_kg', 'data_source']
    list_filter   = ['data_source']
    search_fields = ['marina__name', 'period']


@admin.register(Scope3Record)
class Scope3RecordAdmin(admin.ModelAdmin):
    list_display  = ['marina', 'period', 'category', 'fuel_type', 'quantity', 'co2e_kg', 'data_source']
    list_filter   = ['category', 'data_source']
    search_fields = ['marina__name', 'period']


@admin.register(WasteLog)
class WasteLogAdmin(admin.ModelAdmin):
    list_display    = ['marina', 'date', 'category', 'quantity', 'unit', 'disposal_method']
    list_filter     = ['category', 'disposal_method']
    readonly_fields = ['unit']   # computed on save
    search_fields   = ['marina__name', 'waste_carrier']


@admin.register(SustainabilityLedger)
class SustainabilityLedgerAdmin(admin.ModelAdmin):
    list_display    = ['marina', 'period', 'total_co2e_kg', 'is_stale', 'computed_at']
    list_filter     = ['is_stale']
    readonly_fields = ['total_co2e_kg', 'computed_at']
    search_fields   = ['marina__name', 'period']


@admin.register(OffsetContribution)
class OffsetContributionAdmin(admin.ModelAdmin):
    list_display  = ['marina', 'partner', 'amount_gbp', 'pig_contribution_id', 'synced_at', 'created_at']
    list_filter   = ['partner']
    search_fields = ['marina__name', 'pig_contribution_id']


@admin.register(ESGReportArchive)
class ESGReportArchiveAdmin(admin.ModelAdmin):
    list_display    = ['marina', 'period_from', 'period_to', 'framework', 'status', 'generated_at']
    list_filter     = ['status', 'framework']
    readonly_fields = ['status', 'pdf_file', 'celery_task_id', 'error_detail', 'generated_at']
    search_fields   = ['marina__name']


@admin.register(PlayItGreenSync)
class PlayItGreenSyncAdmin(admin.ModelAdmin):
    list_display  = ['marina', 'direction', 'status', 'records_count', 'total_gbp', 'synced_at']
    list_filter   = ['direction', 'status']
    search_fields = ['marina__name']
