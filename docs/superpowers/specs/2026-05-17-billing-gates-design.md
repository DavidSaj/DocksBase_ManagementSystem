# Billing Safety Gates — Spec

Status: DRAFT (awaiting user review — do not implement)
Author: research synthesis from current codebase
Date: 2026-05-17
Scope: Two related platform-billing features
  - (A) Unpaid-marina blocking (dunning enforcement when a marina fails to pay DocksBase)
  - (B) Manual-contract marina flag (bypass Stripe billing for offline-contract marinas)

---

## 0. Background — what exists today

Marinas pay DocksBase via Stripe Subscription (separate from the per-booking
Stripe Connect flow where boaters pay marinas).

Relevant existing pieces:

- `Marina` model — `backend/apps/accounts/models.py:19-224`
  - `plan` (`CharField`, default `'professional'`) — `models.py:25`
  - `status` choices: `pending_payment | trial | active | suspended` — `models.py:48-54`
  - `trial_ends` (`DateField`) — `models.py:55`
  - `next_renewal` (`DateField`) — `models.py:56`
  - `suspend_reason` (`TextField`) — `models.py:57`
  - `operations_paused` (`BooleanField`) — `models.py:37` (currently used only by utility-sweep tasks; see `apps/utilities/tasks.py:41`, `apps/revenue_intelligence/tasks.py:134`)
  - `stripe_customer_id`, `stripe_subscription_id`, `abandon_email_sent` — `models.py:45-47`
  - `features` (`JSONField`) — `models.py:58` (already used as a feature-flag bag in several apps, e.g. `apps/sustainability/views.py:45`, `apps/access_control/hal/factory.py:43`)
  - `mrr_override` (`IntegerField`) — `models.py:62` (manual MRR override; partially anticipates manual-contract case)
- Stripe webhook entrypoint — `backend/apps/billing/views.py:317-402` (`StripeWebhookView`)
- Subscription lifecycle handler — `backend/apps/billing/views.py:33-58` (`_handle_marina_subscription_event`)
  - Today: on `customer.subscription.deleted` → sets `marina.status = 'suspended'`
  - Today: on `customer.subscription.updated` with status `trialing|active` → sets `marina.status = 'trial'` and `trial_ends`
- Payment-failed handler — `backend/apps/billing/views.py:272-280` (`_handle_marina_payment_failed`)
  - Today: only emails the owner via `send_payment_failed_email`. **No state change. No access blocking. This is the core gap (A) addresses.**
- Subscription self-service — `SubscriptionBillingView`, `CancelSubscriptionView`, `ChangePlanView` — `backend/apps/billing/views.py:927-1047`
- Super-admin marina management — `backend/apps/admin_portal/views.py`
  - `AdminMarinaSuspendView` — `views.py:169-179` (manual suspend)
  - `AdminMarinaReinstateView` — `views.py:182-191`
  - `AdminMarinaConvertView` — `views.py:194-213` (trial → active)
  - `AdminMarinaDetailView` PATCH — `views.py:160-166` (writes via `MarinaUpdateSerializer`)
- Update serializer — `backend/apps/admin_portal/serializers.py:66-70` (`MarinaUpdateSerializer` — fields: `plan, status, trial_ends, next_renewal, suspend_reason, features, mrr_override, max_staff, name, contact_email`)
- AuditLog — `backend/apps/admin_portal/models.py:28-46` and helper `_log(...)` in `backend/apps/admin_portal/views.py:37-43`
- Permission classes — `backend/apps/admin_portal/permissions.py:4-12` (`IsPlatformAdmin`)
- Plans constants — `backend/config/plans.py` (`starter | professional | enterprise`, monthly prices 149/349/899)
- Plan-feature gating today is **ad-hoc, via `marina.features` JSONField** (no central decorator/middleware). Examples:
  - `apps/sustainability/views.py:45` — `if not request.user.marina.features.get('esg_enabled', False): return 403`
  - `apps/access_control/serializers.py:147` — per-feature `anpr_enabled` check
- Tenant middleware (resolves slug → `request.tenant`) — `backend/apps/accounts/middleware.py:5-26`. Does **not** check billing status.
- `PlatformPayment` model — `backend/apps/admin_portal/models.py:4-25` (status: `paid | due | overdue`). Currently a manual/visible record only — not driven by webhooks.

### Today's failure mode (the user's concern)

