---
title: Seasonal Slip Waitlist Management
date: 2026-05-15
status: draft
---

# Seasonal Slip Waitlist Management

## 0. One-line summary

Add a first-class **seasonal-slip waitlist** to DocksBase: boaters apply online (with a refundable deposit) for a long-term berth, the queue is ordered by an explicit and configurable priority rule, and when a slip frees up the manager (eventually the system) offers it down the queue with a time-boxed accept/decline.

---

## 1. Scope & non-goals

### In scope
- A persistent waitlist for **seasonal** berths (multi-month / annual leases) at a single marina, scoped per-tenant like every other DocksBase entity.
- A public **apply** form in `portal/` for boaters (logged-in or magic-link), including vessel dimensions and slip preference.
- A refundable **waitlist deposit** ($50–$100, configurable per marina) charged at apply-time via the existing Stripe Connect adapter.
- A **manager waitlist screen** in `frontend/` that lists entries by priority, filters them by slip-size fit, and lets the manager **offer** a freed slip down the queue.
- A **time-boxed offer** (default 48 h) with accept / decline / auto-expire outcomes, and conversion of an accepted offer into a seasonal lease (the `Member` record with `member_type='seasonal'` and an owned/leased `Berth`).
- Email + SMS notifications via the existing `apps.communications.adapters.*` layer at every state transition.

### Out of scope
- **Transient overflow / short-stay waitlists.** The Tetris allocator in `backend/apps/berths/allocator.py` already handles real-time transient placement, including bumping/rotating boats across nights. If a transient request finds no slip, the answer today is "no" — not a waitlist.
- **Boatyard / haulout / service waitlists** (e.g., "queue me for next spring's bottom paint"). `backend/apps/boatyard/` has its own work-order queue and is a separate problem domain.
- **Mooring-field / dry-stack waitlists.** Same data shape conceptually but different inventory (no `Berth` row); deferred until phase 4.
- **Inter-marina / network-wide waitlists.** Each marina's waitlist is local. Future MySea-network integration is explicitly out of scope here.
- **Refund of the deposit via anything other than Stripe.** No cheque / cash refund flow in v1.

---

## 2. What exists today

### Confirmed absent
A repo-wide grep for `waitlist`, `wait_list`, and `queue` (excluding Celery task queues and `WebSocket consumers`) returns **no application-level waitlist code**:

```
$ grep -ril "waitlist\|wait_list" backend/ portal/ frontend/
backend/config/settings/base.py           # CHANNEL_LAYERS, unrelated
```

There is no `WaitlistEntry` model, no waitlist API, no waitlist screen. This spec is greenfield.

### Existing entities the waitlist will tie into

| Entity | File | Relevance |
|---|---|---|
| `accounts.Marina` | `backend/apps/accounts/models.py` | Tenant scope. Stripe Connect account on `marina.stripe_account_id`. |
| `accounts.User` | `backend/apps/accounts/models.py` | Boater logins. `Member.boater_user` already OneToOnes to it. |
| `members.Member` | `backend/apps/members/models.py:4-67` | The seasonal-member registry. Has `member_type` choices `seasonal` / `transient` / `associate`. **A successful waitlist conversion produces a `Member` row with `member_type='seasonal'`.** |
| `vessels.Vessel` | `backend/apps/vessels/models.py:4` | Existing vessel registry. The waitlist may either reference an existing `Vessel` (logged-in boater) or carry the dimensions inline (unauthenticated apply). |
| `berths.Berth` | `backend/apps/berths/models.py:134-233` | The slip inventory. Already has `length_m`, `max_beam_m`, `max_draft_m`, `pier`, `pricing_tier`, `owner` (FK to `Member`), and `lease_expiry`. **A slip "opens" when its lease expires or `owner` is cleared.** |
| `berths.Pier` | `backend/apps/berths/models.py:91-132` | For "preferred pier" preference. |
| `berths.BerthCategory` | `backend/apps/berths/models.py:53-89` | For "preferred category" preference (e.g., catamaran, premium). |
| `billing.stripe_service.create_payment_intent` | `backend/apps/billing/stripe_service.py:33-42` | The single point of Stripe PI creation. The waitlist deposit **must** call this and pass `metadata={'kind': 'waitlist_deposit', 'waitlist_entry_id': ...}`. |
| `billing.Invoice` | `backend/apps/billing/models.py` | Holds `stripe_checkout_session_id`. Reused for the deposit-as-receipt and for crediting the deposit to the first seasonal-lease invoice. |
| `communications.adapters.email.send_email` | `backend/apps/communications/adapters/email.py` | Transactional email. |
| `communications.adapters.sms.send_sms` | `backend/apps/communications/adapters/sms.py` | Transactional SMS. |
| `notifications.*` | `backend/apps/notifications/` | In-app notification (WebSocket consumer + bell). |
| `portal.checkin_utils.make_member_magic_token` | `backend/apps/portal/member_auth_views.py:15-17` | Existing magic-link mint/decode. Used to authenticate an apply-form follow-up without forcing account creation. |
| `Reservation`, `Booking` | `backend/apps/reservations/models.py` | **Not used here** — the waitlist does not produce a `Reservation` (which models a transient stay). It produces a `Member` + `Berth.owner` assignment. |

### What does NOT exist and we are not building generically

- **No `SeasonalLease` model** exists today. Today, a seasonal arrangement is implicit: `Member` with `member_type='seasonal'` + `Berth.owner = member` + `Berth.lease_expiry`. **This spec keeps that pattern** rather than introducing a new `SeasonalLease` aggregate. If a richer lease model is wanted, that is a separate spec; the waitlist would then write to it instead of to `Berth.owner` directly.
- **No refund helper** exists in `billing/stripe_service.py`. We add `refund_payment_intent(intent_id, amount_cents=None, marina=...)` as part of this spec, since the waitlist drives the requirement.

---

## 3. Data model

Two new models in a new app `backend/apps/waitlist/` (parallels `boatyard`, `marketplace`, etc.).

### 3.1 `WaitlistEntry`

