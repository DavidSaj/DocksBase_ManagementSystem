---
name: ais-vessel-tracking
description: AIS-driven inbound ETA, auto-arrival/departure, no-show prediction, security alerts, and charter fleet view. Operational features only — no map overlay.
metadata:
  type: project
---

# AIS Vessel Tracking — Design Spec

## Overview

The MarineTraffic credential card already exists in Settings → Integrations (PR #50). What it feeds today: nothing. This spec turns those credentials into operational features that change how harbourmasters work, without ever drawing a vessel on the map.

The map overlay is intentionally **out of scope**. The genuinely valuable AIS use cases for a marina don't need a precise canvas dot — they need to know:

- which inbound bookings are arriving soon and how far out they are
- when a vessel actually crossed into the basin (auto-arrival)
- when a vessel left (auto-departure → turnaround workflow)
- when a booking probably isn't going to show up
- when a vessel that should be moored is moving (security)
- where the charter fleet currently is

All of these are list/event-based, not map-based. They share the same ingest plumbing and a small bit of geometry.

---

## Phases

This spec covers the whole feature, but ships in three independent PRs. Each phase produces working software on its own.

| Phase | Scope | Why ship it standalone |
|---|---|---|
| **1** | Ingest infrastructure + Inbound ETA list | Harbourmasters see incoming boats today. Operational lift even without automation. |
| **2** | Auto-arrival, auto-departure, no-show prediction | Bookings flip state automatically. Manual work disappears. Builds on Phase 1's ingest. |
| **3** | Security alerts + Charter fleet view | Notifies on suspicious movement; gives charter operators a fleet status panel. |

Plans for Phase 2 and Phase 3 are written when we start them.

---

## Non-Goals

- Map overlay (canvas dots for vessels). Punted — needs georeferencing the whole map editor, which is a separate multi-week refactor.
- Webhook ingest from MarineTraffic (Enterprise tier). Pull is fine for marina scale.
- WebSocket/SSE push to clients. 30 s polling is adequate; AIS itself only updates every 1–10 min.
- Time-series position history. Latest position per vessel is enough for v1. History can be layered on later without breaking the API.
- Provider-agnostic AIS (Spire, FleetMon, etc.). MarineTraffic-only for now — we wrap it behind a small adapter so swapping later is contained.

---

## Architecture

```
┌─ MarineTraffic API ──────────────────────────────────┐
│  GET /api/exportvessels/v:8/<key>/                   │
│    msgtype:simple/protocol:jsono                     │
│    minlat,maxlat,minlon,maxlon  (bbox)               │
└────────────┬─────────────────────────────────────────┘
             │ once / 60 s, per marina (Celery beat)
             ▼
┌─ apps.ais ───────────────────────────────────────────┐
│  adapters/marinetraffic.py   ← single vendor adapter │
│  tasks.py                    ← poll + dispatch       │
│  geometry.py                 ← haversine, polygon-in │
│  services.py                 ← inbound-eta query     │
│  models.py                   ← VesselPosition        │
└────────────┬─────────────────────────────────────────┘
             │ Phase 1 stops here.
             │ Phase 2 layers event detection.
             │ Phase 3 layers alerts + fleet view.
             ▼
┌─ Read API ───────────────────────────────────────────┐
│  GET /api/v1/ais/inbound/    ← bookings + ETA        │
│  GET /api/v1/ais/positions/  ← all known positions   │
│       (Phase 3, for fleet view)                      │
└──────────────────────────────────────────────────────┘
```

---

## Data model

### New: `VesselPosition` (`apps/ais/models.py`)

One row per `(marina, mmsi)`. Upserted on every poll.

```python
class VesselPosition(models.Model):
    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='ais_positions')
    mmsi         = models.CharField(max_length=20, db_index=True)
    vessel       = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True, related_name='ais_positions',
                                     help_text='Set when MMSI matches a known marina vessel.')

    lat          = models.DecimalField(max_digits=9, decimal_places=6)
    lng          = models.DecimalField(max_digits=9, decimal_places=6)
    speed_kn     = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    course_deg   = models.IntegerField(null=True, blank=True)   # 0–359
    heading_deg  = models.IntegerField(null=True, blank=True)
    nav_status   = models.CharField(max_length=30, blank=True)  # MT 'STATUS' field

    reported_at  = models.DateTimeField()
    received_at  = models.DateTimeField(auto_now=True)
    source       = models.CharField(max_length=30, default='marinetraffic')

    # Phase 2 flags — set by event detection, written here for read-side speed.
    in_basin     = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=['marina', 'mmsi'], name='ais_position_marina_mmsi_uniq'),
        ]
        indexes = [
            models.Index(fields=['marina', '-reported_at'], name='ais_position_marina_reported_idx'),
        ]
```

### Modified: `Marina` (`apps/accounts/models.py`)

```python
basin_polygon = models.JSONField(
    default=list, blank=True,
    help_text='Marina basin polygon as a list of [lat, lng] vertices. Used for AIS arrival/departure detection. Empty list = no AIS geofencing.',
)
ais_poll_radius_nm = models.IntegerField(
    default=10,
    help_text='Bounding-box radius around marina lat/lng (nautical miles) used to query AIS providers.',
)
```

No polygon → AIS still ingests positions, but arrival/departure events (Phase 2) and "is currently in basin" don't fire. This is fine; the manager can draw the polygon when they're ready. The basin polygon is in **real-world lat/lng** — not canvas — so it's independent of the map editor.

### Existing: `Vessel.mmsi`

Already exists. We match `VesselPosition.mmsi` → `Vessel.mmsi` (case-sensitive, exact match) at ingest time to populate the FK.

---

## Phase 1 — Inbound ETA

The simplest valuable thing: a list on the Overview screen showing inbound vessels that match upcoming bookings.

### Backend

#### Poll task

```
Celery beat: 'poll-ais-positions-1min' → apps.ais.tasks.poll_ais_for_all_marinas
```

Per marina with `marinetraffic_api_key` configured:

1. Compute bbox from `lat, lng, ais_poll_radius_nm`.
2. Call MarineTraffic `exportvessels` with simple protocol.
3. For each returned vessel, `upsert_position(marina, mmsi, …)` — `update_or_create` keyed on `(marina, mmsi)`. Set `vessel_id` if MMSI matches a known `Vessel`.
4. Compute `in_basin` if the marina has a polygon, otherwise leave `False`.
5. Log counts (received, matched, errored). Reuse the existing `notifications` / health pattern for monitoring.

Failure handling:
- Missing key → skip silently.
- 4xx → log + disable polling for this marina for 1 h (cached flag, no DB).
- 5xx / network → log, skip this cycle; next minute retries.

#### Inbound ETA service

```python
def get_inbound_etas(marina, *, horizon_hours=24, max_distance_nm=50):
    """
    Returns a list of upcoming bookings within the next `horizon_hours`
    whose vessel has an AIS contact within `max_distance_nm`, sorted by ETA.
    Each row includes computed distance, bearing, and ETA-minutes-from-now.
    """
```

ETA-minutes = `distance_nm / max(speed_kn, 1)` × 60. Rough but fine for "is this boat 20 min out or 4 hours out."

Matches a `VesselPosition` to a `Booking` via:
- `vessel.mmsi == position.mmsi`, or
- if no vessel linked: `position.mmsi` provided in `booking.guest` flow (future — out of scope here)

#### Endpoint

```
GET /api/v1/ais/inbound/
→ 200 {
    inbound: [
      {
        booking_id: 123,
        guest_name: "Alice Smith",
        vessel_name: "Wanderer",
        mmsi: "227123456",
        check_in: "2026-05-14",
        eta: "2026-05-14T15:42:00+00:00",  // ISO 8601 — client renders local time
        eta_minutes: 38,
        distance_nm: 6.3,
        bearing_deg: 142,
        speed_kn: 9.8,
        last_seen: "2026-05-14T15:04:00Z",
      },
      ...
    ],
    fetched_at: "2026-05-14T15:05:00Z",
  }
```

**Timezone note.** `eta` is full ISO 8601 with offset. The browser renders it
in the user's locale via `toLocaleTimeString` — we deliberately do NOT
pre-format on the server. Sending `"%H:%M"` from a UTC datetime would show
the wrong wall-clock time to harbourmasters in any non-UTC timezone (Italian
CEST harbourmasters would see times 2 hours behind reality).

**N+1 guard.** The Celery poll task pre-fetches all marina `Vessel` rows
in a single `WHERE mmsi IN (...)` query before iterating readings, and
passes the resolved vessel into `upsert_position(marina, reading, vessel)`.
A busy harbour can return 300+ AIS contacts and we run every 60 s — running
one SELECT per reading would exhaust the DB connection pool within minutes.

Auth: `IsMarinaStaff`. Scoped to the user's marina.

### Frontend

A new card on the Overview screen, placed between **Today's Weather** and **Checking Out Today**:

```
┌─ Inbound — AIS ────────────────────────────┐
│ Wanderer · Alice Smith                     │
│ 6.3 nm · ETA 16:42 · 38 min                │
│ ─────────────────────────────────────────  │
│ Sea Breeze · Bob Jones                     │
│ 14.1 nm · ETA 18:15 · 1h 47m               │
└────────────────────────────────────────────┘
```

- Poll the endpoint every 30 s via a hook (`useInboundETAs`).
- Empty state: "No inbound vessels detected." (only shown if MarineTraffic is configured; if not configured, the card hides entirely).
- Hidden if there are zero matched bookings — don't waste space.

No new screens, no map.

---

## Phase 2 — Booking automation (later PR)

Once Phase 1 ships and we trust the data, layer:

- **Auto-arrival.** `VesselPosition.in_basin` transitions `False → True` for a vessel linked to a booking with status `confirmed` → flip booking to `checked_in`, set `self_checked_in_at = received_at`. Notify harbourmaster.
- **Auto-departure.** `in_basin` transitions `True → False` for a vessel linked to a booking with status `checked_in` and `check_out >= today` → flip to `checked_out`. Trigger the existing turnaround/billing flow.
- **No-show prediction.** Booking with `check_in = today`, status `confirmed` or `awaiting_payment`, no AIS contact within 50 nm 2 h before the booking's `eta` (or 18:00 if no eta) → push `kind='ais_no_show_predicted'` notification.

Each of these is a small function called at the end of `poll_ais_for_all_marinas`. They're idempotent: re-running them doesn't re-flip already-flipped bookings.

State transitions ride on the **same data Phase 1 already records**. No new tables.

---

## Phase 3 — Security & fleet view (later PR)

- **Unauthorized-movement alert.** Vessel with `vessel.berth.status='occupied'` shows `speed_kn > 0.5` outside expected hours (configurable on Marina) → push `kind='ais_unauthorized_movement'` notification with high severity.
- **Charter fleet view.** New tab/card on the Charter screen showing all marina-owned vessels with their latest position, speed, "in/out of basin," and last contact. Useful for fleet operators.

---

## Test plan

Phase 1 only (other phases get their own test plans in their own plans):

1. **`poll_ais_for_all_marinas` happy path.** Mock MT response → expect `VesselPosition` rows created, MMSI-matched ones link to `Vessel`.
2. **Missing API key.** Marina with no key → poll task no-ops, no exceptions.
3. **MT 4xx.** Mocked 401 → task logs, sets the 1 h disable flag, no rows created.
4. **MT 5xx.** Mocked 503 → task logs, no disable flag, returns without raising.
5. **Re-poll same vessel.** Two consecutive runs → still one row, fields updated.
6. **Inbound ETA endpoint.** With seeded positions + bookings, returns sorted list with correct distance/eta math (within tolerance).
7. **Cross-marina scoping.** User in marina A cannot see marina B's positions or inbound list.
8. **No bookings / no positions.** Endpoint returns `inbound: []`, not 500.
9. **Frontend hook smoke.** `useInboundETAs` mounts, calls endpoint, renders one row given mocked data.

---

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| MarineTraffic credit consumption blows up the bill | One call per marina per minute, bbox limited to `ais_poll_radius_nm`. At 60 marinas × 60 calls/hr × 24 hrs = ~86k calls/day. MT's PS01 endpoint is one credit per call (~$0.001). ~$2.50/day worst case. Manageable. |
| Vessels reporting from open sea pollute the table | Bbox limits ingest to ~10 nm around marina by default. Manager can tune `ais_poll_radius_nm`. |
| MMSI mismatch (boater enters wrong MMSI) | `vessel_id` simply stays null on the position row; the position is still there for fleet view, but it doesn't trigger booking automation. |
| Basin polygon misconfigured | Bad polygon → `in_basin` is always `False` → arrival/departure never fires. Visible to operator via the inbound list showing zero arrivals despite vessels obviously in port. Polygon validation in Phase 2 plan. |
| Vendor lock-in to MarineTraffic | Adapter is in `apps/ais/adapters/marinetraffic.py` behind a `fetch_positions(bbox) -> list[Reading]` interface. Swapping to Spire or FleetMon is one file. |

---

## Open questions deferred to the relevant phase plan

- **Polygon drawing UX.** Phase 2 plan will design the basin-polygon editor (a small Leaflet-based picker in Settings → Marina Profile is the obvious shape).
- **Alert thresholds.** Phase 3 will set defaults and decide which are configurable per marina.
- **Charter fleet view layout.** Phase 3 designs the table/card on Charter screen.
