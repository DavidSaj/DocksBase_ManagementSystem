from django.urls import path
from .views import (
    AdminOverviewView,
    AdminMarinaListView, AdminMarinaDetailView,
    AdminMarinaSuspendView, AdminMarinaReinstateView,
    AdminMarinaConvertView, AdminMarinaImpersonateView,
    AdminMarinaResetPasswordView,
    AdminFinanceView, AdminPaymentListView,
    AdminSubscriptionsView,
    AdminFeatureFlagListView, AdminFeatureFlagDetailView,
    AdminAuditLogView,
)

urlpatterns = [
    path('overview/',                                  AdminOverviewView.as_view(),            name='admin_overview'),
    path('marinas/',                                   AdminMarinaListView.as_view(),          name='admin_marina_list'),
    path('marinas/<int:pk>/',                          AdminMarinaDetailView.as_view(),        name='admin_marina_detail'),
    path('marinas/<int:pk>/suspend/',                  AdminMarinaSuspendView.as_view(),       name='admin_marina_suspend'),
    path('marinas/<int:pk>/reinstate/',                AdminMarinaReinstateView.as_view(),     name='admin_marina_reinstate'),
    path('marinas/<int:pk>/convert/',                  AdminMarinaConvertView.as_view(),       name='admin_marina_convert'),
    path('marinas/<int:pk>/impersonate/',              AdminMarinaImpersonateView.as_view(),   name='admin_marina_impersonate'),
    path('marinas/<int:pk>/reset-password/',           AdminMarinaResetPasswordView.as_view(), name='admin_marina_reset_password'),
    path('finance/',                                   AdminFinanceView.as_view(),             name='admin_finance'),
    path('payments/',                                  AdminPaymentListView.as_view(),         name='admin_payments'),
    path('subscriptions/',                             AdminSubscriptionsView.as_view(),       name='admin_subscriptions'),
    path('feature-flags/',                             AdminFeatureFlagListView.as_view(),     name='admin_feature_flags'),
    path('feature-flags/<str:name>/',                  AdminFeatureFlagDetailView.as_view(),   name='admin_feature_flag_detail'),
    path('audit-logs/',                                AdminAuditLogView.as_view(),            name='admin_audit_logs'),
]
