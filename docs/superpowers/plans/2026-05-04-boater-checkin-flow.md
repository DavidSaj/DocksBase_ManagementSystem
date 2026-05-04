# Boater Portal Check-In Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the authenticated boater portal journey — magic link exchange, pre-arrival checklist (vessel dimensions + Dropbox Sign waiver + optional insurance), arrival-day self-check-in button, and Marina Wallet Card.

**Architecture:** New endpoints are added to `backend/apps/portal/` (a Django app that already exists). A shared `evaluate_pre_cleared()` helper is called from both the Dropbox Sign webhook and the PATCH dimensions endpoint to avoid a race condition. The portal frontend (`portal/`) adds react-router routes and a set of focused screen components.

**Tech Stack:** Django 6 + DRF, `django.core.signing` for portal tokens, `dropbox_sign` Python SDK (already installed), React 19 + Vite, `react-router-dom` v7 (already installed), `axios` (already installed).

---

## File Map

**Backend — new files in `backend/apps/portal/`:**
- `checkin_utils.py` — `evaluate_pre_cleared()`, `make_magic_token()`, `decode_magic_token()`, `make_portal_token()`, `decode_portal_token()`, `make_magic_url()`
- `checkin_auth.py` — `PortalTokenAuthentication` DRF authentication class
- `checkin_serializers.py` — `PortalBookingSerializer` (includes `is_arrival_day` + `marina_wallet`)
- `checkin_views.py` — all portal checkin views (magic auth, GET booking, PATCH dimensions, self-checkin, waiver, insurance, webhook)
- `checkin_urls.py` — URL patterns for the above
- `tests_checkin.py` — all checkin tests

**Backend — modified files:**
- `backend/apps/reservations/models.py` — add portal fields to `Booking`
- `backend/apps/reservations/migrations/0006_booking_portal_checkin_fields.py` — migration
- `backend/apps/accounts/models.py` — add wallet fields to `Marina`
- `backend/apps/accounts/migrations/0012_marina_wallet_fields.py` — migration
- `backend/config/settings/base.py` — add `DROPBOX_SIGN_CLIENT_ID`
- `backend/config/urls.py` — include `checkin_urls`

**Frontend — new files in `portal/src/`:**
- `screens/Magic.jsx` — token exchange screen
- `screens/BookingDashboard.jsx` — state router
- `utils/deriveState.js` — pure function: booking object → `'checklist' | 'countdown' | 'arrival' | 'wallet'`
- `components/portal/ChecklistView.jsx`
- `components/portal/CountdownView.jsx`
- `components/portal/ArrivalView.jsx`
- `components/portal/WalletCard.jsx`
- `components/portal/checklist/DimensionsForm.jsx`
- `components/portal/checklist/WaiverItem.jsx`
- `components/portal/checklist/InsuranceItem.jsx`

**Frontend — modified files:**
- `portal/src/api.js` — inject `Authorization` + `X-Marina-Slug` headers from localStorage
- `portal/src/App.jsx` — add react-router routes
- `portal/src/main.jsx` — wrap with `BrowserRouter`

---

## Task 1: Add portal fields to Booking model

**Files:**
- Modify: `backend/apps/reservations/models.py`
- Create: `backend/apps/reservations/migrations/0006_booking_portal_checkin_fields.py`
- Test: `backend/apps/portal/tests_checkin.py`

- [ ] **Step 1: Write the failing test**

Create `backend/apps/portal/tests_checkin.py`:

```python
import datetime
from django.test import TestCase
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.berths.models import Pier, Berth
from apps.billing.models import ChargeableItem
from apps.reservations.models import Booking


def make_marina(timezone='UTC'):
    return Marina.objects.create(name='Test Marina', slug='test-marina', timezone=timezone)


def make_booking(marina, check_in=None, check_out=None):
    pier = Pier.objects.create(marina=marina, code='A', label='Pier A')
    tier = ChargeableItem.objects.create(
        marina=marina, name='Berth Night', category='berth',
        pricing_model='per_night', unit_price=50,
    )
    berth = Berth.objects.create(marina=marina, pier=pier, code='A1', pricing_tier=tier, status='available')
    today = datetime.date.today()
    return Booking.objects.create(
        marina=marina,
        berth=berth,
        check_in=check_in or today,
        check_out=check_out or today + datetime.timedelta(days=3),
        guest_name='J. Sailor',
        guest_email='boater@test.com',
    )


class BookingPortalFieldsTest(TestCase):
    def test_portal_fields_exist(self):
        marina = make_marina()
        booking = make_booking(marina)
        # All new fields should exist with correct defaults
        self.assertIsNone(booking.boat_draft)
        self.assertIsNone(booking.waiver_envelope_id)
        self.assertFalse(booking.waiver_signed)
        self.assertFalse(booking.pre_cleared)
        self.assertFalse(booking.self_checked_in)
        self.assertIsNone(booking.self_checked_in_at)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python manage.py test apps.portal.tests_checkin.BookingPortalFieldsTest -v 2
```

Expected: `AttributeError: 'Booking' object has no attribute 'boat_draft'`

- [ ] **Step 3: Add fields to Booking model**

In `backend/apps/reservations/models.py`, after the existing `boat_beam` field:

```python
    boat_draft              = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    waiver_envelope_id      = models.CharField(max_length=255, null=True, blank=True)
    waiver_signed           = models.BooleanField(default=False)
    insurance_doc           = models.FileField(upload_to='insurance/', null=True, blank=True)
    pre_cleared             = models.BooleanField(default=False)
    self_checked_in         = models.BooleanField(default=False)
    self_checked_in_at      = models.DateTimeField(null=True, blank=True)
```

- [ ] **Step 4: Generate and apply migration**

```bash
cd backend && python manage.py makemigrations reservations --name booking_portal_checkin_fields
python manage.py migrate
```

Expected: `Applying reservations.0006_booking_portal_checkin_fields... OK`

- [ ] **Step 5: Run test to verify it passes**

```bash
python manage.py test apps.portal.tests_checkin.BookingPortalFieldsTest -v 2
```

Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add backend/apps/reservations/models.py backend/apps/reservations/migrations/0006_booking_portal_checkin_fields.py backend/apps/portal/tests_checkin.py
git commit -m "feat: add portal checkin fields to Booking model"
```

---

## Task 2: Add wallet fields to Marina model

**Files:**
- Modify: `backend/apps/accounts/models.py`
- Create: `backend/apps/accounts/migrations/0012_marina_wallet_fields.py`
- Test: `backend/apps/portal/tests_checkin.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/portal/tests_checkin.py`:

```python
class MarinaWalletFieldsTest(TestCase):
    def test_wallet_fields_exist(self):
        marina = make_marina()
        self.assertIsNone(marina.wallet_wifi_network)
        self.assertIsNone(marina.wallet_wifi_password)
        self.assertEqual(marina.wallet_gate_codes, [])
        self.assertIsNone(marina.wallet_harbour_master_phone)
        self.assertIsNone(marina.wallet_vhf_channel)
        self.assertIsNone(marina.wallet_office_hours)
        self.assertIsNone(marina.waiver_template_id)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python manage.py test apps.portal.tests_checkin.MarinaWalletFieldsTest -v 2
```

Expected: `AttributeError: 'Marina' object has no attribute 'wallet_wifi_network'`

- [ ] **Step 3: Add wallet fields to Marina model**

In `backend/apps/accounts/models.py`, at the end of the `Marina` model class (before `__str__`):

```python
    wallet_wifi_network          = models.CharField(max_length=100, null=True, blank=True)
    wallet_wifi_password         = models.CharField(max_length=100, null=True, blank=True)
    wallet_gate_codes            = models.JSONField(default=list)
    wallet_harbour_master_phone  = models.CharField(max_length=30, null=True, blank=True)
    wallet_vhf_channel           = models.CharField(max_length=10, null=True, blank=True)
    wallet_office_hours          = models.CharField(max_length=100, null=True, blank=True)
    waiver_template_id           = models.CharField(max_length=255, null=True, blank=True)
```

- [ ] **Step 4: Generate and apply migration**

```bash
cd backend && python manage.py makemigrations accounts --name marina_wallet_fields
python manage.py migrate
```

Expected: `Applying accounts.0012_marina_wallet_fields... OK`

- [ ] **Step 5: Run test to verify it passes**

```bash
python manage.py test apps.portal.tests_checkin.MarinaWalletFieldsTest -v 2
```

Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add backend/apps/accounts/models.py backend/apps/accounts/migrations/0012_marina_wallet_fields.py backend/apps/portal/tests_checkin.py
git commit -m "feat: add wallet and waiver template fields to Marina model"
```

