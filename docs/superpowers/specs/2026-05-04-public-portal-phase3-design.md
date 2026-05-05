---
title: Public Portal Phase 3 — Auto-Tetris Booking Funnel
date: 2026-05-04
status: draft
---

# Public Portal Phase 3 — Auto-Tetris Booking Funnel

## Scope

Phase 3 of 3. Implement the React booking funnel a boater clicks through in `auto_tetris` mode. The funnel runs on the existing portal (`portal/src/`) and wires to existing backend endpoints plus one new alternatives endpoint.

Manual-approval mode (`BookingRequest` / `BookingRequestSent`) is unchanged.

---

## 1. User Flow

```
SearchScreen
  → QuoteScreen                  (availability found for exact dates)
  → AlternativesScreen           (no availability, but alternatives exist)
      → QuoteScreen              (user selects an alternative)

QuoteScreen
  → [Stripe redirect]            (engine succeeds)
  → SearchScreen + error banner  (engine returns 409 — berth stolen between quote and book)
```

### Step-by-step

1. **SearchScreen** — boater enters dates + boat dimensions. Clicks "Check Availability."
2. Frontend calls `GET /api/v1/bookings/available-berths/` with all dimension params.
   - Non-empty → navigate to `QuoteScreen` with `{ checkIn, checkOut, nights, total }` from first result.
   - Empty → call `GET /api/v1/bookings/availability-alternatives/` with same params.
     - Non-empty → navigate to `AlternativesScreen`.
     - Empty → inline dead-end message on `SearchScreen`: "No availability for those dates or nearby alternatives. Please contact the marina directly."
3. **AlternativesScreen** — renders clickable suggestion cards. User picks one → navigate to `QuoteScreen` with selected dates/price.
4. **QuoteScreen** — shows trip summary (dates, nights, total price; no specific berth code). Inline contact form: Name, Email, Phone. User clicks "Book & Pay."
5. Frontend calls `POST /api/v1/bookings/engine-request/`. On success → `window.location.href = checkout_url`.

---

## 2. Wizard State

A single `BookingWizard` top-level component (or lightweight Context) holds transient funnel state. No URL params, no session storage — the flow is linear and one-shot.

```js
{
  checkIn,        // ISO date string
  checkOut,       // ISO date string
  boatLoa,
  boatBeam,
  boatDraft,      // nullable
  quotedPrice,    // unit price (per night)
  quotedTotal,    // quotedPrice × nights
  guestName,
  guestEmail,
  guestPhone,
}
```

State is passed as props from `BookingWizard` to each child screen along with a `navigate(screenName, stateUpdates)` callback.

---

## 3. Frontend Screens

### `SearchScreen`

Fields: `check_in` (date), `check_out` (date), `boat_loa` (number), `boat_beam` (number), `boat_draft` (number, optional).

On submit:
1. Call `GET /api/v1/bookings/available-berths/?check_in=…&check_out=…&boat_loa=…&boat_beam=…&boat_draft=…`
2. If results non-empty: `navigate('quote', { checkIn, checkOut, quotedPrice: results[0].pricing_tier_unit_price, quotedTotal: results[0].pricing_tier_unit_price * nights })` — use `results[0]` (the first result returned by the server, which matches the berth the engine will likely score highest). If the engine picks a different-tier berth at booking time, the Stripe checkout amount is authoritative; the quote is an estimate.
3. If results empty: call `GET /api/v1/bookings/availability-alternatives/` with same params.
   - Non-empty: `navigate('alternatives', { alternatives })`
   - Empty: show inline dead-end message (no navigation)

Shows error banner if navigated back from `QuoteScreen` after a 409.

### `AlternativesScreen`

Renders one card per alternative:
> "Jul 9–12 · 3 nights · €270"

On card click: `navigate('quote', { checkIn: alt.check_in, checkOut: alt.check_out, quotedPrice: alt.price_per_night, quotedTotal: alt.total })`

React `key` prop for each card: use `alt.check_in + '_' + alt.check_out` (composite string). Never use array index — the alternatives array may re-sort and index-based keys cause rendering bugs.

Back link → `SearchScreen` with form pre-filled.

### `QuoteScreen`

Displays:
- Trip summary: dates, nights, total price, general berth description ("pontoon berth, suitable for your vessel") — **no berth code shown**
- Inline contact form: Name, Email, Phone

On submit:
1. `POST /api/v1/bookings/engine-request/` with all wizard state fields
2. Success → `window.location.href = checkout_url`
3. 409 → `navigate('search')` with banner: "Availability changed while you were reviewing. Please check your dates again." (covers both the concurrent-booking case and the tab-left-open-for-45-minutes case without implying a system error)
4. 503 → inline error: "Something went wrong, please try again"

---

## 4. New Backend Endpoint — Availability Alternatives

**File:** `apps/reservations/booking_engine.py` (new function) + `apps/reservations/views.py` (new view) + `apps/reservations/urls.py` (new route)

`GET /api/v1/bookings/availability-alternatives/`

Query params: `check_in`, `check_out`, `boat_loa`, `boat_beam`, `boat_draft` — same as `available-berths`.

### Engine function

