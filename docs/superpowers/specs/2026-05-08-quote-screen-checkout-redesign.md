# QuoteScreen Checkout Redesign — Spec

**Date:** 2026-05-08
**Branch:** feature/stripe-connect-booking-payments

## Overview

Redesign `portal/src/screens/QuoteScreen.jsx` to use a two-column checkout layout with a sandy/cream page background, open form on the left, and a white itemized receipt card on the right. The dark navy hero and `HarbourScene` are untouched.

---

## 1. Page Structure

**Background transition:**
The hero section stays dark navy (`--navy: #0c1f3d`). Below it, the background becomes `--cream-dark: #ede7d8` (the sandy tone from the website). The gradient bridge: `background: linear-gradient(to bottom, #0c1f3d 0, #0c1f3d 40px, #ede7d8 40px)` on the wrapper div, identical to the existing white-section trick but targeting cream-dark instead of white.

**Container:**
`max-width: 960px`, centered, `padding: 0 32px 64px`. No surrounding card.

**Grid:**
Two CSS columns: left `~58%`, right `~42%`, `gap: 40px`. Defined as:
```css
.q-checkout-grid {
  display: grid;
  grid-template-columns: 1fr 380px;
  gap: 40px;
  align-items: start;
}
```

**Mobile (< 768px):**
Single column. Receipt card collapses to a compact summary bar (category name + total) above the form. Full receipt detail is hidden on mobile.

---

## 2. Left Column — Form + Payment

Sits directly on the sandy `#ede7d8` background. No card, no border.

**Inputs:**
`.p-input` overridden in checkout context: `background: #fff`, `border: 1px solid #d6cfc4` (warm, not cold grey). Lifted off the sandy surface.

**Field layout** (unchanged from current):
- Row 1: Full name + Email (2-col grid)
- Row 2: Phone + Vessel name (2-col grid)
- Row 3: ETA time (standalone, `max-width: 200px`)

**Section labels:**
Reuse `.p-section-title` (gold, small-caps, brand font). "Your Details" above the form fields. "Payment" above the Stripe element, with a thin warm `1px solid #d6cfc4` divider separating them.

**Stripe `PaymentElement`:**
```js
appearance: {
  theme: 'stripe',
  variables: {
    colorPrimary: '#b8965a',
    colorBackground: '#ede7d8',
    colorText: '#1a1a1a',
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
    borderRadius: '5px',
  },
}
```
No wrapping border div — the element blends directly into the sandy background.

**Submit button:**
`.p-btn-gold`, full width of left column. Label: `Confirm & Pay €XX.XX`.

**Fine print:**
`font-size: 11px`, `color: rgba(0,0,0,0.35)`, centered below the button. Text: "Your card will be charged on confirmation. The harbour master assigns your exact slip on arrival."

**Error state:**
Red error message (`color: #dc2626`) between Stripe element and submit button, same as current.

---

## 3. Right Column — Receipt Card

**Card shell:**
```css
.q-receipt-card {
  background: #fff;
  border: 1px solid #e0d8cc;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
  position: sticky;
  top: 24px;
}
```

**Contents (top to bottom):**

1. **Eyebrow** — "Booking Summary" in `.p-section-title` style (gold, 10px, uppercase, tracked)
2. **Category name** — Cormorant Garamond, `22px`, `font-weight: 600`, `color: var(--navy)`
3. **Mooring type badge** — small inline badge, gold border, e.g. "Finger Pontoon"
4. **Amenity pills row** — reuses `.p-amenity-pill` but light variant (`.p-cat-card-light` pill style: `background: rgba(12,31,61,0.05)`, `color: var(--navy)`)
5. **Warm divider** — `border-top: 1px solid #e8e0d4`, `margin: 16px 0`
6. **Line items** (each row: label left, value right):
   - "Price per night" → `€XX.00`
   - "× N nights" → `€XX.00` (muted label `rgba(0,0,0,0.45)`, value `color: #1a1a1a`)
   - VAT line: "VAT (X%)" → `€XX.00` — rendered only when `marina?.vat_rate` is non-zero. Omitted silently if absent.
7. **Warm divider**
8. **Total row** — "Total" label (`font-size: 13px`, `font-weight: 600`, `color: rgba(0,0,0,0.5)`) + amount in Cormorant Garamond `28px` gold, right-aligned. Most prominent element.
9. **Dates footer** — `font-size: 12px`, `color: rgba(0,0,0,0.4)`, e.g. "14 Jun → 18 Jun · 4 nights"

---

## 4. Mobile Behaviour

Below `768px`:
- Grid becomes single column
- Receipt card collapses: show only eyebrow + category name + total. Amenity pills, line items, and dates are hidden (`display: none`).
- Compact receipt card appears above the form fields
- Receipt uses `position: static` (not sticky)

---

## 5. CSS Changes

**New classes** added to `portal/src/styles/portal.css`:

```css
/* ── Checkout layout ─────────────────────────────────────────────────── */
.q-checkout-section { ... }   /* sandy background wrapper */
.q-checkout-grid { ... }      /* 2-col grid */
.q-receipt-card { ... }       /* white sticky card */
.q-receipt-eyebrow { ... }    /* gold label */
.q-receipt-cat-name { ... }   /* serif navy heading */
.q-receipt-mooring { ... }    /* mooring badge */
.q-receipt-divider { ... }    /* warm hr */
.q-receipt-line { ... }       /* label+value row */
.q-receipt-label { ... }      /* muted left label */
.q-receipt-value { ... }      /* right-aligned value */
.q-receipt-total { ... }      /* gold serif total */
.q-receipt-dates { ... }      /* small muted dates */
.q-checkout-inputs .p-input { /* warm border override */ }
```

No existing classes are modified — all overrides are scoped to `.q-checkout-*` selectors.

---

## 6. Data Requirements

All data already exists in `QuoteScreen`'s `state` prop:
- `state.selectedCategory.name`, `.mooring_type`, `.amenities`, `.price_per_night`
- `state.checkIn`, `state.checkOut`
- `state.quotedTotal` (pre-calculated total)
- `nights` (derived from check-in/check-out, already calculated in component)

VAT: `marina.vat_rate` passed via the `marina` prop. If `marina?.vat_rate` is falsy or zero, the VAT line is omitted. No backend changes required.

---

## 7. Scope

**In:** `QuoteScreen.jsx`, `portal.css`

**Out:** `FallbackQuoteForm` (no Stripe, no receipt — keep as-is, no layout change), `BookingConfirmed`, `SearchScreen`, `OptionsScreen`, all backend files.
