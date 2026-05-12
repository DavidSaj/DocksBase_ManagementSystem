# Portal URL Routing Architecture — Design Spec

**Date:** 2026-05-12
**Status:** Approved

## Problem

Clicking a booking link from the management app opens the member portal (`AppShell`) instead of the booking wizard. The portal has no path-based routing — `App.jsx` is a single if/else chain that renders based on localStorage state, not the URL. This means a logged-in member who visits `/{slug}` always lands in the portal, even if they followed a "Book Now" link.

## URL Architecture

Three distinct paths on `portal.docksbase.com` (or `booking.docksbase.com`):

| Path | Purpose | Auth |
|------|---------|------|
| `/{slug}/book` | Public booking wizard | None — anyone can access |
| `/{slug}/` | Member portal (5-tab app) | Required — unauthenticated users see `LoginScreen` |
| `/{slug}?token=<tok>` | Magic link entry | Handled transparently, redirects to `/{slug}/` |
| `/{slug}/booking/:id/confirmed` | Stripe success redirect | None |
| `/{slug}/booking/:id/cancelled` | Stripe cancel redirect | None |

## Frontend Changes

### 1. React Router `<Routes>` in `App.jsx`

Replace the if/else chain with four explicit routes:

```
/:slug/book                    → <BookingWizardPage>   (public)
/:slug/booking/:id/confirmed   → <BookingConfirmed>
/:slug/booking/:id/cancelled   → <BookingConfirmed cancelled>
/:slug/*                       → <PortalGate>
```

`TenantContext.detectTenant()` reads `pathname.split('/').filter(Boolean)[0]` as the slug — this already works correctly for both `/slug` and `/slug/book`. No change needed there.

### 2. New `<PortalGate>` Component

Replaces the auth logic currently spread through `App.jsx`. On mount:

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

### 3. `LoginScreen` API Call Update

Change `POST /portal/auth/member-magic/request/` → `POST /portal/auth/request-link/`.

The success message ("If an account exists, a secure link has been sent.") is already correct and stays unchanged.

## Backend Changes

### New Endpoint: `POST /portal/auth/request-link/`

**Request:** `{ email }` + `X-Marina-Slug` header (matches existing pattern)

**Logic (strict order):**

1. Look up `Member` where `email__iexact=email` and `marina__slug=marina_slug`
   - Found → generate `m_<signed_token>` via existing `make_member_magic_token()`
   - Email link: `{PORTAL_BASE_URL}/{slug}?token=m_{token}`

2. Look up `Booking` where `email__iexact=email`, `marina__slug=marina_slug`, `checkout_date >= today`
   - Found → generate `g_<signed_token>` via existing guest token signing
   - Email link: `{PORTAL_BASE_URL}/{slug}?token=g_{token}`

3. Always return: `{ "detail": "If an account exists, a secure link has been sent." }`

**Security:** Silent success regardless of outcome — never reveals whether the email exists.

**Token utilities to use:**
- Member: `make_member_magic_token()` from `member_auth_utils.py` → prefix with `m_`
- Guest: `make_magic_token(booking_id, guest_email)` from `checkin_utils.py` → prefix with `g_`

**Existing verify endpoints are unchanged** (they receive the raw token with prefix already stripped by the frontend):
- `POST /portal/auth/member-magic/verify/` — decodes member token
- `POST /portal/checkin/auth/magic/` — decodes guest token

**Also update:** `make_magic_url()` in `checkin_utils.py` currently generates `/{slug}/portal?token={token}`. Change to `/{slug}?token=g_{token}` to match the new routing.

Register the new endpoint in `member_auth_urls.py`.

## What Gets Deleted

- `Magic.jsx` — logic moves into `PortalGate`
- Inline `member_token` / `exchangeMemberToken` block in `App.jsx`
- `BOOKING_RESULT` regex in `App.jsx` — replaced by the React Router route

## What Does NOT Change

- `TenantContext` — no changes needed
- Both existing verify endpoints — no changes needed
- `AppShell`, `BookingWizard`, `LoginScreen` internals — only the API call URL changes in `LoginScreen`
- Guest token signing/verification logic in `checkin_auth.py`
