import csv
import datetime
import io
import threading

from django.conf import settings
from django.db.models import Sum
from django.http import HttpResponse, StreamingHttpResponse
from django.utils import timezone
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import generics, status as http_status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from . import service as billing_service
from . import stripe_service as _stripe_svc
from .models import Invoice, InvoiceLineItem, ChargeableItem, TaxRate
from .pdf_service import _generate_store_and_email_pdf
from .serializers import InvoiceSerializer, InvoiceLineItemSerializer, ChargeableItemSerializer, TaxRateSerializer
from .signals import invoice_paid
from apps.reservations.emails import send_booking_confirmed_email
from apps.reservations.models import Booking as BookingModel
import datetime as _dt
from apps.accounts.models import Marina as _Marina, EmailVerification as _EmailVerification
from apps.accounts.emails import send_verification_email as _send_verification_email
from apps.accounts.emails import send_payment_failed_email as _send_payment_failed_email


def _handle_marina_subscription_event(event_type, obj):
    customer_id = obj.get('customer')
    try:
        marina = _Marina.objects.get(stripe_customer_id=customer_id)
    except _Marina.DoesNotExist:
        return

    if event_type == 'customer.subscription.updated' and obj.get('status') in ('trialing', 'active'):
        trial_end_ts = obj.get('trial_end')
        if trial_end_ts:
            trial_ends = _dt.date.fromtimestamp(trial_end_ts)
        else:
            trial_ends = (_dt.datetime.utcnow() + _dt.timedelta(days=30)).date()
        marina.status = 'trial'
        marina.trial_ends = trial_ends
        marina.save(update_fields=['status', 'trial_ends'])

        user = marina.users.filter(role='owner').first()
        if user and not user.is_active:
            _EmailVerification.objects.filter(user=user).delete()
            token = _EmailVerification.objects.create(user=user)
            _send_verification_email(user, str(token.token))

    elif event_type == 'customer.subscription.deleted':
        marina.status = 'suspended'
        marina.save(update_fields=['status'])


def _handle_connect_account_updated(obj):
    account_id = obj.get('id')
    if not account_id:
        return
    try:
        marina = _Marina.objects.get(stripe_account_id=account_id)
    except _Marina.DoesNotExist:
        return
    if obj.get('details_submitted'):
        marina.onboarding = {**marina.onboarding, 'connect_bank': True}
        marina.save(update_fields=['onboarding'])


def _handle_marina_payment_failed(obj):
    customer_id = obj.get('customer')
    try:
        marina = _Marina.objects.get(stripe_customer_id=customer_id)
    except _Marina.DoesNotExist:
        return
    user = marina.users.filter(role='owner').first()
    if user:
        _send_payment_failed_email(user)


def _handle_reservation_payment_succeeded(obj, reservation_id):
    import logging
    from apps.reservations.models import Reservation, ReservationItem
    from apps.reservations.emails import send_reservation_confirmed_email
    _log = logging.getLogger(__name__)

    updated = Reservation.objects.filter(
        pk=reservation_id, status='pending_checkout'
    ).update(status='confirmed', paid=True)

    if updated:
        ReservationItem.objects.filter(
            reservation_id=reservation_id, status='locked'
        ).update(status='confirmed')
        try:
            res = Reservation.objects.get(pk=reservation_id)
            send_reservation_confirmed_email(res)
        except Exception:
            _log.exception('Webhook: failed to send reservation confirmation email for pk=%s', reservation_id)


def _post_payment_tasks(invoice_id):
    """Fire-and-forget: generate PDF and, if linked, confirm the booking and send the email."""
    _generate_store_and_email_pdf(invoice_id)
    try:
        inv = Invoice.objects.select_related('booking__marina').get(pk=invoice_id)
        if inv.booking_id:
            BookingModel.objects.filter(pk=inv.booking_id).update(status='confirmed')
            booking = BookingModel.objects.select_related('marina', 'berth').get(pk=inv.booking_id)
            send_booking_confirmed_email(booking)
    except Exception:
        pass  # daemon thread — log silently, don't block


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

        # Handle marina subscription lifecycle events BEFORE the invoice_id check
        if event_type in ('customer.subscription.updated', 'customer.subscription.deleted'):
            _handle_marina_subscription_event(event_type, obj)
            return HttpResponse(status=200)
        if event_type == 'invoice.payment_failed':
            _handle_marina_payment_failed(obj)
            return HttpResponse(status=200)
        if event_type == 'account.updated':
            _handle_connect_account_updated(obj)
            return HttpResponse(status=200)

        # Waitlist deposit branch — fires on payment_intent.succeeded with
        # metadata.kind == 'waitlist_deposit'. Idempotent: silently no-ops if
        # the entry is already paid.
        metadata = obj.get('metadata') or {}
        if (
            event_type == 'payment_intent.succeeded'
            and metadata.get('kind') == 'waitlist_deposit'
        ):
            entry_id = metadata.get('entry_id') or metadata.get('waitlist_entry_id')
            if entry_id:
                from apps.waitlist.services import mark_deposit_paid_from_webhook
                mark_deposit_paid_from_webhook(
                    entry_id, payment_intent_id=obj.get('id', ''),
                )
            return HttpResponse(status=200)

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
                    target=_post_payment_tasks,
                    args=(invoice.id,),
                    daemon=True,
                ).start()

        elif event_type == 'checkout.session.expired':
            invoice.stripe_checkout_session_id = ''
            invoice.save(update_fields=['stripe_checkout_session_id'])
            if invoice.booking_id:
                try:
                    BookingModel.objects.filter(pk=invoice.booking_id).update(
                        status='cancelled', berth=None
                    )
                except Exception:
                    pass

        return HttpResponse(status=200)


