from rest_framework import generics, permissions
from django_filters.rest_framework import DjangoFilterBackend
from .models import Pier, Berth, MarinaMapConfig
from .serializers import PierSerializer, BerthSerializer, MarinaMapConfigSerializer


class PierListView(generics.ListAPIView):
    serializer_class = PierSerializer

    def get_queryset(self):
        return Pier.objects.filter(marina=self.request.user.marina)


class BerthListView(generics.ListAPIView):
    serializer_class = BerthSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['status', 'pier']

    def get_queryset(self):
        return Berth.objects.filter(marina=self.request.user.marina).select_related('pier', 'vessel')


class BerthDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = BerthSerializer

    def get_queryset(self):
        return Berth.objects.filter(marina=self.request.user.marina)


class MapConfigView(generics.RetrieveUpdateAPIView):
    serializer_class = MarinaMapConfigSerializer
    http_method_names = ['get', 'put', 'head', 'options']

    def get_object(self):
        obj, _ = MarinaMapConfig.objects.get_or_create(marina=self.request.user.marina)
        return obj
