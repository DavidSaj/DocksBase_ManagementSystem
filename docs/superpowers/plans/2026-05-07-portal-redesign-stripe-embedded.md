# Boater Portal Redesign + Embedded Stripe Payment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the boater portal and login with a dark navy maritime theme, add subtle entrance animations, and replace the external Stripe Checkout redirect with an embedded PaymentElement modal.

**Architecture:** Backend gains `PortalInvoicePayView` (creates PaymentIntent on the marina's Connect account) and a `payment_intent.succeeded` webhook branch in `StripeConnectWebhookView`. Frontend installs `@stripe/react-stripe-js`, replaces the portal's light CSS with dark navy/gold variants, and mounts Stripe's `PaymentElement` inside a styled modal. 3DS/SCA redirects are handled by a `useEffect` in `BoaterPortal` that reads `?redirect_status=succeeded` on mount.

**Tech Stack:** Django REST Framework, Stripe Python SDK, React 19, @stripe/stripe-js v3, @stripe/react-stripe-js v3, custom CSS (no Tailwind — follows existing `app.css` pattern)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/apps/portal/views.py` | Modify | Add `PortalInvoicePayView` |
| `backend/apps/portal/urls.py` | Modify | Route `portal/invoices/<pk>/pay/` |
| `backend/apps/billing/views.py` | Modify | Add `payment_intent.succeeded` to `StripeConnectWebhookView` |
| `backend/apps/portal/tests/test_portal_pay.py` | Create | Tests for pay endpoint |
| `backend/apps/billing/tests/test_stripe_webhook.py` | Modify | Test for new webhook branch |
| `frontend/package.json` | Modify | Add Stripe JS packages |
| `frontend/.env.example` | Modify | Add `VITE_STRIPE_PUBLISHABLE_KEY` |
| `frontend/src/styles/app.css` | Modify | Replace login + portal CSS blocks; add animations + pay modal classes |
| `frontend/src/screens/Login.jsx` | Modify | Dark redesign (SVG gold, gold submit button) |
| `frontend/src/hooks/usePortalInvoices.js` | Modify | Add `markPaid` + `refetch` |
| `frontend/src/components/portal/PaymentModal.jsx` | Create | Embedded Stripe PaymentElement modal |
| `frontend/src/screens/BoaterPortal.jsx` | Modify | Dark redesign, tab animation, modal wiring, SCA handler |

---

## Task 1: Backend — PortalInvoicePayView

**Files:**
- Modify: `backend/apps/portal/views.py`
- Modify: `backend/apps/portal/urls.py`
- Create: `backend/apps/portal/tests/test_portal_pay.py`

- [ ] **Step 1.1: Write the failing tests**

Create `backend/apps/portal/tests/test_portal_pay.py`:

```python
import json
from decimal import Decimal
from unittest.mock import patch, MagicMock
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.members.models import Member
from apps.billing.models import Invoice


def _setup():
    marina = Marina.objects.create(
        name='Test Marina',
        stripe_account_id='acct_test123',
        currency='CHF',
    )
    user = User.objects.create_user(
        email='boater@test.com',
        password='pass',
        role='boater',
        marina=marina,
    )
    member = Member.objects.create(
        marina=marina,
        name='Test Boater',
        boater_user=user,
    )
    invoice = Invoice.objects.create(
        marina=marina,
        member=member,
        invoice_number='INV-2026-0001',
        status='open',
        total=Decimal('150.00'),
    )
    return marina, user, member, invoice


class PortalInvoicePayViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina, self.user, self.member, self.invoice = _setup()
        self.client.force_authenticate(user=self.user)
        self.url = f'/api/v1/portal/invoices/{self.invoice.pk}/pay/'

    @patch('apps.billing.stripe_service.stripe')
    def test_creates_payment_intent_and_returns_client_secret(self, mock_stripe):
        mock_stripe.PaymentIntent.create.return_value = {
            'id': 'pi_new',
            'client_secret': 'pi_new_secret_test',
        }
        resp = self.client.post(self.url)
        self.assertEqual(resp.status_code, 201)
        data = json.loads(resp.content)
        self.assertEqual(data['client_secret'], 'pi_new_secret_test')
        self.assertEqual(data['stripe_account_id'], 'acct_test123')
        self.assertEqual(data['currency'], 'chf')
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.stripe_payment_intent_id, 'pi_new')

    @patch('apps.billing.stripe_service.stripe')
    def test_reuses_existing_intent_when_still_open(self, mock_stripe):
        self.invoice.stripe_payment_intent_id = 'pi_existing'
        self.invoice.save(update_fields=['stripe_payment_intent_id'])
        mock_stripe.PaymentIntent.retrieve.return_value = {
            'id': 'pi_existing',
            'client_secret': 'pi_existing_secret',
            'status': 'requires_payment_method',
            'amount': 15000,
        }
        resp = self.client.post(self.url)
        self.assertEqual(resp.status_code, 200)
        data = json.loads(resp.content)
        self.assertEqual(data['client_secret'], 'pi_existing_secret')
        mock_stripe.PaymentIntent.create.assert_not_called()

    @patch('apps.billing.stripe_service.stripe')
    def test_updates_intent_amount_when_invoice_was_edited(self, mock_stripe):
        self.invoice.stripe_payment_intent_id = 'pi_stale'
        self.invoice.total = Decimal('200.00')
        self.invoice.save(update_fields=['stripe_payment_intent_id', 'total'])
        mock_stripe.PaymentIntent.retrieve.return_value = {
            'id': 'pi_stale',
            'client_secret': 'pi_stale_secret',
            'status': 'requires_payment_method',
            'amount': 15000,  # old amount: CHF 150.00
        }
        mock_stripe.PaymentIntent.modify.return_value = {
            'id': 'pi_stale',
            'client_secret': 'pi_modified_secret',
            'amount': 20000,
        }
        resp = self.client.post(self.url)
        self.assertEqual(resp.status_code, 200)
        mock_stripe.PaymentIntent.modify.assert_called_once_with(
            'pi_stale',
            amount=20000,
            stripe_account='acct_test123',
        )

    def test_returns_404_for_paid_invoice(self):
        self.invoice.status = 'paid'
        self.invoice.save(update_fields=['status'])
        resp = self.client.post(self.url)
        self.assertEqual(resp.status_code, 404)

    def test_returns_402_when_marina_has_no_stripe_account(self):
        self.marina.stripe_account_id = ''
        self.marina.save(update_fields=['stripe_account_id'])
        resp = self.client.post(self.url)
        self.assertEqual(resp.status_code, 402)

    def test_returns_403_for_non_boater(self):
        staff_user = User.objects.create_user(
            email='staff@test.com', password='pass', role='staff',
            marina=self.marina,
        )
        self.client.force_authenticate(user=staff_user)
        resp = self.client.post(self.url)
        self.assertEqual(resp.status_code, 403)
