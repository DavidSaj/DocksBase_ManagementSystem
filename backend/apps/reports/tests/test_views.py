import calendar
from datetime import date, timedelta
from decimal import Decimal
from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from apps.accounts.models import Marina, User
from apps.berths.models import Pier, Berth
from apps.reservations.models import Booking
from apps.billing.models import Invoice, InvoiceLineItem, ChargeableItem
from apps.vessels.models import Vessel


def make_user_with_marina(email='owner@test.com'):
    marina = Marina.objects.create(name=f'Test Marina {email}')
    user = User.objects.create_user(email=email, password='testpass', marina=marina)
    return user, marina


def auth_client(user):
    client = APIClient()
    refresh = RefreshToken.for_user(user)
    client.credentials(HTTP_AUTHORIZATION=f'Bearer {refresh.access_token}')
    return client


class RevenueReportViewTest(TestCase):
    def setUp(self):
        self.user, self.marina = make_user_with_marina('rev@test.com')
        self.client = auth_client(self.user)

        self.ci_berth = ChargeableItem.objects.create(
            marina=self.marina, name='Berth Fee', category='berth',
            pricing_model='per_night', unit_price=Decimal('100.00'),
        )
        self.ci_utility = ChargeableItem.objects.create(
            marina=self.marina, name='Electric', category='utility',
            pricing_model='per_kwh', unit_price=Decimal('0.30'),
        )

        today = date.today()
        inv = Invoice.objects.create(
            marina=self.marina,
            invoice_number='INV-001',
            status='paid',
            total=Decimal('350.00'),
        )
        InvoiceLineItem.objects.create(
            invoice=inv, description='Berth A1',
            quantity=Decimal('3'), unit_price=Decimal('100.00'),
            total_price=Decimal('300.00'), chargeable_item=self.ci_berth,
        )
        InvoiceLineItem.objects.create(
            invoice=inv, description='Electric',
            quantity=Decimal('100'), unit_price=Decimal('0.30'),
            total_price=Decimal('50.00'), chargeable_item=self.ci_utility,
        )

        overdue_inv = Invoice.objects.create(
            marina=self.marina,
            invoice_number='INV-002',
            status='open',
            due_date=today - timedelta(days=5),
            total=Decimal('200.00'),
        )

    def test_monthly_breakdown_present(self):
        resp = self.client.get('/api/v1/reports/revenue/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('monthly_breakdown', data)
        self.assertEqual(len(data['monthly_breakdown']), 7)
        entry = data['monthly_breakdown'][-1]
        for key in ('month', 'berth', 'utility', 'service', 'retail'):
            self.assertIn(key, entry)

    def test_current_month_category_totals(self):
        resp = self.client.get('/api/v1/reports/revenue/')
        data = resp.json()
        self.assertIn('current_month_by_category', data)
        cats = data['current_month_by_category']
        self.assertAlmostEqual(cats['berth'], 300.0, places=1)
        self.assertAlmostEqual(cats['utility'], 50.0, places=1)

    def test_invoices_overdue_count(self):
        resp = self.client.get('/api/v1/reports/revenue/')
        data = resp.json()
        self.assertEqual(data['invoices_overdue'], 1)

    def test_null_chargeable_item_counted_as_service(self):
        inv = Invoice.objects.create(
            marina=self.marina, invoice_number='INV-003',
            status='paid', total=Decimal('40.00'),
        )
        InvoiceLineItem.objects.create(
            invoice=inv, description='Misc',
            quantity=Decimal('1'), unit_price=Decimal('40.00'),
            total_price=Decimal('40.00'), chargeable_item=None,
        )
        resp = self.client.get('/api/v1/reports/revenue/')
        data = resp.json()
        cats = data['current_month_by_category']
        self.assertGreaterEqual(cats['service'], 40.0)


class OccupancyReportViewTest(TestCase):
    def setUp(self):
        self.user, self.marina = make_user_with_marina('occ@test.com')
        self.client = auth_client(self.user)

        pricing_tier = ChargeableItem.objects.create(
            marina=self.marina, name='Berth Night', category='berth',
            pricing_model='per_night', unit_price=Decimal('50.00'),
        )
        pier = Pier.objects.create(
            marina=self.marina, code='A',
            polygon_points=[[0,0],[10,0],[10,5],[0,5]],
        )
        self.berth = Berth.objects.create(
            marina=self.marina, pier=pier,
            code='A1', status='occupied', pricing_tier=pricing_tier,
        )
        self.vessel = Vessel.objects.create(
            marina=self.marina, name='Test Boat',
        )

        today = date.today()
        month_start = today.replace(day=1)

        # Departure today — check_in this month so it also counts toward avg stay
        Booking.objects.create(
            marina=self.marina, berth=self.berth, vessel=self.vessel,
            check_in=month_start,
            check_out=today,
            status='checked_in',
        )
        # Completed booking this month: exactly 3 nights
        Booking.objects.create(
            marina=self.marina, berth=self.berth, vessel=self.vessel,
            check_in=month_start,
            check_out=month_start + timedelta(days=3),
            status='checked_out',
        )

    def test_departures_today_present(self):
        resp = self.client.get('/api/v1/reports/occupancy/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('departures_today', data)
        self.assertEqual(len(data['departures_today']), 1)
        self.assertEqual(data['departures_today'][0]['vessel'], 'Test Boat')
        self.assertEqual(data['departures_today'][0]['berth'], 'A1')

    def test_avg_stay_nights_is_numeric(self):
        resp = self.client.get('/api/v1/reports/occupancy/')
        data = resp.json()
        self.assertIn('avg_stay_nights', data)
        self.assertIsNotNone(data['avg_stay_nights'])
        self.assertIsInstance(data['avg_stay_nights'], float)

    def test_avg_stay_none_when_no_bookings(self):
        Booking.objects.filter(marina=self.marina).delete()
        resp = self.client.get('/api/v1/reports/occupancy/')
        data = resp.json()
        self.assertIsNone(data['avg_stay_nights'])


class UtilisationReportViewTest(TestCase):
    def setUp(self):
        self.user, self.marina = make_user_with_marina('util@test.com')
        self.client = auth_client(self.user)

        pricing_tier = ChargeableItem.objects.create(
            marina=self.marina, name='Berth Night', category='berth',
            pricing_model='per_night', unit_price=Decimal('50.00'),
        )
        pier = Pier.objects.create(
            marina=self.marina, code='B',
            polygon_points=[[0,0],[10,0],[10,5],[0,5]],
        )
        self.berth = Berth.objects.create(
            marina=self.marina, pier=pier,
            code='B1', status='occupied', pricing_tier=pricing_tier,
        )
        self.vessel = Vessel.objects.create(
            marina=self.marina, name='Day Tripper',
        )

        today = date.today()
        month_start = today.replace(day=1)

        # Booking occupying 3 days this month (confirmed)
        Booking.objects.create(
            marina=self.marina, berth=self.berth, vessel=self.vessel,
            check_in=month_start,
            check_out=month_start + timedelta(days=3),
            status='confirmed',
        )
        # Same-day booking (day stay) — should count as 1 day
        Booking.objects.create(
            marina=self.marina, berth=self.berth, vessel=self.vessel,
            check_in=month_start + timedelta(days=5),
            check_out=month_start + timedelta(days=5),
            status='confirmed',
        )

    def test_berths_list_has_utilisation_fields(self):
        resp = self.client.get('/api/v1/reports/utilisation/')
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn('berths', data)
        b = data['berths'][0]
        self.assertIn('days_occupied', b)
        self.assertIn('util_pct', b)

    def test_days_occupied_correct(self):
        resp = self.client.get('/api/v1/reports/utilisation/')
        data = resp.json()
        b = next(x for x in data['berths'] if x['berth'] == 'B1')
        # 3 nights + 1 (day stay) = 4 days occupied
        self.assertEqual(b['days_occupied'], 4)

    def test_util_pct_correct(self):
        import calendar as cal
        today = date.today()
        days_in_month = cal.monthrange(today.year, today.month)[1]
        expected_pct = round(4 / days_in_month * 100, 1)

        resp = self.client.get('/api/v1/reports/utilisation/')
        data = resp.json()
        b = next(x for x in data['berths'] if x['berth'] == 'B1')
        self.assertAlmostEqual(b['util_pct'], expected_pct, places=1)
