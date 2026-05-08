"""
apps/boatyard/viewsets.py
Track 5 — Boatyard Advanced DRF ViewSets.

All ViewSets filter by request.user.marina to enforce tenant isolation.
Custom actions use transaction.on_commit() for all Celery task dispatches.
"""

import datetime

from django.db import transaction
from django.utils import timezone
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import (
    BatchJobPost,
    BatchJobPostLine,
    BOMItem,
    BuildMilestone,
    BuildProject,
    InventoryAnomaly,
    InventoryLevel,
    JobTemplate,
    JobTemplatePart,
    JobTemplateTask,
    LiftOperation,
    Location,
    PaintRecord,
    PartsInventoryItem,
    PartPriceHistory,
    ServiceBay,
    ServiceTruck,
    Subcontractor,
    SupplierColumnMap,
    SupplierPriceFile,
    TaskDependency,
    TruckStockTransfer,
    WarrantyAgreement,
    WarrantyClaim,
    WorkOrder,
    WorkOrderTask,
)
from .serializers import (
    BatchJobPostLineSerializer,
    BatchJobPostSerializer,
    BOMItemSerializer,
    BuildMilestoneSerializer,
    BuildProjectSerializer,
    GanttTaskSerializer,
    InventoryAnomalySerializer,
    InventoryLevelSerializer,
    JobTemplatePartSerializer,
    JobTemplateSerializer,
    JobTemplateTaskSerializer,
    LiftOperationSerializer,
    LocationSerializer,
    PaintRecordSerializer,
    PartsInventoryItemSerializer,
    PartPriceHistorySerializer,
    ServiceBaySerializer,
    ServiceTruckSerializer,
    SubcontractorSerializer,
    SupplierColumnMapSerializer,
    SupplierPriceFileSerializer,
    TaskDependencySerializer,
    TruckStockTransferSerializer,
    WarrantyAgreementSerializer,
    WarrantyClaimSerializer,
    WorkOrderTaskSerializer,
)


# ---------------------------------------------------------------------------
# WorkOrder extensions
# ---------------------------------------------------------------------------

