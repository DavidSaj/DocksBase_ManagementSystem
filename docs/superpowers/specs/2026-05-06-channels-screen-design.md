# Channels Screen & OTA Connections Design

## Goal

Replace the hardcoded mySea channel system with a generic OTA Connections framework, and surface all distribution decisions in a new top-level **Channels** screen. Managers can configure any number of OTA partners in Settings, then control booking pipeline, per-connection allocation targets, and per-berth assignments from one place.

---

## Data Model

### New: `OTAConnection`

Per-marina record representing one OTA partner integration.

| Field | Type | Notes |
|---|---|---|
| `marina` | FK(Marina) | |
| `name` | CharField(100) | Display name, e.g. "mySea", "Navi" |
| `slug` | SlugField | Auto-generated from name, used in iCal URL path |
| `inbound_ical_url` | URLField | OTA's feed → us (we poll this) |
| `outbound_token` | UUIDField | Secret token for our outbound iCal URL |
| `target_pct` | IntegerField(0–100) | Desired % of berths on this channel |
| `auto_allocate` | BooleanField | If True, system calculates target_pct automatically |
| `last_synced` | DateTimeField(null) | Set after each inbound poll |

Outbound iCal URL pattern: `/api/v1/berths/ical/<outbound_token>.ics` (public, token is the secret).

### Modified: `Berth`

| New field | Type | Notes |
|---|---|---|
| `ota_connection` | FK(OTAConnection, null=True, SET_NULL) | null = Direct |
| `channel_locked` | BooleanField(default=False) | If True, allocator never touches this berth |

Remove: `sales_channel` CharField, `channel_cooldown_until` DateTimeField (replaced by `ota_connection` FK and lock flag).

**Migration path:**
1. Create one `OTAConnection` per marina that has `auto_allocate_inventory=True`, copying `mysea_ical_url`, `mysea_target_pct`, name='mySea', slug='mysea'.
2. For berths with `sales_channel='mysea'`, set `ota_connection` to the created connection.
3. Drop old Marina channel fields (`auto_allocate_inventory`, `mysea_target_pct`, `mysea_ical_url`, `mysea_last_synced`) and old Berth fields (`sales_channel`, `channel_cooldown_until`).

### Modified: `Marina`

Remove: `auto_allocate_inventory`, `mysea_target_pct`, `mysea_ical_url`, `mysea_last_synced` (all move to `OTAConnection`).

---

## Backend API

### OTAConnection endpoints

| Method | URL | Description |
|---|---|---|
| GET/POST | `/api/v1/ota-connections/` | List + create connections |
| GET/PATCH/DELETE | `/api/v1/ota-connections/<id>/` | Detail |
| POST | `/api/v1/ota-connections/<id>/sync/` | Trigger inbound iCal poll |
| POST | `/api/v1/ota-connections/<id>/rebalance/` | Run allocator for this connection |
| GET | `/api/v1/berths/ical/<token>.ics` | Outbound iCal feed (public) |

### Berth endpoint changes

`PATCH /api/v1/berths/<id>/` gains `ota_connection` (int or null) and `channel_locked` (bool) fields.

When `ota_connection` changes → set `channel_locked=True` automatically (manual override = permanent lock).
When `channel_locked=False` explicitly sent → unlock (allocator may reassign on next release).

### Booking engine

Replace `filter(sales_channel='direct').exclude(channel_cooldown_until__gt=now)` with:
`filter(ota_connection__isnull=True)` — direct berths only, no cooldown needed (lock replaces cooldown).

### Allocator

`run_smart_allocator(marina, freed_berth)` → iterate over all `OTAConnection` objects for the marina, compute target count per connection, assign freed (unlocked) berth to the connection furthest below its target. If all at/above target, assign to direct.

`rebalance_down(connection)` → flip unlocked berths from this connection back to direct until `ota_connection` count meets `target_pct`.

Auto-allocate target: if `connection.auto_allocate=True`, compute `target_pct = round(remaining_pct / auto_connection_count)` where `remaining_pct = 100 - sum of manual connections' target_pct`.

---

## Frontend — Settings: OTA Connections card

Location: Settings → System tab, replacing the existing "Channel Management" card.

UI: A list of configured connections. Each row: name, inbound iCal URL, outbound iCal URL (copy button), last synced, Sync now button, Delete button. An "Add connection" button opens a small inline form (name + inbound URL).

---

## Frontend — Channels Screen

New top-level screen added to sidebar under "Management & Data" group, owner/manager only.

### Section 1: Booking Pipeline

A single card with a toggle row:
- **Manual approval** — bookings go to pending, manager confirms each one
- **Auto-confirm** — bookings confirmed immediately on submission

PATCH `marina.booking_mode` on change.

### Section 2: OTA Allocation

One card per OTA connection. Each card shows:
- Connection name + coloured badge
- Current % (live count from berths) vs Target %
- Target % input (disabled if `auto_allocate=True`)
- "Auto" toggle — if on, target % is read-only and system-calculated
- "Rebalance now" button → POST `ota-connections/<id>/rebalance/`

If no connections configured: empty state with link to Settings → OTA Connections.

### Section 3: Berth Assignment

Full-width card. Table: `Berth | Pier | Channel | Locked`.

- **Channel** column: dropdown — "Direct" + one option per OTA connection
- Changing channel → PATCH berth with new `ota_connection`, auto-locks the berth
- **Locked** column: lock icon if `channel_locked=True`. Click to unlock (sends `channel_locked=false`)
- Filter bar at top: filter by pier (dropdown)
- Locked berths highlighted with a subtle background tint

---

## Removing Old Channel Management from Settings

Remove the "Channel Management" card from Settings → System tab. The OTA Connections card replaces it (connection-level config only — no berth assignment in Settings).

Remove channel management state/handlers from `Settings.jsx` (`cs`, `csSaving`, `csSyncing`, `csLastSynced`, `saveChannelSettings`, `triggerMySeaSync`).

---

## Scope Notes

- `channel_cooldown_until` is removed: the lock flag replaces the 30-minute cooldown concept. Manual override = permanent lock, not a timed cooldown.
- Field app `ChannelManagementFlow.jsx` should be updated to use `ota_connection` + `channel_locked` instead of `sales_channel` + `channel_cooldown_until`.
- `sync_mysea_bookings` management command renamed to `sync_ota_bookings`, updated to iterate all connections.
