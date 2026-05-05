# mySea Channel Management — Design Spec

**Date:** 2026-05-05  
**Status:** Approved

---

## Overview

Adds a dynamic inventory allocation layer that splits marina berths between the direct booking engine and mySea (the OTA). The marina sets a target percentage; the system automatically assigns freed berths to the right channel. Staff can manually override any berth at any time. Bookings from mySea are pulled in via iCal polling so the system always reflects real occupancy.

---

## 1. Data Model

### Marina (new fields)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `auto_allocate_inventory` | BooleanField | `False` | When False, channel assignment is fully manual |
| `mysea_target_pct` | IntegerField (0–100) | `20` | Target % of non-maintenance berths to allocate to mySea |
| `mysea_ical_url` | URLField | blank | Marina pastes their mySea feed URL here once |
| `mysea_last_synced` | DateTimeField | null | Updated after each successful inbound sync |

### Berth (new fields)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `sales_channel` | CharField choices: `direct` / `mysea` | `direct` | Current channel assignment |
| `channel_cooldown_until` | DateTimeField | null | Set to `now + 30min` on manual override; blocks both channels during transition |

### Booking (new field)

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `booking_source` | CharField choices: `direct` / `mysea` | `direct` | Origin of the booking; used for reporting |

---

## 2. Smart Allocator

### Trigger events

`run_smart_allocator(marina, freed_berth)` runs as a Django post-save signal on `Booking` whenever:
- A booking transitions to `checked_out` or `cancelled`
- A berth status changes from `maintenance` → `available`

### Algorithm

```
1. If marina.auto_allocate_inventory is False → exit
2. total_pool  = Berth.objects.filter(marina=marina).exclude(status='maintenance').count()
3. current_mysea = Berth.objects.filter(marina=marina, sales_channel='mysea').exclude(status='maintenance').count()
4. target_mysea = round(total_pool * marina.mysea_target_pct / 100)
5. freed_berth.sales_channel = 'mysea' if current_mysea < target_mysea else 'direct'
6. freed_berth.save(update_fields=['sales_channel'])
```

Auto-allocations do **not** set `channel_cooldown_until` — no limbo needed since the booking engine never touches mySea berths.

### Manual override

When staff changes `sales_channel` via the API:
```
berth.sales_channel = new_channel
berth.channel_cooldown_until = now() + timedelta(minutes=30)
berth.save()
```

The cooldown ensures mySea's iCal crawler has time to drop the listing before the direct engine can see the berth.

---

## 3. Booking Engine Changes

`compatible_available_berths()` in `booking_engine.py` gets two additional filters:

```python
from django.utils import timezone

qs = qs.filter(sales_channel='direct')
qs = qs.exclude(channel_cooldown_until__gt=timezone.now())
```

No other changes to the engine. `select_for_update()` protection already handles race conditions.

---

## 4. iCal

### Outbound (your system → mySea)

**Endpoint:** `GET /api/v1/berths/ical/mysea.ics?marina=<slug>`  
**Auth:** Public (no auth required — URL is the secret)  
**Format:** Standard RFC 5545 iCalendar

Generates one `VEVENT` per active booking (`status` in `ACTIVE_STATUSES`) on a berth where `sales_channel='mysea'`. Also generates a blocking `VEVENT` for any berth currently in cooldown (`channel_cooldown_until__gt=now`) to prevent mySea from listing it during the transition window. Each event:
- `DTSTART` / `DTEND`: booking `check_in` / `check_out`
- `SUMMARY`: boat dimensions or guest name (enough for mySea to identify the block)
- `UID`: `booking-<id>@docksbase`

Marina pastes this URL into their mySea extranet once. mySea polls it on their own schedule.

### Inbound (mySea → your system)

**Management command:** `python manage.py sync_mysea_bookings`  
**Frequency:** Called by cron every 10 minutes  
**Per marina:** Runs for all marinas where `mysea_ical_url` is set

Logic per `VEVENT` in the mySea feed:
1. Parse `DTSTART`, `DTEND`, `SUMMARY` (boat name / guest name if available)
2. Find a mySea-allocated berth with no conflicting active booking for those dates. Match by `length_m >= boat_loa` if boat dimensions are available in the event summary; otherwise pick the first free mySea berth ordered by `code`
3. If matching `Booking` with `booking_source='mysea'` and same dates already exists → skip
4. If dates changed on existing record → update `check_in` / `check_out`
5. If new → create `Booking` with:
   - `status='confirmed'`
   - `booking_source='mysea'`
   - `berth` = first available mySea berth for those dates
   - `paid=True` (mySea handles payment externally)
6. Update `marina.mysea_last_synced = now()`

**Manual trigger endpoint:** `POST /api/v1/berths/sync-mysea/` (staff auth) — runs the same command immediately for the requesting user's marina.

---

## 5. API

### New endpoints

| Method | URL | Auth | Purpose |
|--------|-----|------|---------|
| `GET` | `/api/v1/berths/ical/mysea.ics?marina=<slug>` | Public | Outbound iCal feed for mySea |
| `POST` | `/api/v1/berths/sync-mysea/` | Staff | Manually trigger inbound iCal sync |
| `PATCH` | `/api/v1/marina/channel-settings/` | Manager | Update `auto_allocate_inventory`, `mysea_target_pct`, `mysea_ical_url` |

### Modified endpoints

| Method | URL | Change |
|--------|-----|--------|
| `PATCH` | `/api/v1/berths/<id>/` | When `sales_channel` changes, automatically set `channel_cooldown_until = now + 30min` |

---

## 6. UI

### Channel settings panel (management frontend)

Location: Marina settings, new "Channel Management" section.

- **Toggle:** "Automatically allocate freed berths to channels" → writes `auto_allocate_inventory`
- **Slider** (visible when toggle is on): "Direct — X% | mySea — Y%" → writes `mysea_target_pct`
- **Text input:** "mySea iCal feed URL" → writes `mysea_ical_url`
- **Read-only label:** "Last synced: N minutes ago" (derived from `mysea_last_synced`)
- **Button:** "Sync now" → calls `POST /berths/sync-mysea/`

### Berth channel badge (field app + management map view)

Each berth card/tile shows a small badge: `Direct` or `mySea`.  
Tapping the badge opens a confirmation modal:

> "Move Berth A12 to Direct? It will be unavailable on both channels for 30 minutes while the transition completes."

Confirming fires `PATCH /berths/<id>/` with `{ sales_channel: 'direct' }`.

---

## 7. Out of Scope

- Multi-channel support (Navily, Dockwa) — architecture supports it via additional `sales_channel` choices but not built now
- Stripe billing for mySea-sourced bookings — mySea handles payment externally; bookings are created as `paid=True`
- Automated cron setup — the `sync_mysea_bookings` management command is provided; cron configuration is a deployment concern
