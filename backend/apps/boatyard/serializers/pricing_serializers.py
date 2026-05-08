"""
apps/boatyard/serializers/pricing_serializers.py
Track 5 — SupplierPriceFile, SupplierColumnMap, PartPriceHistory serializers.
"""

from rest_framework import serializers

from ..models import SupplierPriceFile, SupplierColumnMap, PartPriceHistory


class SupplierPriceFileSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierPriceFile
        fields = [
            'id', 'supplier_name', 'import_format',
            'file_url', 'api_endpoint', 'flag_threshold_pct',
            'status', 'rows_processed', 'rows_updated', 'rows_flagged',
            'error_detail', 'imported_by', 'queued_at', 'completed_at',
        ]
        read_only_fields = [
            'status', 'rows_processed', 'rows_updated', 'rows_flagged',
            'error_detail', 'queued_at', 'completed_at',
        ]


class SupplierColumnMapSerializer(serializers.ModelSerializer):
    class Meta:
        model = SupplierColumnMap
        fields = [
            'id', 'supplier_name', 'mapping', 'updated_at',
        ]
        read_only_fields = ['updated_at']


class PartPriceHistorySerializer(serializers.ModelSerializer):
    part_name = serializers.CharField(source='part.name', read_only=True)

    class Meta:
        model = PartPriceHistory
        fields = [
            'id', 'part', 'part_name', 'price_file',
            'old_unit_cost', 'new_unit_cost', 'change_pct',
            'is_flagged', 'applied', 'recorded_at',
        ]
        read_only_fields = ['recorded_at']
