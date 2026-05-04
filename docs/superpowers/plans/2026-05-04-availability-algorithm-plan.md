# Availability Algorithm Phase 2 — Auto-Tetris Engine Hardening

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden `booking_engine.py` so `auto_tetris` works correctly end-to-end: boat draft filtering, maintenance berth exclusion, race condition protection via `select_for_update`, and Stripe webhook auto-confirm wiring via `inv.booking`.

**Architecture:** All changes are pure Python — no new models or migrations needed. `boat_draft` already exists on `Booking`; `Berth.max_draft_m` already exists. Changes are isolated to `booking_engine.py`, `serializers.py`, and `views.py`, with tests added to the existing `tests.py`. The gap-minimisation scoring algorithm is correct and is not changed.

**Tech Stack:** Django 6, Django REST Framework, `django.db.transaction.atomic()`, `select_for_update()`, `unittest.mock.patch`.

**Spec:** `docs/superpowers/specs/2026-05-04-availability-algorithm-design.md`

---

## File Map

- Modify: `backend/apps/reservations/booking_engine.py` — engine logic (Tasks 1, 2)
- Modify: `backend/apps/reservations/serializers.py` — add `boat_draft` field (Task 3)
- Modify: `backend/apps/reservations/views.py` — propagate `boat_draft`, wire `inv.booking` (Tasks 3, 4)
- Modify: `backend/apps/reservations/tests.py` — extend existing test classes (Tasks 1, 2, 3, 4)

---

### Task 1: Harden `compatible_available_berths` — boat_draft + maintenance exclusion

**Files:**
- Modify: `backend/apps/reservations/booking_engine.py` (function `compatible_available_berths`, lines 19–42)
- Modify: `backend/apps/reservations/tests.py` (add to class `CompatibleBerthsTest`)

Context: `compatible_available_berths` currently accepts `boat_loa` and `boat_beam` but ignores draft depth and includes maintenance berths. Both gaps cause incorrect availability results.

- [ ] **Step 1: Add `Decimal` import and three failing tests to `CompatibleBerthsTest`**

At the top of `backend/apps/reservations/tests.py` (line 1), add `from decimal import Decimal` after the existing imports. Then append these three methods to the `CompatibleBerthsTest` class (which starts around line 152):

```python
    def test_draft_too_deep_excluded(self):
        self.b_small.max_draft_m = Decimal('1.5')
        self.b_small.save()
        result = compatible_available_berths(
            self.marina, '2026-06-01', '2026-06-05', boat_draft=2.0,
        )
        ids = [b.id for b in result]
        self.assertNotIn(self.b_small.id, ids)

    def test_draft_fits_included(self):
        self.b_large.max_draft_m = Decimal('2.5')
        self.b_large.save()
        result = compatible_available_berths(
            self.marina, '2026-06-01', '2026-06-05', boat_draft=2.0,
        )
        ids = [b.id for b in result]
        self.assertIn(self.b_large.id, ids)

    def test_maintenance_berth_excluded(self):
        self.b_large.status = 'maintenance'
        self.b_large.save()
        result = compatible_available_berths(
            self.marina, '2026-06-01', '2026-06-05',
        )
        ids = [b.id for b in result]
        self.assertNotIn(self.b_large.id, ids)
```

- [ ] **Step 2: Run tests to confirm they fail**

```
cd backend && python manage.py test apps.reservations.tests.CompatibleBerthsTest.test_draft_too_deep_excluded apps.reservations.tests.CompatibleBerthsTest.test_draft_fits_included apps.reservations.tests.CompatibleBerthsTest.test_maintenance_berth_excluded -v 2
```

Expected: FAIL — `TypeError: compatible_available_berths() got an unexpected keyword argument 'boat_draft'` and assertion errors.

- [ ] **Step 3: Implement `boat_draft` and maintenance exclusion**

In `backend/apps/reservations/booking_engine.py`, replace the entire `compatible_available_berths` function (lines 19–42):

