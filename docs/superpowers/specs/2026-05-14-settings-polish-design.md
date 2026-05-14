# Settings Polish — Design

**Date:** 2026-05-14
**Status:** Approved for implementation
**Scope:** Manager-side `Settings.jsx`. Removes the feature flag card, repolishes the OTA Connections card, and smokes the OTA flow end-to-end. Frontend-only PR.

## Problem

Three issues in the Marina settings tab:

1. The **Feature Flags card** exposes toggles (`restaurant`, `events`, `portal`, `ais`, `multimarina`) that don't reflect real per-marina gating today; flipping them does nothing visible. They confuse marina admins and tempt them to "turn on" modules they haven't bought.
2. The **OTA Connections card** is functional but visually flat: each connection is a stack of inline-styled `div`s with raw URLs in monospace, no status pill, and a button labelled `Sync now · 14:32` that crams the timestamp into the action. Looks half-finished compared to other cards on the page.
3. **No one has ever end-to-end-tested the OTA sync flow.** The backend code exists; nothing confirms it actually pulls bookings from a real iCal feed.

## Goals

- Delete the feature flag card and its supporting frontend state. Backend `marina.features` field is untouched.
- Rebuild the OTA card as compact rows with a status pill derived from existing fields, a kebab menu for actions, and an in-session error toast for failed syncs.
- Manually smoke the OTA add → sync → import flow using a real public iCal URL. Fix anything that breaks within the spec's scope.

## Non-goals

- No backend schema changes. No new `last_sync_error` field, no migrations. Persisted failure tracking is a future task.
- No new tests. The component is untested today; this PR is purely visual + a manual smoke run.
- No work on Feature Flags backend. The `marina.features` JSON field stays put — only the UI control is removed. If a future PR wants per-marina module gating, it can re-introduce a card.
- No changes to OTA allocation / target % / auto-allocate logic. Those already live on the Channels screen (`frontend/src/screens/Channels.jsx`) and are out of scope.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| One PR or split? | This PR is **only** the polish. Security (TOTP / IP allowlist / email re-verification) is a separate spec + PR. |
| OTA visual direction | Compact rows with status pill — closest to other cards in the app. |
| OTA verification | Smoke end-to-end from scratch using a real iCal URL; fix what breaks. |

## Architecture

Single file, single screen. No new components beyond a small `OTAStatusPill` and a small `KebabMenu` helper local to `Settings.jsx` (or extracted to `frontend/src/components/ui/` if either already exists — verify first).

```
frontend/src/screens/Settings.jsx
├── FeatureFlagsCard          ← DELETE block + supporting state
├── OTAConnectionsCard        ← REPLACE rendering, keep API calls
│   ├── OTAStatusPill (new)   ← inline helper
│   └── KebabMenu (new)       ← inline helper, or reuse existing
└── (everything else unchanged)
```

## Detail — change 1: remove feature flag card

In `frontend/src/screens/Settings.jsx`, delete:

- `FLAG_DEFS` constant near line 87.
- `flags` / `setFlags` state near line 578.
- `flagsSaving` state and `saveFlags` function (find the surrounding effect near line 582).
- The `setFlags(...)` initialisation block inside the marina-load effect near line 479.
- The JSX block that renders the card — the `FLAG_DEFS.map(f => ...)` between roughly line 1235–1249, including its wrapping card div and "Save Flags" button.

Do NOT touch `marina.features` on the backend. If anything elsewhere reads `marina.features.X`, leave it alone — those callers continue to work against whatever the backend returns.

After the delete, confirm `Settings.jsx` builds, the Marina tab still renders, and no references to `flags`/`setFlags`/`FLAG_DEFS`/`saveFlags` remain.

## Detail — change 2: OTA card polish

### Status pill semantics (derived, no backend changes)

```js
function otaStatus(conn) {
  if (!conn.inbound_ical_url) return { key: 'outbound_only', label: 'Outbound only', tone: 'gray' };
  if (!conn.last_synced)      return { key: 'never_synced',  label: 'Never synced',  tone: 'amber' };
  const ageMs = Date.now() - new Date(conn.last_synced).getTime();
  if (ageMs < 60 * 60 * 1000) return { key: 'synced_recent', label: `Synced ${relTime(ageMs)} ago`, tone: 'green' };
  return                              { key: 'synced_stale',  label: `Synced ${relTime(ageMs)} ago`, tone: 'blue' };
}
```

`relTime(ms)` returns `"2m"`, `"45m"`, `"3h"`, `"2d"` etc. Use the smallest unit that fits.

