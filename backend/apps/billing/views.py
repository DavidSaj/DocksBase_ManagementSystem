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
from .models import Invoice, InvoiceLineItem, ChargeableItem, TaxRate, Refund
from .pdf_service import _generate_store_and_email_pdf
from .serializers import (
    InvoiceSerializer, InvoiceLineItemSerializer, ChargeableItemSerializer,
    TaxRateSerializer, RefundSerializer,
)
from .signals import invoice_paid
from apps.reservations.emails import send_booking_confirmed_email
from apps.reservations.models import Booking as BookingModel
import datetime as _dt
from apps.accounts.models import Marina as _Marina, EmailVerification as _EmailVerification
from apps.accounts.emails import send_verification_email as _send_verification_email
from apps.accounts.emails import send_payment_failed_email as _send_payment_failed_email


def _handle_marina_subscription_event(event_type, obj, event_id=''):
    """
    Subscription lifecycle handler. Drives BOTH the legacy `Marina.status`
    flow (for backwards compatibility) AND the new `billing_state` machine
    via `apps.billing.gates`.

    TRAP 1 — Out-of-order webhook race:
    We pass the Stripe object's CURRENT `status` field to the gates
    module. The gates module decides the target state from the embedded
    ground-truth status, not from the event type. See gates.apply_subscription_truth.
    """
    customer_id = obj.get('customer')
    try:
        marina = _Marina.objects.get(stripe_customer_id=customer_id)
    except _Marina.DoesNotExist:
        return

    # Feature B: manual-contract marinas are no-ops for Stripe-driven state.
    if marina.manual_contract:
        return

    from apps.billing import gates as _gates

    if event_type == 'customer.subscription.updated':
        # Legacy `Marina.status` bookkeeping (kept for backwards compat).
        if obj.get('status') in ('trialing', 'active'):
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

        # New billing-gate ground truth — handles past_due, unpaid, etc.
        _gates.apply_subscription_truth(marina, obj, stripe_event_id=event_id)

    elif event_type == 'customer.subscription.deleted':
        # Legacy field stays for compat with code that still reads it.
        marina.status = 'suspended'
        marina.save(update_fields=['status'])
        _gates.apply_subscription_deleted(marina, obj, stripe_event_id=event_id)


