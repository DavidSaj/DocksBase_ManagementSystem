from django.urls import path
from .views import PortalInvoiceListView, AbsenceReportCreateView, CraneRequestListCreateView

urlpatterns = [
    path('portal/invoices/', PortalInvoiceListView.as_view(), name='portal_invoices'),
    path('portal/absence/', AbsenceReportCreateView.as_view(), name='portal_absence'),
    path('portal/crane-requests/', CraneRequestListCreateView.as_view(), name='portal_crane_requests'),
]
