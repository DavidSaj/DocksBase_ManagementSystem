from rest_framework import serializers
from .models import Invoice, InvoiceLineItem, Payment


class InvoiceLineItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = InvoiceLineItem
        fields = ['id', 'description', 'quantity', 'unit_price', 'total_price']


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ['id', 'method', 'amount', 'paid_at']
        read_only_fields = ['id', 'paid_at']


class InvoiceSerializer(serializers.ModelSerializer):
    items = InvoiceLineItemSerializer(many=True, read_only=True)
    payments = PaymentSerializer(many=True, read_only=True)
    member_name = serializers.CharField(source='member.name', read_only=True, default=None)

    class Meta:
        model = Invoice
        fields = [
            'id', 'invoice_number', 'status', 'source_type', 'source_id',
            'member', 'member_name', 'subtotal', 'vat_rate', 'tax_total', 'total',
            'due_date', 'paid_at', 'created_at',
            'items', 'payments',
        ]
        read_only_fields = [
            'id', 'invoice_number', 'subtotal', 'tax_total', 'total',
            'paid_at', 'created_at',
        ]
