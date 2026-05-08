from django.urls import path

from apps.harbour import views

urlpatterns = [
    # Harbour Dues (simplified frontend façade — maps to CommercialMovement)
    path('harbour/dues/',                                views.HarbourDueListCreateView.as_view(),             name='harbour-due-list'),
    path('harbour/dues/summary/',                        views.HarbourDueSummaryView.as_view(),                name='harbour-due-summary'),
    # Shipping Agents
    path('harbour/agents/',                              views.ShippingAgentListCreateView.as_view(),          name='harbour-agent-list'),
    path('harbour/agents/<int:pk>/',                     views.ShippingAgentDetailView.as_view(),              name='harbour-agent-detail'),
    # Harbour Tariffs
    path('harbour/tariffs/',                             views.HarbourTariffListCreateView.as_view(),          name='harbour-tariff-list'),
    path('harbour/tariffs/<int:pk>/',                    views.HarbourTariffDetailView.as_view(),              name='harbour-tariff-detail'),
    # Commercial Movements
    path('harbour/movements/',                           views.CommercialMovementListCreateView.as_view(),     name='harbour-movement-list'),
    path('harbour/movements/<int:pk>/',                  views.CommercialMovementDetailView.as_view(),         name='harbour-movement-detail'),
    path('harbour/movements/<int:pk>/calculate-dues/',   views.MovementCalculateDuesView.as_view(),            name='harbour-movement-calculate-dues'),
    path('harbour/movements/<int:pk>/generate-invoice/', views.MovementGenerateInvoiceView.as_view(),          name='harbour-movement-generate-invoice'),
    # PSC Records
    path('harbour/psc-records/',                         views.PortStateControlRecordListCreateView.as_view(), name='harbour-psc-list'),
    path('harbour/psc-records/<int:pk>/',                views.PortStateControlRecordDetailView.as_view(),     name='harbour-psc-detail'),
    # Reports
    path('harbour/reports/vessel-traffic/',              views.VesselTrafficReportView.as_view(),              name='harbour-report-vtr'),
    path('harbour/reports/daily-port-report/',           views.DailyPortReportView.as_view(),                  name='harbour-report-dpr'),
]
