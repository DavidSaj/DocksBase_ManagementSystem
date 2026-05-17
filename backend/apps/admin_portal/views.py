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

        # Capture feature-flag diff BEFORE saving so we can audit each flip.
        old_features = dict(marina.features or {})
        incoming_features = request.data.get('features')
        reason = (request.data.get('reason') or '').strip()

        ser = MarinaUpdateSerializer(marina, data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        marina = ser.save()

        if isinstance(incoming_features, dict):
            new_features = marina.features or {}
            changed_keys = set(old_features.keys()) | set(new_features.keys())
            for key in changed_keys:
                before = old_features.get(key)
                after = new_features.get(key)
                if bool(before) == bool(after):
                    continue
                _log(
                    request.user,
                    'toggle_feature_flag',
                    marina,
                    flag=key,
                    before=bool(before),
                    after=bool(after),
                    reason=reason or None,
                )
        else:
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


class AdminMarinaInviteStaffView(APIView):
    """Platform admin invites a new staff/manager/owner user to a marina.

    Creates an inactive user and sends a setup link the recipient uses to set
    their password. Mirrors the in-marina StaffInviteView but is callable by
    platform admins on any marina (e.g. when standing up a new enterprise).
    """
    permission_classes = [IsPlatformAdmin]

    def post(self, request, pk):
        import os
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode
        from django.contrib.auth.tokens import default_token_generator

        marina = get_object_or_404(Marina, pk=pk)

        email = (request.data.get('email') or '').strip().lower()
        name = (request.data.get('name') or '').strip()
        role = (request.data.get('role') or 'owner').strip()

        if role not in ('owner', 'manager', 'staff'):
            return Response(
                {'detail': 'role must be owner, manager, or staff.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        if not email:
            return Response({'detail': 'email is required.'}, status=http_status.HTTP_400_BAD_REQUEST)
        if User.objects.filter(email=email).exists():
            return Response(
                {'detail': 'A user with this email already exists.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        user = User.objects.create_user(
            email=email, password=None, is_active=False,
            marina=marina, role=role,
        )
        if name:
            parts = name.split(maxsplit=1)
            user.first_name = parts[0]
            user.last_name = parts[1] if len(parts) > 1 else ''
            user.save(update_fields=['first_name', 'last_name'])

        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)
        base_url = (
            os.environ.get('FIELD_URL')
            or getattr(settings, 'FRONTEND_URL', '')
            or 'https://app.docksbase.com'
        )
        setup_link = f"{base_url.rstrip('/')}/setup/{uid}/{token}/"

        try:
            send_mail(
                subject="You've been invited to DocksBase",
                message=(
                    f"Hello,\n\n"
                    f"A DocksBase administrator has invited you to manage "
                    f"{marina.name}. Set up your account here:\n{setup_link}\n\n"
                    f"This link expires in 24 hours."
                ),
                from_email=None,
                recipient_list=[email],
                fail_silently=True,
            )
        except Exception:
            _logger.exception('invite-staff email failed for %s', email)

        _log(
            request.user, 'invite_staff', marina,
            invited_email=email, invited_role=role,
        )
        return Response(
            {
                'id': user.pk, 'email': email, 'role': role,
                'is_active': user.is_active, 'setup_link': setup_link,
            },
            status=http_status.HTTP_201_CREATED,
        )


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
        _log(request.user, 'delete_group', group_id=pk, group_name=g.name)
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
    """Assign an admin to an enterprise group.

    Accepts an `email`. If a user with that email already exists, they are
    granted the ADMIN role on the group. Otherwise, when `invite=true` is
    provided, an inactive user is created and a setup link is emailed.
    """
    permission_classes = [IsPlatformAdmin]

    def post(self, request, pk):
        import os
        from django.utils.encoding import force_bytes
        from django.utils.http import urlsafe_base64_encode
        from django.contrib.auth.tokens import default_token_generator

        g = get_object_or_404(MarinaGroup, pk=pk)
        email = (request.data.get('email') or '').strip().lower()
        invite_flag = bool(request.data.get('invite'))
        if not email:
            return Response({'detail': 'email is required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        user = User.objects.filter(email=email).first()
        invited = False
        setup_link = None
        if user is None:
            if not invite_flag:
                return Response(
                    {'detail': f'No user with email {email}. Pass invite=true to send an invite.'},
                    status=http_status.HTTP_404_NOT_FOUND,
                )
            # Create an inactive user; they pick a marina on setup, but
            # enterprise admins are not bound to a single marina, so leave null.
            user = User.objects.create_user(
                email=email, password=None, is_active=False,
                marina=None, role='manager',
            )
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            token = default_token_generator.make_token(user)
            base_url = (
                os.environ.get('FIELD_URL')
                or getattr(settings, 'FRONTEND_URL', '')
                or 'https://app.docksbase.com'
            )
            setup_link = f"{base_url.rstrip('/')}/setup/{uid}/{token}/"
            try:
                send_mail(
                    subject=f"You've been invited as admin of {g.name}",
                    message=(
                        f"Hello,\n\n"
                        f"You have been invited as an enterprise admin for "
                        f"{g.name} on DocksBase. Set up your account here:\n"
                        f"{setup_link}\n\nThis link expires in 24 hours."
                    ),
                    from_email=None,
                    recipient_list=[email],
                    fail_silently=True,
                )
            except Exception:
                _logger.exception('group invite email failed for %s', email)
            invited = True

        MarinaGroupUserRole.objects.update_or_create(
            group=g, user=user,
            defaults={'role': MarinaGroupUserRole.Role.ADMIN},
        )
        _log(
            request.user, 'group_set_admin',
            group_id=g.pk, group_name=g.name, email=email, invited=invited,
        )
        return Response({
            'detail': f'{email} set as admin for {g.name}.',
            'invited': invited,
            'setup_link': setup_link,
        })
