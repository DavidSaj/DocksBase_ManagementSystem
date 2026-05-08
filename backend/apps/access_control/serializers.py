"""
apps/access_control/serializers.py

One serializer per model. Key behaviours:
- AccessEventSerializer computes cctv_cameras[].viewer_url and .copy_label.
- AccessCardSerializer validates max_cards_per_member limit from marina.features.
- ANPRCameraSerializer / VehicleRegistrationSerializer check anpr_enabled feature flag.
"""

from rest_framework import serializers

from apps.access_control.models import (
    AccessZone, AccessReader, ZoneAccessRule, AccessCard, AccessEvent,
    ANPRCamera, VehicleRegistration, ANPREvent, CCTVCamera,
    BiometricEnrolment, SpendAuthorisationRule, SpendAuthorisationRequest,
    FraudAnomalyAlert,
)


class AccessZoneSerializer(serializers.ModelSerializer):
    class Meta:
        model  = AccessZone
        fields = ['id', 'marina', 'name', 'description', 'is_restricted']
        read_only_fields = ['marina']


class AccessReaderSerializer(serializers.ModelSerializer):
    zone_name = serializers.CharField(source='zone.name', read_only=True, default=None)

    class Meta:
        model  = AccessReader
        fields = [
            'id', 'marina', 'zone', 'zone_name', 'reader_uid', 'location_label',
            'hardware_type', 'ip_address', 'last_heartbeat', 'is_active', 'notes',
        ]
        read_only_fields = ['marina', 'zone_name']


class ZoneAccessRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ZoneAccessRule
        fields = ['id', 'marina', 'member_type', 'zones', 'link_to_berth_pier', 'allowed_piers']
        read_only_fields = ['marina']


class CCTVCameraSerializer(serializers.ModelSerializer):
    zone_name = serializers.CharField(source='zone.name', read_only=True, default=None)

    class Meta:
        model  = CCTVCamera
        fields = [
            'id', 'marina', 'zone', 'zone_name', 'camera_uid', 'location_label',
            'nvr_ip', 'nvr_channel', 'viewer_url_template', 'is_active',
        ]
        read_only_fields = ['marina', 'zone_name']


class CCTVCameraEventSerializer(serializers.ModelSerializer):
    """Compact CCTV camera representation embedded in AccessEvent."""
    viewer_url = serializers.SerializerMethodField()
    copy_label = serializers.SerializerMethodField()

    class Meta:
        model  = CCTVCamera
        fields = ['id', 'camera_uid', 'location_label', 'viewer_url', 'copy_label']

    def get_viewer_url(self, obj):
        context    = self.context
        event      = context.get('event')
        if not obj.viewer_url_template or not event:
            return ''
        return obj.viewer_url_template.format(
            timestamp_iso=event.occurred_at.isoformat(),
            camera_uid=obj.camera_uid,
        )

    def get_copy_label(self, obj):
        context = self.context
        event   = context.get('event')
        if not event:
            return obj.camera_uid
        return f"{obj.camera_uid} @ {event.occurred_at:%Y-%m-%d %H:%M:%S}"


class AccessCardSerializer(serializers.ModelSerializer):
    member_name = serializers.CharField(source='member.name', read_only=True, default=None)

    class Meta:
        model  = AccessCard
        fields = [
            'id', 'marina', 'member', 'member_name', 'card_uid', 'facility_code', 'label',
            'sub_type', 'is_active', 'zones_override', 'valid_from', 'valid_to',
            'issued_at', 'deactivated_at', 'deactivation_reason',
        ]
        read_only_fields = ['marina', 'issued_at', 'deactivated_at', 'member_name']

    def validate(self, attrs):
        request = self.context.get('request')
        member  = attrs.get('member') or (self.instance.member if self.instance else None)

        if request and member:
            marina      = request.user.marina
            max_cards   = marina.features.get('max_cards_per_member', 4)
            qs          = AccessCard.objects.filter(member=member, is_active=True)
            if self.instance:
                qs = qs.exclude(pk=self.instance.pk)
            if qs.count() >= max_cards:
                raise serializers.ValidationError(
                    {'member': f"Member already has {max_cards} active card(s). Deactivate one first."}
                )
        return attrs


