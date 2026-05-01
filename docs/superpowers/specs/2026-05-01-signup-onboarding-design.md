# Sign-Up & Onboarding Design

**Goal:** Allow marina operators to self-register, verify their email, and be guided through initial setup via a progressive in-app checklist.

**Architecture:** Public sign-up form → email verification (SMTP-stubbed) → land in app → setup guide card on dashboard → feature-gated stripe unlock.

**Tech Stack:** Django DRF (backend), React + Vite (frontend), existing SimpleJWT auth, existing design system classes.

---

## 1. Backend

### New endpoints (all in `apps/accounts/`)

#### `POST /api/v1/auth/signup/`
Permission: AllowAny

Request body:
```json
{ "first_name": "...", "last_name": "...", "email": "...", "password": "...", "marina_name": "..." }
```

Behaviour (single DB transaction):
1. Validate email is unique.
2. Create `Marina` — `status: 'trial'`, `trial_ends: today + 30 days`, `plan: 'professional'`.
3. Create `User` — `role: 'owner'`, `is_active: False`, FK to marina.
4. Create `EmailVerification` record (UUID token, 24h expiry).
5. Call `send_verification_email(user, token)` — **SMTP stub, see Section 5**.
6. Return `{ "detail": "Check your email to confirm your account." }` (HTTP 201).

On duplicate email: return HTTP 400 `{ "email": ["A user with this email already exists."] }`.

#### `GET /api/v1/auth/verify-email/?token=<uuid>`
Permission: AllowAny

Behaviour:
1. Look up `EmailVerification` by token. If not found → 400 `{ "detail": "Invalid or expired link." }`.
2. Check `created_at + 24h > now`. If expired → 400 same message.
3. Set `user.is_active = True`, delete the `EmailVerification` record.
4. Issue JWT pair (access + refresh) for the user.
5. Return `{ "access": "...", "refresh": "...", "user": { ... } }`.

Frontend stores the JWT and redirects to `/` — user is in the app without a second login.

#### `POST /api/v1/auth/resend-verification/`
Permission: AllowAny

Request body: `{ "email": "..." }`

Behaviour:
1. Look up user by email. If not found or already active → return 200 (no information leak).
2. Enforce 60-second cooldown per email using Django's cache framework (`cache.get(f"resend:{email}")`). Return 429 if within window.
3. Delete any existing `EmailVerification` for this user, create a new one.
4. Call `send_verification_email(user, token)`.
5. Set cache key with 60s TTL.
6. Return `{ "detail": "Verification email resent." }`.

### New model: `EmailVerification`

```python
class EmailVerification(models.Model):
    user       = models.OneToOneField(User, on_delete=models.CASCADE, related_name='email_verification')
    token      = models.UUIDField(default=uuid.uuid4, unique=True, db_index=True)
    created_at = models.DateTimeField(auto_now_add=True)
```

Expiry is checked at exchange time (`created_at + timedelta(hours=24) < now()`). No cron needed.

### Onboarding progress

New JSONField on `Marina`:

```python
onboarding = models.JSONField(default=dict)
```

Default value (set in migration or `save()` override):
```python
{ "draw_map": False, "set_pricing": False, "connect_bank": False, "invite_staff": False }
```

`connect_bank` auto-completes: set to `True` whenever `marina.stripe_account_id` becomes non-empty (post_save signal or in the Stripe Connect view when that is built).

`invite_staff` auto-completes: post_save signal on `User` — when an active, non-boater user is saved with `marina_id` set, count active marina users; if count ≥ 2, mark `invite_staff: True` on the marina.

#### `GET /api/v1/auth/marina/onboarding/`
Permission: IsMarinaStaff

Returns current `marina.onboarding` dict.

#### `PATCH /api/v1/auth/marina/onboarding/`
Permission: IsMarinaStaff

Accepts any subset of the 4 keys (boolean values). Merges into existing dict and saves. Returns updated dict.

---

## 2. Frontend — New Routes

Add to `frontend/src/App.jsx`:

| Route | Component | Access |
|---|---|---|
| `/signup` | `Signup.jsx` | Public |
| `/verify-email` | `VerifyEmail.jsx` | Public |

`/login` gets a "Don't have an account? Sign up →" link.

### `Signup.jsx`

Fields: First name, Last name, Email, Password, Marina name. Single "Create account" button.

