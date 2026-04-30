from rest_framework import serializers
from apps.billing.models import Invoice
from .models import AbsenceReport, CraneRequest


class PortalInvoiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = Invoice
        fields = ['id', 'invoice_type', 'amount', 'issued', 'due', 'status']


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
