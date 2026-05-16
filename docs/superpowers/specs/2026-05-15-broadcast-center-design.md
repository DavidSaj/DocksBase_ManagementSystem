---
title: Broadcast Center — Cohort SMS/Email Blasts
date: 2026-05-15
status: draft
---

# Broadcast Center

A unified manager surface to compose a single SMS or email and blast it to a
filtered cohort of boaters (currently-checked-in, on pier C, season-pass
holders, transient guests, etc.) in one click. Built for operational
moments — storm warnings, water main breaks, gate closures, fuel-dock
outages — where staff need to reach the right subset *now*, not via a
scheduled marketing campaign.

---

## 1. Scope & Non-Goals

### In scope
- Manager-initiated one-off blast to a manually-defined cohort.
- Channels: SMS (Twilio), Email (existing adapter), in-app PWA banner (phase 2).
- Cohort filters: reservation status, pier, slip range, membership type, opt-in.
- Per-recipient delivery tracking and provider-webhook reconciliation.
- Cost preview and confirmation guardrail before send.
- Audit trail: who, when, to how many, what content.

### Non-goals
- One-time *transactional* messages (booking confirmation, magic link,
  invoice email). Those continue to flow through
  `apps.communications.services.dispatch` driven by signals/`Journey`s.
- Multi-step nurture / drip campaigns. Those are
  `apps.communications.models.Journey` and `EmailCampaign` with A/B testing.
  A broadcast is single-shot, immediate, no variants.
- Inbound reply threading / two-way SMS conversation
  (kept for phase 3 — see §10).
- Staff-internal alert routing to Slack/Teams — already handled by
  `apps.communications.models.AlertRoute` and `services.alert.send_alert`.
- Marketing segmentation persistence beyond ad-hoc saved cohorts
  (Dotdigital sync stays the long-term home for marketing lists).

---

## 2. What Exists Today

| Concern | Where | Notes |
|---|---|---|
| Outbound channel abstraction | `backend/apps/communications/services/dispatch.py` | `dispatch(marina, channel, recipient, subject, body, …)` writes a `MessageLog` and calls the right adapter. **Reuse verbatim.** |
| SMS adapter | `backend/apps/communications/adapters/sms.py` | Thin Twilio wrapper, returns provider SID. Returns `''` if `TWILIO_ACCOUNT_SID` unset (dev safe). |
| Email adapter | `backend/apps/communications/adapters/email.py` | |
| Message audit | `backend/apps/communications/models.py::MessageLog` | Has `status` (queued/sent/delivered/opened/clicked/failed/bounced), `provider_message_id`, `failed_reason`, FKs to `marina/member/booking/journey_step`. **Will gain optional FK to `Broadcast`.** |
| Email delivery webhook | `backend/apps/communications/views.py::EmailWebhookView` (`/communications/webhooks/email/`) | Updates `MessageLog.status` from provider events. SMS equivalent does **not** exist — must be added (§8). |
| Reusable templates | `MessageTemplate` (model) — `{{variable}}` placeholders, channel-typed | Useful for preset weather/storm bodies in phase 2. |
| Manager segmentation | `apps.communications.services.campaigns.send_campaign_batch` uses `members.Segment.filter_params` (a `JSONField`) but is restricted to `ALLOWED_SEGMENT_FILTER_KEYS = {'member_type', 'insurance_status', 'docs_status'}` (see `backend/apps/members/models.py:71`). **Too narrow** for "currently checked in" or "on pier C". |
| Staff Slack/Teams alerts | `AlertRoute` + `services/alert.py` | Routes events like `new_booking`, `overstay` to webhook URLs. **Not boater-facing**, despite the "Alert" naming. |
| Manager UI for messaging | `frontend/src/screens/Communications.jsx` | Four tabs: Templates / Journeys / Segments / Delivery Log. No "Broadcast" tab. |
| "Marina Alerts" / "MAL" UI | Does not currently exist as a dedicated screen. The closest surface is `AlertRoute` admin (staff alerts) and the `emergency_phone` field on `Member`. The "bit of emergency SMS on the MAL" the user recalls is most likely either (a) the boater self-check-in confirmation SMS sent via `apps/portal/checkin_views.py` line 152, or (b) ad-hoc `dispatch(channel='sms', …)` calls. There is no existing manager-facing "blast SMS to many boaters" UI to extend. |
| Boater opt-in fields | `Member.email`, `Member.phone`, `Member.whatsapp_opt_in`, `Member.emergency_phone` (see `apps/members/models.py:19–58`). **No explicit `sms_opt_in` or `broadcast_opt_in` field.** |
| Booking statuses | `apps/reservations/models.py:200` — `checked_in`, `confirmed`, `awaiting_payment`, `pending_approval`, `cancelled`, plus `self_checked_in` boolean. |
| Pier / slip | `apps/berths/models.py::Pier`, `Berth.pier`, `Berth.pier_label` (free-text). |

