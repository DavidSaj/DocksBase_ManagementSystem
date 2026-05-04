---
title: Public Booking Engine — Spec 1: Manual Approval Flow
date: 2026-05-04
status: draft
---

# Public Booking Engine — Manual Approval Flow

## Scope

Spec 1 of 3. The complete manual booking journey: a boater submits a request via the public portal → a marina manager reviews, picks a berth, and approves → the boater pays via Stripe → the booking is confirmed and the Half B magic link flow begins.

The instant (auto) flow is out of scope — that is covered by Spec 2 (availability algorithm) and Spec 3 (instant booking UI).

---

## 1. Data Model

### Booking (additions)

| Field | Type | Notes |
|---|---|---|
| `amount` | `DecimalField(8,2, null=True)` | Calculated total stored at approval time |

`guest_name` and `guest_email` already exist on Booking. `STATUS_CHOICES` already includes `pending_approval`, `awaiting_payment`, `confirmed`. `booking_mode` already exists on Marina (`manual_approval` / `auto_tetris`). No other model changes required on Booking.

Status flow for manual mode:
```
pending_approval → awaiting_payment → confirmed
                                    ↘ cancelled (Stripe checkout expired or manager rejected)
```

### Invoice (addition)

| Field | Type | Notes |
|---|---|---|
| `booking` | `ForeignKey(Booking, null=True, blank=True, on_delete=SET_NULL)` | Links Stripe payment back to booking |

The existing `StripeWebhookView` resolves `checkout.session.completed` by Invoice. Adding `booking` FK allows it to confirm the booking and send the magic link without touching the Stripe integration layer.

### ChargeableItem (no change)

Marina-level booking fees (harbour dues, electricity surcharges, etc.) are stored as `ChargeableItem` records with `category='booking_fee'` scoped to the marina. This is the existing source of truth for all pricing — no new model required.

**One migration:** adds `Booking.amount` and `Invoice.booking`. A second migration adds `ChargeableItem.category` choice `'booking_fee'` if it does not already exist.

---

## 2. API Surface

### Public (unauthenticated)

```
POST /api/v1/public/bookings/
```

**Request body:**
```json
{
  "check_in": "2026-07-15",
  "check_out": "2026-07-22",
  "guest_name": "J. Sailor",
  "guest_email": "sailor@example.com",
  "boat_loa": 12.5,
  "boat_beam": 4.2,
  "boat_draft": 1.8
}
```

**Behaviour:**
- Validates all fields present and check_in < check_out.
- Looks up marina from `X-Marina-Slug` or `X-Marina-Domain` header (same tenant resolution as existing public endpoints).
- Creates `Booking` with `status='pending_approval'`, `berth=null`, `booking_type='transient'`.
- Sends two emails: boater confirmation and manager notification.
- Returns `201 { booking_id, message: "Request received. The harbour master will review within 24 hours." }`.

### Manager (existing JWT auth)

```
POST /api/v1/bookings/<id>/approve/    { "berth_id": 42 }
POST /api/v1/bookings/<id>/reject/     { "reason": "No space available for your vessel size." }
```

**Approve behaviour:**
- Validates booking is `pending_approval` and berth belongs to same marina.
- Calculates price: `nights × berth.pricing_tier.unit_price + sum(booking_fee ChargeableItems for marina)`.
- Stores total in `booking.amount`.
- Creates `Invoice` with `booking=booking`, creates Stripe Checkout session via existing `stripe_service`.
- Sets `booking.status = 'awaiting_payment'`, assigns `booking.berth = berth`.
- Emails boater the Stripe checkout link.
- Returns `200 { checkout_url }`.

**Reject behaviour:**
- Sets `booking.status = 'cancelled'`.
- Emails boater with reason.
- Returns `200`.

### Stripe Webhook (extend existing)

`StripeWebhookView` already handles `checkout.session.completed` and `checkout.session.expired`. Extension:

- `checkout.session.completed`: if `invoice.booking` is set, set `booking.status = 'confirmed'`, send magic link email.
- `checkout.session.expired`: if `invoice.booking` is set, set `booking.status = 'cancelled'`.

No new webhook endpoint.

### Manager List (no new endpoint)

The existing reservations API already returns all bookings. `status='pending_approval'` bookings are already included. The frontend filter handles the tab display.

---

## 3. Pricing

Calculated in the approve endpoint, stored in `Booking.amount`:

