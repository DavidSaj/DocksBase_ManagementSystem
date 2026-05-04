# Operational Friction — Frau Zanger's Five Gaps

> Captured: 2026-05-03
> Perspective: Marina Manager, Friday 4pm, 30 boats arriving, VHF radio screaming, wind at 20 knots.

This document captures five real-world operational failures in the current DocksBase design. These are not edge cases — they are the daily reality of running a working harbor. The database architecture is strong. The UX is not. This is the gap list that defines the next sprint.

---

## Gap 1 — The 7-Click Booking (The Desk Bottleneck)

### The Problem

The booking flow in Section 3.1 of the project overview requires **seven discrete manager actions** to process a single transient overnight stay:

1. Review the request
2. Run the berth-matching algorithm
3. Click Approve
4. Wait for the boater to pay via emailed Stripe link
5. Manually click "Checked In" when they arrive
6. Manually click "Checked Out" when they leave
7. Manually finalize utility meters and send final invoice

At peak arrival — 30 boats, a Friday evening, 16:00 — this is 210 manager actions before dinner. It is not feasible.

### What's Needed

**A. Automatic check-in at arrival date**
When a booking is `confirmed` (paid), the system should automatically transition it to `checked_in` at 14:00 on the arrival date. This requires a scheduled background task (Celery beat or Django-Q). The manager should only need to intervene if something goes wrong.

**B. Self-check-in on the Boater Portal**
Boaters with a confirmed booking should be able to open the portal, see their allocated berth on a read-only map, and tap "Check In" themselves. This writes `checked_in` to the booking and updates `berth.status → occupied` without the manager touching anything.

**C. Auto check-out**
Same logic in reverse: at the departure date + time, automatically transition to `checked_out` if no extension has been requested.

### Current State

- Booking model and status transitions exist in the backend
- No Celery/background task runner is installed
- Boater Portal exists (`Portal.jsx`) but has no self-check-in UI
- No auto-transition logic anywhere

### Priority: **P0 for check-in automation**, P1 for self-check-in portal

---

## Gap 2 — The Emailed Link Payment Assumption

### The Problem

The current payment design assumes boaters pay via a Stripe Checkout link sent by email. In practice, a significant portion of transient boaters — especially older sailors, European tourists, delivery skippers — walk into the marina office holding a physical credit card or cash. The system has no counter-sale flow.

### What's Needed

A prominent **"Record Payment"** button on every invoice detail view. It should allow:

- **Cash** — record amount received, system marks invoice paid, prints/emails receipt
- **External card** (card machine not connected to DocksBase) — same flow, different method
- **Bank transfer** — mark as paid with reference number

This is not about integrating with Stripe Terminal hardware (that can be P2). It is about closing an invoice right now, at the desk, without sending an email.

### Current State

**The backend is almost fully built.** `AccountPayment` model exists with `cash`, `external_card`, `bank_transfer` methods. `RecordPaymentView` exists at `POST /billing/accounts/<member_id>/payments/`. `allocation_service.py` allocates the payment against open invoices automatically.

**The frontend gap:** There is no "Record Payment" button visible on the invoice row or invoice detail panel. Billing.jsx has a cash option buried somewhere but it is not prominently surfaced as a "close this invoice at the counter" action.

**This gap is closer to done than any other gap on this list.** It needs a frontend button, not a backend rewrite.

### Priority: **P0 — backend exists, frontend UI is the only missing piece**

---

## Gap 3 — 30-Second Polling on the Live Map (The Double-Booking Danger)

### The Problem

The Live Map polls the API every 30 seconds. If a dockhand on an iPad assigns a 40-foot catamaran to slip B12 at 16:00:00, a manager looking at their desktop screen at 16:00:15 still sees B12 as green (Available). They assign a second boat to the same slip. Two angry captains. One available slip. The manager looks incompetent.

This is currently listed as a P2 Nice-to-Have in the project overview. That classification is wrong.

### What's Needed

**Django Channels WebSocket connection on the Live Map.** When any pier or berth changes in the database, a push event goes to all connected clients and the map updates within ~1 second. No polling required.

The scope for the Live Map specifically is narrow:
- Server: a WebSocket consumer that listens for `berth.updated` and `booking.status_changed` signals
- Client: `LiveMap.jsx` opens a WebSocket on mount, processes berth status deltas, updates shapes in state

The Map Builder does not need real-time sync immediately — only the Live Map viewer.

### Current State

- `asgi.py` exists but Django Channels is not installed
- No WebSocket consumers written
- `LiveMap.jsx` uses `setInterval(refetchBerths, 30_000)` — full re-fetch every 30s

### Priority: **P0 for Live Map — this is a safety issue, not a convenience feature**

