# Public Portal Phase 3 — Auto-Tetris Booking Funnel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the React booking funnel (Search → Quote → Stripe redirect) that a boater uses in auto_tetris mode, plus the three public backend endpoints that drive it.

**Architecture:** Multi-screen wizard driven by local state in `BookingWizard.jsx`. Three new public DRF views (`AllowAny`, `request.tenant`) added to `apps/portal/public_booking_views.py`. One new engine function `find_date_alternatives` in `booking_engine.py` powers the fallback alternatives screen.

**Tech Stack:** Django/DRF (backend), React 19 + Vite (frontend), Axios (`portal/src/api.js`), Vitest + React Testing Library (frontend tests).

---

## Codebase Context

- Public views live in `backend/apps/portal/public_booking_views.py` and use `request.tenant` (set by middleware from `X-Marina-Slug` header) instead of `request.user.marina`. They use `authentication_classes = []` and `permission_classes = [AllowAny]`.
- Public routes are registered in `backend/apps/portal/public_urls.py` and mounted at `/api/v1/public/` in `backend/config/urls.py`.
- The portal `api.js` instance already sends `X-Marina-Slug` on every request — no changes needed.
- `BerthSerializer` returns `pricing_tier_unit_price` as a decimal field (see `apps/berths/serializers.py`).
- `Marina.payment_terms` is an `IntegerField(default=7)` — days until payment due.
- `Marina.booking_mode` is `'manual_approval'` or `'auto_tetris'`.

---

## Files

| File | Action |
|---|---|
| `backend/apps/reservations/booking_engine.py` | Add `find_date_alternatives` |
| `backend/apps/reservations/tests.py` | Add `FindDateAlternativesTest` |
| `backend/apps/portal/public_booking_views.py` | Add 3 public views |
| `backend/apps/portal/public_urls.py` | Register 3 new routes |
| `backend/apps/portal/tests/test_public_booking.py` | Add 3 new test classes |
| `portal/package.json` | Add Vitest + RTL dev deps |
| `portal/vite.config.js` | Add test config block |
| `portal/src/test-setup.js` | New — jest-dom matchers |
| `portal/src/screens/BookingWizard.jsx` | New — wizard state container |
| `portal/src/screens/SearchScreen.jsx` | New |
| `portal/src/screens/SearchScreen.test.jsx` | New |
| `portal/src/screens/AlternativesScreen.jsx` | New |
| `portal/src/screens/AlternativesScreen.test.jsx` | New |
| `portal/src/screens/QuoteScreen.jsx` | New |
| `portal/src/screens/QuoteScreen.test.jsx` | New |
| `portal/src/App.jsx` | Replace auto_tetris placeholder with `<BookingWizard />` |

---

## Task 1: `find_date_alternatives` engine function

**Files:**
- Modify: `backend/apps/reservations/booking_engine.py`
- Test: `backend/apps/reservations/tests.py`

- [ ] **Step 1: Write the failing tests**

Open `backend/apps/reservations/tests.py`. Add at the end of the file, after the last test class. First add a new import at the top of the file alongside the existing engine imports (line ~137):

```python
from .booking_engine import compatible_available_berths, run_tetris, create_manual_approval, find_date_alternatives
```

Then add this test class at the end of the file:

```python
class FindDateAlternativesTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.marina.booking_mode = 'auto_tetris'
        self.marina.save()
        # One berth available for all dates
        self.berth = make_berth_with_dims(self.marina, 'ALT1', loa=20.0, beam=6.0, price=90)
        self.check_in = datetime.date.today() + datetime.timedelta(days=60)
        self.check_out = self.check_in + datetime.timedelta(days=3)

    def _block(self, check_in, check_out):
        """Book the berth for a date range, making it unavailable."""
        Booking.objects.create(
            marina=self.marina,
            berth=self.berth,
            check_in=check_in,
            check_out=check_out,
            nights=(check_out - check_in).days,
            amount=Decimal('270'),
            status='confirmed',
            booking_type='transient',
        )

    def test_shift_window_finds_alternative(self):
        self._block(self.check_in, self.check_out)
        results = find_date_alternatives(
            self.marina, self.check_in, self.check_out,
            boat_loa=None, boat_beam=None, boat_draft=None,
        )
        result_pairs = [(r['check_in'], r['check_out']) for r in results]
        shifted = (self.check_in + datetime.timedelta(days=1), self.check_out + datetime.timedelta(days=1))
        self.assertIn(shifted, result_pairs)

    def test_duration_variant_finds_alternative(self):
        self._block(self.check_in, self.check_out)
        results = find_date_alternatives(
            self.marina, self.check_in, self.check_out,
            boat_loa=None, boat_beam=None, boat_draft=None,
        )
        result_pairs = [(r['check_in'], r['check_out']) for r in results]
        extended = (self.check_in, self.check_out + datetime.timedelta(days=1))
        self.assertIn(extended, result_pairs)

    def test_returns_empty_when_truly_no_availability(self):
        # Block every date variant by blocking a long window
        big_block_in = self.check_in - datetime.timedelta(days=5)
        big_block_out = self.check_out + datetime.timedelta(days=5)
        self._block(big_block_in, big_block_out)
        results = find_date_alternatives(
            self.marina, self.check_in, self.check_out,
            boat_loa=None, boat_beam=None, boat_draft=None,
        )
        self.assertEqual(results, [])

    def test_capped_at_max_results(self):
        # Don't block anything — all 8 permutations will have availability
        results = find_date_alternatives(
            self.marina, self.check_in, self.check_out,
            boat_loa=None, boat_beam=None, boat_draft=None,
            max_results=4,
        )
        self.assertLessEqual(len(results), 4)

    def test_sorted_by_proximity(self):
        self._block(self.check_in, self.check_out)
        results = find_date_alternatives(
            self.marina, self.check_in, self.check_out,
            boat_loa=None, boat_beam=None, boat_draft=None,
        )
        # First result should be ±1 day shift or ±1 night — not ±2
        if len(results) >= 2:
            first_distance = abs((results[0]['check_in'] - self.check_in).days) + abs(results[0]['nights'] - 3)
            second_distance = abs((results[1]['check_in'] - self.check_in).days) + abs(results[1]['nights'] - 3)
            self.assertLessEqual(first_distance, second_distance)

    def test_past_dates_excluded(self):
        # Use near-future dates so ±2 day shift would go into the past
        near_future_in = datetime.date.today() + datetime.timedelta(days=1)
        near_future_out = near_future_in + datetime.timedelta(days=3)
        self._block(near_future_in, near_future_out)
        results = find_date_alternatives(
            self.marina, near_future_in, near_future_out,
            boat_loa=None, boat_beam=None, boat_draft=None,
        )
        for r in results:
            self.assertGreaterEqual(r['check_in'], datetime.date.today())
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
python manage.py test apps.reservations.tests.FindDateAlternativesTest --verbosity=2
```

