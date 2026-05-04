# Reports Real Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all hardcoded mock data in Reports.jsx with live data from the four `/api/v1/reports/` backend views, and wire the existing `useReports` hook into the UI.

**Architecture:** Extend four existing Django views in-place to return richer aggregated data. The frontend `useReports` hook already calls all three endpoints in parallel — Reports.jsx just needs to consume the real responses instead of the `MONTHLY_REV` and `BERTH_UTIL` constants.

**Tech Stack:** Django REST Framework (backend aggregation), React 19 + hooks (frontend), pytest/Django TestCase (tests), Vitest (frontend tests — not required for this plan).

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `backend/apps/reports/views.py` | Modify | All four report views — add new aggregated fields |
| `backend/apps/reports/tests/__init__.py` | Create | Empty init |
| `backend/apps/reports/tests/test_views.py` | Create | Tests for all four views |
| `frontend/src/hooks/useReports.js` | Read-only / no change | Already correct — calls all three endpoints |
| `frontend/src/screens/Reports.jsx` | Modify | Consume `useReports()` data, remove mock constants |

---

## Task 1: Extend RevenueReportView — monthly breakdown + category breakdown + overdue

**Files:**
- Modify: `backend/apps/reports/views.py`
- Create: `backend/apps/reports/tests/__init__.py`
- Create: `backend/apps/reports/tests/test_views.py`

- [ ] **Step 1: Create test file scaffold**

Create `backend/apps/reports/tests/__init__.py` (empty).

Create `backend/apps/reports/tests/test_views.py`:

```python
import calendar
from datetime import date
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
```

- [ ] **Step 2: Write failing test for monthly_breakdown**

Add to `test_views.py`:

```python
class RevenueReportViewTest(TestCase):
    def setUp(self):
        self.user, self.marina = make_user_with_marina('rev@test.com')
        self.client = auth_client(self.user)

        # Chargeable items for each category
        self.ci_berth = ChargeableItem.objects.create(
            marina=self.marina, name='Berth Fee', category='berth',
            pricing_model='per_night', unit_price=Decimal('100.00'),
        )
        self.ci_utility = ChargeableItem.objects.create(
            marina=self.marina, name='Electric', category='utility',
            pricing_model='per_kwh', unit_price=Decimal('0.30'),
        )

        # Invoice in current month with line items
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

        # Overdue invoice
        from datetime import timedelta
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
        # Each entry has required keys
        entry = data['monthly_breakdown'][-1]  # current month last
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
```

- [ ] **Step 3: Run test to confirm it fails**

```
cd backend
python manage.py test apps.reports.tests.test_views.RevenueReportViewTest -v 2
```

Expected: FAIL — `monthly_breakdown` key missing from response.

- [ ] **Step 4: Implement the extended RevenueReportView**

Replace the existing `RevenueReportView` class in `backend/apps/reports/views.py` with:

