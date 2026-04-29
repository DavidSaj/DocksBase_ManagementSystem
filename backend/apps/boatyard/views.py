from rest_framework import generics
from .models import HaulOut, WorkOrder, Part, Tool, StorageSlot, LaunchRequest, Contractor
from .serializers import (
    HaulOutSerializer, WorkOrderSerializer, PartSerializer, ToolSerializer,
    StorageSlotSerializer, LaunchRequestSerializer, ContractorSerializer,
)


class HaulOutList(generics.ListCreateAPIView):
    serializer_class = HaulOutSerializer

    def get_queryset(self):
        return HaulOut.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class HaulOutDetail(generics.RetrieveUpdateAPIView):
    serializer_class = HaulOutSerializer

    def get_queryset(self):
        return HaulOut.objects.filter(marina=self.request.user.marina)


class StorageSlotList(generics.ListCreateAPIView):
    serializer_class = StorageSlotSerializer

    def get_queryset(self):
        return StorageSlot.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class StorageSlotDetail(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = StorageSlotSerializer

    def get_queryset(self):
        return StorageSlot.objects.filter(marina=self.request.user.marina)


class LaunchRequestList(generics.ListCreateAPIView):
    serializer_class = LaunchRequestSerializer

    def get_queryset(self):
        return LaunchRequest.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class LaunchRequestDetail(generics.RetrieveUpdateAPIView):
    serializer_class = LaunchRequestSerializer

    def get_queryset(self):
        return LaunchRequest.objects.filter(marina=self.request.user.marina)


class WorkOrderList(generics.ListCreateAPIView):
    serializer_class = WorkOrderSerializer

    def get_queryset(self):
        return WorkOrder.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class WorkOrderDetail(generics.RetrieveUpdateAPIView):
    serializer_class = WorkOrderSerializer

    def get_queryset(self):
        return WorkOrder.objects.filter(marina=self.request.user.marina)


class PartList(generics.ListCreateAPIView):
    serializer_class = PartSerializer

    def get_queryset(self):
        return Part.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class PartDetail(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = PartSerializer

    def get_queryset(self):
        return Part.objects.filter(marina=self.request.user.marina)


class ToolList(generics.ListCreateAPIView):
    serializer_class = ToolSerializer

    def get_queryset(self):
        return Tool.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class ToolDetail(generics.RetrieveUpdateAPIView):
    serializer_class = ToolSerializer

    def get_queryset(self):
        return Tool.objects.filter(marina=self.request.user.marina)


class ContractorList(generics.ListCreateAPIView):
    serializer_class = ContractorSerializer

    def get_queryset(self):
        return Contractor.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class ContractorDetail(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ContractorSerializer

    def get_queryset(self):
        return Contractor.objects.filter(marina=self.request.user.marina)
