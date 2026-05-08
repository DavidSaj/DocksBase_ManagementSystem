"""
apps/accounting/admin.py

Admin registration for all Track 4 accounting models.

Key rules:
  - AccountingIntegrationConfig.credentials MUST NOT be displayed in admin.
  - JournalEntry: has_change_permission returns False if is_posted=True.
  - PaymentPlan and APInvoice use inlines for child records.
"""

from django.contrib import admin

from apps.accounting.models import (
    CostCentre,
    CostCentreBudget,
    Account,
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
# Inlines
# ---------------------------------------------------------------------------

class JournalEntryLineInline(admin.TabularInline):
    model = JournalEntryLine
    extra = 0
    fields = ['account', 'debit', 'credit', 'cost_centre', 'description']


class CostCentreBudgetInline(admin.TabularInline):
    model = CostCentreBudget
    extra = 0
    fields = ['period', 'account', 'budgeted_amount']


class PaymentPlanInstalmentInline(admin.TabularInline):
    model = PaymentPlanInstalment
    extra = 0
    fields = ['sequence', 'due_date', 'amount', 'status', 'invoice', 'retry_count']
    readonly_fields = ['invoice', 'retry_count', 'notified_at', 'last_retry_at']


class APInvoiceLineItemInline(admin.TabularInline):
    model = APInvoiceLineItem
    extra = 0
    fields = ['position', 'description', 'quantity', 'unit_price', 'line_total', 'account', 'cost_centre']


class DeferredRevenueRecognitionLogInline(admin.TabularInline):
    model = DeferredRevenueRecognitionLog
    extra = 0
    readonly_fields = ['recognition_date', 'amount_recognised', 'journal_entry', 'created_at']
    can_delete = False


class AccountingSyncRecordInline(admin.TabularInline):
    model = AccountingSyncRecord
    extra = 0
    readonly_fields = ['direction', 'object_type', 'local_id', 'external_id', 'status', 'error_detail', 'synced_at']
    can_delete = False


# ---------------------------------------------------------------------------
# ModelAdmins
# ---------------------------------------------------------------------------

@admin.register(CostCentre)
class CostCentreAdmin(admin.ModelAdmin):
    list_display  = ['code', 'name', 'marina', 'is_active']
    list_filter   = ['marina', 'is_active']
    search_fields = ['code', 'name']
    inlines       = [CostCentreBudgetInline]


@admin.register(Account)
class AccountAdmin(admin.ModelAdmin):
    list_display  = ['code', 'name', 'account_type', 'marina', 'cost_centre', 'is_active']
    list_filter   = ['marina', 'account_type', 'is_active']
    search_fields = ['code', 'name', 'external_code']


@admin.register(JournalEntry)
class JournalEntryAdmin(admin.ModelAdmin):
    list_display    = ['pk', 'marina', 'entry_date', 'source_type', 'currency', 'is_posted']
    list_filter     = ['marina', 'source_type', 'is_posted']
    readonly_fields = ['created_at', 'is_posted']
    inlines         = [JournalEntryLineInline]

    def has_change_permission(self, request, obj=None):
        if obj and obj.is_posted:
            return False
        return super().has_change_permission(request, obj)


@admin.register(Currency)
class CurrencyAdmin(admin.ModelAdmin):
    list_display = ['code', 'name', 'symbol', 'marina', 'is_base', 'is_active']
    list_filter  = ['marina', 'is_base', 'is_active']


@admin.register(ExchangeRate)
class ExchangeRateAdmin(admin.ModelAdmin):
    list_display = ['from_currency', 'to_currency', 'rate', 'rate_date', 'source', 'marina']
    list_filter  = ['marina', 'source']
    ordering     = ['-rate_date']


@admin.register(MemberCreditAccount)
class MemberCreditAccountAdmin(admin.ModelAdmin):
    list_display = ['member', 'marina', 'balance', 'auto_deduct', 'last_updated_at']
    list_filter  = ['marina', 'auto_deduct']
    readonly_fields = ['last_updated_at']


@admin.register(MemberCreditTransaction)
class MemberCreditTransactionAdmin(admin.ModelAdmin):
    list_display = ['pk', 'credit_account', 'transaction_type', 'amount', 'direction', 'created_at']
    list_filter  = ['transaction_type', 'direction']
    readonly_fields = ['created_at']


@admin.register(SurchargeRule)
class SurchargeRuleAdmin(admin.ModelAdmin):
    list_display = ['name', 'marina', 'trigger_type', 'amount_type', 'amount', 'is_active']
    list_filter  = ['marina', 'trigger_type', 'is_active']


@admin.register(PaymentPlan)
class PaymentPlanAdmin(admin.ModelAdmin):
    list_display = ['name', 'marina', 'member', 'total_amount', 'status', 'created_at']
    list_filter  = ['marina', 'status']
    inlines      = [PaymentPlanInstalmentInline]
    readonly_fields = ['created_at']


@admin.register(DeferredRevenueEntry)
class DeferredRevenueEntryAdmin(admin.ModelAdmin):
    list_display = [
        'pk', 'marina', 'member', 'revenue_type', 'total_amount',
        'deferred_amount', 'is_fully_recognised',
    ]
    list_filter  = ['marina', 'revenue_type', 'is_fully_recognised']
    inlines      = [DeferredRevenueRecognitionLogInline]
    readonly_fields = ['earned_amount', 'deferred_amount', 'is_fully_recognised', 'cancelled_at', 'created_at']


@admin.register(FuelDutyRate)
class FuelDutyRateAdmin(admin.ModelAdmin):
    list_display = ['marina', 'fuel_type', 'use_type', 'duty_rate', 'effective_from', 'is_active']
    list_filter  = ['marina', 'fuel_type', 'use_type', 'is_active']


@admin.register(RedDieselSaleDeclaration)
class RedDieselSaleDeclarationAdmin(admin.ModelAdmin):
    list_display = ['pk', 'marina', 'declaration_date', 'duty_period', 'propulsion_litres', 'non_propulsion_litres']
    list_filter  = ['marina', 'duty_period']


@admin.register(HMRCFuelDutyReturn)
class HMRCFuelDutyReturnAdmin(admin.ModelAdmin):
    list_display = ['marina', 'duty_period', 'total_duty_payable', 'status', 'generated_at']
    list_filter  = ['marina', 'status']
    readonly_fields = ['generated_at']


@admin.register(Supplier)
class SupplierAdmin(admin.ModelAdmin):
    list_display  = ['name', 'marina', 'contact_email', 'payment_terms', 'is_active']
    list_filter   = ['marina', 'is_active']
    search_fields = ['name', 'contact_email']


@admin.register(APPurchaseOrder)
class APPurchaseOrderAdmin(admin.ModelAdmin):
    list_display = ['po_number', 'marina', 'supplier', 'total_amount', 'status', 'issue_date']
    list_filter  = ['marina', 'status']
    readonly_fields = ['created_at']


@admin.register(APInvoice)
class APInvoiceAdmin(admin.ModelAdmin):
    list_display = ['pk', 'marina', 'supplier', 'supplier_invoice_number', 'total_amount', 'status']
    list_filter  = ['marina', 'status']
    readonly_fields = ['created_at', 'ocr_confidence']
    inlines      = [APInvoiceLineItemInline]


@admin.register(AccountingIntegrationConfig)
class AccountingIntegrationConfigAdmin(admin.ModelAdmin):
    list_display = ['marina', 'platform', 'is_active', 'last_synced_at']
    list_filter  = ['platform', 'is_active']
    readonly_fields = ['last_synced_at']
    # credentials MUST NOT be displayed — contains encrypted API tokens
    exclude      = ['credentials']
    inlines      = [AccountingSyncRecordInline]


@admin.register(AccountingSyncRecord)
class AccountingSyncRecordAdmin(admin.ModelAdmin):
    list_display = ['pk', 'config', 'direction', 'object_type', 'local_id', 'status', 'synced_at']
    list_filter  = ['direction', 'object_type', 'status']
    readonly_fields = ['synced_at']
