# Billing & Invoice Module — Design Spec
**Date:** 2026-04-30
**Scope:** Centralized billing hub — Invoice + InvoiceLineItem data model, Stripe Connect integration, Django signal architecture, restaurant POS manual payment flow, PDF generation, sequential invoice numbering.

---

## 1. Core Philosophy

`billing/` is the financial hub of DocksBase. It does not know what a "Reservation" or a "RestaurantOrder" is. It only knows about Invoices and InvoiceLineItems.

All other apps (spokes) call billing to create and finalize invoices. Billing communicates back to spokes via a Django signal (`invoice_paid`). The dependency arrow is strictly one-way — `billing/` never imports from any spoke.

This means adding a new revenue module (fuel dock, winter storage) in the future requires zero new Stripe code: call `billing.create_invoice()`, listen for `invoice_paid`.

---

## 2. Data Model

### 2.1 Marina (extension)

Add two fields to the existing `Marina` model:

```
vat_rate          DecimalField(5,2, default=0.00)
stripe_account_id CharField(255, blank=True)   ← populated during Stripe Connect onboarding
```

One configurable VAT percentage per marina. The billing service snapshots this onto each Invoice at creation time so that future rate changes never alter historical invoices.

### 2.2 Invoice

```
marina            FK → Marina (CASCADE)
member            FK → Member (SET_NULL, nullable)
invoice_number    CharField(20, unique, db_index=True)   e.g. "INV-2026-0042"
status            CharField — draft | open | paid | void
source_type       CharField(50)   e.g. "berth_booking" | "restaurant_order"
source_id         CharField(255, db_index=True, blank=True)   ← stores int or UUID as string
subtotal          DecimalField(10,2, default=0)
vat_rate          DecimalField(5,2)   ← snapshotted from Marina at creation
tax_total         DecimalField(10,2, default=0)
total             DecimalField(10,2, default=0)
stripe_checkout_session_id   CharField(200, blank=True)
stripe_payment_intent_id     CharField(200, blank=True)
due_date          DateField (nullable — restaurant bills have no due date)
paid_at           DateTimeField (nullable)
pdf_document      FileField(upload_to='invoices/', nullable)   → Supabase Storage
created_at        DateTimeField(auto_now_add=True)
```

`member` is nullable — a walk-in restaurant customer has no DocksBase profile.

`source_type` + `source_id` is a soft generic FK. Avoids Django's `GenericForeignKey` complexity while still allowing reverse lookups ("which booking does this invoice belong to?").

`vat_rate` is snapshotted at Invoice creation, not read live. Changing a marina's VAT rate never retroactively alters issued invoices — legally required.

### 2.3 InvoiceLineItem

```
invoice      FK → Invoice (CASCADE, related_name='items')
description  CharField(255)
quantity     DecimalField(8,2)
unit_price   DecimalField(10,2)
total_price  DecimalField(10,2)
```

### 2.4 Payment (manual payments only)

```
invoice      FK → Invoice (CASCADE, related_name='payments')
method       CharField — cash | external_card
amount       DecimalField(10,2)
recorded_by  FK → StaffMember (SET_NULL, nullable)
paid_at      DateTimeField(auto_now_add=True)
```

Stripe payments do not create a `Payment` record — the `stripe_payment_intent_id` on Invoice is the payment proof.

---

## 3. Service Layer (`billing/service.py`)

All spokes interact with billing through these functions only. No spoke ever writes to `Invoice` or `InvoiceLineItem` directly.

```python
create_invoice(marina, member=None, source_type=None, source_id=None, due_date=None) → Invoice
```
- Generates `invoice_number` using `select_for_update()` for race-condition-safe sequential numbering. Pattern: `INV-{YYYY}-{NNNN}`.
- Snapshots `marina.vat_rate` onto the invoice.
- Status starts as `draft`.

```python
add_line_item(invoice, description, quantity, unit_price) → InvoiceLineItem
```
- Asserts `invoice.status == 'draft'`. Items cannot be added to open or paid invoices.
- Computes `total_price = quantity × unit_price`.

```python
finalize_invoice(invoice) → Invoice
```
- Asserts `invoice.status == 'draft'`.
- Computes `subtotal`, `tax_total = subtotal × vat_rate / 100`, `total`.
- Sets `status = 'open'`.

```python
create_stripe_checkout_session(invoice) → str
```
- Asserts `invoice.status == 'open'`.
- Creates a Stripe Checkout Session routed to `invoice.marina.stripe_account_id` (Connect).
- Stores `stripe_checkout_session_id` on invoice.
- Returns the checkout URL for the caller to email or return to frontend.

