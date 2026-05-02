from rest_framework import generics
from rest_framework.filters import SearchFilter
from django_filters.rest_framework import DjangoFilterBackend
from .models import Event, VenueHire
from .serializers import EventSerializer, VenueHireSerializer


class EventListCreateView(generics.ListCreateAPIView):
    serializer_class = EventSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ['status', 'event_type']
    search_fields = ['name', 'organiser', 'location']

    def get_queryset(self):
        return Event.objects.filter(marina=self.request.user.marina).order_by('start_date')

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class EventDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = EventSerializer

    def get_queryset(self):
        return Event.objects.filter(marina=self.request.user.marina)


class VenueHireListCreateView(generics.ListCreateAPIView):
    serializer_class = VenueHireSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['status']

    def get_queryset(self):
        return VenueHire.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class VenueHireDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = VenueHireSerializer

    def get_queryset(self):
        return VenueHire.objects.filter(marina=self.request.user.marina)
