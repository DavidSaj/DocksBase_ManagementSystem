from rest_framework import generics
from django_filters.rest_framework import DjangoFilterBackend
from .models import Invoice, Payment
from .serializers import InvoiceSerializer, PaymentSerializer


class InvoiceListCreateView(generics.ListCreateAPIView):
    serializer_class = InvoiceSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['status', 'invoice_type']

    def get_queryset(self):
        return Invoice.objects.filter(marina=self.request.user.marina).select_related('vessel', 'member').prefetch_related('payments')

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class InvoiceDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = InvoiceSerializer

    def get_queryset(self):
        return Invoice.objects.filter(marina=self.request.user.marina)


class PaymentListCreateView(generics.ListCreateAPIView):
    serializer_class = PaymentSerializer

    def get_queryset(self):
        return Payment.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)