Expected: `ImportError: cannot import name 'find_date_alternatives'`

- [ ] **Step 3: Implement `find_date_alternatives` in `booking_engine.py`**

Add to `backend/apps/reservations/booking_engine.py`. Add the import at the top (after the existing `from datetime import date, timedelta` line):

```python
from django.utils import timezone
```

Then add this function at the end of the file:

```python
ALTERNATIVE_SHIFTS = [-2, -1, 1, 2]     # days to shift check_in, same duration
ALTERNATIVE_DURATIONS = [-1, 1, -2, 2]  # nights delta, same check_in


def find_date_alternatives(marina, check_in, check_out, boat_loa, boat_beam, boat_draft, max_results=4):
    """
    When the exact dates are unavailable, find nearby date windows that do have
    compatible berths. Checks shifted windows (same duration, different start)
    and duration variants (same check_in, ±1 or ±2 nights).
    Returns up to max_results dicts sorted by proximity to the original dates.
    Uses timezone.localdate() for the past-date guard so it respects the server
    timezone rather than Python's date.today().
    """
    original_nights = (check_out - check_in).days
    today = timezone.localdate()
    candidates = []

    for delta in ALTERNATIVE_SHIFTS:
        new_in = check_in + timedelta(days=delta)
        new_out = new_in + timedelta(days=original_nights)
        if new_in < today:
            continue
        scored = _score_berths(
            compatible_available_berths(marina, new_in, new_out, boat_loa, boat_beam, boat_draft),
            new_in, new_out,
        )
        if scored:
            berth = scored[0][1]
            candidates.append({
                'check_in': new_in,
                'check_out': new_out,
                'nights': original_nights,
                'price_per_night': berth.pricing_tier.unit_price,
                'total': berth.pricing_tier.unit_price * original_nights,
            })

    for delta in ALTERNATIVE_DURATIONS:
        new_nights = original_nights + delta
        if new_nights < 1:
            continue
        new_out = check_in + timedelta(days=new_nights)
        scored = _score_berths(
            compatible_available_berths(marina, check_in, new_out, boat_loa, boat_beam, boat_draft),
            check_in, new_out,
        )
        if scored:
            berth = scored[0][1]
            candidates.append({
                'check_in': check_in,
                'check_out': new_out,
                'nights': new_nights,
                'price_per_night': berth.pricing_tier.unit_price,
                'total': berth.pricing_tier.unit_price * new_nights,
            })

    candidates.sort(
        key=lambda c: abs((c['check_in'] - check_in).days) + abs(c['nights'] - original_nights)
    )
    return candidates[:max_results]
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend
python manage.py test apps.reservations.tests.FindDateAlternativesTest --verbosity=2
```

Expected: 6 tests pass.

- [ ] **Step 5: Run the full reservations test suite to check for regressions**

```bash
cd backend
python manage.py test apps.reservations --verbosity=2
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/reservations/booking_engine.py backend/apps/reservations/tests.py
git commit -m "feat: add find_date_alternatives engine function"
```

---

## Task 2: Public available-berths and availability-alternatives endpoints

**Files:**
- Modify: `backend/apps/portal/public_booking_views.py`
- Modify: `backend/apps/portal/public_urls.py`
- Modify: `backend/apps/portal/tests/test_public_booking.py`

- [ ] **Step 1: Write the failing tests**

Open `backend/apps/portal/tests/test_public_booking.py`. Add at the end of the file:

```python
import datetime
from apps.berths.models import Pier, Berth
from apps.billing.models import ChargeableItem
from apps.reservations.models import Booking


def make_auto_marina():
    return Marina.objects.create(
        name='Auto Marina', slug='auto-marina', booking_mode='auto_tetris',
    )


def make_test_berth(marina, code='B1', loa=20.0, beam=6.0, price=90):
    pier, _ = Pier.objects.get_or_create(marina=marina, code='P', defaults={'label': 'Pier'})
    tier, _ = ChargeableItem.objects.get_or_create(
        marina=marina, name='Berth Night', category='berth',
        defaults={'pricing_model': 'per_night', 'unit_price': price, 'is_mandatory_transient_fee': False},
    )
    return Berth.objects.create(
        marina=marina, pier=pier, code=code,
        length_m=loa, max_beam_m=beam,
        pricing_tier=tier, status='available',
    )


class PublicAvailableBerthsTest(TestCase):
    def setUp(self):
        self.marina = make_auto_marina()
        self.berth = make_test_berth(self.marina)
        self.client = APIClient()
        self.today = datetime.date.today()
        self.check_in = str(self.today + datetime.timedelta(days=30))
        self.check_out = str(self.today + datetime.timedelta(days=33))

    def _get(self, slug='auto-marina', **params):
        qs = '&'.join(f'{k}={v}' for k, v in params.items())
        return self.client.get(
            f'/api/v1/public/bookings/available-berths/?{qs}',
            HTTP_X_MARINA_SLUG=slug,
        )

    def test_returns_berths_when_available(self):
        resp = self._get(check_in=self.check_in, check_out=self.check_out)
        self.assertEqual(resp.status_code, 200)
        self.assertGreater(len(resp.data), 0)
        self.assertIn('pricing_tier_unit_price', resp.data[0])

    def test_returns_empty_when_blocked(self):
        Booking.objects.create(
            marina=self.marina, berth=self.berth,
            check_in=self.today + datetime.timedelta(days=30),
            check_out=self.today + datetime.timedelta(days=33),
            nights=3, amount='270', status='confirmed', booking_type='transient',
        )
        resp = self._get(check_in=self.check_in, check_out=self.check_out)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, [])

    def test_missing_dates_returns_400(self):
        resp = self._get()
        self.assertEqual(resp.status_code, 400)

    def test_unknown_marina_returns_404(self):
        resp = self._get(slug='no-such-marina', check_in=self.check_in, check_out=self.check_out)
        self.assertEqual(resp.status_code, 404)

    def test_boat_draft_filter(self):
        self.berth.max_draft_m = '1.0'
        self.berth.save()
        resp = self._get(check_in=self.check_in, check_out=self.check_out, boat_draft='2.0')
        self.assertEqual(resp.status_code, 200)
        ids = [b['id'] for b in resp.data]
        self.assertNotIn(self.berth.id, ids)


class PublicAvailabilityAlternativesTest(TestCase):
    def setUp(self):
        self.marina = make_auto_marina()
        self.berth = make_test_berth(self.marina)
        self.client = APIClient()
        self.today = datetime.date.today()
        self.check_in = str(self.today + datetime.timedelta(days=60))
        self.check_out = str(self.today + datetime.timedelta(days=63))

    def _get(self, slug='auto-marina', **params):
        qs = '&'.join(f'{k}={v}' for k, v in params.items())
        return self.client.get(
            f'/api/v1/public/bookings/availability-alternatives/?{qs}',
            HTTP_X_MARINA_SLUG=slug,
        )

    def _block(self, check_in_offset, check_out_offset):
        ci = self.today + datetime.timedelta(days=check_in_offset)
        co = self.today + datetime.timedelta(days=check_out_offset)
        Booking.objects.create(
            marina=self.marina, berth=self.berth,
            check_in=ci, check_out=co,
            nights=(co - ci).days, amount='270',
            status='confirmed', booking_type='transient',
        )

    def test_returns_alternatives_when_primary_blocked(self):
        self._block(60, 63)
        resp = self._get(check_in=self.check_in, check_out=self.check_out)
        self.assertEqual(resp.status_code, 200)
        self.assertGreater(len(resp.data), 0)
        alt = resp.data[0]
        self.assertIn('check_in', alt)
        self.assertIn('check_out', alt)
        self.assertIn('nights', alt)
        self.assertIn('price_per_night', alt)
        self.assertIn('total', alt)

    def test_returns_empty_when_no_alternatives(self):
        self._block(55, 70)  # block a wide window covering all permutations
        resp = self._get(check_in=self.check_in, check_out=self.check_out)
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, [])

    def test_missing_dates_returns_400(self):
        resp = self._get()
        self.assertEqual(resp.status_code, 400)

    def test_unknown_marina_returns_404(self):
        resp = self._get(slug='no-such-marina', check_in=self.check_in, check_out=self.check_out)
        self.assertEqual(resp.status_code, 404)

    def test_boat_draft_respected(self):
        self.berth.max_draft_m = '1.0'
        self.berth.save()
        self._block(60, 63)
        resp = self._get(check_in=self.check_in, check_out=self.check_out, boat_draft='2.0')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, [])
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
python manage.py test apps.portal.tests.test_public_booking.PublicAvailableBerthsTest apps.portal.tests.test_public_booking.PublicAvailabilityAlternativesTest --verbosity=2
```

