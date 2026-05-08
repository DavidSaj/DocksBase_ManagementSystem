from django.contrib import admin

from .models import (
    ChecklistItem,
    ConsumableStock,
    ConsumableUsage,
    HousekeepingTask,
    LinenInventory,
    LinenSet,
    TaskChecklistCompletion,
    TaskPhoto,
)


class TaskChecklistCompletionInline(admin.TabularInline):
    model = TaskChecklistCompletion
    extra = 0


class TaskPhotoInline(admin.TabularInline):
    model = TaskPhoto
    extra = 0


class ConsumableUsageInline(admin.TabularInline):
    model = ConsumableUsage
    extra = 0
    readonly_fields = ['recorded_at']


@admin.register(HousekeepingTask)
class HousekeepingTaskAdmin(admin.ModelAdmin):
    list_display  = [
        'pk', 'unit_label', 'unit_type', 'status', 'priority',
        'assigned_to', 'target_ready_by',
    ]
    list_filter   = ['status', 'priority', 'unit_type', 'source_type']
    search_fields = ['unit_label', 'unit_id']
    inlines       = [TaskChecklistCompletionInline, TaskPhotoInline, ConsumableUsageInline]
    readonly_fields = ['triggered_at', 'started_at', 'completed_at']


@admin.register(LinenInventory)
class LinenInventoryAdmin(admin.ModelAdmin):
    list_display  = ['marina', 'linen_set', 'qty_clean', 'qty_dirty', 'qty_total',
                     'laundry_threshold', 'updated_at']
    list_filter   = ['marina']
    readonly_fields = ['updated_at']


@admin.register(ChecklistItem)
class ChecklistItemAdmin(admin.ModelAdmin):
    list_display = ['text', 'unit_type', 'order', 'is_active', 'marina']
    list_filter  = ['unit_type', 'is_active']


@admin.register(LinenSet)
class LinenSetAdmin(admin.ModelAdmin):
    list_display = ['name', 'marina', 'is_active']
    list_filter  = ['is_active']


@admin.register(ConsumableStock)
class ConsumableStockAdmin(admin.ModelAdmin):
    list_display = ['name', 'marina', 'qty_on_hand', 'low_stock_alert', 'unit', 'is_active']
    list_filter  = ['is_active']


admin.site.register(ConsumableUsage)
