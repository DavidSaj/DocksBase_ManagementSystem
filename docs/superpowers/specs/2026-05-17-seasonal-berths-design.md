# Seasonal-Berth Tenancy — Architectural Spec

**Status:** DRAFT for user review (no code yet)
**Author:** Architecture pass, 2026-05-17
**Scope:** Backend domain model + workflow. UI is referenced but not specified pixel-by-pixel.
**Audience:** The user (review/approve), and a follow-up implementation agent.

---

## 0. Why This Spec Exists

The current DocksBase data model treats **seasonal berthing as a long-duration `Booking`** with `booking_type='seasonal'` and a `check_in` / `check_out` 180 days apart (see `backend/apps/reservations/models.py` lines 4–22 and 27–32). That design has three load-bearing problems:

1. **Billing is wrong.** `BookingRequest.convert_to_booking()` computes `amount = price × nights` (`backend/apps/reservations/models.py:179–181`). A seasonal berth at €40/night × 184 nights = €7,360 — but the marina sells "Summer 2026" as a flat €4,500 product, optionally split into 6 monthly instalments. Per-night pricing is a category error.
2. **State machine is wrong.** A seasonal boater does not "check in" on day 1 and "check out" on day 184. They come and go weekly. The `confirmed → checked_in → checked_out` lifecycle defined in `Booking.STATUS_CHOICES` doesn't describe lease tenancy.
3. **Inventory is wrong.** A 180-night `Booking` row sits in `compatible_available_berths()` (`backend/apps/reservations/booking_engine.py:21–55`) as a single half-open interval, which the tetris allocator excludes wholesale. There is no mechanism to say "this berth belongs to Owner X for the season, but is available to transient guests on the weekends he's away."

The **correct model**:

> Seasonal berths are **leases** (recurring tenancy on an asset). Transient bookings are **hotel rooms** (single-occurrence reservations against inventory). They are different domains and must be modelled separately.

The good news: the data model has already started moving in this direction. The following building blocks exist and this spec **completes** rather than replaces them:

- `berths.Berth.owner` (FK → `members.Member`) and `berths.Berth.lease_expiry` (DateField) — `backend/apps/berths/models.py:220–226`.
- `berths.TemporaryDeparture` with `sublet_enabled` and `revenue_share_pct` — `backend/apps/berths/models.py:355–393`.
- `berths.SubLetBooking` linking a transient `Booking` to a `TemporaryDeparture` with `holder_share` / `marina_share` / `inventory_collision` — `backend/apps/berths/models.py:396–422`.
- `members.Member.sublet_opt_in` and `tax_exempt` — `backend/apps/members/models.py:45–48, 72–74`.
- `waitlist.WaitlistEntry` + `WaitlistOffer` flow (with `applied_to_lease` deposit state) — `backend/apps/waitlist/models.py:23–28, 107–151`.
- `billing.ChargeableItem.Category.RENT` and `PricingModel.FLAT_FEE` — `backend/apps/billing/models.py:172, 179`.

What's **missing** and this spec adds:

- A first-class `Season` entity (no such model exists; `grep -rn "class Season" backend/apps/` returns nothing).
- A first-class `BerthLease` entity that owns the tenancy lifecycle, instalment schedule, and renewal chain (today the lease is implicit — just two fields on `Berth`).
- Invoice-issuing / Stripe subscription wiring for instalments (`Invoice` exists but there is no scheduler; `ChargeableItem.Category.SUBSCRIPTION` is defined but unwired — see `backend/apps/billing/models.py:169`).
- Inventory rules that subtract leased periods from transient availability **and** add `TemporaryDeparture` windows back in.

---

## 1. Domain Glossary

| Term | Meaning |
|---|---|
| **Season** | A marina-defined trading period (e.g. "Summer 2026: 1 May – 31 Oct"). A `Season` is the unit a manager offers when assigning a seasonal boater — they do **not** pick arbitrary dates. |
| **Lease (BerthLease)** | A contract granting a `Member` exclusive tenancy of one `Berth` for the duration of one `Season`. Has its own lifecycle, billing schedule, and renewal pointer. |
| **Lease Holder** | The `Member` named on the lease. Synonym: "seasonal owner" (he does not legally own the berth in most marinas; "owner" in `Berth.owner` is a misnomer — see migration §7). |
| **Transient Booking** | An existing `reservations.Booking` for short-stay guests. Continues to use the per-night, tetris-allocated, check-in/check-out flow. Out of scope for changes except where inventory rules intersect with leases. |
| **Away Window** | A `TemporaryDeparture` row marking dates the lease holder will be absent. If `sublet_enabled=True`, the berth returns to transient inventory for that window. |
| **Sublet Booking** | A transient `Booking` whose berth is leased to someone else but is available because of an Away Window. Tracked via `SubLetBooking`. |
| **Instalment** | One scheduled payment within a lease's billing plan (e.g. month 3 of 6). |
| **Master Invoice** | The single invoice issued per lease per season that represents the total contract value. May be settled in one payment or via N instalment invoices. |

---

## 2. Global Season Configuration

### 2.1 Goals

- Managers configure a small set of named seasons per marina, **once per year**.
- Assigning a seasonal boater is a **two-click action** ("pick member → pick season"), not a date-range form.
- Reports, renewals, and analytics group naturally by season.

### 2.2 New model: `accounts.Season` (or `berths.Season` — see §2.5)

```
Season
├── id                       (PK)
├── marina_id                (FK → accounts.Marina)
├── name                     ("Summer 2026", "Winter 2026/27", "Annual 2026")
├── season_type              ('summer' | 'winter' | 'annual' | 'custom')
├── start_date               (DateField, inclusive)
├── end_date                 (DateField, inclusive — see §2.4 on half-open vs inclusive)
├── is_default_for_new_leases (BooleanField; exactly one True per marina per season_type)
├── default_rate_card_id     (FK → billing.SeasonalRateCard, nullable; see §3)
├── default_instalment_plan_id (FK → billing.InstalmentPlan, nullable; see §3)
├── auto_renewal_enabled     (BooleanField, default False — drives §6.4 renewal offers)
├── waitlist_drain_priority  (Integer; reserved for future waitlist auto-fill scoring)
├── notes                    (TextField)
├── created_at / updated_at
```