Expected: 404 errors — routes don't exist yet.

- [ ] **Step 3: Add the two views to `public_booking_views.py`**

Open `backend/apps/portal/public_booking_views.py`. Add these imports at the top:

```python
from apps.berths.serializers import BerthSerializer
from apps.reservations.booking_engine import (
    compatible_available_berths,
    find_date_alternatives,
    NoAvailableBerthError,
)
```

Add the two new view classes at the end of the file:

```python
class PublicAvailableBerthsView(APIView):
    """GET /api/v1/public/bookings/available-berths/"""
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        if request.tenant is None:
            return Response({'detail': 'Marina not found.'}, status=status.HTTP_404_NOT_FOUND)

        check_in = request.query_params.get('check_in')
        check_out = request.query_params.get('check_out')
        if not check_in or not check_out:
            return Response({'detail': 'check_in and check_out are required.'}, status=status.HTTP_400_BAD_REQUEST)

        boat_loa = request.query_params.get('boat_loa') or None
        boat_beam = request.query_params.get('boat_beam') or None
        boat_draft = request.query_params.get('boat_draft') or None

        try:
            berths = compatible_available_berths(
                marina=request.tenant,
                check_in=check_in,
                check_out=check_out,
                boat_loa=boat_loa,
                boat_beam=boat_beam,
                boat_draft=boat_draft,
            )
        except ValueError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(BerthSerializer(berths, many=True).data)


class PublicAvailabilityAlternativesView(APIView):
    """GET /api/v1/public/bookings/availability-alternatives/"""
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        if request.tenant is None:
            return Response({'detail': 'Marina not found.'}, status=status.HTTP_404_NOT_FOUND)

        check_in = request.query_params.get('check_in')
        check_out = request.query_params.get('check_out')
        if not check_in or not check_out:
            return Response({'detail': 'check_in and check_out are required.'}, status=status.HTTP_400_BAD_REQUEST)

        boat_loa = request.query_params.get('boat_loa') or None
        boat_beam = request.query_params.get('boat_beam') or None
        boat_draft = request.query_params.get('boat_draft') or None

        try:
            from datetime import date
            ci = date.fromisoformat(check_in)
            co = date.fromisoformat(check_out)
        except ValueError:
            return Response({'detail': 'Invalid date format. Use YYYY-MM-DD.'}, status=status.HTTP_400_BAD_REQUEST)

        alternatives = find_date_alternatives(
            marina=request.tenant,
            check_in=ci,
            check_out=co,
            boat_loa=boat_loa,
            boat_beam=boat_beam,
            boat_draft=boat_draft,
        )

        result = [
            {
                'check_in': str(a['check_in']),
                'check_out': str(a['check_out']),
                'nights': a['nights'],
                'price_per_night': str(a['price_per_night']),
                'total': str(a['total']),
            }
            for a in alternatives
        ]
        return Response(result)
```

- [ ] **Step 4: Register the routes in `public_urls.py`**

Replace the full contents of `backend/apps/portal/public_urls.py` with:

```python
from django.urls import path
from apps.portal.views import MarinaPublicView
from apps.portal.public_booking_views import (
    PublicBookingCreateView,
    PublicAvailableBerthsView,
    PublicAvailabilityAlternativesView,
)

urlpatterns = [
    path('marina/',                             MarinaPublicView.as_view(),                    name='public-marina'),
    path('bookings/',                           PublicBookingCreateView.as_view(),             name='public-booking-create'),
    path('bookings/available-berths/',          PublicAvailableBerthsView.as_view(),           name='public-available-berths'),
    path('bookings/availability-alternatives/', PublicAvailabilityAlternativesView.as_view(),  name='public-availability-alternatives'),
]
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend
python manage.py test apps.portal.tests.test_public_booking.PublicAvailableBerthsTest apps.portal.tests.test_public_booking.PublicAvailabilityAlternativesTest --verbosity=2
```

