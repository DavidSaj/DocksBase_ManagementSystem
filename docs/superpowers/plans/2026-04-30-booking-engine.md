# Booking Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a dual-mode booking engine — Mode A (Manual Approval) and Mode B (Auto-Tetris gap-minimisation) — controlled by a per-marina `booking_mode` flag, with Stripe Checkout for payment and automatic invoice generation.

**Architecture:** `booking_engine.py` is a pure-Python service layer with no HTTP concerns; views call it and handle HTTP. Mode A produces `pending_approval` bookings with `berth=null`; an admin PATCH assigns the berth, creates an Invoice, fires a Stripe Checkout Session link via email. Mode B runs a gap-minimisation algorithm using ORM subqueries, assigns the berth immediately, creates a Stripe Checkout Session, and returns the checkout URL to the caller. A single `StripeWebhookView` handles `checkout.session.completed` for both modes, confirming the booking and marking the invoice paid. The admin "Pending Approvals" queue in `Reservations.jsx` is extended with an Assign Berth modal.

**Tech Stack:** Django 6, DRF, SimpleJWT, stripe (new), React + Vite, axios

---

## File Map

| File | Action |
|---|---|
| `backend/apps/accounts/models.py` | Add `booking_mode` to Marina |
| `backend/apps/accounts/migrations/0003_marina_booking_mode.py` | Auto-generated |
| `backend/apps/reservations/models.py` | Nullable berth/vessel, new statuses, guest fields, boat dims, stripe_session_id |
| `backend/apps/reservations/migrations/0004_booking_engine_fields.py` | Auto-generated |
| `backend/apps/reservations/booking_engine.py` | Create — `compatible_available_berths()`, `score_berths()`, `create_manual_approval()`, `run_tetris()` |
| `backend/apps/reservations/serializers.py` | Add new Booking fields; add `BookingEngineRequestSerializer`, `AssignBerthSerializer` |
| `backend/apps/reservations/views.py` | Add `AvailableBerthsView`, `BookingEngineRequestView`, `AssignBerthView`, `StripeWebhookView` |
| `backend/apps/reservations/urls.py` | Add 4 new URL patterns |
| `backend/apps/reservations/tests.py` | Add engine + endpoint + webhook tests |
| `backend/config/settings/base.py` | Add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FRONTEND_URL` |
| `backend/config/settings/dev.py` | Add dev Stripe/frontend stubs |
| `backend/requirements.txt` | Add stripe |
| `frontend/src/hooks/useBookings.js` | Add `assignBerth()` action |
| `frontend/src/hooks/useBookingEngine.js` | Create — `checkAvailability()`, `submitRequest()` |
| `frontend/src/screens/Reservations.jsx` | Add "Pending Approvals" tab with Assign Berth modal |

---

### Task 1: Marina `booking_mode` field

**Files:**
- Modify: `backend/apps/accounts/models.py`
- Create: `backend/apps/accounts/migrations/0003_marina_booking_mode.py` (auto-generated)

- [ ] **Step 1: Add `booking_mode` to Marina**

Open `backend/apps/accounts/models.py`. Add after `operations_paused`:

```python
    BOOKING_MODE_CHOICES = [
        ('manual_approval', 'Manual Approval'),
        ('auto_tetris', 'Auto-Tetris'),
    ]
    booking_mode = models.CharField(max_length=20, choices=BOOKING_MODE_CHOICES, default='manual_approval')
```

- [ ] **Step 2: Generate and apply migration**

```bash
cd backend
python manage.py makemigrations accounts --settings=config.settings.dev
python manage.py migrate --settings=config.settings.dev
```

Expected: new migration file created; applied with no errors.

- [ ] **Step 3: Verify system check**

```bash
python manage.py check --settings=config.settings.dev
```

Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 4: Commit**

```bash
git add backend/apps/accounts/models.py backend/apps/accounts/migrations/
git commit -m "feat(booking-engine): add booking_mode to Marina"
```

---

### Task 2: Extend Booking model for booking engine

**Files:**
- Modify: `backend/apps/reservations/models.py`
- Create: `backend/apps/reservations/migrations/0004_booking_engine_fields.py` (auto-generated)

- [ ] **Step 1: Replace models.py**

```python
# backend/apps/reservations/models.py
from django.db import models


class Booking(models.Model):
    TYPE_CHOICES = [
        ('transient', 'Transient'),
        ('seasonal', 'Seasonal'),
    ]
    STATUS_CHOICES = [
        # Engine pre-operational states
        ('pending_approval', 'Pending Approval'),   # Mode A: berth=null, awaiting admin
        ('awaiting_payment', 'Awaiting Payment'),   # Mode A: berth assigned, Stripe link sent
        ('pending_payment',  'Pending Payment'),    # Mode B: berth assigned, Stripe checkout open
        ('confirmed',        'Confirmed'),           # Both modes: payment received
        # Operational states (existing)
        ('pending',      'Pending'),
        ('checked_in',   'Checked In'),
        ('checked_out',  'Checked Out'),
        ('overstay',     'Overstay'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='bookings')
    berth = models.ForeignKey('berths.Berth', on_delete=models.PROTECT, related_name='bookings', null=True, blank=True)
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.PROTECT, related_name='bookings', null=True, blank=True)
    booking_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='transient')
    check_in = models.DateField()
    check_out = models.DateField()
    nights = models.IntegerField(default=1)
    amount = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    paid = models.BooleanField(default=False)
    notes = models.TextField(blank=True)

    # Guest / boater contact (set when no linked vessel/member)
    guest_name = models.CharField(max_length=200, blank=True)
    guest_email = models.EmailField(blank=True)
    guest_phone = models.CharField(max_length=50, blank=True)

    # Boat dimensions for berth compatibility check
    boat_loa = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)
    boat_beam = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    # Stripe
    stripe_session_id = models.CharField(max_length=200, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        berth_code = self.berth.code if self.berth else 'unassigned'
        return f'BK-{self.pk} — {self.vessel or self.guest_name} @ {berth_code}'


class BookingRequest(models.Model):
    TYPE_CHOICES = [
        ('transient', 'Transient'),
        ('seasonal',  'Seasonal'),
    ]
    STATUS_CHOICES = [
        ('pending',  'Pending'),
        ('approved', 'Approved'),
        ('rejected', 'Rejected'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='booking_requests')

    # Relational path — set when the applicant is a known member
    member = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='booking_requests')
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True, related_name='booking_requests')

    # Free-text path — set when the applicant is a stranger
    guest_name   = models.CharField(max_length=200, blank=True)
    guest_phone  = models.CharField(max_length=50,  blank=True)
    guest_email  = models.CharField(max_length=200, blank=True)
    guest_vessel = models.CharField(max_length=200, blank=True)
    guest_loa    = models.DecimalField(max_digits=6, decimal_places=2, null=True, blank=True)

    # Booking intent
    berth        = models.ForeignKey('berths.Berth', on_delete=models.PROTECT, related_name='booking_requests')
    booking_type = models.CharField(max_length=20, choices=TYPE_CHOICES, default='transient')
    start_date   = models.DateField()
    end_date     = models.DateField()
    notes        = models.TextField(blank=True)

    # Lifecycle
    status  = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    booking = models.OneToOneField(Booking, on_delete=models.SET_NULL, null=True, blank=True, related_name='source_request')

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at']

    def __str__(self):
        name = self.member.name if self.member else self.guest_name
        return f'WL-{self.pk} — {name}'

    @property
    def is_stranger(self):
        return self.member is None

    def convert_to_booking(self):
        """Convert a free-text request into Member + Vessel + Booking. Idempotent."""
        if self.booking_id:
            return self.booking

        from apps.members.models import Member
        from apps.vessels.models import Vessel

        if self.is_stranger:
            member = Member.objects.create(
                marina=self.marina,
                name=self.guest_name,
                email=self.guest_email,
                phone=self.guest_phone,
                member_type='transient',
            )
            vessel = Vessel.objects.create(
                marina=self.marina,
                name=self.guest_vessel or f"{self.guest_name}'s Vessel",
                loa=self.guest_loa,
                owner=member,
            )
            self.member = member
            self.vessel = vessel

        nights = (self.end_date - self.start_date).days or 1
        price  = self.berth.price_per_night
        amount = (price * nights) if price is not None else None

        booking = Booking.objects.create(
            marina=self.marina,
            berth=self.berth,
            vessel=self.vessel,
            booking_type=self.booking_type,
            check_in=self.start_date,
            check_out=self.end_date,
            nights=nights,
            amount=amount,
            notes=self.notes,
            status='pending',
        )
        self.booking = booking
        self.status  = 'approved'
        self.save()
        return booking
