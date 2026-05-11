"""
apps/accounting/serializers.py

One serializer per accounting model.
Notable:
  - PaymentPlanCreateSerializer accepts nested instalments[].
  - JournalEntrySerializer includes nested lines[].
  - AccountingIntegrationConfigSerializer excludes 'credentials' for security.
"""

from decimal import Decimal

from rest_framework import serializers

from apps.accounting.models import (
    Account,
    CostCentre,
    CostCentreBudget,
    JournalEntry,
    JournalEntryLine,
    Currency,
    ExchangeRate,
    MemberCreditAccount,
    MemberCreditTransaction,
    SurchargeRule,
    PaymentPlan,
    PaymentPlanInstalment,
    DeferredRevenueEntry,
    DeferredRevenueRecognitionLog,
    FuelDutyRate,
    RedDieselSaleDeclaration,
    HMRCFuelDutyReturn,
    Supplier,
    APPurchaseOrder,
    APInvoice,
    APInvoiceLineItem,
    AccountingIntegrationConfig,
    AccountingSyncRecord,
)


# ---------------------------------------------------------------------------
# Cost Centres
# ---------------------------------------------------------------------------

class CostCentreSerializer(serializers.ModelSerializer):
    class Meta:
        model = CostCentre
        fields = ['id', 'marina', 'code', 'name', 'is_active']
        read_only_fields = ['id']


# ---------------------------------------------------------------------------
# Chart of Accounts
# ---------------------------------------------------------------------------

class AccountSerializer(serializers.ModelSerializer):
    account_type_display = serializers.CharField(source='get_account_type_display', read_only=True)

    class Meta:
        model = Account
        fields = [
            'id', 'marina', 'code', 'name', 'account_type', 'account_type_display',
            'parent', 'is_active', 'cost_centre', 'external_code',
        ]
        read_only_fields = ['id', 'account_type_display']


# ---------------------------------------------------------------------------
# Cost Centre Budget
# ---------------------------------------------------------------------------

class CostCentreBudgetSerializer(serializers.ModelSerializer):
    class Meta:
        model = CostCentreBudget
        fields = ['id', 'cost_centre', 'period', 'account', 'budgeted_amount']
        read_only_fields = ['id']


# ---------------------------------------------------------------------------
# Journal Entries
# ---------------------------------------------------------------------------

class JournalEntryLineSerializer(serializers.ModelSerializer):
    class Meta:
        model = JournalEntryLine
        fields = [
            'id', 'entry', 'account', 'debit', 'credit',
            'amount_foreign_debit', 'amount_foreign_credit',
            'description', 'cost_centre',
        ]
        read_only_fields = ['id']


class JournalEntrySerializer(serializers.ModelSerializer):
    lines = JournalEntryLineSerializer(many=True, read_only=True)
    source_type_display = serializers.CharField(source='get_source_type_display', read_only=True)

    class Meta:
        model = JournalEntry
        fields = [
            'id', 'marina', 'entry_date', 'source_type', 'source_type_display',
            'source_id', 'reference', 'description', 'currency', 'fx_rate',
            'created_at', 'created_by', 'is_posted', 'lines',
        ]
        read_only_fields = ['id', 'created_at', 'source_type_display']


# ---------------------------------------------------------------------------
# Currency and Exchange Rates
# ---------------------------------------------------------------------------

class CurrencySerializer(serializers.ModelSerializer):
    class Meta:
        model = Currency
        fields = ['id', 'marina', 'code', 'name', 'symbol', 'is_base', 'is_active']
        read_only_fields = ['id']


class ExchangeRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = ExchangeRate
        fields = [
            'id', 'marina', 'from_currency', 'to_currency',
            'rate', 'rate_date', 'source',
        ]
        read_only_fields = ['id']


# ---------------------------------------------------------------------------
# Member Credit
# ---------------------------------------------------------------------------

class MemberCreditAccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = MemberCreditAccount
        fields = ['id', 'marina', 'member', 'balance', 'auto_deduct', 'last_updated_at']
        read_only_fields = ['id', 'balance', 'last_updated_at']


