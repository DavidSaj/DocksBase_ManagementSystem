from rest_framework import serializers
from apps.accounts.models import MarinaGroup, MarinaGroupUserRole
from django.db.models import Sum
from decimal import Decimal


class GroupSummarySerializer(serializers.ModelSerializer):
    marina_count = serializers.SerializerMethodField()

    class Meta:
        model = MarinaGroup
        fields = ['id', 'name', 'slug', 'base_currency', 'marina_count', 'max_marinas']

    def get_marina_count(self, obj):
        return obj.memberships.count()


def _active_bookings_count(marina):
    return marina.bookings.filter(
        status__in=['confirmed', 'pending', 'checked_in', 'awaiting_payment', 'pending_payment']
    ).count()


def _revenue_this_month(marina):
    from django.utils import timezone
    from apps.billing.models import Invoice
    now = timezone.now()
    period = f'{now.year}-{now.month:02d}'
    total = Invoice.objects.filter(
        marina=marina, status='paid', billing_period=period
    ).aggregate(t=Sum('total'))['t']
    return str(total or Decimal('0.00'))


def build_marina_card(marina):
    active = _active_bookings_count(marina)
    occupancy = round(active / marina.total_berths * 100, 1) if marina.total_berths else 0
    return {
        'id':                marina.id,
        'name':              marina.name,
        'slug':              marina.slug,
        'status':            marina.status,
        'total_berths':      marina.total_berths,
        'active_bookings':   active,
        'occupancy_pct':     occupancy,
        'revenue_this_month': _revenue_this_month(marina),
        'currency':          marina.currency,
    }
