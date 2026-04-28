# Operations & Reservations — Design Spec
**Date:** 2026-04-28  
**Scope:** Booking lifecycle, Waitlist/BookingRequest, Fuel Dock queue, New Booking form, Operations page

---

## 1. Core Philosophy

### Object vs. Event
- **Vessel (Object):** Static physical attributes — name, LOA, beam, draft, fuel type. Acts as CRM inventory. Never stores timeline data.
- **Booking (Event):** Links a Vessel to a Berth across a date range. Drives all operational state (who is in, arriving, leaving).

### Status-Driven Operations
The marina's live picture is derived entirely from `Booking.status` + dates — not from the Vessel record.

| Status | Meaning |
|--------|---------|
| `pending` | Booked, arrival date in the future |
| `checked_in` | Boat is physically tied at the dock right now |
| `checked_out` | Boat has left (retained for history/billing) |
| `overstay` | End date passed, status never advanced to checked_out |

---

## 2. Hybrid Booking / Waitlist Logic

### The Problem
Marinas take bookings from known members and from strangers (walk-ins, phone calls, web form). Forcing full profile creation for every stranger creates friction and lost leads.

### The Solution: `BookingRequest` (hybrid entity)

`BookingRequest` is the pre-booking entity that handles both paths.

**Relational path (known customer):**
- Links to existing `Member` FK and `Vessel` FK
- All data auto-filled from existing profiles

**Free-text path (stranger):**
- Stores raw inputs: `guest_name`, `guest_phone`, `guest_email`, `guest_vessel`, `guest_loa`
- No profile creation required to capture the lead

**Conversion action (`convert_to_booking()`):**
When a manager approves a stranger request:
1. Creates a new `Member` from free-text fields
2. Creates a new `Vessel` linked to that member
3. Calculates `amount = berth.price_per_night × nights`
4. Creates a `Booking` and links it back via `BookingRequest.booking` FK
5. Sets `BookingRequest.status = approved`

### `BookingRequest` Schema

```
BookingRequest
  marina          FK → Marina (CASCADE)
  # Relational path
  member          FK → Member (SET_NULL, nullable)
  vessel          FK → Vessel (SET_NULL, nullable)
  # Free-text path
  guest_name      CharField(200, blank=True)
  guest_phone     CharField(50, blank=True)
  guest_email     CharField(200, blank=True)
  guest_vessel    CharField(200, blank=True)
  guest_loa       DecimalField(5,2, nullable)
  # Booking intent
  berth           FK → Berth (PROTECT)
  booking_type    CharField [transient | seasonal]
  start_date      DateField
  end_date        DateField
  notes           TextField(blank=True)
  # Lifecycle
  status          CharField [pending | approved | rejected]
  booking         OneToOneField → Booking (SET_NULL, nullable)
  created_at      DateTimeField(auto_now_add)
```

### Booking Amount Auto-Calculation
On `Booking` create (both direct and via conversion):
```
nights = (check_out - check_in).days
amount = berth.price_per_night * nights
```
Calculated server-side in `perform_create`. Staff cannot set amount manually.

---

## 3. Boater Public Widget (Email OTP Flow)

Staff-facing management portal uses JWT auth (existing). The public widget for boaters is passwordless.

**Flow:**
1. Boater enters email → `POST /api/v1/public/check-email/` → `{exists: bool}`
2. **If no:** Widget shows free-text fields (name, boat name, LOA, etc.) — submits as stranger `BookingRequest`
3. **If yes:** System sends email OTP → `POST /api/v1/public/otp/send/`
4. Boater enters OTP → `POST /api/v1/public/otp/verify/` → returns linked Vessel profile for auto-fill
5. Boater confirms dimensions → submits as relational `BookingRequest`

OTP: 6-digit code, 10-minute TTL, stored server-side (cache or DB). Public endpoints are unauthenticated but rate-limited.

---

## 4. Fuel Dock — Real-Time Queue & POS

### Philosophy
The fuel dock is **not** calendar-based. It is a restaurant-style waitlist + point of sale. Boaters radio in, get added to a live queue, and the dock works through it in real time.

### `FuelDockEntry` Schema

