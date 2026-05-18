# Booking Checkout Redesign — Phase 1

**Date:** 2026-05-18
**Status:** Design — approved, ready for implementation plan
**Author:** brainstorming session
**Phase:** 1 of 2 (Phase 2 will add the promo-code subsystem and VIES VAT validation)

## 1. Problem & Goals

The public booking flow in `booking/src/screens/QuoteScreen.jsx` currently shows guest details and Stripe `PaymentElement` in a single 520px-wide centered column. It collects only the minimum fields the existing `ReservationIntentSerializer` accepts, and the only price information shown to the guest is the total — embedded in the pay button label. There is no checkout/order summary, no hold-expiry countdown, no per-item breakdown.

Booking T&Cs / cancellation policy is never collected. The DocuSign-style waiver lives at check-in time in the portal (`portal/src/components/portal/checklist/WaiverItem.jsx`).

### Goals

1. Add a persistent right-side **booking summary panel** that surfaces the data the backend already returns (`total`, per-item `berth_code`/`item_price`/`nights`, `locked_until`) plus marina identity.
2. Restructure `QuoteScreen` as a **3-step wizard** so the larger field set doesn't overwhelm a single screen.
3. Capture the missing booking fields a real marina needs (per audit below).
4. Add a **lightweight booking T&Cs acceptance checkbox** before payment. The heavy waiver stays at check-in.

### Non-goals (Phase 1)

- Full promo-code subsystem (separate Phase 2 spec). A disabled input is rendered now as a placeholder; backend stores the string but does not validate or redeem it.
- VIES VAT number validation. Phase 1 stores the value with permissive format validation only.
- Moving the heavy waiver to pre-payment.
- PDF snapshot storage at acceptance time (we store version string only).

## 2. Architecture Overview

### Frontend (`booking/`)

- `QuoteScreen.jsx` becomes a small state machine: `vessel | guest | payment`.
- New files under `booking/src/screens/quote/`:
  - `VesselStep.jsx`
  - `GuestStep.jsx`
  - `PaymentStep.jsx` (existing Stripe `PaymentForm` extracted)
  - `BookingSummary.jsx` (right-side panel, rendered alongside every step)
  - `InsuranceUpload.jsx` (per-boat file picker)
- `BookingWizard.jsx` is unchanged — the three sub-steps live inside the existing `screen === 'quote'` state, not as new top-level screens.
- State stays lifted at `QuoteScreen`; step components receive props and call `updateState`, `next`, `back`.

### Backend (`apps/reservations/`)

- Additive migration on `Reservation` and `ReservationItem` (every new field nullable / `blank=True` for back-compat with existing payloads and rows).
- Additive migration on `accounts.Marina` for T&Cs config + optional-requirement flags.
- New `InsuranceUploadToken` model and new endpoint `POST /api/v1/public/reservations/insurance-upload/`.
- `ReservationIntentSerializer` + `CartItemSerializer` extended with the new optional fields.
- Celery beat task `purge_expired_insurance_uploads` runs hourly.

### Stripe

- No integration change. Same `PaymentIntent` flow.
- Stripe Address Element is **not** enabled; we collect the billing address ourselves so the data lands in our `Reservation` row for invoicing.

## 3. Data Model Changes

All fields are additive and nullable / default-empty unless stated otherwise.

### `Reservation` — new fields

| Field | Type | Notes |
|---|---|---|
| `estimated_arrival_time` | `TimeField(null=True, blank=True)` | wall-clock local time, no TZ |
| `special_requests` | `TextField(blank=True, default='')` | free text |
| `shore_power_amperage` | `CharField(max_length=8, choices=[('16A','16A'),('32A','32A'),('63A','63A'),('none','None')], null=True, blank=True)` | |
| `terms_accepted_at` | `DateTimeField(null=True, blank=True)` | stamped on intent creation |
| `terms_version` | `CharField(max_length=32, blank=True, default='')` | copied from `Marina.booking_terms_version` |
| `billing_street` | `CharField(max_length=200, blank=True, default='')` | |
| `billing_city` | `CharField(max_length=100, blank=True, default='')` | |
| `billing_postcode` | `CharField(max_length=20, blank=True, default='')` | |
| `billing_country` | `CharField(max_length=2, blank=True, default='')` | ISO 3166-1 alpha-2 |
| `company_name` | `CharField(max_length=200, blank=True, default='')` | optional B2B |
| `vat_number` | `CharField(max_length=50, blank=True, default='')` | permissive format validation only |
| `promo_code` | `CharField(max_length=50, blank=True, default='')` | stored but unvalidated in Phase 1 |

