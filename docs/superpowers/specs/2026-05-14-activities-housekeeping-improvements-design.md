# Activities & Housekeeping Improvements — Design

**Date:** 2026-05-14
**Status:** Draft for review
**Scope:** Manager-facing Activities & Housekeeping screen, public activity booking-request flow, embed/share parity with Channels.

## Problem

1. The **Activity Bookings** tab in the manager dashboard fails to load (shows "Failed to load bookings.").
2. The manager-side **Activities & Housekeeping** screen feels thin: cramped layout, gaps in features that the backend already supports (photos, instructors, recurring cleaning schedules, checklists, etc. are not exposed in the UI).
3. There is **no public-facing activities surface**. The Channels screen lets a marina embed its berth-booking portal on its own website via an iframe + direct link, but there is no equivalent for activities, even though selling activities to passing visitors is a primary use case.
4. Manager-side confusion about embed mechanics: "do I have to give a full HTML code?" No — the marina should paste **one iframe line** that points to a DocksBase-hosted page. This spec keeps that model.

## Root cause of the booking-tab crash

`config/urls.py` includes app URLs at the project root, in order:

```
apps.reservations.urls    → path('bookings/', BookingListCreateView, ...)
...
apps.activities.urls      → router.register('bookings', ActivityBookingViewSet, ...)
```

Both register `/api/v1/bookings/`. Django resolves to the first match (`reservations`), so the activities frontend's `api.get('/bookings/')` hits the berth-reservations endpoint. It either 403s under the activity user's permissions or returns a payload the frontend can't parse, surfacing as "Failed to load bookings."

Same collision exists for `catalogue` (unique — no collision) and `cancellation-policies` (unique — no collision). Only `bookings` is contested.

## Goals

- Fix the route collision so the existing Activity Bookings tab loads.
- Add a public **browse + request** flow for activities, hosted at `booking.docksbase.com/:slug/activities`.
- Manager gets a "Share & Embed" panel mirroring Channels (iframe snippet + direct link + copy buttons).
- Manager can be notified in-app when a new activity request comes in.
- Manager-side Activities tab exposes photos, instructor assignment, capacity, equipment requirements, **and a weekly recurring schedule** the public form uses to offer bookable slots.
- Manager-side Housekeeping tab exposes the recurring `CleaningSchedule` editor and staff assignment / status flow that already exist in the model layer.

## Non-goals

- **No online payment** on the public activities page in this iteration. Requests are confirmed by the marina, then the existing direct-payment or berth-invoice flow takes over. (Payment-on-request can be added in a later phase.)
- No SMS or email notifications to the manager — in-app only.
- No mobile (field) app changes. Cleaner-facing UI is unchanged.
- No changes to billing, invoicing, cancellation policy, or asset reservation logic.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Public scope | Browse + request, marina confirms. No online payment yet. |
| Embed model | Both iframe snippet **and** direct link (same as Channels). |
| Requester auth | Guest by default; prefill if logged into the boater portal. |
| Manager notification | In-app notification only. |
| Activity slot model | **Pick from published slots.** Marina defines weekly schedule per activity; public form shows generated slots only. |
| Housekeeping additions | Recurring schedules + staff assignment / status flow surfaced in UI. (Models already exist.) |
| Activity manager pain points | UX/layout (cramped), missing features (photos, instructors, schedule, equipment requirements), housekeeping too simple. |

## Architecture overview

Five chunks, designed so each can land independently and be tested on its own. Order matters only between (2) and (4), since the public page consumes the new endpoints.

```
┌────────────────────────────────────────────────────────────────────┐
│ 1. Route fix              backend + manager FE                     │
│ 2. Domain additions       backend only (ActivityTimeSlot, status)  │
│ 3. Manager UI overhaul    manager FE only (frontend/)              │
│ 4. Public activities page boater portal FE + public endpoints      │
│ 5. Share & Embed panel    manager FE only (frontend/)              │
└────────────────────────────────────────────────────────────────────┘
```

---

## Chunk 1 — Fix `/bookings/` route collision

**Change in `backend/apps/activities/urls.py`:**

```python
router.register('activity-bookings',  ActivityBookingViewSet, basename='activity-booking')
router.register('activity-catalogue', ActivityViewSet,        basename='activity')   # optional rename for symmetry
router.register('activity-cancellation-policies', CancellationPolicyViewSet, basename='activity-cancellation-policy')
```

Only `bookings` is strictly required to move — the rest are renamed in the same PR for consistency.

**Frontend updates (`frontend/src/screens/ActivitiesHousekeeping.jsx`):**