```python
import calendar as cal
from datetime import date, timedelta
from rest_framework.views import APIView
from rest_framework.response import Response
from django.db.models import Count, Sum, Q
from apps.berths.models import Berth
from apps.reservations.models import Booking
from apps.billing.models import Invoice, InvoiceLineItem
from apps.vessels.models import InsuranceRecord


CATEGORIES = ['berth', 'utility', 'service', 'retail']


def _month_revenue_by_category(marina, year, month):
    """Return {berth, utility, service, retail} totals for a given month."""
    month_start = date(year, month, 1)
    month_end = date(year, month, cal.monthrange(year, month)[1])
    items = InvoiceLineItem.objects.filter(
        invoice__marina=marina,
        invoice__created_at__date__gte=month_start,
        invoice__created_at__date__lte=month_end,
    )
    result = {}
    for cat in CATEGORIES:
        val = items.filter(chargeable_item__category=cat).aggregate(s=Sum('total_price'))['s'] or 0
        result[cat] = float(val)
    # NULL chargeable_item → service
    null_val = items.filter(chargeable_item__isnull=True).aggregate(s=Sum('total_price'))['s'] or 0
    result['service'] += float(null_val)
    return result


def _last_n_months(n, today):
    """Return list of (year, month) tuples, oldest first, ending at today's month."""
    months = []
    year, month = today.year, today.month
    for i in range(n - 1, -1, -1):
        m = month - i
        y = year
        while m <= 0:
            m += 12
            y -= 1
        months.append((y, m))
    return months


class RevenueReportView(APIView):
    def get(self, request):
        marina = request.user.marina
        today = date.today()
        month_start = today.replace(day=1)

        invoices = Invoice.objects.filter(marina=marina)
        month_rev = invoices.filter(created_at__date__gte=month_start).aggregate(total=Sum('total'))['total'] or 0
        paid = invoices.filter(status='paid').count()
        open_count = invoices.filter(status='open').count()
        outstanding = invoices.filter(status='open').aggregate(total=Sum('total'))['total'] or 0
        overdue = invoices.filter(status='open', due_date__lt=today).count()

        monthly_breakdown = []
        for year, month in _last_n_months(7, today):
            cats = _month_revenue_by_category(marina, year, month)
            monthly_breakdown.append({'month': f'{year}-{month:02d}', **cats})

        current_month_by_category = _month_revenue_by_category(marina, today.year, today.month)

        return Response({
            'revenue_this_month': float(month_rev),
            'outstanding': float(outstanding),
            'invoices_paid': paid,
            'invoices_unpaid': open_count,
            'invoices_overdue': overdue,
            'monthly_breakdown': monthly_breakdown,
            'current_month_by_category': current_month_by_category,
        })
```

**Important:** The other three view classes (`OccupancyReportView`, `UtilisationReportView`, `ComplianceReportView`) and the old `from datetime import date` import at the top of the file remain unchanged for now. Add `import calendar as cal` to the existing imports at the top.

- [ ] **Step 5: Run tests to confirm they pass**

```
cd backend
python manage.py test apps.reports.tests.test_views.RevenueReportViewTest -v 2
```

Expected: all 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/reports/views.py backend/apps/reports/tests/
git commit -m "feat(reports): extend RevenueReportView with monthly breakdown, category totals, overdue count"
```

---

## Task 2: Extend OccupancyReportView — departures today + avg stay nights

**Files:**
- Modify: `backend/apps/reports/views.py`
- Modify: `backend/apps/reports/tests/test_views.py`

- [ ] **Step 1: Write failing tests**

Add to `test_views.py`:

```python
class OccupancyReportViewTest(TestCase):
    def setUp(self):
        self.user, self.marina = make_user_with_marina('occ@test.com')
        self.client = auth_client(self.user)

        pier = Pier.objects.create(
            marina=self.marina, code='A',
            polygon_points=[[0,0],[10,0],[10,5],[0,5]],
        )
        self.berth = Berth.objects.create(
            marina=self.marina, pier=pier,
            code='A1', status='occupied',
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
        # Completed booking this month: exactly 3 nights, check_in = month_start + 1 day (safe)
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
        # Two bookings both starting this month → avg_stay_nights is a number
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
```

Add `from datetime import timedelta` to the imports at the top of `test_views.py` (already has `date` — add `timedelta`).

- [ ] **Step 2: Run tests to confirm they fail**

```
cd backend
python manage.py test apps.reports.tests.test_views.OccupancyReportViewTest -v 2
```

Expected: FAIL — `departures_today` key missing.

- [ ] **Step 3: Implement extended OccupancyReportView**

Replace the existing `OccupancyReportView` class in `views.py` with:

```python
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
            'arrivals_today': [
                {'vessel': b.vessel.name if b.vessel else b.guest_name,
                 'berth': b.berth.code if b.berth else '—',
                 'status': b.status}
                for b in arrivals
            ],
            'departures_today': [
                {'vessel': b.vessel.name if b.vessel else b.guest_name,
                 'berth': b.berth.code if b.berth else '—',
                 'status': b.status}
                for b in departures
            ],
            'avg_stay_nights': avg_stay,
        })
```

- [ ] **Step 4: Run tests to confirm they pass**

```
cd backend
python manage.py test apps.reports.tests.test_views.OccupancyReportViewTest -v 2
```

Expected: all 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/reports/views.py backend/apps/reports/tests/test_views.py
git commit -m "feat(reports): extend OccupancyReportView with departures_today and avg_stay_nights"
```