---

## Task 3: `evaluate_pre_cleared` and portal auth token utilities

**Files:**
- Create: `backend/apps/portal/checkin_utils.py`
- Test: `backend/apps/portal/tests_checkin.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/apps/portal/tests_checkin.py`:

```python
from apps.portal.checkin_utils import (
    evaluate_pre_cleared,
    make_magic_token, decode_magic_token,
    make_portal_token, decode_portal_token,
    make_magic_url,
)
from django.core import signing


class EvaluatePreClearedTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.booking = make_booking(self.marina)

    def test_not_cleared_without_waiver(self):
        self.booking.boat_loa = 10
        self.booking.boat_beam = 3
        self.booking.boat_draft = 1.5
        self.booking.save()
        evaluate_pre_cleared(self.booking)
        self.booking.refresh_from_db()
        self.assertFalse(self.booking.pre_cleared)

    def test_not_cleared_without_dimensions(self):
        self.booking.waiver_signed = True
        self.booking.save()
        evaluate_pre_cleared(self.booking)
        self.booking.refresh_from_db()
        self.assertFalse(self.booking.pre_cleared)

    def test_not_cleared_with_partial_dimensions(self):
        self.booking.waiver_signed = True
        self.booking.boat_loa = 10
        self.booking.boat_beam = 3
        # boat_draft is None
        self.booking.save()
        evaluate_pre_cleared(self.booking)
        self.booking.refresh_from_db()
        self.assertFalse(self.booking.pre_cleared)

    def test_cleared_when_waiver_and_all_dimensions_complete(self):
        self.booking.waiver_signed = True
        self.booking.boat_loa = 10
        self.booking.boat_beam = 3
        self.booking.boat_draft = 1.5
        self.booking.save()
        evaluate_pre_cleared(self.booking)
        self.booking.refresh_from_db()
        self.assertTrue(self.booking.pre_cleared)

    def test_idempotent_when_already_cleared(self):
        self.booking.waiver_signed = True
        self.booking.boat_loa = 10
        self.booking.boat_beam = 3
        self.booking.boat_draft = 1.5
        self.booking.pre_cleared = True
        self.booking.save()
        evaluate_pre_cleared(self.booking)  # should not error
        self.booking.refresh_from_db()
        self.assertTrue(self.booking.pre_cleared)


class PortalAuthTokenTest(TestCase):
    def test_magic_token_round_trip(self):
        token = make_magic_token(booking_id=42, boater_email='b@test.com')
        payload = decode_magic_token(token)
        self.assertEqual(payload['booking_id'], 42)
        self.assertEqual(payload['boater_email'], 'b@test.com')

    def test_magic_token_invalid_raises(self):
        with self.assertRaises(signing.BadSignature):
            decode_magic_token('not-a-valid-token')

    def test_portal_token_round_trip(self):
        token = make_portal_token(booking_id=7, marina_slug='harbor', boater_email='b@test.com')
        payload = decode_portal_token(token)
        self.assertEqual(payload['booking_id'], 7)
        self.assertEqual(payload['marina_slug'], 'harbor')
        self.assertEqual(payload['boater_email'], 'b@test.com')

    def test_portal_token_invalid_raises(self):
        with self.assertRaises(signing.BadSignature):
            decode_portal_token('tampered-token')

    def test_make_magic_url_contains_token_and_slug(self):
        marina = make_marina()
        booking = make_booking(marina)
        url = make_magic_url(booking)
        self.assertIn('token=', url)
        self.assertIn(marina.slug, url)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python manage.py test apps.portal.tests_checkin.EvaluatePreClearedTest apps.portal.tests_checkin.PortalAuthTokenTest -v 2
```

Expected: `ImportError: cannot import name 'evaluate_pre_cleared' from 'apps.portal.checkin_utils'`

- [ ] **Step 3: Create `checkin_utils.py`**

Create `backend/apps/portal/checkin_utils.py`:

```python
import datetime
from zoneinfo import ZoneInfo
from django.core import signing
from django.conf import settings

MAGIC_SALT = 'portal-magic-v1'
SESSION_SALT = 'portal-session-v1'
MAGIC_MAX_AGE = 60 * 60 * 72    # 72 hours
SESSION_MAX_AGE = 60 * 60 * 24 * 7  # 7 days


def evaluate_pre_cleared(booking):
    if (booking.waiver_signed
            and booking.boat_loa is not None
            and booking.boat_beam is not None
            and booking.boat_draft is not None):
        booking.pre_cleared = True
        booking.save(update_fields=['pre_cleared'])


def make_magic_token(booking_id, boater_email):
    return signing.dumps(
        {'booking_id': booking_id, 'boater_email': boater_email},
        salt=MAGIC_SALT,
    )


def decode_magic_token(token):
    return signing.loads(token, salt=MAGIC_SALT, max_age=MAGIC_MAX_AGE)


def make_portal_token(booking_id, marina_slug, boater_email):
    return signing.dumps(
        {'booking_id': booking_id, 'marina_slug': marina_slug, 'boater_email': boater_email},
        salt=SESSION_SALT,
    )


def decode_portal_token(token):
    return signing.loads(token, salt=SESSION_SALT, max_age=SESSION_MAX_AGE)


def make_magic_url(booking):
    token = make_magic_token(booking.id, booking.guest_email)
    base = getattr(settings, 'PORTAL_BASE_URL', 'https://book.docksbase.com')
    return f"{base}/{booking.marina.slug}/portal?token={token}"


def is_arrival_day(booking):
    tz = ZoneInfo(booking.marina.timezone)
    today_local = datetime.datetime.now(tz).date()
    return booking.check_in == today_local
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend && python manage.py test apps.portal.tests_checkin.EvaluatePreClearedTest apps.portal.tests_checkin.PortalAuthTokenTest -v 2
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/apps/portal/checkin_utils.py backend/apps/portal/tests_checkin.py
git commit -m "feat: add evaluate_pre_cleared and portal auth token utilities"
```

---

## Task 4: `PortalTokenAuthentication` DRF class

**Files:**
- Create: `backend/apps/portal/checkin_auth.py`
- Test: `backend/apps/portal/tests_checkin.py`

- [ ] **Step 1: Write failing test**

Append to `backend/apps/portal/tests_checkin.py`:

```python
from apps.portal.checkin_auth import PortalTokenAuthentication, PortalUser
from rest_framework.test import APIRequestFactory
from rest_framework.exceptions import AuthenticationFailed


class PortalTokenAuthTest(TestCase):
    def setUp(self):
        self.auth = PortalTokenAuthentication()
        self.factory = APIRequestFactory()

    def _request_with_token(self, token):
        request = self.factory.get('/')
        request.META['HTTP_AUTHORIZATION'] = f'Bearer {token}'
        return request

    def test_valid_token_returns_portal_user(self):
        token = make_portal_token(booking_id=5, marina_slug='harbor', boater_email='b@test.com')
        request = self._request_with_token(token)
        user, _ = self.auth.authenticate(request)
        self.assertIsInstance(user, PortalUser)
        self.assertEqual(user.booking_id, 5)
        self.assertEqual(user.marina_slug, 'harbor')
        self.assertTrue(user.is_authenticated)

    def test_invalid_token_raises_authentication_failed(self):
        request = self._request_with_token('bad-token')
        with self.assertRaises(AuthenticationFailed):
            self.auth.authenticate(request)

    def test_missing_header_returns_none(self):
        request = self.factory.get('/')
        result = self.auth.authenticate(request)
        self.assertIsNone(result)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python manage.py test apps.portal.tests_checkin.PortalTokenAuthTest -v 2
```

Expected: `ImportError: cannot import name 'PortalTokenAuthentication' from 'apps.portal.checkin_auth'`

- [ ] **Step 3: Create `checkin_auth.py`**

Create `backend/apps/portal/checkin_auth.py`:

```python
from django.core import signing
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from .checkin_utils import decode_portal_token


class PortalUser:
    def __init__(self, booking_id, marina_slug, boater_email):
        self.booking_id = booking_id
        self.marina_slug = marina_slug
        self.boater_email = boater_email
        self.is_authenticated = True


class PortalTokenAuthentication(BaseAuthentication):
    def authenticate(self, request):
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        if not auth_header.startswith('Bearer '):
            return None
        token = auth_header[7:]
        try:
            payload = decode_portal_token(token)
        except signing.BadSignature:
            raise AuthenticationFailed('Invalid or expired portal token.')
        return (PortalUser(**payload), None)
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && python manage.py test apps.portal.tests_checkin.PortalTokenAuthTest -v 2
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/apps/portal/checkin_auth.py backend/apps/portal/tests_checkin.py
git commit -m "feat: add PortalTokenAuthentication DRF class"
```

