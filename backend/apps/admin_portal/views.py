import datetime
from decimal import Decimal
from django.conf import settings
from django.contrib.auth.tokens import default_token_generator
from django.core.mail import send_mail
from django.db.models import Sum, Q
from django.shortcuts import get_object_or_404
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status as http_status
from rest_framework_simplejwt.tokens import RefreshToken

from apps.accounts.models import Marina, User
from apps.billing.models import Invoice
from .models import PlatformPayment, AuditLog, GlobalFeatureFlag
from .permissions import IsPlatformAdmin
from .serializers import (
    MarinaListSerializer, MarinaDetailSerializer, MarinaUpdateSerializer,
    PlatformPaymentSerializer, AuditLogSerializer, GlobalFeatureFlagSerializer,
)

PLAN_PRICES = getattr(settings, 'PLAN_PRICES', {'starter': 149, 'professional': 349, 'enterprise': 899})


def _mrr_for(marina):
    return marina.mrr_override or PLAN_PRICES.get(marina.plan, 0)


def _log(admin_user, action, marina=None, **detail):
    AuditLog.objects.create(
        admin_user=admin_user,
        action=action,
        target_marina=marina,
        detail=detail,
    )


# ── Overview ──────────────────────────────────────────────────────────────────

class AdminOverviewView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        marinas = Marina.objects.all()
        active = marinas.filter(status='active')
        trial = marinas.filter(status='trial')
        suspended = marinas.filter(status='suspended')

        mrr = sum(_mrr_for(m) for m in active)

        today = datetime.date.today()
        trial_ending_soon = trial.filter(
            trial_ends__lte=today + datetime.timedelta(days=14),
            trial_ends__gte=today,
        )
        overdue_payments = PlatformPayment.objects.filter(
            status='overdue'
        ).select_related('marina')

        gmv = Invoice.objects.filter(status='paid').aggregate(
            total=Sum('total')
        )['total'] or Decimal('0')

        recent_signups = marinas.order_by('-created_at')[:5]

        return Response({
            'mrr': mrr,
            'arr': mrr * 12,
            'active_marinas': active.count(),
            'trial_marinas': trial.count(),
            'total_berths': active.aggregate(t=Sum('total_berths'))['t'] or 0,
            'gmv': str(gmv),
            'alerts': {
                'overdue_payments': PlatformPaymentSerializer(overdue_payments, many=True).data,
                'trials_ending_soon': MarinaListSerializer(trial_ending_soon, many=True).data,
                'suspended': MarinaListSerializer(suspended, many=True).data,
            },
            'recent_signups': MarinaListSerializer(recent_signups, many=True).data,
        })


# ── Marinas ───────────────────────────────────────────────────────────────────

class AdminMarinaListView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        qs = Marina.objects.all().order_by('-created_at')
        status_filter = request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        search = request.query_params.get('search')
        if search:
            qs = qs.filter(Q(name__icontains=search) | Q(address__icontains=search))
        return Response(MarinaListSerializer(qs, many=True).data)