---

## Task 3: Extend UtilisationReportView — days_occupied + util_pct per berth

**Files:**
- Modify: `backend/apps/reports/views.py`
- Modify: `backend/apps/reports/tests/test_views.py`

- [ ] **Step 1: Write failing tests**

Add to `test_views.py`:

```python
class UtilisationReportViewTest(TestCase):
    def setUp(self):
        self.user, self.marina = make_user_with_marina('util@test.com')
        self.client = auth_client(self.user)

        pier = Pier.objects.create(
            marina=self.marina, code='B',
            polygon_points=[[0,0],[10,0],[10,5],[0,5]],
        )
        self.berth = Berth.objects.create(
            marina=self.marina, pier=pier,
            code='B1', status='occupied',
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
```

- [ ] **Step 2: Run tests to confirm they fail**

```
cd backend
python manage.py test apps.reports.tests.test_views.UtilisationReportViewTest -v 2
```

Expected: FAIL — `days_occupied` key missing.

- [ ] **Step 3: Implement extended UtilisationReportView**

Replace the existing `UtilisationReportView` class in `views.py` with:

```python
class UtilisationReportView(APIView):
    def get(self, request):
        marina = request.user.marina
        today = date.today()
        month_start = today.replace(day=1)
        days_in_month = cal.monthrange(today.year, today.month)[1]
        month_end = date(today.year, today.month, days_in_month)

        berths = Berth.objects.filter(marina=marina).select_related('pier', 'vessel')
        data = []
        for b in berths:
            overlapping = b.bookings.filter(
                status__in=['confirmed', 'checked_in', 'overstay'],
                check_in__lte=month_end,
                check_out__gte=month_start,
            )
            days_occupied = 0
            for bk in overlapping:
                clamped_in = max(bk.check_in, month_start)
                clamped_out = min(bk.check_out, month_end)
                nights = (clamped_out - clamped_in).days
                days_occupied += max(1, nights)

            util_pct = round(days_occupied / days_in_month * 100, 1)
            data.append({
                'berth': b.code,
                'pier': b.pier.code if b.pier else '—',
                'status': b.status,
                'vessel': b.vessel.name if b.vessel else None,
                'days_occupied': days_occupied,
                'util_pct': util_pct,
            })

        return Response({'berths': data})
```

- [ ] **Step 4: Run all report tests**

```
cd backend
python manage.py test apps.reports.tests.test_views -v 2
```

Expected: all tests in all three test classes PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/reports/views.py backend/apps/reports/tests/test_views.py
git commit -m "feat(reports): extend UtilisationReportView with days_occupied and util_pct using midnight-crossing rule"
```

---

## Task 4: Wire Revenue tab to real data

**Files:**
- Modify: `frontend/src/screens/Reports.jsx`

- [ ] **Step 1: Import useReports and remove mock constants**

At the top of `Reports.jsx`, add the import and remove the two constants:

```jsx
import useReports from '../hooks/useReports.js';
```

Delete these lines (lines 10–29):
```jsx
const MONTHLY_REV = [
  { month: 'Oct', berths: 4200, ... },
  ...
];