### Recommendation: build a fresh "Broadcast" surface

There is no real "MAL emergency SMS" screen to extend — `AlertRoute` is a
staff webhook router with a name collision, not a boater broadcast system,
and overloading it would conflate two unrelated concerns (staff incident
routing vs. mass boater messaging).

Build the Broadcast Center as a **new 5th tab in `Communications.jsx`**
(`/communications` route), titled **"Broadcasts"**. This keeps it next to
Templates, Journeys, Segments, and Delivery Log — all of which it shares
machinery with — and avoids inventing a new top-level screen that staff
have to learn separately. The existing `MessageLog` table becomes the
audit substrate for free.

---

## 3. Data Model

Three new models in `apps.communications.models`. One migration.

### 3.1 `Broadcast`

| Field | Type | Notes |
|---|---|---|
| `marina` | FK(Marina, CASCADE) | Tenant scope. |
| `created_by` | FK(User, SET_NULL, null) | Staff who triggered. |
| `title` | CharField(200) | Manager-facing label, never sent. e.g. "Storm Bertha — pier C+D evac". |
| `channel` | CharField(20), choices = `sms` / `email` / `multi` | `multi` fans out to both SMS and email per recipient (whichever the recipient has). |
| `subject` | CharField(500), blank | Email only. |
| `body` | TextField | Plain text (SMS-safe). Supports `{{first_name}}`, `{{vessel_name}}`, `{{pier}}`, `{{slip}}` substitution applied per recipient before dispatch. |
| `cohort_filter` | JSONField(default=dict) | Frozen snapshot of the filter DSL (§4). Stored as JSON, **not a FK**, so historical broadcasts remain interpretable even if the saved cohort is later edited or deleted. |
| `cohort_snapshot_size` | IntegerField | Count at preview-time. Logged for audit even if send is cancelled. |
| `status` | choices: `draft` / `previewed` / `sending` / `sent` / `cancelled` / `failed` | |
| `cost_estimate_cents` | IntegerField, null | Computed at preview (§6). |
| `created_at`, `sent_at`, `completed_at` | DateTimeField | |
| `confirmation_token` | CharField(40), blank | Server-issued at preview, required by `/send/` to prevent CSRF-style double-blast. |

### 3.2 `BroadcastRecipient`

One row per (broadcast × resolved recipient × channel). Carries per-recipient
delivery state independent of `MessageLog` so we have a stable list that
survives `MessageLog` retention pruning.

| Field | Type | Notes |
|---|---|---|
| `broadcast` | FK(Broadcast, CASCADE, related_name=`recipients`) | |
| `member` | FK(Member, SET_NULL, null) | Source identity. May be null for ad-hoc additions in phase 2. |
| `channel` | CharField(20), choices = `sms` / `email` | A `multi` broadcast produces up to 2 rows per member. |
| `address` | CharField(500) | E.164 phone or email at send time (frozen). |
| `message_log` | FK(MessageLog, SET_NULL, null) | Pointer to the dispatch row — same audit trail as transactional sends. |
| `status` | choices: `pending` / `sent` / `delivered` / `failed` / `bounced` / `opted_out` / `skipped_no_address` | Mirrors `MessageLog.Status` plus broadcast-specific states. |
| `delivered_at`, `failed_reason` | | Populated from provider webhook (§8). |

Index: `(broadcast, status)` for fast delivery-report queries.

### 3.3 `BroadcastCohort` (saved segment — phase 2)

