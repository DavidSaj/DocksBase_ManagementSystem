import datetime
import threading
import uuid as _uuid
import logging
from decimal import Decimal
from django.conf import settings

_logger = logging.getLogger(__name__)
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

from apps.accounts.models import Marina, User, MarinaGroup, MarinaGroupMembership, MarinaGroupUserRole
from apps.billing.models import Invoice
from .models import PlatformPayment, AuditLog, GlobalFeatureFlag
from .permissions import IsPlatformAdmin
from .serializers import (
    MarinaListSerializer, MarinaDetailSerializer, MarinaUpdateSerializer,
    PlatformPaymentSerializer, AuditLogSerializer, GlobalFeatureFlagSerializer,
    MarinaGroupSerializer,
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


def _dispatch_break_glass_alerts(marina_email, marina_name, admin_email, bypass_reason):
    import datetime
    import requests
    from django.core.mail import send_mail
    from django.conf import settings as _s

    timestamp = datetime.datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')

    if marina_email:
        try:
            send_mail(
                subject='DocksBase Emergency Support Access',
                message=(
                    f'A DocksBase support agent has accessed your marina via Emergency Override.\n\n'
                    f'Marina: {marina_name}\n'
                    f'Accessed by: {admin_email}\n'
                    f'Time: {timestamp}\n'
                    f'Justification: {bypass_reason}\n\n'
                    f'If this was unexpected, contact support@docksbase.com immediately.'
                ),
                from_email='security@docksbase.com',
                recipient_list=[marina_email],
                fail_silently=False,
            )
        except Exception as e:
            _logger.error('Break-glass email failed: %s', e)
    else:
        _logger.warning('Break-glass override on %s but no contact_email set', marina_name)

    webhook_url = getattr(_s, 'SECURITY_SLACK_WEBHOOK_URL', '')
    if webhook_url:
        try:
            requests.post(
                webhook_url,
                json={
                    'text': (
                        f':rotating_light: *Break-Glass Override*\n'
                        f'`{admin_email}` accessed *{marina_name}* without consent.\n'
                        f'Time: {timestamp} | Reason: {bypass_reason}'
                    )
                },
                timeout=3,
            )
        except Exception as e:
            _logger.error('Break-glass Slack alert failed: %s', e)


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
        from django.utils import timezone as _tz
        marina = get_object_or_404(Marina, pk=pk)

        target_user = User.objects.filter(
            marina=marina, role__in=['owner', 'manager'], is_active=True
        ).first()
        if not target_user:
            return Response(
                {'detail': 'No active owner or manager found for this marina.'},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        platform_role = getattr(request.user, 'platform_role', '')
        consent_valid = (
            marina.support_access_granted_until is not None
            and marina.support_access_granted_until > _tz.now()
        )
        is_override = False

        if platform_role == 'support' and not consent_valid:
            return Response(
                {'detail': 'This marina has not granted support access.'},
                status=http_status.HTTP_403_FORBIDDEN,
            )

        if platform_role == 'admin' and not consent_valid:
            bypass_reason = request.data.get('bypass_reason', '').strip()
            if not bypass_reason:
                return Response(
                    {'detail': 'bypass_reason is required when overriding consent.'},
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
            is_override = True

        session_id = str(_uuid.uuid4())
        refresh = RefreshToken.for_user(target_user)
        refresh['is_safe_mode'] = True
        refresh['impersonated_marina'] = marina.name
        refresh['impersonated_marina_id'] = marina.pk
        refresh['impersonator_user_id'] = request.user.pk
        refresh['impersonation_session_id'] = session_id
        refresh['role'] = target_user.role
        refresh['is_platform_admin'] = False

        action = 'impersonate_override' if is_override else 'impersonate'
        detail = {'target_user': target_user.email, 'session_id': session_id}
        if is_override:
            detail['bypass_reason'] = bypass_reason
        _log(request.user, action, marina, **detail)

        if is_override:
            threading.Thread(
                target=_dispatch_break_glass_alerts,
                args=(marina.contact_email, marina.name, request.user.email, bypass_reason),
                daemon=True,
            ).start()

        return Response({
            'access': str(refresh.access_token),
            'refresh': str(refresh),
            'marina_name': marina.name,
            'user_email': target_user.email,
            'session_id': session_id,
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


# ── Marina Groups ─────────────────────────────────────────────────────────────

class AdminGroupListView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request):
        qs = MarinaGroup.objects.all().order_by('-created_at')
        return Response(MarinaGroupSerializer(qs, many=True).data)

    def post(self, request):
        ser = MarinaGroupSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data, status=http_status.HTTP_201_CREATED)


class AdminGroupDetailView(APIView):
    permission_classes = [IsPlatformAdmin]

    def get(self, request, pk):
        g = get_object_or_404(MarinaGroup, pk=pk)
        return Response(MarinaGroupSerializer(g).data)

    def patch(self, request, pk):
        g = get_object_or_404(MarinaGroup, pk=pk)
        ser = MarinaGroupSerializer(g, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)

    def delete(self, request, pk):
        g = get_object_or_404(MarinaGroup, pk=pk)
        g.delete()
        return Response(status=http_status.HTTP_204_NO_CONTENT)


class AdminGroupAddMarinaView(APIView):
    permission_classes = [IsPlatformAdmin]

    def post(self, request, pk):
        g = get_object_or_404(MarinaGroup, pk=pk)
        marina_id = request.data.get('marina_id')
        marina = get_object_or_404(Marina, pk=marina_id)
        if g.memberships.count() >= g.max_marinas:
            return Response(
                {'detail': f'Marina limit ({g.max_marinas}) reached for this group.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        MarinaGroupMembership.objects.get_or_create(group=g, marina=marina)
        return Response(MarinaGroupSerializer(g).data)


class AdminGroupRemoveMarinaView(APIView):
    permission_classes = [IsPlatformAdmin]

    def post(self, request, pk):
        g = get_object_or_404(MarinaGroup, pk=pk)
        marina_id = request.data.get('marina_id')
        marina = get_object_or_404(Marina, pk=marina_id)
        MarinaGroupMembership.objects.filter(group=g, marina=marina).delete()
        return Response(MarinaGroupSerializer(g).data)


class AdminGroupSetAdminView(APIView):
    permission_classes = [IsPlatformAdmin]

    def post(self, request, pk):
        g = get_object_or_404(MarinaGroup, pk=pk)
        email = request.data.get('email', '').strip()
        if not email:
            return Response({'detail': 'email is required.'}, status=http_status.HTTP_400_BAD_REQUEST)
        user = get_object_or_404(User, email=email)
        MarinaGroupUserRole.objects.update_or_create(
            group=g, user=user,
            defaults={'role': MarinaGroupUserRole.Role.ADMIN},
        )
        return Response({'detail': f'{email} set as admin for {g.name}.'})
