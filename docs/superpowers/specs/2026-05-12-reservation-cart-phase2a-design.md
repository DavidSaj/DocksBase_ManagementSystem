# Reservation Cart — Phase 2A: Portal Booking API (Reservation-Native)
**Date:** 2026-05-12
**Scope:** Replace the single-Booking public booking endpoints with a Reservation-native multi-slot cart flow. New endpoints create a `Reservation` + `ReservationItem` children. Existing single-booking endpoints remain untouched (deprecated in Phase 2D).

---

## 1. Core Principles

**One Cart = One Trip.** The parent `Reservation` represents a single physical event — a trip with one global `check_in` and `check_out`. All `ReservationItem` children share those dates. A boater wanting two trips on different dates performs two separate checkouts. This keeps the waiver lifecycle, check-in state machine, and billing engine coherent.

**Inventory before money.** The tetris algorithm runs and inventory is locked inside the database transaction *before* the Stripe PaymentIntent is created. A payment can never succeed for inventory that doesn't exist.

**6-Letter Reference.** The `RES-{pk}` string on the Reservation is the boater's airline-style Passenger Name Record. Guest auth uses Email + `RES-{pk}`. The existing `guest-instant/` endpoint is extended to accept this format alongside `BK-{pk}`.

---

## 2. Data Model Changes

One migration adds three things to the existing Phase 1 models.

### 2.1 `Reservation` — two new status values

Add to `STATUS_CHOICES`:
```python
('pending_checkout', 'Pending Checkout'),   # tetris ran, inventory locked, awaiting Stripe
('abandoned',        'Abandoned'),           # lock expired, inventory released
```

### 2.2 `Reservation.locked_until`

```python
locked_until = models.DateTimeField(null=True, blank=True)
```

Set to `timezone.now() + timedelta(minutes=15)` when status transitions to `pending_checkout`. The expiry sweep checks this field.

### 2.3 `ReservationItem.status`

```python
status = models.CharField(
    max_length=20,
    choices=[
        ('locked',    'Locked'),     # tetris assigned, awaiting payment
        ('confirmed', 'Confirmed'),  # payment received
        ('released',  'Released'),   # reservation abandoned, slot free again
    ],
    default='confirmed',
)
```

Default `confirmed` means all existing backfilled items (from Phase 1) remain valid without a data migration.

---

## 3. Booking Engine: `assign_berth()`

New function in `booking_engine.py`. Runs the same scoring logic as `run_tetris` but returns `(berth, Decimal price)` instead of creating a `Booking`. Must be called inside an outer `transaction.atomic()` — the `intent/` view owns the transaction.

```python
def assign_berth(marina, check_in, check_out, boat_loa, boat_beam=None,
                 boat_draft=None, berth_category=None):
    """
    Select and lock the best available berth for one cart item.
    Returns (berth, price_per_night * nights) as Decimal.
    Raises NoAvailableBerthError if nothing fits.

    MUST be called inside an outer transaction.atomic() — the row-level
    select_for_update() lock is held only until that outer transaction commits.
    """
```

**Collision check covers both old and new systems:**
```python
# Legacy Booking collision
booking_conflict = Booking.objects.filter(
    berth=berth,
    status__in=ACTIVE_STATUSES,
    check_in__lt=check_out,
    check_out__gt=check_in,
).exists()

# New ReservationItem collision (locked or confirmed slots)
item_conflict = ReservationItem.objects.filter(
    berth=berth,
    status__in=['locked', 'confirmed'],
    check_in__lt=check_out,
    check_out__gt=check_in,
).exists()

if booking_conflict or item_conflict:
    continue
```

---

## 4. API Endpoints

Both endpoints live in `backend/apps/reservations/public_reservation_views.py` and are mounted in `backend/apps/portal/public_urls.py`.

### 4.1 `POST /api/v1/public/reservations/intent/`

**Auth:** `AllowAny` — uses `X-Marina-Slug` header for tenant resolution (same pattern as existing public endpoints).

**Request body:**
```json
{
  "check_in": "2026-07-04",
  "check_out": "2026-07-07",
  "guest_name": "John Smith",
  "guest_email": "john@example.com",
  "guest_phone": "555-1234",
  "items": [
    {
      "berth_category_id": 1,
      "boat_loa": 12.5,
      "boat_beam": 4.2,
      "boat_draft": 1.8,
      "vessel_name": "Sea Breeze"
    },
    {
      "berth_category_id": null,
      "boat_loa": 10.0,
      "boat_beam": 3.5,
      "boat_draft": 1.5,
      "vessel_name": "Wind Chaser"
    }
  ]
}
```

`guest_phone`, `boat_beam`, `boat_draft`, `vessel_name` are optional. `berth_category_id: null` means unassigned standard berths (same logic as existing `intent/` endpoint). `items` must have at least 1 entry.

