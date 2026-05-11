import secrets

from django.contrib import admin

from .models import (
    BatteryChargeRequest,
    BatchJobPost,
    BatchJobPostLine,
    BOMItem,
    BuildMilestone,
    BuildProject,
    ConciergeCatalogueItem,
    Contractor,
    ForkliftDeviceToken,
    HaulOut,
    InventoryAnomaly,
    InventoryLevel,
    JobTemplate,
    JobTemplatePart,
    JobTemplateTask,
    LaunchRequest,
    Location,
    Part,
    PartPriceHistory,
    PickTicket,
    PickTicketLine,
    ServiceTruck,
    StorageSlot,
    SupplierColumnMap,
    SupplierPriceFile,
    TaskDependency,
    Tool,
    TruckStockTransfer,
    WarrantyAgreement,
    WarrantyClaim,
    WorkOrder,
    WorkOrderTask,
)

# ---------------------------------------------------------------------------
# Existing registrations
# ---------------------------------------------------------------------------

admin.site.register(HaulOut)
admin.site.register(WorkOrder)
admin.site.register(Part)
admin.site.register(Tool)
admin.site.register(StorageSlot)
admin.site.register(LaunchRequest)
admin.site.register(Contractor)

# ---------------------------------------------------------------------------
# Track 6 additions
# ---------------------------------------------------------------------------

@admin.register(ForkliftDeviceToken)
class ForkliftDeviceTokenAdmin(admin.ModelAdmin):
    list_display   = ['label', 'marina', 'is_active', 'created_at', 'last_used_at']
    list_filter    = ['is_active', 'marina']
    readonly_fields = ['token', 'created_at', 'last_used_at']
    # token field is shown but not editable — always generated server-side
    # via secrets.token_urlsafe(48). Use the 'Generate token' action or
    # create via API endpoint POST /api/v1/boatyard/forklift-device-tokens/

    actions = ['revoke_tokens']

    def revoke_tokens(self, request, queryset):
        updated = queryset.update(is_active=False)
        self.message_user(request, f'{updated} token(s) revoked.')
    revoke_tokens.short_description = 'Revoke selected tokens (set is_active=False)'


@admin.register(ConciergeCatalogueItem)
class ConciergeCatalogueItemAdmin(admin.ModelAdmin):
    list_display  = ['name', 'marina', 'timing', 'is_active', 'sort_order', 'estimated_minutes']
    list_filter   = ['timing', 'is_active', 'marina']
    search_fields = ['name']
    ordering      = ['sort_order', 'name']


class PickTicketLineInline(admin.TabularInline):
    model  = PickTicketLine
    extra  = 0
    fields = ['catalogue_item', 'status', 'completed_at', 'notes']
    readonly_fields = ['completed_at']


@admin.register(PickTicket)
class PickTicketAdmin(admin.ModelAdmin):
    list_display  = ['pk', 'launch_request', 'assigned_to', 'created_at', 'completed_at']
    inlines       = [PickTicketLineInline]
    readonly_fields = ['created_at']


@admin.register(BatteryChargeRequest)
class BatteryChargeRequestAdmin(admin.ModelAdmin):
    list_display   = ['vessel', 'marina', 'status', 'requested_at', 'started_at', 'completed_at']
    list_filter    = ['status', 'marina']
    search_fields  = ['vessel__name']
    readonly_fields = ['requested_at']


# ---------------------------------------------------------------------------
# Track 5 — Advanced Boatyard admin registrations
# ---------------------------------------------------------------------------

@admin.register(WorkOrderTask)
class WorkOrderTaskAdmin(admin.ModelAdmin):
    list_display  = ['title', 'work_order', 'status', 'percent_complete', 'is_critical', 'planned_start', 'planned_end']
    list_filter   = ['status', 'is_critical', 'marina']
    search_fields = ['title', 'work_order__title']
    readonly_fields = ['created_at', 'is_critical']


@admin.register(TaskDependency)
class TaskDependencyAdmin(admin.ModelAdmin):
    list_display = ['predecessor', 'successor', 'dependency_type', 'lag_days', 'marina']
    list_filter  = ['dependency_type', 'marina']


@admin.register(BuildProject)
class BuildProjectAdmin(admin.ModelAdmin):
    list_display  = ['project_name', 'marina', 'status', 'hull_number', 'keel_laid_date', 'launch_target_date']
    list_filter   = ['status', 'marina']
    search_fields = ['project_name', 'hull_number']


@admin.register(BOMItem)
class BOMItemAdmin(admin.ModelAdmin):
    list_display  = ['description', 'build_project', 'quantity', 'unit', 'procurement_status', 'supplier']
    list_filter   = ['procurement_status', 'marina']
    search_fields = ['description', 'supplier']