const BERTH_UTIL = [
  { berth: 'A1', vessel: 'Ocean Star', ... },
  ...
];
```

- [ ] **Step 2: Add useReports hook call**

Inside the `Reports()` component, after the existing hook calls, add:

```jsx
const { revenue: revReport, occupancy: occReport, utilisation: utilReport, loading: repLoading } = useReports();
```

- [ ] **Step 3: Replace revenue KPI cards with real data**

Find and replace the revenue KPI card definitions (the array passed to `.map(k => ...)` inside `{tab === 'revenue' && ...}`):

Replace:
```jsx
{ label: 'Revenue — April', val: `€${totalRevApr.toLocaleString()}`, sub: '+22% vs Mar 2026' },
{ label: 'Berth Fees',      val: `€${MONTHLY_REV[6].berths.toLocaleString()}`, sub: `${Math.round(MONTHLY_REV[6].berths/totalRevApr*100)}% of total` },
{ label: 'Fuel Sales',      val: `€${MONTHLY_REV[6].fuel.toLocaleString()}`,   sub: `${Math.round(MONTHLY_REV[6].fuel/totalRevApr*100)}% of total` },
{ label: 'Outstanding',     val: invLoading ? '…' : `€${rawInv.filter(i=>i.status!=='paid').reduce((s,i)=>s+Number(i.amount||0),0).toLocaleString('de-DE',{minimumFractionDigits:2})}`, sub: `${invoices.filter(i=>i.status!=='paid').length} invoices unpaid` },
```

With:
```jsx
{ label: `Revenue — ${new Date().toLocaleString('default', { month: 'long' })}`,
  val: revReport ? `€${Number(revReport.revenue_this_month).toLocaleString('de-DE', {minimumFractionDigits:2})}` : '…',
  sub: 'Current month total' },
{ label: 'Berth Fees',
  val: revReport ? `€${Number(revReport.current_month_by_category?.berth ?? 0).toLocaleString()}` : '…',
  sub: revReport ? `${Math.round((revReport.current_month_by_category?.berth ?? 0) / (revReport.revenue_this_month || 1) * 100)}% of total` : '' },
{ label: 'Utilities & Services',
  val: revReport ? `€${Number((revReport.current_month_by_category?.utility ?? 0) + (revReport.current_month_by_category?.service ?? 0)).toLocaleString()}` : '…',
  sub: 'Utility + service lines' },
{ label: 'Outstanding',
  val: revReport ? `€${Number(revReport.outstanding).toLocaleString('de-DE', {minimumFractionDigits:2})}` : '…',
  sub: revReport ? `${revReport.invoices_unpaid} unpaid, ${revReport.invoices_overdue} overdue` : '' },
```

Also delete these now-unused derived variables near the top of the component:
```jsx
const totalRevApr = MONTHLY_REV[6].berths + MONTHLY_REV[6].fuel + MONTHLY_REV[6].utils + MONTHLY_REV[6].other;
const maxMonthRev = Math.max(...MONTHLY_REV.map(m => m.berths + m.fuel + m.utils + m.other));
```

Add these replacements above the `return`:
```jsx
const monthlyData = revReport?.monthly_breakdown ?? [];
const maxMonthRev = Math.max(...monthlyData.map(m => (m.berth||0)+(m.utility||0)+(m.service||0)+(m.retail||0)), 1);
```

- [ ] **Step 4: Replace monthly revenue chart with real data**

Find the monthly chart section and replace:
```jsx
<div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Monthly Revenue — Oct 2025 to Apr 2026</div>
<div className="chart-wrap">
  {MONTHLY_REV.map(m => {
    const total = m.berths + m.fuel + m.utils + m.other;
    return (
      <div key={m.month} className="chart-row">
        <div className="chart-lbl">{m.month}</div>
        <Bar val={total} max={maxMonthRev} color={m.month === 'Apr' ? 'var(--teal)' : 'var(--navy)'} />
        <div className="chart-val">€{(total/1000).toFixed(1)}k</div>
      </div>
    );
  })}
</div>
```

With:
```jsx
<div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Monthly Revenue — Last 7 Months</div>
{repLoading ? (
  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '12px 0' }}>Loading…</div>
) : (
  <div className="chart-wrap">
    {monthlyData.map((m, i) => {
      const total = (m.berth||0)+(m.utility||0)+(m.service||0)+(m.retail||0);
      const isCurrentMonth = i === monthlyData.length - 1;
      const label = new Date(m.month + '-01').toLocaleString('default', { month: 'short' });
      return (
        <div key={m.month} className="chart-row">
          <div className="chart-lbl">{label}</div>
          <Bar val={total} max={maxMonthRev} color={isCurrentMonth ? 'var(--teal)' : 'var(--navy)'} />
          <div className="chart-val">€{(total/1000).toFixed(1)}k</div>
        </div>
      );
    })}
  </div>
)}
```

- [ ] **Step 5: Replace Revenue by Department chart with real data**

Find and replace the Department chart section:
```jsx
<div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Revenue by Department — April</div>
<div className="chart-wrap">
  {[
    { label: 'Berth Fees', val: MONTHLY_REV[6].berths, color: 'var(--navy)' },
    { label: 'Fuel Dock',  val: MONTHLY_REV[6].fuel,   color: 'var(--teal)' },
    { label: 'Utilities',  val: MONTHLY_REV[6].utils,  color: '#0075de' },
    { label: 'Other',      val: MONTHLY_REV[6].other,  color: 'var(--gold)' },
  ].map(d => (
    <div key={d.label} className="chart-row">
      <div className="chart-lbl">{d.label}</div>
      <Bar val={d.val} max={MONTHLY_REV[6].berths} color={d.color} />
      <div className="chart-val">€{d.val.toLocaleString()}</div>
    </div>
  ))}
