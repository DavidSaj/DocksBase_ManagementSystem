from django.urls import path

from .feed_views import FeedView
from .member_auth_urls import urlpatterns as member_auth_urls
from .member_views import (
    PortalGateView,
    PortalUtilitiesView,
    PortalWorkOrderView,
    PortalDocumentListView,
    PortalDocumentDetailView,
)
from .services_views import (
    PortalMemberCraneRequestView,
    PortalMemberBookingView,
    PortalMemberExtendStayView,
    PortalMemberIssueView,
)
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
    path('portal/member/crane-requests/',                 PortalMemberCraneRequestView.as_view(), name='portal_member_crane_requests'),
    path('portal/member/booking/',                        PortalMemberBookingView.as_view(),       name='portal_member_booking'),
    path('portal/member/extend-stay/',                    PortalMemberExtendStayView.as_view(),    name='portal_member_extend_stay'),
    path('portal/member/issues/',                         PortalMemberIssueView.as_view(),         name='portal_member_issues'),
    path('portal/member/gate/',                           PortalGateView.as_view(),               name='portal_member_gate'),
    path('portal/member/utilities/',                      PortalUtilitiesView.as_view(),          name='portal_member_utilities'),
    path('portal/member/work-orders/',                    PortalWorkOrderView.as_view(),          name='portal_member_work_orders'),
    path('portal/member/documents/',                      PortalDocumentListView.as_view(),       name='portal_member_documents'),
    path('portal/member/documents/<int:pk>/',             PortalDocumentDetailView.as_view(),     name='portal_member_document_detail'),
]
