# Marina Bay 94 Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `website/` — a public-facing Marina Bay 94 booking site that shares mock berth data with the existing `frontend/` management app, demonstrating DocksBase's real-time availability feature.

**Architecture:** A standalone Vite + React app at `website/` (sibling to `frontend/`). All mock data lives in a new `shared/mock.js`; the management app re-exports from it so its screen files need no changes. The website's 5-step booking flow writes new bookings into the in-memory `BOOKINGS` array, which immediately appears in the management app's Pending Bookings panel.

**Tech Stack:** React 19 · Vite 8 · React Router DOM 7 · plain CSS · shared/mock.js (no backend)

---

## File Map

```
shared/
  mock.js                   ← all mock data (moved here from frontend/src/data/mock.js, plus SERVICES + enriched slips)

frontend/
  vite.config.js            ← MODIFY: add @shared alias
  src/data/mock.js          ← MODIFY: replace with re-exports from @shared/mock.js

website/
  package.json              ← new Vite+React+React-Router project
  index.html
  vite.config.js            ← @shared alias pointing to ../shared
  src/
    main.jsx
    App.jsx                 ← BrowserRouter + 3 routes
    styles/
      tokens.css            ← copy of design tokens
      app.css               ← website-specific styles
    components/
      Nav.jsx               ← sticky dark nav, used on all pages
    pages/
      Home.jsx              ← hero · services preview · how it works
      Services.jsx          ← full services grid from SERVICES
      Book.jsx              ← step orchestrator (useState for step + booking state)
      book/
        StepSearch.jsx      ← date + vessel inputs, filters PIERS on submit
        StepResults.jsx     ← berth cards grid, select → next step
        StepBerthDetail.jsx ← expanded slip view + SVG pier diagram
        StepDetails.jsx     ← vessel + skipper form
        StepConfirmation.jsx← summary, push to BOOKINGS, show booking ID
```

> **No unit tests:** This is a UI prototype. Each task verifies by running the dev server and checking in the browser. The "verify" steps are the test.

---

## Task 1: Create `shared/mock.js`

**Files:**
- Create: `shared/mock.js`
- Modify: `frontend/vite.config.js`
- Modify: `frontend/src/data/mock.js`

- [ ] **Step 1: Create `shared/mock.js`**

Copy the full content of `frontend/src/data/mock.js` into `shared/mock.js`, then make two additions:

**Addition 1 — enrich each slip in PIERS with `pricePerNight`, `amenities`, and `maxDraft`:**

Replace the PIERS export with this enriched version (add the three new fields to every slip; status/vessel fields unchanged):

```js
// Price tiers: 8m=28, 10m=38, 12m=48, 14m=62, 15m=72, 18m=88, 20m=95, 25m=140
// Amenities: Pier A = power+water+wifi, Pier B = power+water+wifi+fuel, Pier C = power+water
// maxDraft: reasonable depth per slip (occupied slips already have vessel draft for reference)

export const PIERS = [
  { id: 'A', slips: [
    { id: 'A1', len: '12m', maxDraft: '2.8m', pricePerNight: 48, amenities: ['power','water','wifi'], status: 'occupied',    vessel: 'Ocean Star',  owner: 'C. Hammond',  type: 'Motor Yacht', draft: '1.8m' },
    { id: 'A2', len: '10m', maxDraft: '2.4m', pricePerNight: 38, amenities: ['power','water','wifi'], status: 'occupied',    vessel: 'Seabird III', owner: 'T. Marchetti', type: 'Catamaran',   draft: '1.2m' },
    { id: 'A3', len: '15m', maxDraft: '3.0m', pricePerNight: 72, amenities: ['power','water','wifi'], status: 'available',   vessel: null },
    { id: 'A4', len: '8m',  maxDraft: '1.8m', pricePerNight: 28, amenities: ['power','water'],        status: 'maintenance', vessel: null },
    { id: 'A5', len: '12m', maxDraft: '2.8m', pricePerNight: 48, amenities: ['power','water','wifi'], status: 'occupied',    vessel: 'Lady K',      owner: 'A. Schwartz',  type: 'Motor Yacht', draft: '2.1m' },
    { id: 'A6', len: '20m', maxDraft: '3.5m', pricePerNight: 95, amenities: ['power','water','wifi'], status: 'reserved',    vessel: 'Nordic Blue', owner: 'K. Eriksson',  type: 'Sailboat',    draft: '2.4m' },
    { id: 'A7', len: '10m', maxDraft: '2.4m', pricePerNight: 38, amenities: ['power','water','wifi'], status: 'available',   vessel: null },
    { id: 'A8', len: '14m', maxDraft: '3.0m', pricePerNight: 62, amenities: ['power','water','wifi'], status: 'occupied',    vessel: 'Windseeker',  owner: 'R. Fontaine',  type: 'Sailboat',    draft: '1.5m' },
  ]},
  { id: 'B', slips: [
    { id: 'B1', len: '18m', maxDraft: '3.8m', pricePerNight: 88, amenities: ['power','water','wifi','fuel'], status: 'occupied',    vessel: 'Blue Horizon', owner: 'M. Osei',      type: 'Motor Yacht', draft: '2.4m' },
    { id: 'B2', len: '10m', maxDraft: '2.4m', pricePerNight: 38, amenities: ['power','water','wifi','fuel'], status: 'occupied',    vessel: 'Saltwater',    owner: 'J. Hartmann',  type: 'Sailboat',    draft: '1.4m' },
    { id: 'B3', len: '12m', maxDraft: '2.8m', pricePerNight: 48, amenities: ['power','water','wifi','fuel'], status: 'available',   vessel: null },
    { id: 'B4', len: '10m', maxDraft: '2.4m', pricePerNight: 38, amenities: ['power','water','wifi','fuel'], status: 'reserved',    vessel: 'Puffin',       owner: 'S. Yamamoto',  type: 'Sailboat',    draft: '1.3m' },
    { id: 'B5', len: '25m', maxDraft: '4.5m', pricePerNight: 140,amenities: ['power','water','wifi','fuel'], status: 'occupied',    vessel: 'Nautilus V',   owner: 'B. Rousseau',  type: 'Superyacht',  draft: '3.0m' },
    { id: 'B6', len: '12m', maxDraft: '2.8m', pricePerNight: 48, amenities: ['power','water','wifi','fuel'], status: 'available',   vessel: null },
    { id: 'B7', len: '10m', maxDraft: '2.4m', pricePerNight: 38, amenities: ['power','water','fuel'],        status: 'maintenance', vessel: null },
    { id: 'B8', len: '14m', maxDraft: '3.2m', pricePerNight: 62, amenities: ['power','water','wifi','fuel'], status: 'occupied',    vessel: 'Avalon',       owner: 'P. Singh',     type: 'Motor Yacht', draft: '1.9m' },
  ]},
  { id: 'C', slips: [
    { id: 'C1', len: '8m',  maxDraft: '1.8m', pricePerNight: 28, amenities: ['power','water'], status: 'available',   vessel: null },
    { id: 'C2', len: '8m',  maxDraft: '1.8m', pricePerNight: 28, amenities: ['power','water'], status: 'occupied',    vessel: 'Pebble',       owner: 'G. Costa',     type: 'Dinghy',      draft: '0.6m' },
    { id: 'C3', len: '10m', maxDraft: '2.4m', pricePerNight: 38, amenities: ['power','water'], status: 'occupied',    vessel: 'Storm Chaser', owner: 'W. James',     type: 'Sailboat',    draft: '1.6m' },
    { id: 'C4', len: '8m',  maxDraft: '1.8m', pricePerNight: 28, amenities: ['power','water'], status: 'available',   vessel: null },
    { id: 'C5', len: '10m', maxDraft: '2.4m', pricePerNight: 38, amenities: ['power','water'], status: 'reserved',    vessel: 'Tempest',      owner: 'L. Müller',    type: 'Sailboat',    draft: '1.7m' },
    { id: 'C6', len: '12m', maxDraft: '2.8m', pricePerNight: 48, amenities: ['power','water'], status: 'occupied',    vessel: 'Horizon',      owner: 'F. Nakamura',  type: 'Motor Yacht', draft: '1.8m' },
  ]},
];
```

