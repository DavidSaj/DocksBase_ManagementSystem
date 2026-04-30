from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/v1/', include([
        path('auth/', include('apps.accounts.urls')),
        path('', include('apps.berths.urls')),
        path('', include('apps.reservations.urls')),
        path('', include('apps.vessels.urls')),
        path('', include('apps.members.urls')),
        path('billing/', include('apps.billing.urls')),
        path('', include('apps.maintenance.urls')),
        path('', include('apps.staff.urls')),
        path('', include('apps.boatyard.urls')),
        path('', include('apps.documents.urls')),
        path('', include('apps.restaurant.urls')),
        path('', include('apps.events.urls')),
        path('', include('apps.sales.urls')),
        path('', include('apps.reports.urls')),
        path('', include('apps.fuel_dock.urls')),
        path('marina/', include('apps.accounts.marina_urls')),
        path('', include('apps.portal.urls')),
    ])),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
