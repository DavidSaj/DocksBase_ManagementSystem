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

from apps.accounting.views_xero_oauth import (
    XeroAuthorizeView,
    XeroCallbackView,
    XeroDisconnectView,
)
from apps.accounting.views_qbo_oauth import (
    QBOAuthorizeView,
    QBOCallbackView,
    QBODisconnectView,
)
from apps.accounting.views_sage_oauth import (
    SageAuthorizeView,
    SageCallbackView,
    SageDisconnectView,
)
from apps.accounting.views_myob_oauth import (
    MYOBAuthorizeView,
    MYOBCallbackView,
    MYOBDisconnectView,
)
from apps.accounting.views_d365_oauth import (
    D365AuthorizeView,
    D365CallbackView,
    D365DisconnectView,
)
from apps.accounting.views_netsuite_oauth import (
    NetSuiteAuthorizeView,
    NetSuiteCallbackView,
    NetSuiteDisconnectView,
)
from apps.accounting.views_intacct_connect import (
    IntacctStatusView,
    IntacctConnectView,
    IntacctDisconnectView,
)
from apps.accounting.views_export import JournalCSVExportView
from apps.accounting.views_datev_export import DatevCSVExportView
from apps.accounting.views_accounting_exports import (
    ExportJobViewSet,
    PayoutViewSet,
    GLCodeMappingViewSet,
    TaxCodeViewSet,
    TaxSummaryView,
)

# Accounting & Tax Export endpoints — mounted at /api/v1/accounting/...
accounting_router = DefaultRouter()
accounting_router.register(r'exports',      ExportJobViewSet,      basename='accounting-export')
accounting_router.register(r'payouts',      PayoutViewSet,         basename='accounting-payout')
accounting_router.register(r'gl-mappings',  GLCodeMappingViewSet,  basename='accounting-gl-mapping')
accounting_router.register(r'tax-codes',    TaxCodeViewSet,        basename='accounting-tax-code')

urlpatterns = [
    path('', include(router.urls)),
    path('', include(alias_router.urls)),

    # Xero OAuth
    path('xero/authorize/',  XeroAuthorizeView.as_view(),  name='xero-authorize'),
    path('xero/callback/',   XeroCallbackView.as_view(),   name='xero-callback'),
    path('xero/disconnect/', XeroDisconnectView.as_view(), name='xero-disconnect'),

    # QuickBooks Online OAuth
    path('qbo/authorize/',  QBOAuthorizeView.as_view(),  name='qbo-authorize'),
    path('qbo/callback/',   QBOCallbackView.as_view(),   name='qbo-callback'),
    path('qbo/disconnect/', QBODisconnectView.as_view(), name='qbo-disconnect'),

    # Sage Business Cloud Accounting OAuth
    path('sage/authorize/',  SageAuthorizeView.as_view(),  name='sage-authorize'),
    path('sage/callback/',   SageCallbackView.as_view(),   name='sage-callback'),
    path('sage/disconnect/', SageDisconnectView.as_view(), name='sage-disconnect'),

    # MYOB AccountRight Live OAuth
    path('myob/authorize/',  MYOBAuthorizeView.as_view(),  name='myob-authorize'),
    path('myob/callback/',   MYOBCallbackView.as_view(),   name='myob-callback'),
    path('myob/disconnect/', MYOBDisconnectView.as_view(), name='myob-disconnect'),

    # Dynamics 365 Business Central OAuth (Azure AD)
    path('d365/authorize/',  D365AuthorizeView.as_view(),  name='d365-authorize'),
    path('d365/callback/',   D365CallbackView.as_view(),   name='d365-callback'),
    path('d365/disconnect/', D365DisconnectView.as_view(), name='d365-disconnect'),

    # NetSuite OAuth (account-scoped)
    path('netsuite/authorize/',  NetSuiteAuthorizeView.as_view(),  name='netsuite-authorize'),
    path('netsuite/callback/',   NetSuiteCallbackView.as_view(),   name='netsuite-callback'),
    path('netsuite/disconnect/', NetSuiteDisconnectView.as_view(), name='netsuite-disconnect'),

    # Sage Intacct credential form (no OAuth)
    path('sage-intacct/status/',     IntacctStatusView.as_view(),     name='sage-intacct-status'),
    path('sage-intacct/connect/',    IntacctConnectView.as_view(),    name='sage-intacct-connect'),
    path('sage-intacct/disconnect/', IntacctDisconnectView.as_view(), name='sage-intacct-disconnect'),

    # Generic journal CSV export (universal fallback)
    path('accounting/export/journal.csv/', JournalCSVExportView.as_view(), name='journal-csv-export'),

    # DATEV Buchungsstapel export (Germany)
    path('accounting/export/datev.csv/',   DatevCSVExportView.as_view(),   name='datev-csv-export'),

    # Red diesel declaration — fuel dock sub-endpoint
    path(
        'fuel-dock/entries/<int:pk>/red-diesel-declaration/',
        RedDieselDeclarationView.as_view(),
        name='red-diesel-declaration',
    ),

    # Accounting & Tax Export — exports, payouts, GL mapping, tax codes, tax summary.
    path('accounting/', include(accounting_router.urls)),
    path('accounting/tax-summary/', TaxSummaryView.as_view(), name='accounting-tax-summary'),

    # Reports
    path('reports/balance-sheet/',   BalanceSheetView.as_view(),         name='report-balance-sheet'),
    path('reports/profit-and-loss/', ProfitAndLossView.as_view(),        name='report-pl'),
    path('reports/cash-flow/',       CashFlowView.as_view(),             name='report-cashflow'),
    path('reports/cash-forecast/',   CashForecastView.as_view(),         name='report-cashforecast'),
    path('reports/deferred-revenue/',DeferredRevenueReportView.as_view(),name='report-deferred-revenue'),
    path('reports/cost-centre-pl/',  CostCentrePLReportView.as_view(),   name='report-cost-centre-pl'),
]
