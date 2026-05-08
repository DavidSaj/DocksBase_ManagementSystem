from django.urls import path
from apps.tenants import views

urlpatterns = [
    path('tenants/units/', views.CommercialUnitListCreateView.as_view(), name='tenants-unit-list'),
    path('tenants/units/<int:pk>/', views.CommercialUnitDetailView.as_view(), name='tenants-unit-detail'),
    path('tenants/contacts/', views.TenantContactListCreateView.as_view(), name='tenants-contact-list'),
    path('tenants/contacts/<int:pk>/', views.TenantContactDetailView.as_view(), name='tenants-contact-detail'),
    path('tenants/tenancies/', views.TenancyListCreateView.as_view(), name='tenants-tenancy-list'),
    path('tenants/tenancies/<int:pk>/', views.TenancyDetailView.as_view(), name='tenants-tenancy-detail'),
    path('tenants/tenancies/<int:pk>/documents/', views.TenancyDocumentListCreateView.as_view(), name='tenants-tenancy-documents'),
    path('tenants/tenancies/<int:pk>/schedule/', views.RentScheduleListView.as_view(), name='tenants-schedule-list'),
    path('tenants/tenancies/<int:pk>/schedule/generate/', views.RentScheduleGenerateView.as_view(), name='tenants-schedule-generate'),
    path('tenants/tasks/', views.TenancyTaskListCreateView.as_view(), name='tenants-task-list'),
    path('tenants/tasks/<int:pk>/', views.TenancyTaskDetailView.as_view(), name='tenants-task-detail'),
    path('tenants/schedule/', views.RentScheduleGlobalListView.as_view(), name='tenants-schedule-global'),
]