**Addition 2 — add SERVICES export at the bottom of the file:**

```js
export const MARINA_SERVICES = [
  { id: 'SVC-01', name: 'Fuel Dock',             icon: '⛽', desc: 'Diesel and petrol available 7 days a week, 08:00–18:00. Pump-out service also available.', price: 'Market rate' },
  { id: 'SVC-02', name: 'Water & Shore Power',   icon: '⚡', desc: '16A and 32A shore power connections at all berths. Fresh water standpipes at pier head.', price: 'Included' },
  { id: 'SVC-03', name: 'WiFi',                  icon: '📶', desc: 'High-speed marina-wide WiFi included with all transient and annual stays.', price: 'Included' },
  { id: 'SVC-04', name: 'Haul-Out & Dry Storage',icon: '🏗️', desc: '50-tonne Travelift with hardstand, covered and open dry storage. Seasonal and short-stay rates available.', price: 'From €85' },
  { id: 'SVC-05', name: 'Laundry',               icon: '🧺', desc: 'Self-service coin-operated laundry facilities in the amenity block, open 07:00–22:00.', price: '€4 / load' },
  { id: 'SVC-06', name: 'Provisions & Chandlery',icon: '🛍️', desc: 'Chandlery, ice, and essential provisions at the marina office. Diesel additives, rope, fenders, and more.', price: 'Market rate' },
];
```

- [ ] **Step 2: Update `frontend/vite.config.js` to add the `@shared` alias**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
});
```

- [ ] **Step 3: Replace `frontend/src/data/mock.js` with a re-export barrel**

```js
export * from '@shared/mock.js';
```

- [ ] **Step 4: Verify the management app still runs**

```bash
cd frontend
npm run dev
```

Open http://localhost:5173. Check Overview, Reservations, and Marina Map screens load with data. If any screen shows blank data or an import error, the alias is misconfigured — re-check `vite.config.js` path.

- [ ] **Step 5: Commit**

```bash
cd ..
git add shared/mock.js frontend/vite.config.js frontend/src/data/mock.js
git commit -m "feat: extract shared mock data to shared/mock.js"
```

---

## Task 2: Scaffold `website/` Vite App

**Files:**
- Create: `website/package.json`
- Create: `website/index.html`
- Create: `website/vite.config.js`
- Create: `website/src/main.jsx`
- Create: `website/src/styles/tokens.css`
- Create: `website/src/styles/app.css`

- [ ] **Step 1: Create `website/package.json`**

```json
{
  "name": "marina-bay-94",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite --port 5174",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.2.5",
    "react-dom": "^19.2.5",
    "react-router-dom": "^7.5.3"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^6.0.1",
    "vite": "^8.0.10"
  }
}
```

- [ ] **Step 2: Install dependencies**

```bash
cd website
npm install
```

Expected: `node_modules/` created, no errors.

- [ ] **Step 3: Create `website/index.html`**

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Marina Bay 94</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=Jost:wght@400;600;700&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 4: Create `website/vite.config.js`**

```js
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
});
```

- [ ] **Step 5: Create `website/src/styles/tokens.css`**

```css
:root {
  --navy:  #0c1f3d;
  --navy2: #162d52;
  --navy3: #1e3d6e;
  --gold:  #b8965a;
  --gold2: #d4b07a;
  --teal:  #1a6b6e;
  --teal2: #2a9d99;
  --cream: #f5f0e6;
  --bg:    #f4f3f0;
  --bg2:   #eceae6;
  --white: #ffffff;
  --green: #1a8c2e;
  --red:   #c0392b;
  --border: 1px solid rgba(0,0,0,0.09);
  --shadow: 0 1px 4px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06);
  --font:       'IBM Plex Sans', -apple-system, system-ui, sans-serif;
  --font-serif: 'Cormorant Garamond', Georgia, serif;
  --font-brand: 'Jost', -apple-system, system-ui, sans-serif;
}
```

- [ ] **Step 6: Create `website/src/styles/app.css`**

```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: var(--font);
  background: var(--navy);
  color: var(--cream);
  min-height: 100vh;
}

a { color: inherit; text-decoration: none; }
button { cursor: pointer; border: none; background: none; font-family: inherit; }
input, select { font-family: inherit; }

