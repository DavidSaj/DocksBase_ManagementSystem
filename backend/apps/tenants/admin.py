from django.contrib import admin
from apps.tenants.models import CommercialUnit, TenantContact, Tenancy, TenancyDocument, RentScheduleEntry, TenancyTask


@admin.register(CommercialUnit)
class CommercialUnitAdmin(admin.ModelAdmin):
    list_display = ['unit_ref', 'marina', 'unit_type', 'area_m2', 'is_active']
    list_filter = ['marina', 'unit_type', 'is_active']
    search_fields = ['unit_ref']


@admin.register(TenantContact)
class TenantContactAdmin(admin.ModelAdmin):
    list_display = ['display_name', 'marina', 'is_company', 'email', 'phone']
    list_filter = ['marina', 'is_company']
    search_fields = ['display_name', 'company_name', 'email']


@admin.register(Tenancy)
class TenancyAdmin(admin.ModelAdmin):
    list_display = ['unit', 'tenant', 'marina', 'status', 'lease_start', 'lease_end', 'rent_amount', 'rent_frequency']
    list_filter = ['marina', 'status', 'rent_frequency']
    raw_id_fields = ['unit', 'tenant', 'rent_chargeable_item', 'deposit_chargeable_item', 'deposit_invoice']


@admin.register(TenancyDocument)
class TenancyDocumentAdmin(admin.ModelAdmin):
    list_display = ['tenancy', 'doc_type', 'expires_at', 'uploaded_at']
    list_filter = ['doc_type']


@admin.register(RentScheduleEntry)
class RentScheduleEntryAdmin(admin.ModelAdmin):
    list_display = ['tenancy', 'period_ref', 'due_date', 'amount', 'status', 'is_pro_rata']
    list_filter = ['status', 'is_pro_rata']


@admin.register(TenancyTask)
class TenancyTaskAdmin(admin.ModelAdmin):
    list_display = ['title', 'task_type', 'marina', 'status', 'due_date', 'assigned_to']
    list_filter = ['marina', 'task_type', 'status']