```python
def compatible_available_berths(
    marina, check_in, check_out,
    boat_loa=None, boat_beam=None, boat_draft=None,
):
    qs = Berth.objects.filter(marina=marina).exclude(status='maintenance')

    if boat_loa is not None:
        qs = qs.filter(length_m__gte=Decimal(str(boat_loa)))
    if boat_beam is not None:
        qs = qs.filter(max_beam_m__gte=Decimal(str(boat_beam)))
    if boat_draft is not None:
        qs = qs.filter(max_draft_m__gte=Decimal(str(boat_draft)))

    blocked_ids = (
        Booking.objects.filter(
            marina=marina,
            berth__isnull=False,
            status__in=ACTIVE_STATUSES,
            check_in__lt=check_out,
            check_out__gt=check_in,
        )
        .values_list('berth_id', flat=True)
        .distinct()
    )
    return qs.exclude(id__in=blocked_ids)
```

- [ ] **Step 4: Run all `CompatibleBerthsTest` tests**

```
cd backend && python manage.py test apps.reservations.tests.CompatibleBerthsTest -v 2
```

Expected: All 8 tests PASS (5 existing + 3 new).

- [ ] **Step 5: Commit**

```
git add backend/apps/reservations/booking_engine.py backend/apps/reservations/tests.py
git commit -m "feat: add boat_draft filter and maintenance exclusion to compatible_available_berths"
```

---

### Task 2: Harden `run_tetris` — race condition fix + boat_draft param

**Files:**
- Modify: `backend/apps/reservations/booking_engine.py` (function `run_tetris`, lines 118–157)
- Modify: `backend/apps/reservations/tests.py` (add to class `RunTetrisTest`)

Context: The current `run_tetris` scores candidates, picks `scored[0][1]`, then creates the booking in a single step. Two simultaneous requests can both score the same berth before either writes — a classic TOCTOU race. Fix: iterate over candidates in rank order inside `transaction.atomic()`, lock each with `select_for_update()`, re-verify no collision, fall through to the next candidate if stolen.

- [ ] **Step 1: Write two failing tests in `RunTetrisTest`**

Append to the `RunTetrisTest` class in `tests.py`:

```python
    def test_boat_draft_wired_through(self):
        self.b1.max_draft_m = Decimal('1.0')
        self.b1.save()
        self.b2.max_draft_m = Decimal('3.0')
        self.b2.save()
        booking = run_tetris(
            marina=self.marina,
            check_in='2026-07-01',
            check_out='2026-07-04',
            boat_loa=12.0,
            boat_beam=4.0,
            boat_draft=2.5,
            guest_name='D. Drafter',
            guest_email='d@sea.com',
            guest_phone='',
        )
        self.assertEqual(booking.berth, self.b2)

    def test_race_condition_falls_to_next_candidate(self):
        # b1 gets a booking ending the day before check_in → tight gap → ranked 1st
        Booking.objects.create(
            marina=self.marina, berth=self.b1,
            check_in='2026-06-28', check_out='2026-07-01',
            nights=3, status='confirmed',
        )
        # b2 has no nearby bookings → large gap score → ranked 2nd

        berth_1_id = self.b1.pk
        mock_sfu_qs = MagicMock()

        def sfu_get_side_effect(pk):
            if pk == berth_1_id:
                # Simulate a concurrent request committing a booking on b1 just before
                # our collision check runs — our subsequent .filter(...).exists() finds it.
                Booking.objects.create(
                    marina=self.marina, berth=self.b1,
                    check_in='2026-07-01', check_out='2026-07-05',
                    nights=4, status='pending_payment',
                )
            return Berth.objects.get(pk=pk)

        mock_sfu_qs.get.side_effect = sfu_get_side_effect

        with patch.object(Berth.objects, 'select_for_update', return_value=mock_sfu_qs):
            booking = run_tetris(
                marina=self.marina,
                check_in='2026-07-01',
                check_out='2026-07-05',
                boat_loa=12.0,
                boat_beam=4.0,
                boat_draft=None,
                guest_name='T. Racer',
                guest_email='',
                guest_phone='',
            )

        self.assertEqual(booking.berth, self.b2)
        self.assertEqual(booking.status, 'pending_payment')
```

`MagicMock` is already imported at the top of `tests.py` (line `from unittest.mock import MagicMock`). `patch` is imported at line 2 (`from unittest.mock import patch`).

- [ ] **Step 2: Run tests to confirm they fail**

