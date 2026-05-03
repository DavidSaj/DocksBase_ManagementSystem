from django.urls import path
from apps.portal.views import MarinaPublicView

urlpatterns = [
    path('marina/', MarinaPublicView.as_view(), name='public-marina'),
]
