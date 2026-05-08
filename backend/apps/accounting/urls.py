"""
apps/accounting/urls.py

All accounting API endpoints.  Include this in config/urls.py with:
    path('api/v1/billing/', include('apps.accounting.urls')),
    path('api/v1/reports/', include('apps.accounting.urls_reports')),

OR add this single include and prefix routes appropriately:
    path('api/v1/', include('apps.accounting.urls')),

See INSTALL.md for exact wiring instructions.
"""

from django.urls import path, include
from rest_framework.routers import DefaultRouter

from apps.accounting.views import (
    AccountViewSet,
    CostCentreViewSet,
    JournalEntryViewSet,
    CurrencyViewSet,
    ExchangeRateViewSet,
    CreditAccountViewSet,
    SurchargeRuleViewSet,
    FuelDutyRateViewSet,
    HMRCFuelDutyReturnViewSet,
    RedDieselDeclarationView,
    DeferredRevenueViewSet,
    SupplierViewSet,
    APPurchaseOrderViewSet,
    APInvoiceViewSet,
    AccountingIntegrationConfigViewSet,
    AccountingSyncRecordViewSet,
    PaymentPlanViewSet,
    InstalmentViewSet,
    # Reports
    BalanceSheetView,
    ProfitAndLossView,
    CashFlowView,
    CashForecastView,
    DeferredRevenueReportView,
    CostCentrePLReportView,
)

router = DefaultRouter()

# Chart of accounts
router.register(r'billing/accounts', AccountViewSet, basename='account')

# Journal entries
router.register(r'billing/journal-entries', JournalEntryViewSet, basename='journal-entry')

# Cost centres
router.register(r'billing/cost-centres', CostCentreViewSet, basename='cost-centre')

# Payment plans and instalments
router.register(r'billing/payment-plans', PaymentPlanViewSet, basename='payment-plan')
router.register(r'billing/instalments', InstalmentViewSet, basename='instalment')

# Credit accounts
router.register(r'billing/credit-accounts', CreditAccountViewSet, basename='credit-account')

# Surcharge rules
router.register(r'billing/surcharge-rules', SurchargeRuleViewSet, basename='surcharge-rule')

# HMRC Fuel Duty
router.register(r'billing/fuel-duty-rates', FuelDutyRateViewSet, basename='fuel-duty-rate')
router.register(r'billing/hmrc-returns', HMRCFuelDutyReturnViewSet, basename='hmrc-return')

# Deferred revenue
router.register(r'billing/deferred-revenue', DeferredRevenueViewSet, basename='deferred-revenue')

# Accounts payable
router.register(r'billing/suppliers', SupplierViewSet, basename='supplier')
router.register(r'billing/purchase-orders', APPurchaseOrderViewSet, basename='purchase-order')
router.register(r'billing/ap-invoices', APInvoiceViewSet, basename='ap-invoice')

# Accounting integration
router.register(
    r'billing/accounting-configs',
    AccountingIntegrationConfigViewSet,
    basename='accounting-config',
)

# Multi-currency
router.register(r'billing/currencies', CurrencyViewSet, basename='currency')
router.register(r'billing/exchange-rates', ExchangeRateViewSet, basename='exchange-rate')


# ── Frontend alias router (no billing/ prefix) ─────────────────────────────
# The frontend calls these without any prefix; we register alias routes so
# both the canonical billing/* and the bare paths work.

alias_router = DefaultRouter()
alias_router.register(r'journal-entries',    JournalEntryViewSet,               basename='journal-entry-alias')
alias_router.register(r'accounts',           AccountViewSet,                    basename='account-alias')
alias_router.register(r'cost-centres',       CostCentreViewSet,                 basename='cost-centre-alias')
alias_router.register(r'payment-plans',      PaymentPlanViewSet,                basename='payment-plan-alias')
alias_router.register(r'ap-invoices',        APInvoiceViewSet,                  basename='ap-invoice-alias')
alias_router.register(r'purchase-orders',    APPurchaseOrderViewSet,            basename='purchase-order-alias')
alias_router.register(r'suppliers',          SupplierViewSet,                   basename='supplier-alias')
alias_router.register(r'exchange-rates',     ExchangeRateViewSet,               basename='exchange-rate-alias')
alias_router.register(r'surcharge-rules',    SurchargeRuleViewSet,              basename='surcharge-rule-alias')
alias_router.register(r'accounting-sync',    AccountingSyncRecordViewSet,         basename='accounting-sync-alias')

urlpatterns = [
    path('', include(router.urls)),
    path('', include(alias_router.urls)),

    # Red diesel declaration — fuel dock sub-endpoint
    path(
        'fuel-dock/entries/<int:pk>/red-diesel-declaration/',
        RedDieselDeclarationView.as_view(),
        name='red-diesel-declaration',
    ),

    # Reports
    path('reports/balance-sheet/',   BalanceSheetView.as_view(),         name='report-balance-sheet'),
    path('reports/profit-and-loss/', ProfitAndLossView.as_view(),        name='report-pl'),
    path('reports/cash-flow/',       CashFlowView.as_view(),             name='report-cashflow'),
    path('reports/cash-forecast/',   CashForecastView.as_view(),         name='report-cashforecast'),
    path('reports/deferred-revenue/',DeferredRevenueReportView.as_view(),name='report-deferred-revenue'),
    path('reports/cost-centre-pl/',  CostCentrePLReportView.as_view(),   name='report-cost-centre-pl'),
]
