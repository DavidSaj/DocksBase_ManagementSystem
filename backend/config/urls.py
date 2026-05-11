from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('_platform/admin/', admin.site.urls),
    path('api/v1/', include([
        path('auth/', include('apps.accounts.urls')),
        path('admin/', include('apps.admin_portal.urls')),
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
        path('', include('apps.search.urls')),
        path('', include('apps.notifications.urls')),
        path('', include('apps.fuel_dock.urls')),
        path('marina/', include('apps.accounts.marina_urls')),
        path('', include('apps.portal.urls')),
        path('', include('apps.portal.checkin_urls')),
        path('public/', include('apps.portal.public_urls')),
        path('mobile/', include('apps.mobile.urls')),
        # ERP tracks
        path('', include('apps.revenue.urls')),
        path('', include('apps.loyalty.urls')),
        path('', include('apps.accounting.urls')),
        path('', include('apps.movements.urls')),
        path('', include('apps.utilities.urls')),
        path('', include('apps.activities.urls')),
        path('', include('apps.housekeeping.urls')),
        path('', include('apps.charter.urls')),
        path('', include('apps.harbour.urls')),
        path('access-control/', include('apps.access_control.urls')),
        path('', include('apps.sustainability.urls')),
        # Tracks 1, 7, 10
        path('', include('apps.revenue_intelligence.urls')),
        path('communications/', include('apps.communications.urls')),
        path('channels/', include('apps.channels.urls')),
        path('', include('apps.tenants.urls')),
        path('', include('apps.marketplace.urls')),
    ])),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
