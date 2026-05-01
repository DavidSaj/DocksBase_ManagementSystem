from django.urls import path
from .views import (
    StripeWebhookView, InvoiceListView, InvoiceDetailView, MarkPaidView,
    FromOrderView, PDFDownloadView, HTMLReceiptView,
    ChargeableItemListCreateView, ChargeableItemDetailView,
    InvoiceCreateView, AddLineItemView, RemoveLineItemView, FinalizeInvoiceView,
)

urlpatterns = [
    path('stripe/webhook/',              StripeWebhookView.as_view(),            name='stripe_webhook'),
    path('invoices/',                    InvoiceListView.as_view(),              name='invoice_list'),
    path('invoices/create/',             InvoiceCreateView.as_view(),            name='invoice_create'),
    path('invoices/from-order/',         FromOrderView.as_view(),                name='invoice_from_order'),
    path('invoices/<int:pk>/',           InvoiceDetailView.as_view(),            name='invoice_detail'),
    path('invoices/<int:pk>/mark-paid/', MarkPaidView.as_view(),                 name='invoice_mark_paid'),
    path('invoices/<int:pk>/finalize/',  FinalizeInvoiceView.as_view(),          name='invoice_finalize'),
    path('invoices/<int:pk>/line-items/',AddLineItemView.as_view(),              name='invoice_add_line_item'),
    path('invoices/<int:pk>/pdf/',       PDFDownloadView.as_view(),              name='invoice_pdf'),
    path('invoices/<int:pk>/receipt/',   HTMLReceiptView.as_view(),              name='invoice_receipt'),
    path('line-items/<int:pk>/',         RemoveLineItemView.as_view(),           name='line_item_delete'),
    path('service-catalog/',             ChargeableItemListCreateView.as_view(), name='service_catalog_list'),
    path('service-catalog/<int:pk>/',    ChargeableItemDetailView.as_view(),     name='service_catalog_detail'),
]