```

- [ ] **Step 2: Generate and apply migration**

```bash
cd backend
python manage.py makemigrations reservations --settings=config.settings.dev
python manage.py migrate --settings=config.settings.dev
```

Expected: migration `0004_booking_engine_fields.py` created and applied with no errors.

- [ ] **Step 3: Commit**

```bash
git add backend/apps/reservations/models.py backend/apps/reservations/migrations/
git commit -m "feat(booking-engine): extend Booking model — nullable berth/vessel, new statuses, guest/boat/stripe fields"
```

---

### Task 3: Write `booking_engine.py` tests (red)

**Files:**
- Modify: `backend/apps/reservations/tests.py`

- [ ] **Step 1: Append engine tests to the existing tests.py**

Open `backend/apps/reservations/tests.py`. After the last test class, append:

```python
# ── Booking Engine Tests ─────────────────────────────────────────────────────

from apps.berths.models import Pier, Berth
from .booking_engine import compatible_available_berths, run_tetris, create_manual_approval


def make_berth_with_dims(marina, code, loa=20.0, beam=6.0, price=50):
    pier, _ = Pier.objects.get_or_create(marina=marina, code='T', defaults={'label': 'Test Pier'})
    return Berth.objects.create(
        marina=marina, pier=pier, code=code,
        length_m=loa, max_beam_m=beam,
        price_per_night=price, status='available',
    )


class CompatibleBerthsTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.b_small = make_berth_with_dims(self.marina, 'S1', loa=10.0, beam=3.5)
        self.b_large = make_berth_with_dims(self.marina, 'L1', loa=25.0, beam=8.0)

    def test_filters_by_loa(self):
        result = compatible_available_berths(self.marina, '2026-06-01', '2026-06-05', boat_loa=12.0, boat_beam=None)
        ids = [b.id for b in result]
        self.assertNotIn(self.b_small.id, ids)
        self.assertIn(self.b_large.id, ids)

    def test_filters_by_beam(self):
        result = compatible_available_berths(self.marina, '2026-06-01', '2026-06-05', boat_loa=None, boat_beam=9.0)
        ids = [b.id for b in result]
        self.assertNotIn(self.b_large.id, ids)

    def test_excludes_berths_with_overlapping_confirmed_booking(self):
        Booking.objects.create(
            marina=self.marina, berth=self.b_large,
            check_in='2026-06-03', check_out='2026-06-07',
            nights=4, status='confirmed',
        )
        result = compatible_available_berths(self.marina, '2026-06-01', '2026-06-05', boat_loa=12.0, boat_beam=None)
        ids = [b.id for b in result]
        self.assertNotIn(self.b_large.id, ids)

    def test_excludes_pending_approval_bookings_from_overlap(self):
        # pending_approval has berth=null so should NOT be counted as blocking
        Booking.objects.create(
            marina=self.marina,
            check_in='2026-06-03', check_out='2026-06-07',
            nights=4, status='pending_approval',
        )
        result = compatible_available_berths(self.marina, '2026-06-01', '2026-06-05', boat_loa=12.0, boat_beam=None)
        ids = [b.id for b in result]
        self.assertIn(self.b_large.id, ids)

    def test_adjacent_bookings_do_not_block(self):
        Booking.objects.create(
            marina=self.marina, berth=self.b_large,
            check_in='2026-05-25', check_out='2026-06-01',  # ends exactly on our check_in
            nights=7, status='confirmed',
        )
        result = compatible_available_berths(self.marina, '2026-06-01', '2026-06-05', boat_loa=12.0, boat_beam=None)
        ids = [b.id for b in result]
        self.assertIn(self.b_large.id, ids)


class RunTetrisTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.marina.booking_mode = 'auto_tetris'
        self.marina.save()
        self.b1 = make_berth_with_dims(self.marina, 'A1', loa=20.0, beam=6.0, price=80)
        self.b2 = make_berth_with_dims(self.marina, 'A2', loa=20.0, beam=6.0, price=80)

    def test_selects_berth_with_lowest_gap_score(self):
        # b1 has a booking ending 1 day before our check-in (gap_before=1)
        Booking.objects.create(
            marina=self.marina, berth=self.b1,
            check_in='2026-05-28', check_out='2026-06-01',
            nights=4, status='confirmed',
        )
        # b2 has a booking ending 10 days before our check-in (gap_before=10)
        Booking.objects.create(
            marina=self.marina, berth=self.b2,
            check_in='2026-05-15', check_out='2026-05-22',
            nights=7, status='confirmed',
        )
        booking = run_tetris(
            marina=self.marina,
            check_in='2026-06-01',
            check_out='2026-06-05',
            boat_loa=12.0,
            boat_beam=4.0,
            guest_name='T. Boater',
            guest_email='t@example.com',
            guest_phone='',
        )
        self.assertEqual(booking.berth, self.b1)
        self.assertEqual(booking.status, 'pending_payment')
        self.assertEqual(booking.nights, 4)
        self.assertEqual(float(booking.amount), 320.0)

    def test_run_tetris_raises_if_no_compatible_berth(self):
        from .booking_engine import NoAvailableBerthError
        Booking.objects.create(
            marina=self.marina, berth=self.b1,
            check_in='2026-06-01', check_out='2026-06-10',
            nights=9, status='confirmed',
        )
        Booking.objects.create(
            marina=self.marina, berth=self.b2,
            check_in='2026-06-02', check_out='2026-06-08',
            nights=6, status='confirmed',
        )
        with self.assertRaises(NoAvailableBerthError):
            run_tetris(
                marina=self.marina,
                check_in='2026-06-03',
                check_out='2026-06-06',
                boat_loa=12.0,
                boat_beam=4.0,
                guest_name='A. Guest',
                guest_email='',
                guest_phone='',
            )


class CreateManualApprovalTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.marina.booking_mode = 'manual_approval'
        self.marina.save()

    def test_creates_booking_with_null_berth(self):
        booking = create_manual_approval(
            marina=self.marina,
            check_in='2026-06-01',
            check_out='2026-06-05',
            boat_loa=12.0,
            boat_beam=4.0,
            guest_name='J. Sailor',
            guest_email='j@sea.com',
            guest_phone='+353 87 100 0000',
        )
        self.assertIsNone(booking.berth)
        self.assertEqual(booking.status, 'pending_approval')
        self.assertEqual(booking.nights, 4)
        self.assertIsNone(booking.amount)

    def test_creates_booking_with_guest_fields(self):
        booking = create_manual_approval(
            marina=self.marina,
            check_in='2026-06-01',
            check_out='2026-06-03',
            boat_loa=10.0,
            boat_beam=3.5,
            guest_name='K. Wanderer',
            guest_email='k@sea.com',
            guest_phone='+353 87 200 0000',
        )
        self.assertEqual(booking.guest_name, 'K. Wanderer')
        self.assertEqual(booking.guest_email, 'k@sea.com')
        self.assertEqual(booking.boat_loa, 10.0)
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
cd backend
python manage.py test apps.reservations.tests.CompatibleBerthsTest apps.reservations.tests.RunTetrisTest apps.reservations.tests.CreateManualApprovalTest --settings=config.settings.dev -v 2
```

Expected: `ImportError: cannot import name 'compatible_available_berths' from 'apps.reservations.booking_engine'`. All tests fail. This is correct.

---

### Task 4: Implement `booking_engine.py` (tests green)

**Files:**
- Create: `backend/apps/reservations/booking_engine.py`

- [ ] **Step 1: Create booking_engine.py**

```python
# backend/apps/reservations/booking_engine.py
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Subquery, OuterRef

from apps.berths.models import Berth
from .models import Booking

ACTIVE_STATUSES = ['awaiting_payment', 'pending_payment', 'confirmed', 'pending', 'checked_in']
INFINITE_GAP = timedelta(days=3650)  # treat missing neighbour as 10-year gap


class NoAvailableBerthError(Exception):
    pass


def compatible_available_berths(marina, check_in, check_out, boat_loa=None, boat_beam=None):
    """
    Return a queryset of Berths that:
    1. Physically fit the boat (length_m >= boat_loa, max_beam_m >= boat_beam)
    2. Have no confirmed/active booking that overlaps [check_in, check_out)
    """
    qs = Berth.objects.filter(marina=marina)
    if boat_loa is not None:
        qs = qs.filter(length_m__gte=Decimal(str(boat_loa)))
    if boat_beam is not None:
        qs = qs.filter(max_beam_m__gte=Decimal(str(boat_beam)))

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


def _score_berths(available_berths, check_in, check_out):
    """
    Annotate each berth with the dates of its nearest neighbours and compute
    gap_before + gap_after. Uses ORM subqueries — no full table scan.
    Returns [(score: timedelta, berth), ...] sorted ascending.
    """
    if isinstance(check_in, str):
        check_in = date.fromisoformat(check_in)
    if isinstance(check_out, str):
        check_out = date.fromisoformat(check_out)

    prev_qs = (
        Booking.objects.filter(
            berth=OuterRef('pk'),
            check_out__lte=check_in,
            status__in=ACTIVE_STATUSES,
        )
        .order_by('-check_out')
        .values('check_out')[:1]
    )
    next_qs = (
        Booking.objects.filter(
            berth=OuterRef('pk'),
            check_in__gte=check_out,
            status__in=ACTIVE_STATUSES,
        )
        .order_by('check_in')
        .values('check_in')[:1]
    )

    annotated = available_berths.annotate(
        _prev_checkout=Subquery(prev_qs),
        _next_checkin=Subquery(next_qs),
    )

    scored = []
    for berth in annotated:
        gap_before = (check_in - berth._prev_checkout) if berth._prev_checkout else INFINITE_GAP
        gap_after = (berth._next_checkin - check_out) if berth._next_checkin else INFINITE_GAP
        scored.append((gap_before + gap_after, berth))

    scored.sort(key=lambda x: x[0])
    return scored


def create_manual_approval(marina, check_in, check_out, boat_loa, boat_beam, guest_name, guest_email, guest_phone):
    """Mode A: create a Booking with berth=null, status=pending_approval."""
    if isinstance(check_in, str):
        check_in = date.fromisoformat(check_in)
    if isinstance(check_out, str):
        check_out = date.fromisoformat(check_out)

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
        guest_name=guest_name,
        guest_email=guest_email,
        guest_phone=guest_phone,
    )


def run_tetris(marina, check_in, check_out, boat_loa, boat_beam, guest_name, guest_email, guest_phone):
    """
    Mode B: run gap-minimisation, assign berth immediately, return Booking
    with status=pending_payment.
    Raises NoAvailableBerthError if no compatible berth is free.
    """
    if isinstance(check_in, str):
        check_in = date.fromisoformat(check_in)
    if isinstance(check_out, str):
        check_out = date.fromisoformat(check_out)

    candidates = compatible_available_berths(marina, check_in, check_out, boat_loa, boat_beam)
    scored = _score_berths(candidates, check_in, check_out)

    if not scored:
        raise NoAvailableBerthError('No compatible berth available for the requested dates.')

    best_berth = scored[0][1]
    nights = (check_out - check_in).days or 1
    price = best_berth.price_per_night
    amount = (Decimal(str(price)) * nights) if price is not None else None

    return Booking.objects.create(
        marina=marina,
        berth=best_berth,
        vessel=None,
        check_in=check_in,
        check_out=check_out,
        nights=nights,
        amount=amount,
        status='pending_payment',
        boat_loa=boat_loa,
        boat_beam=boat_beam,
        guest_name=guest_name,
        guest_email=guest_email,
        guest_phone=guest_phone,
    )
