# Screen Info Drawer — Design

**Date:** 2026-05-14
**Status:** Approved for implementation
**Scope:** Add a `(?)` info button to every screen's header. Click opens a right-side drawer with a short explainer. Plus a small inline hint on the OTA Connections card that piggybacks PR #51.

## Problem

Marinas using DocksBase land on a screen and don't always know what it's for or which mode to pick. Examples:

- **Channels** — "Auto Tetris" vs "Manual selection" — no explanation of the difference.
- **Settings → OTA** — an empty target % means no berths get allocated; the user thinks the sync is broken.
- **Activities → Requests** — visitors see a request inbox but no orientation on the public-flow → confirm pipeline.
- **Sustainability / Loyalty / Boatyard** — entire screens whose purpose isn't obvious from the title.

There is currently no way for the app to tell the user *what this screen is*. New staff onboard by trial and error.

## Goals

- One `(?)` info icon in every screen's header. Clicking opens a right slide-out drawer with the screen title and a 1–3 paragraph explainer.
- Cover all ~35 top-level screens in this PR. Copy lives in a single file so it's easy to skim and edit.
- Drawer is reusable so per-tab info icons can be added later case-by-case (Channels' Auto-Tetris vs Manual, OTA target %, etc.) without re-doing the infra.
- Independently, ship a one-line inline hint on the OTA Connections card when no berths are allocated.

## Non-goals

- **No per-tab info icons** in this PR. Per the brainstorming: only when a future tab explicitly earns one.
- **No structured sections** (What it does / When to use / Common gotchas). Plain text with paragraph breaks only.
- **No screenshots, diagrams, external doc links, or telemetry** in v1.
- **No search across help content.** No "see also" cross-links.
- **No persistence** — drawer always opens fresh. No "don't show again", no first-visit auto-open.
- **No backend changes.** Copy is in a frontend file, edited like any other source.
- **No new tests.** Pure presentational UI, no business logic.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Rollout | Full sweep — every screen in one PR. |
| UI pattern | Right slide-out drawer. |
| Copy source | I draft, user edits in PR review. |
| Icon placement | One per screen, in the screen header beside the title. No per-tab in v1. |
| Content depth | Short — 1–3 paragraphs, ~80 words. |
| OTA "no berths" hint | Fold into PR #51, not this PR. |

## Architecture

```
frontend/src/components/ui/ScreenInfo.jsx     ← new component (icon + drawer)
frontend/src/copy/screenInfo.js               ← new copy file (one flat object)
frontend/src/screens/<every screen>.jsx       ← one-line insertion per file
```

`ScreenInfo` is the only new UI primitive. Copy is a separate flat module so a non-developer can edit it without touching JSX.

## Component: `ScreenInfo`

```jsx
<ScreenInfo title="Channels" body={SCREEN_INFO.channels} />
```

**Props:**
- `title` (string, required) — appears as the drawer header. Usually matches the screen title.
- `body` (string or ReactNode, required) — paragraph text. If a string, rendered as paragraphs split on `\n\n`. If a ReactNode, rendered as-is.

**Render shape:**
- Outside the drawer: a small ghost button containing a circled `?` (using the existing `Icon` component if it has a suitable glyph, otherwise an inline SVG). Sized to sit inline with the screen `<h1>` or equivalent header element. `aria-label="About this screen"`.
- Click: opens a right-anchored fixed drawer (~420px wide on desktop; 100% width minus 16px gutter on screens narrower than 600px). Slides in via a CSS `transform` transition (~180ms). Behind the drawer, a semi-transparent overlay (`rgba(0,0,0,0.35)`).
- Inside drawer: a close `×` button top-right, the `title` as an `<h2>`, then the body paragraphs. No footer.
- Close: clicking the overlay, pressing `Esc`, or clicking the `×` button.
- The drawer uses React portal to `document.body` so it isn't clipped by screen container overflow.
- Body scrolling: the drawer body scrolls internally if content exceeds viewport height. Page underneath scroll-locks while drawer is open (set `document.body.style.overflow = 'hidden'` on open, restore on close).

**No dependencies on existing modals/drawers.** I checked: `frontend/src/screens/ActivitiesHousekeeping/shared.jsx` has a `Drawer` component but it's a centred modal, not a side drawer. Building this fresh is cleaner than extending it.

## Copy: `frontend/src/copy/screenInfo.js`

A single flat object keyed by short stable slug. One entry per screen.

```js
export const SCREEN_INFO = {
  overview: `Top-level dashboard. Today's arrivals and departures, occupancy snapshot, ...`,
  channels: `Channels controls which booking sources your berths are allocated to ...

Two modes. Auto Tetris automatically divides remaining inventory across connections ...
Manual selection lets you set an exact target % per connection ...`,
  settings: `Marina-wide configuration ...`,
  // ... ~32 more keys
};
```

Authored by me as part of implementation; the user reviews and edits in PR review. Each blurb stays under ~80 words. Paragraph breaks are `\n\n`.

Slug naming convention: lowercase identifier of the screen, matches the route or the screen filename (e.g. `Channels.jsx` → `channels`, `ActivitiesHousekeeping/index.jsx` → `activitiesHousekeeping`).

## Per-screen insertion

For each screen file, find the screen header (the element that renders the screen title) and add the `ScreenInfo` button immediately after the title text. The exact JSX varies — some screens use a custom `<header className="screen-hdr">`, some use a plain `<h1>`. **Match the existing pattern in each file.** Do not refactor header layouts.

Imports added at the top of each screen file:
```jsx
import ScreenInfo from '../components/ui/ScreenInfo.jsx';
import { SCREEN_INFO } from '../copy/screenInfo.js';
```

For nested screens (e.g. `ActivitiesHousekeeping/index.jsx`), adjust relative path depth.

Screens that intentionally have no header (e.g. `Login`, `Signup`, `MagicLink`, `VerifyEmail`, `WelcomeScreen`) — skip them. Auth flows don't need contextual help.

## Screen list to populate (~35)

Based on `App.jsx` imports:

**Populated:**
- overview, marinaMap, reservations, vessels, members, boatyard, maintenance, staff, billing, reports, restaurant, events, settings, documents, sales, operations, infrastructure, serviceCatalog, channels, activitiesHousekeeping, revenueIntelligence, berthIntelligence, loyalty, accounting, utilities, communications, charter, tenants, accessControl, sustainability, staffSetup

**Skipped (auth flows, no contextual help needed):**
- login, magicLink, signup, verifyEmail, welcome

If the implementer finds a screen file in `frontend/src/screens/` that I missed, populate it with a sensible blurb rather than skipping — better to cover everything.

## Tab-level info is not in this PR

A `TabInfo` variant of the same component can be added later if a specific tab earns it. The drawer infra in `ScreenInfo` is decoupled enough that a tab-level button can reuse the drawer with a different anchor / different title.

## Side change — OTA card empty-allocation hint (rides on PR #51)

This is a tiny separate commit on the `feature/settings-polish` branch, not this PR.

In `Settings.jsx`'s `OTAConnectionsCard`, between the `error` line and the connection list, add:

```jsx
{connections.length > 0 && !ownsAnyBerth && (
  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)', padding: '4px 0' }}>
    No berths allocated to any connection yet. Set a target % in Channels to start receiving bookings.
  </div>
)}
```

Where `ownsAnyBerth` is computed from a small new API call or, simpler, from the existing marina data if it already exposes berth counts per channel. If neither is easily available, accept a lightweight `GET /berths/?ota_connection__isnull=false&page_size=1` and check `count > 0`. Pick the cheapest path during implementation.

This is small enough to land as a single commit on the existing PR — no spec section beyond the above.

## Testing

- `npm run build` clean.
- Manual smoke: open any screen, click `(?)`, drawer opens; `Esc` closes; click outside closes; close button closes. Body scroll locks while open.
- No unit tests, no Vitest additions. The component is presentational; the cost of testing exceeds the value at this size.

## Rollout

Single FE deploy. The drawer renders on first open — no preload, no bundle-size cliff (component is a few hundred lines, copy is a few KB of strings).

## Risks

- **Drawer z-index conflicts** with the existing centred modal Drawer in `ActivitiesHousekeeping/shared.jsx`. Use a higher z-index (e.g. `z-index: 1000` for overlay, `1001` for drawer) and verify the modal Drawer doesn't clash. Spot-check: open an Activities booking detail, then click `(?)` — both should layer correctly.
- **Header layout drift** — if a screen has a multi-element header (title + filter bar + search), the `(?)` icon needs to attach to the title, not float to the right edge. Implementer judgement per file.
- **Bad copy** — I'll draft from reading the JSX, but I don't know the domain as well as the user. PR review is the safety net; expect substantive edits to several blurbs.
