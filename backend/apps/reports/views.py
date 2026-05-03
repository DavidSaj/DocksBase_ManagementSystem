import calendar
from datetime import date
from decimal import Decimal

from django.db.models import Avg, Sum
from rest_framework.views import APIView
from rest_framework.response import Response

from apps.berths.models import Berth
from apps.billing.models import ChargeableItem, Invoice, InvoiceLineItem
from apps.reservations.models import Booking
from apps.vessels.models import InsuranceRecord


def _month_range(year, month):
    last = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last)


def _months_back(today, n):
    """Return (year, month) that is n months before today."""
    month = today.month - n
    year = today.year
    while month <= 0:
        month += 12
        year -= 1
    return year, month


_CATEGORIES = [
    ChargeableItem.Category.BERTH,
    ChargeableItem.Category.UTILITY,
    ChargeableItem.Category.SERVICE,
    ChargeableItem.Category.RETAIL,
]


def _month_revenue_by_category(marina, year, month):
    """
    Return a dict keyed by category slug (berth, utility, service, retail)
    for the given month. Line items with no ChargeableItem are counted as
    'service'.
    """
    start, end = _month_range(year, month)
    items = InvoiceLineItem.objects.filter(
        invoice__marina=marina,
        invoice__created_at__date__gte=start,
        invoice__created_at__date__lte=end,
    ).select_related('chargeable_item')

    valid_cats = {c.value for c in _CATEGORIES}
    totals = {cat.value: Decimal('0') for cat in _CATEGORIES}
    for item in items:
        ci = item.chargeable_item
        if ci is None or ci.category not in valid_cats:
            totals[ChargeableItem.Category.SERVICE] += item.total_price
        else:
            totals[ci.category] += item.total_price
    return {cat: float(val) for cat, val in totals.items()}


def _booking_to_dict(b):
    return {
        'vessel': b.vessel.name if b.vessel else (b.guest_name or 'Guest'),
        'berth': b.berth.code if b.berth else '?',
        'status': b.status,
    }


class OccupancyReportView(APIView):
    def get(self, request):
        marina = request.user.marina
        berths = Berth.objects.filter(marina=marina)
        total = berths.count()
        occupied = berths.filter(status='occupied').count()
        available = berths.filter(status='available').count()
        reserved = berths.filter(status='reserved').count()
        maintenance = berths.filter(status='maintenance').count()

        today = date.today()
        arrivals = Booking.objects.filter(
            marina=marina, check_in=today,
            status__in=['confirmed', 'pending'],
        ).select_related('vessel', 'berth')

        departures = Booking.objects.filter(
            marina=marina, check_out=today,
            status__in=['confirmed', 'checked_in', 'overstay'],
        ).select_related('vessel', 'berth')

        month_start = today.replace(day=1)
        month_bookings = Booking.objects.filter(
            marina=marina,
            check_in__gte=month_start,
            status__in=['confirmed', 'checked_in', 'checked_out', 'overstay'],
        )
        stays = [(b.check_out - b.check_in).days for b in month_bookings]
        avg_stay = round(sum(stays) / len(stays), 1) if stays else None

        return Response({
            'total_berths': total,
            'occupied': occupied,
            'available': available,
            'reserved': reserved,
            'maintenance': maintenance,
            'occupancy_pct': round(occupied / total * 100, 1) if total else 0,
            'arrivals_today': [_booking_to_dict(b) for b in arrivals],
            'departures_today': [_booking_to_dict(b) for b in departures],
            'avg_stay_nights': avg_stay,
        })


class RevenueReportView(APIView):
    def get(self, request):
        marina = request.user.marina
        today = date.today()
        month_start = today.replace(day=1)

        invoices = Invoice.objects.filter(marina=marina)
        outstanding = invoices.filter(status='open').aggregate(t=Sum('total'))['t'] or 0
        paid = invoices.filter(status='paid').count()
        open_count = invoices.filter(status='open').count()
        overdue = invoices.filter(status='open', due_date__lt=today).count()

        avg = (
            marina.bookings
            .filter(booking_type='transient', nights__gt=0)
            .aggregate(a=Avg('nights'))['a'] or 0
        )

        monthly_breakdown = []
        for i in range(6, -1, -1):
            year, month = _months_back(today, i)
            cats = _month_revenue_by_category(marina, year, month)
            monthly_breakdown.append({
                'month': f'{year}-{month:02d}',
                **cats,
            })

        current_month_by_category = _month_revenue_by_category(marina, today.year, today.month)

        return Response({
            'revenue_this_month': float(
                invoices.filter(created_at__date__gte=month_start).aggregate(t=Sum('total'))['t'] or 0
            ),
            'outstanding': float(outstanding),
            'invoices_paid': paid,
            'invoices_unpaid': open_count,
            'invoices_overdue': overdue,
            'monthly_breakdown': monthly_breakdown,
            'current_month_by_category': current_month_by_category,
        })


class UtilisationReportView(APIView):
    def get(self, request):
        marina = request.user.marina
        today = date.today()
        month_start = today.replace(day=1)
        days_in_month = calendar.monthrange(today.year, today.month)[1]
        month_end = date(today.year, today.month, days_in_month)

        berths = Berth.objects.filter(marina=marina).select_related('pier', 'vessel')
        data = []
        for b in berths:
            days = 0
            for booking in b.bookings.filter(
                check_in__lte=month_end,
                check_out__gte=month_start,
                status__in=['confirmed', 'checked_in', 'checked_out'],
            ):
                overlap_start = max(booking.check_in, month_start)
                overlap_end = min(booking.check_out, today)
                if overlap_end > overlap_start:
                    days += (overlap_end - overlap_start).days

            data.append({
                'berth':           b.code,
                'pier':            b.pier.code if b.pier else '',
                'status':          b.status,
                'vessel':          b.vessel.name if b.vessel else None,
                'days_this_month': days,
                'util_pct':        round(days / days_in_month * 100, 1) if days_in_month else 0,
            })
        return Response({'berths': data})


class ComplianceReportView(APIView):
    def get(self, request):
        marina = request.user.marina

        insurance_expired = InsuranceRecord.objects.filter(
            marina=marina, status='expired'
        ).count()
        insurance_due = InsuranceRecord.objects.filter(
            marina=marina, status='due_soon'
        ).count()

        return Response({
            'insurance_expired': insurance_expired,
            'insurance_due_soon': insurance_due,
        })