```
WaitlistEntry
─────────────
id                  BigAutoField PK
marina              FK accounts.Marina   (tenant scope)

# Applicant
applicant_user      FK accounts.User      null=True     # set when boater is logged in
applicant_member    FK members.Member     null=True     # set on conversion, or when a transient
                                                          # member upgrades
applicant_name      CharField(200)        # always populated; mirrors Booking.guest_name pattern
applicant_email     EmailField            # always populated
applicant_phone     CharField(30, blank=True)

# Vessel (inline; not FK because most applicants do not yet have a Vessel row)
vessel              FK vessels.Vessel     null=True
vessel_name         CharField(120, blank)
vessel_type         CharField(40, blank)   # sail / power / cat / trawler / other
vessel_loa_m        Decimal(6,1)
vessel_beam_m       Decimal(5,2)
vessel_draft_m      Decimal(5,2)
vessel_air_draft_m  Decimal(5,2, null=True)

# Preferences (all optional except a min/max LOA pair)
pref_min_loa_m      Decimal(6,1)
pref_max_loa_m      Decimal(6,1)
pref_pier           FK berths.Pier         null=True
pref_category       FK berths.BerthCategory null=True
pref_side           CharField(10, choices=['','port','starboard'], blank=True)
pref_notes          TextField(blank=True)

# Priority + lifecycle
applied_at          DateTimeField(default=now, db_index=True)
priority_score      Decimal(10,4, default=0)  # cached, recomputed on save & nightly cron
rank_cached         IntegerField(null=True)   # cached queue position; updated by tasks.recompute_ranks
status              CharField(20) [pending, offered, accepted, declined, expired, converted, withdrawn]
status_changed_at   DateTimeField

# Deposit
deposit_amount_cents  Integer
deposit_currency      CharField(3)
deposit_invoice       FK billing.Invoice  null=True
deposit_intent_id     CharField(120, blank)   # Stripe PaymentIntent id
deposit_state         CharField(20) [unpaid, paid, refunded, credited, refund_failed]
deposit_paid_at       DateTimeField(null=True)

# Audit
notes_internal        TextField(blank=True)    # manager-visible only
created_at, updated_at
```

Indexes: `(marina, status, priority_score)` for queue listing; `(marina, applicant_email)` for dedupe.

**`status` state machine:**

```
            ┌────────── withdrawn ──────────┐
            │                                ▼
unpaid ──►  pending  ──manager.offer──►  offered  ──accept──► accepted ──convert──► converted
            │                              │                    │
            │                              ├─decline──► declined (back to pending OR booted, configurable)
            │                              └─timeout──► expired (back to pending OR booted)
            │
            └──admin.expire──► expired
```

`pending` is the only state in which the entry is eligible for a new offer. `offered` blocks a second concurrent offer for the same entry.

### 3.2 `WaitlistOffer`

```
WaitlistOffer
─────────────
id                  BigAutoField PK
entry               FK WaitlistEntry   on_delete=PROTECT, related_name='offers'
berth               FK berths.Berth    on_delete=PROTECT
offered_by          FK accounts.User   null=True   # manager (phase 1)
offered_at          DateTimeField(default=now)
expires_at          DateTimeField                  # default: offered_at + Marina.waitlist_offer_ttl
season_start        DateField                      # the lease start date offered
season_end          DateField                      # the lease end date offered
quoted_amount_cents Integer                        # full-season price quote shown to boater
quoted_currency     CharField(3)
outcome             CharField(20) [pending, accepted, declined, expired, cancelled]
outcome_at          DateTimeField(null=True)
decline_reason      CharField(200, blank=True)
magic_token_hash    CharField(64)                  # hash of the boater-facing response token
reminder_sent_at    DateTimeField(null=True)       # T-12h reminder
```

One entry can have many historical offers (declined / expired) but **at most one offer with `outcome='pending'`** — enforced by a partial unique constraint:
```
UniqueConstraint(fields=['entry'], condition=Q(outcome='pending'),
                 name='one_open_offer_per_entry')
```

Similarly, **at most one open offer per berth** — partial unique on `(berth,)` where `outcome='pending'`. Prevents a manager from accidentally offering the same slip to two people.

### 3.3 `Marina` additions (one migration on `accounts.Marina`)

| Field | Type | Default | Purpose |
|---|---|---|---|
| `waitlist_enabled` | `BooleanField` | `False` | Feature flag per marina. |
| `waitlist_deposit_cents` | `Integer` | `7500` | Default $75. Editable in Settings. |
| `waitlist_offer_ttl_hours` | `Integer` | `48` | Offer expiry window. |
| `waitlist_decline_policy` | `CharField` | `'keep'` | `'keep'` (stay in queue) or `'boot'` (move to `declined`/`expired` after first decline). |
| `waitlist_priority_rule` | `CharField` | `'fifo'` | See §4. |
| `waitlist_deposit_required` | `BooleanField` | `True` | Some marinas may run a free waitlist. |

These all live on `accounts.Marina`, not on a separate `WaitlistConfig`, to match how `booking_mode`, `marketplace_enabled`, etc., are already configured.

---

## 4. Priority computation

Priority is **explicit, deterministic, and configurable** — never opaque.

`priority_score` is recomputed on every save of `WaitlistEntry` (via `signals.py`) and nightly via a Celery beat task `waitlist.tasks.recompute_priority`. Lower score = higher priority (i.e., offered first).

```
priority_score = applied_at_epoch_seconds
               + tiebreaker_offsets
```

Where `tiebreaker_offsets` are signed adjustments derived from `Marina.waitlist_priority_rule`:

| Rule | Adjustment |
|---|---|
| `'fifo'` | No offset. Pure first-come-first-served. |
| `'fifo_paid_first'` | Unpaid entries get `+10 years` (effectively sent to the back until paid). |
| `'membership_then_fifo'` | If `applicant_member.member_type == 'associate'` → `-30 days`. If existing seasonal (renewing into a larger slip) → `-365 days`. |
| `'custom'` | A `JSONField` formula is parsed by `waitlist.services.priority.compute_score(entry, rule)`. Out of scope for v1; reserved. |