```
cd backend && python manage.py test apps.reservations.tests.RunTetrisTest.test_boat_draft_wired_through apps.reservations.tests.RunTetrisTest.test_race_condition_falls_to_next_candidate -v 2
```

Expected: FAIL — `TypeError` for unexpected `boat_draft` kwarg; race condition test books b1 instead of b2.

- [ ] **Step 3: Add `transaction` import and rewrite `run_tetris`**

At the top of `backend/apps/reservations/booking_engine.py`, add the `transaction` import:

```python
from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction
from django.db.models import Subquery, OuterRef

from apps.berths.models import Berth
from .models import Booking
```

Then replace the entire `run_tetris` function:

```python
def run_tetris(marina, check_in, check_out, boat_loa, boat_beam, boat_draft=None,
               guest_name='', guest_email='', guest_phone=''):
    if isinstance(check_in, str):
        check_in = date.fromisoformat(check_in)
    if isinstance(check_out, str):
        check_out = date.fromisoformat(check_out)
    if check_out <= check_in:
        raise ValueError(f'check_out ({check_out}) must be after check_in ({check_in}).')

    candidates = compatible_available_berths(
        marina, check_in, check_out, boat_loa, boat_beam, boat_draft,
    )
    scored = _score_berths(candidates, check_in, check_out)
    if not scored:
        raise NoAvailableBerthError('No compatible berth available for the requested dates.')

    nights = (check_out - check_in).days or 1

    with transaction.atomic():
        for _, berth in scored:
            Berth.objects.select_for_update().get(pk=berth.pk)

            collision = Booking.objects.filter(
                berth=berth,
                status__in=ACTIVE_STATUSES,
                check_in__lt=check_out,
                check_out__gt=check_in,
            ).exists()
            if collision:
                continue

            price = berth.pricing_tier.unit_price
            amount = Decimal(str(price)) * nights
            return Booking.objects.create(
                marina=marina,
                berth=berth,
                vessel=None,
                check_in=check_in,
                check_out=check_out,
                nights=nights,
                amount=amount,
                status='pending_payment',
                boat_loa=boat_loa,
                boat_beam=boat_beam,
                boat_draft=boat_draft,
                guest_name=guest_name,
                guest_email=guest_email,
                guest_phone=guest_phone,
            )

        raise NoAvailableBerthError('No compatible berth available for the requested dates.')
```

Note: `boat_draft=None` is a default so existing callers that don't pass it continue to work.

- [ ] **Step 4: Run all `RunTetrisTest` tests**

```
cd backend && python manage.py test apps.reservations.tests.RunTetrisTest -v 2
```

Expected: All 4 tests PASS (2 existing + 2 new).

- [ ] **Step 5: Commit**

```
git add backend/apps/reservations/booking_engine.py backend/apps/reservations/tests.py
git commit -m "feat: harden run_tetris with select_for_update fallthrough loop and boat_draft"
```

---

### Task 3: Propagate `boat_draft` through serializer and endpoints

**Files:**
- Modify: `backend/apps/reservations/serializers.py` (`BookingEngineRequestSerializer`, line 31)
- Modify: `backend/apps/reservations/booking_engine.py` (`create_manual_approval`, lines 90–115)
- Modify: `backend/apps/reservations/views.py` (`BookingEngineRequestView` ~lines 168–193, `AvailableBerthsView` ~lines 127–148)
- Modify: `backend/apps/reservations/tests.py` (add `test_boat_draft_filter` to `AvailableBerthsEndpointTest`)

Context: The serializer doesn't accept `boat_draft` from the request payload, and neither endpoint passes it to the engine. This task wires it all the way through.

- [ ] **Step 1: Write failing test in `AvailableBerthsEndpointTest`**

Append to `AvailableBerthsEndpointTest` in `tests.py`:

```python
    def test_boat_draft_filter(self):
        self.b.max_draft_m = Decimal('2.0')
        self.b.save()
        resp = self.client.get('/api/v1/bookings/available-berths/', {
            'check_in':   '2026-07-01',
            'check_out':  '2026-07-05',
            'boat_draft': '3.0',
        })
        self.assertEqual(resp.status_code, 200)
        ids = [b['id'] for b in resp.data]
        self.assertNotIn(self.b.id, ids)
```