**Execution sequence (all inside one `transaction.atomic()`):**
1. Validate input. Check `marina.booking_mode == 'auto_tetris'`.
2. For each item: call `assign_berth()`. If any raises `NoAvailableBerthError` → the whole transaction rolls back. Return 409 with which vessel couldn't be placed.
3. Create `Reservation(status='pending_checkout', locked_until=now+15min, guest_name=..., guest_email=..., guest_phone=..., marina=..., booking_source='portal')`.
4. For each assigned `(berth, price)`: create `ReservationItem(status='locked', berth=berth, check_in=..., check_out=..., nights=..., item_price=price, boat_loa=..., vessel_name=...)`.
5. Set `reservation.total_price = sum(item.item_price for item in items)`. Save.
6. Create Stripe PaymentIntent via `billing_service.create_payment_intent()` with `metadata={'reservation_id': str(reservation.pk)}`.
7. Save `reservation.stripe_payment_intent_id`. Save.
8. Return 201.

**Response 201:**
```json
{
  "reservation_id": 42,
  "client_secret": "pi_abc123_secret_xyz",
  "total": "450.00",
  "locked_until": "2026-07-04T14:30:00Z",
  "items": [
    {"berth_code": "A12", "nights": 3, "item_price": "225.00"},
    {"berth_code": "B07", "nights": 3, "item_price": "225.00"}
  ]
}
```

**Response 409:**
```json
{"detail": "No available berth for vessel 'Wind Chaser' on those dates."}
```

### 4.2 `POST /api/v1/public/reservations/confirm/`

**Auth:** `AllowAny`.

**Request body:**
```json
{
  "reservation_id": 42,
  "payment_intent_id": "pi_abc123"
}
```

**Execution sequence:**
1. Look up `Reservation` by `id=reservation_id` AND `stripe_payment_intent_id=payment_intent_id`. Return 404 if not found (prevents ID-guessing attacks — a caller must possess both values).
2. If `reservation.status == 'confirmed'` → return 200 immediately (idempotent).
3. If `reservation.status == 'abandoned'` → return 409 `"This reservation has expired. Please start a new booking."`.
4. Query Stripe: verify `PaymentIntent.status == 'succeeded'` on the marina's connected account. If not yet succeeded → return 402 `"Payment not yet confirmed."`.
5. In a `transaction.atomic()`:
   - `Reservation.objects.filter(pk=..., status='pending_checkout').update(status='confirmed', paid=True)`
   - `ReservationItem.objects.filter(reservation=reservation, status='locked').update(status='confirmed')`
6. Call `send_reservation_confirmed_email(reservation)`.
7. Return 200.

**Response 200:**
```json
{
  "reservation_id": 42,
  "status": "confirmed",
  "reference": "RES-42",
  "guest_name": "John Smith",
  "check_in": "2026-07-04",
  "check_out": "2026-07-07"
}
```

---

## 5. Stripe Webhook Extension

File: `backend/apps/billing/views.py` — `StripeConnectWebhookView`.

The current `payment_intent.succeeded` handler requires `invoice_id` in metadata. Add a branch before the `invoice_id` lookup:

```python
reservation_id = obj.get('metadata', {}).get('reservation_id')
if reservation_id:
    _handle_reservation_payment_succeeded(obj, reservation_id)
    return HttpResponse(status=200)
```

New private function `_handle_reservation_payment_succeeded(obj, reservation_id)`:
```python
def _handle_reservation_payment_succeeded(obj, reservation_id):
    from apps.reservations.models import Reservation, ReservationItem
    from apps.reservations.emails import send_reservation_confirmed_email
    updated = Reservation.objects.filter(
        pk=reservation_id, status='pending_checkout'
    ).update(status='confirmed', paid=True)
    if updated:
        ReservationItem.objects.filter(
            reservation_id=reservation_id, status='locked'
        ).update(status='confirmed')
        try:
            res = Reservation.objects.get(pk=reservation_id)
            send_reservation_confirmed_email(res)
        except Exception:
            logger.exception('Webhook: failed to send reservation confirmation email')
```

If `status` is already `confirmed` (client already called `/confirm/`) the `.filter(..., status='pending_checkout').update(...)` returns 0 rows — no-op. Safe.

---

## 6. Expiry Sweep

File: `backend/apps/reservations/management/commands/expire_reservations.py`

```python
class Command(BaseCommand):
    help = 'Release inventory for abandoned pending_checkout reservations'

    def handle(self, *args, **options):
        cutoff = timezone.now()
        stale = Reservation.objects.filter(
            status='pending_checkout',
            locked_until__lt=cutoff,
        )
        count = stale.count()
        ReservationItem.objects.filter(
            reservation__in=stale,
            status='locked',
        ).update(status='released')
        stale.update(status='abandoned')
        self.stdout.write(f'Expired {count} reservation(s).')
```

Called via Celery beat every 5 minutes:
```python
# celery.py beat schedule addition
'expire-reservations': {
    'task': 'apps.reservations.tasks.expire_reservations',
    'schedule': crontab(minute='*/5'),
},
```