/* ── NAV ─────────────────────────────────────── */
.site-nav {
  position: sticky; top: 0; z-index: 100;
  background: var(--navy);
  border-bottom: 1px solid rgba(255,255,255,0.07);
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 40px; height: 64px;
}
.site-nav-brand {
  display: flex; align-items: center; gap: 10px;
}
.site-nav-logo {
  width: 28px; height: 28px; background: var(--gold); border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-brand); font-weight: 700; font-size: 13px; color: #fff;
}
.site-nav-name {
  font-family: var(--font-brand); font-weight: 700;
  font-size: 13px; letter-spacing: 2.5px; text-transform: uppercase;
  color: var(--cream);
}
.site-nav-links { display: flex; align-items: center; gap: 28px; }
.site-nav-link {
  font-size: 13px; color: rgba(255,255,255,0.6);
  transition: color 0.15s;
}
.site-nav-link:hover, .site-nav-link.active { color: var(--cream); }
.btn-gold {
  background: var(--gold); color: #fff;
  font-size: 11px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase;
  padding: 10px 20px; border-radius: 4px;
  transition: background 0.15s;
}
.btn-gold:hover { background: var(--gold2); }

/* ── HERO ────────────────────────────────────── */
.hero {
  background: linear-gradient(155deg, var(--navy) 55%, #1a3d52 100%);
  padding: 100px 40px 80px;
  display: flex; flex-direction: column; align-items: flex-start;
  max-width: 900px; margin: 0 auto;
}
.hero-eyebrow {
  font-family: var(--font-brand); font-size: 11px; letter-spacing: 3px;
  text-transform: uppercase; color: var(--gold); margin-bottom: 20px;
}
.hero-title {
  font-family: var(--font-serif); font-size: 64px; font-weight: 600;
  line-height: 1.1; color: var(--cream); margin-bottom: 20px;
}
.hero-sub {
  font-size: 16px; color: rgba(245,240,230,0.6);
  line-height: 1.6; max-width: 480px; margin-bottom: 36px;
}
.hero-stats {
  display: flex; gap: 40px; margin-bottom: 40px;
}
.hero-stat-val {
  font-family: var(--font-serif); font-size: 32px; font-weight: 600; color: var(--cream);
}
.hero-stat-label {
  font-size: 11px; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 1px; margin-top: 2px;
}
.hero-ctas { display: flex; gap: 12px; }
.btn-outline {
  border: 1px solid rgba(255,255,255,0.25); color: rgba(255,255,255,0.8);
  font-size: 11px; font-weight: 600; letter-spacing: 0.8px; text-transform: uppercase;
  padding: 10px 20px; border-radius: 4px;
  transition: border-color 0.15s, color 0.15s;
}
.btn-outline:hover { border-color: rgba(255,255,255,0.5); color: #fff; }

/* ── SECTION COMMON ──────────────────────────── */
.site-section { padding: 72px 40px; max-width: 1100px; margin: 0 auto; }
.section-label {
  font-family: var(--font-brand); font-size: 10px; letter-spacing: 3px;
  text-transform: uppercase; color: var(--gold); margin-bottom: 14px;
}
.section-title {
  font-family: var(--font-serif); font-size: 40px; font-weight: 600;
  color: var(--cream); margin-bottom: 8px;
}
.section-sub {
  font-size: 14px; color: rgba(255,255,255,0.5); margin-bottom: 40px;
}

/* ── SERVICE CARDS ───────────────────────────── */
.services-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px;
}
.service-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.07);
  border-radius: 8px; padding: 24px;
}
.service-card-icon { font-size: 24px; margin-bottom: 12px; }
.service-card-name {
  font-size: 14px; font-weight: 600; color: var(--cream); margin-bottom: 6px;
}
.service-card-desc {
  font-size: 12px; color: rgba(255,255,255,0.45); line-height: 1.6; margin-bottom: 14px;
}
.service-card-price {
  font-size: 11px; font-weight: 600; color: var(--gold);
  text-transform: uppercase; letter-spacing: 0.5px;
}

/* ── HOW IT WORKS ────────────────────────────── */
.how-steps {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 0;
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.07); border-radius: 8px;
  overflow: hidden;
}
.how-step {
  padding: 28px 24px;
  border-right: 1px solid rgba(255,255,255,0.07);
}
.how-step:last-child { border-right: none; }
.how-step-num {
  font-family: var(--font-serif); font-size: 36px; color: var(--gold);
  font-weight: 600; margin-bottom: 10px;
}
.how-step-title { font-size: 14px; font-weight: 600; color: var(--cream); margin-bottom: 6px; }
.how-step-desc { font-size: 12px; color: rgba(255,255,255,0.4); line-height: 1.6; }

/* ── BOOK PAGE ───────────────────────────────── */
.book-page { max-width: 900px; margin: 0 auto; padding: 48px 40px; }
.book-progress {
  display: flex; align-items: center; gap: 0; margin-bottom: 48px;
}
.progress-step {
  display: flex; align-items: center; gap: 8px; flex: 1;
}
.progress-dot {
  width: 28px; height: 28px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700; flex-shrink: 0;
  transition: background 0.2s;
}
.progress-dot.done { background: var(--teal2); color: #fff; }
.progress-dot.active { background: var(--gold); color: #fff; }
.progress-dot.pending { background: rgba(255,255,255,0.1); color: rgba(255,255,255,0.3); }
.progress-label {
  font-size: 11px;
  transition: color 0.2s;
}
.progress-label.active { color: var(--cream); font-weight: 600; }
.progress-label.done { color: var(--teal2); }
.progress-label.pending { color: rgba(255,255,255,0.3); }
.progress-line {
  height: 1px; width: 24px; flex-shrink: 0; margin: 0 4px;
}
.progress-line.done { background: var(--teal2); }
.progress-line.pending { background: rgba(255,255,255,0.12); }

.step-title {
  font-family: var(--font-serif); font-size: 32px; font-weight: 600;
  color: var(--cream); margin-bottom: 6px;
}
.step-sub { font-size: 13px; color: rgba(255,255,255,0.45); margin-bottom: 32px; }

/* Search form */
.search-form {
  display: grid; grid-template-columns: 1fr 1fr 1fr 1fr auto; gap: 12px; align-items: end;
}
.form-group label {
  display: block; font-size: 10px; font-weight: 600; letter-spacing: 1px;
  text-transform: uppercase; color: rgba(255,255,255,0.5); margin-bottom: 6px;
}
.form-input {
  width: 100%; background: rgba(255,255,255,0.07);
  border: 1px solid rgba(255,255,255,0.12); border-radius: 4px;
  padding: 10px 12px; font-size: 13px; color: var(--cream);
  outline: none;
}
.form-input:focus { border-color: var(--gold); }
.form-input::placeholder { color: rgba(255,255,255,0.3); }

/* Results grid */
.results-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 20px;
}
.results-count { font-size: 13px; color: rgba(255,255,255,0.5); }
.results-count strong { color: var(--gold); }
.berths-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px;
}
.berth-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px; padding: 16px;
  transition: border-color 0.15s, background 0.15s;
}
.berth-card:hover { border-color: var(--gold); background: rgba(184,150,90,0.06); }
.berth-card-pier { font-size: 11px; font-weight: 700; color: var(--teal2); margin-bottom: 4px; letter-spacing: 0.5px; }
.berth-card-id { font-size: 15px; font-weight: 600; color: var(--cream); margin-bottom: 4px; }
.berth-card-spec { font-size: 11px; color: rgba(255,255,255,0.4); margin-bottom: 12px; }
.berth-amenities { display: flex; gap: 4px; flex-wrap: wrap; margin-bottom: 14px; }
.amenity-tag {
  font-size: 9px; font-weight: 600; padding: 3px 7px; border-radius: 3px;
  background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.5);
  text-transform: uppercase; letter-spacing: 0.5px;
}
.berth-card-footer { display: flex; align-items: center; justify-content: space-between; }
.berth-price { font-family: var(--font-serif); font-size: 22px; font-weight: 600; color: var(--cream); }
.berth-price span { font-size: 11px; font-weight: 400; color: rgba(255,255,255,0.35); font-family: var(--font); }