1. Marina's card declines → Stripe sends `invoice.payment_failed`.
2. `_handle_marina_payment_failed` sends one email and returns.
3. Stripe retries per its automatic dunning schedule. If retries exhaust, Stripe fires `customer.subscription.deleted` → marina is set to `suspended`.
4. **But "suspended" is not actually enforced anywhere in request handling.** No middleware, no permission class, no view-level check refuses requests from a suspended marina. The marina keeps using DocksBase.
5. Worse: between failure and final cancellation (which on Stripe's default smart-retry can be 1–3 weeks), there is **no visible state at all** beyond a single email.

---

## FEATURE A — UNPAID-MARINA BLOCKING

### A.1 Problem statement

> "there needs to be bigger safety on when marina doesnt pay if they made over stripe. like block everything if not paid or idk."
> — user

We need a graduated dunning lifecycle that:
- Gives the marina clear warning and chances to fix it.
- Progressively restricts platform access as days-past-due grows.
- Hard-blocks only the marina's staff/managers — **does not punish boaters** who already paid the marina or are mid-stay.
- Preserves data (never destructive; reversible the second a payment succeeds).
- Gives super-admin override / grace controls.

### A.2 Data model changes

Add to `Marina` (in `apps/accounts/models.py`):

```
billing_state          CharField(20)   default='current'
billing_state_since    DateTimeField   null=True
billing_grace_until    DateTimeField   null=True
billing_failure_count  IntegerField    default=0
billing_last_failure_at DateTimeField  null=True
billing_admin_override BooleanField    default=False
billing_admin_override_reason TextField blank=True
billing_admin_override_set_by FK(User, null=True, on_delete=SET_NULL)
billing_admin_override_set_at DateTimeField null=True
billing_admin_override_expires_at DateTimeField null=True
```

`billing_state` choices (NEW state machine, **independent of `Marina.status`** so we don't break the existing `pending_payment | trial | active | suspended` flow):

| value           | meaning                                                    | trigger                                |
|-----------------|------------------------------------------------------------|----------------------------------------|
| `current`       | Subscription paid and up to date                           | `invoice.paid` on subscription invoice |
| `past_due`      | One+ failed Stripe attempts, still within retry window     | `invoice.payment_failed` (first)       |
| `grace`         | Retries exhausted, in human-grace period (e.g. 7 days)     | `customer.subscription.updated` → `past_due`/`unpaid` after Stripe smart-retries OR explicit grace from admin |
| `restricted`    | Read-mostly mode; staff can wind-down but not grow         | grace expired                          |
| `suspended`     | Hard block for marina staff; boaters still served read-only | restricted + N days, or admin action  |
| `cancelled`     | Subscription deleted in Stripe; data retained, no logins  | `customer.subscription.deleted`        |

Add `BillingStateChange` model in `apps/admin_portal/models.py` (or new `apps/platform_billing/`):

```
marina           FK Marina
from_state       CharField
to_state         CharField
reason           CharField   # 'stripe.invoice.payment_failed' | 'admin_override' | 'grace_expired' | …
stripe_event_id  CharField   blank
actor_user       FK User null  # set when triggered by admin
detail           JSONField
created_at       DateTimeField auto_now_add
```

(Distinct from `AuditLog` because it's append-only billing history we want to graph / report on. Cross-write to `AuditLog` too for admin actions.)

### A.3 State machine / lifecycle

```
                       invoice.paid
        ┌──────────────────────────────────────────────┐
        │                                              │
        ▼                                              │
  ┌──────────┐  payment_failed   ┌──────────┐          │
  │ current  │ ────────────────▶ │ past_due │──────────┤
  └──────────┘                   └──────────┘          │
        ▲                              │               │
        │ invoice.paid                 │ Stripe        │
        │                              │ smart-retries │
        │                              │ exhausted     │
        │                              ▼               │
        │                        ┌──────────┐          │
        │                        │  grace   │──────────┤
        │                        └──────────┘          │
        │                              │               │
        │                              │ grace_until   │
        │                              │ elapses       │
        │                              ▼               │
        │                        ┌────────────┐        │
        │                        │ restricted │────────┤
        │                        └────────────┘        │
        │                              │               │
        │                              │ +N days       │
        │                              ▼               │
        │                        ┌──────────┐          │
        │                        │suspended │──────────┘
        │                        └──────────┘
        │                              │
        │                              │ subscription.deleted
        │                              ▼
        │                        ┌──────────┐
        └────────────────────────│cancelled │  (manual reactivation only)
                                 └──────────┘
```

Defaults (configurable in `backend/config/billing_gates.py`):
- `BILLING_GRACE_DAYS = 7` (after Stripe retries exhaust)
- `BILLING_RESTRICTED_DAYS = 7` (restricted before suspended)
- `BILLING_SUSPENDED_TO_CANCELLED_DAYS = 30` (or rely on Stripe cancelling)
- Override caps: admin override max duration `90 days`, must have written `reason`.

### A.4 What is blocked at each stage

The matrix below assumes the principle **never block boaters from leaving or paying the marina**. "Blocked" means returns HTTP 402 (Payment Required) with a structured error: `{ "error": "marina_billing_blocked", "billing_state": "...", "grace_until": "...", "contact": "billing@docksbase.com" }`.

| Action                                                | current | past_due | grace | restricted | suspended | cancelled |
|-------------------------------------------------------|:-:|:-:|:-:|:-:|:-:|:-:|
| Marina staff/owner login                              | ✓ | ✓ | ✓ | ✓ banner | ✓ banner (wind-down only) | ✗ login refused |
| View dashboards / reports / read data                 | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Subscription self-service (`SubscriptionBillingView`, update card, `ChangePlanView`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (re-activation only) |
| Create new bookings (manual or portal)                | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Check-in / check-out existing bookings                | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| Take payments from boaters (Stripe Connect)           | ✓ | ✓ | ✓ | ✓ | ✗ | ✗ |
| Issue refunds to boaters                              | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (admin-mediated) |
| Send marketing/broadcast SMS or email                 | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Edit pricing / berths / rules                         | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| Invite new staff users                                | ✓ | ✓ | ✗ | ✗ | ✗ | ✗ |
| Public portal — boaters can pay invoices / leave      | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ (read-only) |
| Public portal — new boater bookings                   | ✓ | ✓ | ✓ | ✗ | ✗ | ✗ |
| API key (machine) usage                               | ✓ | ✓ | ✓ | read-only | ✗ | ✗ |
| Webhook deliveries from DocksBase to marina           | ✓ | ✓ | ✓ | ✓ | paused | paused |
| Background tasks (utility sweeps, reports)            | ✓ | ✓ | ✓ | ✓ | paused | paused |

Notes:
- `restricted` ≈ "no new commitments". Existing obligations (current guests, refunds) still flow.
- `suspended` ≈ "lights stay on for guests already on-site, but nothing new starts".
- `cancelled` ≈ data retained 90 days then archived (policy TBD — see open questions).

### A.5 Backend enforcement points

Recommend a **layered** approach (defence in depth — no single bypass):

1. **`BillingGateMiddleware`** (new, sits after `TenantMiddleware` in `accounts/middleware.py`)
   - Resolves the marina from authenticated user (`request.user.marina`) or `request.tenant`.
   - On each request, looks up `marina.billing_state` and the requested path. Compares against a `BLOCKED_PATHS` allow/deny table keyed by URL prefix or view name.
   - Bypasses entirely if:
     - request is unauthenticated, OR
     - request is on the always-allowed list: `/api/billing/subscription/`, `/api/billing/stripe/webhook/`, `/api/auth/`, `/api/portal/...` (boater-facing), `/api/admin_portal/...` (platform admin), OR
     - `marina.manual_contract` is True (Feature B), OR
     - `marina.billing_admin_override` is True and not expired.
   - On block: returns `402 Payment Required` JSON.

2. **`@require_billing_state(*states)` decorator** for sensitive views the middleware path-matching might miss (e.g. management commands, Celery tasks that act on behalf of marina staff).

3. **Per-mutation check in serializers** that create *new* commitments:
   - `BookingSerializer.validate()` rejects if `billing_state in {restricted, suspended, cancelled}`.
   - `BroadcastSerializer.validate()` similarly.
   - Reuses one helper `apps/billing/gates.py::assert_marina_can(marina, action)`.

4. **Login refusal at `suspended`+** — in `TokenObtainPairView` override / `apps/accounts/serializers.py:176` (which already inspects `marina.status`).

5. **Boater portal is explicitly **not** behind the middleware.** Portal URLs resolve marina by slug; we check `marina.billing_state` only for new-booking creation (`restricted+`) and not at all for invoice payment (`cancelled` even — boaters with an outstanding invoice can still pay).

### A.6 Stripe webhook changes

Extend `_handle_marina_subscription_event` and `_handle_marina_payment_failed` in `apps/billing/views.py:33-58, 272-280`:

- `invoice.payment_failed` → call `billing_gates.record_failure(marina, event)`
  - First failure: `current → past_due`. Email owner. Increment `billing_failure_count`.
  - Subsequent failures within retry window: stay `past_due`, increment, email cadence: day 1, day 3, day 7.
- `invoice.paid` (subscription invoice) → `* → current`. Reset counter. Notify owner.
- `customer.subscription.updated` with status `unpaid` or `past_due` after retries → `past_due → grace`. Set `billing_grace_until = now + BILLING_GRACE_DAYS`.
- `customer.subscription.deleted` → straight to `cancelled` (not `suspended` as today).

Add a periodic task (`apps/billing/tasks.py` Celery beat):

- `advance_billing_states()` runs hourly:
  - `grace` where `billing_grace_until < now` → `restricted`
  - `restricted` where `billing_state_since + BILLING_RESTRICTED_DAYS < now` → `suspended`
  - Emit `BillingStateChange` rows + email.

### A.7 UI surface

#### Marina admin app (`marina-admin/`, owner/manager view)

- **Banner component** rendered globally when `billing_state != 'current'`:
  - `past_due` (yellow): "Your last payment failed. Update your card to avoid service interruption."
  - `grace` (orange): "Service will be restricted on {grace_until}. Update card now."
  - `restricted` (red): "Service is restricted. New bookings, broadcasts, and pricing edits are disabled."
  - `suspended` (red, full-page interstitial except for subscription/wind-down pages).
- Banner CTA → `/settings/billing` → `SubscriptionBillingView` (already exists).
- Inline 402 responses surface as a toast: "Action blocked — billing past due."

#### Super-admin app (`admin/`)

- **Marina detail page** (`admin/src/screens/MarinaDetail.jsx`) gains a new "Billing Gate" panel showing:
  - Current `billing_state` + since-when
  - `billing_failure_count`
  - Grace expiry, restricted-since, suspended-since
  - Recent `BillingStateChange` rows (audit timeline)
  - Action buttons (each writes an `AuditLog` row):
    - **Grant override** — sets `billing_admin_override=True` with required `reason` and an expiry up to 90 days. Restores access regardless of `billing_state`.
    - **Revoke override**
    - **Force-advance** — manual jump to next state (with confirmation).
    - **Force-restore** — `* → current` (requires reason; logs prominently).
    - **Extend grace** — add N days to `billing_grace_until`.

- **Overview page** (`AdminOverviewView`, `admin_portal/views.py:95-134`) gains a new alert bucket: marinas in `past_due` / `grace` / `restricted` (today only shows `suspended` and `overdue_payments`).

### A.8 Audit & observability

- Every transition writes a `BillingStateChange` row (immutable).
- Admin overrides additionally write an `AuditLog` row (existing model).
- Slack/PagerDuty alert on:
  - Any marina transition to `suspended` (revenue at risk).
  - Any admin override (governance signal — same channel as the existing break-glass alert at `admin_portal/views.py:46-90`).
- Prometheus / log counters:
  - `billing_state_total{state="..."}` gauge
  - `billing_transitions_total{from,to,reason}` counter
  - `billing_blocked_requests_total{marina_id, path}` counter (sample, with cardinality cap)
- Daily digest email to `billing@docksbase.com` listing marinas in `grace+`.

### A.9 Reactivation flow

When a marina pays a previously-failed invoice (any of these paths):

1. Stripe sends `invoice.paid` for the subscription invoice.
2. Webhook handler transitions `* → current`, clears `billing_grace_until`, resets `billing_failure_count`, writes `BillingStateChange(reason='stripe.invoice.paid')`.
3. Sends "service restored" email to owner.
4. No human admin action required.

If the marina updates the card mid-grace:
- Stripe will retry the open invoice → success → as above.
- We do **not** transition to `current` on `payment_method.attached`; only on actual `invoice.paid` to avoid spoofing.

Manual reactivation by super-admin (e.g. wire transfer agreed):
- Click "Force-restore" in admin → state set to `current`, audit log records actor + reason + ideally a `manual_payment_ref` field.

### A.10 Edge cases

1. **Mid-cycle Stripe retry succeeds before grace.** Just transition back to `current`. Existing in-flight blocks (e.g. a 402'd POST 3 minutes ago) — user retries, succeeds. No special handling.
2. **Boater bookings already confirmed when marina hits `suspended`.** Bookings remain valid. Boater can check in/out via portal. Marina staff can perform check-in (allowed in matrix). Refunds still allowed.
3. **Boater tries to book a `restricted` marina.** Portal returns a friendly "This marina is not accepting new bookings right now" message (not the billing reason — privacy).
4. **Marina disputes the failed payment.** Stripe may flip the invoice back to paid; webhook will restore us. Until then, admin can use override.
5. **Multiple owners.** All owners receive dunning emails. The `_handle_marina_payment_failed` currently picks the first owner (`users.filter(role='owner').first()` at `views.py:278`); spec says **all** active owners.
6. **Stripe webhook lost / delayed.** Daily reconciliation task hits `stripe.Subscription.list()` and reconciles `billing_state` against Stripe's view of truth.
7. **MarinaGroup billing.** `MarinaGroup` has its own `stripe_customer_id` (`apps/accounts/models.py:310+`). If a group pays in bulk, individual marina `billing_state` should follow the group's invoice state. Out of scope for v1 — flag in open questions.
8. **`Marina.status` vs new `billing_state`.** Keep both. `status` is the manual lifecycle (trial/active/suspended set by admin); `billing_state` is automatic from Stripe. UI shows both; enforcement honours either being non-OK. (Open question: do we eventually collapse them?)
9. **Cancelled then resubscribe.** New Stripe subscription → `current`. We don't merge old `BillingStateChange` history; we keep the audit trail intact.
10. **Impersonation by support.** `IsSafeModeReadOnly` (`admin_portal/permissions.py:15-30`) already restricts impersonated sessions to GET. A support agent impersonating a `suspended` marina sees the banner but can't push it past read-only anyway. No conflict.

### A.11 Open questions (Feature A)

1. **Grace period length** — 7 days proposed. Right?
2. **Restricted period length** — 7 days proposed before hard suspend. Right?
3. **Should `suspended` block boater bookings created via marina staff, or only via portal?** Spec says block both — confirm.
4. **Email cadence** — proposed day 1, 3, 7 of past_due, then daily in grace. OK?
5. **Reactivation when admin override expires** — should it auto-snap back to whatever `billing_state` Stripe says (could be `cancelled`)? Spec assumes yes.
6. **Data retention after `cancelled`** — 90 days then archive? Hard delete after a year? Need legal/policy input.
7. **MarinaGroup-level billing** — does v1 handle group subscriptions or punt?
8. **Per-plan tolerance** — should enterprise marinas get a longer grace by default? Or one-size-fits-all configurable?

---

## FEATURE B — MANUAL-CONTRACT MARINA FLAG

### B.1 Problem statement

> "have to add option that marina was created on a seperate signed document with docksbase and not through the normal process"
> — user

Some marinas sign a paper contract with DocksBase Sales and pay by bank transfer / PO against periodic invoices. They never go through Stripe Subscription Checkout. Today there's no way to model that — they look the same as Stripe-onboarded marinas, which means Stripe webhooks would (incorrectly) try to flip them around, dunning would never fire, and admin would have to maintain `mrr_override` manually with no other indication.

### B.2 Data model changes

Add to `Marina`:

```
manual_contract             BooleanField    default=False
manual_contract_signed_at   DateField       null=True, blank=True
manual_contract_signed_by   CharField(200)  blank   # DocksBase counter-signatory
manual_contract_reference   CharField(100)  blank   # internal contract ID
manual_contract_po_number   CharField(100)  blank   # marina's PO if any
manual_contract_notes       TextField       blank
manual_contract_invoice_terms CharField(20) blank   # 'net_30' | 'net_60' | 'annual' | 'custom'
manual_contract_renewal_date DateField      null=True, blank=True
manual_contract_set_by      FK User         null, on_delete=SET_NULL, related_name='+'
manual_contract_set_at      DateTimeField   null=True
```

Optionally store the signed PDF: reuse `apps/documents` (out of scope here — open question).

Audit: every change to `manual_contract` writes an `AuditLog` row with the previous and new values.

### B.3 Who can set the flag

- Only `is_platform_admin=True` users (via `IsPlatformAdmin`, `admin_portal/permissions.py:4-12`).
- Specifically: only `platform_role == 'admin'`, not `platform_role == 'support'` (support cannot create commercial commitments).
- Marina owners/managers themselves **cannot see or set** the flag in marina-admin UI.

Enforcement: extend `MarinaUpdateSerializer` (`admin_portal/serializers.py:66-70`) — but split it. Add a separate `MarinaManualContractSerializer` exposed at a new endpoint `POST /api/admin_portal/marinas/<pk>/manual-contract/` so the action is audited as a discrete event rather than a generic PATCH.

### B.4 What the flag disables

When `marina.manual_contract == True`:

1. **Stripe subscription webhooks are no-ops for this marina.**
   - `_handle_marina_subscription_event` (`apps/billing/views.py:33-58`) early-returns if `marina.manual_contract`.
   - `_handle_marina_payment_failed` (`apps/billing/views.py:272-280`) early-returns.
   - Rationale: these marinas may still have a `stripe_customer_id` if they were created in Checkout and converted, or none at all. Either way, billing state must not be driven by Stripe.
2. **`BillingGateMiddleware` (Feature A) treats them as always `current`.** No dunning, no restriction.
3. **Subscription self-service hidden.**
   - `SubscriptionBillingView` (`apps/billing/views.py:927-965`) returns `409 Conflict` with `{ "billing_managed": "manual_contract", "contact": "billing@docksbase.com" }`.
   - `CancelSubscriptionView` and `ChangePlanView` likewise return `409`.
   - Marina-admin frontend hides the "Update card / Change plan" UI and shows a contract-info card instead.
4. **Stripe sub fields are cleared (optionally).** `stripe_subscription_id` set to `''` to avoid accidental future calls. `stripe_customer_id` kept for boater payouts (it's reused for Connect — actually `stripe_account_id` is the Connect one; the platform `stripe_customer_id` can be safely emptied).
5. **`PlatformPayment` rows are created manually by admin** (one per invoice cut by DocksBase finance), not by Stripe webhooks.

### B.5 What the flag enables

When `marina.manual_contract == True`:

1. **Plan is treated as effectively `enterprise`** for feature gating, but `marina.plan` stays whatever admin set (often `enterprise` or `custom`). All `features.*` JSON gates remain in force (admin can tune per-marina).
2. **Manual-invoice fields visible** in admin marina detail panel: signed-at, signed-by, contract ref, PO number, invoice terms, renewal date, notes.
3. **MRR contribution** uses `mrr_override` (already exists at `Marina.mrr_override`, `apps/accounts/models.py:62`). Admin overview MRR calc (`_mrr_for`, `apps/admin_portal/views.py:33-34`) already prefers `mrr_override`, so manual-contract marinas just need it populated.
4. **Renewal reminder task** — new Celery beat task emails DocksBase finance 30 / 14 / 7 days before `manual_contract_renewal_date`. (Reuses pattern from existing trial-ending alerts in `AdminOverviewView`.)
5. **Admin overview alert bucket** "Manual contracts expiring soon" alongside existing "trials ending soon".

### B.6 State machine

For manual-contract marinas, `billing_state` is effectively pinned to `current` (or a special value):

```
                              admin clears flag
       (Stripe-onboarded) ─────────────────────────┐
                                                    │
                                                    ▼
  ┌─────────────────┐    admin sets flag       ┌───────────────┐
  │ Stripe-billed   │ ───────────────────────▶ │ manual_contract│
  │ billing_state=* │ ◀─────────────────────── │ billing_state= │
  └─────────────────┘    admin clears flag     │ 'manual'       │
                                                └───────────────┘
```

Add `'manual'` to the `billing_state` choices defined in Feature A.

When the flag is **cleared** (rare, but support a path):
- Admin must confirm. Audit logs the actor + reason.
- `billing_state` resets to `current` *only if* the marina has a valid `stripe_subscription_id` that Stripe reports as `active|trialing`. Otherwise → `past_due` immediately (the marina now needs to put a card on file).
- Marina-admin UI re-enables Stripe self-service.

### B.7 UI surface

#### Super-admin (`admin/src/screens/MarinaDetail.jsx`)

- New "Contract" panel at top of marina detail, **prominently styled** when `manual_contract=True` (e.g. tag "MANUAL CONTRACT" next to marina name in lists too).
- Fields editable inline (signed_at, signed_by, reference, PO, terms, renewal, notes).
- Toggle "This marina is on a manual contract" requires a confirmation modal with reason field (audited).
- Documents tab: optional upload of the signed PDF.

#### Marina list (`admin/src/screens/Marinas.jsx`)

- Add a filter chip "Contract type: Stripe | Manual | All".
- Add a column or badge indicating manual-contract marinas.

#### Marina-admin (owner-facing)

- The Billing settings page hides Stripe sub UI; instead shows a card:
  - "Your account is on a custom contract with DocksBase. Contact billing@docksbase.com for any changes."
  - Show `manual_contract_renewal_date` if set, "Your contract renews on X".
  - Show last invoice / payment date (pulled from `PlatformPayment` rows entered by DocksBase finance).
- No price, no card-update form, no "cancel subscription" button.

#### Public portal

- No surface. Boaters see no difference between Stripe and manual-contract marinas.

### B.8 Backend enforcement points

1. **Webhook short-circuits** (`apps/billing/views.py`):
   - At the very top of `_handle_marina_subscription_event` and `_handle_marina_payment_failed`, after `marina` is resolved, `if marina.manual_contract: return`.
2. **Self-service view guards** — `SubscriptionBillingView`, `CancelSubscriptionView`, `ChangePlanView`:
   - Early return with 409 + structured error before talking to Stripe.
3. **`BillingGateMiddleware` bypass** — see Feature A.5 §1.
4. **Stripe customer creation flow** (signup wizard at `apps/accounts/views.py:550+`): does not need changes because manual-contract marinas are typically created in admin **after** the contract is signed — they skip the public Checkout flow entirely.
5. **Admin-only setter** — new view `AdminMarinaSetManualContractView` (POST + PATCH), permission `IsPlatformAdmin` + extra check on `platform_role == 'admin'`.
6. **Helper** `marina.is_billing_managed_externally` (`@property` returning `manual_contract`) — used wherever code branches on this.

### B.9 Audit & observability

- Setting/clearing the flag writes both `AuditLog` (existing) and `BillingStateChange` (Feature A).
- Slack alert when flag is set/cleared — same channel as break-glass alerts (sensitive commercial action).
- Quarterly report listing all manual-contract marinas, their `mrr_override`, renewal dates, and last-invoiced date.

### B.10 Edge cases

1. **Marina was on Stripe sub, then converts to manual contract mid-cycle.**
   - Admin sets flag. Spec: admin must also cancel the Stripe subscription (separate explicit button "Also cancel Stripe sub?") OR leave it active and let it run out. Default: cancel at period end, suppress dunning meanwhile.
   - Webhook will fire `customer.subscription.deleted` at period end — `_handle_marina_subscription_event` early-returns due to flag, no state change.
2. **Marina converts from manual to Stripe.**
   - Admin clears flag. Marina-admin UI now shows "Add payment method to continue" banner. `billing_state = 'past_due'` until Stripe sub is created and `invoice.paid` fires. (Or admin can set a grace window during the transition.)
3. **Boater bookings in flight.** No effect — the flag is invisible to boaters.
4. **mrr_override not set.** Admin overview shows manual-contract marina as $0 MRR until override is populated. Add a soft-warning in admin UI: "Manual contract with no MRR override — recommended to set so reporting is accurate."
5. **Manual-contract marina goes delinquent on a paper invoice.** Out of scope for v1: spec assumes DocksBase finance dunns offline (email/phone), and if escalation is needed, admin manually flips `Marina.status='suspended'` via the existing `AdminMarinaSuspendView`. This route bypasses `billing_state` machinery, which is correct.
6. **Group of marinas where some are manual and some are Stripe.** Both can coexist within a `MarinaGroup`. `MarinaGroup.stripe_customer_id` is independent.
7. **Plan downgrade attempt by owner.** Already blocked by §B.4.3 (ChangePlanView returns 409).
8. **Stripe webhook arrives before flag is set** (race during transition). Webhook handler honors current DB value; if it has already advanced `billing_state`, the subsequent admin flag-set leaves billing_state alone but flips it to `'manual'` on the next state read. (Idempotent.)

### B.11 Open questions (Feature B)

1. **Should manual-contract marinas have a special `plan` value (e.g. `'custom'`) or use `'enterprise'`?** Spec leans toward letting admin pick any plan; plan affects feature gating only.
2. **Storage of signed PDF** — reuse `apps/documents`, create new `apps/contracts`, or just an S3 URL field? Probably documents app.
3. **Clearing the flag** — should we even support that, or is it a one-way switch? Spec supports clearing with audit; user may prefer one-way.
4. **`stripe_customer_id` cleanup** — actively clear, or leave for the Connect side? (The platform-billing customer is the same record only for marinas that signed up via Checkout; safer to leave and just gate behavior on the flag.)
5. **Visibility of contract details to marina owner** — show renewal date / PO number, or hide entirely behind "contact billing"? Spec defaults to showing renewal + reference.
6. **Multi-currency invoicing terms** — `manual_contract_invoice_terms` is currently free-text-ish. Should it be richer (currency, amount, frequency)? Or just notes for finance?
7. **What happens during impersonation?** Support agents impersonating a manual-contract marina — should they see the contract panel? Spec assumes yes (read-only) since they need context for support calls.
8. **Sync to external CRM / accounting** — does setting the flag need to push anything outbound? (HubSpot? QuickBooks?)

---

## Cross-cutting concerns

### Migration plan

1. Add new fields with safe defaults (nullable, `default=False`). No data backfill required.
2. Deploy code with feature gates disabled (`BILLING_GATE_ENABLED=False` env flag).
3. Backfill `billing_state='current'` for all existing marinas, `'manual'` for any that have known offline arrangements (Sales-provided list).
4. Enable in shadow-mode: middleware logs would-be-blocks but does not enforce.
5. Audit shadow logs for a week with stakeholders.
6. Enable enforcement.

### Testing

- Unit: state-machine transitions (all permutations).
- Integration: webhook payload fixtures for each Stripe event → assert correct DB state + `BillingStateChange` row.
- View tests: every blocked endpoint returns 402 for blocked state, 200 otherwise. Reuse pattern from `apps/billing/tests/test_stripe_webhook.py` and `apps/admin_portal/tests_impersonation.py`.
- Manual-contract: assert webhooks no-op, self-service returns 409, flag-setter requires admin role.

### Rollback

- Single env flag `BILLING_GATE_ENABLED=False` disables all blocking (middleware short-circuits). Data model stays; behavior reverts to today.
- Manual-contract flag can be cleared per-marina by admin.

---

## Appendix — file references summary

Backend, current code touched by this spec:

- `backend/apps/accounts/models.py:19-224` — Marina model (new fields here)
- `backend/apps/accounts/middleware.py:5-26` — TenantMiddleware (BillingGateMiddleware sits adjacent)
- `backend/apps/accounts/views.py:550-635` — signup / pending_payment flow
- `backend/apps/billing/views.py:33-58` — `_handle_marina_subscription_event` (extend)
- `backend/apps/billing/views.py:272-280` — `_handle_marina_payment_failed` (extend significantly)
- `backend/apps/billing/views.py:317-402` — StripeWebhookView (no structural changes, just dispatch new event)
- `backend/apps/billing/views.py:927-1047` — Subscription self-service views (add manual-contract 409s)
- `backend/apps/billing/stripe_service.py` — no changes needed
- `backend/apps/admin_portal/models.py:4-60` — add BillingStateChange (or new app)
- `backend/apps/admin_portal/views.py:160-213` — admin marina mgmt (add manual-contract view, override views)
- `backend/apps/admin_portal/serializers.py:66-70` — split `MarinaUpdateSerializer`; add `MarinaManualContractSerializer`
- `backend/apps/admin_portal/permissions.py:4-12` — `IsPlatformAdmin` reused; add `IsPlatformAdminFull` (admin not support) helper
- `backend/config/plans.py` — no changes (manual contract can use any plan key)
- New: `backend/config/billing_gates.py` — tunables
- New: `backend/apps/billing/gates.py` — `assert_marina_can(marina, action)`, `record_failure()`, `advance_billing_states()` Celery task

Frontend:

- `admin/src/screens/MarinaDetail.jsx` — add Billing Gate panel + Contract panel
- `admin/src/screens/Marinas.jsx` — manual-contract column / filter
- `marina-admin/` — banner component + Billing settings page changes (Stripe vs manual
- 


This is a phenomenal, enterprise-ready compliance spec. You have correctly recognized that an unenforced subscription status is a massive revenue leak, and separating the automated billing_state from the manual Marina.status lifecycle is standard architecture for multi-tenant platforms.

However, moving into platform dunning and asynchronous webhook orchestration exposes three critical traps that could cause accidental customer lockouts, legal billing complaints, or lost platform transaction revenue.

Here is the teardown of the traps and the definitive answers to your open questions.

The Core Architectural Traps
1. The Out-of-Order Webhook Time-Bomb (Race Condition)
The Spec States: invoice.payment_failed pushes the state to past_due, and invoice.paid restores it to current.

The Error: Stripe webhooks do not guarantee chronological delivery. If a marina's payment fails at 10:00 AM, they immediately jump into the dashboard and pay it manually at 10:01 AM. Stripe fires both invoice.payment_failed and invoice.paid. If your background worker or network queue delays the failed event, the invoice.paid webhook executes first (setting the state to current), and the delayed invoice.payment_failed webhook executes second. You have just incorrectly locked an active, paid-up client out of their dashboard.

The Fix: Do not let the webhook event type blindly dictate the state transition. The webhook handler must inspect the underlying Stripe object state dynamically or compare event timestamps.

Python
# In your webhook handler:
stripe_invoice = event['data']['object']
# Fetch latest or check status directly from the event payload safely
if stripe_invoice['status'] == 'paid':
    # Only transition if this specific invoice represents the current balance
    restore_to_current(marina)
2. The Zombie Subscription Trap (Feature B)
The Spec States: For manual contracts, "admin must also cancel the Stripe subscription... or leave it active and let it run out."

The Error: Leaving it to human memory to "separately click a cancel button" is an operational disaster. If an admin flips manual_contract = True but forgets to log into the Stripe dashboard to kill the automated subscription, Stripe will continue to aggressively auto-charge that marina's card on file next month. This leads to immediate legal and commercial disputes.

The Fix: Flipping manual_contract = True must handle the legacy Stripe subscription cleanup atomically inside the backend service layer. If a stripe_subscription_id is present when the admin activates the manual contract flag, the platform billing service must immediately fire a call to Stripe to terminate that subscription at the period end.

3. The Stripe Connect Interception Flaw (Punishing the Innocent)
The Spec States: Under suspended states, the matrix blocks "Take payments from boaters (Stripe Connect)."

The Error: If a transient boater is sitting at a dock on Sunday morning trying to pay their utility slip invoice so they can leave, blocking their credit card transaction doesn't hurt the delinquent marina—it traps an innocent boater. Furthermore, if DocksBase takes a percentage application fee from Connect transactions, you are actively cutting off your own platform's revenue streams.

The Fix: Never block inbound boater payments. Keep the public portal payments fully operational across restricted, suspended, and cancelled states. If you want to apply leverage to a delinquent marina, use your Stripe Connect capabilities to payout-block their connected account balance, freezing their funds until they clear their software subscription debt with you.

Direct Answers to Your Open Questions
Feature A: Unpaid-Marina Blocking
A.1 & A.2 Grace & Restricted Lengths: 7 days for each is perfect. This gives a business a total of 14 days from initial failure to hard lockout, which gracefully handles standard corporate card replacement and accounting authorization cycles.

A.3 Staff vs. Portal Bookings: Block both. If you allow staff to key in manual bookings while blocking the public portal, devious managers will simply bypass the restriction by manually entering walk-ins at the terminal, masking their real utilization volume from you.

A.4 Email Cadence: Day 1, 3, and 7 of past_due, then every 48 hours during the grace period. Daily emails quickly get flagged as noise or hit corporate spam filters; a 48-hour rhythm maintains urgency without killing deliverability.

A.5 Override Expiration: Yes, it must auto-snap back. When the admin override expires, the cron task should query Stripe's API for that customer's subscription ground truth. If it's still delinquent, it must immediately enforce the correct restrictive state.

A.6 Data Retention: 90 days soft retention before cold storage archiving. This complies with standard B2B SaaS practices, giving them a full quarter to rescue their data before it becomes an off-line restore task.

A.7 MarinaGroup Billing: Punt to a fast-follow. Document it as an explicit out-of-scope item for v1 to avoid database join complexities while shipping the core safety gates.

A.8 Per-Plan Tolerance: One-size-fits-all for code simplicity. Do not write dynamic grace windows per tier. If an Enterprise client needs more time, the platform admin should use the manual "Extend Grace" or "Grant Override" button in the admin portal.

Feature B: Manual-Contract Flag
B.1 Plan Value: Let the admin select any plan (usually enterprise), but use the manual_contract flag to isolate the billing engine logic. This preserves your standard feature-gating hooks (marina.features) without creating a generic 'custom' plan type that breaks reporting.

B.2 Signed PDF Storage: Reuse the existing apps.documents platform. Do not build a separate contract file uploader.

B.3 Clearing the Flag: Keep it fully reversible. Marinas frequently rotate from offline purchase orders back to corporate cards after restructuring. The clear-flag routine should instantly place them in a 7-day transition grace window until a card is attached.

B.4 Visibility to Owner: Show the renewal date and reference. Complete transparency reduces back-and-forth support tickets. A simple card saying "Your contract renews on 2027-01-01 (Ref: CON-992)" makes them feel like professional partners.
