---
title: Boater Portal Check-In Flow — Half B (Authenticated Journey)
date: 2026-05-04
status: approved
---

# Boater Portal Check-In Flow

## Scope

Half B only: the authenticated journey from magic link receipt through to the post-check-in Marina Wallet Card. The public booking form (Half A) is out of scope.

---

## 1. Auth & Magic Link Flow

Two emails trigger the portal journey:

1. **Post-payment confirmation** — sent when a booking is created and paid
2. **Arrival-day reminder** — sent the morning of `check_in`

Both contain a signed URL:
```
https://book.docksbase.com/<marina-slug>/portal?token=<signed_jwt>
```

The token payload is `{ booking_id, boater_email, exp }`, signed with a Django secret. The confirmation token expires in 72 hours; the arrival-day token expires in 48 hours.

The portal `/magic` route extracts the token from the query string and calls:
```
POST /api/portal/auth/magic/   { token }
```

Django validates the signature and expiry, then returns a portal-scoped JWT with payload `{ booking_id, marina_slug, boater_email }`. The portal stores this as `portal_access_token` in localStorage and redirects to `/`.

All subsequent API calls send:
```
Authorization: Bearer <portal_access_token>
X-Marina-Slug: <marina_slug>
```

A dedicated `PortalJWTAuthentication` backend validates the token and enforces `booking_id` scope — a boater can only access their own booking. No refresh tokens; expired tokens prompt the user to tap their email link again, which is acceptable given the short session window.

---

## 2. Data Model

### Booking (additions)

| Field | Type | Notes |
|---|---|---|
| `vessel_loa` | `DecimalField(6,2, null=True)` | Length overall, metres |
| `vessel_beam` | `DecimalField(5,2, null=True)` | Beam, metres |
| `vessel_draft` | `DecimalField(5,2, null=True)` | Draft, metres |
| `waiver_envelope_id` | `CharField(255, null=True)` | Dropbox Sign envelope ID |
| `waiver_signed` | `BooleanField(default=False)` | Set by webhook |
| `insurance_doc` | `FileField(upload_to='insurance/', null=True)` | Optional |
| `pre_cleared` | `BooleanField(default=False)` | Set by backend when required items complete |
| `self_checked_in` | `BooleanField(default=False)` | Set on arrival tap |
| `self_checked_in_at` | `DateTimeField(null=True)` | Timestamp of arrival tap |

`pre_cleared` is set server-side (never by the client) when `waiver_signed == True` AND all three dimension fields are non-null. Insurance is optional and does not gate `pre_cleared`.

### Marina (additions for wallet card)

| Field | Type | Notes |
|---|---|---|
| `wallet_wifi_network` | `CharField(100, null=True)` | |
| `wallet_wifi_password` | `CharField(100, null=True)` | |
| `wallet_gate_codes` | `JSONField(default=list)` | `[{"label": "Main Gate", "pin": "1234"}]` |
| `wallet_harbour_master_phone` | `CharField(30, null=True)` | |
| `wallet_vhf_channel` | `CharField(10, null=True)` | |
| `wallet_office_hours` | `CharField(100, null=True)` | e.g. "Mon–Fri 8am–6pm" |
| `waiver_template_id` | `CharField(255, null=True)` | Dropbox Sign template, set during onboarding |

`wallet_gate_codes` is a JSON array to support multiple gates without extra rows. Marina managers set wallet fields in Settings. `waiver_template_id` is set once by the DocksBase team during marina onboarding.

Two migrations: one for Booking, one for Marina.

---

## 3. State Machine

The portal calls `GET /api/portal/bookings/<id>/` on load. The frontend derives the current view from the response fields — no separate state endpoint.

| State | Condition | View |
|---|---|---|
| Pre-clearance incomplete | `pre_cleared == false` | Checklist |
| Cleared, awaiting arrival | `pre_cleared == true` AND `check_in > today` | Countdown |
| Arrival day | `pre_cleared == true` AND `check_in == today` AND `self_checked_in == false` | Arrival button |
| Checked in | `self_checked_in == true` | Marina Wallet Card |

After `check_out` date passes, the portal shows a "Thanks for visiting" stub in place of the wallet card.

---

## 4. API Surface

```
POST /api/portal/auth/magic/                # token exchange → portal JWT
GET  /api/portal/bookings/<id>/             # full booking state + wallet (if checked in)
PATCH /api/portal/bookings/<id>/            # update vessel dimensions
POST /api/portal/bookings/<id>/waiver/      # initiate Dropbox Sign → { sign_url }
POST /api/portal/bookings/<id>/insurance/   # multipart insurance upload
POST /api/portal/bookings/<id>/self-checkin/   # arrival tap
POST /api/webhooks/dropbox-sign/            # HMAC-validated, unauthenticated
```

The `GET /api/portal/bookings/<id>/` response includes a `marina_wallet` object **only** when `self_checked_in == true`. The backend strips it in all other states so codes are never exposed before the boater physically arrives.

The self-checkin endpoint sets both `self_checked_in = True` and `status = 'checked_in'` on the Booking in a single transaction, so the management dashboard reflects the arrival without dock staff needing to act.

---

## 5. Pre-Arrival Checklist

Three checklist items rendered in order. Each shows a status indicator and an action.

### Item 1 — Vessel Dimensions (required)

