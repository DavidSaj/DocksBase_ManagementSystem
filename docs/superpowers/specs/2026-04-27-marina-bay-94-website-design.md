# Marina Bay 94 — Public Website Design Spec

**Date:** 2026-04-27  
**Status:** Approved  
**Purpose:** Public-facing marina website that demonstrates DocksBase's instant-booking capability. Visitors can browse services and self-book a berth; the same mock data feeds both this site and the management system frontend, making the connection tangible in demos.

---

## 1. Folder Structure

```
DocksBase_ManagementSystem/
├── frontend/          ← existing management system (untouched)
├── website/           ← Marina Bay 94 public site (new)
│   ├── src/
│   │   ├── styles/
│   │   ├── components/
│   │   ├── pages/
│   │   └── main.jsx
│   ├── index.html
│   └── package.json
└── shared/
    └── mock.js        ← single source of truth imported by both apps
```

`website/` is a standalone Vite + React app, a sibling to `frontend/` at the root level. The two apps share no code except `shared/mock.js`. The Vite alias in `website/vite.config.js` resolves `@shared` to `path.resolve(__dirname, '../shared')`.

---

## 2. Shared Data Architecture

`shared/mock.js` exports the same named constants already used by the management system (`PIERS`, `BOOKINGS`, `SERVICES`). Both apps import directly from this file via a Vite alias (`@shared → ../shared` relative to each app root).

**The demo story:** a slip marked `occupied` in the management system is immediately absent from the website's availability results. No API, no sync — same file, two views.

Bookings submitted through the website are written into `BOOKINGS` (in-memory, session-only in the prototype), so they appear in the management system's Pending Bookings panel.

---

## 3. Visual Style

Inherits the DocksBase design tokens (`--navy`, `--gold`, `--teal`, `--cream`, fonts). Applied with a marina-facing personality:

- **Dark navy backgrounds** on hero, nav, and booking flow
- **Cormorant Garamond** for all display/headline text
- **Jost** for the brand wordmark
- **IBM Plex Sans** for body and UI text
- **Gold (`#b8965a`)** for all primary CTAs and accents
- Cream (`#f5f0e6`) for body copy on dark sections

The `website/` app has its own `src/styles/tokens.css` (copy of the management tokens) and a separate `app.css` — no shared CSS files.

---

## 4. Pages

### 4.1 Home (`/`)

Single-page sections, no sub-routes:

1. **Hero** — full-width dark navy, serif headline ("Your berth awaits"), stats strip (240 berths · 4 piers · Open year-round), two CTAs: "Our Services" (scrolls down) and "Book Now" (→ `/book`)
2. **Services preview** — 4-card grid teasing the main service categories, "View all services" link → `/services`
3. **How it works** — 3-step strip: Search → Select berth → Confirm booking

### 4.2 Services (`/services`)

Grid of service cards. Each card: icon, name, short description, price indicator (€ / €€ / included). Services drawn from `shared/mock.js` `SERVICES` export.

Categories:
- Fuel dock
- Water & electricity hookup
- WiFi
- Haul-out & dry storage
- Laundry
- Provisions / chandlery

### 4.3 Book (`/book`)

5-step booking flow rendered as a single page with step-state managed in React (`useState`). A progress indicator (numbered steps) stays visible throughout.

**Step 1 — Search**
Fields: arrival date, departure date, vessel length (m), vessel draft (m). Gold "Search" button filters `PIERS` from shared mock, returning slips where `status === 'available'` and `maxLength >= vesselLength` and `maxDraft >= vesselDraft`.

**Step 2 — Results**
Grid of berth cards. Each card shows: pier + slip ID, max length, max draft, included amenities (power / water / fuel as icon badges), price per night (€). "Select" button advances to step 3.

**Step 3 — Berth detail**
Expanded view of the selected slip: full spec sheet, amenities list, a simplified SVG pier diagram with the selected slip highlighted, price summary (nights × rate = total). "Select this berth" → step 4.

**Step 4 — Your details**
Two field groups:
- *Vessel:* name, flag (country), type (sailing / motor / other), LOA (m), beam (m), draft (m)
- *Skipper:* full name, phone, email, ETA

"Confirm booking" → step 5.

**Step 5 — Confirmation**
Booking summary: generated ID (`MB94-` + 4-digit random), berth, dates, total cost, skipper name. Static "Add to calendar" button (no-op in prototype). New booking pushed to `BOOKINGS` array with `status: 'pending'` — it appears immediately in the management system's Pending Bookings panel.

---

## 5. Navigation

Sticky top nav on all pages:
- Left: gold square logo mark + "MARINA BAY 94" wordmark (Jost, uppercase, letter-spaced)
- Right: "Services" link, "Availability" link (→ `/book`), gold "Book Now" button
- Dark navy background, no border

---

## 6. Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 19 + Vite |
| Styling | Plain CSS, same token system as `frontend/` |
| Routing | React Router v7 (3 routes: `/`, `/services`, `/book`) |
| Data | `shared/mock.js` via Vite path alias |
| No | Tailwind, chart libs, external UI kits |

---

## 7. Out of Scope

- Contact page
- About page
- Real payment processing
- Authentication / user accounts
- Backend integration (prototype uses shared mock data only)
- Map embed or satellite imagery