---

## Task 5: Portal booking serializer

**Files:**
- Create: `backend/apps/portal/checkin_serializers.py`
- Test: `backend/apps/portal/tests_checkin.py`

- [ ] **Step 1: Write failing test**

Append to `backend/apps/portal/tests_checkin.py`:

```python
import datetime
from apps.portal.checkin_serializers import PortalBookingSerializer


class PortalBookingSerializerTest(TestCase):
    def test_is_arrival_day_true_when_checkin_today(self):
        marina = make_marina()
        booking = make_booking(marina, check_in=datetime.date.today())
        data = PortalBookingSerializer(booking).data
        self.assertTrue(data['is_arrival_day'])

    def test_is_arrival_day_false_when_checkin_future(self):
        marina = make_marina()
        future = datetime.date.today() + datetime.timedelta(days=5)
        booking = make_booking(marina, check_in=future, check_out=future + datetime.timedelta(days=2))
        data = PortalBookingSerializer(booking).data
        self.assertFalse(data['is_arrival_day'])

    def test_marina_wallet_absent_before_checkin(self):
        marina = make_marina()
        booking = make_booking(marina)
        data = PortalBookingSerializer(booking).data
        self.assertIsNone(data['marina_wallet'])

    def test_marina_wallet_present_after_self_checkin(self):
        marina = make_marina()
        marina.wallet_wifi_network = 'HarborGuest'
        marina.wallet_wifi_password = 'anchor123'
        marina.wallet_gate_codes = [{'label': 'Main Gate', 'pin': '4321'}]
        marina.save()
        booking = make_booking(marina)
        booking.self_checked_in = True
        booking.save()
        data = PortalBookingSerializer(booking).data
        self.assertIsNotNone(data['marina_wallet'])
        self.assertEqual(data['marina_wallet']['wifi_network'], 'HarborGuest')
        self.assertEqual(data['marina_wallet']['gate_codes'][0]['pin'], '4321')
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python manage.py test apps.portal.tests_checkin.PortalBookingSerializerTest -v 2
```

Expected: `ImportError: cannot import name 'PortalBookingSerializer'`

- [ ] **Step 3: Create `checkin_serializers.py`**

Create `backend/apps/portal/checkin_serializers.py`:

```python
from rest_framework import serializers
from apps.reservations.models import Booking
from .checkin_utils import is_arrival_day


class PortalBookingSerializer(serializers.ModelSerializer):
    berth_code  = serializers.CharField(source='berth.code',  read_only=True, default=None)
    berth_pier  = serializers.CharField(source='berth.pier.label', read_only=True, default=None)
    is_arrival_day = serializers.SerializerMethodField()
    marina_wallet  = serializers.SerializerMethodField()

    class Meta:
        model = Booking
        fields = [
            'id', 'check_in', 'check_out', 'status',
            'berth_code', 'berth_pier',
            'guest_name', 'guest_email',
            'boat_loa', 'boat_beam', 'boat_draft',
            'waiver_envelope_id', 'waiver_signed',
            'insurance_doc',
            'pre_cleared', 'self_checked_in', 'self_checked_in_at',
            'is_arrival_day', 'marina_wallet',
        ]
        read_only_fields = fields

    def get_is_arrival_day(self, booking):
        return is_arrival_day(booking)

    def get_marina_wallet(self, booking):
        if not booking.self_checked_in:
            return None
        m = booking.marina
        return {
            'wifi_network':          m.wallet_wifi_network,
            'wifi_password':         m.wallet_wifi_password,
            'gate_codes':            m.wallet_gate_codes,
            'harbour_master_phone':  m.wallet_harbour_master_phone,
            'vhf_channel':           m.wallet_vhf_channel,
            'office_hours':          m.wallet_office_hours,
            'marina_name':           m.name,
        }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd backend && python manage.py test apps.portal.tests_checkin.PortalBookingSerializerTest -v 2
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add backend/apps/portal/checkin_serializers.py backend/apps/portal/tests_checkin.py
git commit -m "feat: add PortalBookingSerializer with is_arrival_day and marina_wallet"
```

---

## Task 6: Magic auth view + GET booking view

**Files:**
- Create: `backend/apps/portal/checkin_views.py`
- Test: `backend/apps/portal/tests_checkin.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/apps/portal/tests_checkin.py`:

```python
from django.urls import reverse


class MagicAuthViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina = make_marina()
        self.booking = make_booking(self.marina)

    def test_valid_token_returns_session_token_and_booking_id(self):
        token = make_magic_token(self.booking.id, self.booking.guest_email)
        resp = self.client.post('/api/v1/portal/checkin/auth/magic/', {'token': token}, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('token', resp.data)
        self.assertEqual(resp.data['booking_id'], self.booking.id)
        self.assertEqual(resp.data['marina_slug'], self.marina.slug)

    def test_invalid_token_returns_401(self):
        resp = self.client.post('/api/v1/portal/checkin/auth/magic/', {'token': 'bad'}, format='json')
        self.assertEqual(resp.status_code, 401)

    def test_missing_token_returns_400(self):
        resp = self.client.post('/api/v1/portal/checkin/auth/magic/', {}, format='json')
        self.assertEqual(resp.status_code, 400)


class PortalBookingGetViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina = make_marina()
        self.booking = make_booking(self.marina)
        session_token = make_portal_token(
            booking_id=self.booking.id,
            marina_slug=self.marina.slug,
            boater_email=self.booking.guest_email,
        )
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {session_token}')

    def test_get_booking_returns_200(self):
        resp = self.client.get(f'/api/v1/portal/checkin/bookings/{self.booking.id}/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('is_arrival_day', resp.data)
        self.assertIn('pre_cleared', resp.data)

    def test_cannot_get_another_booking(self):
        other_marina = make_marina()
        other_booking = make_booking(other_marina)
        resp = self.client.get(f'/api/v1/portal/checkin/bookings/{other_booking.id}/')
        self.assertEqual(resp.status_code, 403)

    def test_unauthenticated_returns_401(self):
        self.client.credentials()
        resp = self.client.get(f'/api/v1/portal/checkin/bookings/{self.booking.id}/')
        self.assertEqual(resp.status_code, 401)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python manage.py test apps.portal.tests_checkin.MagicAuthViewTest apps.portal.tests_checkin.PortalBookingGetViewTest -v 2
```

