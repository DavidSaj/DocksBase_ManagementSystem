# QuoteScreen Checkout Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `QuoteScreen` to a two-column checkout layout — sandy/cream background, open form on the left, white itemized receipt card on the right.

**Architecture:** Pure frontend change. New CSS classes (`.q-checkout-*`) are added to `portal.css`. A `ReceiptCard` function is added to `QuoteScreen.jsx`. The existing hero, `HarbourScene`, `FallbackQuoteForm`, and all backend calls are untouched. `stripeOptions` appearance is updated to blend into the sandy background.

**Tech Stack:** React 19, `@stripe/react-stripe-js`, custom CSS (no Tailwind — follows existing `portal.css` pattern), Vitest + Testing Library

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `portal/src/styles/portal.css` | Modify | Add all `.q-checkout-*` layout and receipt-card CSS classes |
| `portal/src/screens/QuoteScreen.jsx` | Modify | Add `ReceiptCard` function; restructure layout to sandy bg + 2-col grid |
| `portal/src/screens/QuoteScreen.test.jsx` | Modify | Add receipt card rendering tests (TDD) |

---

## Task 1: CSS — Checkout Layout Classes

**Files:**
- Modify: `portal/src/styles/portal.css`

- [ ] **Step 1.1: Add checkout CSS after the summary bar block**

In `portal/src/styles/portal.css`, find the comment `/* ── Error / info banners` and insert the following block immediately before it:

```css
/* ── Checkout page (QuoteScreen two-column layout) ───────────────────── */
.q-checkout-section {
  position: relative;
  background: linear-gradient(to bottom, #0c1f3d 0, #0c1f3d 40px, #ede7d8 40px);
}

.q-checkout-inner {
  max-width: 960px;
  margin: -40px auto 0;
  padding: 0 32px 64px;
  position: relative;
  z-index: 2;
}

.q-checkout-grid {
  display: grid;
  grid-template-columns: 1fr 380px;
  gap: 40px;
  align-items: start;
}

/* Warm input override — lifted off sandy surface */
.q-checkout-inputs .p-input {
  background: #fff;
  border-color: #d6cfc4;
}
.q-checkout-inputs .p-input:focus {
  border-color: var(--gold);
}

.q-checkout-divider {
  border: none;
  border-top: 1px solid #d6cfc4;
  margin: 20px 0;
}

/* ── Receipt card ────────────────────────────────────────────────────── */
.q-receipt-card {
  background: #fff;
  border: 1px solid #e0d8cc;
  border-radius: 12px;
  padding: 24px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.08);
  position: sticky;
  top: 24px;
}

.q-receipt-eyebrow {
  font-family: var(--font-brand);
  font-size: 10px;
  letter-spacing: 2.5px;
  text-transform: uppercase;
  color: var(--gold);
  margin-bottom: 12px;
}

.q-receipt-cat-name {
  font-family: var(--font-serif);
  font-size: 22px;
  font-weight: 600;
  color: var(--navy);
  margin-bottom: 6px;
}

.q-receipt-mooring {
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 1px;
  text-transform: uppercase;
  color: var(--gold);
  border: 1px solid rgba(184,150,90,0.3);
  border-radius: 3px;
  padding: 2px 7px;
  margin-bottom: 10px;
}

.q-receipt-amenities {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 4px;
}

.q-receipt-amenity {
  font-size: 11px;
  color: var(--navy);
  background: rgba(12,31,61,0.05);
  border: 1px solid rgba(12,31,61,0.12);
  border-radius: 20px;
  padding: 3px 9px;
}

.q-receipt-divider {
  border: none;
  border-top: 1px solid #e8e0d4;
  margin: 16px 0;
}

.q-receipt-line {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 8px;
}

.q-receipt-line-label {
  font-size: 13px;
  color: rgba(0,0,0,0.45);
}

.q-receipt-line-value {
  font-size: 13px;
  color: #1a1a1a;
  font-weight: 500;
}

.q-receipt-total-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-top: 4px;
}

.q-receipt-total-label {
  font-size: 13px;
  font-weight: 600;
  color: rgba(0,0,0,0.5);
}

.q-receipt-total-amount {
  font-family: var(--font-serif);
  font-size: 28px;
  color: var(--gold);
  line-height: 1;
}

.q-receipt-dates {
  font-size: 12px;
  color: rgba(0,0,0,0.4);
  margin-top: 12px;
}

@media (max-width: 767px) {
  .q-checkout-grid { grid-template-columns: 1fr; }
  .q-receipt-card  { position: static; }
  .q-receipt-amenities,
  .q-receipt-mooring,
  .q-receipt-line,
  .q-receipt-dates { display: none; }
}
```

- [ ] **Step 1.2: Start the dev server and verify no CSS errors**

```bash
cd portal && npm run dev
```

