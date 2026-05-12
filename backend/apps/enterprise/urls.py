from django.urls import path
from .views import (
    MeView, GroupOverviewView, GroupFinancialsView,
    GroupStaffView, GroupStaffInviteView, GroupStaffRemoveView,
    GroupExchangeTokenView, GroupSettingsView,
)

urlpatterns = [
    path('me/',                                                      MeView.as_view(),                name='enterprise_me'),
    path('groups/<int:pk>/overview/',                                GroupOverviewView.as_view(),      name='enterprise_overview'),
    path('groups/<int:pk>/financials/',                              GroupFinancialsView.as_view(),    name='enterprise_financials'),
    path('groups/<int:pk>/staff/',                                   GroupStaffView.as_view(),         name='enterprise_staff'),
    path('groups/<int:pk>/staff/invite/',                            GroupStaffInviteView.as_view(),   name='enterprise_staff_invite'),
    path('groups/<int:pk>/staff/<int:user_id>/remove/',              GroupStaffRemoveView.as_view(),   name='enterprise_staff_remove'),
    path('groups/<int:pk>/settings/',                                GroupSettingsView.as_view(),      name='enterprise_settings'),
    path('groups/<int:pk>/exchange_token/',                          GroupExchangeTokenView.as_view(), name='enterprise_exchange_token'),
]