| Field | Type | Notes |
|---|---|---|
| `marina` | FK(Marina) | |
| `name` | CharField(200) | "Pier C residents", "All transient guests this week". |
| `description` | CharField(500), blank | |
| `filter_spec` | JSONField | Same DSL as `Broadcast.cohort_filter`. |
| `created_by`, `created_at`, `updated_at` | | |
| `is_archived` | BooleanField | Soft-delete; old broadcasts still reference snapshot JSON, not this row. |

### Decision: JSON spec vs. model rows

We store the cohort filter as a **JSON DSL snapshot** on `Broadcast`, with a
separate optional `BroadcastCohort` row for *reusable* definitions.
Rationale:

1. The filter is small (≤10 clauses) and entirely declarative — no row
   structure to gain from.
2. An immutable JSON snapshot on each broadcast is the only way to make
   the audit log truthful when saved cohorts are edited (an existing
   problem with `EmailCampaign.segment` FK).
3. `members.Segment.filter_params` already proves the JSON-spec pattern
   works in this codebase; we use a richer DSL because the segment
   pattern's allow-list is too narrow.

We do **not** reuse `members.Segment` because (a) its `filter_params`
allow-list excludes operational fields (booking status, pier), and (b) it
is owned by the marketing surface (Dotdigital sync, EmailCampaign). The
two concerns will diverge.

---

## 4. Cohort Filter DSL

Stored as JSON. Evaluated server-side into a Django ORM query that returns
distinct `Member` rows (the unit of broadcast recipiency).

### 4.1 Shape

```json
{
  "all_of": [
    {"reservation_status": ["checked_in"]},
    {"pier_in": ["C", "D"]}
  ],
  "any_of": [],
  "exclude": [
    {"sms_opted_out": true}
  ]
}
```

