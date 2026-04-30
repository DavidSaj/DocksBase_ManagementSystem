from django.utils import timezone
from django.db import transaction
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import Task, Incident, Asset, Defect, MaintenanceTask
from .serializers import (
    TaskSerializer, IncidentSerializer, AssetSerializer,
    DefectSerializer, MaintenanceTaskSerializer,
)


class TaskList(generics.ListCreateAPIView):
    serializer_class = TaskSerializer

    def get_queryset(self):
        return Task.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class TaskDetail(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = TaskSerializer

    def get_queryset(self):
        return Task.objects.filter(marina=self.request.user.marina)


class IncidentList(generics.ListCreateAPIView):
    serializer_class = IncidentSerializer

    def get_queryset(self):
        return Incident.objects.filter(marina=self.request.user.marina).select_related('vessel', 'berth')

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class IncidentDetail(generics.RetrieveUpdateAPIView):
    serializer_class = IncidentSerializer

    def get_queryset(self):
        return Incident.objects.filter(marina=self.request.user.marina).select_related('vessel', 'berth')


class AssetList(generics.ListCreateAPIView):
    serializer_class = AssetSerializer

    def get_queryset(self):
        return Asset.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class AssetDetail(generics.RetrieveUpdateAPIView):
    serializer_class = AssetSerializer

    def get_queryset(self):
        return Asset.objects.filter(marina=self.request.user.marina)


class DefectList(generics.ListCreateAPIView):
    serializer_class = DefectSerializer

    def get_queryset(self):
        return Defect.objects.filter(marina=self.request.user.marina).select_related('asset')

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class DefectDetail(generics.RetrieveUpdateAPIView):
    serializer_class = DefectSerializer

    def get_queryset(self):
        return Defect.objects.filter(marina=self.request.user.marina).select_related('asset')


class DefectCreateTaskView(APIView):
    def post(self, request, pk):
        with transaction.atomic():
            try:
                defect = Defect.objects.select_for_update().get(pk=pk, marina=request.user.marina)
            except Defect.DoesNotExist:
                return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

            if MaintenanceTask.objects.filter(defect=defect).exists():
                return Response(
                    {'detail': 'A maintenance task already exists for this defect.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            if defect.status != 'acknowledged':
                return Response(
                    {'detail': 'Defect must be acknowledged before raising a task.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )

            task = MaintenanceTask.objects.create(
                marina=request.user.marina,
                defect=defect,
                asset=defect.asset,
                title=defect.description[:100],
                description=defect.description,
                priority='high' if defect.severity in ('high', 'critical') else 'medium',
                status='pending',
            )
            defect.status = 'in_progress'
            defect.save()

            return Response(MaintenanceTaskSerializer(task).data, status=status.HTTP_201_CREATED)


class MaintenanceTaskList(generics.ListCreateAPIView):
    serializer_class = MaintenanceTaskSerializer

    def get_queryset(self):
        return MaintenanceTask.objects.filter(marina=self.request.user.marina).select_related('asset')

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class MaintenanceTaskDetail(generics.RetrieveUpdateAPIView):
    serializer_class = MaintenanceTaskSerializer

    def get_queryset(self):
        return MaintenanceTask.objects.filter(marina=self.request.user.marina).select_related('asset')

    def perform_update(self, serializer):
        instance = self.get_object()
        if (serializer.validated_data.get('status') == 'completed'
                and not instance.completed_at):
            serializer.save(completed_at=timezone.now())
        else:
            serializer.save()
