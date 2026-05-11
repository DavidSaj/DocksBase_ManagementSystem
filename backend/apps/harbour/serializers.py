from rest_framework import serializers

from apps.harbour.models import (
    CommercialMovement,
    HarbourDueInvoice,
    HarbourTariff,
    PortStateControlRecord,
    ShippingAgent,
)


class ShippingAgentSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShippingAgent
        fields = [
            'id', 'marina', 'name', 'contact_name', 'email', 'phone',
            'address', 'vat_number', 'notes', 'is_active', 'created_at',
        ]
        read_only_fields = ['marina', 'created_at']


class HarbourTariffSerializer(serializers.ModelSerializer):
    due_type_display    = serializers.CharField(source='get_due_type_display', read_only=True)
    vessel_type_display = serializers.CharField(source='get_vessel_type_display', read_only=True)

    class Meta:
        model = HarbourTariff
        fields = [
            'id', 'marina', 'due_type', 'due_type_display',
            'vessel_type', 'vessel_type_display',
            'chargeable_item', 'base_fee', 'multiplier_fee',
            'flag_state', 'min_gt', 'max_gt',
            'effective_from', 'effective_to', 'is_active', 'notes',
        ]
        read_only_fields = ['marina']

    def validate(self, data):
        chargeable_item = data.get('chargeable_item') or (
            self.instance.chargeable_item if self.instance else None
        )
        if chargeable_item and chargeable_item.category != 'harbour_tariff':
            raise serializers.ValidationError(
                {"chargeable_item": "chargeable_item must have category='harbour_tariff'."}
            )
        min_gt = data.get('min_gt')
        max_gt = data.get('max_gt')
        if min_gt is not None and max_gt is not None and min_gt >= max_gt:
            raise serializers.ValidationError({'max_gt': 'max_gt must be greater than min_gt.'})
        return data


class HarbourDueInvoiceSerializer(serializers.ModelSerializer):
    due_type_display = serializers.CharField(source='get_due_type_display', read_only=True)

    class Meta:
        model = HarbourDueInvoice
        fields = [
            'id', 'marina', 'movement', 'due_type', 'due_type_display',
            'tariff', 'quantity', 'calculated_amount', 'invoice', 'created_at',
        ]
        read_only_fields = ['marina', 'created_at']


class CommercialMovementSerializer(serializers.ModelSerializer):
    status_display      = serializers.CharField(source='get_status_display', read_only=True)
    vessel_type_display = serializers.CharField(source='get_vessel_type_display', read_only=True)
    shipping_agent_name = serializers.CharField(source='shipping_agent.name', read_only=True, default=None)
    due_invoices        = HarbourDueInvoiceSerializer(many=True, read_only=True)

    class Meta:
        model = CommercialMovement
        fields = [
            'id', 'marina', 'vessel_name', 'imo_number', 'flag',
            'vessel_type', 'vessel_type_display',
            'gross_tonnage', 'net_tonnage',
            'cargo_type', 'cargo_weight_mt',
            'crew_count', 'passenger_count',
            'port_of_origin', 'next_port',
            'shipping_agent', 'shipping_agent_name',
            'agent_name', 'agent_email',
            'berth_assigned', 'berth_label',
            'eta', 'etd', 'actual_arrival', 'actual_departure',
            'pilotage_distance_nm', 'tug_duration_hours',
            'status', 'status_display', 'psc_flag', 'notes',
            'created_at', 'due_invoices',
        ]
        read_only_fields = ['marina', 'created_at', 'due_invoices']


class PortStateControlRecordSerializer(serializers.ModelSerializer):
    outcome_display = serializers.CharField(source='get_outcome_display', read_only=True)
    vessel_name     = serializers.CharField(source='movement.vessel_name', read_only=True)

    class Meta:
        model = PortStateControlRecord
        fields = [
            'id', 'marina', 'movement', 'vessel_name',
            'inspection_date', 'inspector_name', 'authority',
            'outcome', 'outcome_display',
            'deficiency_codes', 'rectification_deadline',
            'notes', 'created_at',
        ]
        read_only_fields = ['marina', 'created_at']
