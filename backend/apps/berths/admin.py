from django.contrib import admin
from .models import (
    Pier, Berth, MarinaMapConfig, Amenity, LogicalPier,
    # Track 2
    BerthScoreWeights, TemporaryDeparture, SubLetBooking,
    FleetAssignJob, DockWalkSession, DockWalkEntry,
    BerthAlert, BerthListing, BerthListingEnquiry,
)


@admin.register(Pier)
class PierAdmin(admin.ModelAdmin):
    list_display = ['code', 'marina', 'pier_type']
    list_filter = ['marina']


@admin.register(Berth)
class BerthAdmin(admin.ModelAdmin):
    list_display = ['code', 'pier', 'marina', 'status', 'vessel']
    list_filter = ['marina', 'status']


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