```

- [ ] **Step 1.2: Run tests to confirm they fail**

```
cd backend && python manage.py test apps.portal.tests.test_portal_pay -v 2
```

Expected: all 6 tests fail with `404 Not Found` (URL not registered yet).

- [ ] **Step 1.3: Add PortalInvoicePayView to portal/views.py**

Add after the last existing import in `backend/apps/portal/views.py`:

```python
from apps.billing.models import Invoice as _Invoice
from apps.billing import stripe_service as _stripe_svc
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status as http_status
```

Then add the class after `PortalVesselView` (end of file):

```python
class PortalInvoicePayView(APIView):
    permission_classes = [IsBoater]

    def post(self, request, pk):
        member = request.user.member_profile
        try:
            invoice = _Invoice.objects.select_related('marina').get(
                pk=pk,
                member=member,
                marina=request.user.marina,
                status='open',
            )
        except _Invoice.DoesNotExist:
            return Response(
                {'detail': 'Invoice not found or not payable.'},
                status=http_status.HTTP_404_NOT_FOUND,
            )

        if not invoice.marina.stripe_account_id:
            return Response(
                {'detail': 'Payments not configured for this marina.'},
                status=http_status.HTTP_402_PAYMENT_REQUIRED,
            )

        amount_cents = int(round(float(invoice.total) * 100))
        currency = invoice.marina.currency.lower()
        stripe_account = invoice.marina.stripe_account_id

        if invoice.stripe_payment_intent_id:
            try:
                intent = _stripe_svc.stripe.PaymentIntent.retrieve(
                    invoice.stripe_payment_intent_id,
                    stripe_account=stripe_account,
                )
                if intent['status'] == 'requires_payment_method':
                    if intent['amount'] != amount_cents:
                        intent = _stripe_svc.stripe.PaymentIntent.modify(
                            intent['id'],
                            amount=amount_cents,
                            stripe_account=stripe_account,
                        )
                    return Response({
                        'client_secret': intent['client_secret'],
                        'amount': str(invoice.total),
                        'currency': currency,
                        'stripe_account_id': stripe_account,
                    })
            except Exception:
                pass

        intent = _stripe_svc.stripe.PaymentIntent.create(
            amount=amount_cents,
            currency=currency,
            metadata={'invoice_id': str(invoice.pk)},
            stripe_account=stripe_account,
        )
        invoice.stripe_payment_intent_id = intent['id']
        invoice.save(update_fields=['stripe_payment_intent_id'])

        return Response({
            'client_secret': intent['client_secret'],
            'amount': str(invoice.total),
            'currency': currency,
            'stripe_account_id': stripe_account,
        }, status=http_status.HTTP_201_CREATED)
```

- [ ] **Step 1.4: Register the route in portal/urls.py**

In `backend/apps/portal/urls.py`, add the import and route:

```python
from .views import (
    PortalInvoiceListView, AbsenceReportCreateView, CraneRequestListCreateView,
    CraneRequestStaffListView, CraneRequestStaffDetailView,
    PortalBerthView, PortalVesselView, PortalInvoicePayView,
)

urlpatterns = [
    path('portal/invoices/',                              PortalInvoiceListView.as_view(),      name='portal_invoices'),
    path('portal/invoices/<int:pk>/pay/',                 PortalInvoicePayView.as_view(),        name='portal_invoice_pay'),
    path('portal/absence/',                               AbsenceReportCreateView.as_view(),     name='portal_absence'),
    path('portal/crane-requests/',                        CraneRequestListCreateView.as_view(),  name='portal_crane_requests'),
    path('portal/crane-requests/staff/',                  CraneRequestStaffListView.as_view(),   name='portal_crane_staff_list'),
    path('portal/crane-requests/<int:pk>/staff-update/',  CraneRequestStaffDetailView.as_view(), name='portal_crane_staff_detail'),
    path('portal/berth/',                                 PortalBerthView.as_view(),             name='portal_berth'),
    path('portal/vessel/',                                PortalVesselView.as_view(),            name='portal_vessel'),
]
```

- [ ] **Step 1.5: Run tests to confirm they pass**

```
cd backend && python manage.py test apps.portal.tests.test_portal_pay -v 2
```

Expected: 6 tests pass.

- [ ] **Step 1.6: Commit**

```bash
git add backend/apps/portal/views.py backend/apps/portal/urls.py backend/apps/portal/tests/test_portal_pay.py
git commit -m "feat: add PortalInvoicePayView — create Stripe PaymentIntent for boater invoices"
```

---

## Task 2: Backend — payment_intent.succeeded Webhook

**Files:**
- Modify: `backend/apps/billing/views.py`
- Modify: `backend/apps/billing/tests/test_stripe_webhook.py`

- [ ] **Step 2.1: Write the failing test**

Add this test class at the end of `backend/apps/billing/tests/test_stripe_webhook.py`:

```python
class StripeConnectPaymentIntentWebhookTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina, self.booking, self.invoice, self.berth = _setup()
        self.marina.stripe_account_id = 'acct_test'
        self.marina.save(update_fields=['stripe_account_id'])

    def _make_pi_event(self, invoice_id):
        return {
            'type': 'payment_intent.succeeded',
            'data': {
                'object': {
                    'id': 'pi_test_connect',
                    'metadata': {'invoice_id': str(invoice_id)},
                }
            }
        }

    @patch('apps.billing.views.send_booking_confirmed_email')
    @patch('apps.billing.views._generate_store_and_email_pdf')
    @patch('apps.billing.stripe_service.stripe')
    def test_payment_intent_succeeded_marks_invoice_paid(
        self, mock_stripe, mock_pdf, mock_email
    ):
        mock_stripe.Webhook.construct_event.return_value = self._make_pi_event(
            self.invoice.id
        )
        with patch('apps.billing.views.threading', _sync_thread_mock()):
            resp = self.client.post(
                '/api/v1/billing/stripe/connect-webhook/',
                data=json.dumps({}),
                content_type='application/json',
                HTTP_STRIPE_SIGNATURE='sig',
            )
        self.assertEqual(resp.status_code, 200)
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, 'paid')
        self.assertEqual(self.invoice.stripe_payment_intent_id, 'pi_test_connect')
        self.assertIsNotNone(self.invoice.paid_at)

    @patch('apps.billing.stripe_service.stripe')
    def test_payment_intent_succeeded_is_idempotent(self, mock_stripe):
        self.invoice.status = 'paid'
        self.invoice.save(update_fields=['status'])
        mock_stripe.Webhook.construct_event.return_value = self._make_pi_event(
            self.invoice.id
        )
        resp = self.client.post(
            '/api/v1/billing/stripe/connect-webhook/',
            data=json.dumps({}),
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='sig',
        )
        self.assertEqual(resp.status_code, 200)
        # status stays 'paid', no double-fire
        self.invoice.refresh_from_db()
        self.assertEqual(self.invoice.status, 'paid')
