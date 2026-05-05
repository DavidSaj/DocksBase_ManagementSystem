# Public Booking Engine — Manual Approval Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the end-to-end manual approval booking flow: unauthenticated boater submits a request via the public portal → manager reviews, picks a berth, and approves → boater pays via Stripe → booking confirmed + Half B magic link sent.

**Architecture:** New public endpoint in the portal app for request submission; new approve/reject endpoints on the reservations app; `Invoice.booking` FK threads the Stripe webhook back to the booking for confirmation + magic link; two new React components in the management UI (pending tab + approve modal); two new screens in the boater portal (booking form + sent confirmation). No new models beyond `Invoice.booking` FK and a `ChargeableItem.BOOKING_FEE` category.

**Tech Stack:** Django 6, DRF, anymail (`send_mail`), Stripe Checkout (existing `billing_service.create_stripe_checkout_session`), React 19 + Vite, `portal/checkin_utils.make_magic_url`.

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Modify | `apps/billing/models.py` | Add `Invoice.booking` FK; add `ChargeableItem.Category.BOOKING_FEE` |
| Create | `apps/billing/migrations/0009_invoice_booking_fk.py` | Migration for Invoice.booking + BOOKING_FEE choices update |
| Create | `apps/reservations/emails.py` | 5 email helper functions |
| Create | `apps/portal/public_booking_views.py` | `PublicBookingCreateView` — unauthenticated POST |
| Modify | `apps/portal/public_urls.py` | Wire `POST bookings/` |
| Modify | `apps/reservations/views.py` | Add `ApproveBookingView`, `RejectBookingView` |
| Modify | `apps/reservations/urls.py` | Wire `/approve/`, `/reject/` |
| Modify | `apps/berths/views.py` | Add `capable_for` query param to `BerthListCreateView` |
| Modify | `apps/billing/views.py` | Extend `StripeWebhookView` for booking confirmation + expiry berth release |
| Create | `frontend/src/components/reservations/PendingRequestsTab.jsx` | Pending requests list with approve/reject actions |
| Create | `frontend/src/components/reservations/ApproveModal.jsx` | Berth picker + price preview + confirm button |
| Modify | `frontend/src/screens/Reservations.jsx` | Add Pending tab with count badge |
| Create | `portal/src/screens/BookingRequest.jsx` | Public booking form (dates + boat dims + guest info) |
| Create | `portal/src/screens/BookingRequestSent.jsx` | Post-submit confirmation screen |
| Modify | `portal/src/App.jsx` | Route to `BookingRequest` when `booking_mode='manual_approval'` |

---

## Task 1: Add `Invoice.booking` FK and `ChargeableItem.BOOKING_FEE` category

**Files:**
- Modify: `apps/billing/models.py`
- Create: `apps/billing/migrations/0009_invoice_booking_fk.py`
- Test: `apps/billing/tests/test_invoice_booking.py` (create new file)

### Context

`Invoice` currently has `source_type='berth_booking'` and `source_id=str(booking.id)` as a loose reference. Adding a real FK lets the Stripe webhook (`checkout.session.completed` / `checkout.session.expired`) resolve the booking directly. `ChargeableItem.Category.BOOKING_FEE` allows marina-level fixed fees to be summed in the approve endpoint pricing.

- [ ] **Step 1: Write the failing test**

```python
# apps/billing/tests/test_invoice_booking.py
import datetime
from django.test import TestCase
from apps.accounts.models import Marina
from apps.billing.models import Invoice, ChargeableItem
from apps.reservations.models import Booking


def _marina():
    return Marina.objects.create(name='Test Marina')


class InvoiceBookingFKTest(TestCase):
    def test_invoice_booking_fk_is_nullable(self):
        marina = _marina()
        inv = Invoice.objects.create(marina=marina, invoice_number='INV-2026-0001')
        self.assertIsNone(inv.booking)

    def test_invoice_booking_fk_can_be_set(self):
        marina = _marina()
        booking = Booking.objects.create(
            marina=marina,
            check_in=datetime.date(2026, 7, 15),
            check_out=datetime.date(2026, 7, 22),
            status='awaiting_payment',
            booking_type='transient',
        )
        inv = Invoice.objects.create(marina=marina, invoice_number='INV-2026-0001', booking=booking)
        inv.refresh_from_db()
        self.assertEqual(inv.booking_id, booking.id)

    def test_invoice_booking_set_null_on_booking_delete(self):
        marina = _marina()
        booking = Booking.objects.create(
            marina=marina,
            check_in=datetime.date(2026, 7, 15),
            check_out=datetime.date(2026, 7, 22),
            status='awaiting_payment',
            booking_type='transient',
        )
        inv = Invoice.objects.create(marina=marina, invoice_number='INV-2026-0001', booking=booking)
        booking.delete()
        inv.refresh_from_db()
        self.assertIsNone(inv.booking)

    def test_booking_fee_category_choice_exists(self):
        marina = _marina()
        item = ChargeableItem.objects.create(
            marina=marina,
            name='Harbour Dues',
            category='booking_fee',
            pricing_model='flat_fee',
            unit_price='25.00',
        )
        self.assertEqual(item.category, 'booking_fee')
```

- [ ] **Step 2: Run the test to confirm it fails**

```
cd backend
python manage.py test apps.billing.tests.test_invoice_booking -v 2
```

Expected: `django.db.utils.OperationalError` or `TypeError` — `booking` field not found on Invoice.

- [ ] **Step 3: Add `BOOKING_FEE` to `ChargeableItem.Category` and `Invoice.booking` FK**

In `apps/billing/models.py`:

```python
class ChargeableItem(models.Model):
    class Category(models.TextChoices):
        BERTH        = 'berth',       'Berth'
        UTILITY      = 'utility',     'Utility'
        SERVICE      = 'service',     'Service'
        RETAIL       = 'retail',      'Retail'
        BOOKING_FEE  = 'booking_fee', 'Booking Fee'   # <-- add this line
```

On the `Invoice` model, add after the `pdf_document` field:

```python
    booking = models.ForeignKey(
        'reservations.Booking',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='invoices',
    )
```

- [ ] **Step 4: Generate the migration**

```
python manage.py makemigrations billing --name invoice_booking_fk
```

Expected output: `apps/billing/migrations/0009_invoice_booking_fk.py` created.

- [ ] **Step 5: Run the migration**

```
python manage.py migrate
```

- [ ] **Step 6: Run the tests to confirm they pass**

```
python manage.py test apps.billing.tests.test_invoice_booking -v 2
```

Expected: 4 tests pass.

- [ ] **Step 7: Commit**

```
git add apps/billing/models.py apps/billing/migrations/0009_invoice_booking_fk.py apps/billing/tests/test_invoice_booking.py
git commit -m "feat: add Invoice.booking FK and ChargeableItem.BOOKING_FEE category"
```

---

## Task 2: Email helpers for all 5 booking emails

**Files:**
- Create: `apps/reservations/emails.py`
- Test: `apps/reservations/tests.py` (append new test class)

### Context

5 emails are needed (see spec §5):
1. Boater → request received
2. All marina owners/managers → new request notification
3. Boater → payment link (approve)
4. Boater → rejection
5. Boater → booking confirmed + magic link (sent by webhook, magic link from `checkin_utils.make_magic_url`)

The User model has `role` and `marina` FK. `send_mail` comes from `django.core.mail`. `make_magic_url` is in `apps/portal/checkin_utils.py`.

- [ ] **Step 1: Write the failing test**

Append to `apps/reservations/tests.py`:

```python
# add these imports at the top of tests.py (check if already present):
from unittest.mock import patch
from .emails import (
    send_booking_request_boater_email,
    send_booking_request_manager_email,
    send_approve_email,
    send_reject_email,
    send_booking_confirmed_email,
)


class BookingEmailsTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.marina.name = 'Sunport Marina'
        self.marina.save()
        self.berth = make_berth(self.marina)
        self.booking = Booking.objects.create(
            marina=self.marina,
            berth=None,
            check_in=datetime.date(2026, 7, 15),
            check_out=datetime.date(2026, 7, 22),
            status='pending_approval',
            booking_type='transient',
            guest_name='J. Sailor',
            guest_email='sailor@example.com',
            boat_loa=12.5,
            boat_beam=4.2,
            boat_draft=1.8,
        )

    @patch('apps.reservations.emails.send_mail')
    def test_boater_request_received(self, mock_send):
        send_booking_request_boater_email(self.booking)
        mock_send.assert_called_once()
        _, kwargs = mock_send.call_args[0], mock_send.call_args[1] if mock_send.call_args[1] else {}
        args = mock_send.call_args[0]
        self.assertIn('Sunport Marina', args[0])
        self.assertEqual(args[3], ['sailor@example.com'])

    @patch('apps.reservations.emails.send_mail')
    def test_manager_notification_sent_to_owners_and_managers(self, mock_send):
        User.objects.create_user(email='owner@m.com', password='x', marina=self.marina, role='owner')
        User.objects.create_user(email='mgr@m.com', password='x', marina=self.marina, role='manager')
        User.objects.create_user(email='staff@m.com', password='x', marina=self.marina, role='staff')
        send_booking_request_manager_email(self.booking)
        mock_send.assert_called_once()
        recipients = mock_send.call_args[0][3]
        self.assertIn('owner@m.com', recipients)
        self.assertIn('mgr@m.com', recipients)
        self.assertNotIn('staff@m.com', recipients)

    @patch('apps.reservations.emails.send_mail')
    def test_approve_email_contains_checkout_url(self, mock_send):
        send_approve_email(self.booking, checkout_url='https://checkout.stripe.com/xyz')
        mock_send.assert_called_once()
        message = mock_send.call_args[0][1]
        self.assertIn('https://checkout.stripe.com/xyz', message)
        self.assertEqual(mock_send.call_args[0][3], ['sailor@example.com'])

    @patch('apps.reservations.emails.send_mail')
    def test_reject_email_contains_reason(self, mock_send):
        send_reject_email(self.booking, reason='No space available for your vessel size.')
        mock_send.assert_called_once()
        message = mock_send.call_args[0][1]
        self.assertIn('No space available for your vessel size.', message)
        self.assertEqual(mock_send.call_args[0][3], ['sailor@example.com'])

    @patch('apps.reservations.emails.send_mail')
    @patch('apps.reservations.emails.make_magic_url')
    def test_confirmed_email_contains_magic_link(self, mock_magic, mock_send):
        mock_magic.return_value = 'https://book.docksbase.com/sunport/portal?token=abc123'
        send_booking_confirmed_email(self.booking)
        mock_send.assert_called_once()
        message = mock_send.call_args[0][1]
        self.assertIn('abc123', message)
        mock_magic.assert_called_once_with(self.booking)
```

- [ ] **Step 2: Run the test to confirm it fails**

```
python manage.py test apps.reservations.tests.BookingEmailsTest -v 2
```

Expected: `ImportError: cannot import name 'send_booking_request_boater_email' from 'apps.reservations.emails'`.

- [ ] **Step 3: Create `apps/reservations/emails.py`**

```python
from django.conf import settings
from django.core.mail import send_mail

from apps.portal.checkin_utils import make_magic_url


def send_booking_request_boater_email(booking):
    marina = booking.marina
    nights = (booking.check_out - booking.check_in).days
    send_mail(
        subject=f'Booking request received — {marina.name}',
        message=(
            f'Hi {booking.guest_name or "there"},\n\n'
            f'We have received your booking request at {marina.name}.\n\n'
            f'Dates: {booking.check_in} – {booking.check_out} ({nights} night{"s" if nights != 1 else ""})\n'
            f'Vessel dimensions: LOA {booking.boat_loa}m × beam {booking.boat_beam}m × draft {booking.boat_draft}m\n\n'
            f'The harbour master will review your request within 24 hours.\n\n'
            f'— {marina.name}'
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[booking.guest_email],
        fail_silently=True,
    )


def send_booking_request_manager_email(booking):
    from apps.accounts.models import User
    marina = booking.marina
    recipients = list(
        User.objects.filter(marina=marina, role__in=['owner', 'manager'])
        .values_list('email', flat=True)
    )
    if not recipients:
        return
    nights = (booking.check_out - booking.check_in).days
    send_mail(
        subject=f'New booking request — {booking.guest_name or "Guest"}',
        message=(
            f'A new transient booking request has been submitted.\n\n'
            f'Guest: {booking.guest_name or "—"} ({booking.guest_email})\n'
            f'Dates: {booking.check_in} – {booking.check_out} ({nights} night{"s" if nights != 1 else ""})\n'
            f'Vessel: LOA {booking.boat_loa}m × beam {booking.boat_beam}m × draft {booking.boat_draft}m\n\n'
            f'Review in the Reservations screen: {getattr(settings, "FRONTEND_URL", "")}/reservations\n\n'
            f'— DocksBase'
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=recipients,
        fail_silently=True,
    )


def send_approve_email(booking, checkout_url):
    marina = booking.marina
    send_mail(
        subject=f'Your berth is reserved — complete payment',
        message=(
            f'Hi {booking.guest_name or "there"},\n\n'
            f'Great news! {marina.name} has assigned you a berth for '
            f'{booking.check_in} – {booking.check_out}.\n\n'
            f'Total due: {booking.amount}\n\n'
            f'Please complete your payment using the secure link below. '
            f'This link expires in 24 hours.\n\n'
            f'{checkout_url}\n\n'
            f'— {marina.name}'
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[booking.guest_email],
        fail_silently=True,
    )


def send_reject_email(booking, reason):
    marina = booking.marina
    send_mail(
        subject=f'Booking request update — {marina.name}',
        message=(
            f'Hi {booking.guest_name or "there"},\n\n'
            f'Unfortunately we are unable to accommodate your booking request '
            f'for {booking.check_in} – {booking.check_out}.\n\n'
            f'Reason: {reason}\n\n'
            f'We apologise for any inconvenience.\n\n'
            f'— {marina.name}'
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[booking.guest_email],
        fail_silently=True,
    )


def send_booking_confirmed_email(booking):
    marina = booking.marina
    magic_url = make_magic_url(booking)
    send_mail(
        subject=f'Booking confirmed — {marina.name}',
        message=(
            f'Hi {booking.guest_name or "there"},\n\n'
            f'Your booking at {marina.name} is confirmed!\n\n'
            f'Dates: {booking.check_in} – {booking.check_out}\n'
            f'Berth: {booking.berth.code if booking.berth else "—"}\n\n'
            f'Click the link below to access your pre-arrival checklist and check in:\n\n'
            f'{magic_url}\n\n'
            f'This link is personal to you and expires in 72 hours.\n\n'
            f'— {marina.name}'
        ),
        from_email=settings.DEFAULT_FROM_EMAIL,
        recipient_list=[booking.guest_email],
        fail_silently=True,
    )
```

- [ ] **Step 4: Run the tests to confirm they pass**

```
python manage.py test apps.reservations.tests.BookingEmailsTest -v 2
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```
git add apps/reservations/emails.py apps/reservations/tests.py
git commit -m "feat: add booking email helpers for manual approval flow"
```

---

## Task 3: Public booking endpoint — `POST /api/v1/public/bookings/`

**Files:**
- Create: `apps/portal/public_booking_views.py`
- Modify: `apps/portal/public_urls.py`
- Test: `apps/portal/tests.py` (append new test class)

### Context

This endpoint is unauthenticated. Tenant resolution is via the `TenantMiddleware` which reads `X-Marina-Slug` or `X-Marina-Domain` header and sets `request.tenant`. The endpoint creates a `pending_approval` booking with `berth=null` and sends 2 emails.

Date validation: `check_in < check_out` and `check_in >= today`. Field validation: all of `check_in`, `check_out`, `guest_name`, `guest_email`, `boat_loa`, `boat_beam`, `boat_draft` are required.

- [ ] **Step 1: Write the failing test**

Append to `apps/portal/tests.py`:

```python
import datetime
from unittest.mock import patch
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.reservations.models import Booking


class PublicBookingCreateTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina', slug='test-marina', booking_mode='manual_approval')
        self.client = APIClient()
        self.url = '/api/v1/public/bookings/'
        self.payload = {
            'check_in': '2026-07-15',
            'check_out': '2026-07-22',
            'guest_name': 'J. Sailor',
            'guest_email': 'sailor@example.com',
            'boat_loa': 12.5,
            'boat_beam': 4.2,
            'boat_draft': 1.8,
        }

    def _post(self, payload=None, slug='test-marina'):
        return self.client.post(
            self.url,
            payload or self.payload,
            format='json',
            HTTP_X_MARINA_SLUG=slug,
        )

    @patch('apps.portal.public_booking_views.send_booking_request_boater_email')
    @patch('apps.portal.public_booking_views.send_booking_request_manager_email')
    def test_creates_pending_approval_booking(self, mock_mgr, mock_boater):
        resp = self._post()
        self.assertEqual(resp.status_code, 201)
        booking = Booking.objects.get(pk=resp.data['booking_id'])
        self.assertEqual(booking.status, 'pending_approval')
        self.assertIsNone(booking.berth)
        self.assertEqual(booking.booking_type, 'transient')
        self.assertEqual(booking.marina, self.marina)
        mock_boater.assert_called_once_with(booking)
        mock_mgr.assert_called_once_with(booking)

    @patch('apps.portal.public_booking_views.send_booking_request_boater_email')
    @patch('apps.portal.public_booking_views.send_booking_request_manager_email')
    def test_returns_booking_id_and_message(self, mock_mgr, mock_boater):
        resp = self._post()
        self.assertEqual(resp.status_code, 201)
        self.assertIn('booking_id', resp.data)
        self.assertIn('message', resp.data)

    def test_missing_field_returns_400(self):
        payload = {**self.payload}
        del payload['guest_email']
        resp = self._post(payload)
        self.assertEqual(resp.status_code, 400)
        self.assertIn('guest_email', resp.data)

    def test_check_in_not_before_check_out_returns_400(self):
        payload = {**self.payload, 'check_in': '2026-07-22', 'check_out': '2026-07-15'}
        resp = self._post(payload)
        self.assertEqual(resp.status_code, 400)

    def test_unknown_marina_slug_returns_404(self):
        resp = self._post(slug='nonexistent-marina')
        self.assertEqual(resp.status_code, 404)

    def test_no_slug_header_returns_400_or_404(self):
        resp = self.client.post(self.url, self.payload, format='json')
        self.assertIn(resp.status_code, [400, 404])
```

- [ ] **Step 2: Run the test to confirm it fails**

```
python manage.py test apps.portal.tests.PublicBookingCreateTest -v 2
```

Expected: `404` for all requests — endpoint not yet registered.

- [ ] **Step 3: Create `apps/portal/public_booking_views.py`**

```python
import datetime

from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework import status

from apps.reservations.models import Booking
from apps.reservations.emails import (
    send_booking_request_boater_email,
    send_booking_request_manager_email,
)


class PublicBookingRequestSerializer(serializers.Serializer):
    check_in = serializers.DateField()
    check_out = serializers.DateField()
    guest_name = serializers.CharField(max_length=200)
    guest_email = serializers.EmailField()
    boat_loa = serializers.DecimalField(max_digits=6, decimal_places=2)
    boat_beam = serializers.DecimalField(max_digits=5, decimal_places=2)
    boat_draft = serializers.DecimalField(max_digits=5, decimal_places=2)

    def validate(self, data):
        if data['check_in'] >= data['check_out']:
            raise serializers.ValidationError({'check_out': 'check_out must be after check_in.'})
        if data['check_in'] < datetime.date.today():
            raise serializers.ValidationError({'check_in': 'check_in cannot be in the past.'})
        return data


class PublicBookingCreateView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        if request.tenant is None:
            return Response({'detail': 'Marina not found.'}, status=status.HTTP_404_NOT_FOUND)

        ser = PublicBookingRequestSerializer(data=request.data)
        if not ser.is_valid():
            return Response(ser.errors, status=status.HTTP_400_BAD_REQUEST)

        d = ser.validated_data
        booking = Booking.objects.create(
            marina=request.tenant,
            check_in=d['check_in'],
            check_out=d['check_out'],
            nights=(d['check_out'] - d['check_in']).days,
            guest_name=d['guest_name'],
            guest_email=d['guest_email'],
            boat_loa=d['boat_loa'],
            boat_beam=d['boat_beam'],
            boat_draft=d['boat_draft'],
            status='pending_approval',
            booking_type='transient',
        )

        send_booking_request_boater_email(booking)
        send_booking_request_manager_email(booking)

        return Response(
            {
                'booking_id': booking.id,
                'message': 'Request received. The harbour master will review within 24 hours.',
            },
            status=status.HTTP_201_CREATED,
        )
```

- [ ] **Step 4: Register the URL in `apps/portal/public_urls.py`**

```python
from django.urls import path
from apps.portal.views import MarinaPublicView
from apps.portal.public_booking_views import PublicBookingCreateView

urlpatterns = [
    path('marina/', MarinaPublicView.as_view(), name='public-marina'),
    path('bookings/', PublicBookingCreateView.as_view(), name='public-booking-create'),
]
```

- [ ] **Step 5: Run the tests to confirm they pass**

```
python manage.py test apps.portal.tests.PublicBookingCreateTest -v 2
```

Expected: 6 tests pass.

- [ ] **Step 6: Run full test suite to check for regressions**

```
python manage.py test --verbosity=1
```

Expected: all existing tests still pass.

- [ ] **Step 7: Commit**

```
git add apps/portal/public_booking_views.py apps/portal/public_urls.py apps/portal/tests.py
git commit -m "feat: add public booking request endpoint POST /api/v1/public/bookings/"
```

---

## Task 4: Approve endpoint — `POST /api/v1/bookings/<id>/approve/`

**Files:**
- Modify: `apps/reservations/views.py`
- Modify: `apps/reservations/urls.py`
- Test: `apps/reservations/tests.py` (append new test class)

### Context

The approve endpoint:
1. Validates `booking.status == 'pending_approval'` and `berth.marina == booking.marina`.
2. Runs a **collision check**: queries bookings where `berth=requested_berth` AND `status in ('awaiting_payment', 'confirmed', 'checked_in')` AND date ranges overlap (`check_in < requested.check_out AND check_out > requested.check_in`). Returns 409 on collision. No state change, no Stripe session created.
3. Calculates price: `nights × berth.pricing_tier.unit_price + sum(booking_fee ChargeableItems for marina)`.
4. Sets `booking.amount`, `booking.berth`, `booking.status = 'awaiting_payment'`.
5. Creates Invoice, adds berth line item, adds one line item per `booking_fee` ChargeableItem.
6. Sets `invoice.booking = booking`.
7. Finalizes invoice and creates Stripe Checkout session.
8. Emails boater the checkout link.
9. Returns `200 { checkout_url }`.

The `billing_service.create_invoice`, `billing_service.add_line_item`, `billing_service.finalize_invoice`, and `billing_service.create_stripe_checkout_session` functions are all available in `apps/billing/service.py`. The `Invoice` model now has a `booking` FK.

- [ ] **Step 1: Write the failing test**

Append to `apps/reservations/tests.py`:

```python
from unittest.mock import patch
from apps.billing.models import Invoice, ChargeableItem


class ApproveBookingViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.berth = make_berth(self.marina, price=100)
        self.berth.length_m = 15
        self.berth.max_beam_m = 5
        self.berth.max_draft_m = 2
        self.berth.save()
        self.booking = Booking.objects.create(
            marina=self.marina,
            check_in=datetime.date(2026, 7, 15),
            check_out=datetime.date(2026, 7, 22),
            nights=7,
            status='pending_approval',
            booking_type='transient',
            guest_name='J. Sailor',
            guest_email='sailor@example.com',
            boat_loa=12.5,
            boat_beam=4.2,
            boat_draft=1.8,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.url = f'/api/v1/bookings/{self.booking.pk}/approve/'

    @patch('apps.reservations.views.send_approve_email')
    @patch('apps.billing.service.create_stripe_checkout_session', return_value='https://stripe.com/pay/xyz')
    def test_approve_assigns_berth_and_returns_checkout_url(self, mock_stripe, mock_email):
        resp = self.client.post(self.url, {'berth_id': self.berth.pk}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('checkout_url', resp.data)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, 'awaiting_payment')
        self.assertEqual(self.booking.berth, self.berth)
        self.assertIsNotNone(self.booking.amount)
        mock_email.assert_called_once()

    @patch('apps.reservations.views.send_approve_email')
    @patch('apps.billing.service.create_stripe_checkout_session', return_value='https://stripe.com/pay/xyz')
    def test_approve_sets_invoice_booking_fk(self, mock_stripe, mock_email):
        self.client.post(self.url, {'berth_id': self.berth.pk}, format='json')
        invoice = Invoice.objects.get(source_type='berth_booking', source_id=str(self.booking.pk))
        self.assertEqual(invoice.booking_id, self.booking.pk)

    @patch('apps.reservations.views.send_approve_email')
    @patch('apps.billing.service.create_stripe_checkout_session', return_value='https://stripe.com/pay/xyz')
    def test_approve_includes_booking_fee_in_amount(self, mock_stripe, mock_email):
        ChargeableItem.objects.create(
            marina=self.marina, name='Harbour Dues', category='booking_fee',
            pricing_model='flat_fee', unit_price='30.00',
        )
        resp = self.client.post(self.url, {'berth_id': self.berth.pk}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        expected = 100 * 7 + 30  # berth_cost + harbour_dues
        self.assertEqual(float(self.booking.amount), expected)

    def test_approve_returns_409_on_berth_collision(self):
        # Create a conflicting booking on the same berth
        Booking.objects.create(
            marina=self.marina,
            berth=self.berth,
            check_in=datetime.date(2026, 7, 18),
            check_out=datetime.date(2026, 7, 25),
            status='confirmed',
            booking_type='transient',
        )
        resp = self.client.post(self.url, {'berth_id': self.berth.pk}, format='json')
        self.assertEqual(resp.status_code, 409)
        # Booking must not have changed
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, 'pending_approval')
        self.assertIsNone(self.booking.berth)

    def test_approve_returns_400_if_not_pending_approval(self):
        self.booking.status = 'awaiting_payment'
        self.booking.save()
        resp = self.client.post(self.url, {'berth_id': self.berth.pk}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_approve_returns_400_if_berth_from_different_marina(self):
        other_marina = Marina.objects.create(name='Other Marina')
        other_berth = make_berth(other_marina)
        resp = self.client.post(self.url, {'berth_id': other_berth.pk}, format='json')
        self.assertEqual(resp.status_code, 400)


class RejectBookingViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.booking = Booking.objects.create(
            marina=self.marina,
            check_in=datetime.date(2026, 7, 15),
            check_out=datetime.date(2026, 7, 22),
            status='pending_approval',
            booking_type='transient',
            guest_name='J. Sailor',
            guest_email='sailor@example.com',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.url = f'/api/v1/bookings/{self.booking.pk}/reject/'

    @patch('apps.reservations.views.send_reject_email')
    def test_reject_sets_cancelled_status(self, mock_email):
        resp = self.client.post(self.url, {'reason': 'No space available.'}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, 'cancelled')
        mock_email.assert_called_once_with(self.booking, reason='No space available.')

    @patch('apps.reservations.views.send_reject_email')
    def test_reject_returns_400_if_not_pending_approval(self, mock_email):
        self.booking.status = 'confirmed'
        self.booking.save()
        resp = self.client.post(self.url, {'reason': 'No space.'}, format='json')
        self.assertEqual(resp.status_code, 400)
        mock_email.assert_not_called()
```

- [ ] **Step 2: Run the tests to confirm they fail**

```
python manage.py test apps.reservations.tests.ApproveBookingViewTest apps.reservations.tests.RejectBookingViewTest -v 2
```

Expected: `404` — endpoints not yet registered.

- [ ] **Step 3: Add `ApproveBookingView` and `RejectBookingView` to `apps/reservations/views.py`**

Add these imports at the top of `views.py` (after existing imports):

```python
from django.db.models import Sum
from apps.billing.models import ChargeableItem, Invoice as InvoiceModel
from .emails import send_approve_email, send_reject_email
```

Add these two view classes after `AssignBerthView`:

```python
class ApproveBookingView(APIView):
    """
    POST /api/v1/bookings/<pk>/approve/   { "berth_id": 42 }
    Manager assigns berth + sends Stripe payment link. Collision-safe.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            booking = Booking.objects.get(pk=pk, marina=request.user.marina)
        except Booking.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        if booking.status != 'pending_approval':
            return Response(
                {'detail': 'Booking is not pending approval.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        berth_id = request.data.get('berth_id')
        if not berth_id:
            return Response({'detail': 'berth_id is required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        try:
            berth = Berth.objects.get(pk=berth_id, marina=request.user.marina)
        except Berth.DoesNotExist:
            return Response(
                {'detail': 'Berth does not belong to this marina.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        # Collision check: overlapping bookings on the same berth
        collision = Booking.objects.filter(
            berth=berth,
            status__in=('awaiting_payment', 'confirmed', 'checked_in'),
            check_in__lt=booking.check_out,
            check_out__gt=booking.check_in,
        ).exists()
        if collision:
            return Response(
                {'detail': 'Berth is already booked for these dates.'},
                status=http_status.HTTP_409_CONFLICT,
            )

        marina = request.user.marina
        nights = booking.nights or (booking.check_out - booking.check_in).days or 1
        berth_cost = berth.pricing_tier.unit_price * nights
        fees = ChargeableItem.objects.filter(
            marina=marina, category='booking_fee'
        ).aggregate(total=Sum('unit_price'))['total'] or 0
        total = berth_cost + fees

        nights_label = f'{nights} night{"s" if nights != 1 else ""}'
        due_date = datetime.date.today() + datetime.timedelta(days=marina.payment_terms)

        try:
            with transaction.atomic():
                booking.berth = berth
                booking.amount = total
                booking.status = 'awaiting_payment'
                booking.save(update_fields=['berth', 'amount', 'status'])

                inv = billing_service.create_invoice(
                    marina,
                    source_type='berth_booking',
                    source_id=str(booking.id),
                    due_date=due_date,
                )
                billing_service.add_line_item(
                    inv,
                    description=f'Berth {berth.code} — {nights_label} @ {berth.pricing_tier.unit_price}/night',
                    quantity=1,
                    unit_price=berth_cost,
                )
                for fee_item in ChargeableItem.objects.filter(marina=marina, category='booking_fee'):
                    billing_service.add_line_item(
                        inv,
                        description=fee_item.name,
                        quantity=1,
                        unit_price=fee_item.unit_price,
                    )
                billing_service.finalize_invoice(inv)

                inv.booking = booking
                inv.save(update_fields=['booking'])

                checkout_url = billing_service.create_stripe_checkout_session(inv)
        except Exception:
            return Response(
                {'detail': 'Payment provider error. Please try again.'},
                status=http_status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        send_approve_email(booking, checkout_url=checkout_url)
        return Response({'checkout_url': checkout_url}, status=http_status.HTTP_200_OK)


class RejectBookingView(APIView):
    """
    POST /api/v1/bookings/<pk>/reject/   { "reason": "..." }
    Manager rejects a pending_approval booking.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            booking = Booking.objects.get(pk=pk, marina=request.user.marina)
        except Booking.DoesNotExist:
            return Response({'detail': 'Not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        if booking.status != 'pending_approval':
            return Response(
                {'detail': 'Booking is not pending approval.'},
                status=http_status.HTTP_400_BAD_REQUEST,
            )

        reason = request.data.get('reason', '')
        booking.status = 'cancelled'
        booking.save(update_fields=['status'])

        send_reject_email(booking, reason=reason)
        return Response({'detail': 'Booking rejected.'}, status=http_status.HTTP_200_OK)
```

- [ ] **Step 4: Register the URLs in `apps/reservations/urls.py`**

```python
from django.urls import path
from .views import (
    BookingListCreateView, BookingDetailView,
    BookingRequestListCreateView, BookingRequestDetailView,
    ConvertBookingRequestView,
    AvailableBerthsView,
    BookingEngineRequestView,
    AssignBerthView,
    ApproveBookingView,
    RejectBookingView,
)

urlpatterns = [
    path('bookings/available-berths/',              AvailableBerthsView.as_view(),          name='available_berths'),
    path('bookings/engine-request/',                BookingEngineRequestView.as_view(),     name='booking_engine_request'),
    path('bookings/',                               BookingListCreateView.as_view(),        name='booking_list'),
    path('bookings/<int:pk>/',                      BookingDetailView.as_view(),            name='booking_detail'),
    path('bookings/<int:pk>/assign-berth/',         AssignBerthView.as_view(),              name='assign_berth'),
    path('bookings/<int:pk>/approve/',              ApproveBookingView.as_view(),           name='approve_booking'),
    path('bookings/<int:pk>/reject/',               RejectBookingView.as_view(),            name='reject_booking'),
    path('booking-requests/',                       BookingRequestListCreateView.as_view(), name='booking_request_list'),
    path('booking-requests/<int:pk>/',              BookingRequestDetailView.as_view(),     name='booking_request_detail'),
    path('booking-requests/<int:pk>/convert/',      ConvertBookingRequestView.as_view(),    name='booking_request_convert'),
]
```

- [ ] **Step 5: Run the tests to confirm they pass**

```
python manage.py test apps.reservations.tests.ApproveBookingViewTest apps.reservations.tests.RejectBookingViewTest -v 2
```

Expected: all 9 tests pass.

- [ ] **Step 6: Run full test suite to check for regressions**

```
python manage.py test --verbosity=1
```

- [ ] **Step 7: Commit**

```
git add apps/reservations/views.py apps/reservations/urls.py apps/reservations/tests.py
git commit -m "feat: add approve and reject booking endpoints with collision check"
```

---

## Task 5: Berth `capable_for` query param — `GET /api/v1/berths/?capable_for=<booking_id>`

**Files:**
- Modify: `apps/berths/views.py`
- Test: `apps/reservations/tests.py` (append new test class — uses the berths endpoint)

### Context

`ApproveModal` in the frontend needs a filtered list of berths that physically fit the boat dimensions of a specific booking. `capable_for=<booking_id>` tells the server to read the booking's `boat_loa`, `boat_beam`, `boat_draft` and filter berths accordingly. No date-conflict filtering — the manager uses their own judgement for availability at this stage (Spec 2 will add the algorithm).

The `BerthListCreateView` is at `GET /api/v1/berths/` and is already authenticated. We add the `capable_for` param to `get_queryset`.

- [ ] **Step 1: Write the failing test**

Append to `apps/reservations/tests.py`:

```python
class BerthCapableForTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        # Create two berths: one fits the boat, one doesn't
        pier = Pier.objects.create(marina=self.marina, code='P', label='Pier P')
        tier = ChargeableItem.objects.create(
            marina=self.marina, name='Berth Night', category='berth',
            pricing_model='per_night', unit_price=80,
        )
        self.big_berth = Berth.objects.create(
            marina=self.marina, pier=pier, code='B1', pricing_tier=tier,
            length_m=20, max_beam_m=6, max_draft_m=3, status='available',
        )
        self.small_berth = Berth.objects.create(
            marina=self.marina, pier=pier, code='B2', pricing_tier=tier,
            length_m=8, max_beam_m=3, max_draft_m=1, status='available',
        )
        self.booking = Booking.objects.create(
            marina=self.marina,
            check_in=datetime.date(2026, 7, 15),
            check_out=datetime.date(2026, 7, 22),
            status='pending_approval',
            booking_type='transient',
            boat_loa=12.5,
            boat_beam=4.2,
            boat_draft=1.8,
        )

    def test_capable_for_returns_only_fitting_berths(self):
        resp = self.client.get(f'/api/v1/berths/?capable_for={self.booking.pk}')
        self.assertEqual(resp.status_code, 200)
        ids = [b['id'] for b in resp.data]
        self.assertIn(self.big_berth.pk, ids)
        self.assertNotIn(self.small_berth.pk, ids)

    def test_capable_for_unknown_booking_returns_400(self):
        resp = self.client.get('/api/v1/berths/?capable_for=99999')
        self.assertEqual(resp.status_code, 400)

    def test_without_capable_for_returns_all_berths(self):
        resp = self.client.get('/api/v1/berths/')
        self.assertEqual(resp.status_code, 200)
        ids = [b['id'] for b in resp.data]
        self.assertIn(self.big_berth.pk, ids)
        self.assertIn(self.small_berth.pk, ids)
```

- [ ] **Step 2: Run the test to confirm it fails**

```
python manage.py test apps.reservations.tests.BerthCapableForTest -v 2
```

Expected: `test_capable_for_returns_only_fitting_berths` fails — no filter applied.

- [ ] **Step 3: Modify `BerthListCreateView.get_queryset()` in `apps/berths/views.py`**

```python
class BerthListCreateView(generics.ListCreateAPIView):
    serializer_class = BerthSerializer
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['status', 'pier', 'berth_type']

    def get_queryset(self):
        from rest_framework.exceptions import ValidationError
        from apps.reservations.models import Booking

        qs = (Berth.objects
              .filter(marina=self.request.user.marina)
              .select_related('pier', 'vessel')
              .prefetch_related('bookings'))

        capable_for = self.request.query_params.get('capable_for')
        if capable_for:
            try:
                booking = Booking.objects.get(pk=int(capable_for), marina=self.request.user.marina)
            except (Booking.DoesNotExist, ValueError):
                raise ValidationError({'capable_for': 'Booking not found.'})
            if booking.boat_loa:
                qs = qs.filter(length_m__gte=booking.boat_loa)
            if booking.boat_beam:
                qs = qs.filter(max_beam_m__gte=booking.boat_beam)
            if booking.boat_draft:
                qs = qs.filter(max_draft_m__gte=booking.boat_draft)

        return qs
```

- [ ] **Step 4: Run the tests to confirm they pass**

```
python manage.py test apps.reservations.tests.BerthCapableForTest -v 2
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```
git add apps/berths/views.py apps/reservations/tests.py
git commit -m "feat: add capable_for query param to berths list endpoint"
```

---

## Task 6: Extend Stripe webhook — booking confirmation + expired berth release

**Files:**
- Modify: `apps/billing/views.py`
- Test: `apps/billing/tests/test_stripe_webhook.py` (create new file)

### Context

`StripeWebhookView` currently:
- `checkout.session.completed` → marks invoice paid, fires `invoice_paid` signal, generates PDF.
- `checkout.session.expired` → clears `invoice.stripe_checkout_session_id`.

Extension needed:
- `checkout.session.completed` → additionally: if `invoice.booking` is set, set `booking.status = 'confirmed'`, call `send_booking_confirmed_email(booking)`.
- `checkout.session.expired` → additionally: if `invoice.booking` is set, set `booking.status = 'cancelled'` AND `booking.berth = null` (berth released back to inventory).

The booking operations happen AFTER the existing invoice operations (invoice is already paid/cleared before touching booking).

- [ ] **Step 1: Write the failing test**

```python
# apps/billing/tests/test_stripe_webhook.py
import datetime
import json
from unittest.mock import MagicMock, patch
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina
from apps.billing.models import Invoice
from apps.berths.models import Pier, Berth
from apps.billing.models import ChargeableItem
from apps.reservations.models import Booking


def _setup():
    marina = Marina.objects.create(name='Test Marina', stripe_webhook_secret='whsec_test')
    tier = ChargeableItem.objects.create(
        marina=marina, name='Berth Night', category='berth',
        pricing_model='per_night', unit_price=100,
    )
    pier = Pier.objects.create(marina=marina, code='A', label='Pier A')
    berth = Berth.objects.create(marina=marina, pier=pier, code='A1', pricing_tier=tier)
    booking = Booking.objects.create(
        marina=marina,
        berth=berth,
        check_in=datetime.date(2026, 7, 15),
        check_out=datetime.date(2026, 7, 22),
        status='awaiting_payment',
        booking_type='transient',
        guest_name='J. Sailor',
        guest_email='sailor@example.com',
    )
    invoice = Invoice.objects.create(
        marina=marina,
        invoice_number='INV-2026-0001',
        status='open',
        booking=booking,
    )
    return marina, booking, invoice, berth


def _make_stripe_event(event_type, invoice_id):
    return {
        'type': event_type,
        'data': {
            'object': {
                'metadata': {'invoice_id': str(invoice_id)},
                'payment_intent': 'pi_test',
            }
        }
    }


class StripeWebhookBookingTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina, self.booking, self.invoice, self.berth = _setup()

    @patch('apps.billing.views.send_booking_confirmed_email')
    @patch('apps.billing.views._stripe_svc.stripe.Webhook.construct_event')
    def test_checkout_completed_confirms_booking_and_sends_magic_link(self, mock_event, mock_email):
        mock_event.return_value = _make_stripe_event('checkout.session.completed', self.invoice.id)
        resp = self.client.post(
            '/api/v1/billing/stripe/webhook/',
            data=json.dumps({}),
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='sig',
        )
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, 'confirmed')
        mock_email.assert_called_once_with(self.booking)

    @patch('apps.billing.views._stripe_svc.stripe.Webhook.construct_event')
    def test_checkout_expired_cancels_booking_and_releases_berth(self, mock_event):
        mock_event.return_value = _make_stripe_event('checkout.session.expired', self.invoice.id)
        resp = self.client.post(
            '/api/v1/billing/stripe/webhook/',
            data=json.dumps({}),
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='sig',
        )
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.status, 'cancelled')
        self.assertIsNone(self.booking.berth)

    @patch('apps.billing.views._stripe_svc.stripe.Webhook.construct_event')
    def test_checkout_completed_without_booking_fk_still_marks_invoice_paid(self, mock_event):
        # Invoice with no booking FK — original flow must still work
        invoice_no_booking = Invoice.objects.create(
            marina=self.marina,
            invoice_number='INV-2026-0002',
            status='open',
        )
        mock_event.return_value = _make_stripe_event('checkout.session.completed', invoice_no_booking.id)
        resp = self.client.post(
            '/api/v1/billing/stripe/webhook/',
            data=json.dumps({}),
            content_type='application/json',
            HTTP_STRIPE_SIGNATURE='sig',
        )
        self.assertEqual(resp.status_code, 200)
        invoice_no_booking.refresh_from_db()
        self.assertEqual(invoice_no_booking.status, 'paid')
```

- [ ] **Step 2: Run the test to confirm it fails**

```
python manage.py test apps.billing.tests.test_stripe_webhook -v 2
```

Expected: `test_checkout_completed_confirms_booking_and_sends_magic_link` fails — booking still `awaiting_payment`.

- [ ] **Step 3: Extend `StripeWebhookView` in `apps/billing/views.py`**

Add the import at the top of `apps/billing/views.py`:

```python
from apps.reservations.emails import send_booking_confirmed_email
```

Then update the `post` method — replace the `if event_type == 'checkout.session.completed':` block:

```python
        if event_type == 'checkout.session.completed':
            updated = Invoice.objects.filter(pk=invoice.pk, status='open').update(
                stripe_payment_intent_id=obj.get('payment_intent', ''),
                status='paid',
                paid_at=timezone.now(),
            )
            if updated:
                invoice.refresh_from_db()
                invoice_paid.send(sender=Invoice, invoice=invoice)
                threading.Thread(
                    target=_generate_store_and_email_pdf,
                    args=(invoice.id,),
                    daemon=True,
                ).start()
                if invoice.booking_id:
                    from apps.reservations.models import Booking as BookingModel
                    BookingModel.objects.filter(pk=invoice.booking_id).update(status='confirmed')
                    invoice.booking.refresh_from_db()
                    send_booking_confirmed_email(invoice.booking)

        elif event_type == 'checkout.session.expired':
            invoice.stripe_checkout_session_id = ''
            invoice.save(update_fields=['stripe_checkout_session_id'])
            if invoice.booking_id:
                from apps.reservations.models import Booking as BookingModel
                BookingModel.objects.filter(pk=invoice.booking_id).update(
                    status='cancelled', berth=None
                )
```

- [ ] **Step 4: Run the tests to confirm they pass**

```
python manage.py test apps.billing.tests.test_stripe_webhook -v 2
```

Expected: 3 tests pass.

- [ ] **Step 5: Run full test suite**

```
python manage.py test --verbosity=1
```

- [ ] **Step 6: Commit**

```
git add apps/billing/views.py apps/billing/tests/test_stripe_webhook.py
git commit -m "feat: extend Stripe webhook to confirm booking and release berth on expiry"
```

---

## Task 7: Manager UI — Pending tab + ApproveModal

**Files:**
- Create: `frontend/src/components/reservations/PendingRequestsTab.jsx`
- Create: `frontend/src/components/reservations/ApproveModal.jsx`
- Modify: `frontend/src/screens/Reservations.jsx`

### Context

`Reservations.jsx` already has a `filterMap` and a `bookingTabs` array that drives the tab bar. We need to add a distinct "Pending Requests" tab that shows `pending_approval` bookings with a count badge and an approve/reject side panel — different UX from the existing booking list rows.

The `ApproveModal` calls `GET /api/v1/berths/?capable_for=<booking_id>` (Task 5) to populate the berth picker, then `POST /api/v1/bookings/<id>/approve/` to confirm.

The reject action is a simpler inline flow directly in `PendingRequestsTab`.

Note: This is a frontend task with no automated tests in the backend suite. Verify manually by running the dev server and opening the Reservations screen.

- [ ] **Step 1: Create `PendingRequestsTab.jsx`**

```jsx
// frontend/src/components/reservations/PendingRequestsTab.jsx
import { useState, useEffect } from 'react';
import api from '../../api.js';
import ApproveModal from './ApproveModal.jsx';

function timeSince(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3_600_000);
  if (h < 1) return 'just now';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function PendingRequestsTab({ onApproved }) {
  const [bookings, setBookings] = useState([]);
  const [selected, setSelected] = useState(null);
  const [approving, setApproving] = useState(false);
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectReason, setRejectReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.get('/bookings/', { params: { status: 'pending_approval' } })
      .then(r => setBookings(
        [...r.data].sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      ));

  useEffect(() => { load(); }, []);

  const handleReject = async () => {
    setBusy(true);
    try {
      await api.post(`/bookings/${rejectTarget.id}/reject/`, { reason: rejectReason });
      setRejectTarget(null);
      setRejectReason('');
      setSelected(null);
      load();
    } finally {
      setBusy(false);
    }
  };

  const cell = { padding: '8px 12px', fontSize: 13, borderBottom: '1px solid rgba(0,0,0,0.06)' };
  const row = (b) => ({
    display: 'contents',
    cursor: 'pointer',
    background: selected?.id === b.id ? 'rgba(37,99,235,0.06)' : 'transparent',
  });

  if (bookings.length === 0) {
    return <div style={{ padding: 32, color: 'rgba(0,0,0,0.4)', textAlign: 'center' }}>No pending requests.</div>;
  }

  return (
    <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
      {/* List */}
      <div style={{ flex: 1, overflowX: 'auto' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 2fr 2fr 1fr', borderTop: '1px solid rgba(0,0,0,0.1)' }}>
          {['Guest', 'Dates', 'Dimensions', 'Submitted'].map(h => (
            <div key={h} style={{ ...cell, fontWeight: 600, fontSize: 11, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase' }}>{h}</div>
          ))}
          {bookings.map(b => (
            <div key={b.id} style={row(b)} onClick={() => setSelected(b)}>
              <div style={cell}>{b.guest_name || '—'}</div>
              <div style={cell}>{b.check_in} – {b.check_out}</div>
              <div style={cell}>{b.boat_loa}m × {b.boat_beam}m × {b.boat_draft}m</div>
              <div style={cell}>{timeSince(b.created_at)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Side panel */}
      {selected && (
        <div style={{ width: 320, border: '1px solid rgba(0,0,0,0.12)', borderRadius: 8, padding: 20, flexShrink: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 12 }}>{selected.guest_name}</div>
          <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.6)', marginBottom: 4 }}>{selected.guest_email}</div>
          <div style={{ fontSize: 13, marginBottom: 4 }}>{selected.check_in} – {selected.check_out}</div>
          <div style={{ fontSize: 13, marginBottom: 16 }}>
            LOA {selected.boat_loa}m · Beam {selected.boat_beam}m · Draft {selected.boat_draft}m
          </div>

          <button
            onClick={() => setApproving(true)}
            style={{ width: '100%', padding: '10px 0', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer', marginBottom: 8 }}
          >
            Approve…
          </button>

          {rejectTarget?.id === selected.id ? (
            <div>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="Reason for rejection…"
                rows={3}
                style={{ width: '100%', boxSizing: 'border-box', padding: 8, fontSize: 13, border: '1px solid rgba(0,0,0,0.2)', borderRadius: 4, marginBottom: 8, resize: 'vertical' }}
              />
              <button
                onClick={handleReject}
                disabled={busy || !rejectReason.trim()}
                style={{ width: '100%', padding: '8px 0', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}
              >
                {busy ? 'Sending…' : 'Send Rejection'}
              </button>
              <button
                onClick={() => setRejectTarget(null)}
                style={{ width: '100%', padding: '6px 0', marginTop: 6, background: 'none', border: '1px solid rgba(0,0,0,0.15)', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setRejectTarget(selected)}
              style={{ width: '100%', padding: '8px 0', background: 'none', border: '1px solid #dc2626', color: '#dc2626', borderRadius: 6, fontWeight: 600, cursor: 'pointer' }}
            >
              Reject
            </button>
          )}
        </div>
      )}

      {approving && (
        <ApproveModal
          booking={selected}
          onClose={() => setApproving(false)}
          onApproved={() => { setApproving(false); setSelected(null); load(); onApproved?.(); }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `ApproveModal.jsx`**

```jsx
// frontend/src/components/reservations/ApproveModal.jsx
import { useState, useEffect } from 'react';
import api from '../../api.js';

export default function ApproveModal({ booking, onClose, onApproved }) {
  const [berths, setBerths] = useState([]);
  const [selectedBerth, setSelectedBerth] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const nights = Math.round(
    (new Date(booking.check_out) - new Date(booking.check_in)) / 86_400_000
  );

  useEffect(() => {
    api.get('/berths/', { params: { capable_for: booking.id } })
      .then(r => setBerths(r.data))
      .catch(() => setError('Could not load berths.'));
  }, [booking.id]);

  useEffect(() => {
    if (!selectedBerth) { setPreview(null); return; }
    api.get('/billing/service-catalog/', { params: { category: 'booking_fee' } })
      .then(r => {
        const fees = r.data.reduce((sum, f) => sum + parseFloat(f.unit_price), 0);
        const berth_cost = parseFloat(selectedBerth.pricing_tier_price || 0) * nights;
        setPreview({ berth_cost, fees, total: berth_cost + fees });
      })
      .catch(() => setPreview(null));
  }, [selectedBerth, nights]);

  const handleConfirm = async () => {
    if (!selectedBerth) return;
    setBusy(true);
    setError('');
    try {
      const resp = await api.post(`/bookings/${booking.id}/approve/`, { berth_id: selectedBerth.id });
      onApproved(resp.data.checkout_url);
    } catch (e) {
      setError(e.response?.data?.detail || 'Approval failed. Please try again.');
      setBusy(false);
    }
  };

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 };
  const modal = { background: '#fff', borderRadius: 12, padding: 28, width: 420, maxHeight: '90vh', overflowY: 'auto' };

  return (
    <div style={overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={modal}>
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>Approve Booking</div>
        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.5)', marginBottom: 20 }}>
          {booking.guest_name} · {booking.check_in} – {booking.check_out} ({nights} night{nights !== 1 ? 's' : ''})
        </div>

        <label style={{ display: 'block', fontWeight: 600, fontSize: 12, marginBottom: 6, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase' }}>
          Select Berth
        </label>
        <select
          value={selectedBerth?.id || ''}
          onChange={e => setSelectedBerth(berths.find(b => b.id === +e.target.value) || null)}
          style={{ width: '100%', padding: '9px 10px', fontSize: 14, border: '1px solid rgba(0,0,0,0.2)', borderRadius: 6, marginBottom: 16 }}
        >
          <option value="">— choose a berth —</option>
          {berths.map(b => (
            <option key={b.id} value={b.id}>
              {b.code}{b.pier_code ? ` (${b.pier_code})` : ''} — {b.length_m}m × {b.max_beam_m}m
            </option>
          ))}
        </select>

        {preview && (
          <div style={{ background: '#f8fafc', borderRadius: 8, padding: 14, marginBottom: 16, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span>Berth ({nights} nights)</span>
              <span>€{preview.berth_cost.toFixed(2)}</span>
            </div>
            {preview.fees > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span>Marina fees</span>
                <span>€{preview.fees.toFixed(2)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, borderTop: '1px solid rgba(0,0,0,0.1)', paddingTop: 8, marginTop: 4 }}>
              <span>Total</span>
              <span>€{preview.total.toFixed(2)}</span>
            </div>
          </div>
        )}

        {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: '10px 0', background: 'none', border: '1px solid rgba(0,0,0,0.2)', borderRadius: 6, cursor: 'pointer', fontSize: 14 }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!selectedBerth || busy}
            style={{ flex: 2, padding: '10px 0', background: selectedBerth ? '#1d4ed8' : '#94a3b8', color: '#fff', border: 'none', borderRadius: 6, fontWeight: 600, cursor: selectedBerth ? 'pointer' : 'not-allowed', fontSize: 14 }}
          >
            {busy ? 'Processing…' : 'Confirm & Send Payment Link'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

**Note on price preview:** The `ApproveModal` fetches `booking_fee` items from `/api/v1/billing/service-catalog/?category=booking_fee`. Verify this endpoint exists in `apps/billing/urls.py` — if it's the `ChargeableItemListView`, check the filter field. If not filterable by category, the preview can sum all `booking_fee` items from the same list endpoint. The berth nightly rate is read from `selectedBerth.pricing_tier_price` — check the `BerthSerializer` to confirm this field name is exposed; if the serializer only exposes the FK id (`pricing_tier`), you may need to also include `pricing_tier_unit_price` as a read-only field on `BerthSerializer`, or compute the preview server-side.

> **Implementer note:** Check `apps/berths/serializers.py` — `BerthSerializer` currently exposes `pricing_tier` as a PK field. For the price preview to work client-side, you need the unit price. Either: (a) change `pricing_tier` to a nested serializer with `id` and `unit_price`, or (b) expose a `pricing_tier_unit_price` read-only field. Approach (a) is simpler. Add to `BerthSerializer`:
> ```python
> pricing_tier_unit_price = serializers.DecimalField(source='pricing_tier.unit_price', max_digits=10, decimal_places=2, read_only=True, allow_null=True)
> ```
> And add `'pricing_tier_unit_price'` to `fields`. Then in `ApproveModal`, use `selectedBerth.pricing_tier_unit_price` instead of `pricing_tier_price`.

- [ ] **Step 3: Add Pending tab to `Reservations.jsx`**

In `Reservations.jsx`, find the `bookingTabs` array and `filterMap` at the top. Add the import and the new tab. The Pending tab is rendered as a special component (not through the existing booking list grid), so it branches on tab value.

At the top of the file, add:
```jsx
import PendingRequestsTab from '../components/reservations/PendingRequestsTab.jsx';
```

Change `bookingTabs` to include a `'pending_requests'` entry:
```jsx
const bookingTabs = ['all', 'transient', 'seasonal', 'pending_requests', 'pending', 'overdue'];
```

In the tab bar rendering (find where `bookingTabs.map` renders tab buttons), add badge support for `pending_requests`. You will need to fetch the pending count — use a `useEffect` at the component top level:

```jsx
const [pendingCount, setPendingCount] = useState(0);
useEffect(() => {
  api.get('/bookings/', { params: { status: 'pending_approval' } })
    .then(r => setPendingCount(r.data.length));
}, []);
```

In the tab label render, for `'pending_requests'`:
```jsx
{tab === 'pending_requests' ? (
  <span>
    Pending Requests
    {pendingCount > 0 && (
      <span style={{ marginLeft: 6, background: '#dc2626', color: '#fff', borderRadius: 10, padding: '1px 7px', fontSize: 11 }}>
        {pendingCount}
      </span>
    )}
  </span>
) : (tab.charAt(0).toUpperCase() + tab.slice(1).replace('_', ' '))}
```

In the content area, replace the existing booking table render with a conditional:
```jsx
{activeTab === 'pending_requests' ? (
  <PendingRequestsTab onApproved={() => setPendingCount(c => c - 1)} />
) : (
  /* existing booking table render */
)}
```

- [ ] **Step 4: Verify in the browser**

Start the frontend dev server:
```
cd frontend
npm run dev
```

Open the Reservations screen. Confirm:
- "Pending Requests" tab appears with a red badge when there are pending_approval bookings.
- Clicking the tab shows the list of pending requests.
- Clicking a row opens the side panel with guest details.
- Clicking "Approve…" opens the modal with a berth picker.
- Selecting a berth shows the price preview.
- Clicking "Reject" shows the reason textarea.
- Submitting a rejection removes the row from the list.

- [ ] **Step 5: Commit**

```
git add frontend/src/components/reservations/PendingRequestsTab.jsx frontend/src/components/reservations/ApproveModal.jsx frontend/src/screens/Reservations.jsx frontend/src/components/reservations/
git commit -m "feat: add Pending Requests tab with approve modal and reject action to Reservations screen"
```

---

## Task 8: Portal UI — Public booking form

**Files:**
- Create: `portal/src/screens/BookingRequest.jsx`
- Create: `portal/src/screens/BookingRequestSent.jsx`
- Modify: `portal/src/App.jsx`

### Context

`portal/src/App.jsx` currently shows "Online booking coming soon." for `manual_approval` marinas when there is no session token and no magic link token. Replace this with the `BookingRequest` form.

`TenantContext` exposes the marina object including `booking_mode`. The form POSTs to `/api/v1/public/bookings/` — the `api.js` interceptor already handles the `X-Marina-Slug` header from `TenantContext`.

After submission, show `BookingRequestSent` with a confirmation message.

- [ ] **Step 1: Create `BookingRequestSent.jsx`**

```jsx
// portal/src/screens/BookingRequestSent.jsx
export default function BookingRequestSent({ marina }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 40, maxWidth: 480, width: '100%', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
        <div style={{ fontSize: 40, marginBottom: 16 }}>⚓</div>
        <h2 style={{ margin: '0 0 12px', fontSize: 22 }}>Request received!</h2>
        <p style={{ color: 'rgba(0,0,0,0.55)', fontSize: 15, lineHeight: 1.6, margin: 0 }}>
          Thank you for your request at <strong>{marina?.name || 'the marina'}</strong>.
          The harbour master will review it within 24 hours and send you a payment link by email.
        </p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `BookingRequest.jsx`**

```jsx
// portal/src/screens/BookingRequest.jsx
import { useState } from 'react';
import api from '../api.js';

export default function BookingRequest({ marina, onSubmitted }) {
  const today = new Date().toISOString().split('T')[0];
  const [form, setForm] = useState({
    check_in: '',
    check_out: '',
    guest_name: '',
    guest_email: '',
    boat_loa: '',
    boat_beam: '',
    boat_draft: '',
  });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSubmit = async e => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      await api.post('/public/bookings/', {
        ...form,
        boat_loa: parseFloat(form.boat_loa),
        boat_beam: parseFloat(form.boat_beam),
        boat_draft: parseFloat(form.boat_draft),
      });
      onSubmitted();
    } catch (err) {
      setErrors(err.response?.data || { non_field_errors: ['Something went wrong. Please try again.'] });
    } finally {
      setBusy(false);
    }
  };

  const field = (label, key, type = 'text', extra = {}) => (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontWeight: 600, fontSize: 12, marginBottom: 5, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
        {label}
      </label>
      <input
        type={type}
        value={form[key]}
        min={type === 'date' ? today : undefined}
        onChange={e => set(key, e.target.value)}
        required
        {...extra}
        style={{ width: '100%', boxSizing: 'border-box', padding: '9px 12px', fontSize: 14, border: `1px solid ${errors[key] ? '#dc2626' : 'rgba(0,0,0,0.2)'}`, borderRadius: 6 }}
      />
      {errors[key] && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 4 }}>{errors[key]}</div>}
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8', padding: 24 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 36, maxWidth: 480, width: '100%', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 22 }}>{marina?.name}</h2>
        <p style={{ color: 'rgba(0,0,0,0.5)', fontSize: 14, margin: '0 0 28px' }}>Request a transient berth</p>

        <form onSubmit={handleSubmit}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 0 }}>
            <div>{field('Check-in', 'check_in', 'date')}</div>
            <div>{field('Check-out', 'check_out', 'date')}</div>
          </div>
          {field('Your name', 'guest_name')}
          {field('Email address', 'guest_email', 'email')}

          <div style={{ fontWeight: 600, fontSize: 12, color: 'rgba(0,0,0,0.5)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 12, marginTop: 8 }}>
            Vessel dimensions
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <div>{field('LOA (m)', 'boat_loa', 'number', { step: '0.1', min: '0', placeholder: '12.5' })}</div>
            <div>{field('Beam (m)', 'boat_beam', 'number', { step: '0.1', min: '0', placeholder: '4.2' })}</div>
            <div>{field('Draft (m)', 'boat_draft', 'number', { step: '0.1', min: '0', placeholder: '1.8' })}</div>
          </div>

          {errors.non_field_errors && (
            <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{errors.non_field_errors}</div>
          )}

          <button
            type="submit"
            disabled={busy}
            style={{ width: '100%', padding: '12px 0', background: busy ? '#94a3b8' : '#1d4ed8', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 15, cursor: busy ? 'not-allowed' : 'pointer', marginTop: 8 }}
          >
            {busy ? 'Submitting…' : 'Request a berth'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Update `portal/src/App.jsx`**

```jsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTenant } from './context/TenantContext';
import Magic from './screens/Magic';
import BookingDashboard from './screens/BookingDashboard';
import BookingRequest from './screens/BookingRequest';
import BookingRequestSent from './screens/BookingRequestSent';

export default function App() {
  const [params] = useSearchParams();
  const { marina, isLoading, tenantSlug, customDomain } = useTenant();
  const [submitted, setSubmitted] = useState(false);

  if (params.get('token')) return <Magic />;

  const hasSession = Boolean(localStorage.getItem('portal_session_token'));
  if (hasSession) return <BookingDashboard />;

  if (isLoading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8' }}>
        <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 15 }}>Loading…</div>
      </div>
    );
  }

  if (!marina) {
    const identifier = tenantSlug || customDomain || 'this marina';
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚓</div>
          <div style={{ fontSize: 16 }}>Marina &quot;{identifier}&quot; not found.</div>
        </div>
      </div>
    );
  }

  if (marina.booking_mode === 'manual_approval') {
    if (submitted) return <BookingRequestSent marina={marina} />;
    return <BookingRequest marina={marina} onSubmitted={() => setSubmitted(true)} />;
  }

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 600, margin: '80px auto', textAlign: 'center' }}>
      <h1>{marina.name}</h1>
      <p>Online booking coming soon.</p>
    </div>
  );
}
```

- [ ] **Step 4: Verify in the browser**

Start the portal dev server:
```
cd portal
npm run dev
```

Open the portal for a `manual_approval` marina (set `X-Marina-Slug` or test with the dev slug). Confirm:
- The booking request form appears with date pickers, name, email, and three dimension fields.
- Submitting an invalid form (e.g., check_in > check_out) shows field errors.
- Submitting a valid form shows the `BookingRequestSent` confirmation screen.
- The network tab shows `POST /api/v1/public/bookings/` returning 201.

- [ ] **Step 5: Commit**

```
git add portal/src/screens/BookingRequest.jsx portal/src/screens/BookingRequestSent.jsx portal/src/App.jsx
git commit -m "feat: add public booking request form to portal for manual_approval marinas"
```

---

## Self-Review

After all tasks are implemented, run the full test suite one final time:

```
python manage.py test --verbosity=2
```

Then verify the spec coverage checklist:

| Spec requirement | Covered by |
|---|---|
| `Invoice.booking` FK | Task 1 |
| `ChargeableItem.BOOKING_FEE` category | Task 1 |
| `POST /api/v1/public/bookings/` | Task 3 |
| Boater request-received email | Task 2 + Task 3 |
| Manager notification email | Task 2 + Task 3 |
| `POST /api/v1/bookings/<id>/approve/` | Task 4 |
| Collision check → 409 | Task 4 |
| Pricing: nights × rate + booking_fee sum | Task 4 |
| `invoice.booking` set on approve | Task 4 |
| Approve email with checkout link | Task 2 + Task 4 |
| `POST /api/v1/bookings/<id>/reject/` | Task 4 |
| Reject email with reason | Task 2 + Task 4 |
| `GET /api/v1/berths/?capable_for=` | Task 5 |
| Stripe `checkout.session.completed` → `confirmed` + magic link email | Task 6 |
| Stripe `checkout.session.expired` → `cancelled` + `berth=null` | Task 6 |
| Manager UI: Pending tab with count badge | Task 7 |
| Manager UI: Approve modal (berth picker + price preview) | Task 7 |
| Manager UI: Reject action with reason textarea | Task 7 |
| Portal UI: `BookingRequest.jsx` form | Task 8 |
| Portal UI: `BookingRequestSent.jsx` confirmation | Task 8 |
| `App.jsx` routing on `booking_mode` | Task 8 |
| `MarinaPublicView` includes `booking_mode` | Already done — confirmed in `apps/portal/views.py` |