Expected: 9 tests pass.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/portal/public_booking_views.py backend/apps/portal/public_urls.py backend/apps/portal/tests/test_public_booking.py
git commit -m "feat: add public available-berths and availability-alternatives endpoints"
```

---

## Task 3: Public engine-request endpoint

**Files:**
- Modify: `backend/apps/portal/public_booking_views.py`
- Modify: `backend/apps/portal/public_urls.py`
- Modify: `backend/apps/portal/tests/test_public_booking.py`

- [ ] **Step 1: Write the failing tests**

Open `backend/apps/portal/tests/test_public_booking.py`. Add to the existing imports at the top:

```python
from unittest.mock import patch
from apps.billing.models import Invoice
```

Add at the end of the file:

```python
class PublicEngineRequestTest(TestCase):
    def setUp(self):
        self.marina = make_auto_marina()
        self.berth = make_test_berth(self.marina)
        self.client = APIClient()
        self.today = datetime.date.today()
        self.payload = {
            'check_in': str(self.today + datetime.timedelta(days=30)),
            'check_out': str(self.today + datetime.timedelta(days=33)),
            'guest_name': 'J. Sailor',
            'guest_email': 'sailor@sea.com',
            'guest_phone': '+353871234567',
            'boat_loa': 12.5,
            'boat_beam': 4.2,
        }

    def _post(self, payload=None, slug='auto-marina'):
        return self.client.post(
            '/api/v1/public/bookings/engine-request/',
            payload or self.payload,
            format='json',
            HTTP_X_MARINA_SLUG=slug,
        )

    @patch('apps.portal.public_booking_views.billing_service.create_stripe_checkout_session', return_value='https://stripe.test/pay')
    def test_creates_booking_and_returns_checkout_url(self, _mock):
        resp = self._post()
        self.assertEqual(resp.status_code, 201)
        self.assertIn('checkout_url', resp.data)
        self.assertIn('booking', resp.data)
        self.assertEqual(resp.data['checkout_url'], 'https://stripe.test/pay')

    @patch('apps.portal.public_booking_views.billing_service.create_stripe_checkout_session', return_value='https://stripe.test/pay')
    def test_invoice_booking_fk_is_set(self, _mock):
        resp = self._post()
        self.assertEqual(resp.status_code, 201)
        booking_id = resp.data['booking']['id']
        inv = Invoice.objects.get(source_type='berth_booking', source_id=str(booking_id))
        self.assertEqual(inv.booking_id, booking_id)

    def test_no_availability_returns_409(self):
        from apps.reservations.models import Booking as BookingModel
        BookingModel.objects.create(
            marina=self.marina, berth=self.berth,
            check_in=self.today + datetime.timedelta(days=30),
            check_out=self.today + datetime.timedelta(days=33),
            nights=3, amount='270', status='confirmed', booking_type='transient',
        )
        resp = self._post()
        self.assertEqual(resp.status_code, 409)

    def test_unknown_marina_returns_404(self):
        resp = self._post(slug='no-such-marina')
        self.assertEqual(resp.status_code, 404)

    def test_missing_field_returns_400(self):
        payload = {**self.payload}
        del payload['guest_email']
        resp = self._post(payload)
        self.assertEqual(resp.status_code, 400)

    def test_non_auto_tetris_marina_returns_400(self):
        manual_marina = Marina.objects.create(name='Manual', slug='manual-m', booking_mode='manual_approval')
        make_test_berth(manual_marina, code='M1')
        resp = self._post(slug='manual-m')
        self.assertEqual(resp.status_code, 400)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
python manage.py test apps.portal.tests.test_public_booking.PublicEngineRequestTest --verbosity=2
```

Expected: 404 errors — route doesn't exist yet.

- [ ] **Step 3: Add the serializer and view to `public_booking_views.py`**

Open `backend/apps/portal/public_booking_views.py`. Add these imports at the top alongside the existing ones:

```python
import datetime
from django.db import transaction
from apps.billing import service as billing_service
from apps.billing.models import Invoice as InvoiceModel
from apps.reservations.booking_engine import run_tetris
from apps.reservations.serializers import BookingSerializer
```

Add at the end of the file:

```python
class PublicEngineRequestSerializer(serializers.Serializer):
    check_in    = serializers.DateField()
    check_out   = serializers.DateField()
    guest_name  = serializers.CharField(max_length=200)
    guest_email = serializers.EmailField()
    guest_phone = serializers.CharField(max_length=30, required=False, allow_blank=True)
    boat_loa    = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, allow_null=True)
    boat_beam   = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    boat_draft  = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)

    def validate(self, data):
        if data['check_in'] >= data['check_out']:
            raise serializers.ValidationError({'check_out': 'check_out must be after check_in.'})
        if data['check_in'] < datetime.date.today():
            raise serializers.ValidationError({'check_in': 'check_in cannot be in the past.'})
        return data


