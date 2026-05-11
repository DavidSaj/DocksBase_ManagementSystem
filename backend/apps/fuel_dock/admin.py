from django.contrib import admin
from .models import FuelDockEntry


@admin.register(FuelDockEntry)
class FuelDockEntryAdmin(admin.ModelAdmin):
    list_display = [
        'pk', 'marina', 'fuel_type', 'status', 'actual_litres',
        'is_internal_use', 'arrived_at', 'completed_at',
    ]
    list_filter  = ['marina', 'status', 'fuel_type', 'is_internal_use']
    search_fields = ['vessel__name', 'guest_description']
    list_editable = ['is_internal_use']
    readonly_fields = ['arrived_at']
