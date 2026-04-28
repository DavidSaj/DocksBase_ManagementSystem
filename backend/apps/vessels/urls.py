from django.urls import path
from .views import (
    VesselListCreateView, VesselDetailView,
    VesselInsuranceView, VesselSafetyView,
    VesselCertificateListView, VesselCertificateDetailView,
)

urlpatterns = [
    path('vessels/', VesselListCreateView.as_view(), name='vessel_list'),
    path('vessels/<int:pk>/', VesselDetailView.as_view(), name='vessel_detail'),
    path('vessels/<int:pk>/insurance/', VesselInsuranceView.as_view(), name='vessel_insurance'),
    path('vessels/<int:pk>/safety/', VesselSafetyView.as_view(), name='vessel_safety'),
    path('vessels/<int:pk>/certificates/', VesselCertificateListView.as_view(), name='vessel_certificate_list'),
    path('vessels/<int:pk>/certificates/<int:cert_pk>/', VesselCertificateDetailView.as_view(), name='vessel_certificate_detail'),
]
