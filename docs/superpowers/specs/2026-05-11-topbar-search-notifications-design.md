# Topbar Search & Notifications — Design Spec

**Date:** 2026-05-11  
**Status:** Approved

---

## Overview

Add two pieces of live functionality to the management system topbar:

1. **Global search** — inline expanding input with dropdown results, covering all data entities and navigation items, with fuzzy/synonym matching via Postgres trigram.
2. **Real-time notifications** — WebSocket-pushed, DB-persisted alerts for action-required events (new booking request, overdue invoice, maintenance task assigned).

---

## 1. Search

### Backend

New Django app: `apps/search`. No database model required.

**Endpoint:** `GET /api/v1/search/?q=<term>`

- Authenticated (JWT). Returns results for the current user's marina only.
- Fans out across: vessels, members, bookings, berths, invoices, staff, maintenance tasks, boatyard entries.
- Each model queried using `SearchVector` (full-text) combined with `TrigramSimilarity` for fuzzy matching. Requires the `pg_trgm` Postgres extension (enabled via migration).
- Results are a flat JSON list, each item has: `type`, `id`, `label`, `sub` (subtitle), `screen` (which app screen to navigate to), and optionally `link_id`.
- Capped at 20 total results. Top 3 per category, sorted by similarity score.

**Example response:**
```json
[
  { "type": "vessel", "id": 12, "label": "Lady Katherine", "sub": "42ft · Berth A3", "screen": "vessels", "link_id": 12 },
  { "type": "member", "id": 5, "label": "John Smith", "sub": "Member #005", "screen": "members", "link_id": 5 },
  { "type": "booking", "id": 88, "label": "INV-0088", "sub": "Lady K · 4–7 May", "screen": "reservations", "link_id": 88 }
]
```

**New files:**
- `apps/search/__init__.py`
- `apps/search/apps.py`
- `apps/search/views.py` — single `SearchView` (APIView)
- `apps/search/urls.py` — `path('search/', SearchView.as_view())`

**Changes to existing files:**
- `config/settings/base.py` — add `'apps.search'` to `LOCAL_APPS`
- `config/urls.py` — add `path('', include('apps.search.urls'))`
- A migration in `apps/search` to enable `pg_trgm` via `CREATE EXTENSION IF NOT EXISTS pg_trgm`

### Frontend

Navigation items (the `TITLE_MAP` entries) are matched client-side — no API call needed.

**New files:**
- `src/hooks/useSearch.js` — takes query string, debounces 300ms, calls `/search/`, returns `{ results, loading }`. Also merges in matched nav items before returning.
- `src/components/layout/SearchDropdown.jsx` — dropdown list grouped by type with icons.

**Changes to `Topbar.jsx`:**
- Search icon click expands an `<input>` in place (CSS width transition).
- Input change calls `useSearch`. Results render in `SearchDropdown` below.
- Clicking a result: calls `setScreen(item.screen)` (or equivalent navigation), closes dropdown, clears input.
- Escape key or click-outside collapses the input and clears results.

---

## 2. Notifications

### Backend

New Django app: `apps/notifications`.

**Model: `Notification`**

| Field | Type | Notes |
|---|---|---|
| `marina` | FK → Marina | Scopes to tenant |
| `recipient` | FK → User | Who sees it |
| `kind` | CharField | `booking_request`, `overdue_invoice`, `maintenance_assigned` |
| `title` | CharField | Short heading |
| `body` | CharField | One-line detail |
| `link_screen` | CharField | Frontend screen name to navigate to |
| `link_id` | IntegerField, nullable | ID of the related record |
| `read` | BooleanField | Default `False` |
| `created_at` | DateTimeField | Auto |

**`notify()` helper** (`apps/notifications/utils.py`):
1. Creates `Notification` DB row.
2. Calls `async_to_sync(channel_layer.group_send)` to push to the recipient's personal channel group (`notif_user_{user_id}`).

**Signal hooks** (in each respective app's `apps.py` `ready()` or a `signals.py`):
- `reservations.BookingRequest` post_save (created=True) → notify all marina users with role `manager` or `admin`
- Existing Celery beat task `billing.send_overdue_invoice_alerts` → call `notify()` per affected invoice owner/manager
- `maintenance.MaintenanceTask` save, when `assigned_to` is set for the first time → notify the assigned staff member

**WebSocket consumer** (`apps/notifications/consumers.py`):
- `NotificationConsumer(AsyncWebsocketConsumer)`
- On connect: authenticate via JWT query param, join group `notif_user_{user_id}`, send last 20 unread notifications from DB.
- On group message: forward to WebSocket.
- On disconnect: leave group.

**REST endpoints** (`apps/notifications/urls.py`):
- `GET /api/v1/notifications/` — list recent 50 notifications for current user, newest first
- `PATCH /api/v1/notifications/<id>/read/` — mark one as read
- `POST /api/v1/notifications/mark-all-read/` — mark all unread as read

**WebSocket URL** (`config/asgi.py`):
- `ws/notifications/` routed to `NotificationConsumer`

**New files:**
- `apps/notifications/__init__.py`
- `apps/notifications/apps.py`
- `apps/notifications/models.py`
- `apps/notifications/utils.py`
- `apps/notifications/consumers.py`
- `apps/notifications/views.py`
- `apps/notifications/serializers.py`
- `apps/notifications/urls.py`
- `apps/notifications/signals.py`
- `apps/notifications/migrations/0001_initial.py`

**Changes to existing files:**
- `config/settings/base.py` — add `'apps.notifications'` to `LOCAL_APPS`
- `config/urls.py` — add notifications URL include
- `config/asgi.py` — add WebSocket routing
- `apps/reservations/apps.py` — import signals in `ready()`
- `apps/billing/tasks.py` (or wherever Celery beat task lives) — call `notify()`
- `apps/maintenance/apps.py` — import signals in `ready()`

### Frontend

**New file: `src/hooks/useNotifications.js`**
- On mount: opens `WebSocket` to `wss://.../ws/notifications/?token=<jwt>`
- On message: prepends to local state list
- Fetches initial list via `GET /api/v1/notifications/` on mount
- Exposes: `{ notifications, unreadCount, markRead, markAllRead }`

**Changes to `Topbar.jsx`:**
- Replace `MOCK_NOTIFS` with data from `useNotifications()`
- Bell badge count = `unreadCount`
- "Mark all read" button calls `markAllRead()`
- Clicking a notification item: calls `markRead(id)`, calls `setScreen(item.link_screen)`, closes panel

---

## 3. Architecture Summary

```
Signal fires (BookingRequest / Invoice / MaintenanceTask)
  → notify() helper
      → DB: INSERT Notification row
      → channel_layer.group_send → NotificationConsumer
          → WebSocket → useNotifications hook → React state → Bell badge + dropdown
```

Search:
```
User types → debounce 300ms → GET /api/v1/search/?q= → SearchView fans out across models
  → TrigramSimilarity ranking → JSON response → SearchDropdown renders grouped results
  → Click → setScreen() + optional deep-link to record
```

---

## Out of Scope

- Email/SMS notification delivery (existing channels for that)
- User notification preference settings
- Semantic/AI-powered search
- Push notifications (browser or mobile)