Failed-sync state is **not derived from persisted data** — it's a transient component-state flag that lives only until the next successful sync or page refresh. After a failed `POST /ota-connections/<id>/sync/`, render a red `Sync failed` pill on that row plus an inline error message with the server's `detail`. The pill reverts on the next sync attempt.

### Row layout

Per connection, one row:

```
┌─────────────────────────────────────────────────────────────────┐
│ mySea                              [● Synced 2m ago]      ⋮     │
└─────────────────────────────────────────────────────────────────┘
```

- Left: connection name (bold).
- Centre: status pill (use the existing `.badge` + `.badge-{green|amber|blue|gray|red}` classes already present in the app — grep `frontend/src/styles/app.css` to confirm the exact class names).
- Right: a kebab (`⋮`) button that opens a small menu with three items:
  - **Sync now** — only enabled when `inbound_ical_url` is non-empty.
  - **Copy outbound URL** — copies `${window.location.origin}/api/v1/berths/ical/${conn.outbound_token}.ics` to clipboard, shows a 1.5s "Copied!" toast or button-text swap.
  - **Remove** — same confirm flow as today.

The inbound URL is no longer surfaced as monospace text in the row. To see/edit it, the user clicks the row body, which expands an inline detail panel below the row showing both URLs (inbound editable, outbound copy-only). Default state: collapsed. (Alternative if expansion is too much: hide the inbound URL entirely behind the kebab menu — choose at implementation time based on which feels less cramped. Don't add a third UI layer.)

### Add-connection form

Stays as today: clicking "+ Add connection" reveals the existing inline form with name + inbound URL inputs. No changes.

### Error handling

- Add failure: inline error above the form (existing behaviour preserved).
- Sync failure: row's pill flips to red `Sync failed`; below the row, a one-line `detail` from the server in red. Auto-clears on next sync attempt or component remount.
- Remove failure: existing inline error preserved.

### Kebab menu component

If `frontend/src/components/ui/` already has a `Menu` / `Dropdown` / `KebabMenu` component, use it (`ls frontend/src/components/ui/`). Otherwise write a small one inline in `Settings.jsx`:

```jsx
function KebabMenu({ items }) {
  const [open, setOpen] = useState(false);
  // close on outside click via document mousedown listener
  // items = [{ label, onClick, disabled, danger }]
}
```

Keep it minimal — no animations, no keyboard navigation beyond Escape to close. We'll standardise later if other screens need the same pattern.

## Detail — change 3: smoke-test OTA end-to-end

This is not a code change, but is required to call the PR done. Steps:

1. In a fresh marina (use the dev marina or create a new one), generate a public Google Calendar with a single test event spanning 2 days, e.g. `2026-05-20` → `2026-05-22`, titled `OTA Smoke Test`.
2. Copy the calendar's public iCal URL.
3. In Settings → Marina → OTA Connections, click "+ Add connection". Name it `Smoke Test`, paste the URL, click Add.
4. Status pill should be `Never synced` (amber).
5. Open the kebab menu, click `Sync now`. Wait for the request.
6. Expected: status flips to `Synced just now` (green). One booking appears on a berth covering those dates. If no booking lands, check the backend `sync_connection` log for skip reasons (most likely: no berth assigned to this connection — the dev marina may need a berth manually flagged for OTA allocation first; if so, document this in the PR).
7. Click `Copy outbound URL`. Paste into a new tab. Expected: iCal file downloads with the marina's bookings.
8. Click the kebab → Remove. Confirm. Connection disappears. Berths previously allocated to it revert to Direct (per the existing confirm-message copy).

If any of the above is broken, fix it within this PR if the fix is small (<50 lines, no schema changes). If the fix is larger, file a follow-up issue and ship the polish without it — the polish is independently valuable.

## File changes summary

- Modify: `frontend/src/screens/Settings.jsx` (delete feature flag card, replace OTA card)

That's it.

## Testing

- No new unit tests.
- `npm run build` must pass.
- Manual smoke per "Detail — change 3" above. PR description includes a checklist of the 8 smoke steps.

## Rollout

Single deploy. No backend changes, no migrations, no env vars. Toggle is on for all marinas the moment the FE deploys.

## Out of scope, documented for the follow-up Security PR

(Not implemented here — listed so we don't lose them.)

- TOTP (Microsoft Authenticator / Google Authenticator) MFA enrollment + enforcement.
- IP allowlist per marina.
- Email re-verification after N days of inactivity.
- Replace the existing dead "Security — Coming Soon" card with the real implementation.