`rank_cached` is the 1-based ordinal within `(marina, status='pending')` ordered by `priority_score ASC, id ASC`. It is **not authoritative** — the queue is always re-derived on read. `rank_cached` exists only to render "you are #14 in the queue" in the boater portal cheaply.

The manager UI shows the formula in a tooltip: "Position 14 because applied 2025-09-12, deposit paid, no membership bonus." Transparency is a feature; opaque priority will be perceived as favouritism and is unacceptable in this domain.

---

## 5. Boater apply flow (`portal/`)

### 5.1 Entry points

1. Public marina website link: `https://{marina-slug}.docksbase.com/waitlist/apply` (resolved via the same `X-Marina-Slug`/`X-Marina-Domain` tenant resolution used by public booking — see `backend/apps/reservations/public_reservation_views.py`).
2. Logged-in boater portal: `/portal/waitlist/apply` shown only when `marina.waitlist_enabled`.

### 5.2 Form (single page, sectioned)

1. **Contact** — name, email, phone. If logged in: pre-filled from `Member` / `User`.
2. **Vessel** — type, LOA, beam, draft, air draft (optional), vessel name. If logged in and has a `Vessel`, offered as a "Use my saved boat" radio.
3. **Slip preference** — min LOA, max LOA, preferred pier (dropdown of `Pier.name` for this marina), preferred category, preferred side, free-text notes.
4. **Acknowledgements** — checkbox: "I understand the deposit is refundable on withdrawal but non-refundable on no-show after an offer is accepted." Wording editable per-marina in Settings.
5. **Deposit** — Stripe Payment Element inline if `marina.waitlist_deposit_required`. Amount = `marina.waitlist_deposit_cents`.

### 5.3 Submission sequence

```
POST /api/v1/public/waitlist/   (or /api/v1/waitlist/ if authenticated)

Server:
  1. Validate input. Reject if email already has a pending/offered/accepted entry at this marina
     (dedupe; return 409 with the existing entry_id so the FE can redirect to "your queue position").
  2. Create WaitlistEntry(status='pending', deposit_state='unpaid', applied_at=now()).
  3. If deposit_required:
       - Create billing.Invoice(category='waitlist_deposit', booking=null, member=null,
                                amount=marina.waitlist_deposit_cents/100, marina=marina).
       - Call billing.stripe_service.create_payment_intent(marina, deposit_amount_cents,
           marina.currency, metadata={'kind':'waitlist_deposit', 'entry_id': entry.id,
                                       'invoice_id': invoice.id}).
       - Save entry.deposit_invoice = invoice; entry.deposit_intent_id = intent_id.
       - Return 201 { entry_id, client_secret, queue_position_estimate }.
     Else:
       - Mark deposit_state='paid' (free waitlist) and skip Stripe.
       - Return 201 { entry_id, queue_position_estimate }.
  4. Send confirmation email (template waitlist/apply_received.html) with magic-link to the
     boater's "My waitlist position" page. Use portal.checkin_utils.make_member_magic_token
     style tokenisation (HMAC-signed, 30-day expiry, scope='waitlist_view').
```

The PaymentIntent is confirmed client-side. The Stripe webhook listener in `billing.views.StripeWebhookView` handles `payment_intent.succeeded`:
- Look up the entry by `metadata.entry_id`.
- `entry.deposit_state = 'paid'`; `entry.deposit_paid_at = event.created`.
- Recompute `priority_score` (relevant under `'fifo_paid_first'`).
- Fire `WaitlistEntry.deposit_paid` signal → email "You're #N on the waitlist."

If the boater abandons the deposit, the entry stays `status='pending'` with `deposit_state='unpaid'`. Under `'fifo_paid_first'` they will not be offered slips. A nightly cleanup task purges `unpaid` entries older than `waitlist_unpaid_ttl` (default 7 days).

### 5.4 "My waitlist position" page

`portal/src/screens/WaitlistStatusScreen.jsx` (new).

Authenticated either via the magic link or via boater login. Shows:
- Current rank (`rank_cached`) and total queue length.
- Vessel + preferences (editable until `status='offered'`).
- Deposit state.
- A **Withdraw** button (confirm modal → triggers refund flow §7).
- If there is an open offer, a prominent **"You have a slip offer expiring in 41h 22m"** banner with Accept / Decline buttons.

---

## 6. Manager workflow (`frontend/`)

### 6.1 New screen `frontend/src/screens/Waitlist.jsx`

Added to the left nav under "Operations" alongside `Members.jsx` and `Reservations.jsx`. Visible only when `marina.waitlist_enabled`.

Layout:
- **Top**: filter bar — search by name/vessel; filter by `status`; filter by "fits berth ___" (manager picks a berth, list collapses to entries whose `pref_min_loa_m <= berth.length_m <= pref_max_loa_m` AND `vessel_beam_m <= berth.max_beam_m` AND `vessel_draft_m <= berth.max_draft_m`).
- **Main table** sorted by `priority_score` ascending:
  | # | Applicant | Vessel | LOA/Beam/Draft | Pref pier | Deposit | Applied | Status | Actions |
  Row click → drawer with full detail and offer history.
- **Right rail** ("Slips opening soon"): a list derived from `Berth.lease_expiry <= today + 90 days` AND `Berth.owner is not None`, plus berths currently `status='available'` and not yet assigned. Clicking a slip filters the main table to fitting entries and arms the "Offer this slip" button.

### 6.2 Manager actions

1. **Offer a slip** — `POST /api/v1/waitlist/<entry_id>/offer/` with `{berth_id, season_start, season_end, quoted_amount_cents}`.
   - Server validates: entry is `pending`; berth has no other open offer; berth is not currently owned (or owner has `lease_expiry < season_start`); season dates are sane.
   - Creates `WaitlistOffer(outcome='pending', expires_at=now+marina.waitlist_offer_ttl_hours)`.
   - Sets `entry.status='offered'`.
   - Sends email + SMS to the applicant with magic-link to accept/decline (see §8).
   - Returns the offer payload.