---

## Gap 4 — The "Staff" Role is Too Broad

### The Problem

The system has one `staff` role. In a real marina:

- A **16-year-old dockhand** sells ice at the fuel dock. They should see: Fuel Dock POS, basic berth availability. They should not see: revenue reports, invoice amounts, member financial records, or booking modification tools.
- A **diesel mechanic** works in the boatyard. They need: Boatyard work orders, Maintenance tasks. They should not be distracted by fuel dock alerts or have the ability to alter a booking.
- A **back-office accountant** needs: Billing, Reports, Members. They have no reason to touch the Boatyard or Staff schedule.

Giving all three the same `staff` role means alerts bleed across irrelevant modules, sensitive financial data is visible to everyone, and the system feels untailored.

### What's Needed

**Module-level permissions** attached to staff accounts. Not necessarily a full custom-roles system — a simpler approach is a set of permission flags per user:

```
can_access_reservations
can_access_billing
can_access_boatyard
can_access_maintenance
can_access_staff_schedule
can_access_reports
can_access_fuel_dock
can_access_members
can_access_documents
```

The marina owner/manager sets these flags per staff member in Settings → Users & Roles. The frontend hides sidebar items the user doesn't have access to. The backend validates the same flags on API calls.

Alternatively: predefined role presets (`dockhand`, `mechanic`, `back_office`, `dock_master`) that map to sensible default flag combinations, with the ability to override individual flags.

### Current State

- Role is a single field on the User model: `owner`, `manager`, `staff`, `boater`
- `ProtectedRoute` gates screens by role but all staff see all staff screens
- No module-level permission flags exist anywhere in the backend or frontend

### Priority: **P1 — needed before the platform is sold to multi-staff marinas**

---

## Gap 5 — Email is Useless in an Emergency

### The Problem

All notifications go via Anymail/Resend (email). SMS is listed as a P2 Nice-to-Have.

Boaters do not check email while driving a boat. In a marina emergency — severe storm warning, burst pipe on Pier C, a vessel with a failing bilge pump — emailing affected boat owners is not a communication strategy. By the time they read it, the boat is underwater.

More practically: a transient boater who arrived last night does not know your marina email address is in their inbox. They are onboard making coffee.

### What's Needed

**A. Twilio (or equivalent) SMS integration**
Each booking/member record should have a mobile number. When a reservation is confirmed, the boater gets an SMS with berth number and arrival instructions — not just an email.

**B. Emergency broadcast by pier**
In the Live Map or a dedicated Emergency panel: select a pier (or all piers), type a message, hit "Broadcast". Every occupied berth on that pier gets an SMS. This needs to be a 3-click operation, not buried in a settings screen.

**C. Automated SMS for key events**
- Booking confirmed → SMS with berth number
- Check-out reminder the morning of departure
- Invoice sent / payment received confirmation
- Storm warning (manual trigger)

### Current State

- Anymail/Resend is configured and working for email
- No SMS provider is configured
- No mobile number field on Booking or Member is confirmed to exist
- No broadcast UI exists

### Priority: **P1 for booking confirmation SMS, P0 for emergency broadcast capability**

---

## Summary Table

| Gap | Real Risk | Backend Gap | Frontend Gap | Priority |
|---|---|---|---|---|
| 1. 7-click booking / auto check-in | Manager bottleneck at peak hours | Celery tasks, auto-transition logic | Self-check-in button in Boater Portal | P0 auto, P1 portal |
| 2. No counter-sale payment | Cannot close an invoice at the desk | **None — backend fully built** | "Record Payment" button on invoice | **P0 — easiest win** |
| 3. 30s map polling | Double-booking risk on a live dock | Django Channels WebSocket consumer | LiveMap WebSocket client | P0 |
| 4. Staff role too broad | Financial data visible to all staff | Module permission flags on User | Sidebar gating, API guards | P1 |
| 5. No SMS | Safety risk in emergencies | Twilio integration, broadcast endpoint | Emergency broadcast UI | P1 (P0 for broadcast) |

---

## Recommended Sprint Order

1. **Record Payment button** (Gap 2) — backend done, frontend is a day's work. Closes the most painful daily friction immediately.
2. **Live Map WebSockets** (Gap 3) — safety issue that should never have been P2. Django Channels install + one consumer + LiveMap client.
3. **Auto check-in/out** (Gap 1) — Celery install + two scheduled tasks. Removes the biggest bottleneck at peak hours.
4. **SMS for booking confirmation + emergency broadcast** (Gap 5) — Twilio account, two SMS triggers, one broadcast endpoint + UI.
5. **Module-level permissions** (Gap 4) — most architectural, needs DB migration + backend guards + frontend gating.
