from django.contrib import admin
from .models import (
    Pier, Berth, MarinaMapConfig, Amenity, LogicalPier,
    BerthCategory,
    # Track 2
    BerthScoreWeights, TemporaryDeparture, SubLetBooking,
    FleetAssignJob, DockWalkSession, DockWalkEntry,
    BerthAlert, BerthListing, BerthListingEnquiry,
)


@admin.register(Pier)
class PierAdmin(admin.ModelAdmin):
    list_display = ['code', 'marina', 'pier_type']
    list_filter = ['marina']


class BerthInline(admin.TabularInline):
    model = Berth
    fields = ['code', 'berth_class', 'status', 'length_m', 'max_beam_m']
    extra = 0
    show_change_link = True


@admin.register(BerthCategory)
class BerthCategoryAdmin(admin.ModelAdmin):
    list_display  = ['name', 'marina', 'mooring_type', 'sort_order', 'is_active', 'berth_count']
    list_filter   = ['marina', 'is_active', 'mooring_type']
    ordering      = ['marina', 'sort_order']
    inlines       = [BerthInline]
    fieldsets = [
        (None, {'fields': ['marina', 'name', 'tagline', 'is_active', 'sort_order']}),
        ('Content', {'fields': ['description', 'highlights'], 'description': 'highlights: JSON list of short bullet strings, e.g. ["Shore power included", "Bow-to mooring"]'}),
        ('Berth type', {'fields': ['mooring_type', 'amenities']}),
        ('Pricing', {'fields': ['pricing_tier']}),
    ]

    def berth_count(self, obj):
        return obj.berths.count()
    berth_count.short_description = 'Berths'


@admin.register(Berth)
class BerthAdmin(admin.ModelAdmin):
    list_display = ['code', 'pier', 'marina', 'berth_class', 'status', 'category', 'length_m', 'vessel']
    list_filter  = ['marina', 'status', 'berth_class', 'category']


@admin.register(Amenity)
class AmenityAdmin(admin.ModelAdmin):
    list_display = ['type', 'label', 'marina']
    list_filter = ['marina', 'type']


@admin.register(MarinaMapConfig)
class MarinaMapConfigAdmin(admin.ModelAdmin):
    list_display = ['marina', 'updated_at']


@admin.register(LogicalPier)
class LogicalPierAdmin(admin.ModelAdmin):
    list_display = ['name', 'marina', 'pier_type']
    list_filter = ['marina', 'pier_type']


# ── Track 2 — Berth Intelligence ──────────────────────────────────────────────

@admin.register(BerthScoreWeights)
class BerthScoreWeightsAdmin(admin.ModelAdmin):
    list_display = ['marina', 'w_size_fit', 'w_gap_min', 'w_amenity_match', 'w_pier_cluster', 'updated_at']


@admin.register(TemporaryDeparture)
class TemporaryDepartureAdmin(admin.ModelAdmin):
    list_display  = ['berth', 'vessel', 'depart_date', 'expected_return', 'status', 'sublet_enabled']
    list_filter   = ['marina', 'status']
    date_hierarchy = 'depart_date'


@admin.register(SubLetBooking)
class SubLetBookingAdmin(admin.ModelAdmin):
    list_display = ['booking', 'departure', 'total_revenue', 'holder_share', 'credit_applied_at', 'inventory_collision']
    list_filter  = ['marina', 'inventory_collision']


@admin.register(BerthAlert)
class BerthAlertAdmin(admin.ModelAdmin):
    list_display = ['alert_type', 'status', 'vessel', 'berth', 'created_at']
    list_filter  = ['marina', 'alert_type', 'status']
    date_hierarchy = 'created_at'


@admin.register(FleetAssignJob)
class FleetAssignJobAdmin(admin.ModelAdmin):
    list_display    = ['pk', 'marina', 'status', 'created_by', 'created_at', 'completed_at']
    list_filter     = ['marina', 'status']
    readonly_fields = ['request_payload', 'result_payload', 'celery_task_id', 'error_detail']


@admin.register(DockWalkSession)
class DockWalkSessionAdmin(admin.ModelAdmin):
    list_display = ['pier', 'walked_by', 'started_at', 'finished_at']
    list_filter  = ['marina']
    date_hierarchy = 'started_at'


@admin.register(DockWalkEntry)
class DockWalkEntryAdmin(admin.ModelAdmin):
    list_display = ['session', 'berth', 'observed_occupancy', 'discrepancy', 'observed_at']
    list_filter  = ['marina', 'discrepancy']


@admin.register(BerthListing)
class BerthListingAdmin(admin.ModelAdmin):
    list_display = ['berth', 'seller_member', 'asking_price', 'status', 'listed_at']
    list_filter  = ['marina', 'status']


admin.site.register(BerthListingEnquiry)