2. **Cancel an offer** — `POST /api/v1/waitlist/offers/<offer_id>/cancel/` (manager only). Marks `outcome='cancelled'`, returns entry to `pending`.

3. **Withdraw an entry** (manager-side) — `POST /api/v1/waitlist/<entry_id>/withdraw/` with `{reason}`. Triggers refund (§7). Used when manager decides applicant is unsuitable (e.g., over-LOA for any available slip and not willing to wait).

4. **Edit priority manually** — `PATCH /api/v1/waitlist/<entry_id>/` with `{priority_override_score}`. Sets a column not described above (`priority_override` Decimal) which, when non-null, replaces `priority_score`. Audit-logged. Used rarely (legal complaints, harbour-board overrides).

5. **Convert** — happens server-side when an offer is accepted, but the manager has a manual fallback `POST /api/v1/waitlist/<entry_id>/convert/` with `{berth_id, season_start, season_end}` for offline-accepted offers (boater called the office, etc.).

### 6.3 Conversion semantics

When `WaitlistOffer.outcome='accepted'` or manager triggers `convert`:

1. Ensure / create the `Member` row:
   - If `entry.applicant_member` is set, reuse it; set `member_type='seasonal'`.
   - Else look up by `(marina, email)`; if found, upgrade `member_type` to `seasonal`.
   - Else create a new `Member(marina=marina, name=entry.applicant_name, email=entry.applicant_email, member_type='seasonal', joined_at=today)`.
2. Set `berth.owner = member`; `berth.lease_expiry = offer.season_end`.
3. Generate the first-season **invoice**:
   - `billing.Invoice` with line item = full-season fee at `quoted_amount_cents`.
   - **Credit the deposit**: add a negative line item `"Waitlist deposit credit"` of `entry.deposit_amount_cents`. Set `entry.deposit_state='credited'`.
   - Email the boater with the invoice + Stripe checkout link via the existing `_create_checkout_session(invoice)` path.
4. `entry.status='converted'`; `offer.outcome='accepted'`; both timestamps set.
5. Fire signal `waitlist.signals.entry_converted(entry, member, berth)`. Other apps (e.g., `access_control` for gate-card provisioning, `documents` for berth-agreement PDF) can subscribe.

If invoice generation fails (e.g., no `ChargeableItem` for the slip), the conversion is rolled back inside an atomic block and the offer remains `pending` for the manager to retry.

---

## 7. Deposit handling — Stripe specifics

### 7.1 Why a charged PaymentIntent and not a hold

Three choices were considered:

| Option | Pros | Cons |
|---|---|---|
| **A. `manual` capture (authorization hold)** | No money moves until offer accepted. | Stripe holds expire after **7 days** for cards. A waitlist sits for months. Unworkable. |
| **B. `setup_future_usage='off_session'` (save card, charge later)** | Defers the charge. | Boaters resent "we saved your card" without an immediate charge; declines on first off-session charge are common; UX confusion when the slip is offered a year later. Card may be expired. |
| **C. Charge the deposit immediately, refund on withdrawal, credit on conversion.** ✅ | Industry-standard for waitlists (cf. country clubs, ski resorts). Clear receipt. Refund mechanics well-understood by Stripe. | We must implement a refund path. |

**Decision: C.** Charge at apply-time. Refund or credit at terminal state.

### 7.2 New helper in `backend/apps/billing/stripe_service.py`

```
def refund_payment_intent(marina, intent_id, amount_cents=None, reason='requested_by_customer',
                          metadata=None) -> str:
    """Refund a previously-captured PaymentIntent on the marina's Connect account.
    Returns the Refund id. amount_cents=None refunds the full amount."""
```

Used by:
- `WaitlistEntry.withdraw()` (boater self-service or manager-initiated).
- `WaitlistOffer.expire()` if `marina.waitlist_decline_policy='boot'` and there is no further intent to keep the entry.

### 7.3 Refund failure handling

If `stripe.Refund.create` raises, set `entry.deposit_state='refund_failed'` and surface a banner on the manager waitlist screen ("3 refunds need attention"). A nightly task `waitlist.tasks.retry_failed_refunds` re-tries up to 5 times with exponential backoff, then leaves it for manual resolution. Manager has a "Mark refunded manually" button that records `deposit_state='refunded'` with a `notes_internal` audit note (e.g., "Refunded by cheque #1234").

### 7.4 Deposit credited on conversion

We do **not** issue a Stripe refund and then re-charge for the lease. We issue a single new invoice for the lease minus the deposit credit. This keeps fee reconciliation simple and matches how country-club initiation fees typically work.

If the lease invoice goes unpaid for `waitlist_lease_payment_ttl` (default 14 days), the offer is reversed: `berth.owner` is cleared, `entry.status` returns to `pending`, deposit is refunded. Configurable in Settings.

---

## 8. Boater offer response

### 8.1 Magic link

When a `WaitlistOffer` is created, the server mints a token via the existing pattern (analogous to `make_member_magic_token` in `backend/apps/portal/checkin_utils.py`):

```
make_waitlist_offer_token(offer_id, scope='waitlist_respond', ttl=offer.expires_at)
```

Token's hash is stored in `WaitlistOffer.magic_token_hash` so we can verify without storing the raw token.

The link looks like `https://{portal}/waitlist/offer/{token}` and resolves to `portal/src/screens/WaitlistOfferScreen.jsx` (new).

### 8.2 Response page UI

- Big banner: "Slip {berth.code} ({berth.length_m} m) on {pier.name} is yours if you want it."
- Countdown: time remaining until `expires_at`.
- Quoted full-season price; deposit credit clearly shown.
- Two buttons: **Accept** and **Decline**.
- "Decline" requires a reason (free-text). "Accept" requires the boater to re-confirm dimensions and acknowledge the lease terms.

### 8.3 Accept

`POST /api/v1/waitlist/offers/<id>/respond/` `{decision: 'accept'}`.