```

- [ ] **Step 2.2: Run test to confirm it fails**

```
cd backend && python manage.py test apps.billing.tests.test_stripe_webhook.StripeConnectPaymentIntentWebhookTest -v 2
```

Expected: both tests fail — `payment_intent.succeeded` is not handled yet.

- [ ] **Step 2.3: Add the webhook branch to StripeConnectWebhookView**

In `backend/apps/billing/views.py`, find `StripeConnectWebhookView.post`. It currently handles `checkout.session.completed` and `checkout.session.expired`. After the `checkout.session.expired` block (before `return HttpResponse(status=200)`), add:

```python
        elif event_type == 'payment_intent.succeeded':
            updated = Invoice.objects.filter(pk=invoice.pk, status='open').update(
                stripe_payment_intent_id=obj['id'],
                status='paid',
                paid_at=timezone.now(),
            )
            if updated:
                invoice.refresh_from_db()
                invoice_paid.send(sender=Invoice, invoice=invoice)
                threading.Thread(
                    target=_post_payment_tasks,
                    args=(invoice.id,),
                    daemon=True,
                ).start()
```

- [ ] **Step 2.4: Run tests to confirm they pass**

```
cd backend && python manage.py test apps.billing.tests.test_stripe_webhook.StripeConnectPaymentIntentWebhookTest -v 2
```

Expected: both tests pass.

- [ ] **Step 2.5: Run full billing test suite to check for regressions**

```
cd backend && python manage.py test apps.billing -v 1
```

Expected: all existing tests still pass.

- [ ] **Step 2.6: Commit**

```bash
git add backend/apps/billing/views.py backend/apps/billing/tests/test_stripe_webhook.py
git commit -m "feat: handle payment_intent.succeeded in StripeConnectWebhookView"
```

---

## Task 3: Frontend — Install Stripe Packages + Env

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/.env.example`

- [ ] **Step 3.1: Install Stripe packages**

```bash
cd frontend && npm install @stripe/stripe-js @stripe/react-stripe-js
```

Expected output includes: `added 2 packages` (or similar — both are lightweight).

- [ ] **Step 3.2: Add env var to .env.example**

Add to `frontend/.env.example`:

```
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...
```

- [ ] **Step 3.3: Add the key to .env.local**

Open `frontend/.env.local` and add:

```
VITE_STRIPE_PUBLISHABLE_KEY=pk_test_<your_actual_test_publishable_key>
```

Get the key from the Stripe Dashboard → Developers → API keys → Publishable key.

- [ ] **Step 3.4: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/.env.example
git commit -m "chore: install @stripe/react-stripe-js and add VITE_STRIPE_PUBLISHABLE_KEY env"
```

---

## Task 4: Frontend — Dark Portal CSS

**Files:**
- Modify: `frontend/src/styles/app.css`

Replace the entire `/* ── Login ──` section and `/* ── Boater Portal ──` section. Also add new keyframe animations and payment modal classes.

- [ ] **Step 4.1: Replace the Login CSS block**

Find the comment `/* ── Login ─────────────────────────────────────────────────────────────── */` in `app.css`. Replace everything from that comment through `.login-submit { ... }` (line 440 in current file) with:

```css
/* ── Login ─────────────────────────────────────────────────────────────── */
@keyframes loginCardIn {
  from { opacity: 0; transform: translateY(16px); }
  to   { opacity: 1; transform: translateY(0); }
}

.login-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(155deg, var(--navy) 55%, #1a3d52 100%);
  padding: 24px;
}

.login-card {
  background: var(--navy2);
  border: 1px solid rgba(184,150,90,0.18);
  border-radius: 12px;
  box-shadow: 0 8px 48px rgba(0,0,0,0.45);
  padding: 40px 36px;
  width: 100%;
  max-width: 380px;
  animation: loginCardIn 350ms ease-out both;
}

.login-logo {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 28px;
}

.login-brand {
  font-family: var(--font-brand);
  font-size: 14px;
  font-weight: 700;
  letter-spacing: 2.5px;
  text-transform: uppercase;
  color: var(--cream);
}

.login-title {
  font-family: var(--font-serif);
  font-size: 32px;
  font-weight: 600;
  color: var(--cream);
  margin-bottom: 24px;
  letter-spacing: -0.3px;
}

.login-form { display: flex; flex-direction: column; gap: 16px; }

.login-field { display: flex; flex-direction: column; gap: 5px; }

