from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.access_control.views import (
    anpr, biometric, cards, cctv, events, fraud, readers, zones,
)
from apps.access_control.views.ingest import rfid_ingest, anpr_ingest, biometric_ingest

router = DefaultRouter()
router.register(r'zones',                 zones.AccessZoneViewSet,                 basename='accesszone')
router.register(r'readers',               readers.AccessReaderViewSet,             basename='accessreader')
router.register(r'zone-rules',            zones.ZoneAccessRuleViewSet,             basename='zoneaccessrule')
router.register(r'cards',                 cards.AccessCardViewSet,                 basename='accesscard')
router.register(r'events',                events.AccessEventViewSet,               basename='accessevent')
router.register(r'anpr-cameras',          anpr.ANPRCameraViewSet,                  basename='anprcamera')
router.register(r'vehicles',              anpr.VehicleRegistrationViewSet,         basename='vehicleregistration')
router.register(r'anpr-events',           anpr.ANPREventViewSet,                   basename='anprevent')
router.register(r'cctv-cameras',          cctv.CCTVCameraViewSet,                  basename='cctvcamera')
router.register(r'biometric-enrolments',  biometric.BiometricEnrolmentViewSet,     basename='biometricenrolment')
router.register(r'spend-rules',           fraud.SpendAuthorisationRuleViewSet,     basename='spendrule')
router.register(r'spend-requests',        fraud.SpendAuthorisationRequestViewSet,  basename='spendrequest')
router.register(r'fraud-alerts',          fraud.FraudAnomalyAlertViewSet,          basename='fraudalert')

urlpatterns = [
    path('', include(router.urls)),
    path('ingest/rfid/',       rfid_ingest,       name='ingest-rfid'),
    path('ingest/anpr/',       anpr_ingest,       name='ingest-anpr'),
    path('ingest/biometric/',  biometric_ingest,  name='ingest-biometric'),
]
