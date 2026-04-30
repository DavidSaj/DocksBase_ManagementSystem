from datetime import date
from rest_framework.views import APIView
from rest_framework.response import Response
from django.db.models import Count, Sum, Q
from apps.berths.models import Berth
from apps.reservations.models import Booking
from apps.billing.models import Invoice
from apps.vessels.models import InsuranceRecord, SafetyEquipment


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
            marina=marina, check_in=today, status__in=['confirmed', 'pending']
        ).select_related('vessel', 'berth')

        return Response({
            'total_berths': total,
            'occupied': occupied,
            'available': available,
            'reserved': reserved,
            'maintenance': maintenance,
            'occupancy_pct': round(occupied / total * 100, 1) if total else 0,
            'arrivals_today': [
                {'vessel': b.vessel.name, 'berth': b.berth.code, 'status': b.status}
                for b in arrivals
            ],
        })


class RevenueReportView(APIView):
    def get(self, request):
        marina = request.user.marina
        today = date.today()
        month_start = today.replace(day=1)

        invoices = Invoice.objects.filter(marina=marina)
        month_rev = invoices.filter(issued__gte=month_start).aggregate(total=Sum('amount'))['total'] or 0
        paid = invoices.filter(status='paid').count()
        unpaid = invoices.filter(status='unpaid').count()
        overdue = invoices.filter(status='overdue').count()
        outstanding = invoices.filter(status__in=['unpaid', 'overdue']).aggregate(total=Sum('amount'))['total'] or 0

        return Response({
            'revenue_this_month': month_rev,
            'outstanding': outstanding,
            'invoices_paid': paid,
            'invoices_unpaid': unpaid,
            'invoices_overdue': overdue,
        })


class UtilisationReportView(APIView):
    def get(self, request):
        marina = request.user.marina
        berths = Berth.objects.filter(marina=marina).select_related('pier', 'vessel')
        data = []
        for b in berths:
            bookings = b.bookings.filter(status='active').count()
            data.append({
                'berth': b.code,
                'pier': b.pier.code,
                'status': b.status,
                'vessel': b.vessel.name if b.vessel else None,
            })
        return Response({'berths': data})


class ComplianceReportView(APIView):
    def get(self, request):
        marina = request.user.marina
        today = date.today()

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