class WorkOrderViewSet(viewsets.ModelViewSet):
    """
    Extended WorkOrder ViewSet with Gantt, baseline lock, and template actions.
    """
    serializer_class = None  # views.py handles base CRUD; this adds custom actions

    def get_queryset(self):
        return WorkOrder.objects.filter(marina=self.request.user.marina)

    def get_serializer_class(self):
        from .serializers import WorkOrderSerializer
        return WorkOrderSerializer

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)

    @action(detail=True, methods=['get'])
    def gantt(self, request, pk=None):
        """Return all tasks for a WorkOrder in Gantt format (is_critical from DB)."""
        work_order = self.get_object()
        tasks = WorkOrderTask.objects.filter(
            marina=request.user.marina,
            work_order=work_order,
        ).order_by('sort_order', 'planned_start')
        serializer = GanttTaskSerializer(tasks, many=True)
        return Response(serializer.data)

    @action(detail=True, methods=['post'])
    def lock_baseline(self, request, pk=None):
        """
        Copy planned_start/planned_end to baseline_start/baseline_end for all
        tasks on this WorkOrder.  Existing baselines are overwritten.
        """
        work_order = self.get_object()
        tasks = list(
            WorkOrderTask.objects.filter(
                marina=request.user.marina,
                work_order=work_order,
            )
        )
        for task in tasks:
            task.baseline_start = task.planned_start
            task.baseline_end   = task.planned_end

        WorkOrderTask.objects.bulk_update(tasks, ['baseline_start', 'baseline_end'])
        return Response({'locked': len(tasks)})

    @action(detail=True, methods=['post'])
    def apply_template(self, request, pk=None):
        """
        Apply a JobTemplate to this WorkOrder.

        Expected body: { "template_id": <int>, "start_date": "YYYY-MM-DD" }
        """
        from .services import apply_template_to_work_order
        from .models import JobTemplate

        work_order = self.get_object()
        template_id = request.data.get('template_id')
        start_date_raw = request.data.get('start_date')

        if not template_id:
            return Response({'error': 'template_id is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if not start_date_raw:
            return Response({'error': 'start_date is required.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            template = JobTemplate.objects.get(pk=template_id, marina=request.user.marina)
        except JobTemplate.DoesNotExist:
            return Response({'error': 'JobTemplate not found.'}, status=status.HTTP_404_NOT_FOUND)

        try:
            start_date = datetime.date.fromisoformat(start_date_raw)
        except ValueError:
            return Response({'error': 'Invalid start_date format (expected YYYY-MM-DD).'}, status=status.HTTP_400_BAD_REQUEST)

        result = apply_template_to_work_order(work_order, template, start_date)
        return Response(result, status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------
# WorkOrderTask
# ---------------------------------------------------------------------------

class WorkOrderTaskViewSet(viewsets.ModelViewSet):
    serializer_class = WorkOrderTaskSerializer

    def get_queryset(self):
        qs = WorkOrderTask.objects.filter(marina=self.request.user.marina)
        wo_id = self.request.query_params.get('work_order')
        if wo_id:
            qs = qs.filter(work_order_id=wo_id)
        return qs

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


# ---------------------------------------------------------------------------
# TaskDependency
# ---------------------------------------------------------------------------

class TaskDependencyViewSet(viewsets.ModelViewSet):
    serializer_class = TaskDependencySerializer

    def get_queryset(self):
        return TaskDependency.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


# ---------------------------------------------------------------------------
# BuildProject
# ---------------------------------------------------------------------------

class BuildProjectViewSet(viewsets.ModelViewSet):
    serializer_class = BuildProjectSerializer

    def get_queryset(self):
        return BuildProject.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)

    @action(detail=True, methods=['get', 'post'], url_path='bom')
    def bom(self, request, pk=None):
        """List or create BOM items for a BuildProject."""
        build_project = self.get_object()
        if request.method == 'GET':
            items = BOMItem.objects.filter(
                marina=request.user.marina,
                build_project=build_project,
            )
            serializer = BOMItemSerializer(items, many=True)
            return Response(serializer.data)
        else:
            data = request.data.copy()
            data['build_project'] = build_project.pk
            serializer = BOMItemSerializer(data=data)
            serializer.is_valid(raise_exception=True)
            serializer.save(marina=request.user.marina, build_project=build_project)
            return Response(serializer.data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get', 'post'], url_path='milestones')
    def milestones(self, request, pk=None):
        """List or create milestones for a BuildProject."""
        build_project = self.get_object()
        if request.method == 'GET':
            milestones = BuildMilestone.objects.filter(
                marina=request.user.marina,
                build_project=build_project,
            )
            serializer = BuildMilestoneSerializer(milestones, many=True)
            return Response(serializer.data)
        else:
            data = request.data.copy()
            data['build_project'] = build_project.pk
            serializer = BuildMilestoneSerializer(data=data)
            serializer.is_valid(raise_exception=True)
            serializer.save(marina=request.user.marina, build_project=build_project)
            return Response(serializer.data, status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------
# BOMItem
# ---------------------------------------------------------------------------

class BOMItemViewSet(viewsets.ModelViewSet):
    serializer_class = BOMItemSerializer

    def get_queryset(self):
        return BOMItem.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


# ---------------------------------------------------------------------------
# BuildMilestone
# ---------------------------------------------------------------------------

class BuildMilestoneViewSet(viewsets.ModelViewSet):
    serializer_class = BuildMilestoneSerializer

    def get_queryset(self):
        return BuildMilestone.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)

    @action(detail=True, methods=['post'])
    def complete(self, request, pk=None):
        """
        Mark a milestone as complete and create the corresponding invoice.

        Expected body: { "actual_date": "YYYY-MM-DD" }
        """
        from .services import complete_build_milestone

        milestone = self.get_object()
        actual_date_raw = request.data.get('actual_date')
        if not actual_date_raw:
            return Response(
                {'error': 'actual_date is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            actual_date = datetime.date.fromisoformat(actual_date_raw)
        except ValueError:
            return Response(
                {'error': 'Invalid actual_date format (expected YYYY-MM-DD).'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        invoice = complete_build_milestone(milestone, actual_date)
        return Response(
            {'invoice_id': invoice.pk, 'invoice_number': invoice.invoice_number},
            status=status.HTTP_201_CREATED,
        )


# ---------------------------------------------------------------------------
# JobTemplate
# ---------------------------------------------------------------------------

class JobTemplateViewSet(viewsets.ModelViewSet):
    serializer_class = JobTemplateSerializer

    def get_queryset(self):
        return JobTemplate.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class JobTemplateTaskViewSet(viewsets.ModelViewSet):
    serializer_class = JobTemplateTaskSerializer

    def get_queryset(self):
        return JobTemplateTask.objects.filter(
            template__marina=self.request.user.marina
        )


class JobTemplatePartViewSet(viewsets.ModelViewSet):
    serializer_class = JobTemplatePartSerializer

    def get_queryset(self):
        return JobTemplatePart.objects.filter(
            template__marina=self.request.user.marina
        )


# ---------------------------------------------------------------------------
# BatchJobPost
# ---------------------------------------------------------------------------

class BatchJobPostViewSet(viewsets.ModelViewSet):
    serializer_class = BatchJobPostSerializer

    def get_queryset(self):
        return BatchJobPost.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(
            marina=self.request.user.marina,
            posted_by=str(self.request.user),
        )


class BatchJobPostLineViewSet(viewsets.ModelViewSet):
    serializer_class = BatchJobPostLineSerializer

    def get_queryset(self):
        return BatchJobPostLine.objects.filter(
            batch__marina=self.request.user.marina
        )


# ---------------------------------------------------------------------------
# WarrantyAgreement
# ---------------------------------------------------------------------------

class WarrantyAgreementViewSet(viewsets.ModelViewSet):
    serializer_class = WarrantyAgreementSerializer

    def get_queryset(self):
        return WarrantyAgreement.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


# ---------------------------------------------------------------------------
# WarrantyClaim
# ---------------------------------------------------------------------------

class WarrantyClaimViewSet(viewsets.ModelViewSet):
    serializer_class = WarrantyClaimSerializer

    def get_queryset(self):
        return WarrantyClaim.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)

    def partial_update(self, request, *args, **kwargs):
        """
        On status → 'reimbursed', dispatch post_warranty_gl_entry via on_commit.
        """
        instance = self.get_object()
        previous_status = instance.status
        response = super().partial_update(request, *args, **kwargs)

        if (
            previous_status != WarrantyClaim.Status.REIMBURSED
            and request.data.get('status') == WarrantyClaim.Status.REIMBURSED
        ):
            from .tasks import post_warranty_gl_entry
            claim_id = instance.pk
            transaction.on_commit(lambda: post_warranty_gl_entry.delay(claim_id))

        return response

    @action(detail=True, methods=['post'])
    def submit(self, request, pk=None):
        """
        Transition a WarrantyClaim to 'submitted' status and dispatch
        generate_warranty_claim_pdf via transaction.on_commit().
        """
        from .tasks import generate_warranty_claim_pdf

        claim = self.get_object()
        if claim.status != WarrantyClaim.Status.DRAFT:
            return Response(
                {'error': 'Only draft claims can be submitted.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            claim.status = WarrantyClaim.Status.SUBMITTED
            claim.submitted_at = timezone.now()
            claim.save(update_fields=['status', 'submitted_at'])
            claim_id = claim.pk
            transaction.on_commit(lambda: generate_warranty_claim_pdf.delay(claim_id))

        serializer = self.get_serializer(claim)
        return Response(serializer.data)


# ---------------------------------------------------------------------------
# SupplierPriceFile
# ---------------------------------------------------------------------------

class SupplierPriceFileViewSet(viewsets.ModelViewSet):
    serializer_class = SupplierPriceFileSerializer

    def get_queryset(self):
        return SupplierPriceFile.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(
            marina=self.request.user.marina,
            imported_by=str(self.request.user),
        )

    @action(detail=True, methods=['post'], url_path='confirm-mapping')
    def confirm_mapping(self, request, pk=None):
        """
        Upsert SupplierColumnMap for this supplier, then enqueue the import
        via import_supplier_price_file (dispatched via on_commit).

        Expected body: { "mapping": { "part_no": "col_a", "unit_cost": "price" } }
        """
        from .tasks import import_supplier_price_file

        price_file = self.get_object()
        mapping = request.data.get('mapping')
        if not isinstance(mapping, dict):
            return Response(
                {'error': 'mapping must be a JSON object.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            SupplierColumnMap.objects.update_or_create(
                marina=request.user.marina,
                supplier_name=price_file.supplier_name,
                defaults={'mapping': mapping},
            )
            price_file.status = SupplierPriceFile.ImportStatus.QUEUED
            price_file.save(update_fields=['status'])
            pf_id = price_file.pk
            transaction.on_commit(lambda: import_supplier_price_file.delay(pf_id))

        return Response({'queued': True, 'price_file_id': price_file.pk})


# ---------------------------------------------------------------------------
# SupplierColumnMap
# ---------------------------------------------------------------------------

class SupplierColumnMapViewSet(viewsets.ModelViewSet):
    serializer_class = SupplierColumnMapSerializer

    def get_queryset(self):
        return SupplierColumnMap.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


# ---------------------------------------------------------------------------
# PartPriceHistory
# ---------------------------------------------------------------------------

class PartPriceHistoryViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PartPriceHistorySerializer

    def get_queryset(self):
        return PartPriceHistory.objects.filter(marina=self.request.user.marina)

    @action(detail=True, methods=['post'])
    def approve(self, request, pk=None):
        """
        Approve a PartPriceHistory entry: set applied=True and update
        Part.unit_cost to the new price.
        """
        history = self.get_object()
        if history.applied:
            return Response(
                {'error': 'This price change has already been applied.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        with transaction.atomic():
            history.part.unit_cost = history.new_unit_cost
            history.part.save(update_fields=['unit_cost'])
            history.applied = True
            history.save(update_fields=['applied'])

        serializer = self.get_serializer(history)
        return Response(serializer.data)


# ---------------------------------------------------------------------------
# Location
# ---------------------------------------------------------------------------

class LocationViewSet(viewsets.ModelViewSet):
    serializer_class = LocationSerializer

    def get_queryset(self):
        return Location.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


# ---------------------------------------------------------------------------
# ServiceTruck
# ---------------------------------------------------------------------------

class ServiceTruckViewSet(viewsets.ModelViewSet):
    serializer_class = ServiceTruckSerializer

    def get_queryset(self):
        return ServiceTruck.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


# ---------------------------------------------------------------------------
# InventoryLevel
# ---------------------------------------------------------------------------

class InventoryLevelViewSet(viewsets.ModelViewSet):
    serializer_class = InventoryLevelSerializer

    def get_queryset(self):
        return InventoryLevel.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


# ---------------------------------------------------------------------------
# InventoryAnomaly
# ---------------------------------------------------------------------------

class InventoryAnomalyViewSet(viewsets.ModelViewSet):
    serializer_class = InventoryAnomalySerializer

    def get_queryset(self):
        return InventoryAnomaly.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


# ---------------------------------------------------------------------------
# TruckStockTransfer
# ---------------------------------------------------------------------------

class TruckStockTransferViewSet(viewsets.ModelViewSet):
    serializer_class = TruckStockTransferSerializer

    def get_queryset(self):
        return TruckStockTransfer.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        """
        Save the transfer then call execute_transfer() to update inventory
        levels atomically.  execute_transfer() handles its own transaction.
        """
        from .services import execute_transfer

        transfer = serializer.save(marina=self.request.user.marina)
        execute_transfer(transfer)


# ---------------------------------------------------------------------------
# Track 5 — Service Operations ViewSets
# ---------------------------------------------------------------------------

class ServiceBayViewSet(viewsets.ModelViewSet):
    """CRUD for physical service bays in the boatyard."""
    serializer_class = ServiceBaySerializer

    def get_queryset(self):
        return ServiceBay.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class LiftOperationViewSet(viewsets.ModelViewSet):
    """CRUD for crane/travelift operations. Filters: ?status= ?lift_type="""
    serializer_class = LiftOperationSerializer

    def get_queryset(self):
        qs = LiftOperation.objects.filter(
            marina=self.request.user.marina
        ).select_related('vessel')
        if self.request.query_params.get('status'):
            qs = qs.filter(status=self.request.query_params['status'])
        if self.request.query_params.get('lift_type'):
            qs = qs.filter(lift_type=self.request.query_params['lift_type'])
        return qs

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class PaintRecordViewSet(viewsets.ModelViewSet):
    """CRUD for paint application records."""
    serializer_class = PaintRecordSerializer

    def get_queryset(self):
        qs = PaintRecord.objects.filter(
            marina=self.request.user.marina
        ).select_related('vessel')
        if self.request.query_params.get('vessel'):
            qs = qs.filter(vessel_id=self.request.query_params['vessel'])
        return qs

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class PartsInventoryViewSet(viewsets.ModelViewSet):
    """CRUD for boatyard parts inventory stock (distinct from work-order parts)."""
    serializer_class = PartsInventoryItemSerializer

    def get_queryset(self):
        qs = PartsInventoryItem.objects.filter(marina=self.request.user.marina)
        if self.request.query_params.get('category'):
            qs = qs.filter(category=self.request.query_params['category'])
        return qs

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class SubcontractorViewSet(viewsets.ModelViewSet):
    """CRUD for external subcontractors used by the boatyard."""
    serializer_class = SubcontractorSerializer

    def get_queryset(self):
        return Subcontractor.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)