Server:
1. Inside `atomic()`, verify offer is still `pending` and not expired.
2. `offer.outcome='accepted'`.
3. Run the conversion routine (§6.3).
4. Email: "Welcome — your invoice is attached. Pay within 14 days to confirm."
5. SMS: "Your slip is reserved. Check email for invoice."

### 8.4 Decline

`POST /api/v1/waitlist/offers/<id>/respond/` `{decision: 'decline', reason: '...'}`.

Server:
1. `offer.outcome='declined'`.
2. Per `marina.waitlist_decline_policy`:
   - `'keep'`: `entry.status='pending'`. Their rank may slightly improve as the slip is offered to the next person.
   - `'boot'`: `entry.status='declined'`. Trigger refund.
3. Optional: server immediately picks the next eligible entry and offers them the same slip (only if `marina.waitlist_auto_cascade=True` — phase 2).

### 8.5 No response → expire

Celery beat task `waitlist.tasks.expire_offers` runs every 5 min:
- For offers with `outcome='pending'` and `expires_at < now()`, set `outcome='expired'` and roll entry back to `pending` (or `declined` per policy).
- Email + SMS reminder is sent at `expires_at - 12h` (single reminder). `reminder_sent_at` tracks idempotency.

---

## 9. API surface

All under `/api/v1/waitlist/`. Standard DRF viewsets with marina-scoping via the existing `TenantScopedMixin`.

### Public (unauthenticated, marina resolved by header)

```
POST   /api/v1/public/waitlist/                       create entry + payment intent
GET    /api/v1/public/waitlist/{magic_token}/         view own entry by token
POST   /api/v1/public/waitlist/{magic_token}/withdraw/  self-service withdraw
GET    /api/v1/public/waitlist/offers/{magic_token}/  view offer
POST   /api/v1/public/waitlist/offers/{magic_token}/respond/  {decision, reason?}
```

### Authenticated boater (logged-in `User`)

```
POST   /api/v1/waitlist/                               create entry (auto-fills from Member)
GET    /api/v1/waitlist/mine/                          list own entries across marinas (rare)
GET    /api/v1/waitlist/{id}/                          view own entry
PATCH  /api/v1/waitlist/{id}/                          edit preferences (only while pending)
POST   /api/v1/waitlist/{id}/withdraw/
```

### Manager (staff JWT)

```
GET    /api/v1/waitlist/                               list, filter, sort
GET    /api/v1/waitlist/{id}/
PATCH  /api/v1/waitlist/{id}/                          edit notes, override priority
POST   /api/v1/waitlist/{id}/offer/                    {berth_id, season_start, season_end, quoted_amount_cents}
POST   /api/v1/waitlist/{id}/withdraw/                 {reason}
POST   /api/v1/waitlist/{id}/convert/                  {berth_id, season_start, season_end, quoted_amount_cents}
POST   /api/v1/waitlist/offers/{id}/cancel/
GET    /api/v1/waitlist/openings/                      slips opening in N days (right-rail data)
GET    /api/v1/waitlist/stats/                         counts, avg wait, conversion rate
```

### Stripe webhook handler (existing)

`billing.views.StripeWebhookView` adds two new branches:
- `payment_intent.succeeded` with `metadata.kind == 'waitlist_deposit'` → mark entry paid.
- `charge.refunded` with `metadata.kind == 'waitlist_deposit'` → mark `deposit_state='refunded'`.

---

## 10. Notifications

All sent via existing `apps.communications.adapters.email.send_email` and `.sms.send_sms`. Templates under `backend/apps/waitlist/templates/waitlist/`.

| Event | Email | SMS | In-app (notifications app) |
|---|---|---|---|
| Apply submitted | ✅ confirmation + magic link | — | — |
| Deposit paid | ✅ "you're in, position #N" | — | — |
| Offer made | ✅ with link + countdown | ✅ "Slip offered, expires {time}" | ✅ manager: "You offered slip X to Y" |
| Offer reminder (T-12h) | ✅ | ✅ | — |
| Offer accepted | ✅ welcome + invoice | ✅ | ✅ manager: "Y accepted" |
| Offer declined | — | — | ✅ manager: "Y declined" |
| Offer expired | ✅ "no response — back in queue / closed" | — | ✅ manager |
| Entry converted | ✅ welcome to seasonal | — | ✅ manager + access_control hook |
| Withdrawn | ✅ refund initiated | — | ✅ manager |
| Refund failed | — | — | ✅ manager (high priority) |

SMS only fires when `applicant_phone` is present and `marina.sms_enabled` is true (existing flag).

WhatsApp delivery via `apps.communications.adapters.whatsapp.send_whatsapp_template` is **optional** in v1 — wire up only if `member.whatsapp_opt_in` exists and is true; otherwise skip silently.

---

## 11. Edge cases

1. **Applicant applies for multiple slip sizes.** Allowed via a single entry with `pref_min_loa_m` < `pref_max_loa_m`. We do **not** support multiple separate entries from the same email at the same marina (returns 409). Rationale: one boater, one queue position.
2. **Applicant changes vessel mid-queue.** Editable until `status='offered'`. After that, edits are blocked; if the new vessel does not fit the offered slip, the boater must decline.
3. **Marina re-dimensions a berth** (e.g., re-floats a finger pier so `max_beam_m` shrinks). Entries already `offered` against that berth are unaffected. Pending entries re-evaluate fit on next listing. No automatic re-ranking — managers may need to skip an entry if the previously-fitting slip no longer fits.
4. **Berth deleted while it has an open offer.** `on_delete=PROTECT` on `WaitlistOffer.berth` prevents this. UI: "This slip has an open waitlist offer; cancel or accept the offer first."
5. **Applicant has no Stripe-compatible card** (e.g., wants to pay deposit by cheque). Manager can flip `deposit_state='paid'` manually with a `notes_internal` note recording the cheque number. The Stripe-Refund path then refuses to act; manual refund noted.
6. **Two managers offer the same slip at the same time.** Partial unique constraint on `(berth)` where `outcome='pending'` plus a `select_for_update` on the berth row inside the offer-creation transaction prevents the race.
7. **Boater accepts after expiry by clicking a cached link.** Server re-checks `expires_at`; rejects with 410 Gone and a "Sorry, this offer has expired" page.
8. **Deposit refund fails on Stripe** (e.g., disputed charge already refunded). See §7.3 — `refund_failed` banner, retries, manual override.
9. **Applicant is already a seasonal member upgrading to a bigger slip.** They apply normally; `Member.member_type` stays `seasonal`; on conversion we update `berth.owner` and clear their old slip's `owner` only after the new lease invoice is paid. Old berth becomes available; queue re-runs at next offer (cascading vacancies — handled fully in phase 2).
10. **Marina disables waitlist** (`waitlist_enabled=False`) with pending entries. Existing entries remain visible to managers and can still be processed; new applications are 404'd. Refunds for active deposits are NOT triggered automatically — manager must withdraw each entry deliberately.
11. **Magic-link token leaked / shared.** Tokens are single-scope (`waitlist_respond` only) and bound to a single `WaitlistOffer`. Worst case, someone else can accept or decline an offer the applicant intended for themselves — same trust model as the existing booking magic links.
12. **Vessel grows after applying** (boater bought a bigger boat). They can edit while `pending`; if `vessel_loa_m` now exceeds `pref_max_loa_m`, validation forces them to widen the preference. Existing rank is preserved.

