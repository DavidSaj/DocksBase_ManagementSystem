---
name: ais-phase-2-supplement
description: Phase 2 design supplement — auto-arrival, auto-departure, no-show prediction, basin polygon editor. Refines and locks decisions from the master AIS spec.
metadata:
  type: project
---

# AIS Phase 2 — Booking Automation (Supplement)

This document supplements [`2026-05-14-ais-vessel-tracking-design.md`](./2026-05-14-ais-vessel-tracking-design.md). The master spec already defines:

- `VesselPosition` model with `in_basin` flag (already shipped in Phase 1).
- `Marina.basin_polygon` and `Marina.ais_poll_radius_nm` (already shipped).
- `geometry.point_in_polygon`, `haversine_nm`, `bearing_deg` helpers.
- The poll loop and adapter pattern.

Phase 2 layers **behaviour** on top of Phase 1's plumbing — no new ingest, no new vendor work. This supplement pins down the open decisions the master spec deferred ("auto-flip policy", "polygon editor UX", "notification channels", "alert thresholds").

---

## Decisions locked in this phase

| Decision | Choice | Reason |
|---|---|---|
| Auto-flip on basin enter / exit | Hard-flip booking state automatically; reversible by manual edit | Whole point of AIS automation is to remove manual taps. A wrong flip is one undo away. |
| Polygon editor UX | Inline Leaflet map in Settings → Marina Profile | Matches the spec's hint and is the only UX that lets non-technical managers configure this without help. |
| Notification channels | In-app for all three event kinds + SMS to on-duty harbourmaster for auto-checkin and auto-checkout (not no-show) | Arrival/departure are interrupt-driven; no-show is a heads-up best surfaced in-feed. |
| Branch base | Off `feature/ais-phase-1` (PR #55) | Phase 1 isn't merged yet; Phase 2 depends on its models/services. Rebase onto main after #55 lands. |

---

## Architecture additions

```
┌─ apps.ais.tasks.poll_ais_for_all_marinas ─────────────────┐
│  for each reading from the adapter:                       │
│    ├─ compute new in_basin + hysteresis decision in MEMORY│
│    └─► upsert_position(marina, reading, prev_position,    │
│                        in_basin, last_transition_at,      │
│                        transition)            ◄── one     │
│                                                  write    │
│                                                            │
│  for each (booking, position, transition) that emerged:   │
│    └─► detect_events.dispatch(...)              ◄── after │
│                                                    commit │
│                                                            │
│  once per cycle (throttled per marina):                   │
│    └─► detect_no_shows(marina)                  ◄── NEW   │
└─────────────┬──────────────────────────────────────────────┘
              │
              ▼
┌─ apps.ais.detect_events ──────────────────────────────────┐
│  compute_transition(prev_position, lat, lng, polygon, now)│
│    ├─ point_in_polygon(lat, lng, polygon)                 │
│    ├─ apply 5-min hysteresis                              │
│    └─ returns (in_basin, last_transition_at, transition)  │
│                                                            │
│  on_basin_enter(booking, position)                        │
│  on_basin_exit (booking, position)                        │
│  detect_no_shows(marina)                                  │
│                                                            │
│  All event handlers dispatch via apps.notifications.      │
└────────────────────────────────────────────────────────────┘
```

The polygon math and hysteresis decision run **before** the database write. `upsert_position` accepts the pre-computed `in_basin` / `last_transition_at` and writes them in the same `update_or_create` call as lat/lng/speed — one UPDATE per cycle per vessel, not two. Booking flips and notifications fire **after** the position transaction commits, so a notification-side failure cannot leave the position un-persisted.

No new ingest code. No new vendor adapter work. One new module (`detect_events.py`), one new frontend component (`BasinPolygonEditor.jsx`), three new notification kinds.

---

## Data-model changes

### `VesselPosition` (apps/ais/models.py)

Add one field:

```python
last_transition_at = models.DateTimeField(
    null=True, blank=True,
    help_text='Last time in_basin transitioned. Used to apply hysteresis to prevent edge-flicker.',
)
```

`in_basin` already exists from Phase 1.

### `Booking` (apps/bookings/models.py)

Add one field:

```python
ais_no_show_predicted = models.BooleanField(
    default=False,
    help_text='Set True by AIS Phase 2 when a booking has no AIS contact within 1 h of expected arrival. Cleared if the vessel later appears.',
)
```

Default `False`. Indexed via existing booking indexes — no new index needed (we always filter alongside `status` and `check_in`).

### No other schema changes

Polygon JSON, MMSI matching, marina lat/lng, `ais_poll_radius_nm` — all from Phase 1.

---

## Event detection — `apps/ais/detect_events.py`

### Hysteresis (anti-flicker)

A vessel sitting on the polygon edge with GPS jitter must not flip a booking dozens of times an hour. The decision is computed **in memory** before the position is written, so the upsert is a single database round-trip:

```python
DWELL = timedelta(minutes=5)

def compute_transition(prev, lat, lng, polygon, now):
    """
    Decide what (in_basin, last_transition_at, transition) values to persist
    for this reading. `prev` is the previously-stored VesselPosition row (or
    None on first sighting). Returns no transition if either the basin state
    isn't changing or the dwell window has not elapsed.
    """
    if not polygon or len(polygon) < 3:
        return (False, prev.last_transition_at if prev else None, None)

    new_in_basin = point_in_polygon(lat, lng, polygon)
    prev_in_basin = prev.in_basin if prev else False
    prev_transition_at = prev.last_transition_at if prev else None

    if new_in_basin == prev_in_basin:
        return (new_in_basin, prev_transition_at, None)

    if prev_transition_at and (now - prev_transition_at) < DWELL:
        # Edge-flicker: do not flip the stored flag, do not emit a transition.
        return (prev_in_basin, prev_transition_at, None)

    transition = 'enter' if new_in_basin else 'exit'
    return (new_in_basin, now, transition)
```

`upsert_position` then writes the returned tuple straight into the `defaults={}` of the `update_or_create` call. Booking-side handlers (`on_basin_enter` / `on_basin_exit`) run **after** the position transaction commits, driven by the returned `transition` value.

The hysteresis is one-sided per direction: a vessel must remain in its new state for ≥ 5 min before a *future* transition can fire. Edge cases:

- **Power-cycled AIS transponder.** Vessel disappears for 10 min then reappears inside the basin. `last_transition_at` is stale → dwell check passes → transition fires. Correct.
- **Genuine quick out-and-back** (e.g., vessel exits to fetch a guest then returns within 5 min). Exit fires immediately; re-entry is suppressed for 5 min — the auto-checkout flip happens, the auto-checkin does not re-fire. Operator may need to manually re-check-in. Acceptable trade-off; the alternative (no hysteresis) is much worse.
- **First-ever sighting inside the basin.** `last_transition_at` is NULL → dwell evaluates to "infinite" → transition fires immediately. Correct.

### `on_basin_enter(position)`

```
if position.vessel_id is None:           return  # unknown vessel, no booking
bookings = Booking.objects.filter(
    marina=position.marina,
    vessel=position.vessel,
    status='confirmed',
    check_in__lte=today() + timedelta(days=1),
    check_out__gte=today(),
).select_related('member', 'vessel')

if bookings.count() == 0:                return  # no eligible booking
if bookings.count() > 1:
    logger.warning('ais.auto_checkin.multiple_match', extra={...})
    return                                       # ambiguous, do not guess

booking = bookings.first()
with transaction.atomic():
    booking.status = 'checked_in'
    booking.self_checked_in_at = position.reported_at
    booking.save(update_fields=['status', 'self_checked_in_at'])
    notify_auto_checkin(booking, position)
```

### `on_basin_exit(position)`

```
bookings = Booking.objects.filter(
    marina=position.marina,
    vessel=position.vessel,
    status='checked_in',
    check_out__lte=today() + timedelta(days=1),
)
# … same multiple-match guard …
with transaction.atomic():
    booking.status = 'checked_out'
    booking.checked_out_at = position.reported_at
    booking.save(update_fields=['status', 'checked_out_at'])
    run_turnaround_hooks(booking)        # existing service, same one manual check-out uses
    notify_auto_checkout(booking, position)
```

Both handlers are **idempotent**: re-invoking with the same `(booking, position)` is a no-op because the booking's status no longer matches the filter.

### `detect_no_shows(marina)`

Throttled to once per marina per 10 min via a Django cache key (`ais:no_show_lock:{marina_id}`).

**The Dark Transponder problem.** "No AIS contact" ≠ "no boat." A large fraction of recreational vessels (especially under 30 ft) either have no AIS transponder at all, or routinely turn it off to save battery while underway. If we flag every late booking whose vessel happens to lack AIS, we generate constant false-positives and the harbourmaster ignores the feed by day two. The fix is to **require an AIS baseline** for the vessel before treating absence as suspicious — only flag bookings whose vessel has *successfully* transmitted to us at least once before.

```python
horizon = now_marina_tz(marina)
default_eta = time(18, 0)

candidates = Booking.objects.filter(
    marina=marina,
    status__in=['confirmed', 'awaiting_payment'],
    check_in=horizon.date(),
    ais_no_show_predicted=False,
).select_related('vessel')

for booking in candidates:
    if booking.vessel_id is None:
        continue                          # cannot match without an MMSI link

    expected = booking.eta or datetime.combine(
        booking.check_in, default_eta, tzinfo=marina.tz,
    )
    if horizon < expected - timedelta(hours=2):
        continue                          # still too early

    # Dark Transponder guard. Only predict a no-show if we have historical
    # proof this vessel uses AIS. A vessel that has never reported a position
    # to us is assumed to be a non-AIS hull, and silence tells us nothing.
    has_ais_history = VesselPosition.objects.filter(
        vessel=booking.vessel,
    ).exists()
    if not has_ais_history:
        continue

    nearby = VesselPosition.objects.filter(
        marina=marina,
        vessel=booking.vessel,
        received_at__gte=horizon - timedelta(hours=1),
    ).exists()
    if not nearby:
        booking.ais_no_show_predicted = True
        booking.save(update_fields=['ais_no_show_predicted'])
        notify_no_show(booking)
```

The baseline check uses `VesselPosition` across all marinas (not just this one) because a vessel that transmits anywhere is, by construction, AIS-equipped. A separate reset sweep clears `ais_no_show_predicted=True` whenever a flagged booking's vessel later shows up — folded into `on_basin_enter` and into the upsert step (any fresh `VesselPosition` for a flagged booking clears the flag).

---

## Notifications

### New kinds (apps/notifications)

```
ais_auto_checkin       — in-app + SMS to on-duty harbourmaster
ais_auto_checkout      — in-app + SMS to on-duty harbourmaster
ais_no_show_predicted  — in-app only
```

### SMS recipient resolution

```python
def on_duty_harbourmaster(marina):
    today_dow = current_weekday()                  # 'mon' .. 'sun'
    week_start = monday_of_current_week()
    shift = Shift.objects.filter(
        marina=marina,
        week_start=week_start,
        day=today_dow,
        is_off=False,
        staff_member__phone__regex=r'\S',
        staff_member__role__icontains='harbour',
    ).select_related('staff_member').first()
    return shift.staff_member if shift else None
```

If no recipient → in-app fires, log a warning, no exception. (`role__icontains='harbour'` matches "Harbourmaster", "Asst Harbour Master", etc. Marinas with no harbourmaster role assigned will get a warning in the log telling them to fix it; we don't fall back to dock-hands because they're often part-time and SMSing the wrong person is worse than no SMS.)

### Throttle

Max one SMS per `(booking, kind)` pair, ever. Implemented via a small `AISNotificationSent` audit row keyed on `(booking_id, kind)` — uniqueness constraint prevents duplicates. In-app notifications are not throttled (notifications app already dedupes).

### Message templates

```
ais_auto_checkin:    "Auto check-in: {vessel} ({guest}) arrived at {time}. Berth {berth_code}."
ais_auto_checkout:   "Auto check-out: {vessel} departed at {time}. Turnaround triggered."
ais_no_show_predicted: "{vessel} ({guest}) expected by {eta} — no AIS contact. Possible no-show."
```

---

## Basin Polygon Editor (frontend)

### Location

`Settings → Marina Profile`, below the marina lat/lng fields. New collapsible section "AIS Basin (advanced)" — collapsed by default to avoid intimidating new operators.

### Library

Leaflet 1.9.x via CDN, dynamically loaded the first time the section is expanded:

```js
function ensureLeaflet() {
  if (window.L) return Promise.resolve();
  return Promise.all([
    loadCss('https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'),
    loadScript('https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'),
  ]);
}
```

No npm dependency — matches the codebase's existing pattern for one-off third-party libs and keeps the bundle slim for marinas that never touch this screen.

### UX

```
┌─ AIS Basin Polygon ──────────────────────────┐
│ Click on the map to add vertices.            │
│ Drag a vertex to move; right-click to delete.│
│ ┌──────────────────────────────────────────┐ │
│ │  [Leaflet map, ~400 px tall]              │ │
│ │  ⊙ marina centre marker                   │ │
│ │  ◯ poll radius circle (read-only)         │ │
│ │  ▱ basin polygon (filled, editable)       │ │
│ └──────────────────────────────────────────┘ │
│ Vertices: 6                                  │
│ [Clear]                          [Save Polygon]│
└──────────────────────────────────────────────┘
```

- Map starts centred on `marina.lat/lng`, zoom 16.
- Polygon is a Leaflet `Polygon` layer, vertices drawn as draggable `CircleMarker`s.
- Save PATCHes the existing marina endpoint with `{ basin_polygon: [[lat,lng],…] }`.
- Validation: ≥ 3 vertices to save (button disabled otherwise). Self-intersection check **out of scope** — if a marina draws a bowtie, `point_in_polygon` may misclassify but won't crash.
- Read-only poll-radius circle shows the relationship between polygon and ingest bbox so operators see "is my polygon outside what we even ingest?".

### Backend

The marina PATCH endpoint already accepts `basin_polygon` (Phase 1). One additional serializer-level validator:

```python
def validate_basin_polygon(self, value):
    if not value:
        return value                                 # empty = disable AIS arrivals
    if not isinstance(value, list) or len(value) < 3:
        raise ValidationError('Polygon must have at least 3 vertices.')
    for v in value:
        if not (isinstance(v, list) and len(v) == 2):
            raise ValidationError('Each vertex must be [lat, lng].')
        lat, lng = v
        if not (-90 <= lat <= 90 and -180 <= lng <= 180):
            raise ValidationError('Vertex coordinates out of range.')
    return value
```

---

## Test plan

| # | Scenario | Expected |
|---|---|---|
| 1 | Basin enter, single confirmed booking | Booking → `checked_in`, `self_checked_in_at` set, in-app + SMS dispatched. |
| 2 | Basin exit, single checked-in booking | Booking → `checked_out`, turnaround hook called, in-app + SMS dispatched. |
| 3 | Hysteresis: vessel flickers 3× across edge inside 60 s | First transition fires; subsequent are suppressed. |
| 4 | Hysteresis: clean re-entry 6 min after exit | Both events fire. |
| 5 | First-ever sighting inside basin (no prior transition) | Enter event fires immediately. |
| 6 | No-show: confirmed booking, vessel HAS AIS history, no contact within 1 h of expected ETA | `ais_no_show_predicted=True`, in-app notification only (no SMS). |
| 6b | No-show suppression: confirmed booking, vessel has NEVER transmitted AIS to us, no contact at expected ETA | Flag remains `False`, no notification (Dark Transponder guard). |
| 7 | No-show reset: flagged booking's vessel reappears within 50 nm | Flag cleared. |
| 8 | Multiple matching bookings (e.g. owner has two boats in same marina) | No flip, warning logged. |
| 9 | Polygon < 3 vertices | Events skipped silently, no crash. |
| 10 | Cross-marina scoping | Marina A polygon never classifies marina B positions. |
| 11 | SMS recipient missing (no harbourmaster shift today) | In-app fires, warning logged, no exception. |
| 12 | SMS throttle: same booking, same kind, twice | Only the first SMS is sent. |
| 13 | Polygon editor: save 4 vertices → reload | Polygon restored from server. |
| 14 | Polygon editor: try to save with 2 vertices | Save button disabled. |
| 15 | Polygon editor: invalid lat/lng (out of range) | Backend rejects with 400. |

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Wrong vessel auto-checked-in (MMSI typo on Vessel record) | Booking flip is reversible from the booking detail page; the SMS surfaces the action immediately so operators catch it. We do not delete data — only flip state. |
| Auto-checkout fires while a guest is still at the dock (e.g. moves to refuelling berth briefly outside polygon) | 5 min hysteresis catches most jitter; for genuine basin exits we accept that the operator will manually re-check-in. We will revisit if we see > 1 false-positive per marina per week. |
| SMS spam from a misconfigured polygon (e.g. polygon excludes most of the actual basin so every position triggers events) | One SMS per `(booking, kind)` ever — bounded by booking count. Worst case ≈ 2 SMS per booked vessel per stay. |
| Leaflet CDN unreachable | Section degrades to a textarea fallback that accepts JSON. Same validator runs server-side. (Stretch goal — if cheap to add, do it; else punt to a follow-up.) |
| `Booking.eta` not always set | `detect_no_shows` falls back to 18:00 local time, which is the existing UX assumption elsewhere in the codebase. |
| Non-AIS vessels generate constant false-positive no-shows | Dark Transponder guard: `detect_no_shows` only flags a booking if the vessel has historical AIS contact in `VesselPosition`. A vessel that has never transmitted is assumed to be non-AIS-equipped and its absence carries no information. |
| Database write amplification (100 boats × 60 s polling × 2 writes/cycle) | Polygon math and hysteresis are computed in memory before the upsert; `in_basin` and `last_transition_at` are written as part of the same `update_or_create` call. One UPDATE per cycle per vessel. |

---

## Out of scope (still deferred to Phase 3)

- Unauthorized-movement alerts (vessel moving while berthed).
- Charter fleet view.
- Self-intersection detection in polygon editor.
- Time-series position history.
- Web push / desktop notifications (only in-app + SMS).
