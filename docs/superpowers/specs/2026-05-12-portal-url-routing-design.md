# Portal URL Routing Architecture — Design Spec

**Date:** 2026-05-12
**Status:** Approved (revised)

## Problem

Clicking a booking link from the management app opens the member portal (`AppShell`) instead of the booking wizard. The portal has no path-based routing — `App.jsx` is a single if/else chain that renders based on localStorage state, not the URL. This means a logged-in member who visits `/{slug}` always lands in the portal, even if they followed a "Book Now" link.

Additionally, the login flow relies entirely on email magic links — which is unacceptable for a transient guest at the helm of a 40-foot yacht in a crosswind. They cannot safely switch to their email app, wait for a link to arrive, and tap it. The login screen must offer an instant "Airline Boarding Pass" path for guests.

## URL Architecture

| Path | Purpose | Auth |
|------|---------|------|
| `/{slug}/book` | Public booking wizard | None — anyone can access |
| `/{slug}/` | Member portal (5-tab app) | Required — unauthenticated users see `LoginScreen` |
| `/{slug}?token=<tok>` | Magic link / pre-arrival SMS entry | Handled transparently, redirects to `/{slug}/` |
| `/{slug}/booking/:id/confirmed` | Stripe success redirect | None |
| `/{slug}/booking/:id/cancelled` | Stripe cancel redirect | None |

## Frontend Changes

### 1. React Router `<Routes>` in `App.jsx`

Replace the if/else chain with explicit routes:

```
/:slug/book                    → <BookingWizardPage>   (public)
/:slug/booking/:id/confirmed   → <BookingConfirmed>
/:slug/booking/:id/cancelled   → <BookingConfirmed cancelled>
/:slug/*                       → <PortalGate>
```

`TenantContext.detectTenant()` reads `pathname.split('/').filter(Boolean)[0]` as the slug — already works correctly for both `/slug` and `/slug/book`. No change needed.

### 2. New `<PortalGate>` Component

Replaces the auth logic currently spread through `App.jsx`. On mount, evaluated in order:

1. **Magic link present** (`?token=m_...` or `?token=g_...`):
   - Read prefix (`m_` or `g_`), strip it
   - Call the correct verify endpoint:
     - `m_` → `POST /portal/auth/member-magic/verify/`
     - `g_` → `POST /portal/checkin/auth/magic/`
   - On success: save session to localStorage, `window.location.replace('/{slug}/')` — token disappears from URL, user lands on `AppShell`
   - On failure: render inline "This link has expired or is invalid." error
   - Show "Signing you in…" while verifying

2. **Session token in localStorage:** Render `<AppShell>`

3. **No session:** Render `<LoginScreen>`

**Deletes:** `Magic.jsx` and the inline `member_token` handler in `App.jsx` — `PortalGate` absorbs both.

### 3. `<LoginScreen>` — Two-Tab Layout

The login screen has two distinct tabs:

**Tab 1 — "I have a Booking" (Transient Guests)**

Fields: Email + Booking Reference (e.g. `BKG-1042`)

Action button: "View Boarding Pass"

Behaviour: POSTs directly to `POST /portal/auth/guest-instant/`. On success, the backend returns a session token immediately — no email is sent, no inbox visit required. The app saves the token and renders `AppShell`. This is the "at the helm" path.

Error state: "No booking found for that email and reference." (safe to reveal — the reference is not a secret enumerable list)

**Tab 2 — "Marina Member"**

Field: Email only

Action button: "Send Secure Link"

Behaviour: POSTs to `POST /portal/auth/request-link/`. Always shows "If an account exists, a secure link has been sent." regardless of outcome. The member checks their email once, at home, and the session stays alive for 90 days — they are never asked to do this from a moving boat.

## Backend Changes

### New Endpoint: `POST /portal/auth/guest-instant/`

**Request:** `{ email, booking_reference }` + `X-Marina-Slug` header

**Logic:**

1. Look up `Booking` where `email__iexact=email`, `reference__iexact=booking_reference`, `marina__slug=marina_slug`
2. If not found: return 401 `{ "detail": "No booking found." }` — safe to be explicit here, not an enumerable list
3. If found: issue a guest session token directly (same as `checkin/auth/magic/` does on success) scoped to that single booking

**Auth scoping rule:** This endpoint always issues a `g_` guest token scoped to the specific booking, regardless of whether the email also belongs to a Member. A member who books a transient slip for a visiting friend must not have the friend land in their private dashboard.

**Token utilities:** `make_portal_token(booking_id, marina_slug, boater_email)` from `checkin_utils.py` — same token format the existing checkin verify already produces.

---

### New Endpoint: `POST /portal/auth/request-link/`

**Request:** `{ email }` + `X-Marina-Slug` header

**Logic:**

Find Member records and Booking records independently (both via `.filter()`, never `.get()`), then decide what to send:

| Member found | Bookings found | Action |
|---|---|---|
| Yes | No | Send member magic link only |
| No | One booking | Send guest magic link for that booking |
| No | Multiple bookings | Send one email listing all upcoming bookings, each with its own `g_<token>` link |
| Yes | Yes (member books for guest) | Send one email with two sections: member dashboard link + a link per upcoming booking |
| No | No | Silent no-op |

Always return: `{ "detail": "If an account exists, a secure link has been sent." }`

**Token utilities:**
- Member: `make_member_magic_token()` from `member_auth_utils.py` → prefix result with `m_`
- Guest: `make_magic_token(booking_id, guest_email)` from `checkin_utils.py` → prefix result with `g_`

**Existing verify endpoints unchanged** (frontend strips prefix before calling):
- `POST /portal/auth/member-magic/verify/` — decodes member token
- `POST /portal/checkin/auth/magic/` — decodes guest token

---

### `make_magic_url()` in `checkin_utils.py`

Currently generates `/{slug}/portal?token={token}`. Update to `/{slug}?token=g_{token}`.

---

Register both new endpoints in `member_auth_urls.py`.

## What Gets Deleted

- `Magic.jsx` — logic moves into `PortalGate`
- Inline `member_token` / `exchangeMemberToken` block in `App.jsx`
- `BOOKING_RESULT` regex in `App.jsx` — replaced by the React Router route

## What Does NOT Change

- `TenantContext` — no changes needed
- Both existing verify endpoints — no changes needed
- `AppShell`, `BookingWizard` — untouched
- Guest token signing/verification logic in `checkin_auth.py`