/* Berth detail */
.berth-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
.detail-card {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 24px;
}
.detail-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
.detail-row:last-child { border-bottom: none; }
.detail-key { font-size: 11px; color: rgba(255,255,255,0.4); }
.detail-val { font-size: 12px; font-weight: 600; color: var(--cream); }

/* Pier SVG diagram */
.pier-diagram {
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07);
  border-radius: 8px; padding: 20px; margin-bottom: 20px;
}
.pier-diagram-title { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: rgba(255,255,255,0.4); margin-bottom: 14px; }

/* Details form */
.details-form { display: flex; flex-direction: column; gap: 28px; }
.form-section-title {
  font-size: 12px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase;
  color: var(--gold); margin-bottom: 14px; padding-bottom: 8px;
  border-bottom: 1px solid rgba(184,150,90,0.2);
}
.form-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.form-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 14px; }
select.form-input option { background: var(--navy2); }

/* Confirmation */
.confirmation-box {
  background: rgba(26,140,46,0.08); border: 1px solid rgba(26,140,46,0.2);
  border-radius: 8px; padding: 28px 32px; text-align: center; margin-bottom: 32px;
}
.confirmation-check { font-size: 40px; margin-bottom: 10px; }
.confirmation-id {
  font-family: var(--font-brand); font-size: 22px; font-weight: 700;
  color: var(--gold); letter-spacing: 2px;
}
.confirmation-label { font-size: 12px; color: rgba(255,255,255,0.45); margin-top: 4px; }
.summary-card {
  background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 8px; padding: 24px;
}
```

- [ ] **Step 7: Create `website/src/main.jsx`**

```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

- [ ] **Step 8: Create `website/src/App.jsx`** (stub pages for now)

```jsx
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Nav from './components/Nav.jsx';
import Home from './pages/Home.jsx';
import Services from './pages/Services.jsx';
import Book from './pages/Book.jsx';

export default function App() {
  return (
    <BrowserRouter>
      <Nav />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/services" element={<Services />} />
        <Route path="/book" element={<Book />} />
      </Routes>
    </BrowserRouter>
  );
}
```

- [ ] **Step 9: Create `website/src/components/Nav.jsx`**

```jsx
import { Link, useLocation } from 'react-router-dom';

export default function Nav() {
  const { pathname } = useLocation();
  return (
    <nav className="site-nav">
      <Link to="/" className="site-nav-brand">
        <div className="site-nav-logo">M</div>
        <span className="site-nav-name">Marina Bay 94</span>
      </Link>
      <div className="site-nav-links">
        <Link to="/services" className={`site-nav-link${pathname === '/services' ? ' active' : ''}`}>Services</Link>
        <Link to="/book" className={`site-nav-link${pathname === '/book' ? ' active' : ''}`}>Availability</Link>
        <Link to="/book" className="btn-gold">Book Now</Link>
      </div>
    </nav>
  );
}
```

- [ ] **Step 10: Create stub `website/src/pages/Home.jsx`** (just enough to verify routing)

```jsx
export default function Home() {
  return <div style={{ padding: 40, color: '#fff' }}>Home – coming in Task 3</div>;
}
```

- [ ] **Step 11: Create stub `website/src/pages/Services.jsx`**

```jsx
export default function Services() {
  return <div style={{ padding: 40, color: '#fff' }}>Services – coming in Task 4</div>;
}
```

- [ ] **Step 12: Create stub `website/src/pages/Book.jsx`**

```jsx
export default function Book() {
  return <div style={{ padding: 40, color: '#fff' }}>Book – coming in Task 5</div>;
}
```

- [ ] **Step 13: Verify website dev server starts**

```bash
cd website
npm run dev
```

Open http://localhost:5174. Nav should render with "Marina Bay 94" branding and the three links. Clicking "Services" and "Book" should show stubs. If you see "Cannot find module 'react-router-dom'", run `npm install` again.

- [ ] **Step 14: Commit**

```bash
cd ..
git add website/ frontend/vite.config.js
git commit -m "feat: scaffold website/ Vite app with nav and stub pages"
```

---

## Task 3: Home Page

**Files:**
- Modify: `website/src/pages/Home.jsx`

- [ ] **Step 1: Replace stub with full Home page**

