import threading

from django.conf import settings
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import generics, status as http_status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import service as billing_service
from . import stripe_service as _stripe_svc
from .models import Invoice, InvoiceLineItem, ChargeableItem
from .pdf_service import _generate_store_and_email_pdf
from .serializers import InvoiceSerializer, InvoiceLineItemSerializer, ChargeableItemSerializer
from .signals import invoice_paid


class StripeWebhookView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        payload = request.body
        sig_header = request.META.get('HTTP_STRIPE_SIGNATURE', '')
        try:
            event = _stripe_svc.stripe.Webhook.construct_event(
                payload, sig_header, settings.STRIPE_WEBHOOK_SECRET
            )
        except (ValueError, _stripe_svc.stripe.error.SignatureVerificationError):
            return HttpResponse(status=400)

        event_type = event['type']
        obj = event['data']['object']
        invoice_id = obj.get('metadata', {}).get('invoice_id')
        if not invoice_id:
            return HttpResponse(status=200)

        try:
            invoice = Invoice.objects.get(pk=invoice_id)
        except Invoice.DoesNotExist:
            return HttpResponse(status=200)

        if event_type == 'checkout.session.completed':
            updated = Invoice.objects.filter(pk=invoice.pk, status='open').update(
                stripe_payment_intent_id=obj.get('payment_intent', ''),
                status='paid',
                paid_at=timezone.now(),
            )
            if updated:
                invoice.refresh_from_db()
                invoice_paid.send(sender=Invoice, invoice=invoice)
                threading.Thread(
                    target=_generate_store_and_email_pdf,
                    args=(invoice.id,),
                    daemon=True,
                ).start()

        elif event_type == 'checkout.session.expired':
            invoice.stripe_checkout_session_id = ''
            invoice.save(update_fields=['stripe_checkout_session_id'])

        return HttpResponse(status=200)


class InvoiceListView(generics.ListAPIView):
    serializer_class = InvoiceSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        return Invoice.objects.filter(
            marina=self.request.user.marina
        ).select_related('member').prefetch_related('items', 'payments')


class InvoiceDetailView(generics.RetrieveAPIView):
    serializer_class = InvoiceSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Invoice.objects.filter(
            marina=self.request.user.marina
        ).select_related('member').prefetch_related('items', 'payments')


class MarkPaidView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request, pk):
        try:
            invoice = Invoice.objects.get(pk=pk, marina=request.user.marina)
        except Invoice.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        try:
            billing_service.mark_paid_manual(invoice, request.data.get('method'))
        except ValueError as e:
            return Response({'detail': str(e)}, status=http_status.HTTP_400_BAD_REQUEST)
        return Response(InvoiceSerializer(invoice).data)


class FromOrderView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        order_id = request.data.get('order_id')
        if not order_id:
            return Response({'detail': 'order_id required.'}, status=http_status.HTTP_400_BAD_REQUEST)
        try:
            from apps.restaurant.models import Order
            order = Order.objects.prefetch_related('items__menu_item').get(
                pk=order_id, marina=request.user.marina
            )
        except Order.DoesNotExist:
            return Response({'detail': 'Order not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        existing = Invoice.objects.filter(
            marina=request.user.marina,
            source_type='restaurant_order',
            source_id=str(order_id),
        ).exclude(status='void').first()
        if existing:
            return Response(InvoiceSerializer(existing).data, status=http_status.HTTP_200_OK)

        invoice = billing_service.create_invoice(
            request.user.marina,
            source_type='restaurant_order',
            source_id=str(order.id),
        )
        for item in order.items.all():
            billing_service.add_line_item(
                invoice,
                description=item.menu_item.name,
                quantity=item.quantity,
                unit_price=item.menu_item.price,
            )
        billing_service.finalize_invoice(invoice)
        invoice.refresh_from_db()
        return Response(InvoiceSerializer(invoice).data, status=http_status.HTTP_201_CREATED)


class PDFDownloadView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        try:
            invoice = Invoice.objects.get(pk=pk, marina=request.user.marina)
        except Invoice.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        if not invoice.pdf_document:
            return Response({'detail': 'PDF not yet generated.'}, status=http_status.HTTP_404_NOT_FOUND)
        return Response({'pdf_url': invoice.pdf_document.url})


class HTMLReceiptView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        from django.shortcuts import render
        try:
            invoice = Invoice.objects.prefetch_related('items').select_related('marina', 'member').get(
                pk=pk, marina=request.user.marina
            )
        except Invoice.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        return render(request, 'billing/invoice_pdf.html', {'invoice': invoice})


class ChargeableItemListCreateView(generics.ListCreateAPIView):
    serializer_class   = ChargeableItemSerializer
    permission_classes = [IsAuthenticated]
    pagination_class   = None

    def get_queryset(self):
        return ChargeableItem.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class ChargeableItemDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class   = ChargeableItemSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return ChargeableItem.objects.filter(marina=self.request.user.marina)


class InvoiceCreateView(APIView):
    """Create a blank draft invoice for the manual invoice flow."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from apps.members.models import Member
        member = None
        member_id = request.data.get('member_id')
        if member_id:
            try:
                member = Member.objects.get(pk=member_id, marina=request.user.marina)
            except Member.DoesNotExist:
                pass
        due_date    = request.data.get('due_date') or None
        source_type = request.data.get('source_type', 'manual')
        source_id   = request.data.get('source_id', '')
        invoice = billing_service.create_invoice(
            marina=request.user.marina,
            member=member,
            source_type=source_type,
            source_id=source_id,
            due_date=due_date,
        )
        return Response(InvoiceSerializer(invoice).data, status=http_status.HTTP_201_CREATED)


class AddLineItemView(APIView):
    """Add a line item from the Service Catalog to a draft invoice (snapshots price + tax)."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            invoice = Invoice.objects.get(pk=pk, marina=request.user.marina)
        except Invoice.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        item_id  = request.data.get('chargeable_item_id')
        quantity = request.data.get('quantity', 1)

        try:
            item = ChargeableItem.objects.get(pk=item_id, marina=request.user.marina)
        except ChargeableItem.DoesNotExist:
            return Response({'detail': 'Chargeable item not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        try:
            line = billing_service.add_line_item_from_catalog(invoice, item, quantity)
        except ValueError as e:
            return Response({'detail': str(e)}, status=http_status.HTTP_400_BAD_REQUEST)

        return Response(InvoiceLineItemSerializer(line).data, status=http_status.HTTP_201_CREATED)


class RemoveLineItemView(APIView):
    """Remove a line item from a draft invoice."""
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        try:
            line = InvoiceLineItem.objects.select_related('invoice').get(
                pk=pk, invoice__marina=request.user.marina
            )
        except InvoiceLineItem.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        if line.invoice.status != 'draft':
            return Response(
                {'detail': 'Can only remove items from draft invoices.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        line.delete()
        return Response(status=http_status.HTTP_204_NO_CONTENT)


class FinalizeInvoiceView(APIView):
    """Finalize a draft invoice — status becomes open, totals are locked."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            invoice = Invoice.objects.get(pk=pk, marina=request.user.marina)
        except Invoice.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        try:
            invoice = billing_service.finalize_invoice(invoice)
        except ValueError as e:
            return Response({'detail': str(e)}, status=http_status.HTTP_400_BAD_REQUEST)
        return Response(InvoiceSerializer(invoice).data)