---

## 12. Phasing

### Phase 1 (this spec)
- Apply form, deposit charge, magic-link confirmation.
- Manager screen: list, filter-by-fit, offer manually, cancel offer, withdraw entry.
- Offer response (accept / decline / expire) with single 12h reminder.
- Conversion → `Member`(seasonal) + `Berth.owner` + first-season invoice with deposit credit.
- All notifications wired to existing adapters.
- Refund helper added to `stripe_service.py`.

### Phase 2 — Auto-cascade
- When a `Berth` transitions to "available for next season" (its `lease_expiry` is set and either the previous owner withdraws or `season_end < today + cascade_lead_time`), a Celery task automatically offers it to the highest-priority fitting `pending` entry.
- Configurable `marina.waitlist_auto_cascade` (`off`/`on`), `marina.waitlist_cascade_depth` (default 3 — system cascades down 3 declines before alerting the manager).
- Manager screen shows a "System last offered to ___" trail.

### Phase 3 — Transparency & analytics
- Public "you're number #N, average wait at this marina for your slip size is X months" widget on the apply page (computed from `converted` entries' `applied_at` → `status_changed_at` deltas).
- Manager dashboard: conversion rate, average decline rate, deposit-refund volume, expected vacancies.
- Optional public anonymised queue display (configurable per marina).

### Phase 4 (not in this spec — listed for context)
- Mooring-field and dry-stack waitlists (different inventory model).
- Inter-marina waitlists via MySea network.
- "Try before you commit" — short transient stay credited toward conversion.

---

## 13. Test plan

### Backend unit tests (`backend/apps/waitlist/tests/`)

1. **Model state machine**
   - `pending → offered → accepted → converted` happy path.
   - `offered → declined` with `decline_policy='keep'` returns to `pending`.
   - `offered → declined` with `decline_policy='boot'` triggers refund.
   - Cannot transition `converted → pending` (assert raises).
   - Partial unique constraint: cannot create a second `outcome='pending'` offer for the same entry.

2. **Priority**
   - FIFO: 3 entries created at distinct timestamps have ranks 1/2/3.
   - `fifo_paid_first`: unpaid entry from yesterday ranks behind paid entry from today.
   - Tie-break on `id` when scores collide.
   - `priority_override` wins when non-null.

3. **Deposit flow**
   - `create_payment_intent` is called with correct `marina`, `metadata.kind='waitlist_deposit'`.
   - Webhook `payment_intent.succeeded` marks entry paid.
   - On withdraw, `refund_payment_intent` called with the right intent id.
   - On conversion, deposit is **credited** to the new invoice, not refunded.
   - Refund failure sets `deposit_state='refund_failed'` and surfaces in manager listing.

4. **Conversion**
   - Creates new `Member` when none exists.
   - Reuses existing `Member` when email matches; upgrades `member_type` to `seasonal`.
   - Sets `Berth.owner` and `Berth.lease_expiry`.
   - Generates invoice with positive line + negative deposit-credit line; totals are correct.
   - Atomic: if invoice creation fails, no `Member` is upgraded.

5. **Concurrency**
   - Two parallel `POST /offer/` for the same berth: one succeeds, the other 409s.
   - Two parallel `POST /respond/` for the same offer with different decisions: second is rejected.

6. **Edge cases listed in §11** each get a dedicated test.

### Backend integration tests

- Full flow: anonymous apply → webhook fires → manager offers → boater accepts → invoice paid → `Berth.owner` is set and `Member` is seasonal. Asserts that the right emails/SMS were enqueued (mock `send_email`/`send_sms`).

### Frontend tests

- `frontend/src/screens/Waitlist.test.jsx`: renders entries sorted by `priority_score`; "Offer this slip" disabled when no berth selected; offer drawer validates dates.
- `portal/src/screens/WaitlistApplyScreen.test.jsx`: form validation (LOA > 0, beam > 0, etc.); Stripe Payment Element mount; 409 dedupe redirects to status page.
- `portal/src/screens/WaitlistOfferScreen.test.jsx`: countdown renders; expired offer shows "Sorry" page; accept/decline POSTs the right body.

### Manual QA checklist
- Submit an application end-to-end with a Stripe test card.
- Manager offers a slip; check email + SMS arrive.
- Boater accepts; verify `Member` exists with `member_type='seasonal'`, `Berth.owner` set, invoice generated with deposit credit.
- Withdraw a paid entry; verify Stripe shows a refund.
- Force a refund failure (use Stripe test mode "refund declined" card) and verify banner appears, retry button works.

---

## 14. Migrations

1. `accounts/migrations/00XX_marina_waitlist_settings.py` — add the six `waitlist_*` fields to `Marina`.
2. `waitlist/migrations/0001_initial.py` — `WaitlistEntry`, `WaitlistOffer`, partial unique constraints, indexes.
3. `billing/migrations/00YY_chargeable_item_waitlist_deposit_category.py` — add `'waitlist_deposit'` to `ChargeableItem.category` choices (mirrors the booking-fee category pattern noted in `2026-05-04-public-booking-manual-flow-design.md` §1).
4. No changes to `members.Member`, `berths.Berth`, or `vessels.Vessel` — we work with their existing shape.

Total: 3 migrations. No data migration required (greenfield).

---

## 15. File-level summary

New files:

```
backend/apps/waitlist/
  __init__.py
  apps.py
  models.py
  serializers.py
  views.py
  public_views.py        # mirrors reservations/public_reservation_views.py
  urls.py
  tasks.py               # expire_offers, recompute_priority, retry_failed_refunds, send_offer_reminders
  signals.py             # entry_converted, deposit_paid
  services/
    priority.py          # compute_score
    conversion.py        # convert_offer_to_lease
    offers.py            # create_offer, expire_offer, cancel_offer
  templates/waitlist/
    apply_received.html / .txt
    deposit_paid.html / .txt
    offer_made.html / .txt
    offer_reminder.html / .txt
    offer_accepted.html / .txt
    offer_expired.html / .txt
    withdrawn.html / .txt
  tests/
    test_models.py
    test_priority.py
    test_deposit.py
    test_conversion.py
    test_concurrency.py
    test_api_public.py
    test_api_manager.py
    test_edge_cases.py
  INSTALL.md

frontend/src/screens/
  Waitlist.jsx
  Waitlist.test.jsx
  WaitlistOfferDrawer.jsx

portal/src/screens/
  WaitlistApplyScreen.jsx
  WaitlistApplyScreen.test.jsx
  WaitlistStatusScreen.jsx
  WaitlistOfferScreen.jsx
  WaitlistOfferScreen.test.jsx
```

Modified files:

```
backend/apps/accounts/models.py           # +6 waitlist_* fields on Marina
backend/apps/billing/stripe_service.py    # +refund_payment_intent
backend/apps/billing/views.py             # extend StripeWebhookView for waitlist metadata
backend/apps/billing/models.py            # +'waitlist_deposit' ChargeableItem category
backend/config/urls.py                    # include waitlist.urls
backend/config/celery.py / beat schedule  # +expire_offers (every 5m), +recompute_priority (nightly),
                                          # +retry_failed_refunds (hourly), +send_offer_reminders (every 15m)
frontend/src/App.jsx (or router)          # route /waitlist
frontend/src/components/Sidebar.jsx       # nav item (gated by marina.waitlist_enabled)
portal/src/App.jsx                        # routes /waitlist/apply, /waitlist/status, /waitlist/offer/:token
```

---

## 16. Open design questions for the user

These are intentional decision points the spec defers to the product owner. The current draft picks a default but each is worth a deliberate choice:

1. **Priority rule default.** Spec defaults to `'fifo'`. A premium marina may strongly prefer `'fifo_paid_first'` (no free riders) or `'membership_then_fifo'` (rewards associate members). Which should ship as the global default — and should we allow per-marina override on day 1 (the spec assumes yes)?

2. **Deposit on decline policy default.** Spec defaults to `'keep'` (decline keeps you in queue, deposit retained). Some marinas may want `'boot'` (decline = forfeit deposit) as the deterrent against frivolous declines. Day-1 default?

3. **Should the waitlist deposit be Marina-revenue or refundable escrow?** Spec assumes refundable on withdraw, credited on conversion — i.e., it is never marina revenue unless the boater no-shows after accepting. A different model (non-refundable application fee + separate refundable deposit) is common in the country-club world. Which model do we want?

Secondary (lower-stakes, but worth flagging):

- Should phase 2 auto-cascade depth default to 3 or higher?
- Is a single 12h reminder enough, or do we want T-24h **and** T-2h?
- Do we want a public "average wait time" indicator (phase 3) at all, or is that politically risky for marinas?


answer:

As your system architect, I have to commend you on this spec. You have successfully navigated one of the most politically charged and operationally complex parts of marina management. By making the priority score deterministic and keeping the SeasonalLease implicit, you are saving your engineering team weeks of unnecessary abstraction.

However, mixing long-term, multi-year state machines with modern fintech APIs exposes two hidden architectural traps. If you ship this exact specification, your system will crash when trying to refund long-term waiters, and you will introduce a race condition on the magic links.

Here is the teardown of the traps and exactly how to patch them, followed by answers to your open design questions.

1. The Stripe 180-Day Refund Trap (Fintech/Operations)
The Spec States: "Charge the deposit immediately, refund on withdrawal... A nightly task waitlist.tasks.retry_failed_refunds re-tries up to 5 times with exponential backoff."

The Error: Seasonal waitlists often span 2 to 5 years. Stripe (and the underlying Visa/Mastercard networks) generally only allow you to issue a refund against the original charge for 90 to 180 days. If a boater has been on your waitlist for 3 years and clicks "Withdraw," the stripe.Refund.create API call will hard-fail. Retrying it with exponential backoff will only flood your logs with errors; it will never succeed.

The Fix: The system must gracefully catch this specific fintech limitation.

Update the refund_payment_intent helper: if Stripe returns a charge_expired or refund_failed error due to age, the system should catch the exception, set deposit_state='manual_refund_required', and trigger a high-priority alert to the Harbor Master.

The manager UI must provide a "Mark as Refunded Offline" button so the marina can cut a physical check or process a manual ACH transfer to close out the entry.

2. The Magic Link Race Condition (State Machine Trap)
The Spec States: "Server re-checks expires_at; rejects with 410 Gone and a 'Sorry, this offer has expired' page... 1. Inside atomic(), verify offer is still pending and not expired."

The Error: You checked for expiry, but you missed the concurrent state mutation. What if a boater clicks "Decline" on their phone (flipping the offer to declined), but still has the tab open on their laptop and clicks "Accept" an hour later? Or what if a manager clicks "Cancel Offer" in the dashboard right as the boater clicks "Accept"?

The Fix: The POST /respond/ endpoint must place a strict database row lock on the offer before checking its state.

Update section 8.3/8.4 to explicitly state: WaitlistOffer.objects.select_for_update().get(id=...).

Assert that outcome == 'pending'. If it is anything else (declined, accepted, cancelled), immediately return a 409 Conflict and force the UI to refresh its state.

Answers to Your Open Design Questions
1. Priority rule default?

Answer: Default to 'fifo' (First-In, First-Out), but allow per-marina override on Day 1. 'fifo' requires zero explanation to an angry boater demanding to know why they were skipped. It is the most legally and socially defensible default. Let premium or private clubs explicitly opt into 'membership_then_fifo'.

2. Deposit on decline policy default?

Answer: Default to 'keep'. Life happens—a boater might be dealing with a medical issue or their boat is in the shop when an offer comes in. Booting them and stealing their deposit for declining one offer generates massive customer hostility. Give Harbor Masters the ability to switch to 'boot' only if their waitlist becomes unmanageably stagnant.

3. Refundable Escrow vs. Marina Revenue?

Answer: Strictly Refundable Escrow. Do not recognize this as marina revenue. If you make it a non-refundable application fee, you trigger massive accounting complexity (deferred revenue recognition over an unknown, multi-year time horizon) and potential legal scrutiny in certain jurisdictions regarding "junk fees." Keep it as a liability/escrow on the books until it is either refunded or applied as a credit to their first lease invoice.

Secondary Questions:

Auto-cascade depth: 3 is the perfect default. Any deeper, and the system starts feeling like it's blindly firing offers into the void.

Reminders: A single 12h reminder is risky because it might hit the boater's inbox at 3:00 AM. Use T-24h and T-2h.

Public "average wait time" widget: Absolutely do not build this. Wait times at marinas are highly non-linear. Slips turn over based on unpredictable life events (death, selling the boat, moving). Giving an "average" creates a false legal promise, and boaters will hold the marina hostage over it ("The website said 8 months, it's been 9!"). Keep the analytics strictly internal for the manager.

With the Stripe expiry handled and the state machine locked down, this architecture is incredibly sound.

Given that Harbor Masters will now be managing offline refunds for multi-year waitlist withdrawals, should we spec out a dedicated "Financial Actions Required" widget on their dashboard to ensure those manual refunds don't slip through the cracks?

---

## 17. Locked Decisions (2026-05-16) — implementation contract

These are the final, binding choices for the v1 implementation. They override any earlier draft defaults in this document.

**D. Priority rule:** `'fifo_paid_first'`. Boaters who have paid the deposit rank ahead of those who applied earlier but haven't paid. Within each payment tier, order by `applied_at` ascending. Per-marina override remains available, but this is the global default.

**E. Decline policy: 3-strikes.** Replace the binary `decline_policy in {keep, boot}` with a numeric `decline_count` on `WaitlistEntry` and a marina-level `max_declines` (default `3`).
- On each decline: increment `decline_count`.
- If `decline_count < max_declines`: status returns to `pending`, entry stays in queue.
- If `decline_count >= max_declines`: status becomes `removed_max_declines`, deposit refund is initiated (subject to the Stripe 180-day trap handling below).
- Every "Offer Declined" email MUST include the explicit line: `"You have declined {n} of {max} offers. If you decline {remaining} more, you will be removed from the waitlist and your deposit will be refunded."`

**F. Deposit economics: refundable escrow only.** The deposit is never recognized as marina revenue until the boater accepts an offer and converts to a paid lease. On withdraw, decline-max, or marina-cancel: full refund. On accept-and-convert: credited toward the first lease invoice.

### Locked architectural patches (from the architectural review above)

**Stripe 180-day refund trap (mandatory):** `refund_payment_intent()` must catch Stripe's `charge_already_refunded` / `charge_expired` / generic `InvalidRequestError` errors that arise on refunds older than ~180 days. On failure:
1. Set `WaitlistEntry.deposit_state = 'manual_refund_required'`.
2. Create a `RefundAction` row (new model, lightweight) with `{entry, amount_cents, reason, created_at, completed_at=null, completed_by=null}`.
3. Notify the marina via the existing `dispatch()` channel.
4. Manager UI exposes a "Mark as Refunded Offline" action that fills `completed_at` + `completed_by` and writes an `AuditLog` row.

**Magic-link race condition (mandatory):** `POST /api/v1/waitlist/offers/<token>/respond/` must wrap the offer lookup in `with transaction.atomic(): WaitlistOffer.objects.select_for_update().get(magic_token=token)`. Before processing the response, assert `offer.outcome == 'pending'` AND `offer.expires_at > now()`. If either fails, return **409 Conflict** with a body indicating the actual current state. This blocks the laptop-tab vs. phone-tab dual-click case AND the manager-cancel vs. boater-accept case.

### Secondary decisions (also locked)

- **Auto-cascade depth (phase 2):** default `3`.
- **Reminders:** T-24h AND T-2h (both, not just T-12h).
- **Public "average wait time" widget:** NOT BUILT. Keep wait-time analytics strictly internal to the manager dashboard.

### Locked test additions
- `test_decline_3rd_strike_triggers_refund` — decline three times, assert status, deposit_state transitions, audit row.
- `test_decline_email_copy_contains_strike_count` — assert email body contains the literal `"You have declined 1 of 3"` etc.
- `test_priority_fifo_paid_first_orders_correctly` — A (paid 2024-01-05), B (unpaid 2024-01-01), C (paid 2024-02-01) → ranking [A, C, B].
- `test_old_deposit_refund_falls_back_to_manual` — mock Stripe to raise `InvalidRequestError` for an old PI, assert `deposit_state='manual_refund_required'` + `RefundAction` row + dispatch call.
- `test_offer_respond_409_on_concurrent_state` — flip offer to `declined` mid-flight via direct DB write, assert second `/respond/` returns 409.
- `test_offer_respond_holds_row_lock` — concurrent accept + decline from two clients; exactly one wins, the other gets 409.