Expected: connection refused or 404 (URL not wired yet — that's fine, we verify the views exist in the next task after wiring URLs)

- [ ] **Step 3: Create `checkin_views.py` with MagicAuthView and PortalBookingView**

Create `backend/apps/portal/checkin_views.py`:

```python
import datetime
import hmac
import hashlib

from django.conf import settings
from django.core import signing
from django.utils import timezone
from rest_framework import status
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.reservations.models import Booking
from .checkin_auth import PortalTokenAuthentication
from .checkin_serializers import PortalBookingSerializer
from .checkin_utils import (
    decode_magic_token, make_portal_token,
    evaluate_pre_cleared,
)


class MagicAuthView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        token = request.data.get('token')
        if not token:
            return Response({'detail': 'token required.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            payload = decode_magic_token(token)
        except signing.BadSignature:
            return Response({'detail': 'Invalid or expired link.'}, status=status.HTTP_401_UNAUTHORIZED)

        try:
            booking = Booking.objects.select_related('marina').get(
                pk=payload['booking_id'],
                guest_email=payload['boater_email'],
            )
        except Booking.DoesNotExist:
            return Response({'detail': 'Booking not found.'}, status=status.HTTP_401_UNAUTHORIZED)

        session_token = make_portal_token(
            booking_id=booking.id,
            marina_slug=booking.marina.slug,
            boater_email=booking.guest_email,
        )
        return Response({
            'token': session_token,
            'booking_id': booking.id,
            'marina_slug': booking.marina.slug,
        })


class PortalBookingMixin:
    authentication_classes = [PortalTokenAuthentication]
    permission_classes = [IsAuthenticated]

    def get_booking(self, request, pk):
        if request.user.booking_id != pk:
            return None, Response({'detail': 'Forbidden.'}, status=status.HTTP_403_FORBIDDEN)
        try:
            return Booking.objects.select_related('marina', 'berth', 'berth__pier').get(pk=pk), None
        except Booking.DoesNotExist:
            return None, Response({'detail': 'Not found.'}, status=status.HTTP_404_NOT_FOUND)


class PortalBookingView(PortalBookingMixin, APIView):
    def get(self, request, pk):
        booking, err = self.get_booking(request, pk)
        if err:
            return err
        return Response(PortalBookingSerializer(booking).data)
```

- [ ] **Step 4: Create `checkin_urls.py`**

Create `backend/apps/portal/checkin_urls.py`:

```python
from django.urls import path
from .checkin_views import (
    MagicAuthView,
    PortalBookingView,
)

urlpatterns = [
    path('portal/checkin/auth/magic/',          MagicAuthView.as_view(),       name='portal_magic_auth'),
    path('portal/checkin/bookings/<int:pk>/',   PortalBookingView.as_view(),   name='portal_booking'),
]
```

- [ ] **Step 5: Wire into `backend/config/urls.py`**

In `backend/config/urls.py`, add inside the `path('api/v1/', include([...]))` block, after the existing portal include:

```python
        path('', include('apps.portal.checkin_urls')),
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd backend && python manage.py test apps.portal.tests_checkin.MagicAuthViewTest apps.portal.tests_checkin.PortalBookingGetViewTest -v 2
```

Expected: `OK`

- [ ] **Step 7: Commit**

```bash
git add backend/apps/portal/checkin_views.py backend/apps/portal/checkin_urls.py backend/config/urls.py backend/apps/portal/tests_checkin.py
git commit -m "feat: add magic auth and GET booking portal endpoints"
```

---

## Task 7: PATCH vessel dimensions + POST self-checkin

**Files:**
- Modify: `backend/apps/portal/checkin_views.py`
- Modify: `backend/apps/portal/checkin_urls.py`
- Test: `backend/apps/portal/tests_checkin.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/apps/portal/tests_checkin.py`:

```python
class PatchDimensionsViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina = make_marina()
        self.booking = make_booking(self.marina)
        session_token = make_portal_token(
            booking_id=self.booking.id,
            marina_slug=self.marina.slug,
            boater_email=self.booking.guest_email,
        )
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {session_token}')

    def test_patch_saves_dimensions(self):
        resp = self.client.patch(
            f'/api/v1/portal/checkin/bookings/{self.booking.id}/',
            {'boat_loa': '12.5', 'boat_beam': '4.2', 'boat_draft': '1.8'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertEqual(float(self.booking.boat_loa), 12.5)
        self.assertEqual(float(self.booking.boat_draft), 1.8)

    def test_patch_with_complete_dimensions_and_signed_waiver_sets_pre_cleared(self):
        self.booking.waiver_signed = True
        self.booking.save()
        resp = self.client.patch(
            f'/api/v1/portal/checkin/bookings/{self.booking.id}/',
            {'boat_loa': '12.5', 'boat_beam': '4.2', 'boat_draft': '1.8'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertTrue(self.booking.pre_cleared)

    def test_patch_without_waiver_does_not_set_pre_cleared(self):
        resp = self.client.patch(
            f'/api/v1/portal/checkin/bookings/{self.booking.id}/',
            {'boat_loa': '12.5', 'boat_beam': '4.2', 'boat_draft': '1.8'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertFalse(self.booking.pre_cleared)


class SelfCheckinViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina = make_marina()
        today = datetime.date.today()
        self.booking = make_booking(self.marina, check_in=today, check_out=today + datetime.timedelta(days=2))
        self.booking.pre_cleared = True
        self.booking.save()
        session_token = make_portal_token(
            booking_id=self.booking.id,
            marina_slug=self.marina.slug,
            boater_email=self.booking.guest_email,
        )
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {session_token}')

    def test_self_checkin_sets_flags(self):
        resp = self.client.post(f'/api/v1/portal/checkin/bookings/{self.booking.id}/self-checkin/')
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertTrue(self.booking.self_checked_in)
        self.assertEqual(self.booking.status, 'checked_in')
        self.assertIsNotNone(self.booking.self_checked_in_at)

    def test_self_checkin_not_pre_cleared_returns_400(self):
        self.booking.pre_cleared = False
        self.booking.save()
        resp = self.client.post(f'/api/v1/portal/checkin/bookings/{self.booking.id}/self-checkin/')
        self.assertEqual(resp.status_code, 400)

    def test_self_checkin_idempotent(self):
        self.booking.self_checked_in = True
        self.booking.save()
        resp = self.client.post(f'/api/v1/portal/checkin/bookings/{self.booking.id}/self-checkin/')
        self.assertEqual(resp.status_code, 200)
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python manage.py test apps.portal.tests_checkin.PatchDimensionsViewTest apps.portal.tests_checkin.SelfCheckinViewTest -v 2
```

Expected: 404 (URL not wired yet)

- [ ] **Step 3: Add views to `checkin_views.py`**

Append to `backend/apps/portal/checkin_views.py`:

```python
class PatchDimensionsView(PortalBookingMixin, APIView):
    def patch(self, request, pk):
        booking, err = self.get_booking(request, pk)
        if err:
            return err

        allowed = {'boat_loa', 'boat_beam', 'boat_draft'}
        for field in allowed:
            if field in request.data:
                setattr(booking, field, request.data[field])
        booking.save(update_fields=list(allowed & request.data.keys()))

        evaluate_pre_cleared(booking)
        booking.refresh_from_db()
        return Response(PortalBookingSerializer(booking).data)


class SelfCheckinView(PortalBookingMixin, APIView):
    def post(self, request, pk):
        booking, err = self.get_booking(request, pk)
        if err:
            return err

        if not booking.pre_cleared:
            return Response(
                {'detail': 'Pre-clearance not complete.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not booking.self_checked_in:
            booking.self_checked_in = True
            booking.self_checked_in_at = timezone.now()
            booking.status = 'checked_in'
            booking.save(update_fields=['self_checked_in', 'self_checked_in_at', 'status'])

        return Response(PortalBookingSerializer(booking).data)
```

- [ ] **Step 4: Add imports and URL patterns**

At the top of `checkin_views.py`, `evaluate_pre_cleared` is already imported. No changes needed there.

Update `backend/apps/portal/checkin_urls.py`:

```python
from django.urls import path
from .checkin_views import (
    MagicAuthView,
    PortalBookingView,
    PatchDimensionsView,
    SelfCheckinView,
)

urlpatterns = [
    path('portal/checkin/auth/magic/',                          MagicAuthView.as_view(),       name='portal_magic_auth'),
    path('portal/checkin/bookings/<int:pk>/',                   PortalBookingView.as_view(),   name='portal_booking'),
    path('portal/checkin/bookings/<int:pk>/dimensions/',        PatchDimensionsView.as_view(), name='portal_dimensions'),
    path('portal/checkin/bookings/<int:pk>/self-checkin/',      SelfCheckinView.as_view(),     name='portal_self_checkin'),
]
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
cd backend && python manage.py test apps.portal.tests_checkin.PatchDimensionsViewTest apps.portal.tests_checkin.SelfCheckinViewTest -v 2
```

Expected: `OK`

- [ ] **Step 6: Commit**

```bash
git add backend/apps/portal/checkin_views.py backend/apps/portal/checkin_urls.py backend/apps/portal/tests_checkin.py
git commit -m "feat: add PATCH dimensions and self-checkin portal endpoints"
```

---

## Task 8: Waiver view (Dropbox Sign) + webhook

**Files:**
- Modify: `backend/apps/portal/checkin_views.py`
- Modify: `backend/apps/portal/checkin_urls.py`
- Modify: `backend/config/settings/base.py`
- Test: `backend/apps/portal/tests_checkin.py`

- [ ] **Step 1: Add `DROPBOX_SIGN_CLIENT_ID` to settings**

In `backend/config/settings/base.py`, after the existing `DROPBOX_SIGN_API_KEY` line:

```python
DROPBOX_SIGN_CLIENT_ID = os.environ.get('DROPBOX_SIGN_CLIENT_ID', '')
```

- [ ] **Step 2: Write failing tests**

Append to `backend/apps/portal/tests_checkin.py`:

```python
from unittest.mock import patch, MagicMock
import json


class WaiverViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina = make_marina()
        self.marina.waiver_template_id = 'tmpl_abc123'
        self.marina.save()
        self.booking = make_booking(self.marina)
        session_token = make_portal_token(
            booking_id=self.booking.id,
            marina_slug=self.marina.slug,
            boater_email=self.booking.guest_email,
        )
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {session_token}')

    @patch('apps.portal.checkin_views.get_sign_url')
    def test_waiver_view_returns_sign_url(self, mock_get_sign_url):
        mock_get_sign_url.return_value = ('env_abc', 'https://sign.hellosign.com/...')
        resp = self.client.post(f'/api/v1/portal/checkin/bookings/{self.booking.id}/waiver/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('sign_url', resp.data)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.waiver_envelope_id, 'env_abc')

    @patch('apps.portal.checkin_views.get_sign_url')
    def test_waiver_view_idempotent_when_envelope_exists(self, mock_get_sign_url):
        self.booking.waiver_envelope_id = 'existing_env'
        self.booking.save()
        mock_get_sign_url.return_value = ('existing_env', 'https://sign.hellosign.com/existing')
        resp = self.client.post(f'/api/v1/portal/checkin/bookings/{self.booking.id}/waiver/')
        self.assertEqual(resp.status_code, 200)

    def test_waiver_view_400_when_no_template(self):
        self.marina.waiver_template_id = None
        self.marina.save()
        resp = self.client.post(f'/api/v1/portal/checkin/bookings/{self.booking.id}/waiver/')
        self.assertEqual(resp.status_code, 400)


class DropboxSignWebhookTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina = make_marina()
        self.booking = make_booking(self.marina)
        self.booking.waiver_envelope_id = 'env_xyz'
        self.booking.boat_loa = 10
        self.booking.boat_beam = 3
        self.booking.boat_draft = 1.5
        self.booking.save()

    def _make_payload(self, event_type, booking_id):
        return json.dumps({
            'event': {
                'event_type': event_type,
                'event_time': '1649948325',
                'event_hash': 'ignored-in-tests',
            },
            'signature_request': {
                'signature_request_id': 'env_xyz',
                'metadata': {'booking_id': str(booking_id)},
            },
        })

    @patch('apps.portal.checkin_views.is_valid_dropbox_sign_request', return_value=True)
    def test_webhook_sets_waiver_signed_and_pre_cleared(self, _mock):
        payload = self._make_payload('signature_request_all_signed', self.booking.id)
        resp = self.client.post(
            '/api/v1/portal/checkin/webhooks/dropbox-sign/',
            data=payload,
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertTrue(self.booking.waiver_signed)
        self.assertTrue(self.booking.pre_cleared)

    @patch('apps.portal.checkin_views.is_valid_dropbox_sign_request', return_value=False)
    def test_webhook_rejects_invalid_hmac(self, _mock):
        payload = self._make_payload('signature_request_all_signed', self.booking.id)
        resp = self.client.post(
            '/api/v1/portal/checkin/webhooks/dropbox-sign/',
            data=payload,
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 403)

    @patch('apps.portal.checkin_views.is_valid_dropbox_sign_request', return_value=True)
    def test_webhook_ignores_other_event_types(self, _mock):
        payload = self._make_payload('signature_request_viewed', self.booking.id)
        resp = self.client.post(
            '/api/v1/portal/checkin/webhooks/dropbox-sign/',
            data=payload,
            content_type='application/json',
        )
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertFalse(self.booking.waiver_signed)
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
cd backend && python manage.py test apps.portal.tests_checkin.WaiverViewTest apps.portal.tests_checkin.DropboxSignWebhookTest -v 2
```

Expected: 404 (URL not yet wired)

- [ ] **Step 4: Add `get_sign_url` helper and waiver/webhook views to `checkin_views.py`**

At the top of `backend/apps/portal/checkin_views.py`, add this import block after existing imports:

```python
import dropbox_sign
from dropbox_sign import ApiClient, Configuration, apis, models as ds_models
```

Then add these functions and classes at the bottom of `checkin_views.py`:

```python
def is_valid_dropbox_sign_request(request_body: bytes, secret: str) -> bool:
    try:
        from dropbox_sign import EventCallbackHelper
        return EventCallbackHelper.is_valid_request(request_body, secret)
    except Exception:
        return False


def get_sign_url(booking, template_id, client_id, api_key):
    configuration = Configuration(username=api_key)
    with ApiClient(configuration) as api_client:
        sig_api = apis.SignatureRequestApi(api_client)
        embedded_api = apis.EmbeddedApi(api_client)

        signer_name = booking.guest_name or 'Boater'
        signer_email = booking.guest_email

        data = ds_models.SignatureRequestCreateEmbeddedWithTemplateRequest(
            client_id=client_id,
            template_ids=[template_id],
            subject='Marina Waiver',
            signers=[
                ds_models.SubSignatureRequestTemplateSigner(
                    role='Boater',
                    name=signer_name,
                    email_address=signer_email,
                )
            ],
            metadata={'booking_id': str(booking.id)},
        )
        sig_response = sig_api.signature_request_create_embedded_with_template(data)
        envelope_id = sig_response.signature_request.signature_request_id
        signature_id = sig_response.signature_request.signatures[0].signature_id

        url_response = embedded_api.embedded_sign_url(signature_id)
        sign_url = url_response.embedded.sign_url

    return envelope_id, sign_url


class WaiverView(PortalBookingMixin, APIView):
    def post(self, request, pk):
        booking, err = self.get_booking(request, pk)
        if err:
            return err

        if not booking.marina.waiver_template_id:
            return Response(
                {'detail': 'No waiver template configured for this marina.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        api_key = settings.DROPBOX_SIGN_API_KEY
        client_id = settings.DROPBOX_SIGN_CLIENT_ID

        if booking.waiver_envelope_id:
            # Idempotent: re-fetch sign URL for existing envelope
            configuration = Configuration(username=api_key)
            with ApiClient(configuration) as api_client:
                embedded_api = apis.EmbeddedApi(api_client)
                sig_api = apis.SignatureRequestApi(api_client)
                sig_response = sig_api.signature_request_get(booking.waiver_envelope_id)
                signature_id = sig_response.signature_request.signatures[0].signature_id
                url_response = embedded_api.embedded_sign_url(signature_id)
                sign_url = url_response.embedded.sign_url
        else:
            envelope_id, sign_url = get_sign_url(
                booking, booking.marina.waiver_template_id, client_id, api_key
            )
            booking.waiver_envelope_id = envelope_id
            booking.save(update_fields=['waiver_envelope_id'])

        return Response({'sign_url': sign_url})


class DropboxSignWebhookView(APIView):
    authentication_classes = []
    permission_classes = []

    def post(self, request):
        if not is_valid_dropbox_sign_request(request.body, settings.DROPBOX_SIGN_WEBHOOK_SECRET):
            return Response({'detail': 'Invalid signature.'}, status=status.HTTP_403_FORBIDDEN)

        payload = request.data
        event_type = payload.get('event', {}).get('event_type', '')

        if event_type != 'signature_request_all_signed':
            return Response({'status': 'ignored'})

        booking_id = payload.get('signature_request', {}).get('metadata', {}).get('booking_id')
        if not booking_id:
            return Response({'status': 'no booking_id in metadata'})

        try:
            booking = Booking.objects.get(pk=int(booking_id))
        except (Booking.DoesNotExist, ValueError):
            return Response({'status': 'booking not found'})

        booking.waiver_signed = True
        booking.save(update_fields=['waiver_signed'])
        evaluate_pre_cleared(booking)

        return Response({'status': 'ok'})
```

- [ ] **Step 5: Update `checkin_urls.py`**

Replace the contents of `backend/apps/portal/checkin_urls.py`:

```python
from django.urls import path
from .checkin_views import (
    MagicAuthView,
    PortalBookingView,
    PatchDimensionsView,
    SelfCheckinView,
    WaiverView,
    DropboxSignWebhookView,
)

urlpatterns = [
    path('portal/checkin/auth/magic/',                              MagicAuthView.as_view(),            name='portal_magic_auth'),
    path('portal/checkin/bookings/<int:pk>/',                       PortalBookingView.as_view(),         name='portal_booking'),
    path('portal/checkin/bookings/<int:pk>/dimensions/',            PatchDimensionsView.as_view(),       name='portal_dimensions'),
    path('portal/checkin/bookings/<int:pk>/self-checkin/',          SelfCheckinView.as_view(),           name='portal_self_checkin'),
    path('portal/checkin/bookings/<int:pk>/waiver/',                WaiverView.as_view(),               name='portal_waiver'),
    path('portal/checkin/webhooks/dropbox-sign/',                   DropboxSignWebhookView.as_view(),   name='portal_dropbox_webhook'),
]
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
cd backend && python manage.py test apps.portal.tests_checkin.WaiverViewTest apps.portal.tests_checkin.DropboxSignWebhookTest -v 2
```

Expected: `OK`

- [ ] **Step 7: Run all checkin tests**

```bash
cd backend && python manage.py test apps.portal.tests_checkin -v 2
```

Expected: All tests pass.

- [ ] **Step 8: Commit**

```bash
git add backend/apps/portal/checkin_views.py backend/apps/portal/checkin_urls.py backend/config/settings/base.py backend/apps/portal/tests_checkin.py
git commit -m "feat: add waiver view (Dropbox Sign) and webhook endpoint"
```

---

## Task 9: Insurance upload view

**Files:**
- Modify: `backend/apps/portal/checkin_views.py`
- Modify: `backend/apps/portal/checkin_urls.py`
- Test: `backend/apps/portal/tests_checkin.py`

- [ ] **Step 1: Write failing test**

Append to `backend/apps/portal/tests_checkin.py`:

```python
from django.core.files.uploadedfile import SimpleUploadedFile


class InsuranceUploadViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina = make_marina()
        self.booking = make_booking(self.marina)
        session_token = make_portal_token(
            booking_id=self.booking.id,
            marina_slug=self.marina.slug,
            boater_email=self.booking.guest_email,
        )
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {session_token}')

    def test_upload_insurance_doc(self):
        file = SimpleUploadedFile('policy.pdf', b'fake pdf content', content_type='application/pdf')
        resp = self.client.post(
            f'/api/v1/portal/checkin/bookings/{self.booking.id}/insurance/',
            {'file': file},
            format='multipart',
        )
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertTrue(bool(self.booking.insurance_doc))

    def test_upload_missing_file_returns_400(self):
        resp = self.client.post(
            f'/api/v1/portal/checkin/bookings/{self.booking.id}/insurance/',
            {},
            format='multipart',
        )
        self.assertEqual(resp.status_code, 400)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python manage.py test apps.portal.tests_checkin.InsuranceUploadViewTest -v 2
```

Expected: 404

- [ ] **Step 3: Add `InsuranceUploadView` to `checkin_views.py`**

Append to `backend/apps/portal/checkin_views.py`:

```python
class InsuranceUploadView(PortalBookingMixin, APIView):
    parser_classes = [MultiPartParser]

    def post(self, request, pk):
        booking, err = self.get_booking(request, pk)
        if err:
            return err

        file = request.FILES.get('file')
        if not file:
            return Response({'detail': 'file required.'}, status=status.HTTP_400_BAD_REQUEST)

        booking.insurance_doc = file
        booking.save(update_fields=['insurance_doc'])
        return Response(PortalBookingSerializer(booking).data)
```

- [ ] **Step 4: Update `checkin_urls.py`**

Add to imports in `backend/apps/portal/checkin_urls.py`:

```python
from .checkin_views import (
    MagicAuthView,
    PortalBookingView,
    PatchDimensionsView,
    SelfCheckinView,
    WaiverView,
    DropboxSignWebhookView,
    InsuranceUploadView,
)
```

Add to `urlpatterns`:

```python
    path('portal/checkin/bookings/<int:pk>/insurance/',             InsuranceUploadView.as_view(),      name='portal_insurance'),
```

- [ ] **Step 5: Run all checkin tests**

```bash
cd backend && python manage.py test apps.portal.tests_checkin -v 2
```

Expected: All pass.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/portal/checkin_views.py backend/apps/portal/checkin_urls.py backend/apps/portal/tests_checkin.py
git commit -m "feat: add insurance upload portal endpoint"
```

---

## Task 10: Frontend — portal api.js + Magic.jsx

**Files:**
- Modify: `portal/src/api.js`
- Create: `portal/src/screens/Magic.jsx`

The portal stores `portal_session_token`, `portal_booking_id`, and `portal_marina_slug` in localStorage after the magic link exchange.

- [ ] **Step 1: Update `portal/src/api.js`**

Replace the file with:

```javascript
import axios from 'axios';
import { detectTenant } from './context/TenantContext';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000/api/v1',
});

