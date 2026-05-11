"""
apps/accounting/views.py

All ViewSets and API views for the accounting module.

Conventions:
  - All ViewSets filter by request.user.marina (set in get_queryset).
  - PageNumberPagination with default page size 50.
  - Marina HMRC endpoints return HTTP 403 if hmrc_fuel_duty_enabled=False.
"""

from decimal import Decimal

from django.db.models import Sum, Q
from django.http import HttpResponse
from django.utils import timezone

from rest_framework import viewsets, status
from rest_framework.decorators import action
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounting.models import (
    Account,
    CostCentre,
    CostCentreBudget,
    JournalEntry,
    JournalEntryLine,
    Currency,
    ExchangeRate,
    MemberCreditAccount,
    MemberCreditTransaction,
    SurchargeRule,
    PaymentPlan,
    PaymentPlanInstalment,
    DeferredRevenueEntry,
    DeferredRevenueRecognitionLog,
    FuelDutyRate,
    RedDieselSaleDeclaration,
    HMRCFuelDutyReturn,
    Supplier,
    APPurchaseOrder,
    APInvoice,
    APInvoiceLineItem,
    AccountingIntegrationConfig,
    AccountingSyncRecord,
)
from apps.accounting.serializers import (
    AccountSerializer,
    CostCentreSerializer,
    CostCentreBudgetSerializer,
    JournalEntrySerializer,
    JournalEntryLineSerializer,
    CurrencySerializer,
    ExchangeRateSerializer,
    MemberCreditAccountSerializer,
    MemberCreditTransactionSerializer,
    SurchargeRuleSerializer,
    PaymentPlanSerializer,
    PaymentPlanCreateSerializer,
    PaymentPlanInstalmentSerializer,
    DeferredRevenueEntrySerializer,
    DeferredRevenueRecognitionLogSerializer,
    FuelDutyRateSerializer,
    RedDieselSaleDeclarationSerializer,
    HMRCFuelDutyReturnSerializer,
    SupplierSerializer,
    APPurchaseOrderSerializer,
    APInvoiceSerializer,
    APInvoiceLineItemSerializer,
    AccountingIntegrationConfigSerializer,
    AccountingSyncRecordSerializer,
)


class StandardPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = 'page_size'
    max_page_size = 500


def _get_marina(request):
    """Return the marina associated with the authenticated user."""
    return request.user.marina


