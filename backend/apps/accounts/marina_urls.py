from django.urls import path
from .views import MarinaProfileView, MarinaUsersView, InviteUserView, UserDetailView, MarinaOverviewView

urlpatterns = [
    path('profile/', MarinaProfileView.as_view(), name='marina_profile'),
    path('overview/', MarinaOverviewView.as_view(), name='marina_overview'),
    path('users/', MarinaUsersView.as_view(), name='marina_users'),
    path('users/invite/', InviteUserView.as_view(), name='invite_user'),
    path('users/<int:pk>/', UserDetailView.as_view(), name='user_detail'),
]