class PublicEngineRequestView(APIView):
    """POST /api/v1/public/bookings/engine-request/"""
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        if request.tenant is None:
            return Response({'detail': 'Marina not found.'}, status=status.HTTP_404_NOT_FOUND)

        marina = request.tenant
        if marina.booking_mode != 'auto_tetris':
            return Response({'detail': 'This marina does not accept online bookings.'}, status=status.HTTP_400_BAD_REQUEST)

        ser = PublicEngineRequestSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        d = ser.validated_data
        try:
            with transaction.atomic():
                booking = run_tetris(
                    marina=marina,
                    check_in=d['check_in'],
                    check_out=d['check_out'],
                    boat_loa=d.get('boat_loa'),
                    boat_beam=d.get('boat_beam'),
                    boat_draft=d.get('boat_draft'),
                    guest_name=d['guest_name'],
                    guest_email=d['guest_email'],
                    guest_phone=d.get('guest_phone', ''),
                )
                nights_label = f'{booking.nights} night{"s" if booking.nights != 1 else ""}'
                due_date = datetime.date.today() + datetime.timedelta(days=marina.payment_terms)
                inv = billing_service.create_invoice(
                    marina,
                    member=None,
                    source_type='berth_booking',
                    source_id=str(booking.id),
                    due_date=due_date,
                )
                if not booking.amount:
                    raise ValueError('Berth has no price set — cannot create invoice.')
                billing_service.add_line_item(
                    inv,
                    description=f'Berth — {nights_label} @ {booking.berth.pricing_tier.unit_price}/night',
                    quantity=1,
                    unit_price=booking.amount,
                )
                billing_service.finalize_invoice(inv)
                inv.booking = booking
                inv.save(update_fields=['booking'])
                checkout_url = billing_service.create_stripe_checkout_session(inv)
        except NoAvailableBerthError as e:
            return Response({'detail': str(e)}, status=status.HTTP_409_CONFLICT)
        except ValueError as e:
            return Response({'detail': str(e)}, status=status.HTTP_400_BAD_REQUEST)
        except Exception:
            return Response(
                {'detail': 'Payment provider error. Please try again.'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response(
            {'booking': BookingSerializer(booking).data, 'checkout_url': checkout_url},
            status=status.HTTP_201_CREATED,
        )
```

- [ ] **Step 4: Register the route in `public_urls.py`**

Replace the full contents of `backend/apps/portal/public_urls.py` with:

```python
from django.urls import path
from apps.portal.views import MarinaPublicView
from apps.portal.public_booking_views import (
    PublicBookingCreateView,
    PublicAvailableBerthsView,
    PublicAvailabilityAlternativesView,
    PublicEngineRequestView,
)

urlpatterns = [
    path('marina/',                             MarinaPublicView.as_view(),                    name='public-marina'),
    path('bookings/',                           PublicBookingCreateView.as_view(),             name='public-booking-create'),
    path('bookings/available-berths/',          PublicAvailableBerthsView.as_view(),           name='public-available-berths'),
    path('bookings/availability-alternatives/', PublicAvailabilityAlternativesView.as_view(),  name='public-availability-alternatives'),
    path('bookings/engine-request/',            PublicEngineRequestView.as_view(),             name='public-engine-request'),
]
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend
python manage.py test apps.portal.tests.test_public_booking.PublicEngineRequestTest --verbosity=2
```

Expected: 6 tests pass.

- [ ] **Step 6: Run the full portal test suite**

```bash
cd backend
python manage.py test apps.portal --verbosity=2
```

Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add backend/apps/portal/public_booking_views.py backend/apps/portal/public_urls.py backend/apps/portal/tests/test_public_booking.py
git commit -m "feat: add public engine-request endpoint"
```

---

## Task 4: Frontend test setup (Vitest + React Testing Library)

**Files:**
- Modify: `portal/package.json`
- Modify: `portal/vite.config.js`
- Create: `portal/src/test-setup.js`

- [ ] **Step 1: Install test dependencies**

```bash
cd portal
npm install --save-dev vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 2: Add test script to `package.json`**

Open `portal/package.json`. Add `"test": "vitest run"` and `"test:watch": "vitest"` to the `scripts` block:

```json
{
  "name": "portal",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "axios": "^1.15.2",
    "react": "^19.2.5",
    "react-dom": "^19.2.5",
    "react-router-dom": "^7.14.2"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.0",
    "@testing-library/user-event": "^14.6.1",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "@vitejs/plugin-react": "^6.0.1",
    "@vitest/coverage-v8": "^3.2.4",
    "globals": "^17.5.0",
    "jsdom": "^26.1.0",
    "vite": "^8.0.10",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 3: Create the jest-dom setup file**

Create `portal/src/test-setup.js`:

```js
import '@testing-library/jest-dom';
```

- [ ] **Step 4: Add test configuration to `vite.config.js`**

Replace the full contents of `portal/vite.config.js` with:

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5176,
    allowedHosts: ['.lvh.me', 'localhost', 'booking.docksbase.com'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.js'],
    globals: true,
  },
});
```

- [ ] **Step 5: Verify test setup works**

Create a temporary smoke-test file to confirm the setup runs:

Create `portal/src/test-setup.test.js`:
```js
import { describe, it, expect } from 'vitest';
describe('test setup', () => {
  it('runs', () => expect(1 + 1).toBe(2));
});
```

```bash
cd portal
npm test
```

Expected: 1 test passes. Delete `portal/src/test-setup.test.js` after confirming.

- [ ] **Step 6: Commit**

```bash
git add portal/package.json portal/vite.config.js portal/src/test-setup.js portal/package-lock.json
git commit -m "chore: add Vitest + React Testing Library test setup to portal"
```

---

## Task 5: `BookingWizard` + `SearchScreen`

**Files:**
- Create: `portal/src/screens/BookingWizard.jsx`
- Create: `portal/src/screens/SearchScreen.jsx`
- Create: `portal/src/screens/SearchScreen.test.jsx`

The `api` module makes requests using Axios and automatically sets `X-Marina-Slug`. In tests, mock it with `vi.mock('../api')`.

- [ ] **Step 1: Write the failing `SearchScreen` tests**

Create `portal/src/screens/SearchScreen.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SearchScreen from './SearchScreen';
import api from '../api';

vi.mock('../api');

const marina = { name: 'Test Marina' };
const navigate = vi.fn();

const defaultState = {
  checkIn: '', checkOut: '', boatLoa: '', boatBeam: '', boatDraft: '',
  errorBanner: '',
};

function fillDates() {
  fireEvent.change(screen.getByLabelText(/check.in/i), { target: { value: '2027-07-10' } });
  fireEvent.change(screen.getByLabelText(/check.out/i), { target: { value: '2027-07-13' } });
}

beforeEach(() => {
  navigate.mockClear();
  vi.clearAllMocks();
});

describe('SearchScreen', () => {
  it('calls available-berths with correct params on submit', async () => {
    api.get = vi.fn().mockResolvedValue({ data: [{ id: 1, pricing_tier_unit_price: '90.00' }] });
    render(<SearchScreen state={defaultState} navigate={navigate} marina={marina} />);
    fillDates();
    fireEvent.change(screen.getByLabelText(/loa/i), { target: { value: '12.5' } });
    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/public/bookings/available-berths/'));
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('check_in=2027-07-10'));
    });
  });

  it('navigates to quote when berths are available', async () => {
    api.get = vi.fn().mockResolvedValue({ data: [{ id: 1, pricing_tier_unit_price: '90.00' }] });
    render(<SearchScreen state={defaultState} navigate={navigate} marina={marina} />);
    fillDates();
    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('quote', expect.objectContaining({ quotedTotal: 270 }));
    });
  });

  it('calls alternatives endpoint when no berths available', async () => {
    api.get = vi.fn()
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [{ check_in: '2027-07-11', check_out: '2027-07-14', nights: 3, price_per_night: '90.00', total: '270.00' }] });
    render(<SearchScreen state={defaultState} navigate={navigate} marina={marina} />);
    fillDates();
    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(expect.stringContaining('/public/bookings/availability-alternatives/'));
    });
  });

  it('navigates to alternatives when alternatives exist', async () => {
    const alts = [{ check_in: '2027-07-11', check_out: '2027-07-14', nights: 3, price_per_night: '90.00', total: '270.00' }];
    api.get = vi.fn()
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: alts });
    render(<SearchScreen state={defaultState} navigate={navigate} marina={marina} />);
    fillDates();
    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('alternatives', expect.objectContaining({ alternatives: alts }));
    });
  });

  it('shows dead-end message when no alternatives available', async () => {
    api.get = vi.fn().mockResolvedValue({ data: [] });
    render(<SearchScreen state={defaultState} navigate={navigate} marina={marina} />);
    fillDates();
    fireEvent.click(screen.getByRole('button', { name: /check availability/i }));
    await waitFor(() => {
      expect(screen.getByText(/no availability/i)).toBeInTheDocument();
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows error banner when passed in state', () => {
    render(<SearchScreen state={{ ...defaultState, errorBanner: 'Availability changed while you were reviewing. Please check your dates again.' }} navigate={navigate} marina={marina} />);
    expect(screen.getByText(/availability changed/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd portal
npm test
```

Expected: import errors — `SearchScreen` does not exist yet.

- [ ] **Step 3: Create `BookingWizard.jsx`**

Create `portal/src/screens/BookingWizard.jsx`:

```jsx
import { useState } from 'react';
import SearchScreen from './SearchScreen';
import AlternativesScreen from './AlternativesScreen';
import QuoteScreen from './QuoteScreen';

const INITIAL_STATE = {
  checkIn: '', checkOut: '', boatLoa: '', boatBeam: '', boatDraft: '',
  quotedPrice: null, quotedTotal: null,
  guestName: '', guestEmail: '', guestPhone: '',
  alternatives: [],
  errorBanner: '',
};

export default function BookingWizard({ marina }) {
  const [screen, setScreen] = useState('search');
  const [state, setState] = useState(INITIAL_STATE);

  const navigate = (nextScreen, updates = {}) => {
    setState(s => ({ ...s, ...updates, errorBanner: updates.errorBanner ?? '' }));
    setScreen(nextScreen);
  };

  if (screen === 'alternatives') return <AlternativesScreen state={state} navigate={navigate} />;
  if (screen === 'quote') return <QuoteScreen state={state} navigate={navigate} marina={marina} />;
  return <SearchScreen state={state} navigate={navigate} marina={marina} />;
}
```

- [ ] **Step 4: Create `SearchScreen.jsx`**

Create `portal/src/screens/SearchScreen.jsx`:

```jsx
import { useState } from 'react';
import api from '../api';

const card = { background: '#fff', borderRadius: 12, padding: 36, maxWidth: 480, width: '100%', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' };
const page = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8', padding: 24 };
const label = { display: 'block', fontWeight: 600, fontSize: 12, marginBottom: 5, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: '0.4px' };
const input = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', fontSize: 14, border: '1px solid rgba(0,0,0,0.2)', borderRadius: 6 };

export default function SearchScreen({ state, navigate, marina }) {
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    checkIn: state.checkIn || '',
    checkOut: state.checkOut || '',
    boatLoa: state.boatLoa || '',
    boatBeam: state.boatBeam || '',
    boatDraft: state.boatDraft || '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const nights =
    form.checkIn && form.checkOut
      ? Math.round((new Date(form.checkOut) - new Date(form.checkIn)) / 86400000)
      : 0;

  const handleSubmit = async e => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const params = new URLSearchParams({ check_in: form.checkIn, check_out: form.checkOut });
    if (form.boatLoa)  params.set('boat_loa', form.boatLoa);
    if (form.boatBeam) params.set('boat_beam', form.boatBeam);
    if (form.boatDraft) params.set('boat_draft', form.boatDraft);
    try {
      const { data: berths } = await api.get(`/public/bookings/available-berths/?${params}`);
      if (berths.length > 0) {
        const pricePerNight = parseFloat(berths[0].pricing_tier_unit_price);
        navigate('quote', { ...form, quotedPrice: pricePerNight, quotedTotal: pricePerNight * nights });
        return;
      }
      const { data: alternatives } = await api.get(`/public/bookings/availability-alternatives/?${params}`);
      if (alternatives.length > 0) {
        navigate('alternatives', { ...form, alternatives });
        return;
      }
      setError('No availability for those dates or nearby alternatives. Please contact the marina directly.');
    } catch (err) {
      setError(err.response?.data?.detail || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  const field = (labelText, key, type = 'text', extra = {}) => (
    <div style={{ marginBottom: 16 }}>
      <label htmlFor={key} style={label}>{labelText}</label>
      <input
        id={key}
        type={type}
        value={form[key]}
        min={type === 'date' ? today : undefined}
        onChange={e => set(key, e.target.value)}
        style={input}
        {...extra}
      />
    </div>
  );

  return (
    <div style={page}>
      <div style={card}>
        <h2 style={{ margin: '0 0 6px', fontSize: 22 }}>{marina?.name}</h2>
        <p style={{ color: 'rgba(0,0,0,0.5)', fontSize: 14, margin: '0 0 28px' }}>Find a berth</p>

        {state.errorBanner && (
          <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', marginBottom: 20, color: '#dc2626', fontSize: 14 }}>
            {state.errorBanner}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>{field('Check-in', 'checkIn', 'date')}</div>
            <div>{field('Check-out', 'checkOut', 'date', { min: form.checkIn || today })}</div>
          </div>
          <div style={{ fontWeight: 600, fontSize: 12, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 12 }}>
            Vessel dimensions
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>{field('LOA (m)', 'boatLoa', 'number', { step: '0.1', min: '0', placeholder: '12.5' })}</div>
            <div>{field('Beam (m)', 'boatBeam', 'number', { step: '0.1', min: '0', placeholder: '4.2' })}</div>
            <div>{field('Draft (m)', 'boatDraft', 'number', { step: '0.1', min: '0', placeholder: '1.8' })}</div>
          </div>

          {error && (
            <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{ width: '100%', padding: '12px 0', background: busy ? '#94a3b8' : '#1d4ed8', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: busy ? 'not-allowed' : 'pointer', marginTop: 8 }}
          >
            {busy ? 'Checking…' : 'Check Availability'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run tests — they will fail because AlternativesScreen and QuoteScreen don't exist yet**

Create stub files so imports resolve:

Create `portal/src/screens/AlternativesScreen.jsx`:
```jsx
export default function AlternativesScreen() { return null; }
```

Create `portal/src/screens/QuoteScreen.jsx`:
```jsx
export default function QuoteScreen() { return null; }
```

- [ ] **Step 6: Run tests to verify SearchScreen tests pass**

```bash
cd portal
npm test
```

Expected: 6 SearchScreen tests pass.

- [ ] **Step 7: Commit**

```bash
git add portal/src/screens/BookingWizard.jsx portal/src/screens/SearchScreen.jsx portal/src/screens/SearchScreen.test.jsx portal/src/screens/AlternativesScreen.jsx portal/src/screens/QuoteScreen.jsx
git commit -m "feat: add BookingWizard container and SearchScreen"
```

---

## Task 6: `AlternativesScreen`

**Files:**
- Modify: `portal/src/screens/AlternativesScreen.jsx` (replace stub)
- Create: `portal/src/screens/AlternativesScreen.test.jsx`

- [ ] **Step 1: Write the failing tests**

Create `portal/src/screens/AlternativesScreen.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AlternativesScreen from './AlternativesScreen';

const navigate = vi.fn();

const alternatives = [
  { check_in: '2027-07-11', check_out: '2027-07-14', nights: 3, price_per_night: '90.00', total: '270.00' },
  { check_in: '2027-07-10', check_out: '2027-07-14', nights: 4, price_per_night: '90.00', total: '360.00' },
];

const state = { alternatives };

describe('AlternativesScreen', () => {
  it('renders one card per alternative with correct price and dates', () => {
    render(<AlternativesScreen state={state} navigate={navigate} />);
    expect(screen.getByText(/Jul 11/i)).toBeInTheDocument();
    expect(screen.getByText(/€270/i)).toBeInTheDocument();
    expect(screen.getByText(/€360/i)).toBeInTheDocument();
  });

  it('clicking a card navigates to quote with correct wizard state', () => {
    render(<AlternativesScreen state={state} navigate={navigate} />);
    fireEvent.click(screen.getAllByRole('button')[0]);
    expect(navigate).toHaveBeenCalledWith('quote', expect.objectContaining({
      checkIn: '2027-07-11',
      checkOut: '2027-07-14',
      quotedPrice: 90,
      quotedTotal: 270,
    }));
  });

  it('back button navigates to search', () => {
    render(<AlternativesScreen state={state} navigate={navigate} />);
    fireEvent.click(screen.getByRole('button', { name: /try different dates/i }));
    expect(navigate).toHaveBeenCalledWith('search');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd portal
npm test -- AlternativesScreen.test
```

Expected: test failures — the stub renders `null`.

- [ ] **Step 3: Implement `AlternativesScreen.jsx`**

Replace the full contents of `portal/src/screens/AlternativesScreen.jsx` with:

```jsx
const page = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8', padding: 24 };
const card = { background: '#fff', borderRadius: 12, padding: 36, maxWidth: 480, width: '100%', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' };

function formatDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export default function AlternativesScreen({ state, navigate }) {
  return (
    <div style={page}>
      <div style={card}>
        <h2 style={{ margin: '0 0 6px', fontSize: 22 }}>Nearby Availability</h2>
        <p style={{ color: 'rgba(0,0,0,0.5)', fontSize: 14, margin: '0 0 24px' }}>
          Your exact dates aren&apos;t available — but we found these options:
        </p>

        {state.alternatives.map(alt => (
          <button
            key={`${alt.check_in}_${alt.check_out}`}
            onClick={() =>
              navigate('quote', {
                checkIn: alt.check_in,
                checkOut: alt.check_out,
                quotedPrice: parseFloat(alt.price_per_night),
                quotedTotal: parseFloat(alt.total),
              })
            }
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              width: '100%', padding: '14px 16px', marginBottom: 10,
              background: '#f8fafc', border: '1px solid rgba(0,0,0,0.12)',
              borderRadius: 8, cursor: 'pointer', fontSize: 15, textAlign: 'left',
            }}
          >
            <span>
              {formatDate(alt.check_in)} – {formatDate(alt.check_out)}
              <span style={{ color: 'rgba(0,0,0,0.45)', fontSize: 13, marginLeft: 8 }}>
                {alt.nights} night{alt.nights !== 1 ? 's' : ''}
              </span>
            </span>
            <span style={{ fontWeight: 700, color: '#1d4ed8' }}>€{alt.total}</span>
          </button>
        ))}

        <button
          onClick={() => navigate('search')}
          style={{ marginTop: 12, background: 'none', border: 'none', color: 'rgba(0,0,0,0.5)', cursor: 'pointer', fontSize: 14 }}
        >
          ← Try different dates
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd portal
npm test
```

Expected: all tests pass (SearchScreen + AlternativesScreen).

- [ ] **Step 5: Commit**

```bash
git add portal/src/screens/AlternativesScreen.jsx portal/src/screens/AlternativesScreen.test.jsx
git commit -m "feat: add AlternativesScreen"
```

---

## Task 7: `QuoteScreen`

**Files:**
- Modify: `portal/src/screens/QuoteScreen.jsx` (replace stub)
- Create: `portal/src/screens/QuoteScreen.test.jsx`

- [ ] **Step 1: Write the failing tests**

Create `portal/src/screens/QuoteScreen.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import QuoteScreen from './QuoteScreen';
import api from '../api';

vi.mock('../api');

const navigate = vi.fn();
const marina = { name: 'Test Marina' };

const state = {
  checkIn: '2027-07-10',
  checkOut: '2027-07-13',
  boatLoa: '12.5',
  boatBeam: '4.2',
  boatDraft: '',
  quotedPrice: 90,
  quotedTotal: 270,
  guestName: '',
  guestEmail: '',
  guestPhone: '',
};

function fillContact() {
  fireEvent.change(screen.getByLabelText(/name/i), { target: { value: 'J. Sailor' } });
  fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'sailor@sea.com' } });
  fireEvent.change(screen.getByLabelText(/phone/i), { target: { value: '+353871234567' } });
}

beforeEach(() => {
  navigate.mockClear();
  vi.clearAllMocks();
  delete window.location;
  window.location = { href: '' };
});

describe('QuoteScreen', () => {
  it('displays dates, nights, and total price from wizard state', () => {
    render(<QuoteScreen state={state} navigate={navigate} marina={marina} />);
    expect(screen.getByText(/3 nights/i)).toBeInTheDocument();
    expect(screen.getByText(/€270/i)).toBeInTheDocument();
    expect(screen.getByText(/Jul 10/i)).toBeInTheDocument();
  });

  it('submitting contact form calls engine-request with all fields', async () => {
    api.post = vi.fn().mockResolvedValue({ data: { booking: { id: 1 }, checkout_url: 'https://stripe.test/pay' } });
    render(<QuoteScreen state={state} navigate={navigate} marina={marina} />);
    fillContact();
    fireEvent.click(screen.getByRole('button', { name: /book & pay/i }));
    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/public/bookings/engine-request/', expect.objectContaining({
        check_in: '2027-07-10',
        check_out: '2027-07-13',
        guest_name: 'J. Sailor',
        guest_email: 'sailor@sea.com',
        guest_phone: '+353871234567',
      }));
    });
  });

  it('engine success redirects to checkout_url', async () => {
    api.post = vi.fn().mockResolvedValue({ data: { booking: { id: 1 }, checkout_url: 'https://stripe.test/pay' } });
    render(<QuoteScreen state={state} navigate={navigate} marina={marina} />);
    fillContact();
    fireEvent.click(screen.getByRole('button', { name: /book & pay/i }));
    await waitFor(() => {
      expect(window.location.href).toBe('https://stripe.test/pay');
    });
  });

  it('engine 409 navigates back to search with banner', async () => {
    api.post = vi.fn().mockRejectedValue({ response: { status: 409, data: { detail: 'No berth.' } } });
    render(<QuoteScreen state={state} navigate={navigate} marina={marina} />);
    fillContact();
    fireEvent.click(screen.getByRole('button', { name: /book & pay/i }));
    await waitFor(() => {
      expect(navigate).toHaveBeenCalledWith('search', expect.objectContaining({
        errorBanner: 'Availability changed while you were reviewing. Please check your dates again.',
      }));
    });
  });

  it('engine 503 shows inline error without navigation', async () => {
    api.post = vi.fn().mockRejectedValue({ response: { status: 503, data: { detail: 'Payment error.' } } });
    render(<QuoteScreen state={state} navigate={navigate} marina={marina} />);
    fillContact();
    fireEvent.click(screen.getByRole('button', { name: /book & pay/i }));
    await waitFor(() => {
      expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    });
    expect(navigate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd portal
npm test -- QuoteScreen.test
```

Expected: failures — stub renders `null`.

- [ ] **Step 3: Implement `QuoteScreen.jsx`**

Replace the full contents of `portal/src/screens/QuoteScreen.jsx` with:

```jsx
import { useState } from 'react';
import api from '../api';

const page = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8', padding: 24 };
const card = { background: '#fff', borderRadius: 12, padding: 36, maxWidth: 480, width: '100%', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' };
const labelStyle = { display: 'block', fontWeight: 600, fontSize: 12, marginBottom: 5, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: '0.4px' };
const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', fontSize: 14, border: '1px solid rgba(0,0,0,0.2)', borderRadius: 6 };

function formatDate(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function QuoteScreen({ state, navigate, marina }) {
  const [form, setForm] = useState({ guestName: '', guestEmail: '', guestPhone: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const nights = Math.round((new Date(state.checkOut) - new Date(state.checkIn)) / 86400000);
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async e => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post('/public/bookings/engine-request/', {
        check_in: state.checkIn,
        check_out: state.checkOut,
        ...(state.boatLoa && { boat_loa: parseFloat(state.boatLoa) }),
        ...(state.boatBeam && { boat_beam: parseFloat(state.boatBeam) }),
        ...(state.boatDraft && { boat_draft: parseFloat(state.boatDraft) }),
        guest_name: form.guestName,
        guest_email: form.guestEmail,
        guest_phone: form.guestPhone,
      });
      window.location.href = data.checkout_url;
    } catch (err) {
      if (err.response?.status === 409) {
        navigate('search', { errorBanner: 'Availability changed while you were reviewing. Please check your dates again.' });
        return;
      }
      setError('Something went wrong, please try again.');
    } finally {
      setBusy(false);
    }
  };

  const field = (labelText, key, type = 'text') => (
    <div style={{ marginBottom: 16 }}>
      <label htmlFor={key} style={labelStyle}>{labelText}</label>
      <input
        id={key}
        type={type}
        value={form[key]}
        onChange={e => set(key, e.target.value)}
        required={key !== 'guestPhone'}
        style={inputStyle}
      />
    </div>
  );

  return (
    <div style={page}>
      <div style={card}>
        <h2 style={{ margin: '0 0 6px', fontSize: 22 }}>{marina?.name}</h2>
        <p style={{ color: 'rgba(0,0,0,0.5)', fontSize: 14, margin: '0 0 20px' }}>Confirm your booking</p>

        {/* Trip summary */}
        <div style={{ background: '#f0f7ff', border: '1px solid #bfdbfe', borderRadius: 8, padding: '14px 16px', marginBottom: 24 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
            {formatDate(state.checkIn)} – {formatDate(state.checkOut)}
          </div>
          <div style={{ color: 'rgba(0,0,0,0.55)', fontSize: 13, marginBottom: 8 }}>
            {nights} night{nights !== 1 ? 's' : ''} · pontoon berth, suitable for your vessel
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#1d4ed8' }}>€{state.quotedTotal?.toFixed(2)}</div>
        </div>

        <form onSubmit={handleSubmit}>
          {field('Full name', 'guestName')}
          {field('Email address', 'guestEmail', 'email')}
          {field('Phone number', 'guestPhone', 'tel')}

          {error && (
            <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{ width: '100%', padding: '12px 0', background: busy ? '#94a3b8' : '#1d4ed8', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: busy ? 'not-allowed' : 'pointer', marginTop: 4 }}
          >
            {busy ? 'Processing…' : 'Book & Pay'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run all frontend tests**

```bash
cd portal
npm test
```

Expected: all tests pass (SearchScreen + AlternativesScreen + QuoteScreen).

- [ ] **Step 5: Commit**

```bash
git add portal/src/screens/QuoteScreen.jsx portal/src/screens/QuoteScreen.test.jsx
git commit -m "feat: add QuoteScreen"
```

---

## Task 8: Wire `App.jsx` and smoke-test

**Files:**
- Modify: `portal/src/App.jsx`

- [ ] **Step 1: Update `App.jsx`**

Open `portal/src/App.jsx`. Add the import at the top alongside the existing screen imports:

```jsx
import BookingWizard from './screens/BookingWizard';
```

Replace the `auto_tetris` placeholder block:

```jsx
  // BEFORE (lines 44–50):
  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 600, margin: '80px auto', textAlign: 'center' }}>
      <h1>{marina.name}</h1>
      <p>Online booking coming soon.</p>
    </div>
  );
```

With:

```jsx
  return <BookingWizard marina={marina} />;
```

The full updated file should look like:

```jsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTenant } from './context/TenantContext';
import Magic from './screens/Magic';
import BookingDashboard from './screens/BookingDashboard';
import BookingRequest from './screens/BookingRequest';
import BookingRequestSent from './screens/BookingRequestSent';
import BookingWizard from './screens/BookingWizard';

export default function App() {
  const [params] = useSearchParams();
  const { marina, isLoading, tenantSlug, customDomain } = useTenant();
  const [submitted, setSubmitted] = useState(false);

  if (params.get('token')) return <Magic />;

  const hasSession = Boolean(localStorage.getItem('portal_session_token'));
  if (hasSession) return <BookingDashboard />;

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8' }}>
        <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 15 }}>Loading…</div>
      </div>
    );
  }

  if (!marina) {
    const identifier = tenantSlug || customDomain || 'this marina';
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚓</div>
          <div style={{ fontSize: 16 }}>Marina &quot;{identifier}&quot; not found.</div>
        </div>
      </div>
    );
  }

  if (marina.booking_mode === 'manual_approval') {
    if (submitted) return <BookingRequestSent marina={marina} />;
    return <BookingRequest marina={marina} onSubmitted={() => setSubmitted(true)} />;
  }

  return <BookingWizard marina={marina} />;
}
```

- [ ] **Step 2: Run all tests**

```bash
cd portal && npm test
cd ../backend && python manage.py test apps.reservations apps.portal --verbosity=2
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add portal/src/App.jsx
git commit -m "feat: wire BookingWizard into App.jsx — Phase 3 complete"
```
