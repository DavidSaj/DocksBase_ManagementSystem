from rest_framework import serializers
from .models import Invoice, InvoiceLineItem, Payment, ChargeableItem


class ChargeableItemSerializer(serializers.ModelSerializer):
    pricing_model_display = serializers.CharField(source='get_pricing_model_display', read_only=True)
    category_display      = serializers.CharField(source='get_category_display',      read_only=True)

    class Meta:
        model  = ChargeableItem
        fields = [
            'id', 'name', 'category', 'category_display',
            'pricing_model', 'pricing_model_display',
            'unit_price', 'tax_rate', 'is_active',
            'show_in_pos', 'fuel_dock_type',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'pricing_model_display', 'category_display']


class InvoiceLineItemSerializer(serializers.ModelSerializer):
    line_subtotal = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    line_tax      = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)
    line_total    = serializers.DecimalField(max_digits=10, decimal_places=2, read_only=True)

    class Meta:
        model  = InvoiceLineItem
        fields = [
            'id', 'description', 'quantity', 'unit_price', 'tax_rate',
            'total_price', 'line_subtotal', 'line_tax', 'line_total',
        ]


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
            'billing_period', 'due_date', 'paid_at', 'created_at',
            'items', 'payments',
        ]
        read_only_fields = [
            'id', 'invoice_number', 'subtotal', 'tax_total', 'total',
            'paid_at', 'created_at',
        ]
