from django.urls import path
from .views import MarinaProfileView, MarinaUsersView, InviteUserView, UserDetailView, MarinaOverviewView, GrantSupportAccessView, DropboxSignSettingsView
from .views_data_export import DataExportListCreateView, DataExportDownloadView

urlpatterns = [
    path('profile/', MarinaProfileView.as_view(), name='marina_profile'),
    path('overview/', MarinaOverviewView.as_view(), name='marina_overview'),
    path('users/', MarinaUsersView.as_view(), name='marina_users'),
    path('users/invite/', InviteUserView.as_view(), name='invite_user'),
    path('users/<int:pk>/', UserDetailView.as_view(), name='user_detail'),
    path('grant-support-access/', GrantSupportAccessView.as_view(), name='grant_support_access'),
    path('integrations/dropbox-sign/', DropboxSignSettingsView.as_view(), name='dropboxsign_settings'),

    # Data export (Settings → Data tab)
    path('exports/',                   DataExportListCreateView.as_view(), name='marina_data_exports'),
    path('exports/<int:pk>/download/', DataExportDownloadView.as_view(),   name='marina_data_export_download'),
]