```python
mark_paid_manual(invoice, method, recorded_by=None) → Invoice
```
- Asserts `invoice.status == 'open'`.
- Asserts `method in ('cash', 'external_card')`.
- Creates `Payment` record.
- Sets `status='paid'`, `paid_at=now()`.
- Fires `invoice_paid` signal.

```python
void_invoice(invoice) → Invoice
```
- Asserts `invoice.status in ('draft', 'open')`. Paid invoices cannot be voided.
- Sets `status='void'`.

**Immutability rule:** Once an invoice moves from `open` to `paid`, no service function will modify its financial fields. If a mistake was made after issuance, the invoice must be voided and a new one created.

---

## 4. Stripe Integration (`billing/stripe_service.py`)

All Stripe SDK calls are isolated in this single file. Nothing outside `billing/` ever imports from `stripe`.

### 4.1 Checkout Session Creation

```python
stripe.checkout.Session.create(
    payment_method_types=['card'],
    line_items=[...],          # one entry per InvoiceLineItem
    mode='payment',
    success_url=f"{FRONTEND_URL}/bookings/{source_id}/confirmed",
    cancel_url=f"{FRONTEND_URL}/bookings/{source_id}",
    metadata={'invoice_id': invoice.id},
    stripe_account=invoice.marina.stripe_account_id,
)
```

`metadata['invoice_id']` is the webhook bridge — it is how the webhook handler looks up the invoice when Stripe calls back.

### 4.2 Webhook Handler

Endpoint: `POST /api/v1/billing/stripe/webhook/` — public (no JWT auth), Stripe signature verified on every request.

**`checkout.session.completed`:**
1. Look up `Invoice` by `event.data.object.metadata['invoice_id']`.
2. Set `stripe_payment_intent_id` from `event.data.object.payment_intent`.
3. Call internal `_mark_paid_stripe(invoice)`: sets `status='paid'`, `paid_at=now()`, fires `invoice_paid` signal.
4. Return `200 OK` to Stripe immediately.
5. Kick off a background thread for slow I/O: `threading.Thread(target=_generate_store_and_email_pdf, args=(invoice.id,)).start()`. The thread: generates PDF via WeasyPrint → uploads to Supabase Storage → sets `invoice.pdf_document` → emails PDF to `invoice.member.email` if member exists.

**Why threading:** Stripe requires a `200 OK` within seconds. WeasyPrint is CPU-heavy and the Supabase upload + SMTP call are network-bound. Running these synchronously risks a Stripe timeout, which triggers retries and duplicate emails. The thread is fire-and-forget — the webhook returns immediately after marking the invoice paid and firing the signal.

**`checkout.session.expired`:**
1. Look up `Invoice` by `event.data.object.metadata['invoice_id']`.
2. Clear `stripe_checkout_session_id` (allow re-generation of a new payment link).
3. Invoice remains `open`. Staff can re-send a new link.

### 4.3 Marina Stripe Connect Onboarding

`Marina.stripe_account_id` stores the marina's Stripe Connect account ID. The marina owner connects their bank account via a standard OAuth flow in their settings page. This field is populated when the flow completes.

---

## 5. Signal Architecture

```python
# billing/signals.py
invoice_paid = django.dispatch.Signal()
# Provides kwargs: invoice (Invoice instance)
```

Fired in exactly two places: `mark_paid_manual()` and `_mark_paid_stripe()`.

### Reservations Receiver (`reservations/receivers.py`)

```python
def on_invoice_paid(sender, invoice, **kwargs):
    if invoice.source_type == 'berth_booking':
        Booking.objects.filter(id=invoice.source_id).update(status='confirmed')
```

Connected in `reservations/apps.py` `ready()`.

### Restaurant

No receiver for MVP. The signal fires (for future extensibility) but nothing reacts operationally.

### Dependency Direction

```
reservations/ ──calls──▶ billing/service.py
restaurant/   ──calls──▶ billing/service.py

billing/ ──fires──▶ invoice_paid signal
                         ▲
              reservations/receivers.py listens
```

`billing/` never imports from `reservations/` or `restaurant/`.

---

## 6. The Two Workflows

### 6.1 Berth Booking (Async Stripe)

```
BookingEngine assigns berth
  → billing.create_invoice(marina, member, source_type='berth_booking', source_id=booking.id, due_date=+14days)
  → billing.add_line_item(invoice, "Berth {code} — {n} nights @ {rate}/night", 1, total_amount)
  → billing.finalize_invoice(invoice)
  → billing.create_stripe_checkout_session(invoice) → checkout_url
  → email checkout_url to boater

Stripe webhook fires →
  → invoice marked paid
  → PDF generated and stored in Supabase Storage
  → PDF emailed to boater
  → invoice_paid signal fires
  → reservations receiver: Booking.status = 'confirmed'
```