Open the browser. No console errors. The existing QuoteScreen still renders (layout will be fixed in Task 3).

- [ ] **Step 1.3: Commit**

```bash
git add portal/src/styles/portal.css
git commit -m "feat: add .q-checkout-* CSS classes for two-column checkout layout"
```

---

## Task 2: TDD — ReceiptCard Tests

**Files:**
- Modify: `portal/src/screens/QuoteScreen.test.jsx`

- [ ] **Step 2.1: Add Stripe mocks and receipt-card test state at the top of the test file**

Open `portal/src/screens/QuoteScreen.test.jsx`. After the existing imports (line 5), add:

```js
vi.mock('@stripe/react-stripe-js', () => ({
  Elements:       ({ children }) => <div>{children}</div>,
  PaymentElement: () => <div data-testid="stripe-element" />,
  useStripe:      () => null,
  useElements:    () => null,
}));

vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(() => Promise.resolve(null)),
}));
```

After the existing `state` constant (line 22), add:

```js
const stateWithCategory = {
  checkIn: '2027-07-10',
  checkOut: '2027-07-13',
  boatLoa: '12.5',
  boatBeam: '4.2',
  boatDraft: '',
  quotedTotal: 165,   // 55.00 * 3 nights
  selectedCategory: {
    id: 1,
    name: 'Premium Slip',
    mooring_type: 'finger',
    amenities: ['power_30a', 'water'],
    price_per_night: '55.00',
  },
};
```

- [ ] **Step 2.2: Write the failing receipt card tests**

Add a new `describe` block at the end of `QuoteScreen.test.jsx`:

```js
describe('ReceiptCard', () => {
  beforeEach(() => {
    api.post = vi.fn().mockResolvedValue({ data: { client_secret: 'pi_test_secret' } });
  });

  it('shows category name', () => {
    render(<QuoteScreen state={stateWithCategory} navigate={navigate} marina={marina} />);
    expect(screen.getByText('Premium Slip')).toBeInTheDocument();
  });

  it('shows mooring type label', () => {
    render(<QuoteScreen state={stateWithCategory} navigate={navigate} marina={marina} />);
    expect(screen.getByText('Finger Pontoon')).toBeInTheDocument();
  });

  it('shows price per night', () => {
    render(<QuoteScreen state={stateWithCategory} navigate={navigate} marina={marina} />);
    expect(screen.getByText('€55.00')).toBeInTheDocument();
  });

  it('shows nights line', () => {
    render(<QuoteScreen state={stateWithCategory} navigate={navigate} marina={marina} />);
    expect(screen.getByText('× 3 nights')).toBeInTheDocument();
  });

  it('shows total amount', () => {
    render(<QuoteScreen state={stateWithCategory} navigate={navigate} marina={marina} />);
    expect(screen.getByText('€165.00')).toBeInTheDocument();
  });

  it('omits VAT line when marina has no vat_rate', () => {
    render(<QuoteScreen state={stateWithCategory} navigate={navigate} marina={marina} />);
    expect(screen.queryByText(/VAT/i)).not.toBeInTheDocument();
  });

  it('shows VAT line when marina.vat_rate is set', () => {
    render(
      <QuoteScreen state={stateWithCategory} navigate={navigate}
        marina={{ ...marina, vat_rate: '8.00' }} />
    );
    expect(screen.getByText(/VAT \(8%\)/i)).toBeInTheDocument();
    expect(screen.getByText('€13.20')).toBeInTheDocument(); // 165 (subtotal) * 0.08
  });

  it('shows amenity pills', () => {
    render(<QuoteScreen state={stateWithCategory} navigate={navigate} marina={marina} />);
    expect(screen.getByText(/30A Power/i)).toBeInTheDocument();
    expect(screen.getByText(/Water/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2.3: Run the new tests to confirm they fail**

```bash
cd portal && npm test -- QuoteScreen
```

Expected: the 8 new `ReceiptCard` tests fail with errors like "Unable to find element with text: Premium Slip". The existing 5 `QuoteScreen` tests still pass.

- [ ] **Step 2.4: Add `ReceiptCard` and constants to QuoteScreen.jsx**

In `portal/src/screens/QuoteScreen.jsx`, after the existing `formatDate` function (line 11), add:

```jsx
const AMENITY_LABELS = {
  power_30a:   '⚡ 30A Power',
  power_50a:   '⚡ 50A Power',
  water:       '💧 Water',
  wifi:        '📶 WiFi',
  fuel_nearby: '⛽ Fuel Nearby',
  pump_out:    '🔄 Pump-out',
};

const MOORING_LABELS = {
  finger:       'Finger Pontoon',
  alongside:    'Alongside',
  stern_to:     'Stern-to',
  mooring_ball: 'Mooring Ball',
};