- `/bookings/` → `/activity-bookings/`
- `/catalogue/` → `/activity-catalogue/`
- `/cancellation-policies/` → `/activity-cancellation-policies/`

Grep `frontend/`, `marina-admin/`, `portal/` for these paths before renaming — there is no expectation of consumers beyond `ActivitiesHousekeeping.jsx`, but verify.

**Acceptance:** Booking tab loads. With no bookings present, shows the empty state. Creating a booking via the existing form persists and re-renders.

---

## Chunk 2 — Domain additions (backend)

### 2.1 `ActivityTimeSlot` model

New file: `backend/apps/activities/models.py` (append).

```python
class ActivityTimeSlot(models.Model):
    """
    A weekly recurring slot template for an activity.
    The public booking form materialises slots from these templates for a
    forward window (default: 60 days), filtered by capacity and asset/instructor
    availability at view time. Templates are not pre-expanded into rows.
    """
    class Weekday(models.IntegerChoices):
        MON = 0; TUE = 1; WED = 2; THU = 3; FRI = 4; SAT = 5; SUN = 6

    activity   = models.ForeignKey(Activity, on_delete=models.CASCADE,
                                   related_name='time_slots')
    weekday    = models.IntegerField(choices=Weekday.choices)
    start_time = models.TimeField()           # local time, marina TZ
    is_active  = models.BooleanField(default=True)

    class Meta:
        unique_together = [('activity', 'weekday', 'start_time')]
        ordering = ['weekday', 'start_time']
```

End time is derived from `activity.duration_minutes`. Slots inherit the activity's seasonal availability (`season_start` / `season_end`).

**Why on-the-fly materialisation rather than a `GeneratedSlot` table?** Slot definitions are short (a few rows per activity), and the public form only needs the next ~60 days. Computing them per request keeps the schema simple, avoids stale-data drift when admins change the schedule, and matches how the existing availability service already works (see `apps/activities/services/availability.py`).

### 2.2 `ActivityBooking.Status.REQUESTED`

Add a status to `ActivityBooking.Status`:

```python
REQUESTED = 'requested', 'Requested'   # new — public submission awaiting marina confirmation
CONFIRMED = 'confirmed', 'Confirmed'
CANCELLED = 'cancelled', 'Cancelled'
COMPLETED = 'completed', 'Completed'
NO_SHOW   = 'no_show',   'No Show'
```

Rules:

- Public submissions create bookings in status `REQUESTED`.
- `REQUESTED` bookings do **not** generate an invoice and do **not** reserve assets (no `AssetReservation` rows). They occupy the slot logically (visible in the manager's booking list) but do not block other bookings until confirmed.
- Manager confirms via a new endpoint `POST /api/v1/activity-bookings/{id}/confirm/` which:
  - Validates capacity and asset availability (existing service in `services/availability.py`).
  - Creates `AssetReservation` rows.
  - Triggers the existing billing pipeline if `payment_mode='berth_invoice'`. (Direct payment requested via public form is deferred — see Open questions.)
  - Transitions status to `CONFIRMED`.
- Manager rejects via `POST /api/v1/activity-bookings/{id}/reject/` → status `CANCELLED`, with `cancellation_reason='rejected_by_marina'`.

### 2.3 Public endpoints

New URL include: extend `apps.portal.public_urls` (already mounted at `/api/v1/public/`) with:

| Method | Path | Returns |
|---|---|---|
| `GET`  | `/public/activities/?marina={slug}` | Active activities with photo, description, category, duration, capacity, price-from. |
| `GET`  | `/public/activities/{id}/slots/?from=YYYY-MM-DD&to=YYYY-MM-DD` | Materialised available slots (after capacity + asset check) in window. |
| `POST` | `/public/activity-requests/` | Creates `ActivityBooking` in `REQUESTED` status. |

Request payload for `/public/activity-requests/`:

```json
{
  "marina_slug":      "marina-bay",
  "activity_id":      42,
  "start_datetime":   "2026-05-20T10:00:00Z",
  "participant_count": 2,
  "lead_name":        "...",
  "lead_email":       "...",
  "lead_phone":       "...",
  "notes":            "..."
}
```

Auth: anonymous allowed. If the request carries a valid boater-portal session cookie, link the new `ActivityBooking` to `member` and skip lead-name prefill on the frontend.

Rate limit: 10 requests / IP / hour (use existing DRF throttle scope `public_activity_request`).

### 2.4 In-app notification on new request

A `post_save` signal on `ActivityBooking` (status → REQUESTED) creates a row in the existing notifications system (`apps.notifications`) with:
- `type = 'activity_request'`
- `marina = booking.marina`
- `payload = {booking_id, activity_name, lead_name, start_datetime}`
- routed to staff with role `manager` or `activities_lead` (fall back to all managers if no role match).

Reuse existing notification delivery — no new transport needed.

---

## Chunk 3 — Manager UI overhaul

Target file: `frontend/src/screens/ActivitiesHousekeeping.jsx` (currently 1727 lines — split during this work).

### 3.1 Split the file

Current single-file structure hurts iteration. Refactor into:

```
frontend/src/screens/ActivitiesHousekeeping/
  index.jsx                       # top-level tab shell
  shared.jsx                      # badges, Drawer, Field, Loading, Empty, Err
  activities/
    CatalogueTab.jsx              # was ActivityTypesTab
    BookingsTab.jsx               # was ActivityBookingsTab
    ScheduleTab.jsx               # NEW — weekly slot editor per activity
    RequestsInbox.jsx             # NEW — REQUESTED bookings, confirm/reject
    ShareEmbedTab.jsx             # NEW — see Chunk 5
  housekeeping/
    TasksTab.jsx                  # existing tasks list
    SchedulesTab.jsx              # NEW — CleaningSchedule editor
    StaffBoardTab.jsx             # NEW — by-assignee Kanban of tasks
    ChecklistsTab.jsx             # existing checklist templates (surface in UI)
```

This is the only deliberate refactor in this spec. It's justified because every chunk below edits this screen, and a 1700-line file makes review and merge painful.

### 3.2 Activities catalogue improvements

Existing Activities form already has fields for most things — just exposes them:

- **Photo upload** — `Activity.photo` already exists. Add a file input + thumbnail display in the form and a small cover image on the catalogue card.
- **Capacity min/max** — already in form per existing code. Audit + cleanup styling only.
- **Instructor assignment defaults** — surface `ActivityResourceRequirement` with `resource_type='instructor'` in an editable list inside the activity drawer.
- **Equipment requirements** — same: surface `ActivityResourceRequirement` with `resource_type='asset'` in the drawer.

No new endpoints required — `activity-resource-requirements` route already exists.

### 3.3 New `ScheduleTab` (weekly slot editor)

Per activity, a 7×N grid of weekday columns. "Add slot" creates an `ActivityTimeSlot` row. Toggle active/inactive in place. Bulk action: "Copy Mon to Tue–Fri".

Reads/writes a new `/activity-time-slots/` viewset (CRUD on `ActivityTimeSlot`, marina-scoped).

### 3.4 New `RequestsInbox`

A filtered view of bookings where `status='requested'`, with two actions per row:

- **Confirm** → calls `POST /activity-bookings/{id}/confirm/`. On success, row moves to the Bookings tab.
- **Reject** → opens a small dialog for an optional reason → calls `POST /activity-bookings/{id}/reject/`.

Inbox badge count comes from the notifications system (unread `activity_request` count).

### 3.5 Booking tab cleanup (post route-fix)

- Tighter calendar density: 60min rows are fine, but cap card content to one line + count.
- Empty-state copy unchanged.
- Add a Status filter that includes `requested` (so manager can see them inline if they prefer).

### 3.6 Housekeeping additions

- **`SchedulesTab`** — CRUD over `CleaningSchedule`. Columns: unit_label, unit_type, interval_days, next_run_date, is_active. Reuses existing `generate_recurring_tasks` management command — no new task generation logic.
- **`StaffBoardTab`** — group `HousekeepingTask` by `assigned_to`, show status flow (dirty → in_progress → ready_inspection → clean → ready_guest) as a horizontal pipeline per assignee. Drag-and-drop is **out of scope** in this iteration; use a status dropdown per card. (Drag-and-drop deferred — it adds dependency and accessibility cost not justified yet.)
- **`ChecklistsTab`** — CRUD over `ChecklistItem` per unit_type. Existing model; missing UI only.

### 3.7 Layout

- Replace cramped sub-tab pills with the same `tabs` component used elsewhere in the app.
- Two top-level sections in the screen: **Activities** | **Housekeeping**, each with its own row of sub-tabs.
- Sticky filter row per tab.

---

## Chunk 4 — Public activity booking-request page

Lives in the existing **boater portal** (`portal/`), served at `booking.docksbase.com/:slug/activities`.

### 4.1 Routes

In `portal/src/App.jsx`:

```
/:slug/activities                       → ActivitiesList
/:slug/activities/:activityId           → ActivityDetail (with slot picker + form)
/:slug/activities/:activityId/requested → RequestConfirmed
```

These sit alongside the existing berth-portal routes (no nesting changes).

### 4.2 Screens

**`ActivitiesList`**
- Calls `GET /public/activities/?marina={slug}`.
- Renders a grid of cards: photo, name, category badge, duration, "from £X" price.
- Filter by category (chips).

**`ActivityDetail`**
- Calls `GET /public/activities/{id}/slots/` with a date-range picker (default: today + 30 days).
- Renders a date strip with slot pills under each date. Greys out fully-booked slots.
- Form: participants, lead name/email/phone, notes. Prefilled if logged in (existing `UserContext`).
- Submit → `POST /public/activity-requests/`.

**`RequestConfirmed`**
- Plain-text confirmation: "We've received your request. The marina will contact you to confirm within 24 hours." Includes booking reference.

### 4.3 Styling

Match the existing boater portal styling (`p-*` classes). No new design system. Use the same hero/card patterns as `SearchScreen.jsx`.

---

## Chunk 5 — Share & Embed panel (manager UI)

New sub-tab under Activities: **Share & Embed**.

Mirrors the Channels `BookingPortalCard`. Reads `marina.slug` from context.

```
Direct link:
https://booking.docksbase.com/{slug}/activities             [Copy] [Open]

Embed on your website:
<iframe src="https://booking.docksbase.com/{slug}/activities"
        width="100%" height="700" frameborder="0"></iframe>  [Copy]
```

Helper text:
> Paste this snippet into any page on your website. The booking form will load inline. Contact us if you want a custom domain (e.g. activities.yourmarina.com).

Pull `VITE_PORTAL_URL` from env, same as Channels does.

---

## Data flow — public request → manager confirmation

```
 Boater portal                Backend                   Manager UI
 ────────────                 ───────                   ──────────
 ActivityDetail
   submits form  ──── POST /public/activity-requests/ ──►
                                ActivityBooking(status=REQUESTED)
                                Notification(type=activity_request)
                                                        ◄── RequestsInbox
                                                            poll / WS bump
                                                            "1 new request" badge

                                                        manager clicks Confirm
                                ◄── POST /activity-bookings/{id}/confirm/ ──
                                check capacity + assets
                                AssetReservation rows
                                Invoice (if berth_invoice)
                                status → CONFIRMED
                                ─── Notification.payload to lead_email ──►
                                                            (deferred — email
                                                             not in this scope)
```

## Error handling

- **Public request, invalid slot**: 400 with `{"detail": "Slot no longer available"}`. UI re-fetches slots.
- **Confirm, capacity exhausted by another confirmation in the interim**: 409 with reason. UI shows a toast, keeps booking in `REQUESTED`.
- **Confirm, missing assets/instructors**: 409 listing the missing resources. Manager can either free the resource or reject.
- **Route-collision PR**: feature-flag not required. Single deploy: backend renames first, frontend follows in the same commit/PR.

## Testing

- **Backend unit**: ActivityTimeSlot uniqueness, slot materialisation against `season_start`/`season_end`, capacity arithmetic; status transitions REQUESTED → CONFIRMED with full asset/invoice side-effects; REQUESTED → CANCELLED leaves no orphan reservations.
- **Backend integration**: public POST with valid + invalid slugs; rate-limit kicks in at request 11; logged-in vs anonymous request both succeed and link member when present.
- **Frontend (manager)**: BookingsTab renders after the route rename (regression test against the bug). RequestsInbox shows badge count from notifications. ScheduleTab CRUD round-trips.
- **Frontend (portal)**: ActivityDetail re-fetches slots after a failed submission. Embed iframe loads the portal page in a manual smoke test.

## Migration / rollout

1. Backend PR: new model (`ActivityTimeSlot`), new status, new endpoints, route renames. One migration. Deploy.
2. Manager FE PR: route renames in `ActivitiesHousekeeping.jsx`, file split, new tabs. Deploy.
3. Portal FE PR: new public routes and screens. Deploy.
4. Share & Embed PR: new tab in manager. Deploy.

(2) can ship before (1) is fully consumed by (3), since (2) is internal-only. (3) depends on (1). (4) depends on (3) being live so the embedded URL works.

## Open questions for later phases (out of scope)

- Online payment at request time (Stripe, same flow as berth bookings).
- Email notifications to lead on confirmation / rejection (currently relies on manager contacting them).
- Drag-and-drop on the Housekeeping staff board.
- Per-activity custom branding on the public page.
- A "Today's runsheet" printable for instructors.