def _handle_payout_event(event_type, obj, connect_account_id=None):
    """
    Upsert a Payout row for a Stripe payout.* event and link constituent
    invoices when the payout is `paid`. Idempotent: safe to replay.

    Spec ref: docs/superpowers/specs/2026-05-15-accounting-tax-export-design.md §8.1
    """
    from decimal import Decimal
    from apps.accounting.models import Payout, PayoutLine

    payout_id = obj.get('id')
    if not payout_id:
        return

    account_id = connect_account_id or obj.get('destination') or obj.get('account')
    marina = None
    if account_id:
        marina = _Marina.objects.filter(stripe_account_id=account_id).first()
    if marina is None:
        # Without a marina link we cannot file the payout; ack the webhook.
        return

    status_map = {
        'paid':       'paid',
        'pending':    'pending',
        'in_transit': 'in_transit',
        'failed':     'failed',
        'canceled':   'canceled',
    }
    status_val = status_map.get(obj.get('status'), obj.get('status') or 'pending')

    amount = Decimal(str(obj.get('amount', 0))) / Decimal('100')
    arrival_ts = obj.get('arrival_date')
    created_ts = obj.get('created')
    arrival_date = _dt.date.fromtimestamp(arrival_ts) if arrival_ts else None
    created_dt = _dt.datetime.fromtimestamp(created_ts, tz=_dt.timezone.utc) if created_ts else None

    defaults = {
        'stripe_account_id': account_id or '',
        'amount': amount,
        'currency': (obj.get('currency') or 'eur').upper(),
        'arrival_date': arrival_date,
        'created_at_stripe': created_dt,
        'status': status_val,
        'bank_account_last4': (obj.get('destination_details') or {}).get('last4', '') if isinstance(obj.get('destination_details'), dict) else '',
        'raw_payload': obj,
    }
    payout, _created = Payout.objects.update_or_create(
        marina=marina, stripe_payout_id=payout_id,
        defaults=defaults,
    )

    if event_type != 'payout.paid':
        return

    # Pull balance transactions and link them to invoices.
    try:
        txns = list(_stripe_svc.stripe.BalanceTransaction.list(
            payout=payout_id, limit=100,
            stripe_account=account_id,
        ).auto_paging_iter())
    except Exception:
        return

    gross = Decimal('0.00')
    fees = Decimal('0.00')
    PayoutLine.objects.filter(payout=payout).delete()  # rebuild — idempotent on replay

    for txn in txns:
        txn_type = getattr(txn, 'type', None) or txn.get('type', 'other')
        if txn_type == 'payout':
            continue
        line_type_map = {
            'charge': 'charge', 'refund': 'refund',
            'adjustment': 'adjustment', 'dispute': 'dispute',
            'payment': 'charge', 'payment_refund': 'refund',
            'stripe_fee': 'fee',
        }
        line_type = line_type_map.get(txn_type, 'other')

        txn_amount = Decimal(str(getattr(txn, 'amount', 0) or txn.get('amount', 0))) / Decimal('100')
        txn_fee = Decimal(str(getattr(txn, 'fee', 0) or txn.get('fee', 0))) / Decimal('100')
        net = Decimal(str(getattr(txn, 'net', 0) or txn.get('net', 0))) / Decimal('100')

        source = getattr(txn, 'source', None) or txn.get('source', '')
        # Determine charge / payment-intent IDs.
        stripe_charge_id = ''
        payment_intent_id = ''
        if isinstance(source, str) and source.startswith('ch_'):
            stripe_charge_id = source
        elif hasattr(source, 'id'):
            sid = source.id
            if isinstance(sid, str) and sid.startswith('ch_'):
                stripe_charge_id = sid
        # Best-effort: pull payment_intent off the source if expanded.
        if hasattr(source, 'payment_intent'):
            pi = source.payment_intent
            payment_intent_id = pi if isinstance(pi, str) else (pi.id if hasattr(pi, 'id') else '')

        invoice = None
        if payment_intent_id:
            invoice = Invoice.objects.filter(
                marina=marina, stripe_payment_intent_id=payment_intent_id
            ).first()

        txn_created = getattr(txn, 'created', None) or txn.get('created')
        line_created = _dt.datetime.fromtimestamp(txn_created, tz=_dt.timezone.utc) if txn_created else None

        PayoutLine.objects.create(
            payout=payout,
            type=line_type,
            stripe_balance_txn_id=getattr(txn, 'id', None) or txn.get('id', ''),
            stripe_charge_id=stripe_charge_id,
            stripe_payment_intent_id=payment_intent_id,
            invoice=invoice,
            gross_amount=txn_amount,
            fee_amount=txn_fee,
            net_amount=net,
            currency=(getattr(txn, 'currency', None) or txn.get('currency', 'eur')).upper(),
            description=getattr(txn, 'description', None) or txn.get('description', '') or '',
            created_at_stripe=line_created,
        )

        if line_type == 'fee':
            fees += txn_amount
        else:
            gross += txn_amount
            fees += txn_fee

    payout.gross_amount = gross
    payout.fee_amount = fees
    payout.save(update_fields=['gross_amount', 'fee_amount'])


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


def _handle_refund_event(event_type, obj):
    """
    Update local Refund rows from Stripe charge.refunded / refund.updated events.

    obj shape varies:
      - charge.refunded → Charge object with .refunds.data[] (list of Refund objects)
        and a payment_intent id.
      - refund.updated  → Refund object with .id, .status, .payment_intent.
    """
    if event_type == 'charge.refunded':
        payment_intent_id = obj.get('payment_intent') or ''
        refunds = (obj.get('refunds') or {}).get('data') or []
        for sr in refunds:
            _apply_stripe_refund_to_local(sr, payment_intent_id_fallback=payment_intent_id)
    else:
        # refund.updated / charge.refund.updated → object IS the Stripe Refund.
        _apply_stripe_refund_to_local(obj, payment_intent_id_fallback=obj.get('payment_intent') or '')


