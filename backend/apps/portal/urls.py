from django.urls import path
from .views import (
    PortalInvoiceListView, AbsenceReportCreateView, CraneRequestListCreateView,
    CraneRequestStaffListView, CraneRequestStaffDetailView,
)

urlpatterns = [
    path('portal/invoices/',                              PortalInvoiceListView.as_view(),         name='portal_invoices'),
    path('portal/absence/',                               AbsenceReportCreateView.as_view(),       name='portal_absence'),
    path('portal/crane-requests/',                        CraneRequestListCreateView.as_view(),    name='portal_crane_requests'),
    path('portal/crane-requests/staff/',                  CraneRequestStaffListView.as_view(),     name='portal_crane_staff_list'),
    path('portal/crane-requests/<int:pk>/staff-update/',  CraneRequestStaffDetailView.as_view(),   name='portal_crane_staff_detail'),
]
