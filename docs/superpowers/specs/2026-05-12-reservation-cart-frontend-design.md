# Reservation Cart — Phase 2B: Portal Frontend

**Date:** 2026-05-12
**Scope:** Update `BookingWizard.jsx` and `QuoteScreen.jsx` to call the new reservation cart endpoints for all marinas. Add multi-boat support to the dimensions step and per-boat category selection to the options step. Requires a small Phase 2A backend patch to support manual marinas in the intent endpoint.

---

## 1. Principles

**Unified data model.** All public bookings — auto-tetris and manual — go through `Reservation` + `ReservationItem`. The legacy `engine-request` endpoint is dead for new public traffic.

**Backend decides, frontend reacts.** `QuoteScreen` always calls `createReservationIntent()`. The response tells the frontend whether payment is required (`requires_payment: true/false`). The frontend never inspects `booking_mode`.

**Multi-boat is additive.** Single-boat is the default. "Add another boat" appends to a list. No cap on boats.

---

## 2. Required Backend Patch (Phase 2A extension)

Before the frontend can be built, `ReservationIntentView` needs two changes:

**New statuses** (migration required):
- `Reservation.STATUS_CHOICES`: add `('pending_review', 'Pending Manager Review')`
- `ReservationItem` status choices: add `('unassigned', 'Unassigned')`

**Manual marina branch in `ReservationIntentView.post()`:**

```python
if marina.booking_mode == 'manual':
    # Skip tetris and Stripe entirely
    reservation = Reservation.objects.create(
        marina=marina,
        guest_email=data['guest_email'],
        guest_name=data['guest_name'],
        check_in=data['check_in'],
        check_out=data['check_out'],
        status='pending_review',
    )
    for item_data in data['items']:
        ReservationItem.objects.create(
            reservation=reservation,
            berth=None,
            check_in=data['check_in'],
            check_out=data['check_out'],
            nights=nights,
            status='unassigned',
        )
    return Response({
        'reservation_id': reservation.pk,
        'reference': f'RES-{reservation.pk}',
        'requires_payment': False,
        'status': 'pending_review',
    }, status=201)
```

Remove the existing 409 rejection for non-auto_tetris marinas.

The auto_tetris branch is unchanged — it still runs tetris, creates the PI, and returns `requires_payment: True` with a `client_secret`.

---

## 3. Files Changed

| File | Change |
|------|--------|
| `backend/apps/reservations/public_reservation_views.py` | Add manual branch, remove 409 for non-auto_tetris |
| `backend/apps/reservations/models.py` | Add `pending_review` and `unassigned` status choices |
| `backend/apps/reservations/migrations/` | Migration for new status choices |
| `portal/api.js` | Add `createReservationIntent()` and `confirmReservation()` |
| `portal/BookingWizard.jsx` | `boat_loa/beam/draft` → `boats[]` array; multi-boat UI; per-boat category picker |
| `portal/screens/QuoteScreen.jsx` | Always call reservation endpoints; branch on `requires_payment` flag |
| `portal/screens/BookingConfirmed.jsx` | Two copy variants: confirmed vs pending_review |

---

## 4. State Shape

### Before
```js
{
  check_in: '',
  check_out: '',
  guest_name: '',
  guest_email: '',
  boat_loa: '',
  boat_beam: '',
  boat_draft: '',
  selected_category: null,
}
```

### After
```js
{
  check_in: '',
  check_out: '',
  guest_name: '',
  guest_email: '',
  boats: [
    { loa: '', beam: '', draft: '', category: null },
  ],
}
```

`boats` always has at least one entry. The wizard initialises with `[{ loa: '', beam: '', draft: '', category: null }]`.

---

## 5. Dimensions Step (search screen)

Below the existing LOA/beam/draft fields:

- When `boats.length === 1`: fields render without a label or remove button.
- When `boats.length > 1`: each boat renders with a "Boat N" label and a "Remove" button. The last remaining boat has no remove button.
- A "+ Add another boat" text link appends `{ loa: '', beam: '', draft: '', category: null }` to `boats`.
- No cap on boats.

Validation: all boats must have a non-empty LOA before advancing to the options screen.