class AdminMarinaDetailView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request, pk):
        marina = get_object_or_404(Marina, pk=pk)
        return Response(MarinaDetailSerializer(marina).data)

    def patch(self, request, pk):
        marina = get_object_or_404(Marina, pk=pk)
        ser = MarinaUpdateSerializer(marina, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        marina = ser.save()
        _log(request.user, 'update_marina', marina, changes=list(request.data.keys()))
        return Response(MarinaDetailSerializer(marina).data)


class AdminMarinaSuspendView(APIView):
    permission_classes = [IsPlatformAdmin]

    def post(self, request, pk):
        marina = get_object_or_404(Marina, pk=pk)
        reason = request.data.get('reason', '')
        marina.status = 'suspended'
        marina.suspend_reason = reason
        marina.save(update_fields=['status', 'suspend_reason'])
        _log(request.user, 'suspend_marina', marina, reason=reason)
        return Response(MarinaDetailSerializer(marina).data)


class AdminMarinaReinstateView(APIView):
    permission_classes = [IsPlatformAdmin]

    def post(self, request, pk):
        marina = get_object_or_404(Marina, pk=pk)
        marina.status = 'active'
        marina.suspend_reason = ''
        marina.save(update_fields=['status', 'suspend_reason'])
        _log(request.user, 'reinstate_marina', marina)
        return Response(MarinaDetailSerializer(marina).data)


class AdminMarinaConvertView(APIView):
    permission_classes = [IsPlatformAdmin]

    def post(self, request, pk):
        marina = get_object_or_404(Marina, pk=pk)
        if marina.status != 'trial':
            return Response(
                {'detail': 'Only trial marinas can be converted to active.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        marina.status = 'active'
        marina.trial_ends = None
        today = datetime.date.today()
        marina.next_renewal = today.replace(
            month=(today.month % 12) + 1,
            day=1,
        ) if today.month < 12 else today.replace(year=today.year + 1, month=1, day=1)
        marina.save(update_fields=['status', 'trial_ends', 'next_renewal'])
        _log(request.user, 'convert_trial', marina)
        return Response(MarinaDetailSerializer(marina).data)


class AdminMarinaImpersonateView(APIView):
    permission_classes = [IsPlatformAdmin]

    def post(self, request, pk):
        marina = get_object_or_404(Marina, pk=pk)
        target_user = User.objects.filter(
            marina=marina, role__in=['owner', 'manager'], is_active=True
        ).first()
        if not target_user:
            return Response(
                {'detail': 'No active owner or manager found for this marina.'},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        refresh = RefreshToken.for_user(target_user)
        refresh['is_safe_mode'] = True
        refresh['impersonated_marina'] = marina.name
        refresh['role'] = target_user.role
        refresh['is_platform_admin'] = False

        _log(request.user, 'impersonate', marina, target_user=target_user.email)

        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'marina_name': marina.name,
            'user_email': target_user.email,
        })


class AdminMarinaResetPasswordView(APIView):
    permission_classes = [IsPlatformAdmin]

    def post(self, request, pk):
        marina = get_object_or_404(Marina, pk=pk)

        user_id = request.data.get('user_id')
        if not isinstance(user_id, int):
            return Response({'detail': 'user_id must be an integer.'}, status=http_status.HTTP_400_BAD_REQUEST)

        target = get_object_or_404(User, pk=user_id, marina=marina)

        uid = urlsafe_base64_encode(force_bytes(target.pk))
        token = default_token_generator.make_token(target)
        link = f"{settings.FRONTEND_URL}/reset-password?uid={uid}&token={token}"

        send_mail(
            subject="Your DocksBase password has been reset",
            message=(
                f"A platform admin has triggered a password reset for your account.\n\n"
                f"Set a new password here:\n{link}\n\n"
                f"This link expires in 24 hours."
            ),
            from_email=None,
            recipient_list=[target.email],
        )

        _log(request.user, 'reset_password', marina, target_user=target.email)

        return Response({'detail': f'Password reset email sent to {target.email}.'})


# ── Finance ───────────────────────────────────────────────────────────────────

class AdminFinanceView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        active = Marina.objects.filter(status='active')
        mrr = sum(_mrr_for(m) for m in active)
        active_count = active.count()

        plan_breakdown = {}
        for m in active:
            p = m.plan
            rev = _mrr_for(m)
            if p not in plan_breakdown:
                plan_breakdown[p] = {'plan': p, 'count': 0, 'revenue': 0}
            plan_breakdown[p]['count'] += 1
            plan_breakdown[p]['revenue'] += rev

        payments = PlatformPayment.objects.select_related('marina').order_by('-created_at')[:50]

        revenue_by_marina = [
            {'name': m.name, 'plan': m.plan, 'mrr': _mrr_for(m)}
            for m in active.order_by('-total_berths')
        ]

        return Response({
            'mrr': mrr,
            'arr': mrr * 12,
            'avg_revenue_per_account': round(mrr / active_count, 2) if active_count else 0,
            'revenue_by_plan': list(plan_breakdown.values()),
            'revenue_by_marina': revenue_by_marina,
            'payments': PlatformPaymentSerializer(payments, many=True).data,
        })


# ── Payments ──────────────────────────────────────────────────────────────────

class AdminPaymentListView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        qs = PlatformPayment.objects.select_related('marina').order_by('-created_at')
        status_filter = request.query_params.get('status')
        if status_filter:
            qs = qs.filter(status=status_filter)
        return Response(PlatformPaymentSerializer(qs, many=True).data)


# ── Subscriptions ─────────────────────────────────────────────────────────────

class AdminSubscriptionsView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        all_marinas = Marina.objects.all()

        plan_summary = {}
        for m in all_marinas.filter(status='active'):
            p = m.plan
            if p not in plan_summary:
                plan_summary[p] = {'plan': p, 'count': 0, 'revenue': 0}
            plan_summary[p]['count'] += 1
            plan_summary[p]['revenue'] += _mrr_for(m)

        return Response({
            'plan_summary': list(plan_summary.values()),
            'active': MarinaListSerializer(all_marinas.filter(status='active'), many=True).data,
            'trial': MarinaListSerializer(all_marinas.filter(status='trial'), many=True).data,
            'suspended': MarinaListSerializer(all_marinas.filter(status='suspended'), many=True).data,
        })


# ── Global Feature Flags ──────────────────────────────────────────────────────

class AdminFeatureFlagListView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        flags = GlobalFeatureFlag.objects.all()
        return Response(GlobalFeatureFlagSerializer(flags, many=True).data)


class AdminFeatureFlagDetailView(APIView):
    permission_classes = [IsPlatformAdmin]

    def patch(self, request, name):
        flag = get_object_or_404(GlobalFeatureFlag, name=name)
        enabled = request.data.get('enabled')
        if enabled is None:
            return Response({'detail': 'enabled field required.'}, status=http_status.HTTP_400_BAD_REQUEST)
        if isinstance(enabled, str):
            flag.enabled = enabled.lower() not in ('false', '0', 'no', '')
        else:
            flag.enabled = bool(enabled)
        flag.updated_by = request.user
        flag.save(update_fields=['enabled', 'updated_by', 'updated_at'])
        _log(request.user, 'toggle_global_flag', detail={'flag': name, 'enabled': flag.enabled})
        return Response(GlobalFeatureFlagSerializer(flag).data)


# ── Audit Log ─────────────────────────────────────────────────────────────────

class AdminAuditLogView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        qs = AuditLog.objects.select_related('admin_user', 'target_marina').order_by('-created_at')
        marina_id = request.query_params.get('marina')
        if marina_id:
            qs = qs.filter(target_marina_id=marina_id)
        return Response(AuditLogSerializer(qs[:200], many=True).data)
