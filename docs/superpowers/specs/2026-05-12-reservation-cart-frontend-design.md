# Reservation Cart — Phase 2B: Portal Frontend

**Date:** 2026-05-12
**Scope:** Update `BookingWizard.jsx` and `QuoteScreen.jsx` to call the new reservation cart endpoints (`/public/reservations/intent/` and `/public/reservations/confirm/`) for auto-tetris marinas. Add multi-boat support to the dimensions step and per-boat category selection to the options step. Manual marinas are untouched.

---

## 1. Principles

**Minimal surface change.** The wizard's 5-screen structure (`search → options → alternatives → quote → confirmed`) stays identical. Only the data shape, the two API calls in `QuoteScreen`, and the dimensions/options UI change.

**Branch at the API call, not the component.** The manual marina path continues through `POST /public/bookings/engine-request/`. The auto-tetris path uses the new reservation endpoints. The branch lives inside `QuoteScreen` based on `marina.booking_mode`.

**Multi-boat is additive.** Single-boat is the default. "Add another boat" appends to a list. No cap on boats.

---

## 2. Files Changed

| File | Change |
|------|--------|
| `portal/api.js` | Add `createReservationIntent()` and `confirmReservation()` |
| `portal/BookingWizard.jsx` | `boat_loa/beam/draft` → `boats[]` array in state; multi-boat dimensions UI; per-boat category selection on options screen |
| `portal/screens/QuoteScreen.jsx` | Swap API calls for auto-tetris path; pass `reservation_id` to confirmed screen |
| `portal/screens/BookingConfirmed.jsx` | Accept and display `RES-{pk}` reference alongside existing booking confirmed copy |

No other files change.

---

## 3. State Shape

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

## 4. Dimensions Step (search screen)

Below the existing LOA/beam/draft fields, add:

- When `boats.length === 1`: fields render without a label or remove button.
- When `boats.length > 1`: each boat renders with a "Boat N" label and a "Remove" button. The remove button is absent on the last remaining boat.
- A "+ Add another boat" text link appends `{ loa: '', beam: '', draft: '', category: null }` to `boats`.
- No cap on boats.

Validation: all boats must have a non-empty LOA before the wizard advances to the options screen.

---

## 5. Options Step (category screen)

Currently renders one set of category cards for the whole booking.

**New behaviour:** render one category picker per boat, stacked vertically:

```
Choose your berth type

Boat 1 — 45ft
[ Standard ]  [ Premium ]  [ Mega ]

Boat 2 — 15ft
[ Standard ]  [ Dinghy ]
```

- Each boat shows only categories whose `min_loa ≤ boat.loa` (same filtering logic as today, applied per boat using `boat.loa`).
- Selecting a category sets `boats[i].category = category_id`.
- Category selection is optional per boat — leaving it null sends `berth_category: null` to the intent endpoint, letting the backend auto-pick.
- "Continue" is enabled when all boats with available categories have one selected, or when the guest explicitly skips (null is valid).

---

## 6. API Integration

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
// Response: { reservation_id, client_secret, total_price }
```

### Confirm payload (after stripe.confirmPayment succeeds)

```js
{
  reservation_id,   // from intent response
  payment_intent_id,  // extracted: client_secret.rsplit('_secret_')[0] or from stripe result
}
// Response: { status: 'confirmed', reference: 'RES-{pk}', marina_slug, ... }
```

---

## 7. QuoteScreen Branch Logic

```
if marina.booking_mode === 'auto_tetris':
  1. Call createReservationIntent() → { reservation_id, client_secret, total_price }
  2. Mount Stripe Elements with client_secret
  3. On submit: stripe.confirmPayment({ redirect: 'if_required' })
  4. On success: call confirmReservation(reservation_id, payment_intent_id)
  5. Advance wizard to confirmed screen with { reservation_id, reference }

else (manual):
  existing flow unchanged — POST /public/bookings/engine-request/
```

The branch is determined once when `QuoteScreen` mounts, from the marina context already available in wizard state.

---

## 8. Confirmed Screen

`BookingConfirmed.jsx` receives either:
- `booking_id` (legacy, manual flow) — existing copy unchanged
- `reservation_id` + `reference` (new cart flow) — display reference as "RES-42"

Copy for reservation confirmation:
> "Your reservation is confirmed. Your reference is **RES-42**. A confirmation email is on its way — it includes your berth assignment, arrival details, and a personal boarding pass link for digital check-in."

The guest uses `RES-42` + their email to access the boarding pass via the existing `guest-instant/` login flow.

---

## 9. Error Handling

| Scenario | Behaviour |
|----------|-----------|
| `reservations/intent/` returns 409 (no availability) | Same as today — advance to `alternatives` screen |
| `reservations/intent/` returns 400 (validation) | Show inline error on quote screen |
| `stripe.confirmPayment` fails | Show Stripe error message, keep payment form open |
| `reservations/confirm/` returns 402 (payment not succeeded) | Show "Payment not confirmed yet, please try again" with retry button |
| `reservations/confirm/` returns 409 (already confirmed) | Treat as success, advance to confirmed screen |

---

## 10. What Does Not Change

- Manual marina flow (`engine-request` path)
- `alternatives` screen
- Stripe Elements rendering and theming
- All CSS and design tokens
- `LoginScreen` and boarding pass flow
- Member portal
