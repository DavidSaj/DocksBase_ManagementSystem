from rest_framework import serializers

from .models import RefundAction, WaitlistEntry, WaitlistOffer


class WaitlistEntrySerializer(serializers.ModelSerializer):
    class Meta:
        model = WaitlistEntry
        fields = [
            'id', 'marina', 'applicant_name', 'applicant_email', 'applicant_phone',
            'vessel_type', 'vessel_loa_m', 'vessel_beam_m', 'vessel_draft_m',
            'pref_min_loa_m', 'pref_max_loa_m', 'pref_pier',
            'priority_score', 'deposit_amount_cents', 'deposit_state',
            'deposit_payment_intent_id', 'deposit_paid_at',
            'decline_count', 'status', 'applied_at', 'status_changed_at',
        ]
        read_only_fields = [
            'priority_score', 'deposit_state', 'deposit_payment_intent_id',
            'deposit_paid_at', 'decline_count', 'status',
            'applied_at', 'status_changed_at',
        ]


class WaitlistOfferSerializer(serializers.ModelSerializer):
    class Meta:
        model = WaitlistOffer
        fields = [
            'id', 'entry', 'offered_berth', 'magic_token',
            'offered_at', 'expires_at', 'outcome', 'responded_at', 'decline_reason',
        ]
        read_only_fields = fields


class RefundActionSerializer(serializers.ModelSerializer):
    class Meta:
        model = RefundAction
        fields = ['id', 'entry', 'amount_cents', 'reason', 'audit_note',
                  'created_at', 'completed_at', 'completed_by']
        read_only_fields = ['created_at', 'completed_at', 'completed_by']