```

- [ ] **Step 2: Run engine tests — confirm they pass**

```bash
cd backend
python manage.py test apps.reservations.tests.CompatibleBerthsTest apps.reservations.tests.RunTetrisTest apps.reservations.tests.CreateManualApprovalTest --settings=config.settings.dev -v 2
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/apps/reservations/booking_engine.py backend/apps/reservations/tests.py
git commit -m "feat(booking-engine): booking_engine service — compatible berths filter, gap-minimisation, Mode A/B factory"
```

---

### Task 5: Install Stripe + configure settings

**Files:**
- Modify: `backend/requirements.txt`
- Modify: `backend/config/settings/base.py`
- Modify: `backend/config/settings/dev.py`

- [ ] **Step 1: Install stripe**

```bash
cd backend
pip install stripe
pip freeze | grep "^stripe" >> requirements.txt
```

- [ ] **Step 2: Add Stripe + frontend config to base.py**

Open `backend/config/settings/base.py`. After `DEFAULT_FROM_EMAIL`:

```python
STRIPE_SECRET_KEY = os.environ.get('STRIPE_SECRET_KEY', '')
STRIPE_WEBHOOK_SECRET = os.environ.get('STRIPE_WEBHOOK_SECRET', '')
FRONTEND_URL = os.environ.get('FRONTEND_URL', 'http://localhost:5173')
```

- [ ] **Step 3: Add dev Stripe stub to dev.py**

Open `backend/config/settings/dev.py`. After `EMAIL_BACKEND`:

```python
STRIPE_SECRET_KEY = 'sk_test_placeholder'
STRIPE_WEBHOOK_SECRET = 'whsec_placeholder'
```

- [ ] **Step 4: Verify system check**

```bash
cd backend
python manage.py check --settings=config.settings.dev
```

Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt backend/config/settings/base.py backend/config/settings/dev.py
git commit -m "feat(booking-engine): install stripe, add STRIPE_SECRET_KEY/WEBHOOK_SECRET/FRONTEND_URL settings"
```

---

### Task 6: Write endpoint + webhook tests (red)

**Files:**
- Modify: `backend/apps/reservations/tests.py`

- [ ] **Step 1: Append endpoint tests**

Open `backend/apps/reservations/tests.py`. After the engine tests, append:

```python
# ── Endpoint Tests ───────────────────────────────────────────────────────────

import json
from unittest.mock import patch, MagicMock


class AvailableBerthsEndpointTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.b = make_berth_with_dims(self.marina, 'E1', loa=20.0, beam=6.0)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_returns_compatible_berths(self):
        resp = self.client.get('/api/v1/bookings/available-berths/', {
            'check_in': '2026-07-01',
            'check_out': '2026-07-05',
            'boat_loa': '12.0',
            'boat_beam': '4.0',
        })
        self.assertEqual(resp.status_code, 200)
        ids = [b['id'] for b in resp.data]
        self.assertIn(self.b.id, ids)

    def test_excludes_berth_too_small(self):
        resp = self.client.get('/api/v1/bookings/available-berths/', {
            'check_in': '2026-07-01',
            'check_out': '2026-07-05',
            'boat_loa': '22.0',
            'boat_beam': '4.0',
        })
        self.assertEqual(resp.status_code, 200)
        ids = [b['id'] for b in resp.data]
        self.assertNotIn(self.b.id, ids)

    def test_returns_400_without_dates(self):
        resp = self.client.get('/api/v1/bookings/available-berths/', {
            'boat_loa': '12.0',
        })
        self.assertEqual(resp.status_code, 400)


class BookingEngineRequestEndpointTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.b = make_berth_with_dims(self.marina, 'R1', loa=20.0, beam=6.0, price=100)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_mode_a_creates_pending_approval_booking(self):
        self.marina.booking_mode = 'manual_approval'
        self.marina.save()
        resp = self.client.post('/api/v1/bookings/engine-request/', {
            'check_in': '2026-08-01',
            'check_out': '2026-08-05',
            'boat_loa': '12.0',
            'boat_beam': '4.0',
            'guest_name': 'A. Mariner',
            'guest_email': 'a@sea.com',
            'guest_phone': '',
        })
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['status'], 'pending_approval')
        self.assertIsNone(resp.data['berth'])

    @patch('apps.reservations.views.stripe')
    def test_mode_b_creates_pending_payment_booking(self, mock_stripe):
        mock_session = MagicMock()
        mock_session.id = 'cs_test_123'
        mock_session.url = 'https://checkout.stripe.com/test'
        mock_stripe.checkout.Session.create.return_value = mock_session
        self.marina.booking_mode = 'auto_tetris'
        self.marina.save()
        resp = self.client.post('/api/v1/bookings/engine-request/', {
            'check_in': '2026-08-01',
            'check_out': '2026-08-05',
            'boat_loa': '12.0',
            'boat_beam': '4.0',
            'guest_name': 'B. Skipper',
            'guest_email': 'b@sea.com',
            'guest_phone': '',
        })
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['status'], 'pending_payment')
        self.assertIsNotNone(resp.data['berth'])
        self.assertIn('checkout_url', resp.data)

    @patch('apps.reservations.views.stripe')
    def test_mode_b_returns_409_when_no_berth(self, mock_stripe):
        self.marina.booking_mode = 'auto_tetris'
        self.marina.save()
        # Block all compatible berths
        Booking.objects.create(
            marina=self.marina, berth=self.b,
            check_in='2026-08-01', check_out='2026-08-10',
            nights=9, status='confirmed',
        )
        resp = self.client.post('/api/v1/bookings/engine-request/', {
            'check_in': '2026-08-02',
            'check_out': '2026-08-06',
            'boat_loa': '12.0',
            'boat_beam': '4.0',
            'guest_name': 'C. Yachtsman',
            'guest_email': 'c@sea.com',
            'guest_phone': '',
        })
        self.assertEqual(resp.status_code, 409)


class AssignBerthEndpointTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.berth = make_berth_with_dims(self.marina, 'AS1', loa=20.0, beam=6.0, price=75)
        self.booking = Booking.objects.create(
            marina=self.marina,
            check_in='2026-09-01',
            check_out='2026-09-04',
            nights=3,
            status='pending_approval',
            boat_loa=12.0,
            boat_beam=4.0,
            guest_name='D. Boater',
            guest_email='d@sea.com',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    @patch('apps.reservations.views.stripe')
    @patch('apps.reservations.views.send_mail')
    def test_assign_berth_updates_status_and_creates_invoice(self, mock_mail, mock_stripe):
        mock_session = MagicMock()
        mock_session.id = 'cs_test_assign'
        mock_session.url = 'https://checkout.stripe.com/assign'
        mock_stripe.checkout.Session.create.return_value = mock_session

        resp = self.client.post(f'/api/v1/bookings/{self.booking.id}/assign-berth/', {
            'berth_id': self.berth.id,
        })
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, 'awaiting_payment')
        self.assertEqual(self.booking.berth, self.berth)
        from apps.billing.models import Invoice
        self.assertTrue(Invoice.objects.filter(booking=self.booking).exists())
        self.assertTrue(mock_mail.called)

    @patch('apps.reservations.views.stripe')
    @patch('apps.reservations.views.send_mail')
    def test_assign_berth_rejects_incompatible_berth(self, mock_mail, mock_stripe):
        small_berth = make_berth_with_dims(self.marina, 'AS2', loa=5.0, beam=2.0)
        resp = self.client.post(f'/api/v1/bookings/{self.booking.id}/assign-berth/', {
            'berth_id': small_berth.id,
        })
        self.assertEqual(resp.status_code, 400)

    def test_assign_berth_rejects_non_pending_approval_booking(self):
        self.booking.status = 'confirmed'
        self.booking.save()
        resp = self.client.post(f'/api/v1/bookings/{self.booking.id}/assign-berth/', {
            'berth_id': self.berth.id,
        })
        self.assertEqual(resp.status_code, 400)


class StripeWebhookTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.berth = make_berth_with_dims(self.marina, 'WH1', loa=20.0, beam=6.0)
        self.booking = Booking.objects.create(
            marina=self.marina, berth=self.berth,
            check_in='2026-10-01', check_out='2026-10-05',
            nights=4, amount='300.00',
            status='pending_payment',
            stripe_session_id='cs_test_webhook',
            guest_name='E. Sailor',
        )
        from apps.billing.models import Invoice
        import datetime
        self.invoice = Invoice.objects.create(
            marina=self.marina,
            booking=self.booking,
            invoice_type='berth_fee',
            amount='300.00',
            issued=datetime.date.today(),
            due=datetime.date.today(),
            status='unpaid',
        )

    @patch('apps.reservations.views.stripe')
    def test_webhook_confirms_booking_and_marks_invoice_paid(self, mock_stripe):
        event_data = {
            'type': 'checkout.session.completed',
            'data': {'object': {
                'id': 'cs_test_webhook',
                'metadata': {'booking_id': str(self.booking.id)},
                'payment_status': 'paid',
            }},
        }
        mock_stripe.Webhook.construct_event.return_value = event_data

        resp = self.client.post(
            '/api/v1/bookings/stripe-webhook/',
            data=json.dumps(event_data),
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='t=123,v1=abc',
        )
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, 'confirmed')
        self.assertTrue(self.booking.paid)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, 'paid')

    @patch('apps.reservations.views.stripe')
    def test_webhook_rejects_invalid_signature(self, mock_stripe):
        import stripe as stripe_lib
        mock_stripe.Webhook.construct_event.side_effect = stripe_lib.error.SignatureVerificationError('bad sig', 'sig_header')
        resp = self.client.post(
            '/api/v1/bookings/stripe-webhook/',
            data='{}',
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='bad',
        )
        self.assertEqual(resp.status_code, 400)
```