class HMRCPermissionMixin:
    """Mixin that blocks access for marinas without HMRC fuel duty enabled."""
    def check_hmrc_permission(self, request):
        marina = _get_marina(request)
        if not getattr(marina, 'hmrc_fuel_duty_enabled', False):
            return Response(
                {'detail': 'HMRC fuel duty is not enabled for this marina.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        return None


# ---------------------------------------------------------------------------
# Chart of Accounts
# ---------------------------------------------------------------------------

class AccountViewSet(viewsets.ModelViewSet):
    serializer_class = AccountSerializer
    pagination_class = StandardPagination
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        marina = _get_marina(self.request)
        qs = Account.objects.filter(marina=marina)
        account_type = self.request.query_params.get('account_type')
        is_active    = self.request.query_params.get('is_active')
        cost_centre  = self.request.query_params.get('cost_centre')
        if account_type:
            qs = qs.filter(account_type=account_type)
        if is_active is not None:
            qs = qs.filter(is_active=is_active.lower() == 'true')
        if cost_centre:
            qs = qs.filter(cost_centre_id=cost_centre)
        return qs

    def perform_create(self, serializer):
        serializer.save(marina=_get_marina(self.request))


# ---------------------------------------------------------------------------
# Journal Entries
# ---------------------------------------------------------------------------

class JournalEntryViewSet(viewsets.ModelViewSet):
    serializer_class = JournalEntrySerializer
    pagination_class = StandardPagination
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = JournalEntry.objects.filter(marina=_get_marina(self.request)).prefetch_related('lines')
        source_type = self.request.query_params.get('source_type')
        date_from   = self.request.query_params.get('date_from')
        date_to     = self.request.query_params.get('date_to')
        if source_type:
            qs = qs.filter(source_type=source_type)
        if date_from:
            qs = qs.filter(entry_date__gte=date_from)
        if date_to:
            qs = qs.filter(entry_date__lte=date_to)
        return qs

    def perform_create(self, serializer):
        # Manual drafts are created with is_posted=False
        serializer.save(marina=_get_marina(self.request), is_posted=False)

    @action(detail=True, methods=['post'], url_path='post')
    def post_entry(self, request, pk=None):
        """
        POST /journal-entries/{id}/post/
        Validates debits == credits, then sets is_posted=True.
        Returns 400 if imbalanced or already posted.
        """
        je = self.get_object()
        if je.is_posted:
            return Response({'detail': 'Journal entry is already posted.'}, status=400)

        lines = je.lines.all()
        total_debit  = lines.aggregate(total=Sum('debit'))['total'] or Decimal('0.00')
        total_credit = lines.aggregate(total=Sum('credit'))['total'] or Decimal('0.00')

        if total_debit != total_credit:
            return Response(
                {
                    'detail': 'Journal entry is not balanced.',
                    'total_debit': str(total_debit),
                    'total_credit': str(total_credit),
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Bypass the posted-guard in JournalEntry.save() by directly updating
        JournalEntry.objects.filter(pk=je.pk).update(is_posted=True)
        je.refresh_from_db()
        return Response(JournalEntrySerializer(je).data)

    @action(detail=True, methods=['get'], url_path='lines')
    def lines(self, request, pk=None):
        """GET /journal-entries/{id}/lines/"""
        je = self.get_object()
        qs = je.lines.all()
        serializer = JournalEntryLineSerializer(qs, many=True)
        return Response(serializer.data)


# ---------------------------------------------------------------------------
# Cost Centres
# ---------------------------------------------------------------------------

class CostCentreViewSet(viewsets.ModelViewSet):
    serializer_class = CostCentreSerializer
    pagination_class = StandardPagination
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return CostCentre.objects.filter(marina=_get_marina(self.request))

    def perform_create(self, serializer):
        serializer.save(marina=_get_marina(self.request))

    @action(detail=True, methods=['get', 'post'], url_path='budgets')
    def budgets(self, request, pk=None):
        """GET/POST /cost-centres/{id}/budgets/ — ?period=YYYY-MM"""
        cc = self.get_object()
        if request.method == 'GET':
            qs = CostCentreBudget.objects.filter(cost_centre=cc)
            period = request.query_params.get('period')
            if period:
                qs = qs.filter(period=period)
            return Response(CostCentreBudgetSerializer(qs, many=True).data)
        # POST — upsert
        serializer = CostCentreBudgetSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        obj, _ = CostCentreBudget.objects.update_or_create(
            cost_centre=cc,
            period=request.data.get('period'),
            account_id=request.data.get('account'),
            defaults={'budgeted_amount': request.data.get('budgeted_amount')},
        )
        return Response(CostCentreBudgetSerializer(obj).data, status=status.HTTP_201_CREATED)

    @action(detail=True, methods=['get'], url_path='pl')
    def profit_and_loss(self, request, pk=None):
        """GET /cost-centres/{id}/pl/ — ?period_from=&period_to="""
        cc = self.get_object()
        period_from = request.query_params.get('period_from')
        period_to   = request.query_params.get('period_to')

        qs = JournalEntryLine.objects.filter(
            cost_centre=cc,
            entry__is_posted=True,
        )
        if period_from:
            qs = qs.filter(entry__entry_date__gte=period_from)
        if period_to:
            qs = qs.filter(entry__entry_date__lte=period_to)

        revenue = qs.filter(account__account_type='revenue').aggregate(
            total=Sum('credit')
        )['total'] or Decimal('0.00')
        expenses = qs.filter(account__account_type='expense').aggregate(
            total=Sum('debit')
        )['total'] or Decimal('0.00')

        return Response({
            'cost_centre': cc.code,
            'period_from': period_from,
            'period_to': period_to,
            'revenue': str(revenue),
            'expenses': str(expenses),
            'net': str(revenue - expenses),
        })

    @action(detail=True, methods=['get'], url_path='budget-vs-actuals')
    def budget_vs_actuals(self, request, pk=None):
        """GET /cost-centres/{id}/budget-vs-actuals/ — ?period=YYYY-MM"""
        cc = self.get_object()
        period = request.query_params.get('period', '')

        budgets = CostCentreBudget.objects.filter(cost_centre=cc, period=period)
        actuals = JournalEntryLine.objects.filter(
            cost_centre=cc,
            entry__is_posted=True,
            entry__entry_date__startswith=period,
        ).values('account').annotate(
            total_debit=Sum('debit'),
            total_credit=Sum('credit'),
        )

        return Response({
            'period': period,
            'budgets': CostCentreBudgetSerializer(budgets, many=True).data,
            'actuals': list(actuals),
        })


# ---------------------------------------------------------------------------
# Payment Plans
# ---------------------------------------------------------------------------

class PaymentPlanViewSet(viewsets.ModelViewSet):
    pagination_class = StandardPagination
    permission_classes = [IsAuthenticated]

    def get_serializer_class(self):
        if self.action == 'create':
            return PaymentPlanCreateSerializer
        return PaymentPlanSerializer

    def get_queryset(self):
        qs = PaymentPlan.objects.filter(marina=_get_marina(self.request))
        member = self.request.query_params.get('member')
        plan_status = self.request.query_params.get('status')
        if member:
            qs = qs.filter(member_id=member)
        if plan_status:
            qs = qs.filter(status=plan_status)
        return qs

    def perform_create(self, serializer):
        serializer.save(marina=_get_marina(self.request))

    @action(detail=True, methods=['post'], url_path='cancel')
    def cancel(self, request, pk=None):
        plan = self.get_object()
        plan.status = PaymentPlan.Status.CANCELLED
        plan.save(update_fields=['status'])
        return Response(PaymentPlanSerializer(plan).data)

    @action(detail=True, methods=['get'], url_path='instalments')
    def instalments(self, request, pk=None):
        plan = self.get_object()
        qs = plan.instalments.all()
        return Response(PaymentPlanInstalmentSerializer(qs, many=True).data)


class InstalmentViewSet(viewsets.ModelViewSet):
    serializer_class = PaymentPlanInstalmentSerializer
    pagination_class = StandardPagination
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return PaymentPlanInstalment.objects.filter(
            plan__marina=_get_marina(self.request)
        )

    @action(detail=True, methods=['post'], url_path='issue-invoice')
    def issue_invoice(self, request, pk=None):
        instalment = self.get_object()
        from apps.accounting.services.payment_plans import issue_instalment_invoice
        invoice = issue_instalment_invoice(instalment)
        return Response({'invoice_id': invoice.pk, 'invoice_number': invoice.invoice_number})


# ---------------------------------------------------------------------------
# On-Account Credit
# ---------------------------------------------------------------------------

class CreditAccountViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = MemberCreditAccountSerializer
    pagination_class = StandardPagination
    permission_classes = [IsAuthenticated]
    lookup_field = 'member_id'

    def get_queryset(self):
        return MemberCreditAccount.objects.filter(marina=_get_marina(self.request))

    @action(detail=True, methods=['post'], url_path='top-up')
    def top_up(self, request, member_id=None):
        account = self.get_object()
        amount = Decimal(str(request.data.get('amount', '0')))
        from apps.accounting.services.credit import top_up_credit
        tx = top_up_credit(
            member=account.member,
            marina=account.marina,
            amount=amount,
            payment_method=request.data.get('payment_method', ''),
            stripe_payment_intent=request.data.get('stripe_payment_intent', ''),
            recorded_by=getattr(request.user, 'staff_profile', None),
        )
        return Response(MemberCreditTransactionSerializer(tx).data)

    @action(detail=True, methods=['post'], url_path='deduct')
    def deduct(self, request, member_id=None):
        account = self.get_object()
        amount = Decimal(str(request.data.get('amount', '0')))
        from apps.accounting.services.credit import deduct_credit
        try:
            tx = deduct_credit(
                member=account.member,
                marina=account.marina,
                amount=amount,
                transaction_type=request.data.get('transaction_type', 'manual_deduct'),
                recorded_by=getattr(request.user, 'staff_profile', None),
            )
        except ValueError as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response(MemberCreditTransactionSerializer(tx).data)

    @action(detail=True, methods=['patch'], url_path='settings')
    def update_settings(self, request, member_id=None):
        account = self.get_object()
        if 'auto_deduct' in request.data:
            account.auto_deduct = request.data['auto_deduct']
            account.save(update_fields=['auto_deduct'])
        return Response(MemberCreditAccountSerializer(account).data)

    @action(detail=True, methods=['get'], url_path='transactions')
    def transactions(self, request, member_id=None):
        account = self.get_object()
        qs = account.transactions.all()
        return Response(MemberCreditTransactionSerializer(qs, many=True).data)


# ---------------------------------------------------------------------------
# Surcharge Rules
# ---------------------------------------------------------------------------

class SurchargeRuleViewSet(viewsets.ModelViewSet):
    serializer_class = SurchargeRuleSerializer
    pagination_class = StandardPagination
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return SurchargeRule.objects.filter(marina=_get_marina(self.request))

    def perform_create(self, serializer):
        serializer.save(marina=_get_marina(self.request))


# ---------------------------------------------------------------------------
# HMRC Fuel Duty
# ---------------------------------------------------------------------------

class FuelDutyRateViewSet(HMRCPermissionMixin, viewsets.ModelViewSet):
    serializer_class = FuelDutyRateSerializer
    pagination_class = StandardPagination
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return FuelDutyRate.objects.filter(marina=_get_marina(self.request))

    def list(self, request, *args, **kwargs):
        err = self.check_hmrc_permission(request)
        if err:
            return err
        return super().list(request, *args, **kwargs)

    def perform_create(self, serializer):
        serializer.save(marina=_get_marina(self.request))


class HMRCFuelDutyReturnViewSet(HMRCPermissionMixin, viewsets.ReadOnlyModelViewSet):
    serializer_class = HMRCFuelDutyReturnSerializer
    pagination_class = StandardPagination
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = HMRCFuelDutyReturn.objects.filter(marina=_get_marina(self.request))
        period = self.request.query_params.get('period')
        if period:
            qs = qs.filter(duty_period=period)
        return qs

    def list(self, request, *args, **kwargs):
        err = self.check_hmrc_permission(request)
        if err:
            return err
        return super().list(request, *args, **kwargs)

    @action(detail=True, methods=['post'], url_path='finalise')
    def finalise(self, request, pk=None):
        err = self.check_hmrc_permission(request)
        if err:
            return err
        ret = self.get_object()
        ret.status = HMRCFuelDutyReturn.ReturnStatus.FINALISED
        ret.save(update_fields=['status'])
        return Response(HMRCFuelDutyReturnSerializer(ret).data)

    @action(detail=True, methods=['get'], url_path='export')
    def export(self, request, pk=None):
        err = self.check_hmrc_permission(request)
        if err:
            return err
        ret = self.get_object()
        # CSV export
        lines = [
            'duty_period,period_start,period_end,total_litres,propulsion_litres,'
            'non_propulsion_litres,propulsion_duty,non_propulsion_duty,total_duty,status',
            (
                f'{ret.duty_period},{ret.period_start},{ret.period_end},'
                f'{ret.total_litres_sold},{ret.propulsion_litres},'
                f'{ret.non_propulsion_litres},{ret.propulsion_duty_payable},'
                f'{ret.non_propulsion_duty_payable},{ret.total_duty_payable},{ret.status}'
            ),
        ]
        response = HttpResponse('\n'.join(lines), content_type='text/csv')
        response['Content-Disposition'] = f'attachment; filename="hmrc_{ret.duty_period}.csv"'
        return response


class RedDieselDeclarationView(APIView):
    """POST /fuel-dock/entries/{id}/red-diesel-declaration/"""
    permission_classes = [IsAuthenticated]

    def post(self, request, pk=None):
        from apps.fuel_dock.models import FuelDockEntry
        try:
            entry = FuelDockEntry.objects.get(pk=pk, marina=_get_marina(request))
        except FuelDockEntry.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)

        data = request.data.copy()
        data['fuel_dock_entry'] = entry.pk
        data['marina'] = entry.marina.pk
        serializer = RedDieselSaleDeclarationSerializer(data=data)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------
# Deferred Revenue
# ---------------------------------------------------------------------------

class DeferredRevenueViewSet(viewsets.ModelViewSet):
    serializer_class = DeferredRevenueEntrySerializer
    pagination_class = StandardPagination
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = DeferredRevenueEntry.objects.filter(marina=_get_marina(self.request))
        is_fully = self.request.query_params.get('is_fully_recognised')
        if is_fully is not None:
            qs = qs.filter(is_fully_recognised=is_fully.lower() == 'true')
        return qs

    def perform_create(self, serializer):
        serializer.save(marina=_get_marina(self.request))

    @action(detail=True, methods=['get'], url_path='logs')
    def logs(self, request, pk=None):
        entry = self.get_object()
        qs = entry.recognition_logs.all()
        return Response(DeferredRevenueRecognitionLogSerializer(qs, many=True).data)

    @action(detail=False, methods=['get'], url_path='summary')
    def summary(self, request):
        marina = _get_marina(request)
        from datetime import date, timedelta
        today = date.today()

        qs = DeferredRevenueEntry.objects.filter(
            marina=marina, is_fully_recognised=False, cancelled_at__isnull=True
        )
        total_deferred = qs.aggregate(total=Sum('deferred_amount'))['total'] or Decimal('0.00')

        def window_total(days):
            end = today + timedelta(days=days)
            return qs.filter(service_end__lte=end).aggregate(
                total=Sum('deferred_amount')
            )['total'] or Decimal('0.00')

        return Response({
            'total_deferred': str(total_deferred),
            'next_30_days':   str(window_total(30)),
            'next_60_days':   str(window_total(60)),
            'next_90_days':   str(window_total(90)),
        })


# ---------------------------------------------------------------------------
# Accounts Payable
# ---------------------------------------------------------------------------

class SupplierViewSet(viewsets.ModelViewSet):
    serializer_class = SupplierSerializer
    pagination_class = StandardPagination
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Supplier.objects.filter(marina=_get_marina(self.request))

    def perform_create(self, serializer):
        serializer.save(marina=_get_marina(self.request))


class APPurchaseOrderViewSet(viewsets.ModelViewSet):
    serializer_class = APPurchaseOrderSerializer
    pagination_class = StandardPagination
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return APPurchaseOrder.objects.filter(marina=_get_marina(self.request)).select_related('supplier')

    def perform_create(self, serializer):
        serializer.save(marina=_get_marina(self.request))

    @action(detail=True, methods=['post'], url_path='receive')
    def receive(self, request, pk=None):
        po = self.get_object()
        po.status = APPurchaseOrder.Status.RECEIVED
        po.save(update_fields=['status'])
        return Response(APPurchaseOrderSerializer(po).data)


class APInvoiceViewSet(viewsets.ModelViewSet):
    serializer_class = APInvoiceSerializer
    pagination_class = StandardPagination
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = APInvoice.objects.filter(marina=_get_marina(self.request)).select_related('supplier')
        ap_status = self.request.query_params.get('status')
        supplier  = self.request.query_params.get('supplier')
        if ap_status:
            qs = qs.filter(status=ap_status)
        if supplier:
            qs = qs.filter(supplier_id=supplier)
        return qs

    def perform_create(self, serializer):
        serializer.save(marina=_get_marina(self.request))

    @action(detail=True, methods=['post'], url_path='approve')
    def approve(self, request, pk=None):
        ap_inv = self.get_object()
        # Blocked if any line has account=None
        if ap_inv.line_items.filter(account__isnull=True).exists():
            return Response(
                {'detail': 'All line items must have an account assigned before approval.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        from apps.accounting.services.gl_posting import post_ap_invoice_gl
        je = post_ap_invoice_gl(ap_inv)
        ap_inv.status = APInvoice.Status.APPROVED
        ap_inv.approved_by = getattr(request.user, 'staff_profile', None)
        ap_inv.approved_at = timezone.now()
        ap_inv.save(update_fields=['status', 'approved_by', 'approved_at'])
        return Response(APInvoiceSerializer(ap_inv).data)

    @action(detail=True, methods=['post'], url_path='mark-paid')
    def mark_paid(self, request, pk=None):
        ap_inv = self.get_object()
        ap_inv.status = APInvoice.Status.PAID
        ap_inv.save(update_fields=['status'])
        return Response(APInvoiceSerializer(ap_inv).data)

    @action(detail=True, methods=['post'], url_path='void')
    def void(self, request, pk=None):
        ap_inv = self.get_object()
        ap_inv.status = APInvoice.Status.VOID
        ap_inv.save(update_fields=['status'])
        return Response(APInvoiceSerializer(ap_inv).data)

    @action(detail=False, methods=['post'], url_path='ocr-webhook')
    def ocr_webhook(self, request):
        """
        Generic OCR webhook. Normalises provider payload to APInvoice draft fields.
        Provider identified via X-OCR-Provider request header.
        """
        provider = request.headers.get('X-OCR-Provider', 'generic')
        payload  = request.data
        marina   = _get_marina(request)

        # Normalisation is provider-specific — implement NORMALISER_MAP as needed
        NORMALISER_MAP = {}
        normaliser = NORMALISER_MAP.get(provider)
        if normaliser:
            normalised = normaliser(payload)
        else:
            # Generic pass-through for unknown providers
            normalised = payload

        # Create draft APInvoice with normalised fields (account=None for unresolved)
        serializer = APInvoiceSerializer(data={**normalised, 'marina': marina.pk})
        serializer.is_valid(raise_exception=True)
        ap_inv = serializer.save(marina=marina, ocr_service=provider)
        return Response(APInvoiceSerializer(ap_inv).data, status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------
# Accounting Integration Config
# ---------------------------------------------------------------------------

class AccountingIntegrationConfigViewSet(viewsets.ModelViewSet):
    serializer_class = AccountingIntegrationConfigSerializer
    pagination_class = StandardPagination
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return AccountingIntegrationConfig.objects.filter(marina=_get_marina(self.request))

    def perform_create(self, serializer):
        serializer.save(marina=_get_marina(self.request))

    @action(detail=True, methods=['post'], url_path='sync-now')
    def sync_now(self, request, pk=None):
        config = self.get_object()
        from apps.accounting.tasks import accounting_sync_push
        accounting_sync_push.delay(config.pk)
        return Response({'detail': 'Sync dispatched.'}, status=status.HTTP_202_ACCEPTED)

    @action(detail=True, methods=['post'], url_path='test')
    def test_connection(self, request, pk=None):
        config = self.get_object()
        from apps.accounting.integrations import _get_adapter
        try:
            adapter = _get_adapter(config)
            adapter.test_connection()
            return Response({'detail': 'Connection successful.'})
        except Exception as exc:
            return Response({'detail': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

    @action(detail=True, methods=['get'], url_path='sync-log')
    def sync_log(self, request, pk=None):
        config = self.get_object()
        qs = config.sync_records.all()
        page = self.paginate_queryset(qs)
        if page is not None:
            return self.get_paginated_response(AccountingSyncRecordSerializer(page, many=True).data)
        return Response(AccountingSyncRecordSerializer(qs, many=True).data)


class AccountingSyncRecordViewSet(viewsets.ReadOnlyModelViewSet):
    """
    Read-only list/detail for all sync records across all integration configs.
    The frontend hits /accounting-sync/ to get the full marina-wide sync log.
    """
    serializer_class = AccountingSyncRecordSerializer
    pagination_class = StandardPagination
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        marina = _get_marina(self.request)
        return AccountingSyncRecord.objects.filter(
            config__marina=marina
        ).select_related('config').order_by('-synced_at')


# ---------------------------------------------------------------------------
# Multi-Currency
# ---------------------------------------------------------------------------

class CurrencyViewSet(viewsets.ModelViewSet):
    serializer_class = CurrencySerializer
    pagination_class = StandardPagination
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return Currency.objects.filter(marina=_get_marina(self.request))

    def perform_create(self, serializer):
        serializer.save(marina=_get_marina(self.request))

    def partial_update(self, request, *args, **kwargs):
        """
        PATCH /currencies/{id}/ — returns 409 if changing is_base after JE exists.
        """
        instance = self.get_object()
        if request.data.get('is_base') and not instance.is_base:
            marina = _get_marina(request)
            if JournalEntry.objects.filter(marina=marina).exists():
                return Response(
                    {'detail': 'Cannot change base currency after journal entries exist.'},
                    status=status.HTTP_409_CONFLICT,
                )
        return super().partial_update(request, *args, **kwargs)


class ExchangeRateViewSet(viewsets.ModelViewSet):
    serializer_class = ExchangeRateSerializer
    pagination_class = StandardPagination
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = ExchangeRate.objects.filter(marina=_get_marina(self.request))
        from_currency = self.request.query_params.get('from_currency')
        date          = self.request.query_params.get('date')
        if from_currency:
            qs = qs.filter(from_currency=from_currency)
        if date:
            qs = qs.filter(rate_date=date)
        return qs

    def perform_create(self, serializer):
        serializer.save(marina=_get_marina(self.request))


# ---------------------------------------------------------------------------
# Reports
# ---------------------------------------------------------------------------

class BalanceSheetView(APIView):
    """GET /api/v1/reports/balance-sheet/ — ?as_of_date=YYYY-MM-DD[&format=pdf]"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        marina   = _get_marina(request)
        as_of    = request.query_params.get('as_of_date')
        fmt      = request.query_params.get('format', 'json')

        qs = JournalEntryLine.objects.filter(
            entry__marina=marina, entry__is_posted=True
        )
        if as_of:
            qs = qs.filter(entry__entry_date__lte=as_of)

        def net(account_type, normal_side):
            lines = qs.filter(account__account_type=account_type)
            total_debit  = lines.aggregate(total=Sum('debit'))['total'] or Decimal('0.00')
            total_credit = lines.aggregate(total=Sum('credit'))['total'] or Decimal('0.00')
            if normal_side == 'debit':
                return total_debit - total_credit
            return total_credit - total_debit

        data = {
            'as_of_date': as_of,
            'assets':    str(net('asset', 'debit')),
            'liabilities': str(net('liability', 'credit')),
            'equity':    str(net('equity', 'credit')),
        }

        if fmt == 'pdf':
            return self._render_pdf(data, marina)
        return Response(data)

    def _render_pdf(self, data, marina):
        try:
            from weasyprint import HTML
            from django.template.loader import render_to_string
            html_string = render_to_string('accounting/reports/balance_sheet.html', {
                'data': data, 'marina': marina,
            })
            pdf_bytes = HTML(string=html_string).write_pdf()
            response = HttpResponse(pdf_bytes, content_type='application/pdf')
            response['Content-Disposition'] = 'inline; filename="balance_sheet.pdf"'
            return response
        except Exception as exc:
            return Response({'detail': f'PDF generation failed: {exc}'}, status=500)


class ProfitAndLossView(APIView):
    """GET /api/v1/reports/profit-and-loss/ — ?period_from=&period_to=&compare_prior=true"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        marina      = _get_marina(request)
        period_from = request.query_params.get('period_from')
        period_to   = request.query_params.get('period_to')
        fmt         = request.query_params.get('format', 'json')

        qs = JournalEntryLine.objects.filter(
            entry__marina=marina, entry__is_posted=True
        )
        if period_from:
            qs = qs.filter(entry__entry_date__gte=period_from)
        if period_to:
            qs = qs.filter(entry__entry_date__lte=period_to)

        revenue  = qs.filter(account__account_type='revenue').aggregate(total=Sum('credit'))['total'] or Decimal('0.00')
        expenses = qs.filter(account__account_type='expense').aggregate(total=Sum('debit'))['total'] or Decimal('0.00')

        data = {
            'period_from': period_from,
            'period_to':   period_to,
            'revenue':     str(revenue),
            'expenses':    str(expenses),
            'net_profit':  str(revenue - expenses),
        }

        if fmt == 'pdf':
            return self._render_pdf(data, marina)
        return Response(data)

    def _render_pdf(self, data, marina):
        try:
            from weasyprint import HTML
            from django.template.loader import render_to_string
            html_string = render_to_string('accounting/reports/profit_and_loss.html', {
                'data': data, 'marina': marina,
            })
            pdf_bytes = HTML(string=html_string).write_pdf()
            response = HttpResponse(pdf_bytes, content_type='application/pdf')
            response['Content-Disposition'] = 'inline; filename="profit_and_loss.pdf"'
            return response
        except Exception as exc:
            return Response({'detail': f'PDF generation failed: {exc}'}, status=500)


class CashFlowView(APIView):
    """GET /api/v1/reports/cash-flow/ — ?period_from=&period_to=[&format=pdf]"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        marina      = _get_marina(request)
        period_from = request.query_params.get('period_from')
        period_to   = request.query_params.get('period_to')

        # Cash receipts = debit on bank/cash accounts
        qs = JournalEntryLine.objects.filter(
            entry__marina=marina, entry__is_posted=True,
            account__code='1010',
        )
        if period_from:
            qs = qs.filter(entry__entry_date__gte=period_from)
        if period_to:
            qs = qs.filter(entry__entry_date__lte=period_to)

        receipts  = qs.aggregate(total=Sum('debit'))['total'] or Decimal('0.00')
        payments  = qs.aggregate(total=Sum('credit'))['total'] or Decimal('0.00')

        return Response({
            'period_from': period_from,
            'period_to':   period_to,
            'receipts':    str(receipts),
            'payments':    str(payments),
            'net_cashflow': str(receipts - payments),
        })


class CashForecastView(APIView):
    """GET /api/v1/reports/cash-forecast/ — rolling 8-week forward view"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        from datetime import date, timedelta
        marina  = _get_marina(request)
        today   = date.today()
        end     = today + timedelta(weeks=8)

        from apps.billing.models import Invoice
        due_invoices = Invoice.objects.filter(
            marina=marina,
            status__in=['unpaid', 'open'],
            due_date__gte=today,
            due_date__lte=end,
        ).aggregate(total=Sum('total'))['total'] or Decimal('0.00')

        instalments = PaymentPlanInstalment.objects.filter(
            plan__marina=marina,
            status__in=['scheduled', 'notified'],
            due_date__gte=today,
            due_date__lte=end,
        ).aggregate(total=Sum('amount'))['total'] or Decimal('0.00')

        return Response({
            'forecast_start': str(today),
            'forecast_end':   str(end),
            'expected_from_invoices':    str(due_invoices),
            'expected_from_instalments': str(instalments),
            'total_expected': str(due_invoices + instalments),
        })


class DeferredRevenueReportView(APIView):
    """GET /api/v1/reports/deferred-revenue/ — liability schedule"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        marina = _get_marina(request)
        entries = DeferredRevenueEntry.objects.filter(
            marina=marina,
            is_fully_recognised=False,
            cancelled_at__isnull=True,
        )
        total_deferred = entries.aggregate(total=Sum('deferred_amount'))['total'] or Decimal('0.00')

        return Response({
            'total_deferred_liability': str(total_deferred),
            'entries': DeferredRevenueEntrySerializer(entries, many=True).data,
        })


class CostCentrePLReportView(APIView):
    """GET /api/v1/reports/cost-centre-pl/ — all cost centres any period"""
    permission_classes = [IsAuthenticated]

    def get(self, request):
        marina      = _get_marina(request)
        period_from = request.query_params.get('period_from')
        period_to   = request.query_params.get('period_to')

        results = []
        for cc in CostCentre.objects.filter(marina=marina, is_active=True):
            qs = JournalEntryLine.objects.filter(
                entry__marina=marina,
                entry__is_posted=True,
                cost_centre=cc,
            )
            if period_from:
                qs = qs.filter(entry__entry_date__gte=period_from)
            if period_to:
                qs = qs.filter(entry__entry_date__lte=period_to)

            revenue  = qs.filter(account__account_type='revenue').aggregate(total=Sum('credit'))['total'] or Decimal('0.00')
            expenses = qs.filter(account__account_type='expense').aggregate(total=Sum('debit'))['total'] or Decimal('0.00')

            results.append({
                'cost_centre': cc.code,
                'name':        cc.name,
                'revenue':     str(revenue),
                'expenses':    str(expenses),
                'net':         str(revenue - expenses),
            })

        return Response({'period_from': period_from, 'period_to': period_to, 'results': results})