### `ReservationItem` — new fields

| Field | Type | Notes |
|---|---|---|
| `boat_air_draft` | `DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)` | metres |
| `vessel_registration` | `CharField(max_length=50, blank=True, default='')` | |
| `vessel_flag` | `CharField(max_length=2, blank=True, default='')` | ISO 3166-1 alpha-2 |
| `crew_count` | `PositiveSmallIntegerField(null=True, blank=True)` | per-boat (not per-reservation) |
| `insurance_certificate` | `FileField(upload_to='reservations/insurance/%Y/%m/', null=True, blank=True)` | populated by token redemption |

### `accounts.Marina` — new fields

| Field | Type | Notes |
|---|---|---|
| `booking_terms_pdf_url` | `URLField(blank=True, default='')` | marina-hosted PDF |
| `booking_terms_version` | `CharField(max_length=32, blank=True, default='1.0')` | bumped by marina when PDF content changes |
| `requires_air_draft` | `BooleanField(default=False)` | controls whether VesselStep marks air draft as required |
| `requires_insurance_at_booking` | `BooleanField(default=False)` | controls whether insurance upload is required to advance |

### New model: `InsuranceUploadToken`

```python
class InsuranceUploadToken(models.Model):
    token        = models.CharField(max_length=64, unique=True, db_index=True)
    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    file_path    = models.CharField(max_length=500)   # MEDIA_ROOT-relative
    mime_type    = models.CharField(max_length=64)
    size_bytes   = models.PositiveIntegerField()
    created_at   = models.DateTimeField(auto_now_add=True)
    consumed_at  = models.DateTimeField(null=True, blank=True)
```

TTL is 24h from `created_at`. After consumption the file has been copied into the corresponding `ReservationItem.insurance_certificate` and the token row is kept for 30 days for audit, then the row (but not the now-attached file) is purged.

## 4. API Changes

### `ReservationIntentSerializer` / `CartItemSerializer` (extended)

`CartItemSerializer` gains, all optional:

- `boat_air_draft: Decimal`
- `vessel_registration: str`
- `vessel_flag: str` (length 2)
- `crew_count: int` (≥ 1)
- `insurance_upload_token: str` (**write-only**; redeemed inside the view)

`ReservationIntentSerializer` gains, all optional except `terms_accepted`:

- `estimated_arrival_time: str` (HH:MM)
- `special_requests: str`
- `shore_power_amperage: str` (one of the choices)
- `billing_street`, `billing_city`, `billing_postcode`, `billing_country` (all `str`)
- `company_name`, `vat_number`, `promo_code` (all `str`)
- `terms_accepted: bool`

Validation:

- `terms_accepted` must be `True` **if** `marina.booking_terms_pdf_url` is non-empty. If the marina has not configured T&Cs the validator is skipped (UI does not render the checkbox either).
- `billing_country`, `vessel_flag`: ISO-3166 alpha-2 against a constant set (the marinas you actually serve — see Section 8 for the initial list). Empty allowed.
- `vat_number`: permissive regex `^[A-Z0-9 .\-]{4,30}$` if non-empty; no remote validation.
- `insurance_upload_token`: looked up in `InsuranceUploadToken`. Must exist, belong to `request.tenant`, not be consumed, and be within TTL. Otherwise `400`.
- Existing date/cart validators unchanged.

On successful intent creation, the view stamps:
- `Reservation.terms_accepted_at = timezone.now()` (if terms were accepted)
- `Reservation.terms_version = marina.booking_terms_version`
- Insurance token: file copied (not moved) into the item's `FileField`, then `token.consumed_at = now()`.

### New endpoint: `POST /api/v1/public/reservations/insurance-upload/`

- Auth: `AllowAny` (same trust model as the rest of `/public/`)
- Content-type: `multipart/form-data` with a single `file` field
- Tenant: resolved from `X-Marina-Slug` header (existing `TenantMiddleware`)
- Validates:
  - MIME in `{application/pdf, image/jpeg, image/png}`
  - Size ≤ 5 MB
  - Marina exists and is not in `cancelled` billing state
