from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status as http_status
from django.shortcuts import get_object_or_404
from django.db.models import Sum
from decimal import Decimal

from apps.accounts.models import MarinaGroup, MarinaGroupUserRole, Marina, User
from apps.billing.models import Invoice
from .permissions import IsGroupAdmin
from .serializers import GroupSummarySerializer, build_marina_card


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        roles = MarinaGroupUserRole.objects.filter(
            user=request.user
        ).select_related('group')
        groups = [r.group for r in roles]
        return Response({'groups': GroupSummarySerializer(groups, many=True).data})


class GroupOverviewView(APIView):
    permission_classes = [IsAuthenticated, IsGroupAdmin]

    def get(self, request, pk):
        group = get_object_or_404(MarinaGroup, pk=pk)
        marinas = [m.marina for m in group.memberships.select_related('marina').all()]
        cards = [build_marina_card(m) for m in marinas]

        total_berths = sum(m.total_berths for m in marinas)
        total_active = sum(c['active_bookings'] for c in cards)
        total_outstanding = Invoice.objects.filter(
            marina__in=marinas, status__in=['unpaid', 'open']
        ).aggregate(t=Sum('total'))['t'] or Decimal('0')

        from config.plans import PLAN_MONTHLY_PRICES
        total_mrr = sum(
            PLAN_MONTHLY_PRICES.get(m.plan, 0) for m in marinas
        )

        return Response({
            'kpis': {
                'total_berths': total_berths,
                'total_active_bookings': total_active,
                'total_mrr': str(total_mrr),
                'total_outstanding': str(total_outstanding),
            },
            'marinas': cards,
        })


import datetime


class GroupFinancialsView(APIView):
    permission_classes = [IsAuthenticated, IsGroupAdmin]

    def get(self, request, pk):
        from apps.accounting.models import ExchangeRate

        group = get_object_or_404(MarinaGroup, pk=pk)
        marinas = [m.marina for m in group.memberships.select_related('marina').all()]
        base_currency = group.base_currency
        today = datetime.date.today()
        missing_fx = []

        def to_base(amount, from_currency):
            if from_currency == base_currency:
                return amount
            rate = ExchangeRate.objects.filter(
                from_currency=from_currency,
                to_currency=base_currency,
            ).order_by('-id').first()
            if not rate:
                if from_currency not in missing_fx:
                    missing_fx.append(from_currency)
                return None
            return amount * rate.rate

        # Paid this month
        from django.utils import timezone as _tz
        now = _tz.now()
        period = f'{now.year}-{now.month:02d}'
        paid_total = Decimal('0')
        for marina in marinas:
            raw = Invoice.objects.filter(
                marina=marina, status='paid', billing_period=period
            ).aggregate(t=Sum('total'))['t'] or Decimal('0')
            converted = to_base(raw, marina.currency)
            if converted is not None:
                paid_total += converted

        # Outstanding
        outstanding_total = Decimal('0')
        for marina in marinas:
            raw = Invoice.objects.filter(
                marina=marina, status__in=['unpaid', 'open']
            ).aggregate(t=Sum('total'))['t'] or Decimal('0')
            converted = to_base(raw, marina.currency)
            if converted is not None:
                outstanding_total += converted

        # MRR (plan-based)
        from config.plans import PLAN_MONTHLY_PRICES
        mrr = sum(PLAN_MONTHLY_PRICES.get(m.plan, 0) for m in marinas)

        # Monthly revenue — 12 months rolling
        monthly_revenue = []
        for i in range(11, -1, -1):
            d = today
            for _ in range(i):
                d = (d.replace(day=1) - datetime.timedelta(days=1))
            bp = f'{d.year}-{d.month:02d}'
            month_total = Decimal('0')
            by_marina = []
            for marina in marinas:
                raw = Invoice.objects.filter(
                    marina=marina, status='paid', billing_period=bp
                ).aggregate(t=Sum('total'))['t'] or Decimal('0')
                converted = to_base(raw, marina.currency)
                if converted is not None:
                    month_total += converted
                    by_marina.append({'marina_id': marina.id, 'marina_name': marina.name, 'amount': str(converted)})
            monthly_revenue.append({'period': bp, 'total': str(month_total), 'by_marina': by_marina})

        return Response({
            'base_currency':   base_currency,
            'paid_this_month': str(paid_total),
            'outstanding':     str(outstanding_total),
            'mrr':             str(mrr),
            'monthly_revenue': monthly_revenue,
            'missing_fx':      missing_fx,
        })


from rest_framework_simplejwt.tokens import RefreshToken


