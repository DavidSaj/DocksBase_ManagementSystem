import calendar
import datetime
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from apps.accounts.models import Marina, User
from apps.berths.models import Pier, Berth
from apps.billing.models import ChargeableItem, Invoice, InvoiceLineItem
from apps.members.models import Member
from apps.reservations.models import Booking
from apps.vessels.models import Vessel


def make_marina():
    return Marina.objects.create(name='Test Marina')


def make_user(marina):
    return User.objects.create_user(
        email='staff@test.com', password='pass', marina=marina, role='manager'
    )


def make_pier(marina):
    return Pier.objects.create(marina=marina, code='A', label='Pier A')


def make_berth(marina, pier=None, code='A1'):
    if pier is None:
        pier = make_pier(marina)
    tier = ChargeableItem.objects.create(
        marina=marina, name='Berth Night', category='berth',
        pricing_model='per_night', unit_price=Decimal('50'),
    )
    return Berth.objects.create(marina=marina, pier=pier, code=code, pricing_tier=tier, status='available')


def make_chargeable(marina, category='berth', fuel_dock_type=''):
    return ChargeableItem.objects.create(
        marina=marina,
        name=f'{category} item',
        category=category,
        pricing_model='flat_fee',
        unit_price=Decimal('10'),
        fuel_dock_type=fuel_dock_type,
    )


def make_invoice(marina, total=Decimal('100'), status='paid'):
    count = Invoice.objects.filter(marina=marina).count() + 1
    return Invoice.objects.create(
        marina=marina,
        invoice_number=f'INV-{count:04d}',
        status=status,
        total=total,
    )


# ── RevenueReportView ──────────────────────────────────────────────────────────

class RevenueReportMonthlyTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        self.berth_item = make_chargeable(self.marina, category='berth')
        self.util_item = make_chargeable(self.marina, category='utility')

        inv = make_invoice(self.marina, total=Decimal('86'), status='paid')
        InvoiceLineItem.objects.create(
            invoice=inv, description='Berth', quantity=Decimal('1'),
            unit_price=Decimal('80'), total_price=Decimal('80'),
            chargeable_item=self.berth_item,
        )
        InvoiceLineItem.objects.create(
            invoice=inv, description='Electricity', quantity=Decimal('20'),
            unit_price=Decimal('0.30'), total_price=Decimal('6'),
            chargeable_item=self.util_item,
        )

    def test_returns_monthly_array_with_seven_entries(self):
        resp = self.client.get('/api/v1/reports/revenue/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('monthly', data)
        self.assertEqual(len(data['monthly']), 7)

    def test_monthly_entry_has_category_fields(self):
        resp = self.client.get('/api/v1/reports/revenue/')
        entry = resp.json()['monthly'][-1]
        for field in ('month', 'berths', 'fuel', 'utils', 'other'):
            self.assertIn(field, entry)

    def test_monthly_current_month_reflects_line_items(self):
        resp = self.client.get('/api/v1/reports/revenue/')
        entry = resp.json()['monthly'][-1]
        self.assertEqual(entry['berths'], 80)
        self.assertEqual(entry['utils'], 6)


class RevenueReportAvgStayTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        pier = make_pier(self.marina)
        berth = make_berth(self.marina, pier=pier)
        today = datetime.date.today()
        Booking.objects.create(
            marina=self.marina, berth=berth,
            booking_type='transient', check_in=today, check_out=today + datetime.timedelta(days=4),
            nights=4, status='checked_out',
        )
        Booking.objects.create(
            marina=self.marina, berth=berth,
            booking_type='transient', check_in=today, check_out=today + datetime.timedelta(days=2),
            nights=2, status='confirmed',
        )

    def test_returns_avg_stay(self):
        resp = self.client.get('/api/v1/reports/revenue/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('avg_stay', data)
        self.assertEqual(data['avg_stay'], 3.0)


# ── OccupancyReportView ────────────────────────────────────────────────────────

class OccupancyReportDeparturesTodayTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        pier = make_pier(self.marina)
        self.berth = make_berth(self.marina, pier=pier)
        today = datetime.date.today()
        Booking.objects.create(
            marina=self.marina, berth=self.berth,
            booking_type='transient',
            check_in=today - datetime.timedelta(days=3),
            check_out=today,
            nights=3, status='checked_in',
        )

    def test_returns_departures_today(self):
        resp = self.client.get('/api/v1/reports/occupancy/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('departures_today', data)
        self.assertEqual(len(data['departures_today']), 1)

    def test_departure_has_vessel_and_berth(self):
        resp = self.client.get('/api/v1/reports/occupancy/')
        dep = resp.json()['departures_today'][0]
        self.assertIn('vessel', dep)
        self.assertIn('berth', dep)
        self.assertEqual(dep['berth'], 'A1')


# ── UtilisationReportView ──────────────────────────────────────────────────────

class UtilisationReportDaysTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        pier = make_pier(self.marina)
        self.berth = make_berth(self.marina, pier=pier)
        today = datetime.date.today()
        month_start = today.replace(day=1)
        Booking.objects.create(
            marina=self.marina, berth=self.berth,
            booking_type='transient',
            check_in=month_start,
            check_out=today,
            nights=(today - month_start).days, status='checked_in',
        )

    def test_berths_have_days_this_month(self):
        resp = self.client.get('/api/v1/reports/utilisation/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('berths', data)
        berth = data['berths'][0]
        self.assertIn('days_this_month', berth)
        self.assertIn('util_pct', berth)

    def test_days_this_month_reflects_booking(self):
        today = datetime.date.today()
        month_start = today.replace(day=1)
        expected_days = (today - month_start).days

        resp = self.client.get('/api/v1/reports/utilisation/')
        berth = resp.json()['berths'][0]
        self.assertEqual(berth['days_this_month'], expected_days)