`all_of` is AND, `any_of` is OR, `exclude` is AND-NOT.
At least one clause must be present in `all_of` or `any_of` (no "blast
everyone" without an explicit "blast everyone" clause — see §6).

### 4.2 Supported clauses (phase 1)

| Clause key | Resolves to | Source field |
|---|---|---|
| `reservation_status: [..]` | Members with at least one Booking whose `status in (..)` overlapping today. Allowed: `checked_in`, `confirmed`, `awaiting_payment`, `pending_approval`. | `reservations.Booking.status` |
| `arriving_within_days: N` | Bookings with `start_date` between today and today+N. | `Booking.start_date` |
| `pier_in: ["C", ..]` | Members with bookings whose berth's `pier_label` matches. | `berths.Berth.pier_label` |
| `slip_range: {"from": "C12", "to": "C20"}` | Members on a numbered berth range. Naive string compare on `Berth.name` within pier filter. | `berths.Berth.name` |
| `membership_type: ["seasonal", "transient"]` | `Booking.booking_type`. | `reservations.Booking.booking_type` |
| `member_tags_any: [..]` | Future hook into `Member.tags` (JSONField, already exists). | `members.Member` |
| `everyone_in_marina: true` | All `Member` rows for tenant. Requires double confirmation at preview. | |

### 4.3 Always-applied exclusions

Regardless of `exclude` clauses, the resolver always drops:

- Members with no value for the broadcast channel (no phone for SMS,
  no email for email). Counted as `skipped_no_address`.
- Members with `broadcast_opt_in=False` (new field on `Member`, default
  `True`, see §5). Counted as `opted_out`.
- Duplicates by `(member_id, channel)`.

A second migration adds `Member.broadcast_opt_in` (BooleanField,
default True). Default-True is acceptable because phase 1 broadcasts
are operational (storm/safety) — but the field exists so a future
"Marketing broadcasts" mode can flip the default expectation.

---

## 5. Channels

Reuse `apps.communications.services.dispatch.dispatch()` per recipient.
No new adapters.

- **SMS**: `dispatch(channel='sms', recipient=member.phone, body=rendered_body)`.
  Sender uses `settings.TWILIO_FROM_NUMBER` (already configured per
  INSTALL.md step 4). Per-marina from-numbers are out of scope for phase 1.
- **Email**: `dispatch(channel='email', recipient=member.email, subject=…, body=…)`.
- **In-app PWA banner (phase 2)**: write a `notifications.Notification`
  row with `kind='broadcast'` (new choice) targeting the boater's User.
  PWA WebSocket consumer (`apps/notifications/consumers.py`) already
  pushes notifications live. This becomes a third row type in
  `BroadcastRecipient` with `channel='inapp'`.
- **WhatsApp**: deliberately excluded from phase 1. Meta's template-only
  rule (`WhatsAppTemplate.status == 'approved'`) means broadcasts can't
  be free-text. Revisit once the storm/safety template library exists.

### 5.1 Body rendering

Before dispatch, body is rendered with a tiny safe substitutor (NOT
Django template engine):

```
{{first_name}} → member.first_name
{{vessel_name}} → first active vessel name
{{pier}} → pier_label of the matched booking's berth
{{slip}} → berth.name
{{marina_name}} → marina.name
```

Unknown variables render as empty string. No conditionals, loops, or
filters — keeps SMS bodies predictable and avoids template injection
from staff input.

---

## 6. Rate Limits & Cost Guardrails

A "send to all 300 boaters" button is dangerous. Enforced at the API
layer, not just the UI.

### 6.1 Three-stage send flow

1. **Compose**: staff fills form, no DB write.
2. **Preview** (`POST /broadcasts/<id>/preview/`): server resolves the
   cohort, returns `{ size, breakdown_by_channel, cost_estimate_cents,
   sample_recipients: [..first 5..], confirmation_token }`. Broadcast
   row goes to `previewed`. The token is bound to the cohort hash —
   editing filters invalidates it.
3. **Send** (`POST /broadcasts/<id>/send/` with `{confirmation_token}`):
   server verifies the cohort hash still matches, transitions to
   `sending`, enqueues a Celery fan-out task. Mismatched token → 409.

### 6.2 Cost preview

Per-SMS price is configured per marina (new field `Marina.sms_unit_cost_cents`,
default 250 = $0.025 / 2.5¢) so brokers can override per-region. Email
is treated as free for preview (true enough at our volumes). Cost is
computed as `cost_per_segment * estimated_segments`, where segments use
the standard GSM-7/UCS-2 split at 160/70 chars. The body length × cohort
size produces an explicit "$X.XX" line in the preview response.

### 6.3 Confirmation thresholds

- Cohort size > 50 → UI requires typing the cohort size into a confirm box.
- Cohort size > 200 OR cost > $10 → UI also requires a second staff
  member's approval (server-side flag on `Broadcast.approved_by`, FK to
  User, non-null required to send). Phase-2 toggle in
  marina settings: `require_dual_approval_above_cents`.
- `everyone_in_marina: true` always requires dual approval.

### 6.4 Throttling

Celery task fans out in chunks of 50 recipients per sub-task, with a
1-second pause between chunks per broadcast (Twilio API ceiling is
generous but multiple concurrent broadcasts could exhaust the per-account
queue). Per-marina rate limit: max 3 active broadcasts in `sending`
state — additional sends are queued or rejected (configurable).

A per-marina daily volume cap (`Marina.daily_broadcast_sms_cap`, default
1000) trips a hard 422 on send. Operational overrides require dropping
into Django admin — by design.

---

## 7. Audit & Deliverability

Every `Broadcast` row carries who/when/what/how-many for free. Per-recipient
state is on `BroadcastRecipient.status` plus the linked `MessageLog`.

### 7.1 Delivery webhook reconciliation

- **Email**: existing `EmailWebhookView` already mutates `MessageLog.status`
  to `delivered` / `opened` / `bounced` based on provider events. Add a
  receiver on `MessageLog.post_save` (or extend the webhook) that, when
  the log is linked to a `BroadcastRecipient`, copies the status to the
  recipient row.
- **SMS**: no Twilio webhook exists today. Add
  `POST /communications/webhooks/sms/` (`TwilioSmsWebhookView`) that
  validates the X-Twilio-Signature, looks up `MessageLog` by
  `provider_message_id` (= Twilio SID), and updates status. Same fan-out
  to `BroadcastRecipient`.

### 7.2 Retention