```
FuelDockEntry
  marina              FK → Marina (CASCADE)
  # Relational path
  vessel              FK → Vessel (SET_NULL, nullable)
  member              FK → Member (SET_NULL, nullable)
  # Free-text path
  guest_description   CharField(300, blank=True)  — e.g. "White Sailboat"
  guest_phone         CharField(50, blank=True)
  # Fuel details
  fuel_type           CharField [diesel | petrol | pump_out] (nullable)
  estimated_litres    DecimalField(8,2, nullable)
  actual_litres       DecimalField(8,2, nullable)
  price_per_litre     DecimalField(6,4, nullable)
  total_amount        DecimalField(10,2, nullable)  — computed on completion
  # Queue state
  status              CharField [waiting | next | service | completed]
  fuel_berth          CharField(20, nullable)  — "FD-1", "FD-2"
  # Timestamps
  arrived_at          DateTimeField(auto_now_add)
  service_start       DateTimeField(nullable)
  completed_at        DateTimeField(nullable)
  # Billing outcome
  invoice             FK → Invoice (SET_NULL, nullable)  — member tab billing
  pos_paid            BooleanField(default=False)          — stranger POS
```

### State Machine

```
waiting → next → service → completed
```

On each transition:
- `waiting → next`: stub `notify_sms(phone, "Please approach the fuel dock.")` 
- `service → completed`: trigger billing routing (see below)

### Billing Routing on Completion

**Member path** (vessel/member FK is set):
- `total_amount = actual_litres × price_per_litre`
- Find or create the member's open `Invoice` (type: `fuel`, status: `unpaid`)
- Append fuel charge as a line item
- Set `FuelDockEntry.invoice = invoice`

**Stranger path** (free-text only):
- `total_amount = actual_litres × price_per_litre`
- Set `FuelDockEntry.pos_paid = True`
- Log as revenue — no invoice FK attached

SMS is a pluggable stub (`notify_sms(phone, message)`) — no provider locked in at this stage.

---

## 5. API Endpoints

### Reservations App

```
# BookingRequest
GET    /api/v1/booking-requests/              list (filter: status)
POST   /api/v1/booking-requests/              create (relational or free-text)
GET    /api/v1/booking-requests/<id>/         retrieve
PATCH  /api/v1/booking-requests/<id>/         update status
POST   /api/v1/booking-requests/<id>/convert/ convert stranger → Member + Vessel + Booking

# Booking (updated)
GET    /api/v1/bookings/                      existing + new status filter values
POST   /api/v1/bookings/                      amount now auto-calculated server-side
PATCH  /api/v1/bookings/<id>/                 status transitions
```

### Fuel Dock App

```
GET    /api/v1/fuel-dock/queue/               live queue (excludes completed by default)
POST   /api/v1/fuel-dock/queue/               add entry
PATCH  /api/v1/fuel-dock/queue/<id>/          advance state; completion triggers billing
DELETE /api/v1/fuel-dock/queue/<id>/          remove entry (vessel left without fuelling)
```

### Public (Unauthenticated, Rate-Limited)

```
POST   /api/v1/public/check-email/            {exists: bool}
POST   /api/v1/public/booking-requests/       stranger creates a request
POST   /api/v1/public/otp/send/               send email OTP to known member
POST   /api/v1/public/otp/verify/             verify OTP, return vessel profile
```

---

## 6. Frontend Changes

### Reservations Screen (modified)
- Remove `fuelqueue` tab and `FUEL_QUEUE` mock import
- Wire `waitlist` tab to `GET /api/v1/booking-requests/?status=pending` (new `useBookingRequests` hook)
- "Add to Wait List" → opens booking request form (relational or free-text)
- "Offer Berth" → calls `POST /api/v1/booking-requests/<id>/convert/`
- **New Booking** button → modal with: vessel (searchable select), berth (select), booking type, check-in/check-out, notes; amount shown as read-only server-calculated preview

### New Operations Screen (new page)
- Added to main nav as "Operations"
- First tab: **Fuel Dock**
  - Left panel: fuel berth slots (FD-1, FD-2) showing current `service` entries
  - Right panel: live queue ordered by `arrived_at` (waiting + next entries)
  - "Add to Queue" form: vessel search (optional) OR free-text description + phone + fuel type + estimated litres
  - Each card: "Advance" button (moves state forward)
  - Completion form: enter actual litres + price per litre before confirming → triggers billing
  - "Remove" button for vessels that leave without fuelling
- Future tabs: Launch Queue, Pump-out, Utility Metering, etc.

### New Hooks
- `useBookingRequests` — replaces `WAITLIST` mock
- `useFuelQueue` — replaces `FUEL_QUEUE` mock

---

## 7. What Is Out of Scope (This Phase)

- SMS provider integration (Twilio/Vonage) — stub only
- Email OTP provider integration (Resend/SendGrid) — stub only
- Public boater widget UI — backend endpoints built, widget is a future phase
- Invoice line-item model changes — fuel billing appends to existing Invoice model as-is
