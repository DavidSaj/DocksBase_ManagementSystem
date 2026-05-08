from django.contrib import admin
from .models import VesselMovement


@admin.register(VesselMovement)
class VesselMovementAdmin(admin.ModelAdmin):
    list_display = [
        'movement_type', 'vessel', 'berth_from', 'berth_to',
        'scheduled_at', 'actual_at', 'completed',
    ]
    list_filter  = ['marina', 'movement_type', 'completed']
    readonly_fields = [
        'marina', 'vessel', 'movement_type', 'berth_from', 'berth_to',
        'booking', 'departure', 'scheduled_at', 'actual_at', 'completed',
        'heading', 'notes', 'recorded_by', 'created_at',
    ]

    def has_delete_permission(self, request, obj=None):
        # Movement records are immutable audit logs — no deletion allowed.
        return False

    def has_change_permission(self, request, obj=None):
        # The 'complete' action is handled via the API only.
        return False