</div>
```

With:
```jsx
<div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
  Revenue by Department — {new Date().toLocaleString('default', { month: 'long' })}
</div>
{repLoading ? (
  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '6px 0' }}>Loading…</div>
) : (() => {
  const cats = revReport?.current_month_by_category ?? {};
  const deptMax = Math.max(cats.berth||0, cats.utility||0, cats.service||0, cats.retail||0, 1);
  return (
    <div className="chart-wrap">
      {[
        { label: 'Berth Fees', val: cats.berth   || 0, color: 'var(--navy)' },
        { label: 'Utilities',  val: cats.utility  || 0, color: '#0075de' },
        { label: 'Services',   val: cats.service  || 0, color: 'var(--teal)' },
        { label: 'Retail',     val: cats.retail   || 0, color: 'var(--gold)' },
      ].map(d => (
        <div key={d.label} className="chart-row">
          <div className="chart-lbl">{d.label}</div>
          <Bar val={d.val} max={deptMax} color={d.color} />
          <div className="chart-val">€{Number(d.val).toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
})()}
```

- [ ] **Step 6: Fix invoice status badges — add overdue computation**

Find the Invoice Status section (the `['Paid', ..., 'Unpaid', ..., 'Overdue', ...]` mapping) and replace:
```jsx
['Paid',    invoices.filter(i=>i.status==='paid').length,   'badge-green'],
['Unpaid',  invoices.filter(i=>i.status==='unpaid').length,  'badge-orange'],
['Overdue', invoices.filter(i=>i.status==='overdue').length, 'badge-red'],
```

With:
```jsx
['Paid',    invoices.filter(i=>i.status==='paid').length,             'badge-green'],
['Unpaid',  invoices.filter(i=>i.status==='open').length,             'badge-orange'],
['Overdue', revReport?.invoices_overdue ?? 0,                         'badge-red'],
```

- [ ] **Step 7: Commit**

```bash
git add frontend/src/screens/Reports.jsx
git commit -m "feat(reports): wire Revenue tab to real backend data, replace MONTHLY_REV constant"
```

---

## Task 5: Wire Occupancy tab — Arrivals/Departures Today + Avg Stay

**Files:**
- Modify: `frontend/src/screens/Reports.jsx`

- [ ] **Step 1: Replace Avg Stay KPI with real value**

In the Occupancy KPI cards array, find:
```jsx
{ label: 'Avg Stay (nights)', val: '3.8', sub: 'Transient berths Apr' },
```

Replace with:
```jsx
{ label: 'Avg Stay (nights)',
  val: repLoading ? '…' : (occReport?.avg_stay_nights ?? '—'),
  sub: `${new Date().toLocaleString('default', { month: 'long' })} bookings` },
```

- [ ] **Step 2: Replace hardcoded Arrivals & Departures Today with real data**

Find the entire "Arrivals & Departures Today" card (the `.map((e, i) => ...)` over the hardcoded array) and replace it with:

```jsx
<div className="card" style={{ padding: 20 }}>
  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 14 }}>Arrivals & Departures Today</div>
  {repLoading ? (
    <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '12px 0' }}>Loading…</div>
  ) : (() => {
    const arrivals = (occReport?.arrivals_today ?? []).map(e => ({
      ...e, event: 'Arrival', color: e.status === 'checked_in' ? 'var(--green)' : 'var(--blue)',
    }));
    const departures = (occReport?.departures_today ?? []).map(e => ({
      ...e, event: 'Departure', color: 'var(--orange)',
    }));
    const combined = [...arrivals, ...departures];
    if (combined.length === 0) {
      return <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '8px 0' }}>No arrivals or departures today.</div>;
    }
    return combined.map((e, i) => (
      <div key={i} className="act-item">
        <div className="act-dot" style={{ background: e.color }} />
        <div style={{ flex: 1 }}>
          <div className="act-text">{e.event} — <b>{e.vessel}</b> ({e.berth})</div>
          <div className="act-time">{e.status}</div>
        </div>
        {e.status === 'confirmed' && e.event === 'Arrival' && <button className="btn btn-ghost btn-sm">Check In</button>}
        {e.status === 'checked_in' && e.event === 'Arrival' && <span className="badge badge-green">Done</span>}
      </div>
    ));
  })()}