- [ ] **Step 2: Run endpoint tests to confirm they fail**

```bash
cd backend
python manage.py test apps.reservations.tests.AvailableBerthsEndpointTest apps.reservations.tests.BookingEngineRequestEndpointTest apps.reservations.tests.AssignBerthEndpointTest apps.reservations.tests.StripeWebhookTest --settings=config.settings.dev -v 2
```

Expected: all fail with `404` or `AttributeError`. This is correct.

---

### Task 7: Implement views, serializers, URLs (tests green)

**Files:**
- Modify: `backend/apps/reservations/serializers.py`
- Modify: `backend/apps/reservations/views.py`
- Modify: `backend/apps/reservations/urls.py`

- [ ] **Step 1: Replace serializers.py**

```python
# backend/apps/reservations/serializers.py
from rest_framework import serializers
from .models import Booking, BookingRequest


class BookingSerializer(serializers.ModelSerializer):
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, default=None)
    berth_code  = serializers.CharField(source='berth.code',  read_only=True, default=None)
    owner_name  = serializers.CharField(source='vessel.owner.name', read_only=True, default=None)

    class Meta:
        model = Booking
        fields = [
            'id', 'berth', 'berth_code', 'vessel', 'vessel_name', 'owner_name',
            'booking_type', 'check_in', 'check_out', 'nights', 'amount',
            'status', 'paid', 'notes',
            'guest_name', 'guest_email', 'guest_phone',
            'boat_loa', 'boat_beam', 'stripe_session_id',
            'created_at',
        ]
        read_only_fields = [
            'id', 'vessel_name', 'berth_code', 'owner_name',
            'nights', 'amount', 'stripe_session_id', 'created_at',
        ]


class BookingEngineRequestSerializer(serializers.Serializer):
    check_in   = serializers.DateField()
    check_out  = serializers.DateField()
    boat_loa   = serializers.DecimalField(max_digits=6, decimal_places=2, required=False, allow_null=True)
    boat_beam  = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    guest_name  = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')
    guest_email = serializers.EmailField(required=False, allow_blank=True, default='')
    guest_phone = serializers.CharField(max_length=50, required=False, allow_blank=True, default='')

    def validate(self, data):
        if data['check_out'] <= data['check_in']:
            raise serializers.ValidationError('check_out must be after check_in.')
        return data


class AssignBerthSerializer(serializers.Serializer):
    berth_id = serializers.IntegerField()


class BookingRequestSerializer(serializers.ModelSerializer):
    member_name = serializers.CharField(source='member.name', read_only=True, default=None)
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, default=None)
    berth_code  = serializers.CharField(source='berth.code',  read_only=True)
    booking_id  = serializers.PrimaryKeyRelatedField(source='booking', read_only=True)

    class Meta:
        model = BookingRequest
        fields = [
            'id', 'member', 'member_name', 'vessel', 'vessel_name',
            'guest_name', 'guest_phone', 'guest_email', 'guest_vessel', 'guest_loa',
            'berth', 'berth_code', 'booking_type', 'start_date', 'end_date', 'notes',
            'status', 'booking_id', 'created_at',
        ]
        read_only_fields = ['id', 'member_name', 'vessel_name', 'berth_code', 'booking_id', 'created_at']
```

