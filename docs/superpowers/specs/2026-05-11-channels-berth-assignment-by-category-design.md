# Channels — Berth Assignment by Category

**Date:** 2026-05-11
**Scope:** `frontend/src/screens/Channels.jsx` — `BerthGrid` component only

## Goal

Replace the per-berth channel assignment table with a per-category dropdown list. Remove pier filter. Every berth belongs to a category; "Direct" (no OTA connection) is the default.

## Current State

`BerthGrid` renders a `<table>` with one row per berth (code, pier, channel dropdown, locked). A pier filter `<select>` in the card header filters the list. Each individual change locks that berth (`channel_locked = true`).

## New Design

### Data

- `categories`: fetched from `GET /berths/berth-categories/` → `[{ id, name }, ...]`
- `berths`: existing fetch from `GET /berths/` — each berth has `category` (integer FK), `ota_connection` (integer or null)

### Component: `BerthGrid`

**Props removed:** `piersFilter`, `setPiersFilter`
**Props added:** `categories`

**Card header:** title "Berth Assignment" only — no pier dropdown.

**Category ordering:** categories render in the order returned by the API (`sort_order` field on `BerthCategory`).

**Card body:** one row per category:

```
[Category name]    [Channel <select>]
```

**Channel dropdown values:** `Direct` (value `""`) + one `<option>` per OTA connection.

**Mixed state:** when berths in a category have differing `ota_connection` values, prepend a disabled `<option value="__mixed__">Mixed</option>` and set the select's value to `"__mixed__"`. Once the user picks a real channel, that option disappears and all berths in the category are updated.

**On change:** PATCH each berth in the category individually via `PATCH /berths/:id/` with `{ ota_connection: connId | null }`. Existing per-berth `handleChannelChange` logic is reused. The dropdown for that category is disabled until all PATCHes resolve.

**Saving state:** `const [saving, setSaving] = useState(null)` keyed by category id.

### Parent: `Channels`

Add category fetch alongside existing berths fetch:

```js
api.get('/berths/berth-categories/')
  .then(r => setCategories(r.data.results ?? r.data))
```

Add `const [categories, setCategories] = useState([])` and `categoriesLoading` state. Include in loading gate. Pass `categories` into `BerthGrid`.

Remove `pierFilter` state and its setter — no longer needed.

## What Does Not Change

- `AllocationCard` components (left column) — untouched
- `BookingPipelineCard`, `BookingPortalCard` — untouched
- Backend — no new endpoints needed; existing `PATCH /berths/:id/` handles assignment
- `channel_locked` flag — still set by the existing `perform_update` backend logic on each individual PATCH; no frontend change needed
- **Unlock UI removed** — the per-berth `🔒 Unlock` button from the old table is intentionally dropped. The backend still sets `channel_locked = true` on each PATCH, but individual unlock is no longer exposed in this screen.
