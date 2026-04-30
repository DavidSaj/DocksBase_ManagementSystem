from django.urls import path
from .views import OccupancyReportView, RevenueReportView, UtilisationReportView, ComplianceReportView

urlpatterns = [
    path('reports/occupancy/', OccupancyReportView.as_view(), name='report_occupancy'),
    path('reports/revenue/', RevenueReportView.as_view(), name='report_revenue'),
    path('reports/utilisation/', UtilisationReportView.as_view(), name='report_utilisation'),
    path('reports/compliance/', ComplianceReportView.as_view(), name='report_compliance'),
]