- Stores file to `MEDIA_ROOT/reservations/insurance/tmp/<token>.<ext>`
- Returns `{ token: str, expires_at: ISO8601 }`
- Throttled via DRF scope `public_insurance_upload`, rate `20/hour`

### Marina serializer extension

The serializer used by the marina-fetch endpoint the booking app already calls (`useTenant()` hook) is extended to include `booking_terms_pdf_url`, `booking_terms_version`, `requires_air_draft`, `requires_insurance_at_booking`. No new endpoint.

## 5. Frontend Flow

### Step 1 — VesselStep (`screen === 'quote' && currentStep === 'vessel'`)

For each `state.boats[i]` (1+ boats):

- Vessel name (text, required)
- LOA (number, required — pre-filled from SearchScreen)
- Beam (number, optional — pre-filled)
- Draft (number, optional — pre-filled)
- Air draft (number, required iff `marina.requires_air_draft`)
- Registration # (text, required)
- Flag (country dropdown, required, ISO alpha-2)
- Crew count (number, required, ≥ 1)
- Insurance certificate file picker (`InsuranceUpload.jsx`):
  - On file selection, POSTs to `/public/reservations/insurance-upload/`, receives `{token, expires_at}`, stores `token` on `state.boats[i].insuranceToken`.
  - Required to advance iff `marina.requires_insurance_at_booking`.
- Per-boat "Remove" if `state.boats.length > 1`. "Add another boat" button at the bottom.

Validation gate: all required fields populated for every boat → "Continue" enabled.

### Step 2 — GuestStep

- Full name (required)
- Email (required)
- Phone (optional — kept from current flow)
- **Billing address** block: street, city, postcode, country (all required if `marina.booking_terms_pdf_url` is set; this prevents incomplete invoice data for marinas that have legalised their flow)
- **"Booking on behalf of a company"** toggle revealing:
  - Company name
  - VAT number
  - Both optional independently
- Estimated arrival time (time picker, optional)
- Special requests (textarea, optional)
- Shore power amperage (select with options 16A / 32A / 63A / None, optional)
- Promo code (text input, **disabled** with hint "Promo codes coming soon" — Phase 2)
- T&Cs checkbox: "*I accept the [booking terms and cancellation policy](pdf)*" — rendered only if `marina.booking_terms_pdf_url` is set; required to submit.

On submit:
1. POST `/public/reservations/intent/` with the full payload including all boats' tokens and the booking-level fields.
2. On `201`: store returned `{client_secret, reservation_id, total, reference, locked_until}` and advance to PaymentStep.
3. On `409` (no berth): existing alternatives flow.
4. On `400 terms_not_accepted` / `400 insurance_token_*`: surface inline error, stay on GuestStep.

### Step 3 — PaymentStep

Existing Stripe `PaymentForm` extracted into its own file. No behaviour change beyond using props from the new state shape.

### BookingSummary (right-side panel, all 3 steps)

- Header: marina name, marina address (truncated)
- Date row: `check_in → check_out · N night(s)`
- Per-boat block (one card per boat in `state.boats`):
  - Vessel name (or "Boat N" placeholder)
  - LOA · beam · draft summary line
  - After intent is created: berth code (or "Berth TBD"), `item_price`
- Subtotal, then **Total** in larger weight
- After intent creation: **"Hold expires in MM:SS"** countdown driven by `locked_until`. On expiry, render an inline error and a button that resets to Step 1 with the form pre-filled.
- Footer: link to T&Cs PDF (if set)

### Layout

- Desktop (`min-width: 880px`): CSS grid `grid-template-columns: minmax(0,1fr) 360px; gap: 32px`. Summary panel `position: sticky; top: 24px`.
- Mobile: summary collapses to a fixed bottom bar showing marina name + total. Tap expands to a full-screen modal with the same content.

## 6. T&Cs Acceptance Flow

- Marina admin pastes a public PDF URL into `Marina.booking_terms_pdf_url`; bumps `booking_terms_version` whenever the PDF content changes.
- Booking app shows the checkbox only if `booking_terms_pdf_url` is non-empty.
- Submission: serializer requires `terms_accepted=true`; view stamps `terms_accepted_at` and copies `terms_version` from the marina onto the reservation.
- No PDF content is stored per-acceptance. Audit trail is the marina's PDF-version archive (out of scope here) plus the version string on the reservation.

