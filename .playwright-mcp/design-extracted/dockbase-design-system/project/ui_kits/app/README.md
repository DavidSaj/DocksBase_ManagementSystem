# DockBase App UI Kit

A hi-fidelity interactive prototype of the DockBase harbor management application.

## Screens Included

1. **Dashboard** — Overview with occupancy stats, tide/weather widget, recent activity feed
2. **Berths** — Berth grid with occupancy status, filters, quick actions
3. **Bookings** — Booking list with status badges, search, and detail panel
4. **Fleet** — Vessel registry with owner info and vessel specs
5. **Services** — Service request queue with assignment status

## Design Notes

- Built against DockBase Design System tokens (see `../../colors_and_type.css`)
- Font: Inter (substituting NotionInter)
- Icons: Lucide via CDN
- Sidebar navigation pattern — standard for admin/ops dashboards
- Warm neutral palette with DockBase Blue (#0075de) as sole accent

## Usage

Open `index.html` in a browser. All screens are clickable via the left sidebar.
The prototype uses localStorage to persist the active screen between reloads.