def _apply_stripe_refund_to_local(stripe_refund_obj, payment_intent_id_fallback=''):
    from .models import Refund

    refund_id = stripe_refund_obj.get('id') or ''
    pi_id = stripe_refund_obj.get('payment_intent') or payment_intent_id_fallback or ''
    if not refund_id and not pi_id:
        return

    stripe_status = stripe_refund_obj.get('status') or ''
    status_map = {
        'succeeded':       Refund.Status.SUCCEEDED,
        'pending':         Refund.Status.PENDING,
        'failed':          Refund.Status.FAILED,
        'requires_action': Refund.Status.REQUIRES_ACTION,
        'canceled':        Refund.Status.FAILED,
    }
    local_status = status_map.get(stripe_status)

    refund = None
    if refund_id:
        refund = Refund.objects.filter(stripe_refund_id=refund_id).first()
    if refund is None and pi_id:
        # Pick the most recent pending refund row for that PI (best-effort).
        refund = (
            Refund.objects.filter(stripe_payment_intent_id=pi_id, stripe_refund_id='')
            .order_by('-created_at')
            .first()
        )
    if refund is None:
        return

    update_fields = []
    if refund_id and refund.stripe_refund_id != refund_id:
        refund.stripe_refund_id = refund_id
        update_fields.append('stripe_refund_id')
    if local_status and refund.status != local_status:
        refund.status = local_status
        update_fields.append('status')
        if local_status == Refund.Status.SUCCEEDED and refund.completed_at is None:
            refund.completed_at = timezone.now()
            update_fields.append('completed_at')
    if update_fields:
        refund.save(update_fields=update_fields)


def _handle_marina_payment_failed(obj, event_id=''):
    """
    invoice.payment_failed handler. Now advances billing_state and emails
    all active owners (not just the first) via the gates module.

    TRAP 1: gates.record_failure checks the invoice's CURRENT `status` and
    refuses to regress to past_due if a stale failed event arrives after a
    retry has already paid the invoice.
    """
    customer_id = obj.get('customer')
    try:
        marina = _Marina.objects.get(stripe_customer_id=customer_id)
    except _Marina.DoesNotExist:
        return
    if marina.manual_contract:
        return  # Feature B: no Stripe-driven dunning for manual contracts.

    from apps.billing import gates as _gates
    _gates.record_failure(marina, obj, stripe_event_id=event_id)

    # Send first-failure email (subsequent cadence handled by the hourly
    # task). Email ALL owner accounts — even inactive ones may need to be
    # alerted that the platform charge failed (locked decision A.4 / §A.10).
    for user in marina.users.filter(role='owner'):
        try:
            _send_payment_failed_email(user)
        except Exception:
            import logging as _logging
            _logging.getLogger(__name__).exception(
                'Failed to send payment-failed email to %s', user.email,
            )


