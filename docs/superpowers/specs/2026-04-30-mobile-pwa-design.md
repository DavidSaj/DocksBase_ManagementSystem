# Mobile PWA — Design Spec
**Date:** 2026-04-30  
**Status:** Approved

---

## Overview

A single Progressive Web App built on the existing React + Vite frontend. One codebase, one URL, three role-based experiences. No native app store submissions for V1.

Boaters access the system via magic link (no password). Staff and admins use the existing email/password login.

---

## Architecture & Role-Based Routing

### Login screen (`/login`)
Shared entry point for all users. Email + password form using the App design system (IBM Plex Sans, `.abtn-primary`, inputs with `border: 1px solid #dddddd; border-radius: 4px`, focus ring `0 0 0 3px rgba(9,127,232,0.12)`). Calls the existing `POST /auth/token/` endpoint.

### Post-login redirect
The JWT response already includes `data.user.role`. A `useAuth` context stores the user object in state and `localStorage`. After login, a router guard redirects by role:

| Role | Destination |
|------|-------------|
| `owner` / `manager` | `/` — existing DesktopApp, unchanged |
| `staff` | `/field` — existing Field.jsx, unchanged |
| `boater` | `/portal` — new BoaterPortal screen |

A `ProtectedRoute` component enforces role boundaries. A boater navigating to `/field` is redirected to `/portal`. An unauthenticated user hitting any protected route is redirected to `/login`.

### Magic link flow (`/magic?token=<uuid>`)
1. On mount, React calls `POST /auth/magic/exchange/` with the token from the query string.
2. On success, the same JWT + user object is stored via `useAuth`.
3. `navigate('/portal', { replace: true })` — **replace, not push** — strips the dead token from the URL bar immediately. Bookmarking or sharing the URL after exchange is safe.

### Loading state
`useAuth` initialises with `isLoading: true`. It resolves to `false` only after the stored token is validated (or the magic link exchange completes). While loading, all protected routes render a blank white screen with a centred Lucide `anchor` icon in `--color-gray-300`. This eliminates any flash of the `/login` screen during the ~200ms exchange round-trip.

---

## Backend Changes

### 1. `boater` role
Add `('boater', 'Boater')` to `User.ROLE_CHOICES` in `accounts/models.py`.

Boater users have a nullable `OneToOneField` to `Member`. The marina admin creates/reuses the boater User and sends the magic link from the Members detail panel in the desktop app.

### 2. `MagicToken` model
```
MagicToken
  user        FK → User (on_delete=CASCADE)
  token       UUIDField, unique=True, db_index=True, default=uuid.uuid4
  expires_at  DateTimeField  (now + 7 days at creation)
```
Single-use. The exchange endpoint deletes the token immediately after issuing the JWT.

### 3. `POST /auth/magic/send/`
- Permission: admin/manager only (marina staff).
- Takes `member_id`.
- Finds or creates a `User` with `role='boater'` linked to that Member.
- **Deletes all existing MagicTokens for that user before creating a new one.** This ensures only the newest link is valid — prevents boaters from clicking an older email link and hitting a confusing "Token Invalid" error.
- Creates a new `MagicToken` (7-day expiry).
- Emails the magic link to the member's email address.

### 4. `POST /auth/magic/exchange/`
- Public (no auth required).
- Takes `token` (UUID string).
- Validates: token exists, `expires_at` is in the future.
- Deletes the token (single-use).
- Returns the same payload as `POST /auth/token/`: `{ access, refresh, user: { id, email, first_name, last_name, role } }`.

No changes to existing auth endpoints, serializers, or JWT refresh logic.

---

## Boater Portal UI (`/portal`)

### Shell
Full-height white page. Fixed header bar — navy background (`#0c1f3d`), Lucide `anchor` icon (20px) + marina name (IBM Plex Sans 600) + boater's name in `--color-gray-300`. No sidebar, no topbar.

Below the header: `.tabs` / `.tab` / `.tab.active` strip with three tabs. Content scrolls underneath with `padding-bottom: 80px` to clear the iOS home indicator.

### Invoices tab
Each invoice renders as a `.card` (`border-radius: 12px`, `var(--shadow-card)`, whisper border).

- Left: invoice number (IBM Plex Sans 600), amount (`--type-h4` size), due date (`--text-secondary`)
- Right: `.badge` — `.badge-gold` for unpaid, `.badge-green` for paid
- Bottom: full-width `.abtn.abtn-gold` "Pay Now" button — hidden once paid

Tapping "Pay Now" opens the Stripe payment sheet.

### Absence tab
Single `.card` with a form:
- `<select>` — absence type: Day trip / Overnight / Extended
- Two `<input type="date">` fields — "Departure" and "Return"
- `<textarea>` — optional notes

All inputs use design system spec. Submit: full-width `.abtn.abtn-primary` "Report Absence".

On success, a `.badge-green` confirmation briefly replaces the form, then resets.

### Crane tab
Single `.card` with a form:
- `<input type="date">` — requested lift date
- `<select>` — service type: Launch / Haul-out / Both
- `<textarea>` — notes

Submit: full-width `.abtn.abtn-primary` "Request Crane Lift".

On submit, creates a `HaulOut` record with `status='requested'`. The boater then sees a read-only confirmation card with request details and a `.badge-gold` "Pending" badge until the marina approves.

---

## PWA Setup

Install `vite-plugin-pwa`. Configure:
- App name: "DockBase"
- Theme colour: `#0c1f3d` (navy)
- Display: `standalone` (hides browser chrome on home screen)
- Icons: 192×192 and 512×512 from the existing logo SVG
- Cache strategy: network-first for API calls, cache-first for static assets

Staff are instructed to tap "Add to Home Screen" on day one. For boaters, the magic link opens in the browser — no installation required.

---

## Design System Rules (enforced throughout)

- Font: `--font-app` (IBM Plex Sans) for all portal/login UI
- Primary button: `.abtn.abtn-primary` (navy `#0c1f3d`, `border-radius: 3px`)
- Gold action button: `.abtn.abtn-gold`
- Inputs: `border: 1px solid #dddddd; border-radius: 4px; padding: 7px 10px`
- Focus ring: `box-shadow: 0 0 0 3px rgba(9,127,232,0.12)`
- Cards: `border-radius: 12px`, `var(--shadow-card)`, `1px solid rgba(0,0,0,0.1)`
- No emoji anywhere — use Lucide SVG icons only
- No inline styles — all new styles go in `src/styles/app.css`
- Colours via CSS variables only (`--color-navy`, `--color-accent`, etc.)

---

## What Is Not Changing

- `DesktopApp` component and all admin screens — untouched
- `Field.jsx` and the `/field` route — untouched
- All existing hooks and API calls — untouched
- Existing JWT refresh logic in `api.js` — untouched