@admin.register(BuildMilestone)
class BuildMilestoneAdmin(admin.ModelAdmin):
    list_display  = ['name', 'build_project', 'planned_date', 'actual_date', 'payment_amount', 'invoice']
    list_filter   = ['marina']
    search_fields = ['name']
    readonly_fields = ['invoice']


@admin.register(JobTemplate)
class JobTemplateAdmin(admin.ModelAdmin):
    list_display  = ['name', 'marina', 'category', 'is_active', 'estimated_total_hours', 'created_at']
    list_filter   = ['is_active', 'marina', 'category']
    search_fields = ['name']


admin.site.register(JobTemplateTask)
admin.site.register(JobTemplatePart)


@admin.register(BatchJobPost)
class BatchJobPostAdmin(admin.ModelAdmin):
    list_display = ['pk', 'marina', 'posted_by', 'posted_at']
    list_filter  = ['marina']
    readonly_fields = ['posted_at']


admin.site.register(BatchJobPostLine)


@admin.register(WarrantyAgreement)
class WarrantyAgreementAdmin(admin.ModelAdmin):
    list_display  = ['manufacturer_name', 'marina', 'covers_parts', 'covers_labour', 'is_active', 'reimbursement_rate_pct']
    list_filter   = ['is_active', 'covers_parts', 'covers_labour', 'marina']
    search_fields = ['manufacturer_name', 'contact_email']


@admin.register(WarrantyClaim)
class WarrantyClaimAdmin(admin.ModelAdmin):
    list_display  = ['pk', 'marina', 'agreement', 'work_order', 'status', 'total_claimed', 'amount_reimbursed', 'submitted_at']
    list_filter   = ['status', 'marina']
    search_fields = ['claim_reference']
    readonly_fields = ['submitted_at', 'reimbursed_at', 'claim_document_url']


@admin.register(SupplierPriceFile)
class SupplierPriceFileAdmin(admin.ModelAdmin):
    list_display  = ['supplier_name', 'marina', 'import_format', 'status', 'rows_processed', 'rows_flagged', 'queued_at']
    list_filter   = ['status', 'import_format', 'marina']
    search_fields = ['supplier_name']
    readonly_fields = ['queued_at', 'completed_at', 'rows_processed', 'rows_updated', 'rows_flagged', 'error_detail']


@admin.register(SupplierColumnMap)
class SupplierColumnMapAdmin(admin.ModelAdmin):
    list_display = ['supplier_name', 'marina', 'updated_at']
    list_filter  = ['marina']
    readonly_fields = ['updated_at']


@admin.register(PartPriceHistory)
class PartPriceHistoryAdmin(admin.ModelAdmin):
    list_display  = ['part', 'marina', 'old_unit_cost', 'new_unit_cost', 'change_pct', 'is_flagged', 'applied', 'recorded_at']
    list_filter   = ['is_flagged', 'applied', 'marina']
    search_fields = ['part__name']
    readonly_fields = ['recorded_at']

    actions = ['approve_price_changes']

    def approve_price_changes(self, request, queryset):
        applied = 0
        for record in queryset.filter(applied=False):
            record.part.unit_cost = record.new_unit_cost
            record.part.save(update_fields=['unit_cost'])
            record.applied = True
            record.save(update_fields=['applied'])
            applied += 1
        self.message_user(request, f'{applied} price change(s) applied.')
    approve_price_changes.short_description = 'Apply selected price changes to Part.unit_cost'


@admin.register(Location)
class LocationAdmin(admin.ModelAdmin):
    list_display = ['name', 'location_type', 'marina']
    list_filter  = ['location_type', 'marina']
    search_fields = ['name']


@admin.register(ServiceTruck)
class ServiceTruckAdmin(admin.ModelAdmin):
    list_display = ['location', 'marina', 'registration', 'assigned_to', 'is_active']
    list_filter  = ['is_active', 'marina']
    search_fields = ['registration', 'assigned_to']


@admin.register(InventoryLevel)
class InventoryLevelAdmin(admin.ModelAdmin):
    list_display  = ['part', 'location', 'marina', 'quantity', 'par']
    list_filter   = ['marina', 'location__location_type']
    search_fields = ['part__name', 'location__name']


@admin.register(InventoryAnomaly)
class InventoryAnomalyAdmin(admin.ModelAdmin):
    list_display  = ['pk', 'marina', 'inventory_level', 'quantity_after', 'status', 'resolved_by', 'created_at']
    list_filter   = ['status', 'marina']
    readonly_fields = ['created_at']


@admin.register(TruckStockTransfer)
class TruckStockTransferAdmin(admin.ModelAdmin):
    list_display  = ['pk', 'marina', 'truck', 'part', 'direction', 'quantity', 'transferred_by', 'transferred_at']
    list_filter   = ['direction', 'marina']
    search_fields = ['part__name', 'transferred_by']
    readonly_fields = ['transferred_at']
