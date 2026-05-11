from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    HaulOutList, HaulOutDetail,
    StorageSlotList, StorageSlotDetail,
    LaunchRequestList, LaunchRequestDetail,
    WorkOrderList, WorkOrderDetail,
    PartList, PartDetail,
    ToolList, ToolDetail,
    ContractorList, ContractorDetail,
)
from .viewsets import (
    WorkOrderViewSet,
    WorkOrderTaskViewSet,
    TaskDependencyViewSet,
    BuildProjectViewSet,
    BOMItemViewSet,
    BuildMilestoneViewSet,
    JobTemplateViewSet,
    JobTemplateTaskViewSet,
    JobTemplatePartViewSet,
    BatchJobPostViewSet,
    BatchJobPostLineViewSet,
    WarrantyAgreementViewSet,
    WarrantyClaimViewSet,
    SupplierPriceFileViewSet,
    SupplierColumnMapViewSet,
    PartPriceHistoryViewSet,
    LocationViewSet,
    ServiceTruckViewSet,
    InventoryLevelViewSet,
    InventoryAnomalyViewSet,
    TruckStockTransferViewSet,
    # Track 5 — Service Operations
    ServiceBayViewSet,
    LiftOperationViewSet,
    PaintRecordViewSet,
    PartsInventoryViewSet,
    SubcontractorViewSet,
)

# ---------------------------------------------------------------------------
# Track 5 — DRF router for ViewSet-based endpoints
# ---------------------------------------------------------------------------

router = DefaultRouter()
router.register(r'v2/work-orders',         WorkOrderViewSet,          basename='workorder-v2')
router.register(r'work-order-tasks',       WorkOrderTaskViewSet,      basename='workordertask')
router.register(r'task-dependencies',      TaskDependencyViewSet,     basename='taskdependency')
router.register(r'build-projects',         BuildProjectViewSet,       basename='buildproject')
router.register(r'bom-items',              BOMItemViewSet,            basename='bomitem')
router.register(r'build-milestones',       BuildMilestoneViewSet,     basename='buildmilestone')
router.register(r'job-templates',          JobTemplateViewSet,        basename='jobtemplate')
router.register(r'job-template-tasks',     JobTemplateTaskViewSet,    basename='jobtemplatetask')
router.register(r'job-template-parts',     JobTemplatePartViewSet,    basename='jobtemplatepart')
router.register(r'batch-posts',            BatchJobPostViewSet,       basename='batchpost')
router.register(r'batch-post-lines',       BatchJobPostLineViewSet,   basename='batchpostline')
router.register(r'warranty-agreements',    WarrantyAgreementViewSet,  basename='warrantyagreement')
router.register(r'warranty-claims',        WarrantyClaimViewSet,      basename='warrantyclaim')
router.register(r'supplier-price-files',   SupplierPriceFileViewSet,  basename='supplierpricefile')
router.register(r'supplier-column-maps',   SupplierColumnMapViewSet,  basename='suppliercolumnmap')
router.register(r'part-price-history',     PartPriceHistoryViewSet,   basename='partpricehistory')
router.register(r'locations',              LocationViewSet,           basename='location')
router.register(r'service-trucks',         ServiceTruckViewSet,       basename='servicetruck')
router.register(r'inventory-levels',       InventoryLevelViewSet,     basename='inventorylevel')
router.register(r'inventory-anomalies',    InventoryAnomalyViewSet,   basename='inventoryanomaly')
router.register(r'truck-transfers',        TruckStockTransferViewSet, basename='truckstocktransfer')
router.register(r'service-bays',           ServiceBayViewSet,          basename='service-bay')
router.register(r'lift-operations',        LiftOperationViewSet,       basename='lift-operation')
router.register(r'paint-records',          PaintRecordViewSet,         basename='paint-record')
router.register(r'parts-inventory',        PartsInventoryViewSet,      basename='parts-inventory')
router.register(r'subcontractors',         SubcontractorViewSet,       basename='subcontractor')

# ---------------------------------------------------------------------------
# URL patterns
# ---------------------------------------------------------------------------

# Existing path()-based patterns (Track 1–6 legacy views) — unchanged.
urlpatterns = [
    path('haul-outs/', HaulOutList.as_view()),
    path('haul-outs/<int:pk>/', HaulOutDetail.as_view()),
    path('storage-slots/', StorageSlotList.as_view()),
    path('storage-slots/<int:pk>/', StorageSlotDetail.as_view()),
    path('launch-requests/', LaunchRequestList.as_view()),
    path('launch-requests/<int:pk>/', LaunchRequestDetail.as_view()),
    path('work-orders/', WorkOrderList.as_view()),
    path('work-orders/<int:pk>/', WorkOrderDetail.as_view()),
    path('parts/', PartList.as_view()),
    path('parts/<int:pk>/', PartDetail.as_view()),
    path('tools/', ToolList.as_view()),
    path('tools/<int:pk>/', ToolDetail.as_view()),
    path('contractors/', ContractorList.as_view()),
    path('contractors/<int:pk>/', ContractorDetail.as_view()),

    # Track 5 — router-generated URLs
    path('', include(router.urls)),
]