## 7. Validation, Error Handling, Cleanup

### Frontend per-step validation summary

| Transition | Required |
|---|---|
| Vessel → Guest | per boat: vessel_name, loa, registration, flag, crew_count; air_draft if marina flag; insurance token if marina flag |
| Guest → Payment | name, email, billing street/city/postcode/country, terms_accepted if marina has terms |
| Payment → Confirmed | Stripe handles |

### Backend error responses (new codes)

| Code | Detail | When |
|---|---|---|
| `400` | `terms_not_accepted` | marina has T&Cs configured, `terms_accepted` missing/false |
| `400` | `insurance_token_invalid` | token unknown or not owned by this tenant |
| `400` | `insurance_token_consumed` | token already attached to an item |
| `400` | `insurance_token_expired` | token > 24h old |
| `409` | `NoAvailableBerth` | existing |

### Insurance upload cleanup

- Hourly Celery beat task `purge_expired_insurance_uploads`:
  - For unconsumed tokens older than 24h: delete file, delete row.
  - For consumed tokens older than 30d: delete row only (the file has been copied to the `ReservationItem.insurance_certificate` location).
- Upload endpoint throttled at `20/hour` per IP.

## 8. Country / Flag Allowlist

Initial ISO 3166-1 alpha-2 set (extendable later — keep as a single constant in `apps/reservations/constants.py`):

```
AT, BE, BG, HR, CY, CZ, DK, EE, FI, FR, DE, GR, HU, IE, IT, LV, LT, LU, MT,
NL, PL, PT, RO, SK, SI, ES, SE, IS, LI, NO, CH, GB, US, CA, AU, NZ, TR, MC,
ME, RS
```

(EU 27 + EFTA + UK + US + CA + AU + NZ + TR + MC + ME + RS — adjust to actual customer geography before launch.)

## 9. Testing

### Backend (pytest)

- `ReservationIntentSerializer` round-trip with the new fields populated, partially populated, all empty.
- Terms enforcement: marina with terms + missing flag → 400; marina without terms + missing flag → 201.
- Insurance flow: upload → intent referencing the token → `ReservationItem.insurance_certificate` populated, token `consumed_at` set.
- Insurance token validation paths (invalid / consumed / expired / wrong marina).
- TTL purge task: time-travel via `freezegun`, assert expired files + rows removed.
- Concurrency test on the existing tetris path remains unchanged.

### Frontend (Vitest)

- Step state machine: vessel → guest → payment transitions, back navigation preserves state.
- VesselStep validation: required fields per boat, multi-boat add/remove preserves tokens.
- GuestStep validation: terms gate, billing address gate.
- BookingSummary: countdown timer behaviour (uses fake timers), expiry handling.
- Existing `QuoteScreen.test.jsx` rewritten to drive the multi-step flow.

## 10. Open Items / Risks

1. **Country dropdown UX** — 40+ entries in a `<select>` is usable but unloved. Phase 2 candidate for a typeahead.
2. **Insurance upload before reservation exists** — the token-then-attach pattern works but introduces orphan-storage risk if the cleanup task misfires. The 24h TTL plus per-IP throttle is the mitigation. Monitor disk usage in prod for a week post-launch.
3. **`requires_insurance_at_booking` for new marinas** — defaults `false` so existing flows stay open. Marinas explicitly turn it on once they have the PDF intake working.
4. **Stripe `PaymentElement` billing address** — we ask Stripe NOT to collect it. If their fraud signals flag this as a regression, revisit and let Stripe collect address + read it back via `paymentIntent.payment_method.billing_details`.
5. **`vat_number` permissive validation** — Phase 1 accepts almost any string. If you onboard a UK marina that needs HMRC-compliant invoices before Phase 2 lands, we'll need to ship VIES validation as a hotfix sub-phase.

## 11. Phase 2 Preview (separate spec, later)

- Promo code subsystem: `PromoCode` model, marina-side creation UI, redemption tracking, line-item discount application in pricing pipeline.
- VIES VAT validation with caching.
- Optional: PDF snapshot storage at T&Cs acceptance time, if a customer's jurisdiction requires it.
- Optional: typeahead country picker.