---

## 6. Options Step (category screen)

One category picker per boat, stacked vertically:

```
Choose your berth type

Boat 1 — 45ft
[ Standard ]  [ Premium ]  [ Mega ]

Boat 2 — 15ft
[ Standard ]  [ Dinghy ]
```

- Each boat shows only categories whose `min_loa ≤ boat.loa`.
- Selecting a category sets `boats[i].category = category_id`.
- Category selection is optional — null sends `berth_category: null`, letting the backend auto-pick.
- "Continue" is enabled when all boats with available categories have one selected, or the guest explicitly skips.

---

## 7. API Integration

### New functions in `api.js`

```js
export const createReservationIntent = (marinaSlug, payload) =>
  apiClient.post('/public/reservations/intent/', payload, {
    headers: { 'X-Marina-Slug': marinaSlug },
  });

export const confirmReservation = (marinaSlug, reservationId, paymentIntentId) =>
  apiClient.post('/public/reservations/confirm/', {
    reservation_id: reservationId,
    payment_intent_id: paymentIntentId,
  }, {
    headers: { 'X-Marina-Slug': marinaSlug },
  });
```

### Intent payload (built in QuoteScreen)

```js
{
  check_in,
  check_out,
  guest_name,
  guest_email,
  items: boats.map(b => ({
    boat_loa: parseFloat(b.loa),
    boat_beam: b.beam ? parseFloat(b.beam) : null,
    boat_draft: b.draft ? parseFloat(b.draft) : null,
    berth_category: b.category ?? null,
  })),
}
```

### Intent response variants

```js
// Auto-tetris:
{ reservation_id, reference, requires_payment: true, client_secret, total_price }

// Manual:
{ reservation_id, reference, requires_payment: false, status: 'pending_review' }
```

### Confirm payload (auto-tetris only, after stripe.confirmPayment)

```js
{ reservation_id, payment_intent_id }  // payment_intent_id from result.paymentIntent.id
```

---

## 8. QuoteScreen Logic

```
1. Call createReservationIntent() → response

2. If response.requires_payment === true:   (auto-tetris)
   a. Mount Stripe Elements with response.client_secret
   b. On submit: stripe.confirmPayment({ redirect: 'if_required' })
   c. On success: call confirmReservation(reservation_id, result.paymentIntent.id)
   d. Advance to confirmed screen with { reference, status: 'confirmed' }

3. If response.requires_payment === false:  (manual)
   a. Skip Stripe entirely
   b. Advance immediately to confirmed screen with { reference, status: 'pending_review' }
```

No other branching on `booking_mode` anywhere in the frontend.

---

## 9. Confirmed Screen

`BookingConfirmed.jsx` receives `{ reference, status }` and renders accordingly:

**Auto-tetris (`status === 'confirmed'`):**
> "Your reservation is confirmed. Your reference is **RES-42**. A confirmation email is on its way — it includes your berth assignment, arrival details, and a personal boarding pass link for digital check-in."

**Manual (`status === 'pending_review'`):**
> "Your reservation request has been received. Your reference is **RES-43**. The harbour master will review your request and you'll receive an email once your berths are assigned."

The guest uses `RES-{pk}` + their email to access the boarding pass via the existing `guest-instant/` login flow (already supports the `RES-` prefix).

---

## 10. Error Handling

| Scenario | Behaviour |
|----------|-----------|
| `reservations/intent/` returns 409 (no availability, auto-tetris only) | Advance to `alternatives` screen |
| `reservations/intent/` returns 400 (validation) | Show inline error on quote screen |
| `stripe.confirmPayment` fails | Show Stripe error message, keep payment form open |
| `reservations/confirm/` returns 402 (payment not yet succeeded) | Show retry message, keep payment form open |
| `reservations/confirm/` returns 409 (already confirmed) | Treat as success, advance to confirmed screen |

---

## 11. What Does Not Change

- `alternatives` screen
- Stripe Elements rendering and theming
- All CSS and design tokens
- `LoginScreen` and boarding pass flow
- Member portal
- `engine-request` endpoint (kept in backend but no longer called by public portal)
