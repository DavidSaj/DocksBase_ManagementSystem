# Marina Signup Wizard — Design Spec
**Date:** 2026-05-05
**Status:** Approved

---

## Overview

Replace the in-app signup screen with a polished 5-step wizard on the public website (`website/`). Collect marina details, owner details, plan selection, and payment before creating the account. Use Stripe's Payment Element (embedded) for PCI-compliant card collection. Implement a "Draft Account" architecture so incomplete signups are recoverable via abandoned-cart emails.

---

## Architecture

Three systems are involved:

| System | Responsibility |
|---|---|
| Website (Vite React) | 5-step wizard at `/signup` |
| Backend (Django) | Draft account endpoint, Stripe integration, webhooks, cron |
| Management app (React) | Signup screen replaced with redirect; new Billing settings panel |

---

## Wizard Steps (Website)

Single page at `/signup`. Progress bar shows steps 1–4. Step 5 is a static confirmation (no progress bar). Design system: navy/gold/cream, Cormorant Garamond headings, Jost body — matches the rest of the public site.

State is managed in a single top-level `SignupPage` component with `useState`. No external state library needed.

### Step 1 — Choose Plan

Three plan cards side by side. Clicking selects the plan. "Most popular" badge on Professional.

Plan config lives in `website/src/config/plans.js`:
```js
export const PLANS = [
  { key: 'starter',      name: 'Starter',      monthlyPrice: 149, stripePriceId: import.meta.env.VITE_STRIPE_PRICE_STARTER },
  { key: 'professional', name: 'Professional',  monthlyPrice: 349, stripePriceId: import.meta.env.VITE_STRIPE_PRICE_PROFESSIONAL },
  { key: 'enterprise',   name: 'Enterprise',    monthlyPrice: 899, stripePriceId: import.meta.env.VITE_STRIPE_PRICE_ENTERPRISE },
]
```

To change a price in future: create a new Stripe Price in the dashboard, update the env var. No code changes.

### Step 2 — Marina Details

Fields (all required except VAT):
- Marina name
- Address (text input + Google Places autocomplete, populates hidden `lat`/`lng`)
- Phone
- Contact email
- VAT number (optional)
- Currency (dropdown: EUR, GBP, USD, DKK, SEK, NOK)

### Step 3 — Owner Account

Fields:
- First name, last name
- Email
- Password (min 8 chars, strength indicator)

On "Next": fires `POST /api/v1/onboarding/draft-account/` with all accumulated form data. Button shows spinner while in flight. On success, stores returned `client_secret` in component state and advances to step 4.

### Step 4 — Payment

Stripe Payment Element mounted with the `client_secret`. Summary sidebar shows: selected plan name + price, marina name.

"Start 30-day trial" button calls `stripe.confirmPayment()` with `return_url` pointing to `/signup/success`. Stripe handles 3DS natively inside the element.

### Step 5 — Confirmation

Static screen: "You're almost there — check your inbox." No further wizard action. The Stripe webhook activates the account and triggers the verification email in the background.

---

## Backend

### Marina Model Changes

New fields on `Marina`:
- `stripe_customer_id` — `CharField(max_length=64, blank=True, null=True)`
- `stripe_subscription_id` — `CharField(max_length=64, blank=True, null=True)`
- `abandon_email_sent` — `BooleanField(default=False)` — prevents repeat abandoned-cart emails

Updated `status` choices:
```python
STATUS_CHOICES = [
    ('pending_payment', 'Pending Payment'),
    ('trial',           'Trial'),
    ('active',          'Active'),
    ('suspended',       'Suspended'),
]
```

### Plan Config

`backend/config/plans.py` — single source of truth for plan → Stripe Price ID mapping:
```python
import os
PLAN_PRICE_IDS = {
    'starter':      os.environ['STRIPE_PRICE_STARTER'],
    'professional': os.environ['STRIPE_PRICE_PROFESSIONAL'],
    'enterprise':   os.environ['STRIPE_PRICE_ENTERPRISE'],
}
```

### New Endpoint: `POST /api/v1/onboarding/draft-account/`

**Request body:**
```json
{
  "plan_price_id": "price_xxx",
  "marina_name": "Harbour View Marina",
  "address": "...", "lat": 51.5, "lng": -0.1,
  "phone": "+44...", "contact_email": "...",
  "vat_number": "...", "currency": "EUR",
  "first_name": "David", "last_name": "Smith",
  "email": "david@example.com", "password": "..."
}
```