```python
nights = (booking.check_out - booking.check_in).days
berth_cost = berth.pricing_tier.unit_price * nights
fees = ChargeableItem.objects.filter(
    marina=marina, category='booking_fee'
).aggregate(total=Sum('unit_price'))['total'] or 0
booking.amount = berth_cost + fees
```

All prices in the marina's Stripe account currency. The Invoice line items record `berth_cost` and each fee individually for the boater's receipt.

`booking_fee` ChargeableItems must have `pricing_model='flat'` — they are summed as fixed amounts, not multiplied by nights. If a marina has no `booking_fee` ChargeableItems, the total is the berth nightly rate only — correct default for simple marinas.

---

## 4. Manager UI

### Reservations Screen

A **"Pending"** tab added to the existing Reservations screen. Shows a count badge when `pending_approval` bookings exist. The tab lists pending requests ordered by submission time (oldest first).

Each row: guest name, dates, boat dimensions (LOA × beam × draft), time since submitted.

Clicking a row opens a **side panel** (consistent with existing reservation detail pattern) showing full request details.

### Approve Modal

Triggered from the side panel. Contains:

1. **Berth picker** — dropdown of berths filtered to `length_m >= boat_loa AND max_beam_m >= boat_beam AND max_draft_m >= boat_draft`. Shows berth code + pier label. No date conflict filtering (that is Spec 2). Manager uses their own judgement on availability.
2. **Price preview** — updates dynamically when berth is selected: `[berth rate] × [nights] nights + [fees] = €[total]`.
3. **Confirm & Send Payment Link** button.

### Reject Action

A "Reject" button on the side panel opens a small text field for the reason. Submitting sends the rejection email and removes the request from the Pending tab.

---

## 5. Email Flow

All emails sent via the existing `anymail` integration.

| Trigger | Recipient | Subject | Key content |
|---|---|---|---|
| Request submitted | Boater | "Booking request received — [Marina Name]" | Dates, boat dimensions, "within 24 hours" message |
| Request submitted | All Users with `role='owner'` or `role='manager'` for the marina | "New booking request — [Guest Name]" | Dates, LOA×beam×draft, link to Reservations screen |
| Manager approves | Boater | "Your berth is reserved — complete payment" | Amount, Stripe checkout link, link expires note |
| Manager rejects | Boater | "Booking request update — [Marina Name]" | Reason text |
| Stripe checkout.session.completed | Boater | "Booking confirmed — [Marina Name]" | Confirmation, magic portal link (same as Half B post-payment email) |

The confirmation email is the bridge into the Half B check-in journey. Once sent, the boater follows the existing pre-arrival checklist → arrival → wallet card flow.

---

## 6. Error Handling

- **Invalid dates** (check_in >= check_out, past dates): 400 with field errors.
- **Unknown marina** (bad slug/domain header): 404.
- **Approve on wrong-status booking** (not `pending_approval`): 400 `{"detail": "Booking is not pending approval."}`.
- **Berth from different marina**: 400 `{"detail": "Berth does not belong to this marina."}`.
- **Stripe checkout creation failure**: log error, return 502, do not change booking status (manager can retry).
- **Stripe checkout.session.expired**: booking set to `cancelled`. Boater receives no automated email (the payment link expiry message from Stripe is sufficient). Manager can re-approve if desired.

---

## 7. Frontend Structure

### Portal (public booking form)

```
portal/src/
  screens/
    BookingRequest.jsx       # The public form (dates, boat dims, guest info)
    BookingRequestSent.jsx   # Confirmation screen after submit
```

`BookingRequest.jsx` reads marina info from `TenantContext` (already loaded). On submit it calls `POST /api/v1/public/bookings/` and redirects to `BookingRequestSent.jsx`.

`App.jsx` routing: if no `?token` and no `portal_session_token`, show `BookingRequest.jsx` (for `manual_approval` marinas) or the instant booking funnel (Spec 3, for `auto_tetris` marinas). The marina's `booking_mode` must be added to the `MarinaPublicSerializer` so it is included in the `GET /api/v1/public/marina/` response.

### Management UI (Reservations screen)

```
frontend/src/screens/
  Reservations.jsx            # Add "Pending" tab
frontend/src/components/reservations/
  PendingRequestsTab.jsx      # List of pending_approval bookings
  ApproveModal.jsx            # Berth picker + price preview + confirm
```

`ApproveModal` calls `GET /api/v1/berths/?capable_for=<booking_id>` (a new query param that filters berths by boat dimensions server-side) and `POST /api/v1/bookings/<id>/approve/`.
