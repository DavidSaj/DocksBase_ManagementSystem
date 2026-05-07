# Spec: Boater Portal Redesign + Embedded Stripe Payment

**Date:** 2026-05-07  
**Branch:** feature/map-editor-city-builder (to be merged or continued)  
**Status:** Approved

---

## Overview

Two parallel improvements to the boater-facing portal:

1. **Visual redesign** — adopt the dark navy + gold maritime theme from the webmock, with subtle entrance animations and premium typography.
2. **Embedded Stripe payment** — replace the current external Stripe Checkout redirect with an inline `PaymentElement` modal that keeps the user in the portal throughout.

---

## 1. Visual Theme

### Design tokens (no changes needed)
The existing `tokens.css` already defines all required values: `--navy`, `--navy2`, `--navy3`, `--gold`, `--gold2`, `--cream`, `--font-serif` (Cormorant Garamond), `--font-brand` (Jost), `--font` (IBM Plex Sans).

### Login screen (`Login.jsx`)

- Full-page dark navy background with a subtle diagonal gradient matching the webmock hero: `linear-gradient(155deg, var(--navy) 55%, #1a3d52 100%)`.
- Centered card: `--navy2` surface, `1px solid rgba(184,150,90,0.18)` border, deep shadow.
- Logo: larger anchor SVG in gold (`--gold`) + "DocksBase" in Jost uppercase with 2.5px letter-spacing.
- "Sign in" heading: Cormorant Garamond, ~32px, cream.
- Inputs: dark navy bg (`--navy`), cream text, gold focus ring (`outline: 2px solid var(--gold)`).
- Submit: full-width gold button, navy text, matching webmock `btn-gold`.
- Entrance animation: card fades in + slides up 16px over 350ms on mount (CSS `@keyframes` + `animation`).

### Portal shell (`BoaterPortal.jsx`)

- Background: `--navy` throughout.
- **Header:**
  - Anchor SVG icon in gold.
  - One-time pulsing gold ring animation on first render (scale 1→1.6, opacity 1→0, 600ms, runs once).
  - Marina name: Cormorant Garamond, ~20px, cream.
  - Boater name: IBM Plex Sans, 12px, `rgba(245,240,230,0.5)`.
  - "Sign out" button: ghost style, small, muted cream.
- **Tabs:**
  - Uppercase, 10px, 2px letter-spacing (Jost).
  - Active: cream text, 2px gold bottom border.
  - Inactive: `rgba(255,255,255,0.45)`, no border.
  - Transition: color + border-color 150ms.
- **Tab content animation:** on tab switch, content area fades in + slides up 12px over 150ms ease-out. Implemented with a `key` prop change on the content wrapper + CSS animation.
- **Cards:** `--navy2` surface, `1px solid rgba(184,150,90,0.15)` border, `box-shadow: 0 2px 12px rgba(0,0,0,0.3)`.

---

## 2. Invoice Cards (Dark Theme)

Each invoice card:
- **Invoice ref** (`INV-123`): 10px, Jost uppercase, gold, tracked.
- **Amount**: Cormorant Garamond, ~28px, cream — the visual centrepiece.
- **Due date**: 12px, `rgba(245,240,230,0.5)`.
- **Status badge** adapted for dark backgrounds:
  - `paid`: `background: rgba(26,140,46,0.2)`, `color: #5dd87a`
  - `unpaid`: `background: rgba(184,150,90,0.15)`, `color: var(--gold2)`
  - `overdue`: `background: rgba(192,57,43,0.2)`, `color: #f08080`
- **"Pay Now" button**: full-width gold button, only shown for `unpaid`/`overdue`.

---

## 3. Embedded Payment Flow

### Backend — new endpoint

**`POST /api/v1/portal/invoices/<pk>/pay/`**

- Permission: `IsAuthenticated`, boater role, invoice belongs to the boater's marina.
- Validates invoice status is `unpaid` or `overdue` (not `paid`).
- Creates a Stripe `PaymentIntent` via `stripe.PaymentIntent.create(...)` with `stripe_account=marina.stripe_account_id`.
- Idempotent: if `invoice.stripe_payment_intent_id` is set and the intent status is still `requires_payment_method`, retrieve and return that intent's `client_secret` instead of creating a new one.
- Stores `stripe_payment_intent_id` on the invoice.
- Response: `{ client_secret, amount, currency, stripe_account_id }`.
  - `stripe_account_id` is the marina's `stripe_account_id` (needed by the frontend to initialise Stripe for the connected account).