`MessageLog` retention policy is unchanged. `Broadcast` and
`BroadcastRecipient` rows are kept indefinitely (operational record).
`BroadcastRecipient.message_log` becomes null when the log is pruned —
the recipient-level status is the durable source.

---

## 8. API Surface

All routes under `/api/v1/communications/`, manager JWT auth required,
tenant-scoped by `request.user.marina`.

```
GET    /broadcasts/                       List, filter by status / date / channel
POST   /broadcasts/                       Create draft
GET    /broadcasts/<id>/                  Retrieve (with cohort_filter, body)
PATCH  /broadcasts/<id>/                  Edit draft only — 409 if not draft
DELETE /broadcasts/<id>/                  Delete draft only
POST   /broadcasts/<id>/preview/          Resolve cohort, return size+cost+token
POST   /broadcasts/<id>/send/             Body: {confirmation_token, approved_by?}
POST   /broadcasts/<id>/cancel/           Only while status='sending' or earlier
GET    /broadcasts/<id>/recipients/       Paginated list of BroadcastRecipient
GET    /broadcasts/<id>/delivery-report/  Aggregated counts by status

GET    /broadcast-cohorts/                List saved cohorts (phase 2)
POST   /broadcast-cohorts/                Save cohort
GET    /broadcast-cohorts/<id>/
PATCH  /broadcast-cohorts/<id>/
DELETE /broadcast-cohorts/<id>/           Soft delete via is_archived

POST   /webhooks/sms/                     Twilio status callback (new, §7.1)
```

ViewSets live in `apps.communications.views` next to the existing
`EmailCampaignViewSet`. The fan-out worker is a new task in
`apps.communications.tasks::send_broadcast`.

---

## 9. Frontend

### 9.1 Location

New 5th tab in `frontend/src/screens/Communications.jsx`: **"Broadcasts"**.
Tab IDs: `templates / journeys / segments / broadcasts / delivery-log`
(insert before delivery-log).

### 9.2 Components (new, under `frontend/src/components/broadcasts/`)

- `BroadcastList.jsx` — table of recent broadcasts: title, channel, status,
  sent_at, recipient count, success rate. Clickable row → detail.
- `BroadcastComposer.jsx` — three-pane modal/drawer:
  - **Pane 1 — Audience**: `CohortBuilder` (visual chip-based filter UI;
    each chip is one clause from §4.2). Live count refreshes on debounce
    via `/preview/`. Saved cohorts dropdown (phase 2).
  - **Pane 2 — Message**: channel toggle (SMS / Email / Both), subject
    (email only), body textarea with character/segment counter and
    inline variable picker. SMS preview pane shows rendered body for a
    sample recipient.
  - **Pane 3 — Review & Send**: cohort size, channel breakdown, cost
    estimate, "Type {N} to confirm" challenge if size > 50, dual-approver
    picker if > 200 / > $10. Big red "Send now" button.
- `BroadcastDetail.jsx` — header (title, who/when), delivery donut
  (sent/delivered/failed/bounced), per-recipient table with filter,
  resend-to-failures action (phase 2).
- `CohortBuilder.jsx` — reusable; also surfaces in a future Members
  screen "filter and message" affordance.

### 9.3 Entry points outside Communications

A **"Broadcast"** action button on:

- Operations / Reservations dashboard top bar (`frontend/src/screens/Operations.jsx`)
  with cohort pre-filled to `reservation_status: ['checked_in']`.
- Harbor Map `LiveMap.jsx` pier context menu — "Broadcast to pier C"
  pre-fills `pier_in: ['C']`.

These deep-link to the composer with a query-string filter spec so the
manager lands directly in pane 2.

---

## 10. Migration & Phasing

### Phase 1 (MVP, ship first)
- `Broadcast`, `BroadcastRecipient` models + migration.
- `Member.broadcast_opt_in` field.
- Cohort DSL clauses: `reservation_status`, `pier_in`, `membership_type`,
  `everyone_in_marina`, exclude `sms_opted_out`.
- Channels: SMS and email (no multi-channel in one broadcast UI yet —
  pick one).
- Preview → confirm → send flow with token.
- Twilio SMS webhook for delivery callbacks.
- New Broadcasts tab in Communications screen, composer, detail view.
- Audit table in Django admin.