```jsx
import { Link } from 'react-router-dom';
import { MARINA_SERVICES } from '@shared/mock.js';

export default function Home() {
  const preview = MARINA_SERVICES.slice(0, 4);

  return (
    <main>
      {/* Hero */}
      <div style={{ background: 'linear-gradient(155deg, var(--navy) 55%, #1a3d52 100%)' }}>
        <div className="hero">
          <div className="hero-eyebrow">Marina Bay 94 · Full-Service Marina</div>
          <h1 className="hero-title">Your berth awaits<br />on the Adriatic.</h1>
          <p className="hero-sub">
            240 berths across 4 piers. Transient stays, seasonal berths, haul-out, and
            everything your vessel needs — bookable instantly, online.
          </p>
          <div className="hero-stats">
            <div>
              <div className="hero-stat-val">240</div>
              <div className="hero-stat-label">Total berths</div>
            </div>
            <div>
              <div className="hero-stat-val">4</div>
              <div className="hero-stat-label">Piers</div>
            </div>
            <div>
              <div className="hero-stat-val">Open</div>
              <div className="hero-stat-label">Year-round</div>
            </div>
          </div>
          <div className="hero-ctas">
            <Link to="/book" className="btn-gold">Check Availability</Link>
            <Link to="/services" className="btn-outline">Our Services</Link>
          </div>
        </div>
      </div>

      {/* Services preview */}
      <div className="site-section">
        <div className="section-label">What we offer</div>
        <h2 className="section-title">Everything onboard.</h2>
        <p className="section-sub">A full-service marina, from fuel to haul-out.</p>
        <div className="services-grid" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
          {preview.map(s => (
            <div key={s.id} className="service-card">
              <div className="service-card-icon">{s.icon}</div>
              <div className="service-card-name">{s.name}</div>
              <div className="service-card-desc">{s.desc}</div>
              <div className="service-card-price">{s.price}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 24 }}>
          <Link to="/services" className="btn-outline">View all services →</Link>
        </div>
      </div>

      {/* How it works */}
      <div className="site-section" style={{ paddingTop: 0 }}>
        <div className="section-label">Instant booking</div>
        <h2 className="section-title">Three steps to your berth.</h2>
        <p className="section-sub" style={{ marginBottom: 28 }}>Real-time availability, no back-and-forth.</p>
        <div className="how-steps">
          <div className="how-step">
            <div className="how-step-num">01</div>
            <div className="how-step-title">Search availability</div>
            <div className="how-step-desc">Enter your arrival date, departure date, and vessel dimensions to see matching berths.</div>
          </div>
          <div className="how-step">
            <div className="how-step-num">02</div>
            <div className="how-step-title">Select your berth</div>
            <div className="how-step-desc">Browse available berths by pier, size, amenities, and price. View the pier layout before choosing.</div>
          </div>
          <div className="how-step">
            <div className="how-step-num">03</div>
            <div className="how-step-title">Confirm instantly</div>
            <div className="how-step-desc">Enter vessel and skipper details. Your booking is confirmed immediately with a reference number.</div>
          </div>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify in browser**

Open http://localhost:5174. You should see:
- Dark navy hero with "Your berth awaits on the Adriatic." in Cormorant Garamond
- Stats row (240 / 4 / Open)
- Two CTA buttons
- 4-card services preview grid
- "How it works" 3-step strip

- [ ] **Step 3: Commit**

```bash
git add website/src/pages/Home.jsx
git commit -m "feat: add Marina Bay 94 home page"
```

---

## Task 4: Services Page

**Files:**
- Modify: `website/src/pages/Services.jsx`

- [ ] **Step 1: Replace stub with full Services page**

```jsx
import { MARINA_SERVICES } from '@shared/mock.js';
import { Link } from 'react-router-dom';

