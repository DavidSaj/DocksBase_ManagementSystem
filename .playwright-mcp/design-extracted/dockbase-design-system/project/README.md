# DockBase Design System

## Company Overview

**DockBase** is a harbor and marina service management platform. It provides comprehensive operational tools for harbor masters and marina operators, including:

- **Berth & Slip Management** — booking, allocation, and real-time occupancy tracking
- **Integrated Port Map** — interactive visual map of the harbor with live vessel and berth status
- **Service Scheduling** — fueling, pump-out, maintenance, and provisioning requests
- **Vessel Registry** — owner records, boat specs, insurance, and arrival/departure logs
- **Billing & Invoicing** — berth fees, utility charges, service fees with integrated payments
- **Weather & Tide Integration** — real-time conditions dashboard for operational safety

DockBase serves harbor administrators, dock masters, and marina staff — people who work in practical, nautical environments. The interface should feel professional, trustworthy, and efficient — a workspace tool, not a consumer app.

## Design Inspiration

The visual design language is inspired by **Notion's design system** — warm neutrals, whisper-weight borders, compressed display type, and a clean canvas aesthetic — adapted for a maritime professional context. The result is a modern, minimal, almost paper-like management tool with a nautical soul.

## Sources

- Design system specification provided as structured notes (no external Figma or codebase attached)
- Font: Inter (substituted for NotionInter — see VISUAL FOUNDATIONS)

---

## CONTENT FUNDAMENTALS

### Tone & Voice
- **Professional but approachable** — DockBase speaks like a knowledgeable harbor master: calm, precise, competent. Not cold or bureaucratic, not casual or playful.
- **Action-oriented** — Copy leads with verbs: "Manage your berths", "Track arrivals", "Schedule services". Users are doers; the interface facilitates.
- **Concise** — No filler. Labels are short nouns or short verb phrases. Descriptions are one sentence maximum. UI chrome has zero marketing language.
- **First person avoided in UI** — Buttons say "Get started" not "Let me get started". Error messages say "Couldn't save changes" not "We couldn't save your changes."
- **You-addressed** — When directly addressing the user: "Your berths", "Your fleet", not "Our users' berths".
- **No emoji** — Professional maritime context; emoji are never used in UI copy.
- **Title Case for navigation and headings** — Sentence case for body copy and descriptions.
- **Numbers are specific** — "12 berths available" not "many berths available". "3 services pending" not "several pending."

### Copy Examples
- Hero: "Harbor management, simplified." / "The complete operations platform for modern marinas."
- CTA: "Start managing your harbor" / "Book a demo" / "Get DockBase free"
- Empty states: "No vessels today." / "All berths are clear."
- Confirmation: "Booking confirmed." / "Service scheduled for 09:00."
- Error: "Couldn't complete booking. Check berth availability and try again."

---

## VISUAL FOUNDATIONS

### Color
- Warm neutral palette — grays carry yellow-brown undertones, never blue-gray
- Primary text: `rgba(0,0,0,0.95)` — near-black, not pure black, for micro warmth
- Page background: `#ffffff` pure white
- Alt background: `#f6f5f4` warm white — used for section alternation
- Single saturated accent: **DockBase Blue** `#0075de` — used sparingly for CTAs and links only
- Deep navy `#213183` as secondary brand color for dark feature sections
- Semantic colors (teal success, green confirmation, orange warning) used for status only

### Typography
- **Font**: Inter (substitute for NotionInter — see note below)
- Aggressive negative letter-spacing at display sizes: -2.125px at 64px, relaxing to normal at 16px
- Four weights: 400 (read), 500 (interact), 600 (emphasize), 700 (announce)
- Line-height tightens with size: 1.50 at body → 1.00 at display
- Badge text uses positive letter-spacing (+0.125px) — the only positive tracking

**⚠️ Font Note**: The original spec calls for NotionInter (a modified Inter). This system uses standard **Inter** from Google Fonts as the nearest available substitute. For pixel-perfect fidelity, replace with the NotionInter WOFF2 files if available.