- [ ] **Step 2: Replace views.py**

```python
# backend/apps/reservations/views.py
import stripe
from stripe.error import SignatureVerificationError as StripeSignatureError
from django.conf import settings
from django.core.mail import send_mail
from django.http import HttpResponse
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from rest_framework import generics, serializers as drf_serializers, status as http_status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework.filters import SearchFilter

from apps.berths.models import Berth
from apps.billing.models import Invoice
from .booking_engine import (
    NoAvailableBerthError,
    compatible_available_berths,
    create_manual_approval,
    run_tetris,
)
from .models import Booking, BookingRequest
from .serializers import (
    AssignBerthSerializer,
    BookingEngineRequestSerializer,
    BookingRequestSerializer,
    BookingSerializer,
)

import datetime

stripe.api_key = settings.STRIPE_SECRET_KEY


# ── Existing CRUD views ────────────────────────────────────────────────────────

class BookingListCreateView(generics.ListCreateAPIView):
    serializer_class = BookingSerializer
    filter_backends = [DjangoFilterBackend, SearchFilter]
    filterset_fields = ['status', 'booking_type', 'paid']
    search_fields = ['vessel__name', 'berth__code', 'guest_name']

    def get_queryset(self):
        return Booking.objects.filter(marina=self.request.user.marina).select_related(
            'vessel', 'vessel__owner', 'berth'
        )

    def perform_create(self, serializer):
        check_in  = serializer.validated_data['check_in']
        check_out = serializer.validated_data['check_out']
        berth     = serializer.validated_data.get('berth')
        nights    = (check_out - check_in).days or 1
        price     = berth.price_per_night if berth else None
        amount    = (price * nights) if price is not None else None
        serializer.save(marina=self.request.user.marina, nights=nights, amount=amount)


class BookingDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = BookingSerializer

    def get_queryset(self):
        return Booking.objects.filter(marina=self.request.user.marina)


class BookingRequestListCreateView(generics.ListCreateAPIView):
    serializer_class = BookingRequestSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['status', 'booking_type']

    def get_queryset(self):
        return BookingRequest.objects.filter(marina=self.request.user.marina).select_related(
            'member', 'vessel', 'berth', 'booking'
        )

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class BookingRequestDetailView(generics.RetrieveUpdateAPIView):
    serializer_class = BookingRequestSerializer

    def get_queryset(self):
        return BookingRequest.objects.filter(marina=self.request.user.marina)


class ConvertBookingRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            req = BookingRequest.objects.get(pk=pk, marina=request.user.marina)
        except BookingRequest.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        if req.status == 'rejected':
            return Response({'detail': 'Cannot convert a rejected request.'}, status=http_status.HTTP_400_BAD_REQUEST)

        booking = req.convert_to_booking()
        return Response(BookingSerializer(booking).data, status=http_status.HTTP_200_OK)


# ── Booking Engine views ───────────────────────────────────────────────────────

class AvailableBerthsView(APIView):
    """GET /api/v1/bookings/available-berths/ — returns compatible berths with gap scores."""

    def get(self, request):
        check_in = request.query_params.get('check_in')
        check_out = request.query_params.get('check_out')
        if not check_in or not check_out:
            return Response({'detail': 'check_in and check_out are required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        boat_loa = request.query_params.get('boat_loa') or None
        boat_beam = request.query_params.get('boat_beam') or None

        berths = compatible_available_berths(
            marina=request.user.marina,
            check_in=check_in,
            check_out=check_out,
            boat_loa=float(boat_loa) if boat_loa else None,
            boat_beam=float(boat_beam) if boat_beam else None,
        )

        from apps.berths.serializers import BerthSerializer
        return Response(BerthSerializer(berths, many=True).data)


class BookingEngineRequestView(APIView):
    """
    POST /api/v1/bookings/engine-request/
    Boater submits a booking request. Branches on marina.booking_mode.
    Mode A → pending_approval (no berth, no payment yet).
    Mode B → pending_payment (berth assigned, Stripe checkout URL returned).
    """

    def post(self, request):
        ser = BookingEngineRequestSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=http_status.HTTP_400_BAD_REQUEST)

        d = ser.validated_data
        marina = request.user.marina

        if marina.booking_mode == 'manual_approval':
            booking = create_manual_approval(
                marina=marina,
                check_in=d['check_in'],
                check_out=d['check_out'],
                boat_loa=d.get('boat_loa'),
                boat_beam=d.get('boat_beam'),
                guest_name=d.get('guest_name', ''),
                guest_email=d.get('guest_email', ''),
                guest_phone=d.get('guest_phone', ''),
            )
            return Response(BookingSerializer(booking).data, status=http_status.HTTP_201_CREATED)

        # Mode B: auto_tetris
        try:
            booking = run_tetris(
                marina=marina,
                check_in=d['check_in'],
                check_out=d['check_out'],
                boat_loa=d.get('boat_loa'),
                boat_beam=d.get('boat_beam'),
                guest_name=d.get('guest_name', ''),
                guest_email=d.get('guest_email', ''),
                guest_phone=d.get('guest_phone', ''),
            )
        except NoAvailableBerthError as e:
            return Response({'detail': str(e)}, status=http_status.HTTP_409_CONFLICT)

        # Create invoice and Stripe Checkout Session
        invoice = Invoice.objects.create(
            marina=marina,
            booking=booking,
            invoice_type='berth_fee',
            amount=booking.amount or 0,
            issued=datetime.date.today(),
            due=datetime.date.today(),
            status='unpaid',
        )

        checkout_url = _create_stripe_session(booking, marina)

        data = BookingSerializer(booking).data
        data['checkout_url'] = checkout_url
        return Response(data, status=http_status.HTTP_201_CREATED)


class AssignBerthView(APIView):
    """
    POST /api/v1/bookings/<pk>/assign-berth/
    Admin assigns a berth to a pending_approval booking.
    Validates physical compatibility, creates Invoice, fires Stripe Checkout link via email.
    """

    def post(self, request, pk):
        try:
            booking = Booking.objects.get(pk=pk, marina=request.user.marina)
        except Booking.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        if booking.status != 'pending_approval':
            return Response({'detail': 'Only pending_approval bookings can be assigned a berth.'}, status=http_status.HTTP_400_BAD_REQUEST)

        ser = AssignBerthSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=http_status.HTTP_400_BAD_REQUEST)

        try:
            berth = Berth.objects.get(pk=ser.validated_data['berth_id'], marina=request.user.marina)
        except Berth.DoesNotExist:
            return Response({'detail': 'Berth not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        # Validate physical compatibility
        if booking.boat_loa and berth.length_m and berth.length_m < booking.boat_loa:
            return Response({'detail': 'Berth is too short for this boat.'}, status=http_status.HTTP_400_BAD_REQUEST)
        if booking.boat_beam and berth.max_beam_m and berth.max_beam_m < booking.boat_beam:
            return Response({'detail': 'Berth beam limit too narrow for this boat.'}, status=http_status.HTTP_400_BAD_REQUEST)

        nights = booking.nights or 1
        price = berth.price_per_night
        amount = (price * nights) if price is not None else 0

        booking.berth = berth
        booking.amount = amount
        booking.status = 'awaiting_payment'
        booking.save(update_fields=['berth', 'amount', 'status'])

        Invoice.objects.create(
            marina=request.user.marina,
            booking=booking,
            invoice_type='berth_fee',
            amount=amount,
            issued=datetime.date.today(),
            due=datetime.date.today() + datetime.timedelta(days=request.user.marina.payment_terms),
            status='unpaid',
        )

        checkout_url = _create_stripe_session(booking, request.user.marina)

        if booking.guest_email:
            send_mail(
                subject=f'Your DocksBase Booking — Pay Now',
                message=(
                    f"Hello {booking.guest_name or 'there'},\n\n"
                    f"Your berth ({berth.code}) has been assigned for "
                    f"{booking.check_in} – {booking.check_out}.\n\n"
                    f"Please complete payment here:\n{checkout_url}"
                ),
                from_email=settings.DEFAULT_FROM_EMAIL,
                recipient_list=[booking.guest_email],
                fail_silently=False,
            )

        return Response(BookingSerializer(booking).data, status=http_status.HTTP_200_OK)


@method_decorator(csrf_exempt, name='dispatch')
class StripeWebhookView(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []

    def post(self, request):
        payload = request.body
        sig_header = request.META.get('HTTP_STRIPE_SIGNATURE', '')

        try:
            event = stripe.Webhook.construct_event(payload, sig_header, settings.STRIPE_WEBHOOK_SECRET)
        except (ValueError, StripeSignatureError):
            return HttpResponse(status=400)

        if event['type'] == 'checkout.session.completed':
            session = event['data']['object']
            booking_id = session.get('metadata', {}).get('booking_id')
            if booking_id:
                try:
                    booking = Booking.objects.get(id=booking_id)
                    booking.status = 'confirmed'
                    booking.paid = True
                    booking.save(update_fields=['status', 'paid'])
                    Invoice.objects.filter(booking=booking).update(status='paid')
                except Booking.DoesNotExist:
                    pass

        return HttpResponse(status=200)


# ── Helper ─────────────────────────────────────────────────────────────────────

def _create_stripe_session(booking, marina):
    """Create a Stripe Checkout Session for a booking; save session ID; return checkout URL."""
    nights_label = f'{booking.nights} night{"s" if booking.nights != 1 else ""}'
    berth_code = booking.berth.code if booking.berth else 'TBD'
    session = stripe.checkout.Session.create(
        payment_method_types=['card'],
        line_items=[{
            'price_data': {
                'currency': marina.currency.lower(),
                'product_data': {'name': f'Berth {berth_code} — {nights_label}'},
                'unit_amount': int((booking.amount or 0) * 100),
            },
            'quantity': 1,
        }],
        mode='payment',
        success_url=f'{settings.FRONTEND_URL}/booking/success?session_id={{CHECKOUT_SESSION_ID}}',
        cancel_url=f'{settings.FRONTEND_URL}/booking/cancelled',
        metadata={'booking_id': str(booking.id)},
    )
    booking.stripe_session_id = session.id
    booking.save(update_fields=['stripe_session_id'])
    return session.url
```