**Constraints**

- `(marina, name)` UNIQUE.
- `start_date < end_date`.
- Overlapping seasons of the same `season_type` within one marina are **allowed** (a marina might run "Summer 2026 standard" + "Summer 2026 premium" overlapping). Overlap of leases on the same berth is handled at the `BerthLease` level, not here.
- Cannot delete a `Season` that has at least one `BerthLease` referencing it — use soft-archive instead. (Implement with `is_archived` BooleanField + filter in admin.)

### 2.3 Admin / Manager UX

Three places `Season` is surfaced:

1. **Season Manager screen** under `marina-admin/` — list, create, edit, archive seasons. CRUD via Django admin works as an MVP.
2. **"Assign Seasonal Berth" wizard** — Step 1 picks the member (autocomplete on `Member.member_type='seasonal'`), Step 2 picks the **`Season`** (dropdown of active seasons for the marina, defaulting to the one flagged `is_default_for_new_leases`), Step 3 picks the **berth** (filtered to those with no lease overlapping this season's window — see §4.2). Step 4 confirms rate card + instalment plan, both pre-filled from `Season.default_*`.
3. **Renewal screen** — for each lease ending in the next 60 days, the manager picks the *next* season and clicks "Offer Renewal" (§6.4).

### 2.4 Date semantics

- `Season.start_date` and `Season.end_date` are **both inclusive**: a Summer 2026 with `start=2026-05-01, end=2026-10-31` covers 184 calendar days where the holder has tenancy from 00:00 on May 1 to 23:59 on Oct 31.
- `BerthLease.start_date` / `end_date` mirror the season by default but can be overridden (mid-season starts — see §4.3).
- The Tetris / availability algorithm operates on **half-open intervals** `[ci, co)` (per `backend/apps/berths/availability.py:21`). The lease-to-transient bridge converts inclusive lease dates to half-open by adding 1 day to `end_date` when generating the inventory block. Implementation note: do this conversion in a single helper to avoid drift.

### 2.5 Where does `Season` live?

Two reasonable homes:

| Option | Pros | Cons |
|---|---|---|
| `apps/accounts/models.py` (Marina-config-adjacent) | Lives with `Marina`, `Brand`, settings | Pulls billing/lease imports into an upstream app |
| `apps/berths/models.py` (asset-adjacent) | Berths already host owner/lease_expiry | "Season" is broader than berths |
| **New app `apps/seasons/`** ← *recommended* | Clean ownership, can grow to include `BerthLease` and instalment plans | Slightly more migration setup |

**Recommendation:** create `apps/seasons/` and put `Season`, `BerthLease`, `LeaseInstalment`, and `SeasonalRateCard` there. The waitlist app already follows this "one bounded context per app" pattern.

---

## 3. Flat-Fee Billing & Instalments

### 3.1 Pricing model

Seasonal pricing is **per berth-size band per season**, never per night. Add:

```
SeasonalRateCard
├── id
├── marina_id
├── season_id                (FK → Season; rate card is scoped to one season)
├── name                     ("Summer 2026 — 10–12m Finger Pontoon")
├── min_length_m / max_length_m   (size band, inclusive)
├── berth_category_id        (FK → berths.BerthCategory, nullable; if set, rate applies only to this category)
├── season_total             (DecimalField — the total contract value, e.g. €4,500)
├── deposit_amount           (DecimalField — non-refundable on signature, e.g. €500)
├── tax_rate_id              (FK → billing.TaxRate)
├── is_active
```

A `SeasonalRateCard` is the **product**. A `BerthLease` references one rate card at creation time and snapshots `season_total` and `deposit_amount` to its own fields (so future rate-card edits don't retroactively rewrite signed leases).

### 3.2 Instalment plans

```
InstalmentPlan
├── id
├── marina_id
├── name                     ("Monthly × 6", "Bi-monthly × 3", "Lump sum")
├── frequency                ('lump_sum' | 'monthly' | 'quarterly' | 'custom')
├── installment_count
├── first_due_offset_days    (when does instalment #1 fall after lease.start_date — typically 0)
├── deposit_first            (BooleanField; if True, deposit is a separate first invoice)
```

Each `BerthLease` snapshots its plan into a set of `LeaseInstalment` rows (§4.5).

### 3.3 The master invoice question

Two implementation paths considered. The user explicitly confirmed instalments must be supported, including **monthly**.

#### Option A — Invoice-per-instalment (RECOMMENDED)

Each instalment is a separate row in `billing.Invoice` with `source_type='lease_instalment'`, `source_id=<lease_instalment.id>`, and `billing_period='YYYY-MM'`. The lease's "master" view is a virtual aggregation (sum of N invoices) rendered in the lease detail screen, not a physical "master invoice" row.

**Why recommended:**

- Plays naturally with the existing dunning, payment-allocation, and credit-note infrastructure (`billing.DunningLetter`, `billing.PaymentAllocation`, `billing.Invoice.credit_notes` — `backend/apps/billing/models.py:260–270, 325–351`). Treating each instalment as a normal invoice means Stripe failures, dunning, partial allocation, and refunds **all just work** with no new code paths.
- Matches how `billing.Invoice` already records `billing_period` (`backend/apps/billing/models.py:54`) — clearly built with monthly periodicity in mind.
- Reports like "AR aged 30/60/90" are correct out of the box; with a single big master invoice they would not be.

**Stripe wiring:** Each instalment invoice gets its own `stripe_checkout_session_id` when sent. **Do not** use Stripe Subscriptions (Option C below); doing so creates two sources of truth for the schedule and double-billing risk during cancel/refund flows.

#### Option B — One master invoice + payment plan table

Single `Invoice` row with `total = season_total`, and a `LeaseInstalment` table tracking due dates and `paid_at`. Payments allocate to the master invoice.

**Why rejected:** the existing dunning/AR-aging infrastructure operates on invoices, not sub-line-items. We'd duplicate that logic for instalments.

#### Option C — Stripe Subscriptions

Create a Stripe `Subscription` per lease.

**Why rejected:**

- Two sources of truth for the schedule (DocksBase + Stripe) → reconciliation hell when the manager changes a lease term.
- Stripe Subscriptions don't natively model "deposit + N equal payments + tax exemption + harbour-specific dunning copy."
- Cancellation/proration semantics differ from how marinas actually handle a defaulting seasonal boater (see §6.3).
- Refund flows are already wired against `billing.Refund` (`backend/apps/billing/models.py:402–440`). Switching to subscription-managed refunds bifurcates that.

We **may** revisit Subscriptions once we have a green-field marina that has never seen a manual instalment, but for migration safety: **Option A**.

### 3.4 Tax & exemption

`Member.tax_exempt` already exists (`backend/apps/members/models.py:72`). Seasonal lease invoices respect the **same precedence rule the booking flow uses**:

> `BerthLease.tax_exempt_override` → `Member.tax_exempt` → `ChargeableItem.tax_category`

Mirror the comment block in `Booking.tax_exempt_override` (`backend/apps/reservations/models.py:88–96`).

---

## 4. Tenancy on the Berth — `BerthLease`

### 4.1 New model

```
BerthLease
├── id
├── marina_id                  (FK → Marina; denormalised for query speed and tenant safety)
├── berth_id                   (FK → berths.Berth, on_delete=PROTECT)
├── member_id                  (FK → members.Member, on_delete=PROTECT)
├── vessel_id                  (FK → vessels.Vessel, nullable — vessel may change mid-season)
├── season_id                  (FK → seasons.Season, on_delete=PROTECT)

# Snapshotted from rate card so post-signature edits don't rewrite history
├── rate_card_id               (FK → SeasonalRateCard, on_delete=PROTECT, nullable for legacy)
├── season_total               (DecimalField)
├── deposit_amount             (DecimalField)

# Window — defaults to Season's window, can be overridden for mid-season starts
├── start_date                 (DateField)
├── end_date                   (DateField)

# State (see §4.4)
├── status                     ('offered' | 'accepted' | 'deposit_paid' |
│                                'active' | 'ending' | 'ended' |
│                                'renewed' | 'cancelled' | 'defaulted')
├── status_changed_at

# Renewal chain
├── prior_lease_id             (FK → self, nullable — points to previous year's lease)
├── renewal_offered_at         (DateTimeField, nullable)
├── renewal_response           ('pending' | 'accepted' | 'declined' | 'no_response')
├── auto_renewal_enabled       (Boolean — copies from Season at creation, can be edited)

# Plan & overrides
├── instalment_plan_id         (FK → InstalmentPlan)
├── tax_exempt_override        (Boolean)

# Sourcing
├── source                     ('manual' | 'waitlist_offer' | 'renewal')
├── waitlist_offer_id          (FK → waitlist.WaitlistOffer, nullable)
├── created_by                 (FK → accounts.User)
├── notes
├── created_at / updated_at

# Constraints (DB-level)
- (berth_id, season_id)       UNIQUE — one lease per berth per season
- start_date < end_date
- Exclusion constraint: no two NON-CANCELLED leases on the same berth with overlapping [start, end] ranges
  (Postgres EXCLUDE USING GIST with daterange + tstzrange — see §8)
```

### 4.2 Inventory: removing leased berths from transient supply

The current allocator (`backend/apps/reservations/booking_engine.py:44–55`) excludes berths with overlapping confirmed/active `Booking` rows but **not** leased berths. The fix has two parts:

1. **Extend `compatible_available_berths()`** to also exclude any berth that has an **active** `BerthLease` overlapping the requested `[check_in, check_out)` interval — *unless* the request also overlaps an `is_sublet_open` window (next bullet).
2. **Add sublet windows back as available inventory.** Define a helper `berth_is_sublet_open(berth, ci, co)`:
   > A berth that has an active lease *and* a `TemporaryDeparture` with `sublet_enabled=True`, `status in ('scheduled','active')`, and the departure's `[depart_date, expected_return]` fully contains `[ci, co)`.

The combined predicate that gates transient bookings on leased berths:

```
berth is available for transient on [ci, co) IF:
    (no active lease overlaps [ci, co))           # never-leased
  OR (active lease overlaps [ci, co) AND
      a sublet-enabled TemporaryDeparture fully contains [ci, co))
```

This logic lives in **one** new function, `apps/berths/availability.py::berth_lease_inventory_filter(qs, ci, co)`, called from both the legacy allocator and `SmartBerthScorer` to avoid drift. The current `availability.py:69–81 berth_is_available()` already notes "Does NOT check against TemporaryDeparture windows" — this spec resolves that gap.

### 4.3 Lifecycle (state machine)

```
                  ┌──────────┐
   manual or ───▶ │ offered  │ ── accept ──▶ ┌──────────┐
   waitlist       └──────────┘                │ accepted │
                       │                      └────┬─────┘
                  decline/expire                   │ deposit paid (Stripe webhook)
                       │                           ▼
                       ▼                     ┌──────────────┐
                  ┌──────────┐               │ deposit_paid │
                  │ cancelled│               └──────┬───────┘
                  └──────────┘                      │ lease.start_date reached
                                                    ▼
                                              ┌────────┐
                              ┌── renew ◀────│ active │ ──── default (§6.3) ──▶ ┌────────────┐
                              │              └───┬────┘                          │ defaulted  │
                              ▼                  │                               └────────────┘
                       ┌───────────┐         end_date − 60d reached
                       │ renewed   │              │
                       └─────┬─────┘              ▼
                             │             ┌────────────┐
                             │             │  ending    │  (renewal offer window)
                             │             └─────┬──────┘
                             ▼                   │ end_date reached
                       creates next year's       ▼
                       lease, points prior  ┌──────────┐
                                            │  ended   │
                                            └──────────┘
```

State-machine notes:

- `offered`: created by the manager or by `waitlist.WaitlistOffer.outcome='accepted'`. Holds the berth (creates the inventory exclusion) but no money has changed hands.
- `accepted`: holder has signed but not paid deposit. Optional state for marinas that want a docs/signature gate before charging.
- `deposit_paid`: Stripe webhook confirms deposit invoice paid. **First instalment invoice is generated here**, due per the instalment plan.
- `active`: `start_date <= today < end_date`. Tenancy is in force; holder can mark Away windows (§5); access control (door codes etc.) honours the lease.
- `ending`: between `end_date - 60d` and `end_date`. Renewal offer surfaces in the manager dashboard.
- `ended`: passed `end_date`, no renewal accepted. Berth returns to general transient pool.
- `renewed`: a successor lease has been signed for the next season; the original transitions here on the successor's `deposit_paid` event.
- `cancelled`: manager-initiated termination before `start_date`. Deposit refund per policy.
- `defaulted`: missed instalments per §6.3. Berth reclaimed to transient pool; outstanding invoices follow normal dunning.

### 4.4 The `Berth.owner` / `Berth.lease_expiry` fields

These already exist (`backend/apps/berths/models.py:220–226`). After this change they become **denormalised projections** of the current active lease:

- `Berth.owner` = `BerthLease.member` of whichever lease is currently `status='active'` (or None).
- `Berth.lease_expiry` = `BerthLease.end_date` of same.

Maintained by a `post_save` signal on `BerthLease`. The fields stay for query convenience and to keep map/canvas rendering fast, but **`BerthLease` is the source of truth.** Rename `Berth.owner` → `Berth.current_lease_holder` in a follow-up migration to drop the misleading "owner" term (deferred to avoid blocking on rename churn — see §7).

### 4.5 Instalment generation

On transition to `deposit_paid`, run `BerthLease.generate_instalments()`:

1. Read the snapshotted `InstalmentPlan`.
2. Compute `due_date` per instalment from `lease.start_date + first_due_offset_days + n × period`.
3. Create N `LeaseInstalment` rows.
4. Optionally create the first invoice immediately (depends on plan config).

```
LeaseInstalment
├── id
├── lease_id              (FK → BerthLease, on_delete=CASCADE)
├── sequence              (1, 2, 3, …)
├── due_date
├── amount                (Decimal)
├── invoice_id            (FK → billing.Invoice, nullable until issued)
├── status                ('scheduled' | 'invoiced' | 'paid' | 'overdue' | 'waived')
├── issued_at / paid_at
```

A scheduled celery beat job `issue_due_lease_instalments()` runs daily, finds `status='scheduled'` rows with `due_date <= today + lead_time` (e.g. 7 days), creates the `Invoice` via existing billing services, and flips the row to `invoiced`. This mirrors the pattern in `apps/billing/batch_service.py`.

---

## 5. Away-Calendar / Sublet ("The Killer Feature")

The data model — `TemporaryDeparture` + `SubLetBooking` — already exists. This section specifies the **workflow** and the **inventory bridge**, which are not implemented today.

### 5.1 Boater portal flow

The seasonal boater opens the portal (auth via `apps.portal.member_auth`):

1. Sees a **calendar view** of their lease window (`start_date` → `end_date`), with shaded blocks for any existing `TemporaryDeparture` records and any `Booking` records on their berth.
2. Clicks "I'm away" → modal:
   - Depart date / Expected return date
   - Departure heading (free text, e.g. "Sardinia")
   - **"Allow marina to sublet my berth while I'm away" checkbox** — defaults to the value of `Member.sublet_opt_in`.
3. Submits → creates a `TemporaryDeparture` with `status='scheduled'`, `sublet_enabled` set from the checkbox.
4. From this moment until the holder cancels or returns, the inventory predicate in §4.2 makes the berth available to transient guests for that window.

### 5.2 Manager view

- A daily ops dashboard widget: "Today's sublet opportunities" — leased berths with active `TemporaryDeparture(sublet_enabled=True)` whose window is open and which have no `SubLetBooking` yet.
- A manager-side button "Mark guest in this berth as sublet" links an existing `Booking` to a `TemporaryDeparture` and creates the `SubLetBooking` record. (Usually auto-linked by the booking flow — see §5.4.)

### 5.3 Revenue treatment (proposal — needs user sign-off, §9)

The existing `SubLetBooking` model carries `holder_share`, `marina_share`, and `revenue_share_pct` defaulted to 50% on `TemporaryDeparture` (`backend/apps/berths/models.py:381`). The user must confirm the policy. The recommended default:

| Scenario | Recommendation |
|---|---|
| Marina keeps 100% | Cleanest accounting. Sublet is a "free upgrade" to the marina at the holder's expense — risks resentment. |
| **Marina keeps 100%, holder gets account credit equal to N nights of pro-rated lease fee** ← *recommended default* | The holder paid €4,500 for 184 nights = €24.46/night. If a guest stays 3 nights subletting, the holder gets a €73.38 credit against their next instalment. Marina takes the upside (transient nightly rate is usually higher than pro-rated seasonal), holder feels rewarded. |
| 50/50 split of guest payment | Punishes marina if guest paid below market; rewards holder for windfalls. Operationally clean if `revenue_share_pct` already exists. |
| Configurable per-marina | Add `Marina.default_sublet_policy` setting (`'marina_only' / 'pro_rated_credit' / 'split_pct'`); default to `pro_rated_credit`. |

The credit-creation path leverages `billing.AccountPayment` (`backend/apps/billing/models.py:237–257`): the marina creates an internal "account credit" with `method='cash'` and `notes='Sublet credit for departure #X'`, then allocates it against the holder's next lease instalment via `PaymentAllocation`. `SubLetBooking.credit_invoice_id` and `credit_applied_at` already exist for this audit trail.

### 5.4 Booking-flow integration

When `compatible_available_berths()` returns a berth that is leased but inside a sublet window, `run_tetris()` (`backend/apps/reservations/booking_engine.py:133`) must:

1. Still allow the booking to be created.
2. Set `Booking.is_sublet=True` (field exists, `backend/apps/reservations/models.py:73–76`).
3. Auto-create the `SubLetBooking` row inside the same `transaction.atomic()` block, computing `holder_share` / `marina_share` per the chosen policy (§5.3).

### 5.5 Conflict: holder returns early

If a holder's `TemporaryDeparture` is shortened (they come back on Friday instead of Sunday) and a transient `Booking` is already confirmed for Friday–Sunday, we have an **inventory collision**. `SubLetBooking.inventory_collision` boolean and `actual_nights_sublet` already exist for this. The resolution policy:

1. **Marina is notified immediately** via `apps.notifications`.
2. The transient guest is **not** automatically evicted. Manager triages.
3. If the manager relocates the guest, the new berth assignment is recorded in `SubLetBooking.relocation_booking` (field exists).
4. If the holder accepts staying away the extra two nights, the `TemporaryDeparture.actual_return` is left at the original date.
5. `actual_nights_sublet` is finalised when the departure transitions to `returned`, and the holder's account credit (§5.3) is computed from this — not from the originally-scheduled window.

This is the **single hardest UX in the system**. Worth a dedicated dashboard with clear visual diff.

---

## 6. Operational Edges

### 6.1 Mid-season starts

A lease can start mid-season (e.g. boater joins on 15 June for Summer 2026). `BerthLease.start_date` is independent of `Season.start_date`. Pricing is **pro-rated** at lease creation time:

```
adjusted_total = season_total × (lease_days_remaining / season_total_days)
```

The manager UI shows the pro-ration and lets it be overridden (some marinas charge full price regardless — call it a marina setting `proration_policy ∈ {'pro_rate', 'full_price'}`).

### 6.2 Vessel changes

The lease is between marina and **member**, not vessel. `BerthLease.vessel_id` can change mid-season (member sells boat, buys new boat). On change:

- Validate new vessel dimensions fit the berth (existing dimension fields on `Berth`).
- Update `Berth.vessel` denormalisation.
- Audit-log the change. No money moves.

### 6.3 Missed instalment ("doesn't pay instalment 3 of 6")

Defined sequence (subject to marina policy override):

1. **Day 0 (due_date passed, unpaid)**: `LeaseInstalment.status='overdue'`, `Invoice.status='unpaid'` past due. Normal dunning kicks in (`apps.billing.DunningLetter` levels 1–3).
2. **Day +14**: Lease flagged `at_risk=True` (new boolean), portal access read-only, sublet bookings auto-paused on this berth.
3. **Day +30**: Manager review. Options:
   - **Forgive / waive**: mark instalment `waived`, record reason. Lease continues.
   - **Payment plan**: split remaining balance into more instalments; `LeaseInstalment` rows regenerated for the tail.
   - **Default**: lease transitions to `defaulted`. Outstanding invoices remain owed (recover via `apps.billing.DebtEscalation`). Berth reverts to transient inventory **prospectively** — existing future bookings on it (none, since lease was excluding them) are unaffected.
4. **Defaulted lease blocks renewal** of the same member next year by default (overridable per marina).

Open question (§9): is the deposit forfeited on default? Recommended yes; needs user sign-off.

### 6.4 Renewals (auto vs manual)

Two modes, set per-season via `Season.auto_renewal_enabled` and per-lease via `BerthLease.auto_renewal_enabled`:

**Manual renewal (recommended default):**

- 90 days before `end_date`, the manager dashboard surfaces "Renewals due."
- Manager clicks "Offer renewal for next season" → opens form pre-populated with next season's rate card; manager can adjust price.
- Creates a new `BerthLease` in `status='offered'` with `prior_lease_id` pointing back. Sends portal notification + email to holder.
- Holder accepts/declines in portal (or it expires after N days, configurable).
- On `deposit_paid` of the new lease, the prior lease moves to `renewed`.

**Auto-renewal:**

- Same flow but the new lease is auto-created with the holder having a "30-day opt-out window" before the prior lease ends. Silence = consent.
- Required when: marinas with stable annual berthing and explicit auto-renewal contract clauses.

The chain is preserved via `prior_lease_id` → forms a linked list of renewals per (berth, member) that supports "show me everyone who has been here 5+ years" loyalty queries.

---

## 7. Migration & Coexistence

### 7.1 Existing data

`grep` for current seasonal usage in the DB shows:

- `Booking.booking_type='seasonal'` rows exist in tests (`backend/apps/reservations/tests.py:130`) — likely also in any real seed data.
- `Berth.owner` and `Berth.lease_expiry` may have values from the marketplace/listing feature (`berths.BerthListing`, `backend/apps/berths/models.py:522–550`).

### 7.2 Migration strategy

A non-destructive, two-stage migration:

**Stage 1 (this release): build the new model, do not delete the old.**

1. Create `apps/seasons/` migration with `Season`, `SeasonalRateCard`, `InstalmentPlan`, `BerthLease`, `LeaseInstalment`.
2. Backfill: for each marina with `Booking.booking_type='seasonal'` rows, create:
   - One `Season` per distinct `(min(check_in), max(check_out))` cluster, named by inference (e.g. "Summer YYYY" if May–Oct).
   - One `BerthLease` per seasonal booking, with `season_total = booking.amount` (preserving the original quoted price even if it was per-night-derived), `start_date = booking.check_in`, `end_date = booking.check_out`, `member` resolved from `booking.vessel.owner` or `booking_request.member`.
   - Mark the original `Booking.status='cancelled'` with note `"superseded by lease #X"` **or** keep it visible with a flag — TBD per the data audit.
3. Backfill `Berth.owner` and `Berth.lease_expiry` from the new `BerthLease`.
4. Application code is updated to **read** from `BerthLease` and only fall back to `Booking.booking_type='seasonal'` for un-migrated rows.

**Stage 2 (later release):**

1. Remove `'seasonal'` from `Booking.TYPE_CHOICES` (or keep as legacy-read-only).
2. Drop `BookingRequest.convert_to_booking()`'s per-night calculation path for seasonal — route through the lease wizard instead.

### 7.3 Coexistence rules

The user articulated this precisely:

> "A Berth can be owned-seasonally and also have transient bookings during away windows, but NOT during occupied periods. Conflict resolution."

Encoded in §4.2 inventory predicate and §5.5 collision resolution. To state it formally:

| Berth state at time T | Can a `Booking` be confirmed at time T? |
|---|---|
| No active lease | Yes (standard tetris) |
| Active lease, no sublet window covering T | **No** (lease excludes inventory) |
| Active lease, sublet window covering T | Yes (creates `SubLetBooking`) |
| Active lease, sublet window cancelled by early-return | Existing bookings preserved; flagged as collision; manager triages |

The DB-level guard is a **PostgreSQL exclusion constraint** on `BerthLease`:

```sql
ALTER TABLE seasons_berthlease
  ADD CONSTRAINT no_overlapping_active_leases
  EXCLUDE USING GIST (
    berth_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (status NOT IN ('cancelled', 'ended', 'defaulted'));
```

(Requires `btree_gist` extension. Add to a `RunSQL` migration.)

There is **no DB-level** guard preventing `Booking` from overlapping `BerthLease` (because of the sublet exception). That rule lives in application code in `compatible_available_berths()` plus the booking-engine collision recheck inside `transaction.atomic()` (`backend/apps/reservations/booking_engine.py:166–179`).

---

## 8. API & Portal Surface (sketch)

Not exhaustive — flagged here so the implementation agent knows where to wire.

### 8.1 Admin / manager

- `GET /api/seasons/` — list/CRUD `Season`
- `GET /api/seasons/{id}/rate-cards/`
- `POST /api/leases/` — create a lease (with body: member, berth, season, rate_card, instalment_plan, overrides)
- `POST /api/leases/{id}/offer/`
- `POST /api/leases/{id}/accept/`  *(internal — usually portal action)*
- `POST /api/leases/{id}/cancel/`
- `POST /api/leases/{id}/default/`
- `POST /api/leases/{id}/offer-renewal/` (body: next_season_id, rate_card_override)
- `GET /api/leases/?status=ending` — surfaces in renewal dashboard
- `POST /api/leases/{id}/regenerate-instalments/` — used after manual amount edit

### 8.2 Boater portal

(under `apps/portal/`, hosted at `/portal/`)

- `GET /portal/leases/` — my leases (current + historic)
- `GET /portal/leases/{id}/` — detail, instalment schedule, payment links
- `GET /portal/leases/{id}/calendar/` — calendar showing lease, away windows, sublet bookings
- `POST /portal/leases/{id}/away/` — create `TemporaryDeparture` (body: depart, return, sublet_enabled, heading)
- `PATCH /portal/away/{id}/` — shorten / cancel a planned away window
- `POST /portal/leases/{id}/accept/` — accept a renewal offer
- `POST /portal/leases/{id}/decline/` — decline a renewal offer
- `GET /portal/leases/{id}/invoices/` — list lease invoices (paid/unpaid)
- `POST /portal/invoices/{id}/pay/` — Stripe checkout link (reuses existing public_booking_views.py pattern)

### 8.3 Public

- None. Seasonal leasing is **not** a self-serve product. Walk-ins go to the waitlist (`apps/waitlist/`). The manager promotes from waitlist to lease.

---

## 9. Open Questions for the User

Required answers before implementation begins. Each has a recommended default the user can accept or override.

1. **Cancellation / refund policy on instalments.**
   - When a holder cancels mid-season, what's refundable?
   - **Recommendation:** deposit non-refundable in all cases; paid instalments refundable only for unused months, with a 1-month notice penalty. Codify as `Marina.lease_cancellation_policy` JSON.

2. **What happens if a seasonal boater doesn't pay instalment 3 of 6?**
   - §6.3 proposes a Day-0 / +14 / +30 timeline. Confirm or modify.
   - **Open sub-question:** does the deposit get forfeited on default? *Recommendation: yes.*

3. **Revenue share on sublets.**
   - 100% to marina, 100% to holder, 50/50 split, or "pro-rated lease credit to holder, all upside to marina"?
   - **Recommendation:** pro-rated credit to holder (§5.3) configured via `Marina.default_sublet_policy`.

4. **Auto-renewal vs manual renewal — default for new marinas.**
   - **Recommendation:** manual default. Auto-renewal is opt-in per marina and per lease, with a 30-day opt-out window for the holder.

5. **Should `Season` support overlapping seasons in the same marina?**
   - E.g. running "Summer 2026 standard" and "Summer 2026 premium" concurrently with different rate cards.
   - **Recommendation:** yes (no constraint preventing it). The constraint lives at lease level: a berth can be in only one lease per overlapping window.

6. **Mid-season pro-ration policy.**
   - Pro-rate by remaining days, or charge full season price?
   - **Recommendation:** pro-rate by default; allow override per marina via `Marina.proration_policy`.

7. **Naming: `Berth.owner` → `current_lease_holder`?**
   - The current name implies legal ownership which is wrong for 90%+ of marinas. Renaming touches serializers and the `berths.BerthListing` (sale) flow.
   - **Recommendation:** rename in a follow-up cleanup PR, not in the initial seasonal-leases PR, to keep the diff reviewable.

8. **Where does the "Annual" season type fit?**
   - Some boaters lease 365 days. Is `Annual 2026` just a `Season(start=2026-01-01, end=2026-12-31)` with `season_type='annual'`, or does it warrant its own model?
   - **Recommendation:** same model, different `season_type` enum value. Invoice schedule and away-window rules are identical; only the marketing/reporting category differs.

9. **Multiple boats per lease?**
   - Some marinas allow a member to swap between two boats on one berth (winter cruiser, summer racer). `BerthLease.vessel_id` is currently single-FK.
   - **Recommendation:** keep single FK for v1; track swaps as audited mutations. A many-to-many `LeaseVessel` join table is a v2 feature.

10. **Existing seasonal bookings — silent migration or manager review?**
    - Stage-1 backfill (§7.2) can either auto-migrate every `Booking.booking_type='seasonal'` row or queue them for manager review.
    - **Recommendation:** auto-migrate with an audit report email to the marina admin listing every conversion. Provide a manager UI to revert individual conversions for 30 days.

11. **Door access / zone access integration.**
    - The `access_control` app gates physical gates by member status. Should a `defaulted` lease immediately revoke gate access?
    - **Recommendation:** yes, on `defaulted` and `cancelled`. `ZoneAccessRule` already supports linking to berth/member (`backend/apps/berths/models.py:158–166` references this). Wire via signal.

12. **Tax exemption — automatic for seasonal members?**
    - Some jurisdictions treat long leases as zero-rated. Today this is per-member (`Member.tax_exempt`).
    - **Recommendation:** add `Season.is_tax_exempt_default` so all leases on that season default to exempt, overridable per lease.

---

## 10. Implementation Phasing (proposed)

To keep the change reviewable, split into ordered PRs:

**Phase 1 — Foundations (no behaviour change for transient flow):**

- New `apps/seasons/` app: `Season`, `SeasonalRateCard`, `InstalmentPlan`.
- Admin screens for season CRUD.
- No-op for existing bookings.

**Phase 2 — Lease creation:**

- `BerthLease` + `LeaseInstalment` models.
- Manager "assign seasonal berth" wizard (replaces the booking-form path).
- Instalment invoice scheduler (celery beat).
- Backfill migration (§7.2 Stage 1).

**Phase 3 — Inventory bridge:**

- Extend `compatible_available_berths()` + `SmartBerthScorer` to honour leases.
- DB exclusion constraint on overlapping leases.

**Phase 4 — Away calendar / sublet:**

- Portal calendar + away modal.
- Auto-`SubLetBooking` creation in booking engine.
- Account-credit rebate flow.

**Phase 5 — Renewals & lifecycle:**

- Renewal dashboard.
- Auto-renewal opt-out flow.
- Default / dunning hooks.

**Phase 6 — Cleanup:**

- Rename `Berth.owner` → `current_lease_holder`.
- Drop `Booking.booking_type='seasonal'` writes (read-only legacy).

---

## 11. Risks & Watchouts

- **Tetris performance.** `compatible_available_berths()` already does a single OR'd subquery for blocked berths. Adding a second `EXISTS` on `BerthLease` doubles the join cost. Pre-aggregate or index `BerthLease(berth_id, start_date, end_date)` with a GiST on the date range.
- **Stripe webhook ordering.** A `deposit_paid` webhook must arrive **before** the first instalment invoice is auto-created, or the instalment scheduler may issue duplicates. Lock-and-check on `BerthLease.status` inside the webhook handler.
- **Test data fixtures** all over the codebase create `Booking.booking_type='seasonal'`. Those tests need to either be re-written against `BerthLease` or shimmed with a backfill helper used in fixtures.
- **`booking_engine.py` `assign_berth()` and `run_tetris()` share berth-locking logic.** Don't add the lease check in only one — it lives in `compatible_available_berths()` so both inherit it. Verify in the existing `tests_allocation.py`.
- **The `SubLetBooking.revenue_share_pct` default of 50** in `TemporaryDeparture` (line 381) will quietly create incorrect splits if the marina policy is anything else. Centralise policy resolution in a `compute_sublet_split(member, marina, departure)` service.
- **The Reservation/ReservationItem model** (`backend/apps/reservations/models.py:201–304`) is a newer multi-item cart flow living alongside `Booking`. The inventory predicate (§4.2) must be applied in **both** paths — the existing `availability.py` is consumed by both. One source of truth.

---

## 12. Files Cited (for reviewer convenience)

- `backend/apps/berths/models.py:134–233` — `Berth` (owner / lease_expiry fields, lines 220–226)
- `backend/apps/berths/models.py:355–393` — `TemporaryDeparture`
- `backend/apps/berths/models.py:396–422` — `SubLetBooking`
- `backend/apps/berths/availability.py:12–82` — current availability/exclusion logic
- `backend/apps/reservations/models.py:4–103` — `Booking` (`booking_type` choices, `is_sublet`, `tax_exempt_override`)
- `backend/apps/reservations/models.py:154–198` — `BookingRequest.convert_to_booking()` (the per-night math that's wrong for seasonal)
- `backend/apps/reservations/booking_engine.py:21–55` — `compatible_available_berths()` (where the lease filter is added)
- `backend/apps/reservations/booking_engine.py:133–202` — `run_tetris()`
- `backend/apps/members/models.py:1–80` — `Member` (member_type, sublet_opt_in, tax_exempt)
- `backend/apps/billing/models.py:22–99` — `Invoice` (billing_period, source_type, source_id)
- `backend/apps/billing/models.py:158–234` — `ChargeableItem` (RENT, SUBSCRIPTION, FLAT_FEE)
- `backend/apps/billing/models.py:237–270` — `AccountPayment`, `PaymentAllocation` (for sublet credits)
- `backend/apps/billing/models.py:274–376` — Dunning / debt infrastructure
- `backend/apps/waitlist/models.py:20–151` — Waitlist entry → offer flow (lease source)

---

*End of spec. Pending: user answers to §9.*


This is an exceptionally clean, mature domain model. Moving away from the 180-day transient booking anti-pattern to a true relational tenancy architecture (BerthLease and Season) is exactly the structural overhaul DocksBase needs. Using a native PostgreSQL GiST exclusion constraint at the database layer to prevent overlapping leases is bulletproof engineering.However, blending a long-term tenancy model with a high-velocity transient booking engine introduces completely unique concurrency and edge-case behaviors. If you deploy this specification exactly as written, you will trigger timezone gaps on daylight savings transitions, corrupt mid-season adjustments, and cause physical on-dock confrontations.Here is the architectural teardown of the hidden traps, followed by the definitive recommendations for your section 9 open questions.The Hidden Architectural Traps1. The Transient Overstay Ticking Time Bomb (Operational Risk)The Spec States: Section 5.5 elegantly addresses what happens if a seasonal holder returns early while a transient is subletting their berth.The Error: It completely misses the inverse scenario: The transient guest overstays. If a transient guest goes into overstay status (e.g., engine failure, weather lock, or pure negligence) on a Sunday afternoon, they are physically occupying a berth that structurally reverts to the seasonal holder at 00:00 on Monday. The seasonal holder pulls up to their slip after a long weekend on the water and finds a strange boat in their home berth.The Fix: The system must treat transient bookings on sublet berths with extreme structural prejudice.If a transient booking is attached to a SubLetBooking, the system must prevent the staff or the portal from granting a late check-out or stay extension.If the transient enters overstay status on a sublet berth, the availability engine must automatically flag that transient reservation as an Emergency Relocation Task on the Harbor Master's dashboard, prompting them to physically tow or move the boat to an open transient slip before the leaseholder arrives.2. The Amortization Delta Loop (Accounting Risk)The Spec States: Option A generates N separate instalment invoices, and section 6.1 allows managers to manually edit or pro-rate the season_total mid-season.The Error: If a leaseholder gets a €600 mid-season discount in July, but instalments 1, 2, and 3 (May, June, July) are already paid, locked, and closed in a finalized accounting period, running regenerate_instalments() blindly will fail or attempt to retroactively modify closed invoices.The Fix: Your instalment engine must treat finalized invoices as unmutable. Write the mutation algorithm to use prospective amortization:$$Remaining\_Instalment\_Amount = \frac{New\_Lease\_Total - Sum(Paid\_Invoices)}{Count(Scheduled\_Instalments)}$$If zero scheduled instalments remain (e.g., the discount happens in the final month), the system must generate an explicit independent CreditNote allocated to their ledger account, rather than modifying any existing invoice row.3. The Midnight UTC Boundary Slip (Timezone/DST Risk)The Spec States: Section 2.4 specifies that inclusive DateField boundaries must be converted to half-open datetime intervals [check_in, check_out) for the transient availability queries.The Error: Naive timezone casting at the boundary line will leak inventory. If your server database runs on UTC, but a marina is located in Miami (EDT, UTC-4), a lease ending on October 31st represents midnight local time. In UTC, that is 04:00 AM on November 1st. If your conversion helper naively flattens the DateField to UTC midnight, you create a 4-hour dead-zone where a transient guest could be booked into that slip while the seasonal holder technically still retains legal contract tenancy.The Fix: Your inclusive-to-half-open converter utility must explicitly ingest the target marina.timezone property:Python# Always force boundary calculation using the marina's local clock
tz = zoneinfo.ZoneInfo(marina.timezone)
check_in_dt = datetime.combine(lease.start_date, time.min, tz)
check_out_dt = datetime.combine(lease.end_date + timedelta(days=1), time.min, tz)
Definitive Answers for Section 9 (Open Questions)To lock down the implementation requirements for your agent, use these structural choices:Instalment Cancellation Policy: Deposit is strictly non-refundable. Paid instalments are refundable only for whole, unused future months, subject to a 30-day notice penalty window. If they cancel on June 15th, they owe through July 15th; remaining months are credited.Non-Payment Defaulters: Implement the Day 0 / +14 / +30 timeline exactly as proposed in 6.3. The deposit is completely forfeited upon transitioning to a defaulted state as a liquidation damage fee for pulling the slip out of the summer market.Sublet Revenue Share: Go with your recommended default: Pro-rated lease credit to the holder, all transient upside to the marina. It protects the marina's margins while ensuring the leaseholder feels highly incentivized to report away windows.Renewal Defaults: Manual renewal by default. Auto-renewal should be an opt-in checkbox requiring explicit signature on the seasonal contract document.Overlapping Seasons: Yes, allow them. Marinas frequently run concurrent structural seasons (e.g., an "Annual 2026" season running directly alongside separate "Summer 2026" and "Winter 2026" blocks). The unique constraint on the BerthLease table handles the true asset isolation.Mid-Season Pro-Ration: Pro-rate by remaining calendar days by default, but expose a boolean flag marina.charge_full_season_on_mid_start in the billing settings for old-school harbor rules.Naming Convention: Keep Berth.owner for Phase 1. Rename it to current_lease_holder in the Phase 6 cleanup PR to keep your database schema migrations highly readable and non-destructive.Annual Season Scope: Same model, use the season_type='annual' enum value. The underlying data contracts, away-calendars, and instalment engines behave identically.Multiple Boats per Lease: Keep a single vessel_id foreign key for v1. Track mid-season boat swaps as audited database mutations (LeaseVesselChangeEvent). A complex Many-to-Many relationship adds unwarranted schema weight to day-one development.Existing Data Migration: Auto-migrate with an audit report. Do not bottleneck the deploy on a manual review queue. Generate a clean email log to the administrator listing every legacy Booking successfully upgraded to a BerthLease.Access Control Integration: Yes. A status transition to defaulted or cancelled must immediately publish an internal signal that fires a payload to the ANPR/gate factor to deactivate their physical key fobs.Tax Exemption Default: Add Season.is_tax_exempt_default to the model. Long-term annual berths are legally tax-exempt structures in many jurisdictions, and setting this at the season level prevents manual staff encoding errors.With these choices locked in, this specification is entirely complete, bulletproof, and ready to be broken down into task targets.