### Phase 2
- `BroadcastCohort` (saved segments).
- `channel='multi'` broadcasts.
- In-app PWA banner channel.
- Scheduled send (`scheduled_at` field, beat task picks up scheduled
  broadcasts — reuse existing `send-scheduled-campaigns` cadence).
- Templated storm/safety presets (extends `MessageTemplate`, adds
  `purpose='broadcast_preset'` flag).
- Resend-to-failures action.
- Dual-approval workflow.
- Slip-range, arriving-within, tag filters.

### Phase 3
- Boater reply handling: Twilio inbound SMS webhook routes replies into
  the existing `MessageLog` with `direction='inbound'`, links back to the
  most recent outbound `BroadcastRecipient` for that phone, surfaces in
  a "Replies" panel on `BroadcastDetail`.
- Per-marina from-number / short-code support.
- A/B body testing on broadcasts > 500 recipients.
- Marketing-mode broadcast with stricter opt-in defaults.

---

## 11. Test Plan

### Unit (`backend/apps/communications/tests/test_broadcasts.py`)

- Cohort resolver: each DSL clause individually produces the expected
  member queryset on a seeded marina.
- Composition: `all_of` + `exclude` correctly intersects.
- Always-applied exclusions: members missing a phone are dropped for SMS
  but kept for email; opt-out drops both.
- Body rendering: `{{first_name}}` substitution, unknown vars empty, no
  template injection from `{% %}` strings.
- Cost estimate: 160-char vs 161-char body produces 1 vs 2 segments.
- Confirmation token: mismatch returns 409, match transitions status.
- Dual approval: send without `approved_by` rejected when size > threshold.

### Integration

- End-to-end preview→send with mocked `dispatch()`: assert one
  `MessageLog` per recipient, one `BroadcastRecipient` per (member,
  channel), and `Broadcast.status` transitions draft→previewed→
  sending→sent.
- Twilio webhook: post a fake status callback with valid signature,
  assert `BroadcastRecipient.status` updates to `delivered`. Invalid
  signature → 403.
- Throttle: 51-recipient broadcast splits into 2 sub-tasks; assert
  rate-limit pause between chunks.
- Tenant isolation: marina A staff cannot send to marina B members
  even if filter spec naively matches.

### E2E (Playwright, `frontend/e2e/`)

- Manager logs in → Communications → Broadcasts → New.
- Builds cohort (pier C, checked-in), sees live count.
- Composes SMS body, sees segment count.
- Clicks Send → confirm modal → types size → Send.
- Lands on delivery report; mock Twilio webhook fires; donut updates to
  show 1 delivered.

### Manual / smoke
- Storm preset: select preset → adjust pier → send to a 3-member test
  marina with real Twilio + real phones (staging numbers).
- Cancel-during-sending: start a 300-recipient broadcast, cancel mid-fan-out,
  assert in-flight Celery tasks check status and abort cleanly.

---

## 12. Open Questions

1. **Sender identity per marina**: today there is a single
   `TWILIO_FROM_NUMBER` env var. For multi-marina broadcasts, do we
   provision per-marina Twilio sub-accounts, or is "DocksBase" branding
   acceptable for phase 1? Affects deliverability (boaters may treat
   unknown number as spam in emergencies).
2. **Opt-out enforcement legality**: TCPA / GDPR require an opt-out
   keyword (STOP) on SMS broadcasts. We currently have no inbound SMS
   handling. Either we add a phase-1 inbound-STOP webhook (small) or we
   require all marinas to have a separately-configured manual unsubscribe
   process documented somewhere. Legal call, not a code call.
3. **Cohort drift between preview and send**: a boater could check in
   (or check out) in the 30s between preview and confirm. We currently
   hash the *filter spec*, not the *member id list*. Should we instead
   snapshot the resolved member-id list at preview time and resend
   against that exact list? Arguments both ways — fresh evaluation is
   safer in a real storm, but it breaks the "X recipients, $Y cost"
   promise. Default proposed: snapshot the list, but note in the
   confirm dialog "list as of HH:MM — N seconds ago".

---

## 13. File-By-File Touch List