- [ ] **Step 3: Replace urls.py**

```python
# backend/apps/reservations/urls.py
from django.urls import path
from .views import (
    BookingListCreateView, BookingDetailView,
    BookingRequestListCreateView, BookingRequestDetailView,
    ConvertBookingRequestView,
    AvailableBerthsView,
    BookingEngineRequestView,
    AssignBerthView,
    StripeWebhookView,
)

urlpatterns = [
    # Booking engine (must precede <int:pk> patterns to avoid any routing ambiguity)
    path('bookings/available-berths/',              AvailableBerthsView.as_view(),          name='available_berths'),
    path('bookings/engine-request/',                BookingEngineRequestView.as_view(),     name='booking_engine_request'),
    path('bookings/stripe-webhook/',                StripeWebhookView.as_view(),            name='stripe_webhook'),
    # Existing CRUD
    path('bookings/',                               BookingListCreateView.as_view(),        name='booking_list'),
    path('bookings/<int:pk>/',                      BookingDetailView.as_view(),            name='booking_detail'),
    path('bookings/<int:pk>/assign-berth/',         AssignBerthView.as_view(),              name='assign_berth'),
    path('booking-requests/',                       BookingRequestListCreateView.as_view(), name='booking_request_list'),
    path('booking-requests/<int:pk>/',              BookingRequestDetailView.as_view(),     name='booking_request_detail'),
    path('booking-requests/<int:pk>/convert/',      ConvertBookingRequestView.as_view(),    name='booking_request_convert'),
]
```

- [ ] **Step 4: Run all endpoint + engine tests**

```bash
cd backend
python manage.py test apps.reservations --settings=config.settings.dev -v 2
```

Expected: all tests pass. If `AvailableBerthsView` fails because `BerthSerializer` is missing fields, open `apps/berths/serializers.py`, confirm it has `id`, `code`, `length_m`, `max_beam_m`, `price_per_night` in its fields list — add any missing ones.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/reservations/serializers.py backend/apps/reservations/views.py backend/apps/reservations/urls.py
git commit -m "feat(booking-engine): AvailableBerthsView, BookingEngineRequestView, AssignBerthView, StripeWebhookView"
```

---

### Task 8: Run full test suite

- [ ] **Step 1: Run all tests**

```bash
cd backend
python manage.py test --settings=config.settings.dev -v 2
```

Expected: all tests pass including existing staff, documents, and reservations suites.

- [ ] **Step 2: Django system check**

```bash
python manage.py check --settings=config.settings.dev
```

Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 3: Commit if anything was fixed**

If you had to fix any failures, commit now:

```bash
git add -A
git commit -m "fix(booking-engine): resolve test failures from full suite run"
```

---

### Task 9: Frontend — `useBookingEngine.js` hook

**Files:**
- Create: `frontend/src/hooks/useBookingEngine.js`

- [ ] **Step 1: Create useBookingEngine.js**

```javascript
// frontend/src/hooks/useBookingEngine.js
import api from '../api.js';