Or via cron: `*/5 * * * * python manage.py expire_reservations`.

---

## 7. Confirmation Email

New function in `backend/apps/reservations/emails.py`:

```python
def send_reservation_confirmed_email(reservation):
    """
    Sends booking confirmation to reservation.guest_email with:
    - The RES-{pk} booking reference (prominent, airline-style)
    - Check-in / check-out dates
    - Per-berth summary (berth code, vessel name, price)
    - Magic link: portal.{marina.domain}/auth?token=...&ref=RES-{pk}
    """
```

The magic link pre-authenticates the boater into the exact Reservation on the portal — no reference lookup required when they click from email.

---

## 8. Guest Auth Extension

File: `backend/apps/portal/checkin_views.py` (or wherever `guest-instant/` is implemented).

The existing `booking_reference` parser handles `BK-{pk}`. Extend it to also match `RES-{pk}`:

```python
def _resolve_booking_reference(reference, marina):
    """Returns (booking, reservation) — exactly one will be non-None."""
    if reference.startswith('BK-'):
        try:
            pk = int(reference[3:])
            return Booking.objects.get(pk=pk, marina=marina), None
        except (ValueError, Booking.DoesNotExist):
            return None, None
    if reference.startswith('RES-'):
        try:
            pk = int(reference[4:])
            return None, Reservation.objects.get(pk=pk, marina=marina)
        except (ValueError, Reservation.DoesNotExist):
            return None, None
    return None, None
```

When the reference resolves to a `Reservation`:
- Email match is checked against `reservation.guest_email`
- Token payload carries `{'reservation_id': reservation.pk}` (not `booking_id`)
- Response includes `reservation_id` and `marina_slug`

---

## 9. File Map

| Action | File |
|--------|------|
| Create | `backend/apps/reservations/public_reservation_views.py` |
| Create | `backend/apps/reservations/management/__init__.py` |
| Create | `backend/apps/reservations/management/commands/__init__.py` |
| Create | `backend/apps/reservations/management/commands/expire_reservations.py` |
| Create | `backend/apps/reservations/migrations/0017_reservation_checkout_fields.py` |
| Modify | `backend/apps/reservations/models.py` — add statuses, locked_until, ReservationItem.status |
| Modify | `backend/apps/reservations/booking_engine.py` — add assign_berth(), extend collision check |
| Modify | `backend/apps/reservations/emails.py` — add send_reservation_confirmed_email() |
| Modify | `backend/apps/portal/public_urls.py` — add two new URL patterns |
| Modify | `backend/apps/billing/views.py` — extend StripeConnectWebhookView |
| Modify | `backend/apps/portal/checkin_views.py` — extend guest-instant/ auth to accept RES-{pk} |
| Modify | `backend/apps/reservations/tests.py` — new test classes |

---

## 10. Out of Scope

- **Frontend / React changes** — the spec covers the API contract only. The frontend implementation of the cart UI, Global Date Picker, and Boarding Pass is a separate deliverable.
- **Celery infrastructure** — the management command is the deliverable. Wiring it into Celery beat is an ops task. The command can be called manually or via cron in the interim.
- **Member-authenticated cart** — this flow is guest-only for Phase 2A. Seasonal members booking via their account is Phase 2C.
- **`BerthCategory` pricing for null categories** — the `assign_berth()` function uses the same unassigned-berth pricing logic as the existing `PublicBerthIntentView` (first available unassigned berth with a pricing_tier). No new pricing logic introduced.
- **Sub-project B, C, D** — comms/loyalty migration, admin screens, and Booking deprecation are separate sub-projects.

---

## 11. Decision Log

| Decision | Choice | Reason |
|----------|--------|--------|
| One cart = one trip (same dates for all items) | Enforced | Mixed-date carts break waiver lifecycle, check-in state machine, and billing coherence |
| Inventory lock before PaymentIntent | Required | Post-payment tetris can charge for inventory that doesn't exist |
| `assign_berth()` as new function (not modifying run_tetris) | New function | run_tetris creates a Booking — the new flow must not; both must coexist during the transition period |
| 15-minute lock window | 15 min | Long enough for 3D Secure checkout; short enough to prevent permanent inventory loss on abandoned carts |
| Expiry sweep frequency | 5 min | Worst-case 5-minute inventory hold after expiry. Celery beat preferred; management command supports cron fallback |
| Confirm via client + webhook safety net | Both | Client call gives instant UX; webhook catches browser-crash edge case (paid but never confirmed) |
| Webhook branch on reservation_id key in metadata | metadata key presence | Cleanest extension of existing webhook without disrupting invoice flow |
| Guest auth extended via RES-{pk} prefix | Prefix parse | Minimal change to existing auth; BK- and RES- are unambiguous and share the same endpoint |
| Magic link in confirmation email includes ref | Deep link | Boater clicks email → straight to Boarding Pass, no reference lookup required |