- [ ] **Step 2: Run test to confirm it fails**

```
cd backend && python manage.py test apps.reservations.tests.AvailableBerthsEndpointTest.test_boat_draft_filter -v 2
```

Expected: FAIL — berth is incorrectly included because `boat_draft` is not forwarded.

- [ ] **Step 3: Add `boat_draft` field to `BookingEngineRequestSerializer`**

In `backend/apps/reservations/serializers.py`, update `BookingEngineRequestSerializer` to add the field after `boat_beam`:

```python
class BookingEngineRequestSerializer(serializers.Serializer):
    check_in    = serializers.DateField()
    check_out   = serializers.DateField()
    boat_loa    = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, allow_null=True)
    boat_beam   = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    boat_draft  = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    guest_name  = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')
    guest_email = serializers.EmailField(required=False, allow_blank=True, default='')
    guest_phone = serializers.CharField(max_length=50, required=False, allow_blank=True, default='')

    def validate(self, data):
        if data['check_out'] <= data['check_in']:
            raise serializers.ValidationError('check_out must be after check_in.')
        return data
```

- [ ] **Step 4: Add `boat_draft=None` to `create_manual_approval`**

In `backend/apps/reservations/booking_engine.py`, update `create_manual_approval`:

```python
def create_manual_approval(marina, check_in, check_out, boat_loa, boat_beam, boat_draft=None,
                           guest_name='', guest_email='', guest_phone=''):
    if isinstance(check_in, str):
        check_in = date.fromisoformat(check_in)
    if isinstance(check_out, str):
        check_out = date.fromisoformat(check_out)

    if check_out <= check_in:
        raise ValueError(f'check_out ({check_out}) must be after check_in ({check_in}).')

    nights = (check_out - check_in).days or 1
    return Booking.objects.create(
        marina=marina,
        berth=None,
        vessel=None,
        check_in=check_in,
        check_out=check_out,
        nights=nights,
        amount=None,
        status='pending_approval',
        boat_loa=boat_loa,
        boat_beam=boat_beam,
        boat_draft=boat_draft,
        guest_name=guest_name,
        guest_email=guest_email,
        guest_phone=guest_phone,
    )
```

- [ ] **Step 5: Update `BookingEngineRequestView` to pass `boat_draft`**

In `backend/apps/reservations/views.py`, update the `manual_approval` call (around line 168):

```python
        if marina.booking_mode == 'manual_approval':
            booking = create_manual_approval(
                marina=marina,
                check_in=d['check_in'],
                check_out=d['check_out'],
                boat_loa=d.get('boat_loa'),
                boat_beam=d.get('boat_beam'),
                boat_draft=d.get('boat_draft'),
                guest_name=d.get('guest_name', ''),
                guest_email=d.get('guest_email', ''),
                guest_phone=d.get('guest_phone', ''),
            )
            return Response(BookingSerializer(booking).data, status=http_status.HTTP_201_CREATED)
```

Update the `run_tetris` call (around line 184):

```python
                booking = run_tetris(
                    marina=marina,
                    check_in=d['check_in'],
                    check_out=d['check_out'],
                    boat_loa=d.get('boat_loa'),
                    boat_beam=d.get('boat_beam'),
                    boat_draft=d.get('boat_draft'),
                    guest_name=d.get('guest_name', ''),
                    guest_email=d.get('guest_email', ''),
                    guest_phone=d.get('guest_phone', ''),
                )
```

- [ ] **Step 6: Update `AvailableBerthsView` to read and forward `boat_draft`**

In `backend/apps/reservations/views.py`, replace the `get` method of `AvailableBerthsView`:

```python
    def get(self, request):
        check_in  = request.query_params.get('check_in')
        check_out = request.query_params.get('check_out')
        if not check_in or not check_out:
            return Response({'detail': 'check_in and check_out are required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        boat_loa   = request.query_params.get('boat_loa') or None
        boat_beam  = request.query_params.get('boat_beam') or None
        boat_draft = request.query_params.get('boat_draft') or None

        try:
            berths = compatible_available_berths(
                marina=request.user.marina,
                check_in=check_in,
                check_out=check_out,
                boat_loa=float(boat_loa) if boat_loa else None,
                boat_beam=float(boat_beam) if boat_beam else None,
                boat_draft=float(boat_draft) if boat_draft else None,
            )
        except ValueError as e:
            return Response({'detail': str(e)}, status=http_status.HTTP_400_BAD_REQUEST)

        from apps.berths.serializers import BerthSerializer
        return Response(BerthSerializer(berths, many=True).data)
```

- [ ] **Step 7: Run tests**

```
cd backend && python manage.py test apps.reservations.tests.AvailableBerthsEndpointTest apps.reservations.tests.BookingEngineRequestEndpointTest apps.reservations.tests.CreateManualApprovalTest -v 2
```

Expected: All tests PASS.

- [ ] **Step 8: Commit**

```
git add backend/apps/reservations/serializers.py backend/apps/reservations/booking_engine.py backend/apps/reservations/views.py backend/apps/reservations/tests.py
git commit -m "feat: propagate boat_draft through serializer, engine functions, and endpoints"
```

---

### Task 4: Wire `inv.booking` in `BookingEngineRequestView`

**Files:**
- Modify: `backend/apps/reservations/views.py` (two lines in `BookingEngineRequestView.post`, around line 211)
- Modify: `backend/apps/reservations/tests.py` (add to `BookingEngineRequestEndpointTest`)

Context: The `auto_tetris` path creates an invoice but never sets `inv.booking`. Without this FK, the Stripe webhook's `checkout.session.completed` handler finds `invoice.booking_id = None` and skips the booking confirmation — the booking stays `pending_payment` forever.

- [ ] **Step 1: Write failing test in `BookingEngineRequestEndpointTest`**

Append to `BookingEngineRequestEndpointTest` in `tests.py`:

```python
    @patch('apps.billing.stripe_service._create_checkout_session', return_value='https://checkout.stripe.com/test')
    def test_auto_tetris_sets_invoice_booking_fk(self, mock_checkout):
        self.marina.booking_mode = 'auto_tetris'
        self.marina.save()
        resp = self.client.post('/api/v1/bookings/engine-request/', {
            'check_in':   '2026-09-01',
            'check_out':  '2026-09-05',
            'boat_loa':   '12.0',
            'boat_beam':  '4.0',
            'guest_name': 'I. Boatman',
            'guest_email': 'i@sea.com',
            'guest_phone': '',
        })
        self.assertEqual(resp.status_code, 201)
        booking_id = resp.data['booking']['id']
        from apps.billing.models import Invoice
        inv = Invoice.objects.get(source_type='berth_booking', source_id=str(booking_id))
        self.assertEqual(inv.booking_id, booking_id)
```

- [ ] **Step 2: Run test to confirm it fails**

```
cd backend && python manage.py test apps.reservations.tests.BookingEngineRequestEndpointTest.test_auto_tetris_sets_invoice_booking_fk -v 2
```

Expected: FAIL — `AssertionError: None != <booking_id>` (inv.booking_id is None).

- [ ] **Step 3: Add the two lines that wire `inv.booking`**

In `backend/apps/reservations/views.py`, locate the `auto_tetris` block inside `BookingEngineRequestView.post`. Find the line `billing_service.finalize_invoice(inv)` (around line 211) and add two lines immediately after it:

```python
                billing_service.finalize_invoice(inv)
                inv.booking = booking
                inv.save(update_fields=['booking'])
                checkout_url = billing_service.create_stripe_checkout_session(inv)
```

- [ ] **Step 4: Run the new test**

```
cd backend && python manage.py test apps.reservations.tests.BookingEngineRequestEndpointTest.test_auto_tetris_sets_invoice_booking_fk -v 2
```

Expected: PASS.

- [ ] **Step 5: Run the full test suite**

```
cd backend && python manage.py test apps.reservations apps.berths apps.billing -v 2
```

Expected: All tests PASS with no regressions.

- [ ] **Step 6: Commit**

```
git add backend/apps/reservations/views.py backend/apps/reservations/tests.py
git commit -m "fix: wire inv.booking FK in auto_tetris path so Stripe webhook can confirm booking"
```