class StripeConnectWebhookView(APIView):
    """
    Receives checkout.session.completed / expired events fired on connected accounts.
    Stripe sends these here when the endpoint is registered as a Connect webhook.
    """
    permission_classes = [AllowAny]

    def post(self, request):
        payload = request.body
        sig_header = request.META.get('HTTP_STRIPE_SIGNATURE', '')
        try:
            event = _stripe_svc.stripe.Webhook.construct_event(
                payload, sig_header, settings.STRIPE_CONNECT_WEBHOOK_SECRET
            )
        except (ValueError, _stripe_svc.stripe.error.SignatureVerificationError):
            return HttpResponse(status=400)

        event_type = event['type']
        obj = event['data']['object']

        # Reservation cart flow — PaymentIntent metadata carries reservation_id
        reservation_id = obj.get('metadata', {}).get('reservation_id')
        if reservation_id:
            _handle_reservation_payment_succeeded(obj, reservation_id)
            return HttpResponse(status=200)

        # Waitlist deposit branch — Connect-account PaymentIntent succeeded
        metadata = obj.get('metadata') or {}
        if (
            event_type == 'payment_intent.succeeded'
            and metadata.get('kind') == 'waitlist_deposit'
        ):
            entry_id = metadata.get('entry_id') or metadata.get('waitlist_entry_id')
            if entry_id:
                from apps.waitlist.services import mark_deposit_paid_from_webhook
                mark_deposit_paid_from_webhook(
                    entry_id, payment_intent_id=obj.get('id', ''),
                )
            return HttpResponse(status=200)

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
                    target=_post_payment_tasks,
                    args=(invoice.id,),
                    daemon=True,
                ).start()

        elif event_type == 'checkout.session.expired':
            invoice.stripe_checkout_session_id = ''
            invoice.save(update_fields=['stripe_checkout_session_id'])
            if invoice.booking_id:
                try:
                    BookingModel.objects.filter(pk=invoice.booking_id).update(
                        status='cancelled', berth=None
                    )
                except Exception:
                    pass

        elif event_type == 'payment_intent.succeeded':
            updated = Invoice.objects.filter(pk=invoice.pk, status='open').update(
                stripe_payment_intent_id=obj.get('id', ''),
                status='paid',
                paid_at=timezone.now(),
            )
            if updated:
                invoice.refresh_from_db()
                invoice_paid.send(sender=Invoice, invoice=invoice)
                threading.Thread(
                    target=_post_payment_tasks,
                    args=(invoice.id,),
                    daemon=True,
                ).start()

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


class TaxRateListCreateView(generics.ListCreateAPIView):
    serializer_class = TaxRateSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        return TaxRate.objects.filter(marina=self.request.user.marina, is_archived=False)

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        tr = billing_service.create_tax_rate(
            marina=request.user.marina,
            name=serializer.validated_data['name'],
            rate=serializer.validated_data['rate'],
            is_default=serializer.validated_data.get('is_default', False),
        )
        return Response(TaxRateSerializer(tr).data, status=http_status.HTTP_201_CREATED)


class TaxRateArchiveView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            tr = TaxRate.objects.get(pk=pk, marina=request.user.marina)
        except TaxRate.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        tr.is_archived = True
        tr.is_default = False
        tr.save(update_fields=['is_archived', 'is_default'])
        return Response(TaxRateSerializer(tr).data)


class TaxRateDeleteView(generics.DestroyAPIView):
    serializer_class = TaxRateSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return TaxRate.objects.filter(marina=self.request.user.marina)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        try:
            billing_service.delete_tax_rate(instance)
        except ValueError as e:
            return Response({'detail': str(e)}, status=http_status.HTTP_409_CONFLICT)
        return Response(status=http_status.HTTP_204_NO_CONTENT)