api.interceptors.request.use(cfg => {
  // Portal session auth
  const sessionToken = localStorage.getItem('portal_session_token');
  if (sessionToken) {
    cfg.headers['Authorization'] = `Bearer ${sessionToken}`;
  }

  // Tenant identification
  const marinaSlug = localStorage.getItem('portal_marina_slug');
  if (marinaSlug) {
    cfg.headers['X-Marina-Slug'] = marinaSlug;
  } else {
    const tenant = detectTenant();
    if (tenant?.slug) {
      cfg.headers['X-Marina-Slug'] = tenant.slug;
    } else if (tenant?.customDomain) {
      cfg.headers['X-Marina-Domain'] = tenant.customDomain;
    }
  }

  return cfg;
});

export default api;
```

- [ ] **Step 2: Create `portal/src/screens/Magic.jsx`**

```jsx
import { useEffect, useState } from 'react';
import api from '../api';

export default function Magic() {
  const [error, setError] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
      setError('No token found in URL. Please use the link from your email.');
      return;
    }

    api.post('/portal/checkin/auth/magic/', { token })
      .then(res => {
        localStorage.setItem('portal_session_token', res.data.token);
        localStorage.setItem('portal_booking_id', String(res.data.booking_id));
        localStorage.setItem('portal_marina_slug', res.data.marina_slug);
        // Navigate to dashboard — strip token from URL
        window.location.replace(window.location.pathname.replace(/\/portal.*/, '/portal'));
      })
      .catch(() => {
        setError('This link has expired or is invalid. Please check your email for a new one.');
      });
  }, []);

  if (error) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8' }}>
        <div style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>Link expired</div>
          <div style={{ fontSize: 14, color: 'rgba(0,0,0,0.5)' }}>{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8' }}>
      <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 15 }}>Signing you in…</div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add portal/src/api.js portal/src/screens/Magic.jsx