export default function useBookingEngine() {
  async function checkAvailability({ checkIn, checkOut, boatLoa, boatBeam }) {
    const params = { check_in: checkIn, check_out: checkOut };
    if (boatLoa) params.boat_loa = boatLoa;
    if (boatBeam) params.boat_beam = boatBeam;
    const { data } = await api.get('/bookings/available-berths/', { params });
    return data;
  }

  async function submitRequest({ checkIn, checkOut, boatLoa, boatBeam, guestName, guestEmail, guestPhone }) {
    const { data } = await api.post('/bookings/engine-request/', {
      check_in: checkIn,
      check_out: checkOut,
      boat_loa: boatLoa || null,
      boat_beam: boatBeam || null,
      guest_name: guestName || '',
      guest_email: guestEmail || '',
      guest_phone: guestPhone || '',
    });
    return data;
  }

  return { checkAvailability, submitRequest };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/hooks/useBookingEngine.js
git commit -m "feat(booking-engine): add useBookingEngine hook"
```

---

### Task 10: Frontend — `useBookings.js` assign-berth action

**Files:**
- Modify: `frontend/src/hooks/useBookings.js`

- [ ] **Step 1: Read current useBookings.js**

Open `frontend/src/hooks/useBookings.js` and locate the returned object at the bottom of the hook.

- [ ] **Step 2: Add `assignBerth` function**

Before the `return` statement, add:

```javascript
  async function assignBerth(bookingId, berthId) {
    const { data } = await api.post(`/bookings/${bookingId}/assign-berth/`, { berth_id: berthId });
    setBookings(prev => prev.map(b => b.id === bookingId ? data : b));
    return data;
  }
```

Add `assignBerth` to the hook's return object.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useBookings.js
git commit -m "feat(booking-engine): add assignBerth to useBookings hook"
```

---

### Task 11: Frontend — Pending Approvals tab in Reservations.jsx

**Files:**
- Modify: `frontend/src/screens/Reservations.jsx`

- [ ] **Step 1: Add `pending_approvals` to the filter map and tabs array**

Open `frontend/src/screens/Reservations.jsx`. Find:

```javascript
const filterMap = {
  all:       {},
  transient: { booking_type: 'transient' },
  seasonal:  { booking_type: 'seasonal' },
  pending:   { status: 'pending' },
  overdue:   { status: 'overstay' },
};

const bookingTabs = ['all', 'transient', 'seasonal', 'pending', 'overdue'];
```

Replace with:

```javascript
const filterMap = {
  all:              {},
  transient:        { booking_type: 'transient' },
  seasonal:         { booking_type: 'seasonal' },
  pending_approval: { status: 'pending_approval' },
  pending:          { status: 'pending' },
  overdue:          { status: 'overstay' },
};

const bookingTabs = ['all', 'transient', 'seasonal', 'pending_approval', 'pending', 'overdue'];
```

- [ ] **Step 2: Add `AssignBerthModal` component**

After the last modal definition (before the main component) in `Reservations.jsx`, add:

```jsx
function AssignBerthModal({ booking, berths, onClose, onAssign }) {
  const compatible = berths.filter(b => {
    if (booking.boat_loa && b.length_m && parseFloat(b.length_m) < parseFloat(booking.boat_loa)) return false;
    if (booking.boat_beam && b.max_beam_m && parseFloat(b.max_beam_m) < parseFloat(booking.boat_beam)) return false;
    return true;
  });
  const [selectedBerth, setSelectedBerth] = useState('');
  const [saving, setSaving] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (!selectedBerth) return;
    setSaving(true);
    try {
      await onAssign(booking.id, parseInt(selectedBerth));
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-hdr">
          <span className="modal-title">Assign Berth</span>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><Ic n="x" s={13}/></button>
        </div>
        <div style={{ fontSize: 12, marginBottom: 10, color: 'rgba(0,0,0,0.5)' }}>
          {booking.guest_name} · LOA {booking.boat_loa || '?'}m · {booking.check_in} – {booking.check_out}
        </div>
        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label className="field-label">Compatible Berth
            <select className="input" value={selectedBerth} onChange={e => setSelectedBerth(e.target.value)} required>
              <option value="">Select berth…</option>
              {compatible.map(b => (
                <option key={b.id} value={b.id}>{b.code} — {b.length_m}m · €{b.price_per_night}/night</option>
              ))}
            </select>
          </label>
          {compatible.length === 0 && <p style={{ fontSize: 12, color: 'var(--red)' }}>No compatible berths available.</p>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving || !selectedBerth}>{saving ? 'Assigning…' : 'Assign & Send Invoice'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire the modal into the Reservations component**

Inside the main Reservations component, add state for the assign modal and wire it up:

Find the destructured hook values near the top of the component:
```javascript
const { bookings, loading, ... } = useBookings(...);
```

After that line add:
```javascript
const { berths } = useBerths();
const { assignBerth } = useBookings();
const [assignModal, setAssignModal] = useState(null); // booking object or null
```

Add the modal to the render section (alongside other modals at the top of the return):
```jsx
{assignModal && (
  <AssignBerthModal
    booking={assignModal}
    berths={berths}
    onClose={() => setAssignModal(null)}
    onAssign={assignBerth}
  />
)}
```

In the bookings table rows, add an "Assign" button that only shows for `pending_approval` bookings:
```jsx
{b.status === 'pending_approval' && (
  <button
    className="btn btn-primary btn-sm"
    style={{ fontSize: 11 }}
    onClick={e => { e.stopPropagation(); setAssignModal(b); }}
  >
    Assign Berth
  </button>
)}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screens/Reservations.jsx frontend/src/hooks/useBookings.js
git commit -m "feat(booking-engine): Pending Approvals tab, AssignBerthModal in Reservations.jsx"
```

---

### Task 12: Final smoke test + overall commit

- [ ] **Step 1: Run full backend test suite**

```bash
cd backend
python manage.py test --settings=config.settings.dev -v 2
```

Expected: all tests pass, 0 errors.

- [ ] **Step 2: Django system check**

```bash
python manage.py check --settings=config.settings.dev
```

Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 3: Final overall commit**

```bash
git add -A
git commit -m "feat(booking-engine): complete booking engine — Mode A manual approval, Mode B gap-minimisation, Stripe webhook, admin assign-berth UI"
```
