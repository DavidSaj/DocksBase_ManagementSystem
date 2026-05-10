from django.urls import path

from .feed_views import FeedView
from .member_auth_urls import urlpatterns as member_auth_urls
from .views import (
    PortalInvoiceListView, AbsenceReportCreateView, CraneRequestListCreateView,
    CraneRequestStaffListView, CraneRequestStaffDetailView,
    PortalBerthView, PortalVesselView, PortalInvoicePayView,
)

urlpatterns = member_auth_urls + [
    path('portal/feed/',                                   FeedView.as_view(),                   name='portal_feed'),
    path('portal/invoices/',                              PortalInvoiceListView.as_view(),      name='portal_invoices'),
    path('portal/invoices/<int:pk>/pay/',                 PortalInvoicePayView.as_view(),        name='portal_invoice_pay'),
    path('portal/absence/',                               AbsenceReportCreateView.as_view(),     name='portal_absence'),
    path('portal/crane-requests/',                        CraneRequestListCreateView.as_view(),  name='portal_crane_requests'),
    path('portal/crane-requests/staff/',                  CraneRequestStaffListView.as_view(),   name='portal_crane_staff_list'),
    path('portal/crane-requests/<int:pk>/staff-update/',  CraneRequestStaffDetailView.as_view(), name='portal_crane_staff_detail'),
    path('portal/berth/',                                 PortalBerthView.as_view(),             name='portal_berth'),
    path('portal/vessel/',                                PortalVesselView.as_view(),            name='portal_vessel'),
]