git commit -m "feat: portal api auth headers and Magic token exchange screen"
```

---

## Task 11: Frontend — `deriveState` + `BookingDashboard`

**Files:**
- Create: `portal/src/utils/deriveState.js`
- Create: `portal/src/screens/BookingDashboard.jsx`

- [ ] **Step 1: Create `portal/src/utils/deriveState.js`**

```javascript
export function deriveState(booking) {
  if (booking.self_checked_in) return 'wallet';
  if (!booking.pre_cleared) return 'checklist';
  if (booking.is_arrival_day) return 'arrival';
  return 'countdown';
}
```

- [ ] **Step 2: Create `portal/src/screens/BookingDashboard.jsx`**

```jsx
import { useState, useEffect } from 'react';
import api from '../api';
import { deriveState } from '../utils/deriveState';
import ChecklistView from '../components/portal/ChecklistView';
import CountdownView from '../components/portal/CountdownView';
import ArrivalView from '../components/portal/ArrivalView';
import WalletCard from '../components/portal/WalletCard';

export default function BookingDashboard() {
  const bookingId = localStorage.getItem('portal_booking_id');
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  function reload() {
    if (!bookingId) { setError('No booking session found.'); setLoading(false); return; }
    api.get(`/portal/checkin/bookings/${bookingId}/`)
      .then(r => setBooking(r.data))
      .catch(() => setError('Could not load your booking. Please use the link from your email.'))
      .finally(() => setLoading(false));
  }

  useEffect(reload, [bookingId]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8' }}>
        <div style={{ color: 'rgba(0,0,0,0.4)', fontSize: 15 }}>Loading your booking…</div>
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f4f6f8' }}>
        <div style={{ textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚓</div>
          <div style={{ fontSize: 15, color: 'rgba(0,0,0,0.5)' }}>{error || 'Booking not found.'}</div>
        </div>
      </div>
    );
  }

  const state = deriveState(booking);

  if (state === 'wallet') return <WalletCard booking={booking} />;
  if (state === 'arrival') return <ArrivalView booking={booking} onCheckedIn={reload} />;
  if (state === 'countdown') return <CountdownView booking={booking} />;
  return <ChecklistView booking={booking} onUpdate={reload} />;
}
```

- [ ] **Step 3: Commit**

```bash
git add portal/src/utils/deriveState.js portal/src/screens/BookingDashboard.jsx
git commit -m "feat: add deriveState utility and BookingDashboard state router"
```

---

## Task 12: Frontend — `ChecklistView` + `DimensionsForm`

**Files:**
- Create: `portal/src/components/portal/ChecklistView.jsx`
- Create: `portal/src/components/portal/checklist/DimensionsForm.jsx`

- [ ] **Step 1: Create `portal/src/components/portal/checklist/DimensionsForm.jsx`**

```jsx
import { useState } from 'react';
import api from '../../../api';

const INPUT = {
  width: '100%', padding: '12px 14px', fontSize: 16, borderRadius: 10,
  border: '1.5px solid rgba(0,0,0,0.15)', boxSizing: 'border-box', marginBottom: 12,
};
const BTN = {
  width: '100%', height: 52, borderRadius: 12, background: '#1a2d4a',
  color: '#fff', border: 'none', fontSize: 16, fontWeight: 700, cursor: 'pointer',
};

export default function DimensionsForm({ booking, onUpdate }) {
  const [loa, setLoa]     = useState(booking.boat_loa   ?? '');
  const [beam, setBeam]   = useState(booking.boat_beam  ?? '');
  const [draft, setDraft] = useState(booking.boat_draft ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      await api.patch(`/portal/checkin/bookings/${booking.id}/dimensions/`, {
        boat_loa: loa, boat_beam: beam, boat_draft: draft,
      });
      onUpdate();
    } catch {
      setError('Failed to save. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input style={INPUT} type="number" step="0.01" min="0" placeholder="Length Overall (m)" value={loa} onChange={e => setLoa(e.target.value)} required />
      <input style={INPUT} type="number" step="0.01" min="0" placeholder="Beam (m)" value={beam} onChange={e => setBeam(e.target.value)} required />
      <input style={INPUT} type="number" step="0.01" min="0" placeholder="Draft (m)" value={draft} onChange={e => setDraft(e.target.value)} required />
      {error && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10 }}>{error}</div>}
      <button type="submit" style={BTN} disabled={saving}>{saving ? 'Saving…' : 'Save Dimensions'}</button>
    </form>
  );
}
```

- [ ] **Step 2: Create `portal/src/components/portal/ChecklistView.jsx`**

```jsx
import DimensionsForm from './checklist/DimensionsForm';
import WaiverItem from './checklist/WaiverItem';
import InsuranceItem from './checklist/InsuranceItem';

