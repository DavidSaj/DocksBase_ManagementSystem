from django.db import transaction
from django.db.models import F
from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import (
    ChecklistItem,
    CleaningSchedule,
    ConsumableStock,
    HousekeepingTask,
    LinenInventory,
    TaskChecklistCompletion,
    TaskPhoto,
)
from .serializers import (
    ChecklistItemSerializer,
    CleaningScheduleSerializer,
    ConsumableStockSerializer,
    HousekeepingTaskSerializer,
    LinenInventorySerializer,
    TaskChecklistCompletionSerializer,
    TaskPhotoSerializer,
)
from .services import advance_task_status, escalate_to_defect, populate_task_checklist


class HousekeepingTaskViewSet(viewsets.ModelViewSet):
    """
    CRUD for housekeeping tasks with status machine actions.

    Filters: ?status=dirty|in_progress|...  ?unit_type=vessel|...
             ?date=YYYY-MM-DD  ?assigned_to=<staff_id>
    """
    permission_classes = [IsAuthenticated]
    serializer_class   = HousekeepingTaskSerializer

    def get_queryset(self):
        qs = HousekeepingTask.objects.filter(
            marina=self.request.user.marina
        ).select_related('assigned_to', 'supervisor').prefetch_related('checklist', 'photos')

        # Filters
        status_val   = self.request.query_params.get('status')
        unit_type    = self.request.query_params.get('unit_type')
        date_val     = self.request.query_params.get('date')
        assigned_to  = self.request.query_params.get('assigned_to')

        if status_val:
            qs = qs.filter(status=status_val)
        if unit_type:
            qs = qs.filter(unit_type=unit_type)
        if date_val:
            qs = qs.filter(triggered_at__date=date_val)
        if assigned_to:
            qs = qs.filter(assigned_to_id=assigned_to)

        return qs

    def perform_create(self, serializer):
        task = serializer.save(marina=self.request.user.marina)
        # If task is immediately assigned, pre-populate checklist items
        if task.assigned_to_id:
            populate_task_checklist(task)

    def perform_update(self, serializer):
        old_assigned = self.get_object().assigned_to_id
        task = serializer.save()
        # Populate checklist when task is first assigned
        if not old_assigned and task.assigned_to_id:
            if not task.checklist.exists():
                populate_task_checklist(task)

    @action(detail=True, methods=['post'], url_path='advance')
    def advance(self, request, pk=None):
        """
        Advance task through status machine:
          dirty -> in_progress -> ready_inspection -> clean -> ready_guest

        Response: updated task serialization.
        """
        task = self.get_object()
        try:
            updated_task = advance_task_status(task)
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        serializer = self.get_serializer(updated_task)
        return Response(serializer.data)

    @action(
        detail=True, methods=['post'],
        url_path='photos',
        parser_classes=[MultiPartParser],
    )
    def photos(self, request, pk=None):
        """
        Upload a photo for this task.
        Multipart body: photo_type, image, caption (optional), taken_by (optional staff_id).
        """
        task = self.get_object()
        serializer = TaskPhotoSerializer(data=request.data)
        if serializer.is_valid():
            serializer.save(task=task)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['post'], url_path='escalate-defect')
    def escalate_defect(self, request, pk=None):
        """
        Escalate this housekeeping task to a maintenance.Defect.
        Body: { "description": "...", "severity": "low|medium|high|critical" }
        Response: { "defect_id": 42 }
        """
        task = self.get_object()
        description = request.data.get('description', '')
        severity    = request.data.get('severity', 'medium')

        valid_severities = ('low', 'medium', 'high', 'critical')
        if severity not in valid_severities:
            return Response(
                {'detail': f'severity must be one of {valid_severities}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        defect = escalate_to_defect(task, description=description, severity=severity)
        return Response({'defect_id': defect.pk}, status=status.HTTP_201_CREATED)

    @action(
        detail=True, methods=['patch'],
        url_path=r'checklist/(?P<item_pk>[^/.]+)',
    )
    def checklist_item(self, request, pk=None, item_pk=None):
        """
        Toggle or update a single checklist completion item.
        PATCH /tasks/{id}/checklist/{item_pk}/  { "is_done": true/false }
        Response: updated TaskChecklistCompletion.
        """
        task = self.get_object()
        try:
            item = TaskChecklistCompletion.objects.get(pk=item_pk, task=task)
        except TaskChecklistCompletion.DoesNotExist:
            return Response({'detail': 'Checklist item not found.'}, status=status.HTTP_404_NOT_FOUND)

        is_done = request.data.get('is_done')
        if is_done is None:
            return Response({'detail': '`is_done` is required.'}, status=status.HTTP_400_BAD_REQUEST)

        from django.utils import timezone as tz
        item.is_done = bool(is_done)
        item.completed_at = tz.now() if item.is_done else None
        item.save(update_fields=['is_done', 'completed_at'])

        serializer = TaskChecklistCompletionSerializer(item)
        return Response(serializer.data)


class HousekeepingMatrixView(APIView):
    """
    Matrix dashboard: units × date range with task status per cell.

    Query params: ?from=YYYY-MM-DD&to=YYYY-MM-DD

    Returns:
      {
        "dates": ["2026-07-15", ...],
        "units": [
          {
            "unit_id": "vessel-42",
            "unit_label": "Sea Sprite",
            "unit_type": "vessel",
            "cells": {
              "2026-07-15": {"task_id": 101, "status": "dirty", "assigned_to": "Maria L."},
              "2026-07-16": {"task_id": null, "status": null, "assigned_to": null}
            }
          }
        ]
      }

    Uses values()/annotate() for efficient queryset evaluation rather than Python-level
    nested loops — avoids N+1 queries on large datasets.
    """
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from datetime import date, timedelta

        date_from_str = request.query_params.get('from')
        date_to_str   = request.query_params.get('to')

        if not date_from_str or not date_to_str:
            return Response(
                {'detail': 'Both ?from=YYYY-MM-DD and ?to=YYYY-MM-DD are required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            date_from = date.fromisoformat(date_from_str)
            date_to   = date.fromisoformat(date_to_str)
        except ValueError:
            return Response(
                {'detail': 'Invalid date format. Use YYYY-MM-DD.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if (date_to - date_from).days > 90:
            return Response(
                {'detail': 'Date range may not exceed 90 days.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Build date list
        dates = []
        current = date_from
        while current <= date_to:
            dates.append(current.isoformat())
            current += timedelta(days=1)

        # Fetch all tasks in the range — use values() to avoid model instantiation overhead
        tasks_qs = HousekeepingTask.objects.filter(
            marina=request.user.marina,
            triggered_at__date__gte=date_from,
            triggered_at__date__lte=date_to,
        ).values(
            'id', 'unit_id', 'unit_label', 'unit_type',
            'status', 'triggered_at', 'assigned_to__name',
        )

        # Index by (unit_id, date_str) for O(1) lookup during matrix build
        task_index = {}
        unit_meta  = {}
        for row in tasks_qs:
            date_str = row['triggered_at'].date().isoformat()
            key = (row['unit_id'], date_str)
            task_index[key] = {
                'task_id':    row['id'],
                'status':     row['status'],
                'assigned_to': row['assigned_to__name'],
            }
            if row['unit_id'] not in unit_meta:
                unit_meta[row['unit_id']] = {
                    'unit_id':    row['unit_id'],
                    'unit_label': row['unit_label'],
                    'unit_type':  row['unit_type'],
                }

        # Build matrix
        units_output = []
        for unit_id, meta in unit_meta.items():
            cells = {}
            for date_str in dates:
                cells[date_str] = task_index.get(
                    (unit_id, date_str),
                    {'task_id': None, 'status': None, 'assigned_to': None},
                )
            units_output.append({**meta, 'cells': cells})

        return Response({'dates': dates, 'units': units_output})


class ChecklistTemplateViewSet(viewsets.ModelViewSet):
    """CRUD for marina's checklist item templates."""
    permission_classes = [IsAuthenticated]
    serializer_class   = ChecklistItemSerializer

    def get_queryset(self):
        return ChecklistItem.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class LinenInventoryViewSet(viewsets.ModelViewSet):
    """
    List / retrieve / partial_update for linen inventory.
    PATCH uses delta-based updates via F() expressions — never direct field assignment.
    Accepts: { "qty_clean_delta": N, "qty_dirty_delta": N }
    """
    permission_classes = [IsAuthenticated]
    serializer_class   = LinenInventorySerializer
    http_method_names  = ['get', 'patch', 'head', 'options']

    def get_queryset(self):
        return LinenInventory.objects.filter(
            marina=self.request.user.marina
        ).select_related('linen_set')

    def perform_update(self, serializer):
        instance = self.get_object()
        qty_clean_delta = int(self.request.data.get('qty_clean_delta', 0))
        qty_dirty_delta = int(self.request.data.get('qty_dirty_delta', 0))

        with transaction.atomic():
            LinenInventory.objects.filter(pk=instance.pk).update(
                qty_clean=F('qty_clean') + qty_clean_delta,
                qty_dirty=F('qty_dirty') + qty_dirty_delta,
            )
        # Return updated record
        instance.refresh_from_db()
        serializer.instance = instance


class ConsumableStockViewSet(viewsets.ModelViewSet):
    """
    CRUD for consumable stock levels.
    Stock depletion is recorded via ConsumableUsage (linked to a task).
    PATCH on this endpoint is for manual replenishment (receiving a delivery) only.
    """
    permission_classes = [IsAuthenticated]
    serializer_class   = ConsumableStockSerializer

    def get_queryset(self):
        return ConsumableStock.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class CleaningScheduleViewSet(viewsets.ModelViewSet):
    """
    CRUD for recurring cleaning schedules.
    Each schedule drives automatic housekeeping task creation every `interval_days` days.
    """
    permission_classes = [IsAuthenticated]
    serializer_class   = CleaningScheduleSerializer

    def get_queryset(self):
        return CleaningSchedule.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)
