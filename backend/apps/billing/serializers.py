from rest_framework import serializers
from .models import Invoice, InvoiceLineItem, Payment, ChargeableItem


class ChargeableItemSerializer(serializers.ModelSerializer):
    pricing_model_display = serializers.CharField(source='get_pricing_model_display', read_only=True)
    category_display      = serializers.CharField(source='get_category_display',      read_only=True)
    assigned_berths = serializers.SerializerMethodField()
    berth_ids = serializers.ListField(
        child=serializers.IntegerField(), write_only=True, required=False,
    )

    class Meta:
        model  = ChargeableItem
        fields = [
            'id', 'name', 'category', 'category_display',
            'pricing_model', 'pricing_model_display',
            'unit_price', 'tax_rate', 'is_active',
            'show_in_pos', 'fuel_dock_type', 'is_mandatory_transient_fee',
            'created_at',
            'assigned_berths', 'berth_ids',
        ]
        read_only_fields = ['id', 'created_at', 'pricing_model_display', 'category_display']

    def get_assigned_berths(self, obj):
        from apps.berths.models import Berth
        return [
            {'id': b.id, 'code': b.code}
            for b in Berth.objects.filter(pricing_tier=obj, marina=obj.marina).order_by('code')
        ]

    def _assign_berths(self, instance, berth_ids):
        from apps.berths.models import Berth
        Berth.objects.filter(
            id__in=berth_ids, marina=instance.marina
        ).update(pricing_tier=instance)

    def create(self, validated_data):
        berth_ids = validated_data.pop('berth_ids', [])
        instance = super().create(validated_data)
        if berth_ids:
            self._assign_berths(instance, berth_ids)
        return instance

    def update(self, instance, validated_data):
        berth_ids = validated_data.pop('berth_ids', None)
        instance = super().update(instance, validated_data)
        if berth_ids is not None:
            self._assign_berths(instance, berth_ids)
        return instance


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