### Backgrounds & Surfaces
- Page: flat white `#ffffff`
- Section alternation: warm white `#f6f5f4` — no hard borders between sections, color alone creates rhythm
- Cards: white with whisper border `1px solid rgba(0,0,0,0.1)` and multi-layer soft shadow
- Dark sections: warm dark `#31302e` — never pure black

### Spacing & Layout
- Base unit: 8px; scale: 4, 8, 12, 16, 24, 32, 48, 64, 80, 120px
- Max content width: ~1200px, centered
- Generous vertical rhythm: 64–120px between major sections
- Hero: centered single-column, 80–120px top padding

### Borders & Shadows
- Borders are "whispers": `1px solid rgba(0,0,0,0.1)` — never heavier
- Shadows: 4–5 stacked layers, individual opacity never above 0.05
- No heavy drop shadows, no colored shadows

### Corner Radii
- 4px: buttons, inputs (functional elements)
- 8px: small cards, inline containers
- 12px: standard cards, image tops
- 16px: hero cards, featured content
- 9999px: badges and pills (status indicators)

### Animation
- Minimal — transitions on hover states only (color, scale)
- Hover: `scale(1.05)` on buttons; color shift on links
- Press/Active: `scale(0.9)` on buttons
- No decorative or page-level animations
- Easing: default ease (no bounce, no spring)

### Imagery & Illustrations
- Product UI screenshots with `1px solid rgba(0,0,0,0.1)` border, `12px` top radius
- No hand-drawn illustrations in the initial system (placeholder used)
- No full-bleed background images
- Grain, gradients, and texture are absent from the core UI

### Hover States
- Links: color shift to darker blue + underline
- Buttons: background darkens (`#005bab` for blue CTA), slight scale up
- Cards: shadow intensification (same multi-layer stack, slightly more opacity)
- Nav links: color shift only

### Iconography
- Line icons preferred; stroke weight medium (1.5–2px)
- Lucide icons via CDN — matches stroke weight and minimal philosophy
- No filled icons in primary navigation or functional UI
- Icons used sparingly — only where they add clarity, not decoration
- No icon fonts; SVG only

---

## ICONOGRAPHY

DockBase uses **Lucide Icons** (CDN: `https://unpkg.com/lucide@latest`) — a minimal, consistent line-icon set with 1.5px stroke weight. Icons are SVG-rendered inline or via the Lucide JS library.

### Usage Rules
- Size: 16px (inline/label), 20px (navigation), 24px (feature/card), 32px (hero/empty state)
- Color: inherits text color (`currentColor`) — no standalone icon colors except semantic states
- Emoji: never used as icons
- Unicode: never used as icons
- Decorative icon usage: limited — icons earn their place by aiding comprehension

### Key Icons (Lucide names)
- `anchor` — brand/harbor identity
- `map` / `map-pin` — port map
- `calendar` — bookings/scheduling
- `ship` — vessels
- `wrench` / `tool` — services/maintenance
- `file-text` — documents/invoices
- `users` — staff/teams
- `cloud-rain` / `wind` — weather
- `droplets` — fuel/pump-out
- `clock` — time/tide schedules

---

## File Index

```
/
├── README.md                    ← This file
├── SKILL.md                     ← Agent skill definition
├── colors_and_type.css          ← CSS variables: colors, type, spacing, shadows
├── assets/
│   └── logo.svg                 ← DockBase wordmark + anchor icon
├── preview/
│   ├── colors-primary.html      ← Primary & brand colors
│   ├── colors-neutral.html      ← Warm neutral scale
│   ├── colors-semantic.html     ← Semantic / status colors
│   ├── type-display.html        ← Display & heading type scale
│   ├── type-body.html           ← Body & UI type scale
│   ├── spacing-tokens.html      ← Spacing & radius tokens
│   ├── elevation.html           ← Shadow & elevation system
│   ├── components-buttons.html  ← Button variants & states
│   ├── components-badges.html   ← Badges & pills
│   ├── components-cards.html    ← Card variants
│   ├── components-inputs.html   ← Form inputs & fields
│   └── components-nav.html      ← Navigation bar
└── ui_kits/
    └── app/
        ├── README.md            ← App UI kit notes
        └── index.html           ← DockBase app — interactive prototype
```
