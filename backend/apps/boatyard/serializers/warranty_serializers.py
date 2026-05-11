"""
apps/boatyard/serializers/warranty_serializers.py
Track 5 — WarrantyAgreement and WarrantyClaim serializers.
"""

from rest_framework import serializers

from ..models import WarrantyAgreement, WarrantyClaim


class WarrantyAgreementSerializer(serializers.ModelSerializer):
    class Meta:
        model = WarrantyAgreement
        fields = [
            'id', 'manufacturer_name', 'contact_name', 'contact_email',
            'contact_phone', 'covers_parts', 'covers_labour',
            'labour_rate_cap', 'reimbursement_rate_pct',
            'avg_processing_days', 'submission_instructions',
            'pdf_template_url', 'is_active', 'created_at',
        ]
        read_only_fields = ['created_at']


class WarrantyClaimSerializer(serializers.ModelSerializer):
    variance = serializers.DecimalField(
        max_digits=12, decimal_places=2,
        read_only=True, source='variance',
        allow_null=True,
    )
    # Expose manufacturer name from the linked agreement for display
    manufacturer_name = serializers.CharField(
        source='agreement.manufacturer_name', read_only=True
    )

    class Meta:
        model = WarrantyClaim
        fields = [
            'id', 'agreement', 'work_order', 'claim_reference',
            'parts_claimed', 'labour_claimed', 'total_claimed',
            'amount_reimbursed', 'status',
            'submitted_at', 'reimbursed_at',
            'claim_document_url', 'journal_entry',
            'notes', 'variance', 'manufacturer_name',
        ]
        read_only_fields = [
            'submitted_at', 'reimbursed_at',
            'claim_document_url', 'journal_entry', 'variance', 'manufacturer_name',
        ]
