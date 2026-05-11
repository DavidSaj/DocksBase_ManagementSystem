"""
apps/access_control/admin.py

Admin registrations for all 13 access_control models.

Key rules:
- AccessEvent and ANPREvent are read-only audit logs — no add/change permissions.
- BiometricEnrolment.template_handle is NEVER displayed (privacy/security).
- Uses all_objects manager for BiometricEnrolment so pending_deletion rows are visible in admin.
"""

from django.contrib import admin

from apps.access_control.models import (
    AccessZone, AccessReader, ZoneAccessRule, AccessCard, AccessEvent,
    ANPRCamera, VehicleRegistration, ANPREvent, CCTVCamera,
    BiometricEnrolment, SpendAuthorisationRule, SpendAuthorisationRequest,
    FraudAnomalyAlert,
)


@admin.register(AccessZone)
class AccessZoneAdmin(admin.ModelAdmin):
    list_display  = ['name', 'marina', 'is_restricted']
    list_filter   = ['marina', 'is_restricted']
    search_fields = ['name', 'marina__name']


@admin.register(AccessReader)
class AccessReaderAdmin(admin.ModelAdmin):
    list_display  = ['location_label', 'zone', 'hardware_type', 'is_active', 'last_heartbeat']
    list_filter   = ['marina', 'hardware_type', 'is_active']
    search_fields = ['reader_uid', 'location_label']


@admin.register(ZoneAccessRule)
class ZoneAccessRuleAdmin(admin.ModelAdmin):
    list_display = ['marina', 'member_type', 'link_to_berth_pier']
    list_filter  = ['marina', 'member_type', 'link_to_berth_pier']
    filter_horizontal = ['zones']


@admin.register(AccessCard)
class AccessCardAdmin(admin.ModelAdmin):
    list_display   = ['member', 'card_uid', 'sub_type', 'is_active', 'valid_from', 'valid_to']
    list_filter    = ['is_active', 'marina', 'sub_type']
    search_fields  = ['card_uid', 'member__name']
    readonly_fields = ['issued_at', 'deactivated_at']


@admin.register(AccessEvent)
class AccessEventAdmin(admin.ModelAdmin):
    list_display  = ['occurred_at', 'reader', 'credential_type', 'granted', 'member']
    list_filter   = ['granted', 'credential_type', 'marina']
    readonly_fields = [f.name for f in AccessEvent._meta.get_fields() if not f.many_to_many and hasattr(f, 'column')]
    # Immutable log — disable add and change
    def has_add_permission(self, request):
        return False
    def has_change_permission(self, request, obj=None):
        return False


@admin.register(ANPRCamera)
class ANPRCameraAdmin(admin.ModelAdmin):
    list_display = ['location_label', 'marina', 'camera_uid', 'is_active', 'last_frame_at']
    list_filter  = ['marina', 'is_active']


@admin.register(VehicleRegistration)
class VehicleRegistrationAdmin(admin.ModelAdmin):
    list_display  = ['plate_number', 'member', 'make', 'model', 'colour', 'is_active']
    list_filter   = ['marina', 'is_active']
    search_fields = ['plate_number', 'member__name']


@admin.register(ANPREvent)
class ANPREventAdmin(admin.ModelAdmin):
    list_display  = ['occurred_at', 'plate_detected', 'matched_member', 'access_granted', 'confidence', 'staff_reviewed']
    list_filter   = ['access_granted', 'staff_reviewed', 'marina']
    readonly_fields = [f.name for f in ANPREvent._meta.get_fields() if not f.many_to_many and hasattr(f, 'column')]
    def has_add_permission(self, request):
        return False
    def has_change_permission(self, request, obj=None):
        return False


@admin.register(CCTVCamera)
class CCTVCameraAdmin(admin.ModelAdmin):
    list_display = ['location_label', 'marina', 'camera_uid', 'zone', 'is_active']
    list_filter  = ['marina', 'is_active']


@admin.register(BiometricEnrolment)
class BiometricEnrolmentAdmin(admin.ModelAdmin):
    list_display  = ['subject_type', 'terminal_uid', 'enrolled_at', 'pending_deletion']
    list_filter   = ['subject_type', 'pending_deletion', 'marina']
    readonly_fields = [
        'terminal_uid', 'consent_given_at', 'consent_ip', 'consent_method',
        'enrolled_at', 'revoked_at', 'pending_deletion', 'pending_deletion_since',
        # template_handle is intentionally NOT listed — never display raw biometric handle
    ]

    def get_queryset(self, request):
        # Use all_objects so pending_deletion rows are visible in admin
        return BiometricEnrolment.all_objects.all()


@admin.register(SpendAuthorisationRule)
class SpendAuthorisationRuleAdmin(admin.ModelAdmin):
    list_display = ['marina', 'role', 'action_type', 'threshold_amount', 'requires_approver_role']
    list_filter  = ['marina', 'role', 'action_type']


@admin.register(SpendAuthorisationRequest)
class SpendAuthorisationRequestAdmin(admin.ModelAdmin):
    list_display   = ['pk', 'marina', 'action_type', 'amount', 'status', 'requested_by', 'requested_at']
    list_filter    = ['status', 'action_type', 'marina']
    readonly_fields = ['requested_at', 'actioned_at', 'suspended_at', 'override_forced_at']


@admin.register(FraudAnomalyAlert)
class FraudAnomalyAlertAdmin(admin.ModelAdmin):
    list_display  = ['marina', 'alert_type', 'staff_member', 'sent_at', 'resolved_at']
    list_filter   = ['alert_type', 'marina']
    readonly_fields = ['sent_at']