- Added to `portal/urls.py` as `path('portal/invoices/<int:pk>/pay/', PortalInvoicePayView.as_view())`.

### Frontend — dependencies

Install `@stripe/stripe-js` and `@stripe/react-stripe-js` into `frontend/package.json`.

Add `VITE_STRIPE_PUBLISHABLE_KEY` to `.env.local` and `.env.example`.

### Frontend — PaymentModal component

New file: `frontend/src/components/portal/PaymentModal.jsx`

**Props:** `invoice` (id, amount, ref), `onClose()`, `onPaid(invoiceId)`

**Behaviour:**
1. On mount, calls `POST /api/v1/portal/invoices/<pk>/pay/` to get `client_secret`.
2. Initialises Stripe with `loadStripe(VITE_STRIPE_PUBLISHABLE_KEY, { stripeAccount: stripe_account_id })`.
   - `stripe_account_id` comes from the backend response — required for Stripe Connect accounts.
3. Wraps content in `<Elements stripe={...} options={{ clientSecret, appearance }}>`.
4. **Stripe Appearance API** — dark theme:
   ```js
   appearance: {
     theme: 'night',
     variables: {
       colorPrimary: '#b8965a',
       colorBackground: '#162d52',
       colorText: '#f5f0e6',
       fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
       borderRadius: '6px',
     }
   }
   ```
5. Shows `<PaymentElement />` inside the modal.
6. Submit calls `stripe.confirmPayment({ elements, confirmParams: { return_url: window.location.href } })`.
   - Uses `redirect: 'if_required'` so card payments complete inline without a redirect.
7. **States:**
   - `loading`: spinner while fetching client_secret.
   - `ready`: form shown.
   - `submitting`: button disabled, "Processing…" text.
   - `success`: checkmark icon, "Payment received" in gold, auto-closes after 2s, calls `onPaid(invoiceId)`.
   - `error`: Stripe error message shown inline below the form.

**Modal shell:**
- Full-screen dark overlay (`rgba(0,0,0,0.6)`).
- Centered `--navy2` card, gold border, 480px max-width.
- "Pay Invoice" heading in Cormorant Garamond.
- Amount (`CHF X.XX`) in large gold serif before the Stripe fields.
- "Pay CHF X.XX" gold full-width submit button.
- Small "Cancel" ghost link underneath.
- Card entrance: fade-in + scale from 0.97 → 1, 250ms.

### Frontend — hook update

`usePortalInvoices.js` gains a `markPaid(invoiceId)` helper that optimistically updates the local invoice list status to `paid` when `onPaid` fires, without a full refetch.

---

## 4. Scope Boundaries

- No changes to the staff-facing management portal (sidebar layout, Overview, Vessels etc.).
- The existing `InvoiceCheckoutView` (Stripe Checkout redirect) is left in place — it is used by the public booking flow and should not be touched.
- No changes to the `StripeGateModal` (marina onboarding — out of scope).
- Portal pages other than Login, BoaterPortal, and InvoicesTab are restyled (Berth, Vessel, Crane, Absence tabs) but receive the same dark card treatment with no layout changes.

---

## 5. Files Changed

| File | Change |
|------|--------|
| `frontend/src/screens/Login.jsx` | Dark theme, entrance animation |
| `frontend/src/screens/BoaterPortal.jsx` | Dark shell, tab animations, dark cards for all tabs |
| `frontend/src/styles/app.css` | New portal CSS classes (`.portal-shell`, `.portal-header`, `.portal-tabs`, `.portal-card`, `.portal-invoice-amount`, etc.) |
| `frontend/src/components/portal/PaymentModal.jsx` | New — embedded Stripe payment |
| `frontend/src/hooks/usePortalInvoices.js` | Add `markPaid` helper |
| `frontend/package.json` | Add `@stripe/stripe-js`, `@stripe/react-stripe-js` |
| `frontend/.env.example` | Add `VITE_STRIPE_PUBLISHABLE_KEY` |
| `backend/apps/portal/urls.py` | Add `portal/invoices/<pk>/pay/` |
| `backend/apps/portal/views.py` | Add `PortalInvoicePayView` |
| `backend/apps/billing/models.py` | No change — `stripe_payment_intent_id` already exists |
