from django.urls import path
from .views import (
    StripeWebhookView,
    InvoiceListView,
    InvoiceDetailView,
    MarkPaidView,
    FromOrderView,
    PDFDownloadView,
    HTMLReceiptView,
)

urlpatterns = [
    path('stripe/webhook/', StripeWebhookView.as_view(), name='stripe_webhook'),
    path('invoices/', InvoiceListView.as_view(), name='invoice_list'),
    path('invoices/from-order/', FromOrderView.as_view(), name='invoice_from_order'),
    path('invoices/<int:pk>/', InvoiceDetailView.as_view(), name='invoice_detail'),
    path('invoices/<int:pk>/mark-paid/', MarkPaidView.as_view(), name='invoice_mark_paid'),
    path('invoices/<int:pk>/pdf/', PDFDownloadView.as_view(), name='invoice_pdf'),
    path('invoices/<int:pk>/receipt/', HTMLReceiptView.as_view(), name='invoice_receipt'),
]