class GroupStaffView(APIView):
    permission_classes = [IsAuthenticated, IsGroupAdmin]

    def get(self, request, pk):
        group = get_object_or_404(MarinaGroup, pk=pk)
        marinas = [m.marina for m in group.memberships.select_related('marina').all()]
        staff = []
        for marina in marinas:
            managers = marina.users.filter(
                role__in=['owner', 'manager'], is_active=True
            ).values('id', 'email', 'first_name', 'last_name', 'role')
            for m in managers:
                staff.append({
                    **m,
                    'name': f"{m['first_name']} {m['last_name']}".strip() or m['email'],
                    'marina_id': marina.id,
                    'marina_name': marina.name,
                })
        return Response(staff)


class GroupExchangeTokenView(APIView):
    permission_classes = [IsAuthenticated, IsGroupAdmin]

    def post(self, request, pk):
        group = get_object_or_404(MarinaGroup, pk=pk)
        marina_id = request.data.get('marina_id')
        if not marina_id:
            return Response({'detail': 'marina_id is required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        is_member = group.memberships.filter(marina_id=marina_id).exists()
        if not is_member:
            return Response(
                {'detail': 'Marina is not a member of this group.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        marina = get_object_or_404(Marina, pk=marina_id)

        # Issue a scoped JWT: carries marina context so the marina frontend
        # permission classes see a normal marina-scoped session.
        refresh = RefreshToken.for_user(request.user)
        refresh['scoped_marina_id'] = marina.id
        refresh['scoped_marina_slug'] = marina.slug
        refresh['is_enterprise_sso'] = True
        access = refresh.access_token
        access.set_exp(lifetime=datetime.timedelta(seconds=60))

        return Response({
            'access': str(access),
            'marina_slug': marina.slug,
        })


class GroupSettingsView(APIView):
    permission_classes = [IsAuthenticated, IsGroupAdmin]

    def _data(self, group):
        return {
            'id':                     group.id,
            'name':                   group.name,
            'billing_contact_email':  group.billing_contact_email,
            'vat_number':             group.vat_number,
            'base_currency':          group.base_currency,
        }

    def get(self, request, pk):
        group = get_object_or_404(MarinaGroup, pk=pk)
        return Response(self._data(group))

    def patch(self, request, pk):
        group = get_object_or_404(MarinaGroup, pk=pk)
        allowed = {'name', 'billing_contact_email', 'vat_number', 'base_currency'}
        updated_fields = list(allowed & set(request.data.keys()))
        for field in updated_fields:
            setattr(group, field, request.data[field])
        if updated_fields:
            group.save(update_fields=updated_fields)
        return Response(self._data(group))


class GroupStaffInviteView(APIView):
    permission_classes = [IsAuthenticated, IsGroupAdmin]

    def post(self, request, pk):
        group = get_object_or_404(MarinaGroup, pk=pk)
        email = request.data.get('email', '').strip().lower()
        marina_id_raw = request.data.get('marina_id')
        if not email or not marina_id_raw:
            return Response(
                {'detail': 'email and marina_id are required.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        try:
            marina_id = int(marina_id_raw)
        except (TypeError, ValueError):
            return Response(
                {'detail': 'marina_id must be an integer.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        if not group.memberships.filter(marina_id=marina_id).exists():
            return Response(
                {'detail': 'Marina not in group.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        marina = get_object_or_404(Marina, pk=marina_id)
        user, created = User.objects.get_or_create(
            email=email,
            defaults={'marina': marina, 'role': 'manager', 'is_active': True},
        )
        if not created:
            group_marina_ids = list(group.memberships.values_list('marina_id', flat=True))
            if user.is_active and user.marina_id not in group_marina_ids:
                return Response(
                    {'detail': 'Email already in use by an account in another marina.'},
                    status=http_status.HTTP_400_BAD_REQUEST,
                )
            if not user.is_active:
                user.marina = marina
                user.role = 'manager'
                user.is_active = True
                user.save(update_fields=['marina', 'role', 'is_active'])
        response_status = http_status.HTTP_201_CREATED if created else http_status.HTTP_200_OK
        return Response(
            {'id': user.id, 'email': user.email, 'marina_id': marina.id, 'marina_name': marina.name},
            status=response_status,
        )


class GroupStaffRemoveView(APIView):
    permission_classes = [IsAuthenticated, IsGroupAdmin]

    def post(self, request, pk, user_id):
        group = get_object_or_404(MarinaGroup, pk=pk)
        user = get_object_or_404(User, pk=user_id)
        marina_ids = list(group.memberships.values_list('marina_id', flat=True))
        if user.marina_id not in marina_ids:
            return Response(
                {'detail': 'User not in this group.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )
        user.is_active = False
        user.save(update_fields=['is_active'])
        return Response({'detail': 'Staff removed.'})