class TaxRateSetDefaultView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            tr = TaxRate.objects.get(pk=pk, marina=request.user.marina)
        except TaxRate.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        if tr.is_archived:
            return Response({'detail': 'Archived rates cannot be set as default.'}, status=http_status.HTTP_400_BAD_REQUEST)
        billing_service.set_default_tax_rate(tr)
        return Response(TaxRateSerializer(tr).data)


class ChargeableItemListCreateView(generics.ListCreateAPIView):
    serializer_class   = ChargeableItemSerializer
    permission_classes = [IsAuthenticated]
    pagination_class   = None
    filter_backends    = [DjangoFilterBackend]
    filterset_fields   = ['category', 'is_active']

    def get_queryset(self):
        return ChargeableItem.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class ChargeableItemDetailView(generics.RetrieveUpdateAPIView):
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


class BatchInvoiceView(APIView):
    """Generate invoices in bulk for all active bookings in a billing period."""
    permission_classes = [IsAuthenticated]

    def post(self, request):
        from . import batch_service

        billing_period = request.data.get('billing_period', '').strip()
        if not billing_period or len(billing_period) != 7:
            return Response(
                {'detail': 'billing_period is required in YYYY-MM format.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        member_type = request.data.get('member_type', 'all')
        if member_type not in ('all', 'seasonal', 'transient'):
            return Response(
                {'detail': "member_type must be 'all', 'seasonal', or 'transient'."},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        chargeable_item_id = request.data.get('chargeable_item_id') or None

        try:
            result = batch_service.run_batch(
                marina=request.user.marina,
                billing_period=billing_period,
                member_type=member_type,
                chargeable_item_id=chargeable_item_id,
            )
        except ValueError as e:
            return Response({'detail': str(e)}, status=http_status.HTTP_400_BAD_REQUEST)

        return Response(result, status=http_status.HTTP_200_OK)


class ZReportView(APIView):
    """End-of-day Z-report: aggregate POS activity for a given date."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from apps.fuel_dock.models import FuelDockEntry

        date_str = request.query_params.get('date', str(datetime.date.today()))
        try:
            target_date = datetime.datetime.strptime(date_str, '%Y-%m-%d').date()
        except ValueError:
            return Response(
                {'detail': 'date must be in YYYY-MM-DD format.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        marina = request.user.marina
        lines = []
        grand_total = 0

        # Fuel breakdown by type
        fuel_labels = {'diesel': 'Diesel', 'petrol': 'Petrol', 'pump_out': 'Pump-outs'}
        fuel_rows = (
            FuelDockEntry.objects
            .filter(marina=marina, status='completed', completed_at__date=target_date)
            .values('fuel_type')
            .annotate(total=Sum('total_amount'))
            .order_by('fuel_type')
        )
        for row in fuel_rows:
            t = float(row['total'] or 0)
            lines.append({'label': fuel_labels.get(row['fuel_type'], row['fuel_type'].title()), 'total': f'{t:.2f}'})
            grand_total += t

        # Payments today on non-fuel invoices (cash / card)
        from .models import Payment
        other_rows = (
            Payment.objects
            .filter(invoice__marina=marina, paid_at__date=target_date)
            .exclude(invoice__source_type='fuel_dock')
            .values('invoice__items__chargeable_item__category')
            .annotate(total=Sum('amount'))
        )
        cat_labels = {
            'berth': 'Berth Fees', 'utility': 'Utilities',
            'service': 'Services', 'retail': 'Marina Store', None: 'Other',
        }
        cat_totals = {}
        for row in other_rows:
            cat = row['invoice__items__chargeable_item__category']
            cat_totals[cat] = cat_totals.get(cat, 0) + float(row['total'] or 0)
        for cat, t in sorted(cat_totals.items(), key=lambda x: x[0] or ''):
            lines.append({'label': cat_labels.get(cat, 'Other'), 'total': f'{t:.2f}'})
            grand_total += t

        return Response({
            'date': str(target_date),
            'lines': lines,
            'grand_total': f'{grand_total:.2f}',
        })


class InvoiceExportView(APIView):
    """Stream all invoices for this marina as a CSV download."""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        marina = request.user.marina
        invoices = (
            Invoice.objects
            .filter(marina=marina)
            .select_related('member')
            .order_by('-created_at')
        )

        def rows():
            header = io.StringIO()
            w = csv.writer(header)
            w.writerow(['Invoice #', 'Member', 'Status', 'Billing Period', 'Total', 'Due Date', 'Paid At', 'Created At'])
            yield header.getvalue()

            for inv in invoices.iterator():
                buf = io.StringIO()
                w = csv.writer(buf)
                w.writerow([
                    inv.invoice_number,
                    inv.member.name if inv.member_id else '',
                    inv.status,
                    inv.billing_period,
                    str(inv.total),
                    str(inv.due_date) if inv.due_date else '',
                    str(inv.paid_at) if inv.paid_at else '',
                    str(inv.created_at.date()),
                ])
                yield buf.getvalue()

        response = StreamingHttpResponse(rows(), content_type='text/csv')
        response['Content-Disposition'] = 'attachment; filename="invoices.csv"'
        return response


import stripe as _stripe
from config.plans import PLAN_PRICE_IDS, PRICE_ID_TO_PLAN, ENTERPRISE_ADDON_MARINA_PRICE_ID, PLAN_MONTHLY_PRICES


class SubscriptionBillingView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        marina = request.user.marina
        if not marina.stripe_subscription_id:
            return Response({'detail': 'No subscription found.'}, status=404)

        sub = _stripe.Subscription.retrieve(
            marina.stripe_subscription_id,
            expand=['default_payment_method'],
        )

        card_brand = card_last4 = None
        pm = sub.default_payment_method
        if pm:
            card_brand = pm.card.brand if pm.card else None
            card_last4 = pm.card.last4 if pm.card else None

        if not card_last4 and marina.stripe_customer_id:
            customer = _stripe.Customer.retrieve(
                marina.stripe_customer_id,
                expand=['invoice_settings.default_payment_method'],
            )
            pm = customer.invoice_settings.default_payment_method if customer.invoice_settings else None
            if pm:
                card_brand = pm.card.brand if pm.card else None
                card_last4 = pm.card.last4 if pm.card else None

        return Response({
            'plan':          marina.plan,
            'monthly_price': PLAN_MONTHLY_PRICES.get(marina.plan, 0),
            'status':        marina.status,
            'trial_ends':    marina.trial_ends,
            'next_renewal':  marina.next_renewal,
            'card_brand':    card_brand,
            'card_last4':    card_last4,
            'cancel_at_period_end': bool(sub.cancel_at_period_end),
        })


class CancelSubscriptionView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        marina = request.user.marina
        if not marina.stripe_subscription_id:
            return Response({'detail': 'No subscription found.'}, status=404)
        _stripe.Subscription.modify(
            marina.stripe_subscription_id,
            cancel_at_period_end=True,
        )
        return Response({'status': 'ok'})


class InvoiceCheckoutView(APIView):
    """Create (or reuse) a Stripe Checkout session for a payable invoice."""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            invoice = Invoice.objects.select_related('marina').get(
                pk=pk, marina=request.user.marina, status='open'
            )
        except Invoice.DoesNotExist:
            return Response(
                {'detail': 'Invoice not found or not payable.'},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        if not invoice.marina.stripe_account_id:
            return Response(
                {'detail': 'Payments not configured for this marina.'},
                status=http_status.HTTP_402_PAYMENT_REQUIRED,
            )

        if invoice.stripe_checkout_session_id:
            try:
                session = _stripe_svc.stripe.checkout.Session.retrieve(
                    invoice.stripe_checkout_session_id,
                    stripe_account=invoice.marina.stripe_account_id,
                )
                if session.status == 'open':
                    return Response({'url': session.url})
            except Exception:
                pass

        url = _stripe_svc._create_checkout_session(invoice)
        return Response({'url': url}, status=http_status.HTTP_201_CREATED)


class ChangePlanView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        plan_key = request.data.get('plan', '')
        new_price_id = PLAN_PRICE_IDS.get(plan_key, '')
        if not new_price_id:
            return Response({'detail': 'Invalid plan.'}, status=400)

        marina = request.user.marina
        if not marina.stripe_subscription_id:
            return Response({'detail': 'No subscription found.'}, status=404)

        sub = _stripe.Subscription.retrieve(marina.stripe_subscription_id)
        addon_price_ids = {ENTERPRISE_ADDON_MARINA_PRICE_ID} - {''}
        base_item = next(
            (item for item in sub['items']['data'] if item['price']['id'] not in addon_price_ids),
            None,
        )
        if not base_item:
            return Response({'detail': 'Subscription item not found.'}, status=400)

        _stripe.Subscription.modify(
            marina.stripe_subscription_id,
            items=[{'id': base_item['id'], 'price': new_price_id}],
            proration_behavior='create_prorations',
        )
        marina.plan = PRICE_ID_TO_PLAN.get(new_price_id, marina.plan)
        marina.save(update_fields=['plan'])
        return Response({'status': 'ok'})