Use `from django.utils import timezone` and check against `timezone.localdate()` rather than `date.today()`, so the "today" boundary respects the marina's local timezone rather than the server's UTC clock.

```python
ALTERNATIVE_SHIFTS = [-2, -1, 1, 2]       # days to shift check_in, same duration
ALTERNATIVE_DURATIONS = [-1, 1, -2, 2]    # nights delta, same check_in

def find_date_alternatives(marina, check_in, check_out, boat_loa, boat_beam, boat_draft, max_results=4):
    original_nights = (check_out - check_in).days
    candidates = []

    for delta in ALTERNATIVE_SHIFTS:
        new_in = check_in + timedelta(days=delta)
        new_out = new_in + timedelta(days=original_nights)
        if new_in < timezone.localdate():
            continue
        scored = _score_berths(
            compatible_available_berths(marina, new_in, new_out, boat_loa, boat_beam, boat_draft),
            new_in, new_out,
        )
        if scored:
            berth = scored[0][1]
            candidates.append({
                'check_in': new_in, 'check_out': new_out,
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
                'check_in': check_in, 'check_out': new_out,
                'nights': new_nights,
                'price_per_night': berth.pricing_tier.unit_price,
                'total': berth.pricing_tier.unit_price * new_nights,
            })

    candidates.sort(key=lambda c: abs((c['check_in'] - check_in).days) + abs(c['nights'] - original_nights))
    return candidates[:max_results]
```

### Response shape

Always 200. Empty list = truly no flexibility.

```json
[
  { "check_in": "2026-07-09", "check_out": "2026-07-12", "nights": 3, "price_per_night": "90.00", "total": "270.00" },
  { "check_in": "2026-07-10", "check_out": "2026-07-14", "nights": 4, "price_per_night": "90.00", "total": "360.00" }
]
```

No new model, no migration.

---

## 5. Error Handling

| Scenario | Behaviour |
|---|---|
| No availability, alternatives exist | Navigate to `AlternativesScreen` with suggestion cards |
| No availability, no alternatives | Inline dead-end message on `SearchScreen` |
| Berth stolen between quote and book (409) | Back to `SearchScreen` with banner |
| Network error on availability check | Inline retry prompt on `SearchScreen` |
| Engine error (503) | Inline error on `QuoteScreen` |

---

## 6. Tests

### Backend — `FindDateAlternativesTest` (in `apps/reservations/tests.py`)

| Test | Assertion |
|---|---|
| `test_shift_window_finds_alternative` | exact dates blocked, `check_in + 1` free → shifted window in results |
| `test_duration_variant_finds_alternative` | exact dates blocked, +1 night is free → extended stay in results |
| `test_returns_empty_when_truly_no_availability` | all permutations blocked → `[]` |
| `test_capped_at_max_results` | 8 permutations all available → returns ≤ 4 |
| `test_sorted_by_proximity` | closest shifts appear before distant ones |
| `test_past_dates_excluded` | shift producing `check_in < today` is skipped |

### Backend — `AvailabilityAlternativesEndpointTest` (in `apps/reservations/tests.py`)

| Test | Assertion |
|---|---|
| `test_returns_alternatives_json` | blocked primary dates → 200 with non-empty array |
| `test_empty_when_no_alternatives` | all dates blocked → 200 with `[]` |
| `test_boat_draft_respected` | berth with insufficient `max_draft_m` excluded from alternatives |

### Frontend — component tests (Vitest + React Testing Library, co-located with screens)

| Screen | Test |
|---|---|
| `SearchScreen` | form submit calls `available-berths` with correct params |
| `SearchScreen` | empty berths response triggers alternatives call |
| `SearchScreen` | empty alternatives shows dead-end inline message |
| `AlternativesScreen` | renders one card per alternative with correct price and dates |
| `AlternativesScreen` | clicking a card navigates to `QuoteScreen` with correct wizard state |
| `QuoteScreen` | displays dates, nights, total from wizard state |
| `QuoteScreen` | submitting contact form calls engine-request with all fields |
| `QuoteScreen` | engine 409 navigates back to `SearchScreen` with banner |
| `QuoteScreen` | engine success redirects to `checkout_url` |

---

## 7. Files Touched

| File | Change |
|---|---|
| `portal/src/App.jsx` | Replace `auto_tetris` placeholder with `<BookingWizard />` |
| `portal/src/screens/BookingWizard.jsx` | New — wizard state container, screen router |
| `portal/src/screens/SearchScreen.jsx` | New |
| `portal/src/screens/AlternativesScreen.jsx` | New |
| `portal/src/screens/QuoteScreen.jsx` | New |
| `backend/apps/reservations/booking_engine.py` | Add `find_date_alternatives` |
| `backend/apps/reservations/views.py` | Add `AvailabilityAlternativesView` |
| `backend/apps/reservations/urls.py` | Add route for `availability-alternatives/` |
| `backend/apps/reservations/tests.py` | Add `FindDateAlternativesTest`, `AvailabilityAlternativesEndpointTest` |

No new models, no migrations.

---

## 8. Out of Scope

- Boater accounts / login
- Booking management (view, cancel) post-payment
- Manual-approval mode UI changes
- Admin-side changes
- Push notifications or email confirmations (handled by existing Stripe webhook)
