# Portal Booking Flow Redesign — Spec

**Date:** 2026-05-07
**Branch:** feature/stripe-connect-booking-payments

## Overview

Redesign the standalone `/portal` booking flow to match the webmock dark navy/gold design language, introduce a `BerthCategory` model so marinas can offer named tiers with amenities (shore power, water, etc.), and clean up the management app of the wrongly-added portal CSS and `BoaterPortal` screen.

## Scope

- **In:** portal booking flow (Search → Options → Guest Details + Payment → Confirmation)
- **Out:** post-booking dashboard (BookingDashboard, ChecklistView, CountdownView, ArrivalView, WalletCard) — untouched
- **Out:** map editor, billing, other management screens

---

## 1. Data Model

### New: `BerthCategory` (`berths/models.py`)

```python
class BerthCategory(models.Model):
    MOORING_CHOICES = [
        ('finger',       'Finger Pontoon'),
        ('alongside',    'Alongside'),
        ('stern_to',     'Stern-to'),
        ('mooring_ball', 'Mooring Ball'),
    ]
    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='berth_categories')
    name          = models.CharField(max_length=100)          # "Standard Slip", "Premium Slip"
    description   = models.TextField(blank=True)
    mooring_type  = models.CharField(max_length=20, choices=MOORING_CHOICES, default='finger')
    amenities     = models.JSONField(default=list)            # ["power_30a", "water", "wifi"]
    pricing_tier  = models.ForeignKey('billing.ChargeableItem', on_delete=models.PROTECT,
                                      limit_choices_to={'category': 'berth'},
                                      null=True, blank=True, related_name='berth_categories')
    sort_order    = models.IntegerField(default=0)
    is_active     = models.BooleanField(default=True)

    class Meta:
        ordering = ['sort_order', 'name']
        unique_together = ('marina', 'name')
```

**Amenity slug vocabulary** (fixed, not user-defined):
`power_30a`, `power_50a`, `water`, `wifi`, `fuel_nearby`, `pump_out`

**Validation:** Add a `clean()` method on `BerthCategory` and a DRF serializer `validate_amenities()` that rejects any slug not in the vocabulary above. This prevents typos (`"Wifi "`, `"power_30"`) from reaching the portal where they would silently fail to match icon mappings.

### Modified: `Berth` model

Add one nullable FK:
```python
category = models.ForeignKey(BerthCategory, on_delete=models.SET_NULL,
                             null=True, blank=True, related_name='berths')
```

Berths without a category continue working — they just never appear in the portal options step.

---

## 2. Backend API

### New endpoint: `GET /public/bookings/berth-categories/`

Query params: `check_in`, `check_out`, `boat_loa`, `boat_beam` (optional), `boat_draft` (optional)

Logic:
1. Resolve marina from `X-Marina-Slug` header.
2. Start from `BerthCategory` — filter `is_active=True` and `pricing_tier__isnull=False`. This strict filter prevents categories missing a pricing tier from reaching the Stripe payment step (which would receive `0.00` and be rejected).
3. For each active category, find its berths where `berth_class='standard'` and dimensions fit the boat.
4. Use a Django `Exists` subquery to exclude berths with overlapping confirmed/pending bookings for the requested dates. Index `Booking.check_in` and `Booking.check_out` to keep this fast at scale.
5. Annotate each category with `available_count` of berths passing steps 3–4.
6. Exclude categories where `available_count = 0`.
7. Return ordered by `sort_order`.

Response shape:
```json
[
  {
    "id": 1,
    "name": "Standard Slip",
    "description": "Water hookup, no electricity.",
    "mooring_type": "finger",
    "amenities": ["water"],
    "price_per_night": "40.00",
    "available_count": 6
  },
  {
    "id": 2,
    "name": "Premium Slip",
    "description": "Water + 30A shore power.",
    "mooring_type": "finger",
    "amenities": ["power_30a", "water"],
    "price_per_night": "55.00",
    "available_count": 3
  }
]
```

### New endpoint: `POST /public/bookings/intent/`

Called the moment the boater clicks "Select →" on a category card (Step 2), before Step 3 mounts. This is required because the Stripe `PaymentElement` needs a `client_secret` to render — it cannot be generated earlier since the total is unknown until a category is chosen.

Request body: `{ berth_category_id, check_in, check_out, boat_loa, boat_beam, boat_draft }`