function ReceiptCard({ category, nights, total, checkIn, checkOut, marina }) {
  const pricePerNight = parseFloat(category.price_per_night);
  const subtotal      = pricePerNight * nights;
  const vatRate       = marina?.vat_rate ? parseFloat(marina.vat_rate) : 0;
  const vatAmount     = vatRate > 0 ? subtotal * vatRate / 100 : 0;
  const fmt           = n => `€${n.toFixed(2)}`;

  return (
    <div className="q-receipt-card">
      <div className="q-receipt-eyebrow">Booking Summary</div>
      <div className="q-receipt-cat-name">{category.name}</div>
      {category.mooring_type && (
        <div className="q-receipt-mooring">
          {MOORING_LABELS[category.mooring_type] || category.mooring_type}
        </div>
      )}
      {category.amenities?.length > 0 && (
        <div className="q-receipt-amenities">
          {category.amenities.map(a => (
            <span key={a} className="q-receipt-amenity">
              {AMENITY_LABELS[a] || a}
            </span>
          ))}
        </div>
      )}

      <hr className="q-receipt-divider" />

      <div className="q-receipt-line">
        <span className="q-receipt-line-label">Price per night</span>
        <span className="q-receipt-line-value">{fmt(pricePerNight)}</span>
      </div>
      <div className="q-receipt-line">
        <span className="q-receipt-line-label">× {nights} night{nights !== 1 ? 's' : ''}</span>
        <span className="q-receipt-line-value">{fmt(subtotal)}</span>
      </div>
      {vatRate > 0 && (
        <div className="q-receipt-line">
          <span className="q-receipt-line-label">VAT ({vatRate}%)</span>
          <span className="q-receipt-line-value">{fmt(vatAmount)}</span>
        </div>
      )}

      <hr className="q-receipt-divider" />

      <div className="q-receipt-total-row">
        <span className="q-receipt-total-label">Total</span>
        <span className="q-receipt-total-amount">{fmt(total)}</span>
      </div>

      <div className="q-receipt-dates">
        {formatDate(checkIn)} → {formatDate(checkOut)} · {nights} night{nights !== 1 ? 's' : ''}
      </div>
    </div>
  );
}
```

- [ ] **Step 2.5: Run the tests to confirm they pass**

```bash
cd portal && npm test -- QuoteScreen
```

Expected: all 13 tests pass (5 existing + 8 new).

- [ ] **Step 2.6: Commit**

```bash
git add portal/src/screens/QuoteScreen.jsx portal/src/screens/QuoteScreen.test.jsx
git commit -m "feat: add ReceiptCard component with itemized line items and VAT logic (TDD)"
```

---

## Task 3: QuoteScreen Layout Restructure

**Files:**
- Modify: `portal/src/screens/QuoteScreen.jsx`

This task restructures the layout of `QuoteScreen`. It does not touch `PayForm`, `FallbackQuoteForm`, or `ReceiptCard` internals.

- [ ] **Step 3.1: Update `stripeOptions` appearance in `QuoteScreen`**

In `QuoteScreen.jsx`, find the `stripeOptions` object (currently around line 129). Replace it with:

```js
const stripeOptions = {
  clientSecret,
  appearance: {
    theme: 'stripe',
    variables: {
      colorPrimary:     '#b8965a',
      colorBackground:  '#ede7d8',
      colorText:        '#1a1a1a',
      fontFamily:       'IBM Plex Sans, system-ui, sans-serif',
      borderRadius:     '5px',
    },
  },
};
```

- [ ] **Step 3.2: Remove the border wrapper around `PaymentElement` in `PayForm`**

In `PayForm`, find:

```jsx
      <div style={{ border: '1px solid #e8e8e8', borderRadius: 8, padding: 20, marginBottom: 20 }}>
        <PaymentElement options={{ layout: 'tabs' }} />
      </div>
```

Replace with:

```jsx
      <div style={{ marginBottom: 20 }}>
        <PaymentElement options={{ layout: 'tabs' }} />
      </div>
```

- [ ] **Step 3.3: Update section titles in `PayForm` to use `.p-section-title` class**

In `PayForm`, find:

```jsx
      <div className="p-section-title" style={{ color: 'var(--navy)', opacity: 0.6 }}>Your details</div>
```

Replace with:

```jsx
      <div className="p-section-title">Your details</div>
```

Then find:

```jsx
      <div className="p-section-title" style={{ marginTop: 24, color: 'var(--navy)', opacity: 0.6 }}>Payment</div>
```

Replace with:

```jsx
      <hr className="q-checkout-divider" />
      <div className="p-section-title">Payment</div>
