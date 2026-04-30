from rest_framework import serializers
from .models import Invoice, Payment


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ['id', 'invoice', 'amount', 'method', 'paid_at']
        read_only_fields = ['id', 'paid_at']


class InvoiceSerializer(serializers.ModelSerializer):
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, default=None)
    member_name = serializers.CharField(source='member.name', read_only=True, default=None)
    payments = PaymentSerializer(many=True, read_only=True)

    class Meta:
        model = Invoice
        fields = [
            'id', 'vessel', 'vessel_name', 'member', 'member_name', 'booking',
            'invoice_type', 'amount', 'issued', 'due', 'status', 'payments',
        ]
        read_only_fields = ['id', 'vessel_name', 'member_name']
