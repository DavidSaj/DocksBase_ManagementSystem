from django.urls import path
from .views import InvoiceListCreateView, InvoiceDetailView, PaymentListCreateView

urlpatterns = [
    path('invoices/', InvoiceListCreateView.as_view(), name='invoice_list'),
    path('invoices/<int:pk>/', InvoiceDetailView.as_view(), name='invoice_detail'),
    path('payments/', PaymentListCreateView.as_view(), name='payment_list'),
]