class MemberCreditTransactionSerializer(serializers.ModelSerializer):
    transaction_type_display = serializers.CharField(
        source='get_transaction_type_display', read_only=True
    )

    class Meta:
        model = MemberCreditTransaction
        fields = [
            'id', 'credit_account', 'transaction_type', 'transaction_type_display',
            'amount', 'direction', 'balance_after', 'invoice',
            'payment_method', 'stripe_payment_intent', 'notes',
            'recorded_by', 'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'transaction_type_display']


# ---------------------------------------------------------------------------
# Surcharge Rules
# ---------------------------------------------------------------------------

class SurchargeRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = SurchargeRule
        fields = [
            'id', 'marina', 'name', 'trigger_type', 'payment_method',
            'chargeable_item', 'item_category', 'amount_type', 'amount',
            'description_label', 'is_active', 'gl_account',
        ]
        read_only_fields = ['id']


# ---------------------------------------------------------------------------
# Payment Plans
# ---------------------------------------------------------------------------

class PaymentPlanInstalmentSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = PaymentPlanInstalment
        fields = [
            'id', 'plan', 'sequence', 'due_date', 'amount', 'status', 'status_display',
            'invoice', 'retry_count', 'last_retry_at', 'failure_reason', 'notified_at',
        ]
        read_only_fields = ['id', 'status_display']


class InstalmentInputSerializer(serializers.Serializer):
    """Used as nested input only — not a ModelSerializer."""
    due_date = serializers.DateField()
    amount   = serializers.DecimalField(max_digits=12, decimal_places=2)


class PaymentPlanCreateSerializer(serializers.ModelSerializer):
    """
    Accepts nested instalments[] for atomic plan creation.
    Validates sum(instalments) == total_amount and dates are ascending and unique.
    """
    instalments = InstalmentInputSerializer(many=True, write_only=True)

    class Meta:
        model = PaymentPlan
        fields = [
            'id', 'marina', 'member', 'booking', 'name', 'total_amount',
            'auto_issue', 'dd_mandate_ref', 'dd_advance_days', 'instalments',
        ]
        read_only_fields = ['id']

    def validate(self, data):
        instalments = data.get('instalments', [])
        total = data.get('total_amount', Decimal('0.00'))

        instalment_total = sum(Decimal(str(i['amount'])) for i in instalments)
        if instalment_total != total:
            raise serializers.ValidationError(
                f"Instalment total ({instalment_total}) must equal total_amount ({total})."
            )

        due_dates = [i['due_date'] for i in instalments]
        if len(due_dates) != len(set(due_dates)):
            raise serializers.ValidationError("Instalment due dates must be unique.")
        if due_dates != sorted(due_dates):
            raise serializers.ValidationError(
                "Instalment due dates must be in ascending order."
            )

        return data

    def create(self, validated_data):
        from apps.accounting.services.payment_plans import create_payment_plan
        instalments_data = validated_data.pop('instalments')
        return create_payment_plan(
            marina=validated_data['marina'],
            member=validated_data.get('member'),
            booking=validated_data.get('booking'),
            name=validated_data['name'],
            total_amount=validated_data['total_amount'],
            auto_issue=validated_data.get('auto_issue', True),
            dd_mandate_ref=validated_data.get('dd_mandate_ref', ''),
            instalments_data=instalments_data,
        )


class PaymentPlanSerializer(serializers.ModelSerializer):
    instalments = PaymentPlanInstalmentSerializer(many=True, read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    # Convenience counts used by the frontend progress bar
    instalment_count = serializers.SerializerMethodField()
    paid_instalment_count = serializers.SerializerMethodField()
    # Expose member name for display
    member_name = serializers.SerializerMethodField()

    class Meta:
        model = PaymentPlan
        fields = [
            'id', 'marina', 'member', 'member_name', 'booking', 'name', 'total_amount',
            'status', 'status_display', 'auto_issue', 'dd_mandate_ref',
            'dd_advance_days', 'created_at', 'created_by',
            'instalment_count', 'paid_instalment_count',
            'instalments',
        ]
        read_only_fields = ['id', 'created_at', 'status_display',
                            'instalment_count', 'paid_instalment_count', 'member_name']

    def get_instalment_count(self, obj):
        return obj.instalments.count()

    def get_paid_instalment_count(self, obj):
        return obj.instalments.filter(status='paid').count()

    def get_member_name(self, obj):
        try:
            return obj.member.name if obj.member else None
        except Exception:
            return None


# ---------------------------------------------------------------------------
# Deferred Revenue
# ---------------------------------------------------------------------------

class DeferredRevenueRecognitionLogSerializer(serializers.ModelSerializer):
    class Meta:
        model = DeferredRevenueRecognitionLog
        fields = [
            'id', 'deferred_entry', 'recognition_date',
            'amount_recognised', 'journal_entry', 'created_at',
        ]
        read_only_fields = ['id', 'created_at']


class DeferredRevenueEntrySerializer(serializers.ModelSerializer):
    recognition_logs = DeferredRevenueRecognitionLogSerializer(many=True, read_only=True)
    revenue_type_display = serializers.CharField(source='get_revenue_type_display', read_only=True)

    class Meta:
        model = DeferredRevenueEntry
        fields = [
            'id', 'marina', 'member', 'invoice', 'revenue_type', 'revenue_type_display',
            'description', 'total_amount', 'earned_amount', 'deferred_amount',
            'service_start', 'service_end', 'gl_deferred_account', 'gl_earned_account',
            'is_fully_recognised', 'cancelled_at', 'refunded_amount',
            'created_at', 'recognition_logs',
        ]
        read_only_fields = [
            'id', 'earned_amount', 'deferred_amount', 'is_fully_recognised',
            'cancelled_at', 'refunded_amount', 'created_at', 'revenue_type_display',
        ]


# ---------------------------------------------------------------------------
# HMRC Fuel Duty
# ---------------------------------------------------------------------------

class FuelDutyRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = FuelDutyRate
        fields = [
            'id', 'marina', 'fuel_type', 'use_type', 'duty_rate',
            'effective_from', 'effective_to', 'is_active',
        ]
        read_only_fields = ['id']


class RedDieselSaleDeclarationSerializer(serializers.ModelSerializer):
    class Meta:
        model = RedDieselSaleDeclaration
        fields = [
            'id', 'marina', 'fuel_dock_entry', 'propulsion_litres',
            'non_propulsion_litres', 'propulsion_duty', 'non_propulsion_duty',
            'declaration_by', 'declaration_date', 'duty_period',
        ]
        read_only_fields = ['id']


class HMRCFuelDutyReturnSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = HMRCFuelDutyReturn
        fields = [
            'id', 'marina', 'duty_period', 'period_start', 'period_end',
            'total_litres_sold', 'propulsion_litres', 'non_propulsion_litres',
            'propulsion_duty_payable', 'non_propulsion_duty_payable', 'total_duty_payable',
            'status', 'status_display', 'generated_at', 'submitted_at', 'submission_ref',
        ]
        read_only_fields = ['id', 'generated_at', 'status_display']


# ---------------------------------------------------------------------------
# AP (Accounts Payable)
# ---------------------------------------------------------------------------

class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = [
            'id', 'marina', 'name', 'contact_email', 'payment_terms',
            'gl_account', 'external_id', 'is_active',
        ]
        read_only_fields = ['id']


class APPurchaseOrderSerializer(serializers.ModelSerializer):
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    supplier_name  = serializers.CharField(source='supplier.name', read_only=True, allow_null=True)

    class Meta:
        model = APPurchaseOrder
        fields = [
            'id', 'marina', 'supplier', 'supplier_name', 'po_number', 'issue_date',
            'expected_delivery', 'total_amount', 'status', 'status_display',
            'created_by', 'created_at',
        ]
        read_only_fields = ['id', 'created_at', 'status_display', 'supplier_name']


class APInvoiceLineItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = APInvoiceLineItem
        fields = [
            'id', 'ap_invoice', 'description', 'quantity', 'unit_price',
            'line_total', 'tax_amount', 'account', 'cost_centre',
            'ocr_description', 'position',
        ]
        read_only_fields = ['id']


class APInvoiceSerializer(serializers.ModelSerializer):
    line_items = APInvoiceLineItemSerializer(many=True, read_only=True)
    status_display = serializers.CharField(source='get_status_display', read_only=True)
    supplier_name  = serializers.CharField(source='supplier.name', read_only=True, allow_null=True)

    class Meta:
        model = APInvoice
        fields = [
            'id', 'marina', 'supplier', 'supplier_name', 'supplier_invoice_number',
            'invoice_date', 'due_date', 'currency', 'subtotal', 'tax_amount',
            'total_amount', 'status', 'status_display', 'ocr_service',
            'ocr_document_id', 'ocr_confidence', 'raw_document',
            'purchase_order', 'match_status', 'match_variance',
            'approved_by', 'approved_at', 'created_at', 'journal_entry',
            'line_items',
        ]
        read_only_fields = ['id', 'created_at', 'status_display', 'supplier_name']


# ---------------------------------------------------------------------------
# Accounting Integration
# ---------------------------------------------------------------------------

class AccountingIntegrationConfigSerializer(serializers.ModelSerializer):
    """
    NOTE: 'credentials' is intentionally EXCLUDED from this serializer.
    Credentials are encrypted server-side and must never be returned in API responses.
    """
    platform_display = serializers.CharField(source='get_platform_display', read_only=True)

    class Meta:
        model = AccountingIntegrationConfig
        fields = [
            'id', 'marina', 'platform', 'platform_display', 'is_active',
            'company_id', 'base_url', 'last_synced_at', 'sync_errors',
        ]
        read_only_fields = ['id', 'last_synced_at', 'sync_errors', 'platform_display']
        # credentials is deliberately omitted — stored encrypted, never returned


class AccountingSyncRecordSerializer(serializers.ModelSerializer):
    # The frontend reads r.platform ?? r.config_platform — expose platform from the related config
    platform = serializers.CharField(source='config.platform', read_only=True)
    config_platform = serializers.CharField(source='config.platform', read_only=True)

    class Meta:
        model = AccountingSyncRecord
        fields = [
            'id', 'config', 'platform', 'config_platform',
            'direction', 'object_type', 'local_id',
            'external_id', 'status', 'error_detail', 'synced_at',
        ]
        read_only_fields = ['id', 'synced_at', 'platform', 'config_platform']