def _handle_marina_invoice_paid(obj, event_id=''):
    """Handle invoice.paid for the platform subscription — restore to current."""
    customer_id = obj.get('customer')
    if not customer_id:
        return
    try:
        marina = _Marina.objects.get(stripe_customer_id=customer_id)
    except _Marina.DoesNotExist:
        return
    if marina.manual_contract:
        return
    from apps.billing import gates as _gates
    _gates.apply_invoice_paid(marina, obj, stripe_event_id=event_id)


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
        event_id = event.get('id') or ''
        obj = event['data']['object']

        # Event-id idempotency (spec §A.6) — prevents Stripe retries from
        # re-driving the billing state machine.
        if event_id:
            from apps.admin_portal.models import ProcessedStripeEvent
            from django.db import IntegrityError as _IE
            from django.db import transaction as _txn
            try:
                with _txn.atomic():
                    ProcessedStripeEvent.objects.create(
                        event_id=event_id, event_type=event_type,
                    )
            except _IE:
                # Already processed — ack and move on.
                return HttpResponse(status=200)

        # Handle marina subscription lifecycle events BEFORE the invoice_id check
        if event_type in ('customer.subscription.updated', 'customer.subscription.deleted'):
            _handle_marina_subscription_event(event_type, obj, event_id=event_id)
            return HttpResponse(status=200)
        if event_type == 'invoice.payment_failed':
            _handle_marina_payment_failed(obj, event_id=event_id)
            return HttpResponse(status=200)
        if event_type == 'invoice.paid':
            # Platform-subscription invoice paid → restore billing_state.
            # Only fires for the platform Stripe account (not Connect).
            _handle_marina_invoice_paid(obj, event_id=event_id)
            return HttpResponse(status=200)
        if event_type == 'account.updated':
            _handle_connect_account_updated(obj)
            return HttpResponse(status=200)
        if event_type in ('payout.created', 'payout.paid', 'payout.updated', 'payout.failed'):
            _handle_payout_event(event_type, obj, connect_account_id=event.get('account'))
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

        if event_type in ('charge.refunded', 'refund.updated', 'charge.refund.updated'):
            _handle_refund_event(event_type, obj)
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

        # Stripe Connect payout lifecycle — bookkeeper reconciliation surface.
        if event_type in ('payout.created', 'payout.paid', 'payout.updated', 'payout.failed'):
            connect_account = event.get('account')
            _handle_payout_event(event_type, obj, connect_account_id=connect_account)
            return HttpResponse(status=200)

        # Refund lifecycle from Stripe.
        if event_type in ('charge.refunded', 'refund.updated', 'charge.refund.updated'):
            _handle_refund_event(event_type, obj)
            return HttpResponse(status=200)

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


def _manual_contract_409(marina):
    """Build the 409 Conflict response for manual-contract marinas."""
    return Response(
        {
            'billing_managed': 'manual_contract',
            'contract_reference': marina.manual_contract_reference or '',
            'renewal_date': (
                marina.manual_contract_renewal_date.isoformat()
                if marina.manual_contract_renewal_date else None
            ),
            'contact': 'billing@docksbase.com',
        },
        status=http_status.HTTP_409_CONFLICT,
    )


class SubscriptionBillingView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        marina = request.user.marina
        if marina.manual_contract:
            return _manual_contract_409(marina)
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
            'billing_state': marina.billing_state,
            'billing_grace_until': (
                marina.billing_grace_until.isoformat()
                if marina.billing_grace_until else None
            ),
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
        if marina.manual_contract:
            return _manual_contract_409(marina)
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
        marina = request.user.marina
        if marina.manual_contract:
            return _manual_contract_409(marina)
        plan_key = request.data.get('plan', '')
        new_price_id = PLAN_PRICE_IDS.get(plan_key, '')
        if not new_price_id:
            return Response({'detail': 'Invalid plan.'}, status=400)

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


# ── Refund endpoints ─────────────────────────────────────────────────────────

def _refund_audit(actor_user, marina, action, detail):
    """Best-effort audit-log writer; never blocks the refund flow on failure."""
    try:
        from apps.admin_portal.models import AuditLog
        AuditLog.objects.create(
            admin_user=actor_user,
            action=action,
            target_marina=marina,
            detail=detail or {},
        )
    except Exception:
        pass


def _is_manager(user):
    return bool(user and user.is_authenticated and getattr(user, 'role', '') in ('owner', 'manager'))


def _remaining_refundable_cents(invoice):
    """Sum of paid amount minus prior refunds, expressed in cents.

    For Stripe-paid invoices this approximates `charge.amount - charge.amount_refunded`
    by leaning on the invoice total (which equals the captured amount for
    paid invoices) minus the sum of any prior successful Refund.amount_cents.
    """
    total_cents = int(round(float(invoice.total) * 100))
    prior = (
        Refund.objects
        .filter(invoice=invoice)
        .exclude(status__in=[Refund.Status.FAILED])
        .aggregate(total=Sum('amount_cents'))
        .get('total') or 0
    )
    return max(total_cents - int(prior), 0)