</div>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/screens/Reports.jsx
git commit -m "feat(reports): wire Occupancy tab arrivals/departures and avg stay to real data"
```

---

## Task 6: Wire Berth Utilisation tab to real data

**Files:**
- Modify: `frontend/src/screens/Reports.jsx`

- [ ] **Step 1: Replace the BERTH_UTIL table with real data**

Find the Berth Utilisation tab section (`{tab === 'berths' && ...}`) and replace the entire `<table>` block:

Replace:
```jsx
<table className="tbl">
  <thead><tr><th>Berth</th><th>Current Vessel</th><th>Days Occupied</th><th>Utilisation</th><th>Revenue Apr</th></tr></thead>
  <tbody>
    {BERTH_UTIL.map(b => (
      <tr key={b.berth}>
        <td style={{ fontWeight: 700, color: 'var(--navy)' }}>{b.berth}</td>
        <td className="tbl-name">{b.vessel}</td>
        <td style={{ fontSize: 12 }}>{b.days} / 30 days</td>
        <td style={{ width: 180 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ flex: 1, background: 'var(--bg)', borderRadius: 99, height: 6 }}>
              <div style={{ width: b.util + '%', background: b.util >= 80 ? 'var(--green)' : b.util >= 50 ? 'var(--teal)' : 'var(--orange)', borderRadius: 99, height: 6 }} />
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, width: 36 }}>{b.util}%</span>
          </div>
        </td>
        <td style={{ fontWeight: 600 }}>{b.rev}</td>
      </tr>
    ))}
  </tbody>
</table>
```

With:
```jsx
{repLoading ? (
  <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: 20 }}>Loading…</div>
) : (
  <table className="tbl">
    <thead>
      <tr><th>Berth</th><th>Current Vessel</th><th>Days Occupied</th><th>Utilisation</th></tr>
    </thead>
    <tbody>
      {(utilReport?.berths ?? []).length === 0 ? (
        <tr><td colSpan={4} style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)', padding: '12px 0' }}>No utilisation data for this month.</td></tr>
      ) : (utilReport?.berths ?? []).map(b => (
        <tr key={b.berth}>
          <td style={{ fontWeight: 700, color: 'var(--navy)' }}>{b.berth}</td>
          <td className="tbl-name">{b.vessel ?? '—'}</td>
          <td style={{ fontSize: 12 }}>{b.days_occupied} days</td>
          <td style={{ width: 180 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: 1, background: 'var(--bg)', borderRadius: 99, height: 6 }}>
                <div style={{ width: b.util_pct + '%', background: b.util_pct >= 80 ? 'var(--green)' : b.util_pct >= 50 ? 'var(--teal)' : 'var(--orange)', borderRadius: 99, height: 6 }} />
              </div>
              <span style={{ fontSize: 12, fontWeight: 600, width: 36 }}>{b.util_pct}%</span>
            </div>
          </td>
        </tr>
      ))}
    </tbody>
  </table>
)}
```

Also update the section header title to reflect real month:
```jsx
<div className="sec-hdr-title">Berth Utilisation — {new Date().toLocaleString('default', { month: 'long', year: 'numeric' })}</div>
```

- [ ] **Step 2: Run the full backend test suite to confirm nothing is broken**

```
cd backend
python manage.py test apps.reports -v 2
```

Expected: all tests PASS.

- [ ] **Step 3: Final commit**

```bash
git add frontend/src/screens/Reports.jsx
git commit -m "feat(reports): wire Berth Utilisation tab to real data, drop revenue column"
```