```

- [ ] **Step 3.4: Replace the white section with the sandy two-column layout in `QuoteScreen`**

In `QuoteScreen`, find the entire white section block:

```jsx
      {/* White section */}
      <div style={{ position: 'relative', background: 'linear-gradient(to bottom, #0c1f3d 0, #0c1f3d 40px, #fff 40px)' }}>
        <WaveLines />
        <div className="p-form-card">
          <div className="p-form-card-inner">

            {/* Summary bar */}
            <div style={{
              background: '#f7f7f7', border: '1px solid #ebebeb', borderRadius: 8,
              padding: '14px 20px', marginBottom: 24,
              display: 'flex', alignItems: 'center', gap: 24, flexWrap: 'wrap',
            }}>
              <div>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '1px', color: 'rgba(0,0,0,0.4)', marginBottom: 2 }}>Category</div>
                <div style={{ fontSize: 14, color: '#1a1a1a', fontWeight: 500 }}>{state.selectedCategory?.name ?? 'Best available berth'}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '1px', color: 'rgba(0,0,0,0.4)', marginBottom: 2 }}>Dates</div>
                <div style={{ fontSize: 14, color: '#1a1a1a', fontWeight: 500 }}>{formatDate(state.checkIn)} – {formatDate(state.checkOut)}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '1px', color: 'rgba(0,0,0,0.4)', marginBottom: 2 }}>Nights</div>
                <div style={{ fontSize: 14, color: '#1a1a1a', fontWeight: 500 }}>{nights}</div>
              </div>
              <div style={{ marginLeft: 'auto', fontFamily: 'var(--font-serif)', fontSize: 24, color: 'var(--gold)' }}>
                €{state.quotedTotal?.toFixed(2)}
              </div>
            </div>

            {intentError && <p style={{ fontSize: 13, color: '#dc2626', marginBottom: 12 }}>{intentError}</p>}

            {state.selectedCategory && clientSecret && (
              <Elements stripe={stripePromise} options={stripeOptions}>
                <PayForm state={state} navigate={navigate} onSuccess={handleSuccess} />
              </Elements>
            )}

            {state.selectedCategory && !clientSecret && !intentError && (
              <p style={{ color: 'rgba(0,0,0,0.45)', fontSize: 13 }}>Preparing payment…</p>
            )}

            {!state.selectedCategory && (
              <FallbackQuoteForm state={state} navigate={navigate} nights={nights} />
            )}
          </div>
        </div>

        <p className="p-powered">Powered by DocksBase</p>
      </div>
```

Replace it with:

```jsx
      {/* Sandy checkout section */}
      <div className="q-checkout-section">
        <WaveLines />
        <div className="q-checkout-inner">
          <div className="q-checkout-grid">

            {/* Left column — form + payment */}
            <div className="q-checkout-inputs">
              {intentError && <p className="p-error">{intentError}</p>}

              {state.selectedCategory && clientSecret && (
                <Elements stripe={stripePromise} options={stripeOptions}>
                  <PayForm state={state} navigate={navigate} onSuccess={handleSuccess} />
                </Elements>
              )}

              {state.selectedCategory && !clientSecret && !intentError && (
                <p style={{ color: 'rgba(0,0,0,0.55)', fontSize: 13 }}>Preparing payment…</p>
              )}

              {!state.selectedCategory && (
                <FallbackQuoteForm state={state} navigate={navigate} nights={nights} />
              )}
            </div>

            {/* Right column — receipt card (only when a category is selected) */}
            {state.selectedCategory && (
              <ReceiptCard
                category={state.selectedCategory}
                nights={nights}
                total={state.quotedTotal}
                checkIn={state.checkIn}
                checkOut={state.checkOut}
                marina={marina}
              />
            )}
          </div>
        </div>

        <p className="p-powered">Powered by DocksBase</p>
      </div>
```

- [ ] **Step 3.5: Run the full test suite**

```bash
cd portal && npm test -- QuoteScreen
```

Expected: all 13 tests pass. No regressions.

- [ ] **Step 3.6: Verify in the browser**

Start the dev server:

```bash
cd portal && npm run dev
```

Navigate to the portal. Go through Search → Options → click "Select →" on a category. On the QuoteScreen:

1. Hero section is unchanged (dark navy, "Review & Pay." heading, dates subtitle)
2. Below the hero: sandy/cream (`#ede7d8`) background — no white card
3. Left column: "Your Details" gold label, form inputs with white backgrounds on sandy surface, gold focus border; divider; "Payment" gold label; Stripe PaymentElement blends into sandy bg (no border box)
4. Right column: white card with warm border; "Booking Summary" gold eyebrow; category name in serif navy; mooring badge; amenity pills; itemized line items; bold gold total; dates footer
5. Card is sticky — stays visible when scrolling the form
6. At `< 768px`: stacks vertically, receipt card loses amenity/line details and shows only category + total

- [ ] **Step 3.7: Commit**

```bash
git add portal/src/screens/QuoteScreen.jsx
git commit -m "feat: QuoteScreen two-column checkout — sandy bg, open form left, white receipt card right"
```