Logic:
1. Validate the category exists, is active, has a pricing tier.
2. Calculate `total = price_per_night × nights`.
3. Create a Stripe `PaymentIntent` for `total` (marina's Connect account, application fee deducted).
4. Return `{ client_secret, total, price_per_night, nights }`.

Step 3 receives this payload as props and mounts `<PaymentElement>` with the `client_secret`. The `PaymentIntent` ID is stored in component state for the final booking creation call.

### Modified: `POST /public/bookings/request/`

Add optional field `berth_category_id: int`. When provided, the auto-tetris assignment is constrained to berths in that category only. Also accepts `payment_intent_id` so the backend can confirm the intent was paid before creating the booking.

### Fallback behaviour

If the marina has zero active BerthCategories, the portal falls back to the existing `GET /public/bookings/available-berths/` endpoint. Existing marinas require no action.

---

## 3. Management App Cleanup

Files to **delete**:
- `frontend/src/screens/BoaterPortal.jsx`
- `frontend/src/components/portal/PaymentModal.jsx`

Changes to `frontend/src/styles/app.css`:
- Remove the entire `/* ── Boater Portal ──` block: animations `fadeSlideUp`, `logoPulse`; classes `portal-shell`, `portal-header`, `portal-header-left`, `portal-logo-wrap`, `portal-logo-ring`, `portal-marina-name`, `portal-boater-name`, `portal-signout`, `portal-tabs`, `portal-content`, `portal-tab-content`, `portal-list`, all dark `portal-*-card` variants, `portal-input`.
- Keep: `login-*` classes (used by Login.jsx), `abtn`/`abtn-gold` (used by Settings.jsx Stripe card), `@keyframes spin` (used by Settings.jsx spinner).

Changes to `frontend/src/App.jsx`:
- Remove `BoaterPortal` import and `/portal` route.

Changes to `frontend/src/screens/Login.jsx`:
- In `handleSubmit`, after `signIn(user)`, if `user.role === 'boater'` do `window.location.href = import.meta.env.VITE_PORTAL_URL` instead of `navigate(ROLE_HOME[user.role])`. This hard-redirects boaters out of the management app entirely.

---

## 4. Portal Booking Flow (UI)

### Design tokens

New file `portal/src/styles/portal.css` with CSS custom properties matching the webmock:
```css
:root {
  --navy:  #0c1f3d;
  --navy2: #162d52;
  --gold:  #b8965a;
  --gold2: #d4b07a;
  --cream: #f5f0e6;
  --font:       'IBM Plex Sans', system-ui, sans-serif;
  --font-serif: 'Cormorant Garamond', Georgia, serif;
  --font-brand: 'Jost', system-ui, sans-serif;
}
```

Loaded in `portal/src/main.jsx` alongside the existing global reset.

### Step 1 — SearchScreen (redesigned)

Dark navy full-page. Marina name as serif `h1`. Subtitle "Find a berth." Form fields use dark inputs. Gold "Search" button. Same API call and field set as current.

### Step 2 — OptionsScreen (new, conditional)

**Shown only when** the `/public/bookings/berth-categories/` endpoint returns ≥ 1 result.

**Skipped when** the endpoint returns empty — the wizard moves directly to Step 3 with the cheapest available berth auto-selected (existing fallback behaviour).

Layout: responsive grid of cards (2-up on desktop, 1-up on mobile). Each card:
- Category name (serif heading)
- Mooring type badge
- Description text
- Amenity pills with icons: ⚡ 30A Power, ⚡ 50A Power, 💧 Water, 📶 WiFi, ⛽ Fuel Nearby, 🔄 Pump-out
- Price per night (gold, prominent)
- Available count ("4 available")
- Gold "Select →" button

### Step 3 — QuoteScreen (redesigned)

Summary bar at top: selected category name, dates, nights, total price (gold).

Two-column layout on desktop:
- Left: guest details form — Full name, Email, Phone, Vessel name, ETA (time)
- Right: Stripe PaymentElement (embedded, dark theme)

Single "Confirm & Pay →" gold button below. On success: navigate to `/{slug}/booking/{id}/confirmed`.

`BookingConfirmed` and `BookingRequestSent` screens: apply same dark navy CSS, no functional changes.

### BookingWizard orchestration

```
screen states: 'search' | 'options' | 'quote' | 'sent'
```

After search API call:
- If berth-categories returns results → go to 'options'
- Else if available-berths returns results → go to 'quote' (with auto-selected berth)
- Else if alternatives → go to 'alternatives' (existing screen, keep as-is)
- Else → show no-availability message

---

## 5. Service Catalog — Berth Categories UI

A "Berth Categories" section added to `ServiceCatalogScreen.jsx` above the existing berth pricing items.

**List view:** table with columns — Name, Mooring Type, Amenities (pills), Pricing Tier, Active toggle, Edit button. "+ Add category" button top-right.

**Add/Edit panel** (slide-in, same pattern as rest of Service Catalog):
- Name (text, required)
- Description (textarea, max 120 chars)
- Mooring type (select)
- Amenities (6 checkboxes with icons)
- Pricing tier (select — filtered to ChargeableItems with category='berth')
- Sort order (number input)
- Active toggle
- Save / Delete buttons

API: REST endpoints on `/api/v1/berths/categories/` (list, create, update, delete) — marina-scoped, requires manager/owner auth.

---

## 6. Database Indexes

Add to a migration's `AlterField` / `AddIndex` block:

```python
models.Index(fields=['check_in', 'check_out'], name='booking_dates_idx')
```

on the `Reservation` / `Booking` model (whichever holds check-in/check-out). This ensures the `Exists` subquery in the berth-categories endpoint does not do a full-table scan as booking volume grows.

---

## Cleanup of old portal redesign spec

The file `docs/superpowers/specs/2026-05-07-portal-redesign-stripe-embedded.md` describes the wrongly-scoped work done by a previous AI session. It is superseded by this spec and should be deleted.
