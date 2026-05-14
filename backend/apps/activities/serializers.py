from rest_framework import serializers

from .models import (
    Activity,
    ActivityBooking,
    ActivityBookingExtra,
    ActivityBookingParticipant,
    ActivityExtra,
    ActivityPricingRule,
    ActivityResourceRequirement,
    ActivityTimeSlot,
    AssetReservation,
    CancellationPolicy,
)


class CancellationPolicySerializer(serializers.ModelSerializer):
    class Meta:
        model = CancellationPolicy
        fields = [
            'id', 'name', 'full_refund_hours', 'partial_refund_hours',
            'partial_refund_pct', 'is_default',
        ]
        read_only_fields = ['id']


class ActivityPricingRuleSerializer(serializers.ModelSerializer):
    chargeable_item_name = serializers.CharField(
        source='chargeable_item.name', read_only=True
    )
    unit_price = serializers.DecimalField(
        source='chargeable_item.unit_price', max_digits=10, decimal_places=2, read_only=True
    )

    class Meta:
        model = ActivityPricingRule
        fields = ['id', 'customer_type', 'chargeable_item', 'chargeable_item_name', 'unit_price']
        read_only_fields = ['id']


class ActivityResourceRequirementSerializer(serializers.ModelSerializer):
    activity_name = serializers.CharField(source='activity.name', read_only=True)

    class Meta:
        model = ActivityResourceRequirement
        fields = [
            'id', 'activity', 'activity_name', 'resource_type', 'required_role',
            'staff_member', 'asset', 'quantity_required',
        ]
        read_only_fields = ['id', 'activity_name']


class ActivityExtraSerializer(serializers.ModelSerializer):
    chargeable_item_name = serializers.CharField(
        source='chargeable_item.name', read_only=True
    )
    unit_price = serializers.DecimalField(
        source='chargeable_item.unit_price', max_digits=10, decimal_places=2, read_only=True
    )

    class Meta:
        model = ActivityExtra
        fields = ['id', 'name', 'chargeable_item', 'chargeable_item_name', 'unit_price', 'is_active']
        read_only_fields = ['id']


class ActivitySerializer(serializers.ModelSerializer):
    pricing_rules         = ActivityPricingRuleSerializer(many=True, read_only=True)
    resource_requirements = ActivityResourceRequirementSerializer(many=True, read_only=True)
    extras                = ActivityExtraSerializer(many=True, read_only=True)
    cancellation_policy_name = serializers.CharField(
        source='cancellation_policy.name', read_only=True, allow_null=True
    )

    class Meta:
        model = Activity
        fields = [
            'id', 'name', 'description', 'category', 'duration_minutes',
            'capacity_min', 'capacity_max', 'min_age', 'photo', 'is_active',
            'season_start', 'season_end',
            'group_discount_threshold', 'group_discount_pct',
            'cancellation_policy', 'cancellation_policy_name',
            'pricing_rules', 'resource_requirements', 'extras',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class ActivityBookingParticipantSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityBookingParticipant
        fields = ['id', 'name', 'age', 'customer_type']
        read_only_fields = ['id']


class ActivityBookingExtraSerializer(serializers.ModelSerializer):
    extra_name = serializers.CharField(source='extra.name', read_only=True)

    class Meta:
        model = ActivityBookingExtra
        fields = ['id', 'extra', 'extra_name', 'quantity']
        read_only_fields = ['id']


class ActivityBookingSerializer(serializers.ModelSerializer):
    """
    Read representation: nested participants and extras.
    Write (create) payload: accepts 'participants' and 'extras' as write-only lists.
    The actual creation of participants, extras, and invoice is handled by
    book_activity_session() in perform_create().
    """
    participants  = ActivityBookingParticipantSerializer(many=True, read_only=True)
    booking_extras = ActivityBookingExtraSerializer(many=True, read_only=True)

    # Write-only fields for creation payload
    participants_input = serializers.ListField(
        child=serializers.DictField(), write_only=True, required=False,
        help_text='List of {name, age, customer_type} dicts.',
    )
    extras_input = serializers.ListField(
        child=serializers.DictField(), write_only=True, required=False,
        help_text='List of {extra_id, quantity} dicts.',
    )

    activity_name  = serializers.CharField(source='activity.name', read_only=True)
    invoice_number = serializers.CharField(
        source='invoice.invoice_number', read_only=True, allow_null=True
    )
    assigned_instructor_name = serializers.CharField(
        source='assigned_instructor.name', read_only=True, allow_null=True
    )

    class Meta:
        model = ActivityBooking
        fields = [
            'id', 'marina', 'activity', 'activity_name',
            'member', 'lead_name', 'lead_email', 'lead_phone',
            'start_datetime', 'end_datetime',
            'participant_count', 'status', 'payment_mode', 'season_override',
            'assigned_instructor', 'assigned_instructor_name',
            'invoice', 'invoice_number',
            'cancelled_at', 'cancellation_reason', 'refund_amount',
            'expires_at', 'notes', 'created_at',
            'participants', 'booking_extras',
            'participants_input', 'extras_input',
        ]
        read_only_fields = [
            'id', 'marina', 'end_datetime', 'status',
            'cancelled_at', 'refund_amount', 'expires_at', 'created_at',
            'participants', 'booking_extras',
            'activity_name', 'invoice_number', 'assigned_instructor_name',
        ]


class AssetReservationSerializer(serializers.ModelSerializer):
    class Meta:
        model = AssetReservation
        fields = ['id', 'marina', 'asset', 'activity_booking', 'time_range']
        read_only_fields = ['id']


class ActivityTimeSlotSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivityTimeSlot
        fields = ['id', 'activity', 'weekday', 'start_time', 'is_active']
        read_only_fields = ['id']