class AccessEventSerializer(serializers.ModelSerializer):
    cctv_cameras = serializers.SerializerMethodField()
    zone_name    = serializers.CharField(source='reader.zone.name', read_only=True, default=None)
    member_name  = serializers.CharField(source='member.name', read_only=True, default=None)

    class Meta:
        model  = AccessEvent
        fields = [
            'id', 'marina', 'reader', 'zone_name', 'credential_type', 'card', 'member',
            'member_name', 'raw_credential', 'granted', 'denial_reason', 'occurred_at', 'cctv_cameras',
        ]
        read_only_fields = fields

    def get_cctv_cameras(self, obj):
        cameras = obj.cctv_cameras.all()
        return CCTVCameraEventSerializer(
            cameras, many=True, context={**self.context, 'event': obj}
        ).data


class ANPRCameraSerializer(serializers.ModelSerializer):
    zone_name = serializers.CharField(source='zone.name', read_only=True, default=None)

    class Meta:
        model  = ANPRCamera
        fields = [
            'id', 'marina', 'zone', 'zone_name', 'camera_uid', 'location_label',
            'ip_address', 'last_frame_at', 'is_active',
        ]
        read_only_fields = ['marina', 'zone_name']

    def validate(self, attrs):
        request = self.context.get('request')
        if request and not request.user.marina.features.get('anpr_enabled', False):
            raise serializers.ValidationError("ANPR module not enabled for this marina.")
        return attrs


class VehicleRegistrationSerializer(serializers.ModelSerializer):
    member_name = serializers.CharField(source='member.name', read_only=True, default=None)

    class Meta:
        model  = VehicleRegistration
        fields = ['id', 'marina', 'member', 'member_name', 'plate_number', 'make', 'model', 'colour', 'is_active', 'registered_at']
        read_only_fields = ['marina', 'registered_at', 'member_name']

    def validate(self, attrs):
        request = self.context.get('request')
        if request and not request.user.marina.features.get('anpr_enabled', False):
            raise serializers.ValidationError("ANPR module not enabled for this marina.")
        return attrs


class ANPREventSerializer(serializers.ModelSerializer):
    matched_member_name = serializers.CharField(source='matched_member.name', read_only=True, default=None)

    class Meta:
        model  = ANPREvent
        fields = [
            'id', 'marina', 'camera', 'plate_detected', 'vehicle', 'matched_member',
            'matched_member_name', 'access_granted', 'confidence', 'occurred_at',
            'staff_reviewed', 'staff_reviewer',
        ]
        read_only_fields = ['id', 'marina', 'camera', 'plate_detected', 'vehicle', 'matched_member',
                            'matched_member_name', 'access_granted', 'confidence', 'occurred_at',
                            'staff_reviewer']


class BiometricEnrolmentSerializer(serializers.ModelSerializer):
    class Meta:
        model  = BiometricEnrolment
        fields = [
            'id', 'marina', 'subject_type', 'member', 'staff_member', 'terminal_uid',
            'consent_given_at', 'consent_ip', 'consent_method', 'enrolled_at',
            'revoked_at', 'pending_deletion', 'pending_deletion_since',
        ]
        read_only_fields = ['marina', 'enrolled_at', 'pending_deletion', 'pending_deletion_since']
        # template_handle is NEVER exposed in the API


class SpendAuthorisationRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model  = SpendAuthorisationRule
        fields = ['id', 'marina', 'role', 'action_type', 'threshold_amount', 'requires_approver_role']
        read_only_fields = ['marina']


class SpendAuthorisationRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model  = SpendAuthorisationRequest
        fields = [
            'id', 'marina', 'rule', 'action_type', 'amount', 'description',
            'requested_by', 'approver', 'status', 'requested_at', 'actioned_at',
            'approver_note', 'suspended_at', 'override_forced_by', 'override_forced_at',
            'override_fraud_alert', 'invoice', 'fuel_dock_entry',
        ]
        read_only_fields = [
            'marina', 'requested_at', 'actioned_at', 'suspended_at',
            'override_forced_at', 'override_fraud_alert',
        ]


class FraudAnomalyAlertSerializer(serializers.ModelSerializer):
    staff_member_name = serializers.CharField(source='staff_member.name', read_only=True, default=None)

    class Meta:
        model  = FraudAnomalyAlert
        fields = [
            'id', 'marina', 'alert_type', 'staff_member', 'staff_member_name', 'period_start', 'period_end',
            'event_count', 'total_amount', 'threshold_exceeded', 'sent_at',
            'resolved_at', 'resolved_by', 'resolution_note',
        ]
        read_only_fields = ['marina', 'sent_at', 'staff_member_name']