**Logic:**
1. Validate all fields. Check email uniqueness:
   - If User exists with `marina.status` in `['trial', 'active']`: return `400` with `{"email": "An account with this email already exists. Please log in."}`.
   - If User exists with `marina.status='pending_payment'`: skip creation steps, look up existing Stripe subscription, return existing `client_secret` (idempotency).
2. Validate `plan_price_id` is one of the known price IDs from `PLAN_PRICE_IDS`.
3. Create `Marina(status='pending_payment', ...)`.
4. Create `User(role='owner', is_active=False, marina=marina, ...)`.
5. `stripe.Customer.create(email=email, name=marina_name, metadata={'marina_id': marina.id})` → store `stripe_customer_id` on Marina.
6. `stripe.Subscription.create(customer=customer_id, items=[{'price': plan_price_id}], payment_behavior='default_incomplete', trial_period_days=30, expand=['latest_invoice.payment_intent'])` → store `stripe_subscription_id` on Marina.
7. Return `{ "client_secret": subscription.latest_invoice.payment_intent.client_secret }`.

**Response:** `201` with `client_secret`. On validation error: `400` with field errors.

### Stripe Webhooks

Added to the existing Stripe webhook view (`/api/v1/stripe/webhook/`):

| Event | Action |
|---|---|
| `customer.subscription.updated` (status → active) | Look up Marina by `stripe_customer_id`. Set `status='trial'`, `trial_ends=datetime.fromtimestamp(event.data.object.trial_end)`. Call `send_verification_email(user)`. |
| `customer.subscription.deleted` | Set Marina `status='suspended'`. |
| `invoice.payment_failed` | Email the owner: card was declined, link to update payment details. |

All webhook handlers verify Stripe signature before processing.

### Abandoned-Cart Cron Job

`backend/apps/accounts/management/commands/chase_pending_signups.py`

- Finds all Marinas with `status='pending_payment'` and `created_at < now - 2 hours`
- Sends one email per Marina (tracked via a `abandon_email_sent` boolean field on Marina to avoid repeat sends)
- Email: "Hey [first_name], looks like you didn't finish setting up [marina_name]. Click here to resume."
- Resume URL: `{WEBSITE_URL}/signup/resume?email={encoded_email}` — pre-fills the wizard and skips to step 4 by re-fetching the `client_secret` from the backend

Scheduled via cron or Celery beat to run every 24 hours.

---

## Billing Settings Panel (Management App)

New "Billing" tab added to the existing Settings screen.

**Displays:**
- Current plan name + monthly price
- Trial end date (if in trial) or next renewal date
- Card on file: brand + last 4 digits (fetched from Stripe via backend)

**Actions:**
- **Cancel subscription** — confirmation modal: "Your account stays active until [end of period]. After that it will be suspended." Calls `POST /api/v1/billing/cancel/`.
- **Change plan** — modal showing the three plan options. Calls `POST /api/v1/billing/change-plan/`. Prorated immediately.

### New Billing Endpoints

| Method | URL | Action |
|---|---|---|
| `GET` | `/api/v1/billing/` | Returns plan, status, trial_end, next_renewal, card last4 + brand |
| `POST` | `/api/v1/billing/cancel/` | `stripe.Subscription.modify(cancel_at_period_end=True)` |
| `POST` | `/api/v1/billing/change-plan/` | `stripe.Subscription.modify(items=[new_price_id])` |

All billing endpoints require authenticated owner or manager role.

---

## Management App Signup Redirect

`frontend/src/screens/Signup.jsx` is replaced with:
```jsx
import { useEffect } from 'react'
export default function Signup() {
  useEffect(() => { window.location.href = `${import.meta.env.REACT_APP_WEBSITE_URL}/signup` }, [])
  return null
}
```

---

## Email Flows

| Trigger | Email |
|---|---|
| Stripe webhook activates subscription | Verification email (existing `send_verification_email`) |
| `invoice.payment_failed` | "Card declined — update payment details" |
| Abandoned-cart cron (2h+ in `pending_payment`) | "Finish setting up [marina_name]" with resume link |

---

## Environment Variables

**Website (`.env`):**
```
VITE_STRIPE_PUBLISHABLE_KEY=pk_live_...
VITE_STRIPE_PRICE_STARTER=price_...
VITE_STRIPE_PRICE_PROFESSIONAL=price_...
VITE_STRIPE_PRICE_ENTERPRISE=price_...
```

**Backend (`.env`):**
```
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PROFESSIONAL=price_...
STRIPE_PRICE_ENTERPRISE=price_...
```

---

## Out of Scope

- Invoice history / download (future)
- Updating card on file (future — Stripe Customer Portal or a separate flow)
- Coupon / promo code support (future)
- Annual billing option (future)