On submit: `POST /auth/signup/`. On success: transitions within the same screen to a confirmation state — "Check your inbox at {email}. Click the link to activate your account." + "Resend email" button (calls resend endpoint, disabled for 60s after click, countdown shown).

On error: show field-level validation messages inline.

### `VerifyEmail.jsx`

Reads `?token=` from URL on mount, immediately calls `GET /auth/verify-email/?token=...`.

- Loading state: spinner, "Verifying your email…"
- Success: stores JWT + user via existing `storeUser()` / token helpers, redirects to `/`.
- Failure: "This link has expired or is invalid. [Back to sign up]" link to `/signup`.

### Auth gate for `is_active=False`

No special case needed. If an inactive user somehow holds a token, `GET /auth/me/` returns 401, the existing axios interceptor clears auth and redirects to `/login`.

---

## 3. Setup Guide Card

Rendered at the top of `Overview.jsx`, above the stat cards, when any onboarding step is `False`. Disappears permanently once all four are `True` (no dismiss button — completion is the only exit).

### `useOnboarding` hook (`frontend/src/hooks/useOnboarding.js`)

- Fetches `GET /auth/marina/onboarding/` on mount.
- Exposes `{ onboarding, markStep, loading }`.
- `markStep(key)`: optimistically sets the key to `True` locally, then calls `PATCH /auth/marina/onboarding/` with `{ [key]: true }`.

### The four steps

| Key | Label | Click action |
|---|---|---|
| `draw_map` | Draw your marina map | Navigate to Marina Map screen |
| `set_pricing` | Set your pricing | Navigate to Billing screen |
| `connect_bank` | Connect bank account | Open `StripeGateModal` (see Section 4) |
| `invite_staff` | Invite your first team member | Navigate to Staff screen |

### Visual design

Card uses existing `card`, `card-header`, `card-body` classes.

Header: "Get started with DocksBase" + progress fraction e.g. "2 of 4 complete".
Progress bar: `<div class="progress-bar">` filled to `(completed / 4) * 100%`.
Each row: checkbox icon (filled SVG if done, outline if pending) + label + right-arrow chevron. Completed rows are muted (`opacity: 0.45`, `text-decoration: line-through`).

---

## 4. Feature Gate — Stripe Connect

**Trigger:** Any UI element that enables online booking acceptance (e.g. a toggle in `Operations.jsx`) checks `marina.stripe_account_id`. If empty, it blocks the toggle and opens `StripeGateModal`.

### `StripeGateModal.jsx`

A centred modal using existing modal/overlay CSS classes.

Content:
- Title: "Connect your bank account"
- Body: "To accept online payments, DocksBase needs to know where to send your money."
- Primary button: "Connect via Stripe" — **disabled**, tooltip "Stripe Connect coming soon"
- Secondary button: "Cancel" — closes modal

The toggle remains off. No state is changed. When Stripe Connect is implemented, only the primary button's handler needs to be wired — no other structural changes.

---

## 5. SMTP Stubs (Future Work)

New file: `backend/apps/accounts/emails.py`

```python
def send_verification_email(user, token):
    """
    FUTURE: Implement with SendGrid or django-ses.
    Send to:   user.email
    Subject:   "Confirm your DocksBase account"
    Body:      Link to /verify-email?token={token}  (frontend URL)
    """
    print(f"[EMAIL STUB] Verification link for {user.email}: /verify-email?token={token}")

def send_welcome_email(user):
    """
    FUTURE: Send after email is verified.
    Subject:   "Welcome to DocksBase"
    Body:      Getting-started tips, link to the setup guide.
    """
    print(f"[EMAIL STUB] Welcome email for {user.email}")
```

Both are imported and called from views. To activate real email: implement these two functions only — no view changes required.

**SMTP checklist for future build:**
- [ ] Choose provider: SendGrid (recommended) or AWS SES
- [ ] Add `EMAIL_BACKEND`, `EMAIL_HOST`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD` to Railway env vars
- [ ] Set `DEFAULT_FROM_EMAIL = "noreply@docksbase.com"` in settings
- [ ] Replace `print()` in `emails.py` with `django.core.mail.send_mail()` or provider SDK
- [ ] Call `send_welcome_email(user)` from `verify-email` view on successful verification
- [ ] Test with a real inbox before going live

---

## 6. Out of Scope (This Build)

- Actual Stripe Connect flow (only the gate modal is built)
- Password reset / forgot password flow
- Social sign-in (Google, Apple)
- Marina subdomain provisioning
- Admin-initiated marina creation (still works via Django admin as before)