class RefundListCreateView(generics.ListCreateAPIView):
    serializer_class = RefundSerializer
    permission_classes = [IsAuthenticated]
    pagination_class = None

    def get_queryset(self):
        return Refund.objects.filter(marina=self.request.user.marina).select_related('invoice')

    def create(self, request, *args, **kwargs):
        if not _is_manager(request.user):
            return Response({'detail': 'Manager role required.'}, status=http_status.HTTP_403_FORBIDDEN)

        marina = request.user.marina
        invoice_id = request.data.get('invoice_id')
        amount_cents = request.data.get('amount_cents')
        reason = request.data.get('reason') or Refund.Reason.OTHER
        notes = request.data.get('notes') or ''
        offline = bool(request.data.get('offline'))

        if not invoice_id:
            return Response({'detail': 'invoice_id is required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        try:
            invoice = Invoice.objects.select_related('marina').get(pk=invoice_id, marina=marina)
        except Invoice.DoesNotExist:
            return Response({'detail': 'Invoice not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        if invoice.status != 'paid':
            return Response(
                {'detail': 'Only paid invoices can be refunded.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        remaining = _remaining_refundable_cents(invoice)
        if amount_cents is None or amount_cents == '':
            amount_cents = remaining
        try:
            amount_cents = int(amount_cents)
        except (TypeError, ValueError):
            return Response({'detail': 'amount_cents must be an integer.'}, status=http_status.HTTP_400_BAD_REQUEST)

        if amount_cents <= 0:
            return Response({'detail': 'amount_cents must be positive.'}, status=http_status.HTTP_400_BAD_REQUEST)
        if amount_cents > remaining:
            return Response(
                {'detail': f'amount_cents exceeds remaining refundable ({remaining}c).'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        if reason not in dict(Refund.Reason.choices):
            return Response({'detail': 'Invalid reason.'}, status=http_status.HTTP_400_BAD_REQUEST)

        if offline:
            # Manual / offline refund — no Stripe call.
            refund = Refund.objects.create(
                marina=marina,
                invoice=invoice,
                stripe_payment_intent_id=invoice.stripe_payment_intent_id or '',
                stripe_refund_id='',
                amount_cents=amount_cents,
                currency=(marina.currency or 'eur').lower(),
                reason=reason,
                status=Refund.Status.SUCCEEDED,
                requested_by=request.user,
                notes=notes or 'Recorded as offline refund (e.g. cheque, cash).',
                completed_at=timezone.now(),
            )
            _refund_audit(
                request.user, marina, 'refund.offline_recorded',
                {'refund_id': refund.id, 'invoice_id': invoice.id, 'amount_cents': amount_cents},
            )
            return Response(RefundSerializer(refund).data, status=http_status.HTTP_201_CREATED)

        if not invoice.stripe_payment_intent_id:
            return Response(
                {'detail': 'Invoice has no Stripe PaymentIntent — record an offline refund instead.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        _refund_audit(
            request.user, marina, 'refund.requested',
            {'invoice_id': invoice.id, 'amount_cents': amount_cents, 'reason': reason},
        )

        try:
            refund = _stripe_svc.refund_payment_intent(
                payment_intent_id=invoice.stripe_payment_intent_id,
                amount_cents=amount_cents,
                reason=reason,
                metadata={'invoice_id': str(invoice.id), 'marina_id': str(marina.id)},
                requested_by_user_id=request.user.id,
            )
        except _stripe_svc.stripe.error.StripeError as err:
            _refund_audit(
                request.user, marina, 'refund.stripe_error',
                {'invoice_id': invoice.id, 'error': str(err)},
            )
            return Response({'detail': f'Stripe error: {err}'}, status=http_status.HTTP_502_BAD_GATEWAY)

        if notes:
            refund.notes = (refund.notes + '\n' if refund.notes else '') + notes
            refund.save(update_fields=['notes'])

        _refund_audit(
            request.user, marina, 'refund.completed',
            {'refund_id': refund.id, 'status': refund.status, 'amount_cents': refund.amount_cents},
        )
        return Response(RefundSerializer(refund).data, status=http_status.HTTP_201_CREATED)


class RefundDetailView(generics.RetrieveAPIView):
    serializer_class = RefundSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Refund.objects.filter(marina=self.request.user.marina).select_related('invoice')
