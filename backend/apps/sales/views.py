from rest_framework import generics
from rest_framework.filters import SearchFilter
from django_filters.rest_framework import DjangoFilterBackend
from .models import Listing, Lead
from .serializers import ListingSerializer, LeadSerializer


class ListingListCreateView(generics.ListCreateAPIView):
    serializer_class = ListingSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ['status', 'vessel_type']
    search_fields = ['name', 'make', 'model', 'location']

    def get_queryset(self):
        return Listing.objects.filter(marina=self.request.user.marina).select_related('owner').order_by('-listed_at')

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class ListingDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = ListingSerializer

    def get_queryset(self):
        return Listing.objects.filter(marina=self.request.user.marina).select_related('owner')


class LeadListCreateView(generics.ListCreateAPIView):
    serializer_class = LeadSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ['stage', 'source', 'listing']
    search_fields = ['name', 'contact']

    def get_queryset(self):
        return Lead.objects.filter(marina=self.request.user.marina).select_related('listing').order_by('-created_at')

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class LeadDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = LeadSerializer

    def get_queryset(self):
        return Lead.objects.filter(marina=self.request.user.marina).select_related('listing')