const CARD = { background: '#fff', borderRadius: 14, padding: 20, marginBottom: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' };
const HDR = { background: '#1a2d4a', padding: '20px 20px 16px', color: '#fff' };

function CheckItem({ label, done, children }) {
  return (
    <div style={CARD}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: done ? 0 : 16 }}>
        <span style={{ fontSize: 20 }}>{done ? '✅' : '⬜'}</span>
        <span style={{ fontSize: 15, fontWeight: 700 }}>{label}</span>
      </div>
      {!done && children}
    </div>
  );
}

export default function ChecklistView({ booking, onUpdate }) {
  const dimsDone   = booking.boat_loa != null && booking.boat_beam != null && booking.boat_draft != null;
  const waiverDone = booking.waiver_signed;

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
      <div style={HDR}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Pre-Arrival Checklist</div>
        <div style={{ fontSize: 13, opacity: 0.6, marginTop: 4 }}>Complete all required steps before arrival</div>
      </div>
      <div style={{ padding: '16px 16px 40px' }}>
        <CheckItem label="Vessel Dimensions" done={dimsDone}>
          <DimensionsForm booking={booking} onUpdate={onUpdate} />
        </CheckItem>
        <CheckItem label="Marina Waiver" done={waiverDone}>
          <WaiverItem booking={booking} onUpdate={onUpdate} />
        </CheckItem>
        <CheckItem label="Insurance Document (optional)" done={!!booking.insurance_doc}>
          <InsuranceItem booking={booking} onUpdate={onUpdate} />
        </CheckItem>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add portal/src/components/portal/ChecklistView.jsx portal/src/components/portal/checklist/DimensionsForm.jsx
git commit -m "feat: add ChecklistView and DimensionsForm components"
```

---

## Task 13: Frontend — `WaiverItem` + `InsuranceItem`

**Files:**
- Create: `portal/src/components/portal/checklist/WaiverItem.jsx`
- Create: `portal/src/components/portal/checklist/InsuranceItem.jsx`

- [ ] **Step 1: Create `portal/src/components/portal/checklist/WaiverItem.jsx`**

```jsx
import { useState } from 'react';
import api from '../../../api';

const BTN = {
  width: '100%', height: 52, borderRadius: 12, background: '#1a2d4a',
  color: '#fff', border: 'none', fontSize: 16, fontWeight: 700, cursor: 'pointer',
};

export default function WaiverItem({ booking, onUpdate }) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  async function handleSign() {
    setLoading(true); setError(null);
    try {
      const res = await api.post(`/portal/checkin/bookings/${booking.id}/waiver/`);
      window.open(res.data.sign_url, '_blank', 'noopener,noreferrer');
      // Poll for completion: user returns to tab after signing
      // We reload after 3 s to pick up webhook-updated waiver_signed flag
      setTimeout(onUpdate, 3000);
    } catch {
      setError('Could not load the waiver. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 14, lineHeight: 1.6 }}>
        The marina requires a signed waiver before arrival. Tap below to open the waiver in a new tab. Return here once you have signed.
      </div>
      {error && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10 }}>{error}</div>}
      <button style={BTN} disabled={loading} onClick={handleSign}>
        {loading ? 'Loading waiver…' : '📝 Sign Waiver'}
      </button>
      <button
        style={{ width: '100%', marginTop: 10, height: 44, background: 'transparent', border: 'none', fontSize: 14, color: 'rgba(0,0,0,0.4)', cursor: 'pointer' }}
        onClick={onUpdate}
      >
        I've already signed — refresh
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create `portal/src/components/portal/checklist/InsuranceItem.jsx`**

```jsx
import { useState } from 'react';
import api from '../../../api';

const BTN = {
  width: '100%', height: 52, borderRadius: 12, background: '#f4f6f8',
  color: '#1a2d4a', border: '1.5px solid rgba(0,0,0,0.12)', fontSize: 15, fontWeight: 600, cursor: 'pointer',
};

export default function InsuranceItem({ booking, onUpdate }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState(null);

  async function handleFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true); setError(null);
    const form = new FormData();
    form.append('file', file);
    try {
      await api.post(`/portal/checkin/bookings/${booking.id}/insurance/`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onUpdate();
    } catch {
      setError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 14, lineHeight: 1.6 }}>
        Optional: upload a copy of your vessel insurance certificate.
      </div>
      {error && <div style={{ color: '#c0392b', fontSize: 13, marginBottom: 10 }}>{error}</div>}
      <label style={{ ...BTN, display: 'block', lineHeight: '52px', textAlign: 'center', cursor: uploading ? 'wait' : 'pointer' }}>
        {uploading ? 'Uploading…' : '📎 Upload Insurance Certificate'}
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={handleFile} disabled={uploading} />
      </label>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add portal/src/components/portal/checklist/WaiverItem.jsx portal/src/components/portal/checklist/InsuranceItem.jsx
git commit -m "feat: add WaiverItem and InsuranceItem checklist components"
```

---

## Task 14: Frontend — `CountdownView` + `ArrivalView`

**Files:**
- Create: `portal/src/components/portal/CountdownView.jsx`
- Create: `portal/src/components/portal/ArrivalView.jsx`

- [ ] **Step 1: Create `portal/src/components/portal/CountdownView.jsx`**

```jsx
const HDR = { background: '#1a2d4a', padding: '20px 20px 16px', color: '#fff' };
const CARD = { background: '#fff', borderRadius: 14, padding: 24, margin: '16px 16px 0', boxShadow: '0 1px 4px rgba(0,0,0,0.08)', textAlign: 'center' };

function daysUntil(dateStr) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const arrival = new Date(dateStr);
  return Math.ceil((arrival - today) / 86400000);
}

export default function CountdownView({ booking }) {
  const days = daysUntil(booking.check_in);
  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
      <div style={HDR}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>You're all set!</div>
        <div style={{ fontSize: 13, opacity: 0.6, marginTop: 4 }}>Pre-arrival checklist complete</div>
      </div>
      <div style={CARD}>
        <div style={{ fontSize: 60, fontWeight: 800, color: '#1a2d4a', lineHeight: 1 }}>{days}</div>
        <div style={{ fontSize: 16, color: 'rgba(0,0,0,0.5)', marginTop: 6 }}>
          {days === 1 ? 'day until arrival' : 'days until arrival'}
        </div>
        <div style={{ marginTop: 20, fontSize: 14, color: 'rgba(0,0,0,0.45)' }}>
          Arriving {booking.check_in} · Departing {booking.check_out}
        </div>
      </div>
      <div style={{ margin: '12px 16px', background: '#fff', borderRadius: 14, padding: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(0,0,0,0.5)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>Your Berth</div>
        {booking.berth_code
          ? <div style={{ fontSize: 20, fontWeight: 700 }}>{booking.berth_pier} · {booking.berth_code}</div>
          : <div style={{ fontSize: 14, color: 'rgba(0,0,0,0.4)' }}>Berth will be assigned before arrival</div>
        }
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `portal/src/components/portal/ArrivalView.jsx`**

```jsx
import { useState } from 'react';
import api from '../../api';

const PULSE_STYLE = `
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}
`;

export default function ArrivalView({ booking, onCheckedIn }) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  async function handleArrive() {
    setLoading(true); setError(null);
    try {
      await api.post(`/portal/checkin/bookings/${booking.id}/self-checkin/`);
      onCheckedIn();
    } catch {
      setError('Check-in failed. Please try again or contact the harbour master.');
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8', display: 'flex', flexDirection: 'column' }}>
      <style>{PULSE_STYLE}</style>
      <div style={{ background: '#1a2d4a', padding: '20px 20px 16px', color: '#fff' }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>Welcome!</div>
        <div style={{ fontSize: 13, opacity: 0.6, marginTop: 4 }}>Ready to check in</div>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px' }}>
        {booking.berth_code && (
          <div style={{ textAlign: 'center', marginBottom: 32 }}>
            <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>Your Berth</div>
            <div style={{ fontSize: 28, fontWeight: 800, color: '#1a2d4a' }}>{booking.berth_pier} · {booking.berth_code}</div>
          </div>
        )}
        {error && (
          <div style={{ color: '#c0392b', fontSize: 14, marginBottom: 20, textAlign: 'center' }}>{error}</div>
        )}
        <button
          onClick={handleArrive}
          disabled={loading}
          style={{
            width: '100%', maxWidth: 400, height: 80, borderRadius: 16,
            background: loading ? '#888' : '#1a2d4a', color: '#fff', border: 'none',
            fontSize: 18, fontWeight: 800, cursor: loading ? 'wait' : 'pointer',
            animation: loading ? 'none' : 'pulse 2s ease-in-out infinite',
            letterSpacing: 0.5,
          }}
        >
          {loading ? 'Checking you in…' : 'I Have Arrived — Self Check-In'}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add portal/src/components/portal/CountdownView.jsx portal/src/components/portal/ArrivalView.jsx
git commit -m "feat: add CountdownView and ArrivalView portal components"
```

---

## Task 15: Frontend — `WalletCard`

**Files:**
- Create: `portal/src/components/portal/WalletCard.jsx`

- [ ] **Step 1: Create `portal/src/components/portal/WalletCard.jsx`**

```jsx
import { useState } from 'react';

const CARD = { background: '#fff', borderRadius: 14, padding: 20, marginBottom: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' };
const LABEL = { fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 };
const VALUE = { fontSize: 18, fontWeight: 700, color: '#1a2d4a' };

function CopyRow({ label, value }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
      <div>
        <div style={LABEL}>{label}</div>
        <div style={VALUE}>{value}</div>
      </div>
      <button onClick={copy} style={{ background: copied ? '#27ae60' : '#f4f6f8', border: 'none', borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', color: copied ? '#fff' : '#1a2d4a', transition: 'background 0.2s' }}>
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

export default function WalletCard({ booking }) {
  const w = booking.marina_wallet;
  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f8' }}>
      <div style={{ background: '#1a2d4a', padding: '20px 20px 16px', color: '#fff' }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{w.marina_name}</div>
        <div style={{ fontSize: 13, opacity: 0.6, marginTop: 4 }}>Marina Card</div>
      </div>
      <div style={{ padding: '16px 16px 40px' }}>

        {/* Berth */}
        {(booking.berth_code || booking.berth_pier) && (
          <div style={CARD}>
            <div style={LABEL}>Your Berth</div>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#1a2d4a' }}>
              {[booking.berth_pier, booking.berth_code].filter(Boolean).join(' · ')}
            </div>
          </div>
        )}

        {/* WiFi */}
        {w.wifi_network && (
          <div style={CARD}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>📶 WiFi</div>
            <CopyRow label="Network" value={w.wifi_network} />
            {w.wifi_password && <CopyRow label="Password" value={w.wifi_password} />}
          </div>
        )}

        {/* Gate codes */}
        {w.gate_codes?.length > 0 && (
          <div style={CARD}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>🔐 Gate Access</div>
            {w.gate_codes.map((g, i) => (
              <CopyRow key={i} label={g.label} value={g.pin} />
            ))}
          </div>
        )}

        {/* Contacts */}
        <div style={CARD}>
          <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>📞 Contacts</div>
          {w.harbour_master_phone && (
            <div style={{ marginBottom: 10 }}>
              <div style={LABEL}>Harbour Master</div>
              <a href={`tel:${w.harbour_master_phone}`} style={{ ...VALUE, textDecoration: 'none', color: '#1a2d4a' }}>
                {w.harbour_master_phone}
              </a>
            </div>
          )}
          {w.vhf_channel && (
            <div style={{ marginBottom: 10 }}>
              <div style={LABEL}>VHF Channel</div>
              <div style={VALUE}>{w.vhf_channel}</div>
            </div>
          )}
          {w.office_hours && (
            <div>
              <div style={LABEL}>Office Hours</div>
              <div style={{ fontSize: 15, color: 'rgba(0,0,0,0.7)' }}>{w.office_hours}</div>
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.3)' }}>
            Stay: {booking.check_in} → {booking.check_out}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add portal/src/components/portal/WalletCard.jsx
git commit -m "feat: add WalletCard portal component"
```

---

## Task 16: Frontend — wire `App.jsx` + `main.jsx` routing

**Files:**
- Modify: `portal/src/App.jsx`
- Modify: `portal/src/main.jsx`

- [ ] **Step 1: Update `portal/src/main.jsx`**

Replace the file with:

```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { TenantProvider } from './context/TenantContext';
import App from './App';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <TenantProvider>
        <App />
      </TenantProvider>
    </BrowserRouter>
  </StrictMode>
);
```

- [ ] **Step 2: Update `portal/src/App.jsx`**

Replace the file with:

```jsx
import { useSearchParams } from 'react-router-dom';
import { useTenant } from './context/TenantContext';
import Magic from './screens/Magic';
import BookingDashboard from './screens/BookingDashboard';

export default function App() {
  const [params] = useSearchParams();
  const { marina, isLoading, tenantSlug, customDomain } = useTenant();

  // Magic link takes priority regardless of path
  if (params.get('token')) return <Magic />;

  // If there is a stored session, go straight to dashboard without waiting for tenant
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

  return (
    <div style={{ fontFamily: 'sans-serif', maxWidth: 600, margin: '80px auto', textAlign: 'center' }}>
      <h1>{marina.name}</h1>
      <p>Online booking coming soon.</p>
    </div>
  );
}
```

- [ ] **Step 3: Start the portal dev server and verify the magic link flow manually**

```bash
cd portal && npm run dev
```

Open `http://localhost:5173/?token=FAKE` — should show "Link expired" error (Magic screen renders and API returns 401).

Open `http://localhost:5173/` with no session — should show the tenant-loading flow.

- [ ] **Step 4: Commit**

```bash
git add portal/src/App.jsx portal/src/main.jsx
git commit -m "feat: wire portal routing — magic link and booking dashboard"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task covering it |
|---|---|
| Magic link token signed by Django, expires | Task 3 (`make_magic_token`) |
| `POST /api/portal/auth/magic/` exchanges token | Task 6 |
| Portal JWT scoped to booking_id | Tasks 3, 4 |
| Booking portal fields (dimensions, waiver, pre_cleared, self_checked_in) | Task 1 |
| Marina wallet fields | Task 2 |
| `evaluate_pre_cleared` called from PATCH and webhook | Tasks 3, 7, 8 |
| `is_arrival_day` uses marina timezone (not UTC) | Task 3, 5 |
| `marina_wallet` only exposed when `self_checked_in=True` | Task 5 |
| Pre-clearance checklist: dimensions form | Task 12 |
| Pre-clearance checklist: Dropbox Sign waiver | Tasks 8, 13 |
| Pre-clearance checklist: insurance upload (optional) | Tasks 9, 13 |
| Arrival day pulsing button, single tap | Task 14 |
| Self-checkin sets `status='checked_in'` | Task 7 |
| Marina Wallet Card: WiFi, gates, harbour master, VHF, office hours | Tasks 2, 5, 15 |
| Tap-to-copy on passwords/PINs | Task 15 |
| Tap-to-call on harbour master phone | Task 15 |
| Dropbox Sign webhook HMAC validation | Task 8 |
| Idempotent self-checkin | Task 7 |
| Idempotent waiver (re-fetch existing envelope) | Task 8 |
| `make_magic_url()` utility for email sending | Task 3 |

**Placeholder scan:** No TBDs. All code steps contain complete implementations.

**Type consistency:** `booking_id` used consistently throughout. `boat_loa / boat_beam / boat_draft` used consistently (reusing existing model field names + adding draft). `PortalUser` attributes (`booking_id`, `marina_slug`, `boater_email`) match across `checkin_auth.py`, `checkin_views.py`, and `checkin_utils.py`.
