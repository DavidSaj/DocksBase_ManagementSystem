"""
apps/sustainability/serializers.py

One serializer per model. Key behaviours:
- WasteLogSerializer.to_internal_value() pops 'unit' from input (model derives it).
- SustainabilityLedgerSerializer adds computed _tco2e fields (÷ 1000) and null-safe intensity metrics.
- Scope1RecordSerializer.validate() rejects client-supplied co2e_kg.
- EmissionFactorViewSet.destroy() catches ProtectedError → 409 (in views.py, not here).
"""

from decimal import Decimal

from rest_framework import serializers

from apps.sustainability.models import (
    EmissionFactor, GridCarbonIntensity, Scope1Record, Scope2Record, Scope3Record,
    WasteLog, SustainabilityLedger, OffsetContribution, ESGReportArchive, PlayItGreenSync,
)


class EmissionFactorSerializer(serializers.ModelSerializer):
    class Meta:
        model  = EmissionFactor
        fields = [
            'id', 'marina', 'energy_type', 'kg_co2e_per_unit', 'unit', 'jurisdiction',
            'valid_from', 'valid_to', 'source', 'source_url', 'created_at',
        ]
        read_only_fields = ['marina', 'created_at']


class GridCarbonIntensitySerializer(serializers.ModelSerializer):
    class Meta:
        model  = GridCarbonIntensity
        fields = [
            'id', 'marina', 'grid_source', 'region_code', 'valid_date',
            'kg_co2e_per_kwh', 'is_manual_override', 'fetched_at',
        ]
        read_only_fields = ['marina', 'fetched_at']


class Scope1RecordSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Scope1Record
        fields = [
            'id', 'marina', 'source', 'fuel_type', 'quantity', 'unit', 'date',
            'emission_factor', 'co2e_kg', 'notes', 'ap_reference', 'created_at', 'updated_at',
        ]
        read_only_fields = ['marina', 'unit', 'co2e_kg', 'created_at', 'updated_at']

    def validate(self, attrs):
        # co2e_kg is always server-computed; reject if client supplies it
        if 'co2e_kg' in self.initial_data:
            raise serializers.ValidationError({'co2e_kg': 'This field is computed server-side and cannot be set directly.'})
        return attrs


class Scope2RecordSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Scope2Record
        fields = [
            'id', 'marina', 'period', 'kwh_consumed', 'grid_intensity',
            'kg_co2e_per_kwh_used', 'co2e_kg', 'data_source', 'notes', 'calculated_at',
        ]
        read_only_fields = ['marina', 'calculated_at']


class Scope3RecordSerializer(serializers.ModelSerializer):
    class Meta:
        model  = Scope3Record
        fields = [
            'id', 'marina', 'period', 'category', 'fuel_type', 'quantity', 'unit',
            'emission_factor', 'co2e_kg', 'data_source', 'source_reference',
            'distance_km', 'spend_amount', 'notes', 'created_at', 'updated_at',
        ]
        read_only_fields = ['marina', 'created_at', 'updated_at']


class WasteLogSerializer(serializers.ModelSerializer):
    class Meta:
        model  = WasteLog
        fields = [
            'id', 'marina', 'date', 'category', 'quantity', 'unit',
            'disposal_method', 'waste_carrier', 'carrier_licence_ref',
            'disposal_note', 'logged_by', 'created_at',
        ]
        read_only_fields = ['marina', 'unit', 'created_at']

    def to_internal_value(self, data):
        # Silently discard client-supplied unit — model.save() derives it from category
        data = data.copy()
        data.pop('unit', None)
        return super().to_internal_value(data)


def _tco2e(kg_value):
    """Convert kg to tCO₂e, 3 decimal places, returns None when input is None."""
    if kg_value is None:
        return None
    return round(float(kg_value) / 1000, 3)


class SustainabilityLedgerSerializer(serializers.ModelSerializer):
    # Computed tCO₂e fields (not stored; derived on read)
    scope1_tco2e  = serializers.SerializerMethodField()
    scope2_tco2e  = serializers.SerializerMethodField()
    scope3_tco2e  = serializers.SerializerMethodField()
    total_tco2e   = serializers.SerializerMethodField()

    class Meta:
        model  = SustainabilityLedger
        fields = [
            'id', 'marina', 'period',
            'scope1_co2e_kg', 'scope2_co2e_kg', 'scope3_co2e_kg', 'total_co2e_kg',
            'scope1_tco2e', 'scope2_tco2e', 'scope3_tco2e', 'total_tco2e',
            'revenue_gbp', 'berth_nights',
            'co2e_kg_per_gbp_revenue', 'co2e_kg_per_berth_night',
            'offset_co2e_kg', 'computed_at', 'is_stale',
        ]
        read_only_fields = fields

    def get_scope1_tco2e(self, obj):
        return _tco2e(obj.scope1_co2e_kg)

    def get_scope2_tco2e(self, obj):
        return _tco2e(obj.scope2_co2e_kg)

    def get_scope3_tco2e(self, obj):
        return _tco2e(obj.scope3_co2e_kg)

    def get_total_tco2e(self, obj):
        return _tco2e(obj.total_co2e_kg)


class OffsetContributionSerializer(serializers.ModelSerializer):
    class Meta:
        model  = OffsetContribution
        fields = [
            'id', 'marina', 'booking', 'invoice_line_item', 'partner',
            'amount_gbp', 'local_currency_amount', 'local_currency_code',
            'exchange_rate_used', 'units_purchased', 'unit_type',
            'certificate_url', 'pig_contribution_id', 'co2e_offset_kg',
            'synced_at', 'created_at',
        ]
        read_only_fields = ['marina', 'created_at']


class ESGReportArchiveSerializer(serializers.ModelSerializer):
    class Meta:
        model  = ESGReportArchive
        fields = [
            'id', 'marina', 'period_from', 'period_to', 'framework',
            'status', 'pdf_file', 'celery_task_id', 'error_detail',
            'generated_at', 'generated_by', 'created_at',
        ]
        read_only_fields = ['marina', 'status', 'pdf_file', 'celery_task_id', 'error_detail', 'generated_at', 'created_at']


class PlayItGreenSyncSerializer(serializers.ModelSerializer):
    class Meta:
        model  = PlayItGreenSync
        fields = ['id', 'marina', 'direction', 'status', 'records_count', 'total_gbp', 'error_detail', 'synced_at']
        read_only_fields = fields
