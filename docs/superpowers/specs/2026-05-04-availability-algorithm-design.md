---
title: Availability Algorithm — Spec 2: Auto-Tetris Engine Hardening
date: 2026-05-04
status: draft
---

# Availability Algorithm — Auto-Tetris Engine Hardening

## Scope

Spec 2 of 3. Harden and complete the existing `booking_engine.py` so that `auto_tetris` mode works correctly end-to-end: boat draft filtering, maintenance berth exclusion, race condition protection, and Stripe webhook auto-confirm wiring.

The scoring algorithm (gap-minimisation: prefer the berth with the least wasted time on either side) is already correct and is not changed. The portal UI for auto-tetris is out of scope — that is Spec 3.

---

## 1. Changes to `compatible_available_berths`

**File:** `apps/reservations/booking_engine.py`

Add `boat_draft` as an optional parameter alongside the existing `boat_loa` and `boat_beam`. Add `.exclude(status='maintenance')` to the base queryset.

```python
ACTIVE_STATUSES = ['awaiting_payment', 'pending_payment', 'confirmed', 'pending', 'checked_in']

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

`boat_draft` propagates through `run_tetris` and `AvailableBerthsView` with the same optional pattern.

---

## 2. Race condition fix in `run_tetris`

**File:** `apps/reservations/booking_engine.py`

The current code scores candidates in Python, picks the top result, then creates the booking. Two simultaneous requests can both score the same berth before either writes.

Fix: iterate over candidates in rank order inside `transaction.atomic()`. Lock each candidate row with `select_for_update()`, re-verify no conflicting booking exists, and book the first still-free candidate. Fall through to the next candidate if stolen.

```python
def run_tetris(marina, check_in, check_out, boat_loa, boat_beam, boat_draft,
               guest_name, guest_email, guest_phone):
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

The `transaction.atomic()` import is already available in the module.

---

## 3. Wire `inv.booking` in `BookingEngineRequestView`

**File:** `apps/reservations/views.py`

The `auto_tetris` path creates an invoice but never sets `inv.booking = booking`. Without this, `checkout.session.completed` in the Stripe webhook finds `invoice.booking_id = None` and skips the booking confirmation step — the booking is stuck in `pending_payment` forever.

Add two lines after `finalize_invoice`, before `create_stripe_checkout_session`:

```python
billing_service.finalize_invoice(inv)
inv.booking = booking          # ← new
inv.save(update_fields=['booking'])  # ← new
checkout_url = billing_service.create_stripe_checkout_session(inv)
```

The webhook already handles the rest via `_post_payment_tasks` (implemented in Phase 1).

---

## 4. Propagate `boat_draft` through the serializer and endpoint

**File:** `apps/reservations/views.py` — `BookingEngineRequestSerializer` and `AvailableBerthsView`

`BookingEngineRequestSerializer` gains:
```python
boat_draft = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
```

`BookingEngineRequestView` passes `boat_draft=d.get('boat_draft')` to both `create_manual_approval` and `run_tetris`.

`create_manual_approval` signature gains `boat_draft=None` and passes it to `Booking.objects.create(boat_draft=boat_draft, ...)`.

`AvailableBerthsView` reads `boat_draft = request.query_params.get('boat_draft') or None` and passes `float(boat_draft) if boat_draft else None` to `compatible_available_berths`.

---

## 5. Tests

**File:** `apps/reservations/tests.py` — extend existing test classes, no new file.

### `CompatibleAvailableBerthsTest` additions

| Test | Assertion |
|---|---|
| `test_draft_too_deep_excluded` | berth with `max_draft_m=1.5` excluded when `boat_draft=2.0` |
| `test_draft_fits_included` | berth with `max_draft_m=2.5` included when `boat_draft=2.0` |
| `test_maintenance_berth_excluded` | berth with `status='maintenance'` excluded regardless of dimensions and dates |

### `RunTetrisTest` additions

| Test | Assertion |
|---|---|
| `test_race_condition_falls_to_next_candidate` | With two berths ranked 1st and 2nd: mock `select_for_update().get()` to inject a conflicting booking on the 1st berth immediately before the collision check runs (simulating a concurrent commit), `run_tetris` returns the 2nd berth without raising |
| `test_boat_draft_wired_through` | berth that fails `max_draft_m` check is never selected |

The race condition test uses `unittest.mock.patch` to side-effect the database rather than spawning real threads. When `select_for_update().get(pk=berth_1.pk)` is called, the mock creates a conflicting `Booking` in the database then returns the real berth object — the subsequent `Booking.objects.filter(...).exists()` then finds the collision and the loop falls through to berth 2.

### `BookingEngineRequestViewTest` addition

| Test | Assertion |
|---|---|
| `test_auto_tetris_sets_invoice_booking_fk` | After a successful `auto_tetris` request, `Invoice.objects.get(source_id=str(booking.pk)).booking_id == booking.pk` |

### `AvailableBerthsEndpointTest` addition

| Test | Assertion |
|---|---|
| `test_boat_draft_filter` | `?boat_draft=3.0` excludes berths where `max_draft_m < 3.0` |

---

## 6. Error handling

| Scenario | Behaviour |
|---|---|
| No compatible berth (size or draft) | `NoAvailableBerthError` → 409 |
| All compatible berths stolen by concurrent requests | `NoAvailableBerthError` after exhausting ranked list → 409 |
| Berth has no `pricing_tier` | `AttributeError` caught by outer `except Exception` in view → 400 |
| Invalid dates | `ValueError` → 400 |

No new error types. The existing 409 / 400 / 503 response pattern is unchanged.

---

## 7. Concurrency scope note

The `select_for_update` lock in `run_tetris` serialises all requests that go through the booking engine. It does **not** protect against a manager creating a booking via the Django admin, because the admin bypasses the engine entirely. `create_manual_approval` always sets `berth=None` (the berth is assigned later by `ApproveBookingView`, which already holds a `select_for_update` lock from Phase 1), so that path is safe. The Django admin is the only unguarded path — acceptable for now given admin access is restricted to trusted staff.

---

## 8. No migration required

All changes are to Python logic only. `boat_draft` already exists on `Booking` (added in an earlier migration). `Berth.max_draft_m` already exists. No model fields are added or changed.