export default function Services() {
  return (
    <main>
      <div style={{ background: 'var(--navy2)', padding: '60px 40px 40px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <div className="section-label">Marina Bay 94</div>
          <h1 className="section-title" style={{ marginBottom: 6 }}>Marina services.</h1>
          <p style={{ fontSize: 15, color: 'rgba(255,255,255,0.5)', maxWidth: 500 }}>
            Everything your vessel needs, in one place. All services available to transient and annual berth holders.
          </p>
        </div>
      </div>

      <div className="site-section">
        <div className="services-grid">
          {MARINA_SERVICES.map(s => (
            <div key={s.id} className="service-card">
              <div className="service-card-icon">{s.icon}</div>
              <div className="service-card-name">{s.name}</div>
              <div className="service-card-desc">{s.desc}</div>
              <div className="service-card-price">{s.price}</div>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 48, padding: '28px 32px', background: 'rgba(184,150,90,0.07)', border: '1px solid rgba(184,150,90,0.2)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--cream)', marginBottom: 4 }}>Ready to book a berth?</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>Check real-time availability and reserve instantly.</div>
          </div>
          <Link to="/book" className="btn-gold">Check Availability</Link>
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Verify in browser**

Navigate to http://localhost:5174/services. All 6 service cards should render with icons, descriptions, and price indicators. The gold CTA strip at the bottom should link to `/book`.

- [ ] **Step 3: Commit**

```bash
git add website/src/pages/Services.jsx
git commit -m "feat: add marina services page"
```

---

## Task 5: Book Page — Orchestrator + Step 1 (Search)

**Files:**
- Modify: `website/src/pages/Book.jsx`
- Create: `website/src/pages/book/StepSearch.jsx`

- [ ] **Step 1: Create `website/src/pages/book/StepSearch.jsx`**

```jsx
export default function StepSearch({ onSearch }) {
  function handleSubmit(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    onSearch({
      arrival:   fd.get('arrival'),
      departure: fd.get('departure'),
      length:    parseFloat(fd.get('length')) || 0,
      draft:     parseFloat(fd.get('draft'))  || 0,
    });
  }

  return (
    <div>
      <h2 className="step-title">Find your berth.</h2>
      <p className="step-sub">Enter your dates and vessel dimensions to see available berths.</p>
      <form className="search-form" onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="arrival">Arrival date</label>
          <input id="arrival" name="arrival" type="date" className="form-input" required />
        </div>
        <div className="form-group">
          <label htmlFor="departure">Departure date</label>
          <input id="departure" name="departure" type="date" className="form-input" required />
        </div>
        <div className="form-group">
          <label htmlFor="length">Vessel length (m)</label>
          <input id="length" name="length" type="number" step="0.1" min="1" placeholder="e.g. 11.5" className="form-input" required />
        </div>
        <div className="form-group">
          <label htmlFor="draft">Vessel draft (m)</label>
          <input id="draft" name="draft" type="number" step="0.1" min="0.1" placeholder="e.g. 1.8" className="form-input" required />
        </div>
        <button type="submit" className="btn-gold" style={{ height: 40, whiteSpace: 'nowrap' }}>Search</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Replace `website/src/pages/Book.jsx` with the orchestrator**

```jsx
import { useState } from 'react';
import { PIERS, BOOKINGS } from '@shared/mock.js';
import StepSearch from './book/StepSearch.jsx';
import StepResults from './book/StepResults.jsx';
import StepBerthDetail from './book/StepBerthDetail.jsx';
import StepDetails from './book/StepDetails.jsx';
import StepConfirmation from './book/StepConfirmation.jsx';

const STEPS = ['Search', 'Results', 'Select', 'Details', 'Confirm'];

function Progress({ step }) {
  return (
    <div className="book-progress">
      {STEPS.map((label, i) => {
        const state = i < step ? 'done' : i === step ? 'active' : 'pending';
        return (
          <div key={label} className="progress-step">
            <div className={`progress-dot ${state}`}>
              {state === 'done' ? '✓' : i + 1}
            </div>
            <span className={`progress-label ${state}`}>{label}</span>
            {i < STEPS.length - 1 && (
              <div className={`progress-line ${i < step ? 'done' : 'pending'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Book() {
  const [step, setStep]           = useState(0);
  const [search, setSearch]       = useState(null);
  const [results, setResults]     = useState([]);
  const [selected, setSelected]   = useState(null);
  const [bookingId, setBookingId] = useState(null);

  function handleSearch(params) {
    const available = PIERS
      .flatMap(p => p.slips.map(s => ({ ...s, pier: p.id })))
      .filter(s =>
        s.status === 'available' &&
        parseFloat(s.len) >= params.length &&
        parseFloat(s.maxDraft) >= params.draft
      );
    setSearch(params);
    setResults(available);
    setStep(1);
  }

  function handleSelect(slip) {
    setSelected(slip);
    setStep(2);
  }

  function handleDetailConfirm() {
    setStep(3);
  }

  function handleDetailsSubmit(vesselInfo) {
    const id = 'MB94-' + String(Math.floor(1000 + Math.random() * 9000));
    const nights = search
      ? Math.max(1, Math.round((new Date(search.departure) - new Date(search.arrival)) / 86400000))
      : 1;
    BOOKINGS.push({
      id,
      vessel: vesselInfo.vesselName,
      owner:  vesselInfo.skipperName,
      berth:  selected.id,
      checkin: search.arrival,
      checkout: search.departure,
      nights,
      type: 'Transient',
      status: 'pending',
      paid: false,
      amount: `€${selected.pricePerNight * nights}`,
    });
    selected.status = 'reserved';
    setBookingId(id);
    setStep(4);
  }

  return (
    <main>
      <div style={{ background: 'var(--navy2)', padding: '40px 40px 0', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', paddingBottom: 32 }}>
          <div className="section-label" style={{ marginBottom: 6 }}>Marina Bay 94</div>
          <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: 36, fontWeight: 600, color: 'var(--cream)' }}>Book a berth.</h1>
        </div>
      </div>
      <div className="book-page">
        <Progress step={step} />
        {step === 0 && <StepSearch onSearch={handleSearch} />}
        {step === 1 && <StepResults results={results} search={search} onSelect={handleSelect} onBack={() => setStep(0)} />}
        {step === 2 && <StepBerthDetail slip={selected} search={search} onConfirm={handleDetailConfirm} onBack={() => setStep(1)} />}
        {step === 3 && <StepDetails slip={selected} search={search} onSubmit={handleDetailsSubmit} onBack={() => setStep(2)} />}
        {step === 4 && <StepConfirmation bookingId={bookingId} slip={selected} search={search} />}
      </div>
    </main>
  );
}
```

- [ ] **Step 3: Create stub for `website/src/pages/book/StepResults.jsx`** (prevents import error)

```jsx
export default function StepResults({ results, onSelect, onBack }) {
  return <div style={{ color: '#fff' }}>Results stub — {results.length} berths found. <button onClick={onBack} style={{ color: 'var(--gold)' }}>Back</button></div>;
}
```

- [ ] **Step 4: Create stubs for remaining step files**

`website/src/pages/book/StepBerthDetail.jsx`:
```jsx
export default function StepBerthDetail({ slip, onConfirm, onBack }) {
  return <div style={{ color: '#fff' }}>Detail stub — {slip?.id}. <button onClick={onBack} style={{ color: 'var(--gold)' }}>Back</button> <button onClick={onConfirm} style={{ color: 'var(--gold)' }}>Continue</button></div>;
}
```

`website/src/pages/book/StepDetails.jsx`:
```jsx
export default function StepDetails({ onSubmit, onBack }) {
  return <div style={{ color: '#fff' }}>Details stub. <button onClick={onBack} style={{ color: 'var(--gold)' }}>Back</button> <button onClick={() => onSubmit({ vesselName: 'Test', skipperName: 'Test' })} style={{ color: 'var(--gold)' }}>Confirm</button></div>;
}
```

`website/src/pages/book/StepConfirmation.jsx`:
```jsx
export default function StepConfirmation({ bookingId }) {
  return <div style={{ color: '#fff' }}>Confirmation stub — {bookingId}</div>;
}
```

- [ ] **Step 5: Verify booking flow skeleton works**

Open http://localhost:5174/book. You should see:
- "Find your berth." heading with the search form
- Fill in a date, length (e.g. 10), draft (e.g. 1.5), click Search
- Progress moves to step 2, results stub shows berth count (should be 8)
- Back navigation returns to step 1

- [ ] **Step 6: Commit**

```bash
git add website/src/pages/Book.jsx website/src/pages/book/
git commit -m "feat: add book page orchestrator and search step"
```

---

## Task 6: Steps 2 & 3 — Results + Berth Detail

**Files:**
- Modify: `website/src/pages/book/StepResults.jsx`
- Modify: `website/src/pages/book/StepBerthDetail.jsx`

- [ ] **Step 1: Replace `StepResults.jsx` with full implementation**

```jsx
const AMENITY_LABELS = { power: '⚡ Power', water: '💧 Water', wifi: '📶 WiFi', fuel: '⛽ Fuel' };

export default function StepResults({ results, search, onSelect, onBack }) {
  const nights = search
    ? Math.max(1, Math.round((new Date(search.departure) - new Date(search.arrival)) / 86400000))
    : 1;

  return (
    <div>
      <h2 className="step-title">Available berths.</h2>
      <p className="step-sub">
        {search?.arrival} → {search?.departure} · Vessel {search?.length}m · Draft {search?.draft}m
      </p>
      <div className="results-header">
        <div className="results-count">
          Showing <strong>{results.length} available berths</strong>
          {nights > 1 ? ` · ${nights} nights` : ''}
        </div>
        <button onClick={onBack} className="btn-outline" style={{ fontSize: 11, padding: '7px 14px' }}>← Change search</button>
      </div>

      {results.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
          No berths match your vessel dimensions for those dates.
        </div>
      ) : (
        <div className="berths-grid">
          {results.map(slip => (
            <div key={slip.id} className="berth-card">
              <div className="berth-card-pier">Pier {slip.pier}</div>
              <div className="berth-card-id">Slip {slip.id}</div>
              <div className="berth-card-spec">Max {slip.len} · Draft {slip.maxDraft}</div>
              <div className="berth-amenities">
                {(slip.amenities || []).map(a => (
                  <span key={a} className="amenity-tag">{AMENITY_LABELS[a] || a}</span>
                ))}
              </div>
              <div className="berth-card-footer">
                <div>
                  <div className="berth-price">€{slip.pricePerNight}<span>/night</span></div>
                  {nights > 1 && (
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 2 }}>
                      €{slip.pricePerNight * nights} total
                    </div>
                  )}
                </div>
                <button className="btn-gold" onClick={() => onSelect(slip)} style={{ fontSize: 11, padding: '8px 14px' }}>
                  Select
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Replace `StepBerthDetail.jsx` with full implementation**

```jsx
const AMENITY_LABELS = { power: '⚡ Shore Power', water: '💧 Fresh Water', wifi: '📶 WiFi', fuel: '⛽ Fuel Nearby' };

function PierDiagram({ pier, slipId }) {
  const colors = { A: '#1a6b6e', B: '#162d52', C: '#1e3d6e' };
  const col = colors[pier] || '#1a3d52';
  const slips = { A: ['A1','A2','A3','A4','A5','A6','A7','A8'], B: ['B1','B2','B3','B4','B5','B6','B7','B8'], C: ['C1','C2','C3','C4','C5','C6'] };
  const items = slips[pier] || [];
  return (
    <div className="pier-diagram">
      <div className="pier-diagram-title">Pier {pier} layout</div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <div style={{ width: 12, height: 60, background: col, borderRadius: 3 }} />
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {items.map(s => (
            <div key={s} style={{
              width: 36, height: 24, borderRadius: 3, fontSize: 9, fontWeight: 700,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: s === slipId ? 'var(--gold)' : 'rgba(255,255,255,0.08)',
              color: s === slipId ? '#fff' : 'rgba(255,255,255,0.35)',
              border: s === slipId ? '1px solid var(--gold)' : '1px solid rgba(255,255,255,0.06)',
            }}>{s}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function StepBerthDetail({ slip, search, onConfirm, onBack }) {
  if (!slip) return null;
  const nights = search
    ? Math.max(1, Math.round((new Date(search.departure) - new Date(search.arrival)) / 86400000))
    : 1;
  const total = slip.pricePerNight * nights;

  return (
    <div>
      <h2 className="step-title">Slip {slip.id} — Pier {slip.pier}</h2>
      <p className="step-sub">Review details before entering your vessel information.</p>

      <PierDiagram pier={slip.pier} slipId={slip.id} />

      <div className="berth-detail-grid" style={{ marginBottom: 28 }}>
        <div className="detail-card">
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 14 }}>Berth specifications</div>
          {[
            ['Slip ID',      slip.id],
            ['Pier',         `Pier ${slip.pier}`],
            ['Max length',   slip.len],
            ['Max draft',    slip.maxDraft],
            ['Price',        `€${slip.pricePerNight} / night`],
          ].map(([k, v]) => (
            <div key={k} className="detail-row">
              <span className="detail-key">{k}</span>
              <span className="detail-val">{v}</span>
            </div>
          ))}
        </div>

        <div className="detail-card">
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 14 }}>Your stay</div>
          {[
            ['Arrival',    search?.arrival   || '—'],
            ['Departure',  search?.departure || '—'],
            ['Nights',     nights],
            ['Rate',       `€${slip.pricePerNight} / night`],
            ['Total',      `€${total}`],
          ].map(([k, v]) => (
            <div key={k} className="detail-row">
              <span className="detail-key">{k}</span>
              <span className="detail-val" style={k === 'Total' ? { color: 'var(--gold)', fontSize: 14 } : {}}>{v}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'rgba(255,255,255,0.4)', marginBottom: 10 }}>Included amenities</div>
        <div className="berth-amenities">
          {(slip.amenities || []).map(a => (
            <span key={a} className="amenity-tag" style={{ fontSize: 11, padding: '5px 10px' }}>{AMENITY_LABELS[a] || a}</span>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12 }}>
        <button onClick={onBack} className="btn-outline">← Back to results</button>
        <button onClick={onConfirm} className="btn-gold">Select this berth →</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify results and detail flow**

Open http://localhost:5174/book. Search with length 10, draft 1.5. You should see berth cards. Click "Select" on one — detail view opens with the pier diagram, spec table, and stay summary. Gold "Select this berth" advances to step 4 (details stub).

- [ ] **Step 4: Commit**

```bash
git add website/src/pages/book/StepResults.jsx website/src/pages/book/StepBerthDetail.jsx
git commit -m "feat: add results grid and berth detail step"
```

---

## Task 7: Steps 4 & 5 — Details Form + Confirmation

**Files:**
- Modify: `website/src/pages/book/StepDetails.jsx`
- Modify: `website/src/pages/book/StepConfirmation.jsx`

- [ ] **Step 1: Replace `StepDetails.jsx` with full form**

```jsx
import { useState } from 'react';

export default function StepDetails({ slip, search, onSubmit, onBack }) {
  const nights = search
    ? Math.max(1, Math.round((new Date(search.departure) - new Date(search.arrival)) / 86400000))
    : 1;

  const [form, setForm] = useState({
    vesselName: '', flag: '', vesselType: 'Sailing Yacht',
    loa: search?.length || '', beam: '', draft: search?.draft || '',
    skipperName: '', phone: '', email: '', eta: '',
  });

  function set(k, v) { setForm(f => ({ ...f, [k]: v })); }

  function handleSubmit(e) {
    e.preventDefault();
    onSubmit(form);
  }

  return (
    <div>
      <h2 className="step-title">Your details.</h2>
      <p className="step-sub">Slip {slip?.id} · Pier {slip?.pier} · {nights} night{nights !== 1 ? 's' : ''} · €{(slip?.pricePerNight || 0) * nights} total</p>

      <form className="details-form" onSubmit={handleSubmit}>
        {/* Vessel */}
        <div>
          <div className="form-section-title">Vessel information</div>
          <div className="form-grid-2" style={{ marginBottom: 12 }}>
            <div className="form-group">
              <label>Vessel name</label>
              <input className="form-input" required value={form.vesselName} onChange={e => set('vesselName', e.target.value)} placeholder="e.g. Ocean Star" />
            </div>
            <div className="form-group">
              <label>Flag (country)</label>
              <input className="form-input" required value={form.flag} onChange={e => set('flag', e.target.value)} placeholder="e.g. GBR" maxLength={3} />
            </div>
          </div>
          <div className="form-grid-3" style={{ marginBottom: 12 }}>
            <div className="form-group">
              <label>Vessel type</label>
              <select className="form-input" value={form.vesselType} onChange={e => set('vesselType', e.target.value)}>
                <option>Sailing Yacht</option>
                <option>Motor Yacht</option>
                <option>Catamaran</option>
                <option>Superyacht</option>
                <option>RIB / Powerboat</option>
                <option>Other</option>
              </select>
            </div>
            <div className="form-group">
              <label>LOA (m)</label>
              <input type="number" step="0.1" className="form-input" required value={form.loa} onChange={e => set('loa', e.target.value)} />
            </div>
            <div className="form-group">
              <label>Beam (m)</label>
              <input type="number" step="0.1" className="form-input" required value={form.beam} onChange={e => set('beam', e.target.value)} placeholder="e.g. 3.8" />
            </div>
          </div>
          <div className="form-grid-3">
            <div className="form-group">
              <label>Draft (m)</label>
              <input type="number" step="0.1" className="form-input" required value={form.draft} onChange={e => set('draft', e.target.value)} />
            </div>
          </div>
        </div>

        {/* Skipper */}
        <div>
          <div className="form-section-title">Skipper information</div>
          <div className="form-grid-2" style={{ marginBottom: 12 }}>
            <div className="form-group">
              <label>Full name</label>
              <input className="form-input" required value={form.skipperName} onChange={e => set('skipperName', e.target.value)} placeholder="e.g. J. Hammond" />
            </div>
            <div className="form-group">
              <label>Phone</label>
              <input type="tel" className="form-input" required value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+44 7700 000000" />
            </div>
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label>Email</label>
              <input type="email" className="form-input" required value={form.email} onChange={e => set('email', e.target.value)} placeholder="skipper@email.com" />
            </div>
            <div className="form-group">
              <label>Estimated arrival time</label>
              <input type="time" className="form-input" required value={form.eta} onChange={e => set('eta', e.target.value)} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12 }}>
          <button type="button" onClick={onBack} className="btn-outline">← Back</button>
          <button type="submit" className="btn-gold">Confirm booking →</button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 2: Replace `StepConfirmation.jsx` with full implementation**

```jsx
import { Link } from 'react-router-dom';

export default function StepConfirmation({ bookingId, slip, search }) {
  const nights = search
    ? Math.max(1, Math.round((new Date(search.departure) - new Date(search.arrival)) / 86400000))
    : 1;
  const total = (slip?.pricePerNight || 0) * nights;

  return (
    <div>
      <div className="confirmation-box">
        <div className="confirmation-check">✓</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 8 }}>Booking confirmed</div>
        <div className="confirmation-id">{bookingId}</div>
        <div className="confirmation-label">Your booking reference</div>
      </div>

      <div className="summary-card">
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, textTransform: 'uppercase', color: 'var(--gold)', marginBottom: 16 }}>Booking summary</div>
        {[
          ['Berth',     `Slip ${slip?.id} · Pier ${slip?.pier}`],
          ['Arrival',   search?.arrival   || '—'],
          ['Departure', search?.departure || '—'],
          ['Nights',    nights],
          ['Total',     `€${total}`],
        ].map(([k, v]) => (
          <div key={k} className="detail-row">
            <span className="detail-key">{k}</span>
            <span className="detail-val" style={k === 'Total' ? { color: 'var(--gold)', fontSize: 14 } : {}}>{v}</span>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24, padding: '16px 20px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8, fontSize: 12, color: 'rgba(255,255,255,0.45)', lineHeight: 1.7 }}>
        Your booking is now confirmed and visible to the marina team. Please have your booking reference ready on arrival. The harbor master will assign you a dock assistant on check-in.
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
        <button className="btn-outline" onClick={() => alert('Calendar export coming soon')}>Add to calendar</button>
        <Link to="/" className="btn-gold">Back to home</Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify the full booking flow end to end**

Open http://localhost:5174/book and complete all 5 steps:
1. Enter arrival date, departure date, length, draft → click Search
2. Click "Select" on any berth card
3. Review berth detail → click "Select this berth"
4. Fill in vessel name, flag, vessel type, LOA, beam, draft, skipper name, phone, email, ETA → click "Confirm booking"
5. Confirmation screen shows a `MB94-XXXX` booking ID and booking summary

Then open http://localhost:5173 (management app) and check the Reservations screen — the new booking should appear with status "pending".

- [ ] **Step 4: Commit**

```bash
git add website/src/pages/book/StepDetails.jsx website/src/pages/book/StepConfirmation.jsx
git commit -m "feat: add details form and confirmation step — booking flow complete"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ `website/` folder as sibling to `frontend/` (Task 2)
- ✅ `shared/mock.js` single source of truth (Task 1)
- ✅ Both apps use `@shared` alias (Task 1, Task 2)
- ✅ Dark & Premium visual style — navy, gold CTAs, Cormorant Garamond (Task 2 CSS)
- ✅ Home page — hero, services preview, how it works (Task 3)
- ✅ Services page — full grid from MARINA_SERVICES (Task 4)
- ✅ 5-step booking flow: Search → Results → Berth Detail → Details → Confirmation (Tasks 5–7)
- ✅ New bookings pushed to shared BOOKINGS array → appear in management pending list (Task 5, Book.jsx)
- ✅ Berth filtered by `status === 'available'` AND `len >= vesselLength` AND `maxDraft >= vesselDraft`
- ✅ Nav: sticky, dark, logo + 3 links (Task 2)
- ✅ No contact / about pages