Inline form: LOA, Beam, Draft in metres. On submit, `PATCH /api/portal/bookings/<id>/` with the three values. Marked complete once all three are non-null. Form is pre-populated on re-open if values already saved.

### Item 2 — Marina Waiver (required)

"Sign Waiver" button calls `POST /api/portal/bookings/<id>/waiver/`.

Backend behaviour:
- If `waiver_envelope_id` already exists, return the existing sign URL (idempotent).
- Otherwise create a Dropbox Sign signature request using `Marina.waiver_template_id`, passing `metadata: { booking_id }` for webhook routing. Return `{ sign_url }`.

The portal opens `sign_url` in a new tab. Embedded iframe is avoided due to cross-origin constraints on mobile browsers.

**Webhook:** `POST /api/webhooks/dropbox-sign/`
- Validates Dropbox Sign HMAC header.
- On `signature_request_all_signed` event: look up booking by `metadata.booking_id`, set `waiver_signed = True`.
- In the same transaction: run `evaluate_pre_cleared(booking)` (see below).

**`evaluate_pre_cleared(booking)` — shared helper, called from two entry points:**

```python
def evaluate_pre_cleared(booking):
    if (booking.waiver_signed
            and booking.vessel_loa is not None
            and booking.vessel_beam is not None
            and booking.vessel_draft is not None):
        booking.pre_cleared = True
        booking.save(update_fields=['pre_cleared'])
```

This helper must be called from **both**:
1. The Dropbox Sign webhook (after setting `waiver_signed = True`)
2. The `PATCH /api/portal/bookings/<id>/` endpoint (after saving vessel dimensions)

This ensures `pre_cleared` is set regardless of which item the boater completes last. Without this, a boater who signs the waiver first and then fills dimensions will be stuck at 99% completion forever — the webhook already fired and will not fire again.

### Item 3 — Insurance Document (optional)

File picker, uploaded via `POST /api/portal/bookings/<id>/insurance/` as multipart. Shows "Uploaded ✓" once `insurance_doc` is non-null. Does not affect `pre_cleared`.

---

## 6. Arrival Day View

Shown when `pre_cleared == true` AND `check_in == today` AND `self_checked_in == false`.

- Full-width button, 80px height, label: "I Have Arrived — Self Check-In"
- Pulsing CSS animation (opacity 1→0.6→1, 2s loop) to draw attention
- On tap: button enters "Checking you in…" disabled state, calls `POST /api/portal/bookings/<id>/self-checkin/`
- On success: transitions immediately to Marina Wallet Card
- On error: shows inline error message, re-enables button

Single-tap design — no confirmation dialog. The disabled state during the request prevents double-submit.

---

## 7. Marina Wallet Card

Permanent screen shown after `self_checked_in == true`. Rendered on every re-open of the portal link during the boater's stay.

**Contents:**

| Field | Source |
|---|---|
| Berth / slip | `booking.berth.code` + `booking.berth.pier` |
| WiFi network | `marina.wallet_wifi_network` |
| WiFi password | `marina.wallet_wifi_password` (tap to copy) |
| Gate codes | `marina.wallet_gate_codes[]` — each with label + PIN (tap to copy) |
| Harbour master | `marina.wallet_harbour_master_phone` (tap to call) |
| VHF channel | `marina.wallet_vhf_channel` |
| Office hours | `marina.wallet_office_hours` |
| Marina logo | `marina.logo` (existing field) |
| Brand colour | `marina.brand_color` (existing field) |

Wallet data is served from the `marina_wallet` key in `GET /api/portal/bookings/<id>/` — only present when `self_checked_in == true`.

Tap-to-copy on passwords and PINs. Tap-to-call on harbour master phone. No PDF download — the magic link in the boater's email is their persistent access point throughout their stay.

---

## 8. Frontend Structure (portal/)

```
portal/src/
  screens/
    Magic.jsx          # token exchange → redirect
    BookingDashboard.jsx  # state router → one of four views
  components/portal/
    ChecklistView.jsx
    CountdownView.jsx
    ArrivalView.jsx
    WalletCard.jsx
    checklist/
      DimensionsForm.jsx
      WaiverItem.jsx
      InsuranceItem.jsx
```

`BookingDashboard` fetches `GET /api/portal/bookings/<id>/` and passes the response to a single `deriveState(booking)` helper that returns one of `'checklist' | 'countdown' | 'arrival' | 'wallet'`. Each view is a separate component with no shared local state between them.

The `GET` response includes a server-computed `is_arrival_day: bool` field so the client never compares dates. The backend computes it using the marina's local timezone:

```python
from zoneinfo import ZoneInfo
import datetime

tz = ZoneInfo(booking.marina.timezone)  # e.g. "Australia/Sydney", "America/Los_Angeles"
today_local = datetime.datetime.now(tz).date()
is_arrival_day = booking.check_in == today_local
```

`Marina.timezone` already exists on the model (`CharField`, default `'UTC'`). No migration required. UTC must never be used here — a Sydney marina at 9 AM local is still the previous UTC day, which would block a boater standing at the gate from checking in.

---

## 9. Error Handling

- Magic link expired: backend returns 401 with `{ code: 'token_expired' }` — portal shows "This link has expired. Check your email for a new one."
- Waiver initiation failure: inline error on the checklist item, retry button.
- Self-checkin failure: inline error, button re-enabled.
- Network errors: generic "Something went wrong, please try again" with retry.
- No special offline handling — portal is ephemeral and requires connectivity.