**Booking engine agent coordination:** The booking engine must remove its own `StripeWebhookView` and `stripe_session_id` field from `Booking`. Its job ends at calling `billing.create_invoice()` and `billing.create_stripe_checkout_session()`. It hands the checkout URL to the frontend or emails it, then waits for the `invoice_paid` signal to confirm the booking.

### 6.2 Restaurant POS (Manual Payment)

```
Waiter taps "Checkout" on an Order
  POST /api/v1/billing/invoices/from-order/  { order_id }
  → billing.create_invoice(marina, member=None, source_type='restaurant_order', source_id=order.id)
  → for each OrderItem: billing.add_line_item(invoice, item.name, item.quantity, item.price)
  → billing.finalize_invoice(invoice)
  → returns { invoice_id, total, line_items } to frontend

Frontend displays bill total with two buttons: "Cash" | "External Card"
  PATCH /api/v1/billing/invoices/{id}/mark-paid/  { method: 'cash' | 'external_card' }
  → billing.mark_paid_manual(invoice, method)
  → invoice_paid signal fires (no-op for restaurant in MVP)
  → returns invoice with status='paid'

Frontend renders printable HTML receipt (no PDF stored, no email sent)
```

---

## 7. PDF Generation (`billing/pdf_service.py`)

WeasyPrint renders a Django HTML template to a PDF binary. The template is dual-mode:

```
billing/templates/billing/invoice_pdf.html
  invoice.status == 'paid'  → heading: "RECEIPT", PAID stamp, shows paid_at
  invoice.status == 'open'  → heading: "INVOICE", shows due_date, payment instructions
```

Both modes show: `invoice_number`, marina name/address/VAT number, member name/address, line items table, subtotal, VAT rate + amount, total.

PDF is generated in a background thread spawned by the webhook handler (`threading.Thread`) — no Celery required for MVP. The webhook returns `200 OK` to Stripe before the thread starts. The thread uploads to Supabase Storage at `invoices/{marina_id}/{invoice_number}.pdf` and saves the path to `invoice.pdf_document`.

---

## 8. API Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/api/v1/billing/invoices/from-booking/` | JWT | Booking engine creates berth invoice |
| `POST` | `/api/v1/billing/invoices/from-order/` | JWT | Restaurant POS creates order invoice |
| `GET` | `/api/v1/billing/invoices/` | JWT | Marina staff list all invoices |
| `GET` | `/api/v1/billing/invoices/{id}/` | JWT | Invoice detail |
| `PATCH` | `/api/v1/billing/invoices/{id}/mark-paid/` | JWT | Manual payment marking |
| `GET` | `/api/v1/billing/invoices/{id}/pdf/` | JWT | Download stored PDF |
| `GET` | `/api/v1/billing/invoices/{id}/receipt/` | JWT | Printable HTML receipt |
| `POST` | `/api/v1/billing/stripe/webhook/` | PUBLIC | Stripe webhook (signature verified) |

---

## 9. Decision Log

| Decision | Choice | Reason |
|----------|--------|--------|
| Architecture pattern | Hybrid: direct calls in, signals out | Explicit financial writes, decoupled notifications |
| Scope | Berth bookings + restaurant POS | Two highest-value revenue streams; other modules plug in later |
| Restaurant payment | Manual marking (cash / external card) | Zero hardware barrier to adoption; Stripe Terminal is Phase 3 |
| Document output | HTML for restaurant, PDF+email for berth | Restaurant needs quick print; berth boater needs formal document |
| Tax | Single configurable VAT rate per marina | Sufficient for MVP; per-line-item rates deferred |
| Stripe placement | Centralized in `billing/` only | Single webhook, single source of financial truth |
| PDF generation | WeasyPrint in background thread | Stripe requires 200 OK within seconds; sync PDF/upload/email risks timeout + duplicate retries |
| source_id type | CharField(255) not PositiveIntegerField | Future-proof for UUID PKs on any spoke model |
| Invoice numbering | `select_for_update()` sequential | Race-condition-safe, gapless — legally required |
| VAT rate | Snapshotted onto Invoice at creation | Future rate changes must not alter historical invoices |

---

## 10. Out of Scope (Deferred)

- QR Code table checkout (Phase 2 restaurant Stripe flow)
- Stripe Terminal hardware integration (Phase 3)
- Per-line-item VAT rates (upgrade from single marina rate)
- Celery async PDF generation
- Boatyard, fuel dock, maintenance spoke integrations
- Recurring/subscription invoices for seasonal berth holders
- Refund flows