| File | Change |
|---|---|
| `backend/apps/communications/models.py` | Add `Broadcast`, `BroadcastRecipient`, `BroadcastCohort`. |
| `backend/apps/communications/migrations/00XX_broadcast.py` | New migration. |
| `backend/apps/members/models.py` | Add `Member.broadcast_opt_in`. |
| `backend/apps/accounts/models.py` | Add `Marina.sms_unit_cost_cents`, `Marina.daily_broadcast_sms_cap`, `Marina.require_dual_approval_above_cents`. |
| `backend/apps/communications/services/broadcast.py` | New: cohort resolver, body renderer, cost estimator, send orchestrator. |
| `backend/apps/communications/tasks.py` | New tasks: `send_broadcast`, `send_broadcast_chunk`. |
| `backend/apps/communications/views.py` | New: `BroadcastViewSet`, `BroadcastCohortViewSet`, `TwilioSmsWebhookView`. |
| `backend/apps/communications/urls.py` | Register routes. |
| `backend/apps/communications/serializers.py` | New serializers. |
| `backend/apps/communications/admin.py` | Register models. |
| `frontend/src/screens/Communications.jsx` | Add 5th tab. |
| `frontend/src/components/broadcasts/` | New directory: `BroadcastList`, `BroadcastComposer`, `BroadcastDetail`, `CohortBuilder`. |
| `frontend/src/screens/Operations.jsx` | "Broadcast checked-in" entry point. |
| `frontend/src/components/harbor-map/LiveMap.jsx` | Pier context-menu "Broadcast" action. |
| `backend/apps/communications/tests/test_broadcasts.py` | New test suite. |
| `frontend/e2e/broadcasts.spec.js` | New E2E test. |



answers:

As your system architect, I have to say this is an incredibly robust and operationally sound specification. You have correctly identified that routing emergency blasts through a marketing drip-campaign engine is a recipe for disaster. Designing a dedicated, state-machine-backed Broadcast model with JSON cohort snapshots is the exact right enterprise pattern.

However, moving from transactional SMS to "blast" SMS introduces entirely new classes of telecom and concurrency problems. Let's answer your three open questions and patch the architectural traps they reveal.

1. Sender Identity (The A2P 10DLC Trap)
Your Question: Do we provision per-marina Twilio sub-accounts, or is "DocksBase" branding acceptable for phase 1?

The Answer: It depends entirely on your geographic market, but a single shared phone number in the US will get blocked almost immediately.

UK / EU / Australia: You can use an Alphanumeric Sender ID. Instead of a phone number, the SMS comes from a string like "MARINA-BAY". Twilio supports this out of the box, it costs nothing extra, and it solves the branding problem perfectly for Phase 1 without needing sub-accounts.

US / Canada: Alphanumeric Sender IDs are not supported. Furthermore, US carriers enforce strict A2P 10DLC (Application-to-Person) regulations. If you blast 500 messages from a single shared "DocksBase" 10-digit number, carriers will flag it as spam and silently drop the messages.

The Phase 1 Compromise: If your MVP is US-based, use a shared Twilio Messaging Service pool, but prefix every single message body with the marina name: [Marina Bay] Storm warning... Be prepared to build per-marina Twilio sub-accounts in Phase 2 if carriers start filtering your traffic.

2. Opt-Out Enforcement (The TCPA Trap)
Your Question: TCPA / GDPR require an opt-out keyword (STOP). Do we add an inbound webhook or require manual unsubscribe?

The Answer: You must build the inbound webhook, but not for the reason you think.

The Reality: Twilio handles the STOP keyword automatically at the network level. If a boater replies "STOP", Twilio intercepts it, sends the legal opt-out confirmation, and permanently blocks your Twilio number from sending SMS to that boater again. You are legally compliant out-of-the-box.

The Trap: If you don't catch that event in DocksBase, your software will still think the boater is opted-in. On the next storm warning, DocksBase will send the SMS to Twilio, Twilio will immediately reject it with Error 21610 (Attempt to send to unsubscribed recipient), and Twilio will still charge you for the message.

The Fix: You must implement the Twilio inbound webhook in Phase 1. When it receives a STOP payload, simply flip Member.broadcast_opt_in = False. This saves the marina money and keeps your cohort previews accurate.