.login-label {
  font-family: var(--font);
  font-size: 11px;
  font-weight: 600;
  color: rgba(245,240,230,0.5);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.login-input {
  font-family: var(--font);
  font-size: 14px;
  font-weight: 400;
  background: var(--navy);
  color: var(--cream);
  border: 1px solid rgba(255,255,255,0.12);
  border-radius: 6px;
  padding: 9px 12px;
  width: 100%;
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}

.login-input::placeholder { color: rgba(245,240,230,0.3); }

.login-input:focus {
  border-color: var(--gold);
  box-shadow: 0 0 0 3px rgba(184,150,90,0.18);
}

.login-error {
  font-size: 12px;
  color: #f08080;
  margin: 0;
}

.login-submit { width: 100%; justify-content: center; padding: 11px 0; font-size: 14px; font-weight: 700; letter-spacing: 0.5px; }
```

- [ ] **Step 4.2: Replace the Boater Portal CSS block**

Find `/* ── Boater Portal ──────────────────────────────── */` and replace everything from that comment through `.portal-empty-text { ... }` with:

```css
/* ── Boater Portal ──────────────────────────────── */
@keyframes fadeSlideUp {
  from { opacity: 0; transform: translateY(12px); }
  to   { opacity: 1; transform: translateY(0); }
}

@keyframes logoPulse {
  0%   { transform: scale(1);   opacity: 0.7; }
  100% { transform: scale(1.7); opacity: 0; }
}

.portal-shell {
  min-height: 100vh;
  background: var(--navy);
  display: flex;
  flex-direction: column;
  font-family: var(--font);
}

.portal-header {
  background: var(--navy);
  border-bottom: 1px solid rgba(184,150,90,0.12);
  padding: 18px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.portal-header-left {
  display: flex;
  align-items: center;
  gap: 12px;
}

.portal-logo-wrap {
  position: relative;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.portal-logo-ring {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  border: 1.5px solid var(--gold);
  animation: logoPulse 700ms ease-out 300ms 1 forwards;
  opacity: 0;
}

.portal-marina-name {
  font-family: var(--font-serif);
  font-size: 20px;
  font-weight: 600;
  color: var(--cream);
  line-height: 1.2;
  letter-spacing: -0.2px;
}

.portal-boater-name {
  font-size: 12px;
  color: rgba(245,240,230,0.45);
  line-height: 1.2;
  margin-top: 1px;
}

.portal-signout {
  background: transparent;
  border: 1px solid rgba(255,255,255,0.15);
  color: rgba(245,240,230,0.5);
  font-family: var(--font);
  font-size: 11px;
  font-weight: 500;
  letter-spacing: 0.3px;
  padding: 5px 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.portal-signout:hover { border-color: rgba(255,255,255,0.3); color: var(--cream); }

.portal-tabs {
  background: transparent;
  border-bottom: 1px solid rgba(255,255,255,0.08);
  display: flex;
  gap: 0;
  padding: 0 20px;
  flex-shrink: 0;
  margin-bottom: 0;
}

.portal-tabs .tab {
  font-family: var(--font-brand);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 2px;
  text-transform: uppercase;
  color: rgba(245,240,230,0.4);
  padding: 14px 16px;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.15s, border-color 0.15s;
  background: none;
  border-top: none;
  border-left: none;
  border-right: none;
  cursor: pointer;
  white-space: nowrap;
}
.portal-tabs .tab:hover { color: rgba(245,240,230,0.75); }
.portal-tabs .tab.active { color: var(--cream); border-bottom-color: var(--gold); }

.portal-content {
  flex: 1;
  overflow-y: auto;
  background: var(--navy);
  padding-bottom: 80px;
}

.portal-tab-content {
  animation: fadeSlideUp 150ms ease-out both;
}

.portal-list {
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Dark cards */
.portal-invoice-card,
.portal-form-card,
.portal-request-card {
  background: var(--navy2);
  border: 1px solid rgba(184,150,90,0.14);
  border-radius: 10px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.3);
}
.portal-invoice-card { padding: 16px; }
.portal-form-card    { padding: 20px; }
.portal-request-card { padding: 14px 16px; }

.portal-invoice-row, .portal-request-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 12px;
}

.portal-invoice-ref {
  font-family: var(--font-brand);
  font-size: 10px;
  font-weight: 700;
  color: var(--gold);
  text-transform: uppercase;
  letter-spacing: 2px;
  margin-bottom: 4px;
}

.portal-invoice-amount {
  font-family: var(--font-serif);
  font-size: 28px;
  font-weight: 600;
  color: var(--cream);
  letter-spacing: -0.3px;
  line-height: 1.1;
}

.portal-invoice-meta {
  font-size: 12px;
  color: rgba(245,240,230,0.45);
  margin-top: 3px;
}

.portal-request-type {
  font-size: 14px;
  font-weight: 600;
  color: var(--cream);
  text-transform: capitalize;
}

.portal-request-notes {
  font-size: 13px;
  color: rgba(245,240,230,0.5);
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255,255,255,0.07);
}

.portal-full-btn {
  width: 100%;
  justify-content: center;
  padding: 11px 0;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.5px;
  margin-top: 4px;
}

.portal-form { display: flex; flex-direction: column; gap: 16px; }

.portal-field { display: flex; flex-direction: column; gap: 5px; }

.portal-field-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.portal-label {
  font-size: 11px;
  font-weight: 600;
  color: rgba(245,240,230,0.5);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.portal-optional {
  font-weight: 400;
  color: rgba(245,240,230,0.3);
}

.portal-section-label {
  font-family: var(--font-brand);
  font-size: 9px;
  font-weight: 700;
  color: var(--gold);
  text-transform: uppercase;
  letter-spacing: 2.5px;
  padding: 4px 4px 0;
}

.portal-success {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 24px 0;
}

.portal-success-text {
  font-size: 14px;
  color: rgba(245,240,230,0.6);
}

.portal-loading {
  padding: 40px 20px;
  text-align: center;
  font-size: 14px;
  color: rgba(245,240,230,0.4);
}

.portal-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 60px 20px;
  color: rgba(245,240,230,0.35);
}

.portal-empty-icon { opacity: 0.3; }

.portal-empty-text {
  font-size: 14px;
  font-weight: 500;
  text-align: center;
  max-width: 260px;
  line-height: 1.5;
}

/* Dark status badges for portal */
.badge-portal-paid    { background: rgba(26,140,46,0.2);   color: #5dd87a; }
.badge-portal-unpaid  { background: rgba(184,150,90,0.15); color: var(--gold2); }
.badge-portal-overdue { background: rgba(192,57,43,0.2);   color: #f08080; }
.badge-portal-void    { background: rgba(255,255,255,0.07); color: rgba(245,240,230,0.3); }
```

- [ ] **Step 4.3: Add Payment Modal CSS after the portal block**

Append to the end of the portal section (before `/* ── MODALS ──`):

```css
/* ── Payment Modal ──────────────────────────────── */
.pay-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.65);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
  padding: 16px;
}

@keyframes payModalIn {
  from { opacity: 0; transform: scale(0.97); }
  to   { opacity: 1; transform: scale(1); }
}

.pay-modal-card {
  background: var(--navy2);
  border: 1px solid rgba(184,150,90,0.22);
  border-radius: 12px;
  box-shadow: 0 16px 64px rgba(0,0,0,0.6);
  padding: 28px 24px 24px;
  width: 100%;
  max-width: 480px;
  max-height: 90vh;
  overflow-y: auto;
  animation: payModalIn 250ms ease-out both;
}

.pay-modal-title {
  font-family: var(--font-serif);
  font-size: 26px;
  font-weight: 600;
  color: var(--cream);
  margin-bottom: 2px;
  letter-spacing: -0.2px;
}

.pay-modal-ref {
  font-family: var(--font-brand);
  font-size: 10px;
  font-weight: 700;
  color: var(--gold);
  text-transform: uppercase;
  letter-spacing: 2px;
  margin-bottom: 20px;
}

.pay-modal-form { display: flex; flex-direction: column; gap: 16px; }

.pay-modal-amount {
  font-family: var(--font-serif);
  font-size: 36px;
  font-weight: 600;
  color: var(--gold);
  letter-spacing: -0.5px;
  line-height: 1.1;
  margin-bottom: 4px;
}

.pay-modal-error {
  font-size: 13px;
  color: #f08080;
  margin: 0;
}

.pay-modal-cancel {
  background: none;
  border: none;
  color: rgba(245,240,230,0.4);
  font-family: var(--font);
  font-size: 12px;
  cursor: pointer;
  text-align: center;
  padding: 4px;
  transition: color 0.15s;
}
.pay-modal-cancel:hover { color: rgba(245,240,230,0.7); }

.pay-modal-success {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 32px 0;
}

.pay-modal-success-text {
  font-family: var(--font-serif);
  font-size: 22px;
  font-weight: 600;
  color: var(--cream);
}
```

- [ ] **Step 4.4: Verify the dev server starts without CSS errors**

```bash
cd frontend && npm run dev
```

Expected: Vite compiles with no errors. Open the browser — the login page should now be dark navy with gold accents.

- [ ] **Step 4.5: Commit**

```bash
git add frontend/src/styles/app.css
git commit -m "feat: dark navy portal theme CSS — login, portal shell, tabs, cards, animations, payment modal"
```

---

## Task 5: Frontend — Login.jsx Dark Redesign

**Files:**
- Modify: `frontend/src/screens/Login.jsx`

- [ ] **Step 5.1: Update the logo SVG and brand text**

In `Login.jsx`, find the `.login-logo` div and replace its content:

```jsx
<div className="login-logo">
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="var(--gold, #b8965a)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="5" r="3"/>
    <line x1="12" y1="8" x2="12" y2="22"/>
    <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
  </svg>
  <span className="login-brand">DocksBase</span>
</div>
```

- [ ] **Step 5.2: Update the submit button class**

Find the submit button in Login.jsx:

```jsx
<button type="submit" className="abtn abtn-primary login-submit" disabled={loading}>
```

Change to:

```jsx
<button type="submit" className="abtn abtn-gold login-submit" disabled={loading}>
```

- [ ] **Step 5.3: Update the "Don't have an account?" link style**

Find:

```jsx
<p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(0,0,0,0.45)', marginTop: 16 }}>
  Don't have an account?{' '}
  <Link to="/signup" style={{ color: 'var(--navy)', textDecoration: 'none', fontWeight: 600 }}>Sign up</Link>
</p>
```

Replace with:

```jsx
<p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(245,240,230,0.4)', marginTop: 16 }}>
  Don't have an account?{' '}
  <Link to="/signup" style={{ color: 'var(--gold)', textDecoration: 'none', fontWeight: 600 }}>Sign up</Link>
</p>
```

- [ ] **Step 5.4: Fix the unverified warning box inline style**

Find the `background: '#fff8e7'` inline style block and replace with dark-appropriate:

```jsx
<div style={{ background: 'rgba(184,150,90,0.12)', border: '1px solid rgba(184,150,90,0.3)', borderRadius: 6, padding: '10px 12px', fontSize: 12, lineHeight: 1.5, color: 'rgba(245,240,230,0.75)' }}>
  Please verify your email before logging in.{' '}
  {resendSent
    ? <span style={{ color: '#5dd87a', fontWeight: 600 }}>Verification email sent!</span>
    : <button type="button" onClick={handleResend} style={{ background: 'none', border: 'none', color: 'var(--gold)', fontWeight: 600, cursor: 'pointer', padding: 0, fontSize: 12 }}>Resend verification email</button>
  }
</div>
```

- [ ] **Step 5.5: Visually verify in browser**

Navigate to `http://localhost:5173/login`. Expected: dark navy gradient background, dark card with gold border, gold anchor logo, Cormorant Garamond "Sign in" heading in cream, gold-focused inputs, gold submit button.

- [ ] **Step 5.6: Commit**

```bash
git add frontend/src/screens/Login.jsx
git commit -m "feat: Login.jsx dark maritime redesign — gold anchor, Cormorant heading, dark inputs"
```

---

## Task 6: Frontend — usePortalInvoices Hook Update

**Files:**
- Modify: `frontend/src/hooks/usePortalInvoices.js`
- Create: `frontend/src/hooks/usePortalInvoices.test.js`

- [ ] **Step 6.1: Write the failing tests**

Create `frontend/src/hooks/usePortalInvoices.test.js`:

```js
import { renderHook, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../api.js', () => ({
  default: {
    get: vi.fn(),
  },
}));

import api from '../api.js';
import usePortalInvoices from './usePortalInvoices.js';

const SAMPLE_INVOICES = [
  { id: 1, invoice_number: 'INV-001', status: 'open', total: '150.00' },
  { id: 2, invoice_number: 'INV-002', status: 'paid', total: '80.00' },
];

describe('usePortalInvoices', () => {
  beforeEach(() => {
    api.get.mockResolvedValue({ data: SAMPLE_INVOICES });
  });

  it('loads invoices on mount', async () => {
    const { result } = renderHook(() => usePortalInvoices());
    expect(result.current.loading).toBe(true);
    await act(async () => {});
    expect(result.current.loading).toBe(false);
    expect(result.current.invoices).toEqual(SAMPLE_INVOICES);
  });

  it('markPaid updates the target invoice status to paid', async () => {
    const { result } = renderHook(() => usePortalInvoices());
    await act(async () => {});
    act(() => { result.current.markPaid(1); });
    const updated = result.current.invoices.find(inv => inv.id === 1);
    expect(updated.status).toBe('paid');
    // other invoice unchanged
    expect(result.current.invoices.find(inv => inv.id === 2).status).toBe('paid');
  });

  it('refetch calls the API again', async () => {
    const { result } = renderHook(() => usePortalInvoices());
    await act(async () => {});
    api.get.mockResolvedValue({ data: [{ id: 3, invoice_number: 'INV-003', status: 'open', total: '200.00' }] });
    await act(async () => { result.current.refetch(); });
    expect(result.current.invoices).toHaveLength(1);
    expect(result.current.invoices[0].id).toBe(3);
  });
});
```

- [ ] **Step 6.2: Run tests to confirm they fail**

```bash
cd frontend && npm test -- usePortalInvoices
```

Expected: `markPaid is not a function`, `refetch is not a function`.

- [ ] **Step 6.3: Update the hook**

Replace `frontend/src/hooks/usePortalInvoices.js` with:

```js
import { useState, useEffect, useCallback } from 'react';
import api from '../api.js';

export default function usePortalInvoices() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/portal/invoices/')
      .then(r => setInvoices(r.data))
      .catch(() => setError('Could not load invoices.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  function markPaid(invoiceId) {
    setInvoices(prev =>
      prev.map(inv => inv.id === invoiceId ? { ...inv, status: 'paid' } : inv)
    );
  }

  return { invoices, loading, error, markPaid, refetch: load };
}
```

- [ ] **Step 6.4: Run tests to confirm they pass**

```bash
cd frontend && npm test -- usePortalInvoices
```

Expected: 3 tests pass.

- [ ] **Step 6.5: Commit**

```bash
git add frontend/src/hooks/usePortalInvoices.js frontend/src/hooks/usePortalInvoices.test.js
git commit -m "feat: usePortalInvoices — add markPaid and refetch helpers"
```

---

## Task 7: Frontend — PaymentModal Component

**Files:**
- Create: `frontend/src/components/portal/PaymentModal.jsx`

- [ ] **Step 7.1: Create the component directory and file**

```bash
mkdir -p frontend/src/components/portal
```

Create `frontend/src/components/portal/PaymentModal.jsx`:

```jsx
import { useState, useEffect } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js';
import api from '../../api.js';

const STRIPE_PK = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;

const STRIPE_APPEARANCE = {
  theme: 'night',
  variables: {
    colorPrimary: '#b8965a',
    colorBackground: '#162d52',
    colorText: '#f5f0e6',
    fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
    borderRadius: '6px',
    spacingUnit: '4px',
  },
};

function formatCurrency(amount, currency) {
  return Number(amount).toLocaleString('de-CH', {
    style: 'currency',
    currency: (currency || 'chf').toUpperCase(),
  });
}

function CheckoutForm({ invoice, currency, onPaid, onClose }) {
  const stripe   = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
  const [succeeded, setSucceeded]   = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError('');

    const { error: stripeError } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    });

    if (stripeError) {
      setError(stripeError.message || 'Payment failed. Please try again.');
      setSubmitting(false);
    } else {
      setSucceeded(true);
      setTimeout(() => {
        onPaid(invoice.id);
        onClose();
      }, 2000);
    }
  }

  if (succeeded) {
    return (
      <div className="pay-modal-success">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none"
          stroke="var(--gold)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        <div className="pay-modal-success-text">Payment received</div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="pay-modal-form">
      <div className="pay-modal-amount">{formatCurrency(invoice.total, currency)}</div>
      <PaymentElement />
      {error && <p className="pay-modal-error">{error}</p>}
      <button
        type="submit"
        className="abtn abtn-gold portal-full-btn"
        disabled={submitting || !stripe}
      >
        {submitting ? 'Processing…' : `Pay ${formatCurrency(invoice.total, currency)}`}
      </button>
      <button type="button" className="pay-modal-cancel" onClick={onClose}>
        Cancel
      </button>
    </form>
  );
}

export default function PaymentModal({ invoice, onClose, onPaid }) {
  const [stripePromise, setStripePromise] = useState(null);
  const [clientSecret, setClientSecret]   = useState('');
  const [currency, setCurrency]           = useState('chf');
  const [loading, setLoading]             = useState(true);
  const [fetchError, setFetchError]       = useState('');

  useEffect(() => {
    api.post(`/portal/invoices/${invoice.id}/pay/`)
      .then(r => {
        const { client_secret, currency: curr, stripe_account_id } = r.data;
        setClientSecret(client_secret);
        setCurrency(curr);
        setStripePromise(loadStripe(STRIPE_PK, { stripeAccount: stripe_account_id }));
      })
      .catch(() => setFetchError('Could not initialise payment. Please try again.'))
      .finally(() => setLoading(false));
  }, [invoice.id]);

  return (
    <div className="pay-modal-overlay" onClick={onClose}>
      <div className="pay-modal-card" onClick={e => e.stopPropagation()}>
        <div className="pay-modal-title">Pay Invoice</div>
        <div className="pay-modal-ref">
          {invoice.invoice_number || `INV-${invoice.id}`}
        </div>

        {loading && <div className="portal-loading">Initialising payment…</div>}

        {fetchError && <p className="pay-modal-error">{fetchError}</p>}

        {!loading && !fetchError && clientSecret && stripePromise && (
          <Elements
            stripe={stripePromise}
            options={{ clientSecret, appearance: STRIPE_APPEARANCE }}
          >
            <CheckoutForm
              invoice={invoice}
              currency={currency}
              onPaid={onPaid}
              onClose={onClose}
            />
          </Elements>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 7.2: Smoke-test import**

Start the dev server (`npm run dev`) and open `/portal` as a boater. No import errors should appear in the console (the modal won't appear yet since it isn't wired up).

- [ ] **Step 7.3: Commit**

```bash
git add frontend/src/components/portal/PaymentModal.jsx
git commit -m "feat: PaymentModal — embedded Stripe PaymentElement with dark maritime theme"
```

---

## Task 8: Frontend — BoaterPortal.jsx Full Redesign

**Files:**
- Modify: `frontend/src/screens/BoaterPortal.jsx`

- [ ] **Step 8.1: Update imports at the top of BoaterPortal.jsx**

Replace the existing import block with:

```jsx
import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import usePortalInvoices from '../hooks/usePortalInvoices.js';
import usePortalCraneRequests from '../hooks/usePortalCraneRequests.js';
import usePortalBerth from '../hooks/usePortalBerth.js';
import usePortalVessel from '../hooks/usePortalVessel.js';
import PaymentModal from '../components/portal/PaymentModal.jsx';
import api from '../api.js';
```

- [ ] **Step 8.2: Update the STATUS_BADGE map for dark theme**

Replace the `STATUS_BADGE` constant:

```jsx
const STATUS_BADGE = {
  open:      'badge badge-portal-unpaid',
  paid:      'badge badge-portal-paid',
  void:      'badge badge-portal-void',
  draft:     'badge badge-portal-void',
  requested: 'badge badge-portal-unpaid',
  approved:  'badge badge-portal-paid',
  rejected:  'badge badge-portal-overdue',
};

const STATUS_LABEL = {
  open: 'Unpaid', paid: 'Paid', void: 'Void', draft: 'Draft',
  requested: 'Requested', approved: 'Approved', rejected: 'Rejected',
};
```

- [ ] **Step 8.3: Update InvoicesTab to accept props and add Pay Now button**

Replace the entire `InvoicesTab` function with:

```jsx
function InvoicesTab({ invoices, loading, error, onPay }) {
  if (loading) return <div className="portal-loading">Loading invoices…</div>;
  if (error)   return <div className="portal-loading">{error}</div>;
  if (!invoices.length) return (
    <div className="portal-empty">
      <div className="portal-empty-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      </div>
      <div className="portal-empty-text">No invoices.</div>
    </div>
  );

  return (
    <div className="portal-list">
      {invoices.map(inv => (
        <div key={inv.id} className="portal-invoice-card">
          <div className="portal-invoice-row">
            <div>
              <div className="portal-invoice-ref">{inv.invoice_number || `INV-${inv.id}`}</div>
              <div className="portal-invoice-amount">{formatCurrency(inv.total)}</div>
              {inv.due_date && <div className="portal-invoice-meta">Due {inv.due_date}</div>}
            </div>
            <span className={STATUS_BADGE[inv.status] || 'badge'}>
              {STATUS_LABEL[inv.status] || inv.status}
            </span>
          </div>
          {inv.status === 'open' && (
            <button
              type="button"
              className="abtn abtn-gold portal-full-btn"
              onClick={() => onPay(inv)}
            >
              Pay Now
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 8.4: Update AbsenceTab — fix inline styles for dark theme**

The form fields (`.portal-form`, `.portal-field`, `.portal-label`, `.login-input`) already pick up the dark CSS automatically. Only the success state uses an old light badge. Find the `success` branch inside the card and replace just the `<span className>`:

```jsx
{success ? (
  <div className="portal-success">
    <span className="badge badge-portal-paid">Absence reported</span>
    <p className="portal-success-text">The marina has been notified.</p>
  </div>
) : (
  <form onSubmit={handleSubmit} className="portal-form">
    <div className="portal-field">
      <label className="portal-label">Absence type</label>
      <select className="login-input" value={form.absence_type} onChange={e => set('absence_type', e.target.value)}>
        <option value="day_trip">Day trip</option>
        <option value="overnight">Overnight</option>
        <option value="extended">Extended</option>
      </select>
    </div>
    <div className="portal-field-row">
      <div className="portal-field">
        <label className="portal-label">Departure</label>
        <input type="date" className="login-input" value={form.departure} onChange={e => set('departure', e.target.value)} required />
      </div>
      <div className="portal-field">
        <label className="portal-label">Return</label>
        <input type="date" className="login-input" value={form.return_date} onChange={e => set('return_date', e.target.value)} required />
      </div>
    </div>
    <div className="portal-field">
      <label className="portal-label">Notes <span className="portal-optional">(optional)</span></label>
      <textarea className="login-input" rows={3} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Any details for the harbour master…" />
    </div>
    {error && <p className="login-error">{error}</p>}
    <button type="submit" className="abtn abtn-gold portal-full-btn" disabled={submitting}>
      {submitting ? 'Submitting…' : 'Report Absence'}
    </button>
  </form>
)}
```

- [ ] **Step 8.5: Update BerthTab — fix inline styles for dark theme**

In `BerthTab`, remove the local `STATUS_BADGE_CLASS` constant and replace the active + upcoming card sections. The berth status values (`checked_in`, `pending`) need their own mapping since they differ from invoice statuses:

Add near the top of `BerthTab`:

```jsx
const BERTH_BADGE = {
  checked_in: 'badge badge-portal-paid',
  pending:    'badge badge-portal-unpaid',
};
```

Then replace the berth card sections:



```jsx
<div className="portal-invoice-card">
  <div className="portal-invoice-ref">{active.pier_label || 'Berth'}</div>
  <div className="portal-invoice-amount">Berth {active.berth_code}</div>
  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '8px 0' }}>
    <span className={STATUS_BADGE[active.status] || 'badge'}>
      {active.status.replace('_', ' ')}
    </span>
  </div>
  <div className="portal-invoice-meta">Arrival: {active.check_in}</div>
  <div className="portal-invoice-meta">Departure: {active.check_out}</div>
  {active.nights_remaining !== null && (
    <div className="portal-invoice-meta">{active.nights_remaining} night{active.nights_remaining !== 1 ? 's' : ''} remaining</div>
  )}
</div>
```

- [ ] **Step 8.6: Update VesselTab — fix inline styles for dark theme**

In `VesselTab`, replace hardcoded `color` and `fontSize` inline styles:

```jsx
<div className="portal-invoice-card">
  <div className="portal-invoice-amount">{vessel.name}</div>
  <div className="portal-invoice-meta" style={{ marginBottom: 4 }}>{vessel.vessel_type}</div>
  {vessel.loa   && <div className="portal-invoice-meta">Length: {vessel.loa} m</div>}
  {vessel.beam  && <div className="portal-invoice-meta">Beam: {vessel.beam} m</div>}
  {vessel.reg   && <div className="portal-invoice-meta">Reg: {vessel.reg}</div>}
  {vessel.flag  && <div className="portal-invoice-meta">Flag: {vessel.flag}</div>}
</div>
```

For certificates, replace `CERT_STATUS_DOT` emoji approach with proper badges:

```jsx
const CERT_BADGE = {
  valid:    'badge badge-portal-paid',
  due_soon: 'badge badge-portal-unpaid',
  expired:  'badge badge-portal-overdue',
};

// in the map:
<div key={cert.id} className="portal-request-card">
  <div className="portal-request-row">
    <div>
      <div className="portal-request-type">{cert.name}</div>
      {cert.expires && <div className="portal-invoice-meta">Expires: {cert.expires}</div>}
    </div>
    <span className={CERT_BADGE[cert.cert_status] || 'badge'}>
      {cert.cert_status === 'due_soon' ? 'Due Soon' : cert.cert_status.charAt(0).toUpperCase() + cert.cert_status.slice(1)}
    </span>
  </div>
  {(cert.cert_status === 'expired' || cert.cert_status === 'due_soon') && vessel.marina_contact_email && (
    <a
      href={`mailto:${vessel.marina_contact_email}?subject=${encodeURIComponent(`Certificate renewal: ${cert.name} — ${vessel.name}`)}`}
      style={{ display: 'block', marginTop: 8, padding: '8px 0', textAlign: 'center',
        fontSize: 13, fontWeight: 600, color: 'var(--gold)', textDecoration: 'none',
        border: '1px solid rgba(184,150,90,0.25)', borderRadius: 8,
        background: 'rgba(184,150,90,0.08)' }}
    >
      Email marina about this certificate
    </a>
  )}
</div>
```

- [ ] **Step 8.7: Rewrite the BoaterPortal shell**

Replace the exported `BoaterPortal` component with:

```jsx
export default function BoaterPortal() {
  const { user, signOut } = useAuth();
  const [tab, setTab] = useState('invoices');
  const [payingInvoice, setPayingInvoice] = useState(null);
  const { invoices, loading: invoicesLoading, error: invoicesError, markPaid, refetch } = usePortalInvoices();

  // Handle SCA/3DS redirect return
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const redirectStatus = params.get('redirect_status');
    if (redirectStatus === 'succeeded') {
      refetch();
      window.history.replaceState({}, '', window.location.pathname);
    } else if (redirectStatus === 'failed') {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handlePaid(invoiceId) {
    markPaid(invoiceId);
  }

  return (
    <div className="portal-shell">
      <div className="portal-header">
        <div className="portal-header-left">
          <div className="portal-logo-wrap">
            <div className="portal-logo-ring" />
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
              stroke="var(--gold, #b8965a)" strokeWidth="1.5"
              strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="5" r="3"/>
              <line x1="12" y1="8" x2="12" y2="22"/>
              <path d="M5 12H2a10 10 0 0 0 20 0h-3"/>
            </svg>
          </div>
          <div>
            <div className="portal-marina-name">DocksBase</div>
            <div className="portal-boater-name">{user?.first_name || user?.email}</div>
          </div>
        </div>
        <button type="button" className="portal-signout" onClick={signOut}>Sign out</button>
      </div>

      <div className="portal-tabs">
        {[
          ['invoices', 'Invoices'],
          ['absence',  'Absence'],
          ['crane',    'Crane'],
          ['berth',    'Berth'],
          ['vessel',   'Vessel'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`tab${tab === id ? ' active' : ''}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="portal-content">
        <div key={tab} className="portal-tab-content">
          {tab === 'invoices' && (
            <InvoicesTab
              invoices={invoices}
              loading={invoicesLoading}
              error={invoicesError}
              onPay={setPayingInvoice}
            />
          )}
          {tab === 'absence'  && <AbsenceTab />}
          {tab === 'crane'    && <CraneTab />}
          {tab === 'berth'    && <BerthTab />}
          {tab === 'vessel'   && <VesselTab />}
        </div>
      </div>

      {payingInvoice && (
        <PaymentModal
          invoice={payingInvoice}
          onClose={() => setPayingInvoice(null)}
          onPaid={handlePaid}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 8.8: Verify the portal renders correctly in the browser**

1. Start the dev server: `npm run dev`
2. Log in as a boater and navigate to `/portal`
3. Confirm: dark navy background, gold anchor with pulsing ring, Cormorant Garamond marina name, uppercase tracked tabs with gold active underline
4. Switch tabs — content should fade + slide up on each switch
5. If there are open invoices, click "Pay Now" — the payment modal should open with a dark card, a Stripe PaymentElement loading

- [ ] **Step 8.9: Commit**

```bash
git add frontend/src/screens/BoaterPortal.jsx
git commit -m "feat: BoaterPortal dark redesign — gold logo, animated tabs, PaymentModal wiring, SCA handler"
```

---

## Task 9: End-to-End Smoke Test

- [ ] **Step 9.1: Run the full backend test suite**

```
cd backend && python manage.py test apps.portal apps.billing -v 1
```

Expected: all tests pass.

- [ ] **Step 9.2: Run the frontend test suite**

```bash
cd frontend && npm test
```

Expected: all tests pass (including new `usePortalInvoices` tests).

- [ ] **Step 9.3: Manual payment test with Stripe test card**

1. Ensure the backend is running with `STRIPE_PUBLISHABLE_KEY` set
2. Log in as a boater with an open invoice
3. Click "Pay Now"
4. Enter Stripe test card: `4242 4242 4242 4242`, any future date, any CVC
5. Confirm payment succeeds inline (no redirect) and invoice flips to "Paid"
6. Test 3DS card: `4000 0025 0000 3155` — confirm the bank auth redirect occurs, user returns to portal, invoice shows Paid

- [ ] **Step 9.4: Final commit**

```bash
git add -A
git commit -m "feat: portal redesign + embedded Stripe checkout — complete implementation"
```
