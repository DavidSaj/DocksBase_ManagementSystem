from django.urls import include, path
from rest_framework.routers import DefaultRouter

from apps.sustainability import views

router = DefaultRouter()
router.register(r'emission-factors',     views.EmissionFactorViewSet,       basename='emissionfactor')
router.register(r'scope1',               views.Scope1RecordViewSet,          basename='scope1record')
router.register(r'scope2',               views.Scope2RecordViewSet,          basename='scope2record')
router.register(r'scope3',               views.Scope3RecordViewSet,          basename='scope3record')
router.register(r'waste',                views.WasteLogViewSet,              basename='wastelog')
router.register(r'ledger',               views.SustainabilityLedgerViewSet,  basename='sustainabilityledger')
router.register(r'esg-reports',          views.ESGReportArchiveViewSet,      basename='esgreportarchive')
router.register(r'offset-contributions', views.OffsetContributionViewSet,    basename='offsetcontribution')
router.register(r'grid-intensity',       views.GridCarbonIntensityViewSet,   basename='gridcarbonintensity')

urlpatterns = [path('', include(router.urls))]