3. Cohort Drift (The Celery Payload Trap)
Your Question: Should we snapshot the resolved member-id list at preview time and resend against that exact list?

The Answer: Absolutely do not snapshot the list of Member IDs.

The Error: If you resolve a cohort of 4,000 boaters and store [12, 45, 89, ...] in the database or pass it as an argument to a Celery task, you create massive payload bloat. Redis (Celery's typical broker) and the database will choke on these giant arrays over time.

The Fix: Use an Optimistic Concurrency approach.

Store the JSON filter DSL, the previewed_count, and the cost_estimate_cents on the Broadcast row during preview.

When the manager clicks "Send", the /send/ endpoint dynamically resolves the filter DSL against the database one more time.

It runs a .count(). If the new count is greater than the previewed_count by any amount (or if it crosses a cost threshold), the endpoint aborts, returns a 409 Conflict, and tells the manager: "Cohort size has changed from 150 to 152. Please refresh your preview to confirm the new cost."

If the count is equal or smaller, the send proceeds. This guarantees the cost promise without bloating your data layer.

Additional Architect's Warning
Be extremely careful with the everyone_in_marina: true filter. Because DocksBase retains historical data, a 5-year-old marina will have thousands of "Members" who visited for one night in 2021. Blasting them a storm warning in 2026 will result in massive spam complaints and STOP replies. I highly recommend changing this to everyone_active_in_marina (e.g., filtering out anyone without a booking in the last 12 months).

With those guardrails in place, you are clear to proceed with the Broadcast Center.

To ensure the Twilio STOP sync works seamlessly, do we want to map out the exact JSON payload the POST /webhooks/sms/ endpoint needs to parse from Twilio?

---

## 14. Locked Decisions (2026-05-16) — implementation contract

These are the final, binding choices for the v1 implementation. They override any earlier draft defaults in this document.

**A. Sender identity:** Single shared `TWILIO_FROM_NUMBER` (or Twilio Messaging Service pool in US for A2P 10DLC compliance). The composer MUST prefix every outbound SMS body with `[<marina.name>] ` so boaters know the source. Per-marina sub-accounts / alphanumeric sender IDs are deferred to phase 2.

**B. STOP webhook:** Implement in Phase 1. New `TwilioSmsWebhookView` at `POST /api/v1/communications/webhooks/twilio-sms/` validates Twilio signature, parses inbound `Body` for the standard STOP/UNSUBSCRIBE/QUIT/END/CANCEL keywords, and flips `Member.broadcast_opt_in = False` for the matched `From` phone number. (Twilio handles the legal STOP-reply auto-response itself; this is purely to sync our DB so we stop *enqueueing* doomed messages.)

**C. Cohort drift — Optimistic Concurrency:** Do NOT snapshot the resolved member-id list. Instead:
1. At preview, store the JSON filter DSL + `previewed_count` + `cost_estimate_cents` on the `Broadcast` row.
2. At `POST /send/`, re-resolve the DSL and run `.count()`.
3. If `new_count != previewed_count`, abort with **409 Conflict** and the message `"Cohort size has changed from {previewed} to {new}. Please refresh your preview to confirm the new cost."`
4. If equal, proceed.

**D. `everyone_in_marina` filter scope:** Replace with `everyone_active_in_marina` — limited to members with at least one booking in the trailing 12 months. The legacy "blast every member from the last 5 years" option is removed from the cohort builder UI to prevent spam complaints.

### Locked test additions
- `test_stop_webhook_flips_opt_in` — POST with `Body=STOP` + valid Twilio signature flips `Member.broadcast_opt_in` and rejects subsequent enqueue.
- `test_send_409_on_cohort_size_drift` — preview with N=5, insert one member, call `/send/`, assert 409 + body message contains both counts.
- `test_send_proceeds_when_count_equal_or_smaller` — accept equal AND smaller counts (someone left = still safe to send).
- `test_body_prefixed_with_marina_name` — assert every queued `MessageLog.body` starts with `[<marina.name>]`.
- `test_active_in_marina_excludes_stale_members` — member with last booking >12mo ago is excluded.


