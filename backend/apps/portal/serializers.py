from rest_framework import serializers
from apps.billing.models import Invoice
from .models import AbsenceReport, CraneRequest


class PortalInvoiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Invoice
        fields = ['id', 'invoice_number', 'status', 'source_type', 'subtotal', 'total', 'due_date', 'paid_at', 'created_at']


class AbsenceReportSerializer(serializers.ModelSerializer):
    class Meta:
        model = AbsenceReport
        fields = ['id', 'absence_type', 'departure', 'return_date', 'notes', 'created_at']
        read_only_fields = ['id', 'created_at']

    def validate(self, data):
        departure = data.get('departure')
        return_date = data.get('return_date')
        if departure and return_date and return_date < departure:
            raise serializers.ValidationError({'return_date': 'Return date must be on or after the departure date.'})
        return data


class CraneRequestSerializer(serializers.ModelSerializer):
    class Meta:
        model = CraneRequest
        fields = ['id', 'service_type', 'requested_date', 'notes', 'status', 'created_at']
        read_only_fields = ['id', 'status', 'created_at']


class CraneRequestStaffSerializer(serializers.ModelSerializer):
    member_name = serializers.CharField(source='member.name', read_only=True)

    class Meta:
        model = CraneRequest
        fields = ['id', 'member_name', 'service_type', 'requested_date', 'notes', 'status', 'created_at']
        read_only_fields = ['id', 'member_name', 'service_type', 'requested_date', 'notes', 'created_at']
