# Booking Checkout Redesign — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-18-booking-checkout-redesign-phase1-design.md`

**Goal:** Restructure the public booking flow as a 3-step wizard with a persistent right-side summary panel; capture the additional fields a real marina booking needs (air draft, registration, flag, crew, billing address, ETA, special requests, shore power, T&Cs acceptance, insurance certificate); store the data on `Reservation`/`ReservationItem`; wire the collected billing address into Stripe.

**Architecture:** Additive backend changes only (new optional fields on existing models, one new `InsuranceUploadToken` model, one new public endpoint). Frontend rewires `booking/src/screens/QuoteScreen.jsx` as a `vessel | guest | payment` state machine with shared step state and a sibling summary panel. Insurance files use the upload-token pattern: file goes to `MEDIA_ROOT/reservations/insurance/tmp/<token>.<ext>`, then copied to its final `FileField` location at intent-creation time and deleted from `/tmp/` via `transaction.on_commit`.

**Tech Stack:** Django 6.0 + DRF, Celery (beat), Stripe (`PaymentIntent` + `PaymentElement`), React 18 + Vite + Vitest, axios via `shared/portal-ui/src/api.js`.

---

## File Structure

**Backend (`backend/`):**
- Create: `apps/reservations/constants.py` (ALLOWED_COUNTRIES set)
- Modify: `apps/accounts/models.py` (4 new `Marina` fields)
- Create: `apps/accounts/migrations/0039_marina_booking_terms_and_requirements.py`
- Modify: `apps/reservations/models.py` (new `Reservation`/`ReservationItem` fields, new `InsuranceUploadToken` model)
- Create: `apps/reservations/migrations/NNNN_phase1_booking_fields_and_insurance_token.py`
- Modify: `apps/reservations/public_reservation_views.py` (serializer extensions, T&Cs validation, token redemption, new `InsuranceUploadView`)
- Modify: `apps/portal/public_urls.py` (route for insurance upload)
- Modify: `apps/portal/views.py` (extend `MarinaPublicView` response with new fields)
- Modify: `apps/reservations/tasks.py` (new `purge_expired_insurance_uploads` task)
- Modify: `backend/config/settings/base.py` (beat schedule entry)
- Create: `apps/reservations/tests_phase1_booking.py` (all new backend tests)

**Frontend:**
- Modify: `shared/portal-ui/src/api.js` (add `uploadInsuranceCertificate` helper)
- Create: `booking/src/components/InsuranceUpload.jsx`
- Create: `booking/src/screens/quote/BookingSummary.jsx`
- Create: `booking/src/screens/quote/VesselStep.jsx`
- Create: `booking/src/screens/quote/GuestStep.jsx`
- Create: `booking/src/screens/quote/PaymentStep.jsx`
- Modify: `booking/src/screens/QuoteScreen.jsx` (state machine + 2-col layout)
- Modify: `booking/src/styles/booking.css` (grid layout, sticky panel, mobile bottom bar)
- Modify: `booking/src/screens/QuoteScreen.test.jsx` (multi-step flow tests)

---

## Task 1: Add Marina T&Cs and requirement fields

**Files:**
- Modify: `backend/apps/accounts/models.py` (`Marina` class)
- Create: `backend/apps/accounts/migrations/0039_marina_booking_terms_and_requirements.py`
- Create: `backend/apps/reservations/tests_phase1_booking.py`

- [ ] **Step 1: Write the failing test**

Create `backend/apps/reservations/tests_phase1_booking.py`:

```python
import datetime
from decimal import Decimal
from django.test import TestCase
from apps.accounts.models import Marina


def make_marina(**overrides):
    defaults = dict(name='Phase1 Test Marina', slug='phase1-test')
    defaults.update(overrides)
    return Marina.objects.create(**defaults)


class MarinaPhase1FieldsTest(TestCase):
    def test_defaults(self):
        m = make_marina()
        self.assertEqual(m.booking_terms_pdf_url, '')
        self.assertEqual(m.booking_terms_version, '1.0')
        self.assertFalse(m.requires_air_draft)
        self.assertFalse(m.requires_insurance_at_booking)
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && python -m pytest apps/reservations/tests_phase1_booking.py::MarinaPhase1FieldsTest -v`
Expected: FAIL — `AttributeError: 'Marina' object has no attribute 'booking_terms_pdf_url'`

- [ ] **Step 3: Add fields to `Marina` model**

In `backend/apps/accounts/models.py`, locate the `Marina` class and add (place near other configuration fields, e.g. after `waiver_template_id`):

```python
    booking_terms_pdf_url           = models.URLField(blank=True, default='')
    booking_terms_version           = models.CharField(max_length=32, blank=True, default='1.0')
    requires_air_draft              = models.BooleanField(default=False)
    requires_insurance_at_booking   = models.BooleanField(default=False)
```

- [ ] **Step 4: Generate migration**

Run: `cd backend && python manage.py makemigrations accounts --name marina_booking_terms_and_requirements`
Expected: creates `apps/accounts/migrations/0039_marina_booking_terms_and_requirements.py`

- [ ] **Step 5: Apply migration**

Run: `cd backend && python manage.py migrate accounts`
Expected: `Applying accounts.0039_marina_booking_terms_and_requirements... OK`

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd backend && python -m pytest apps/reservations/tests_phase1_booking.py::MarinaPhase1FieldsTest -v`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add backend/apps/accounts/models.py backend/apps/accounts/migrations/0039_marina_booking_terms_and_requirements.py backend/apps/reservations/tests_phase1_booking.py
git commit -m "feat(accounts): add Marina T&Cs + requirement fields for Phase 1 booking"
```

---

## Task 2: Add Reservation + ReservationItem fields + InsuranceUploadToken model

**Files:**
- Modify: `backend/apps/reservations/models.py`
- Create: `backend/apps/reservations/migrations/NNNN_phase1_booking_fields_and_insurance_token.py` (NNNN = next migration number)
- Modify: `backend/apps/reservations/tests_phase1_booking.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/apps/reservations/tests_phase1_booking.py`:

```python
from apps.reservations.models import Reservation, ReservationItem, InsuranceUploadToken


class ReservationPhase1FieldsTest(TestCase):
    def setUp(self):
        self.marina = make_marina()

    def test_reservation_defaults(self):
        r = Reservation.objects.create(
            marina=self.marina,
            guest_name='Alice',
            guest_email='a@b.test',
            status='pending_review',
        )
        self.assertIsNone(r.estimated_arrival_time)
        self.assertEqual(r.special_requests, '')
        self.assertIsNone(r.shore_power_amperage)
        self.assertIsNone(r.terms_accepted_at)
        self.assertEqual(r.terms_version, '')
        self.assertEqual(r.billing_street, '')
        self.assertEqual(r.billing_city, '')
        self.assertEqual(r.billing_postcode, '')
        self.assertEqual(r.billing_country, '')
        self.assertEqual(r.company_name, '')
        self.assertEqual(r.vat_number, '')
        self.assertEqual(r.promo_code, '')


class ReservationItemPhase1FieldsTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.reservation = Reservation.objects.create(
            marina=self.marina, guest_name='A', guest_email='a@b.test', status='pending_review',
        )

    def test_item_defaults(self):
        item = ReservationItem.objects.create(
            reservation=self.reservation,
            check_in=datetime.date(2026, 6, 1),
            check_out=datetime.date(2026, 6, 5),
            nights=4,
            boat_loa=Decimal('12.00'),
            status='unassigned',
        )
        self.assertIsNone(item.boat_air_draft)
        self.assertEqual(item.vessel_registration, '')
        self.assertEqual(item.vessel_flag, '')
        self.assertIsNone(item.crew_count)
        self.assertFalse(item.insurance_certificate)  # FileField empty is falsy


class InsuranceUploadTokenTest(TestCase):
    def setUp(self):
        self.marina = make_marina()

    def test_token_create(self):
        t = InsuranceUploadToken.objects.create(
            token='tk_abc123',
            marina=self.marina,
            file_path='reservations/insurance/tmp/tk_abc123.pdf',
            mime_type='application/pdf',
            size_bytes=12345,
        )
        self.assertIsNotNone(t.created_at)
        self.assertIsNone(t.consumed_at)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest apps/reservations/tests_phase1_booking.py::ReservationPhase1FieldsTest apps/reservations/tests_phase1_booking.py::ReservationItemPhase1FieldsTest apps/reservations/tests_phase1_booking.py::InsuranceUploadTokenTest -v`
Expected: FAIL — multiple `AttributeError` and `ImportError: cannot import name 'InsuranceUploadToken'`.

- [ ] **Step 3: Add fields to `Reservation`**

In `backend/apps/reservations/models.py`, locate the `Reservation` class. Add these fields (place after the existing `waiver_*` block):

```python
    # Phase 1 booking-flow additions (spec 2026-05-18)
    estimated_arrival_time  = models.TimeField(null=True, blank=True)
    special_requests        = models.TextField(blank=True, default='')

    SHORE_POWER_CHOICES = [
        ('16A',  '16A'),
        ('32A',  '32A'),
        ('63A',  '63A'),
        ('none', 'None'),
    ]
    shore_power_amperage    = models.CharField(
        max_length=8, choices=SHORE_POWER_CHOICES, null=True, blank=True,
    )

    terms_accepted_at       = models.DateTimeField(null=True, blank=True)
    terms_version           = models.CharField(max_length=32, blank=True, default='')

    billing_street          = models.CharField(max_length=200, blank=True, default='')
    billing_city            = models.CharField(max_length=100, blank=True, default='')
    billing_postcode        = models.CharField(max_length=20,  blank=True, default='')
    billing_country         = models.CharField(max_length=2,   blank=True, default='')

    company_name            = models.CharField(max_length=200, blank=True, default='')
    vat_number              = models.CharField(max_length=50,  blank=True, default='')
    promo_code              = models.CharField(max_length=50,  blank=True, default='')
```

- [ ] **Step 4: Add fields to `ReservationItem`**

In the same file, locate the `ReservationItem` class and add (place after the existing boat dimension fields):

```python
    # Phase 1 vessel-detail additions
    boat_air_draft          = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    vessel_registration     = models.CharField(max_length=50, blank=True, default='')
    vessel_flag             = models.CharField(max_length=2,  blank=True, default='')
    crew_count              = models.PositiveSmallIntegerField(null=True, blank=True)
    insurance_certificate   = models.FileField(
        upload_to='reservations/insurance/%Y/%m/',
        null=True, blank=True,
    )
```

- [ ] **Step 5: Add `InsuranceUploadToken` model**

Append to `backend/apps/reservations/models.py` (after the existing classes):

```python
class InsuranceUploadToken(models.Model):
    """
    Short-lived token issued by POST /public/reservations/insurance-upload/
    so the booking flow can upload an insurance PDF *before* the reservation
    record exists. The token is redeemed atomically inside the intent view,
    which copies the file into the corresponding ReservationItem.insurance_certificate.
    The tmp file is deleted via transaction.on_commit; a defensive Celery task
    purges any stragglers + rows past TTL.
    """
    token        = models.CharField(max_length=64, unique=True, db_index=True)
    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE)
    file_path    = models.CharField(max_length=500)   # MEDIA_ROOT-relative
    mime_type    = models.CharField(max_length=64)
    size_bytes   = models.PositiveIntegerField()
    created_at   = models.DateTimeField(auto_now_add=True)
    consumed_at  = models.DateTimeField(null=True, blank=True)

    class Meta:
        indexes = [models.Index(fields=['created_at'])]

    def __str__(self):
        return f'InsuranceUploadToken({self.token[:8]}…, marina={self.marina_id})'
```

- [ ] **Step 6: Generate migration**

Run: `cd backend && python manage.py makemigrations reservations --name phase1_booking_fields_and_insurance_token`
Expected: creates a new file under `apps/reservations/migrations/`.

- [ ] **Step 7: Apply migration**

Run: `cd backend && python manage.py migrate reservations`
Expected: `Applying reservations.NNNN_phase1_booking_fields_and_insurance_token... OK`

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd backend && python -m pytest apps/reservations/tests_phase1_booking.py -v`
Expected: PASS (all four test classes).

- [ ] **Step 9: Commit**

```bash
git add backend/apps/reservations/models.py backend/apps/reservations/migrations/ backend/apps/reservations/tests_phase1_booking.py
git commit -m "feat(reservations): Phase 1 booking fields + InsuranceUploadToken model"
```

---

## Task 3: Add ALLOWED_COUNTRIES constants

**Files:**
- Create: `backend/apps/reservations/constants.py`
- Modify: `backend/apps/reservations/tests_phase1_booking.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/reservations/tests_phase1_booking.py`:

```python
class AllowedCountriesTest(TestCase):
    def test_constant_contains_eu_uk_us(self):
        from apps.reservations.constants import ALLOWED_COUNTRIES
        for code in ('FR', 'DE', 'GB', 'US'):
            self.assertIn(code, ALLOWED_COUNTRIES)

    def test_constant_excludes_garbage(self):
        from apps.reservations.constants import ALLOWED_COUNTRIES
        self.assertNotIn('ZZ', ALLOWED_COUNTRIES)
        self.assertNotIn('', ALLOWED_COUNTRIES)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest apps/reservations/tests_phase1_booking.py::AllowedCountriesTest -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'apps.reservations.constants'`.

- [ ] **Step 3: Create the constants module**

Create `backend/apps/reservations/constants.py`:

```python
"""
Allowed ISO 3166-1 alpha-2 country codes for billing_country / vessel_flag.

Initial set: EU 27 + EFTA + UK + US + CA + AU + NZ + TR + MC + ME + RS.
Extend before launch as customer geography demands.
"""

ALLOWED_COUNTRIES = frozenset({
    # EU 27
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR',
    'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK',
    'SI', 'ES', 'SE',
    # EFTA + UK
    'IS', 'LI', 'NO', 'CH', 'GB',
    # English-speaking maritime markets
    'US', 'CA', 'AU', 'NZ',
    # Mediterranean + Balkans
    'TR', 'MC', 'ME', 'RS',
})
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest apps/reservations/tests_phase1_booking.py::AllowedCountriesTest -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/apps/reservations/constants.py backend/apps/reservations/tests_phase1_booking.py
git commit -m "feat(reservations): add ALLOWED_COUNTRIES constant"
```

---

## Task 4: Insurance upload endpoint

**Files:**
- Modify: `backend/apps/reservations/public_reservation_views.py`
- Modify: `backend/apps/portal/public_urls.py`
- Modify: `backend/apps/reservations/tests_phase1_booking.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/apps/reservations/tests_phase1_booking.py`:

```python
from rest_framework.test import APIClient
from django.core.files.uploadedfile import SimpleUploadedFile
from apps.reservations.models import InsuranceUploadToken


class InsuranceUploadEndpointTest(TestCase):
    def setUp(self):
        self.marina = make_marina(slug='insurance-test-marina')
        self.client = APIClient()
        self.url = '/api/v1/public/reservations/insurance-upload/'
        self.headers = {'HTTP_X_MARINA_SLUG': self.marina.slug}

    def _pdf(self, name='cert.pdf', size=1024):
        return SimpleUploadedFile(name, b'%PDF-1.4\n' + b'x' * (size - 9), content_type='application/pdf')

    def test_happy_path_returns_token(self):
        r = self.client.post(self.url, {'file': self._pdf()}, format='multipart', **self.headers)
        self.assertEqual(r.status_code, 201, r.content)
        body = r.json()
        self.assertIn('token', body)
        self.assertIn('expires_at', body)
        self.assertTrue(InsuranceUploadToken.objects.filter(token=body['token']).exists())

    def test_rejects_non_pdf_non_image(self):
        bad = SimpleUploadedFile('cert.exe', b'MZ\x90\x00', content_type='application/x-msdownload')
        r = self.client.post(self.url, {'file': bad}, format='multipart', **self.headers)
        self.assertEqual(r.status_code, 400)
        self.assertIn('mime', r.json().get('detail', '').lower())

    def test_rejects_oversize(self):
        big = SimpleUploadedFile('big.pdf', b'%PDF-1.4\n' + b'x' * (6 * 1024 * 1024), content_type='application/pdf')
        r = self.client.post(self.url, {'file': big}, format='multipart', **self.headers)
        self.assertEqual(r.status_code, 400)
        self.assertIn('size', r.json().get('detail', '').lower())

    def test_rejects_missing_marina(self):
        r = self.client.post(self.url, {'file': self._pdf()}, format='multipart')
        self.assertEqual(r.status_code, 404)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest apps/reservations/tests_phase1_booking.py::InsuranceUploadEndpointTest -v`
Expected: FAIL — 404 on all (route doesn't exist).

- [ ] **Step 3: Add the view**

Append to `backend/apps/reservations/public_reservation_views.py` (before `ReservationIntentView` or at end of file):

```python
import os
import secrets as _secrets
from django.conf import settings
from django.core.files.storage import default_storage
from .models import InsuranceUploadToken


ALLOWED_INSURANCE_MIME = {'application/pdf', 'image/jpeg', 'image/png'}
MAX_INSURANCE_BYTES    = 5 * 1024 * 1024  # 5 MB
INSURANCE_TOKEN_TTL    = datetime.timedelta(hours=24)


class InsuranceUploadView(APIView):
    """
    POST /api/v1/public/reservations/insurance-upload/

    Boater uploads an insurance certificate (PDF/JPG/PNG, ≤ 5 MB) before the
    reservation is created. Returns an opaque token the booking flow attaches
    to one or more ReservationItems at intent-creation time.

    Files are stored under MEDIA_ROOT/reservations/insurance/tmp/<token>.<ext>.
    A defensive Celery task purges files + rows past TTL.
    """
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_scope = 'public_insurance_upload'

    def post(self, request):
        if request.tenant is None:
            return Response({'detail': 'Marina not found.'}, status=status.HTTP_404_NOT_FOUND)

        f = request.FILES.get('file')
        if f is None:
            return Response({'detail': 'file is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if f.content_type not in ALLOWED_INSURANCE_MIME:
            return Response({'detail': f'Unsupported mime type: {f.content_type}.'},
                            status=status.HTTP_400_BAD_REQUEST)
        if f.size > MAX_INSURANCE_BYTES:
            return Response({'detail': 'File size exceeds 5 MB limit.'},
                            status=status.HTTP_400_BAD_REQUEST)

        token = _secrets.token_urlsafe(32)
        ext = {'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png'}[f.content_type]
        tmp_path = f'reservations/insurance/tmp/{token}.{ext}'

        # default_storage.save will not overwrite if file exists; tokens are
        # unique enough that collision is practically impossible.
        saved_path = default_storage.save(tmp_path, f)

        record = InsuranceUploadToken.objects.create(
            token=token,
            marina=request.tenant,
            file_path=saved_path,
            mime_type=f.content_type,
            size_bytes=f.size,
        )
        expires_at = record.created_at + INSURANCE_TOKEN_TTL
        return Response({
            'token': token,
            'expires_at': expires_at.isoformat(),
        }, status=status.HTTP_201_CREATED)
```

- [ ] **Step 4: Register the URL**

In `backend/apps/portal/public_urls.py`, add the import and route. Locate the existing reservation routes and insert (next to `'reservations/intent/'`):

```python
from apps.reservations.public_reservation_views import (
    ReservationIntentView,
    ReservationConfirmView,  # if already imported
    InsuranceUploadView,
)

# inside urlpatterns, near the other reservations routes:
    path('reservations/insurance-upload/',      InsuranceUploadView.as_view(),    name='public-reservation-insurance-upload'),
```

(Adjust import block to match the file's existing import style — only the additions of `InsuranceUploadView` and the `path` line are new.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && python -m pytest apps/reservations/tests_phase1_booking.py::InsuranceUploadEndpointTest -v`
Expected: PASS (all four tests).

- [ ] **Step 6: Commit**

```bash
git add backend/apps/reservations/public_reservation_views.py backend/apps/portal/public_urls.py backend/apps/reservations/tests_phase1_booking.py
git commit -m "feat(reservations): InsuranceUploadView for pre-payment certificate upload"
```

---

## Task 5: Extend `CartItemSerializer` and `ReservationIntentSerializer`

**Files:**
- Modify: `backend/apps/reservations/public_reservation_views.py`
- Modify: `backend/apps/reservations/tests_phase1_booking.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/reservations/tests_phase1_booking.py`:

```python
from apps.reservations.public_reservation_views import (
    CartItemSerializer, ReservationIntentSerializer,
)


class SerializerExtensionsTest(TestCase):
    def setUp(self):
        self.marina = make_marina()

    def test_cart_item_accepts_new_optional_fields(self):
        data = {
            'boat_loa': '12.5',
            'boat_air_draft': '4.2',
            'vessel_registration': 'GB-123-XYZ',
            'vessel_flag': 'GB',
            'crew_count': 3,
            'insurance_upload_token': 'tk_abc',
            'vessel_name': 'Bella',
        }
        ser = CartItemSerializer(data=data)
        self.assertTrue(ser.is_valid(), ser.errors)
        self.assertEqual(ser.validated_data['vessel_flag'], 'GB')
        self.assertEqual(ser.validated_data['crew_count'], 3)
        self.assertEqual(ser.validated_data['insurance_upload_token'], 'tk_abc')

    def test_cart_item_omitting_new_fields_is_valid(self):
        ser = CartItemSerializer(data={'boat_loa': '10.0'})
        self.assertTrue(ser.is_valid(), ser.errors)

    def test_intent_accepts_new_booking_fields(self):
        data = {
            'check_in':  '2026-08-01',
            'check_out': '2026-08-05',
            'guest_name':  'Alice',
            'guest_email': 'a@b.test',
            'guest_phone': '+44 7000 000000',
            'estimated_arrival_time': '14:30',
            'special_requests': 'arriving on engine',
            'shore_power_amperage': '32A',
            'billing_street':   '1 Quay St',
            'billing_city':     'Plymouth',
            'billing_postcode': 'PL1 1AB',
            'billing_country':  'GB',
            'company_name': 'Acme Charter Ltd',
            'vat_number':   'GB123456789',
            'promo_code':   'WELCOME10',
            'terms_accepted': True,
            'items': [{'boat_loa': '12.5'}],
        }
        ser = ReservationIntentSerializer(data=data)
        self.assertTrue(ser.is_valid(), ser.errors)
        self.assertEqual(ser.validated_data['billing_country'], 'GB')
        self.assertTrue(ser.validated_data['terms_accepted'])

    def test_intent_rejects_unknown_country(self):
        data = {
            'check_in': '2026-08-01', 'check_out': '2026-08-05',
            'guest_name': 'A', 'guest_email': 'a@b.test',
            'billing_country': 'ZZ',
            'items': [{'boat_loa': '10.0'}],
        }
        ser = ReservationIntentSerializer(data=data)
        self.assertFalse(ser.is_valid())
        self.assertIn('billing_country', ser.errors)

    def test_intent_rejects_bad_vat_format(self):
        data = {
            'check_in': '2026-08-01', 'check_out': '2026-08-05',
            'guest_name': 'A', 'guest_email': 'a@b.test',
            'vat_number': '!!',  # too short / invalid chars
            'items': [{'boat_loa': '10.0'}],
        }
        ser = ReservationIntentSerializer(data=data)
        self.assertFalse(ser.is_valid())
        self.assertIn('vat_number', ser.errors)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest apps/reservations/tests_phase1_booking.py::SerializerExtensionsTest -v`
Expected: FAIL (multiple — new fields not yet on serializers).

- [ ] **Step 3: Extend `CartItemSerializer`**

In `backend/apps/reservations/public_reservation_views.py`, replace the `CartItemSerializer` class with:

```python
class CartItemSerializer(serializers.Serializer):
    berth_category_id       = serializers.IntegerField(allow_null=True, required=False)
    boat_loa                = serializers.DecimalField(max_digits=6, decimal_places=2)
    boat_beam               = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    boat_draft              = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    boat_air_draft          = serializers.DecimalField(max_digits=5, decimal_places=2, required=False, allow_null=True)
    vessel_name             = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')
    vessel_registration     = serializers.CharField(max_length=50,  required=False, allow_blank=True, default='')
    vessel_flag             = serializers.CharField(max_length=2,   required=False, allow_blank=True, default='')
    crew_count              = serializers.IntegerField(min_value=1, required=False, allow_null=True)
    insurance_upload_token  = serializers.CharField(max_length=64,  required=False, allow_blank=True, default='', write_only=True)
```

- [ ] **Step 4: Extend `ReservationIntentSerializer`**

In the same file, replace the `ReservationIntentSerializer` class with:

```python
import re as _re
from .constants import ALLOWED_COUNTRIES

VAT_REGEX = _re.compile(r'^[A-Z0-9 .\-]{4,30}$')


class ReservationIntentSerializer(serializers.Serializer):
    check_in     = serializers.DateField()
    check_out    = serializers.DateField()
    guest_name   = serializers.CharField(max_length=200)
    guest_email  = serializers.EmailField()
    guest_phone  = serializers.CharField(max_length=50, required=False, allow_blank=True, default='')

    estimated_arrival_time = serializers.TimeField(required=False, allow_null=True)
    special_requests       = serializers.CharField(required=False, allow_blank=True, default='')
    shore_power_amperage   = serializers.ChoiceField(
        choices=['16A', '32A', '63A', 'none'],
        required=False, allow_null=True,
    )

    billing_street   = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')
    billing_city     = serializers.CharField(max_length=100, required=False, allow_blank=True, default='')
    billing_postcode = serializers.CharField(max_length=20,  required=False, allow_blank=True, default='')
    billing_country  = serializers.CharField(max_length=2,   required=False, allow_blank=True, default='')

    company_name     = serializers.CharField(max_length=200, required=False, allow_blank=True, default='')
    vat_number       = serializers.CharField(max_length=50,  required=False, allow_blank=True, default='')
    promo_code       = serializers.CharField(max_length=50,  required=False, allow_blank=True, default='')

    terms_accepted   = serializers.BooleanField(required=False, default=False)

    items            = CartItemSerializer(many=True, min_length=1)

    def validate_billing_country(self, value):
        if value and value.upper() not in ALLOWED_COUNTRIES:
            raise serializers.ValidationError(f'Unsupported country code: {value}.')
        return value.upper() if value else value

    def validate_vat_number(self, value):
        if value and not VAT_REGEX.match(value):
            raise serializers.ValidationError('VAT number format is invalid.')
        return value

    def validate(self, data):
        if data['check_in'] >= data['check_out']:
            raise serializers.ValidationError({'check_out': 'check_out must be after check_in.'})
        if data['check_in'] < datetime.date.today():
            raise serializers.ValidationError({'check_in': 'check_in cannot be in the past.'})
        for item in data['items']:
            flag = item.get('vessel_flag', '')
            if flag and flag.upper() not in ALLOWED_COUNTRIES:
                raise serializers.ValidationError({'items': f'Unsupported vessel_flag: {flag}.'})
        return data
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && python -m pytest apps/reservations/tests_phase1_booking.py::SerializerExtensionsTest -v`
Expected: PASS (all 5 tests).

- [ ] **Step 6: Run the existing intent view tests to verify no regression**

Run: `cd backend && python -m pytest apps/reservations/tests.py::TestReservationIntentView -v`
Expected: PASS (existing behaviour preserved — new fields are optional).

- [ ] **Step 7: Commit**

```bash
git add backend/apps/reservations/public_reservation_views.py backend/apps/reservations/tests_phase1_booking.py
git commit -m "feat(reservations): extend CartItem/ReservationIntent serializers with Phase 1 fields"
```

---

## Task 6: Wire T&Cs validation + persistence into intent view

**Files:**
- Modify: `backend/apps/reservations/public_reservation_views.py`
- Modify: `backend/apps/reservations/tests_phase1_booking.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/reservations/tests_phase1_booking.py`:

```python
from apps.berths.models import Pier, Berth
from django.utils import timezone


def _make_berth(marina, **overrides):
    pier = Pier.objects.create(marina=marina, code='P1', name='Pier 1')
    defaults = dict(
        marina=marina, pier=pier, code='A1', operational_type='leisure',
        loa_max=20, beam_max=8, draft_max=3, is_active=True,
    )
    defaults.update(overrides)
    return Berth.objects.create(**defaults)


class TermsAcceptanceTest(TestCase):
    def setUp(self):
        self.marina = make_marina(
            slug='terms-marina',
            booking_terms_pdf_url='https://example.com/tos.pdf',
            booking_terms_version='2.0',
            booking_mode='manual',  # use manual path; tetris not needed for this test
        )
        self.client = APIClient()
        self.url = '/api/v1/public/reservations/intent/'
        self.headers = {'HTTP_X_MARINA_SLUG': self.marina.slug}

    def _payload(self, **overrides):
        base = {
            'check_in':  '2026-08-01',
            'check_out': '2026-08-05',
            'guest_name':  'Alice',
            'guest_email': 'a@b.test',
            'items': [{'boat_loa': '10.0'}],
        }
        base.update(overrides)
        return base

    def test_marina_with_terms_blocks_when_not_accepted(self):
        r = self.client.post(self.url, self._payload(terms_accepted=False), format='json', **self.headers)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json().get('detail'), 'terms_not_accepted')

    def test_marina_with_terms_passes_when_accepted(self):
        r = self.client.post(self.url, self._payload(terms_accepted=True), format='json', **self.headers)
        self.assertIn(r.status_code, (201, 200), r.content)
        from apps.reservations.models import Reservation
        res = Reservation.objects.get(pk=r.json()['reservation_id'])
        self.assertIsNotNone(res.terms_accepted_at)
        self.assertEqual(res.terms_version, '2.0')

    def test_marina_without_terms_skips_check(self):
        m2 = make_marina(slug='no-tos-marina', booking_mode='manual')  # no booking_terms_pdf_url
        headers = {'HTTP_X_MARINA_SLUG': m2.slug}
        r = self.client.post(self.url, self._payload(), format='json', **headers)
        self.assertEqual(r.status_code, 201, r.content)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest apps/reservations/tests_phase1_booking.py::TermsAcceptanceTest -v`
Expected: FAIL — `test_marina_with_terms_blocks_when_not_accepted` fails because the view doesn't yet enforce the check; the other two may pass or fail depending on payload field acceptance.

- [ ] **Step 3: Add T&Cs enforcement helper + integrate**

In `backend/apps/reservations/public_reservation_views.py`, add a small helper at module top (after imports):

```python
def _enforce_terms_and_persist(reservation, marina, terms_accepted: bool):
    """Return a Response if terms required but missing; otherwise stamp the
    acceptance metadata onto the Reservation. Caller is inside a transaction."""
    if marina.booking_terms_pdf_url:
        if not terms_accepted:
            return Response({'detail': 'terms_not_accepted'}, status=status.HTTP_400_BAD_REQUEST)
        reservation.terms_accepted_at = timezone.now()
        reservation.terms_version = marina.booking_terms_version or ''
    return None
```

Modify the manual path (`_handle_manual`) to call this helper. Locate the block:

```python
        with transaction.atomic():
            reservation = Reservation.objects.create(
                marina=marina,
                guest_name=d['guest_name'],
                guest_email=d['guest_email'],
                guest_phone=d.get('guest_phone', ''),
                status='pending_review',
                booking_source='portal',
            )
```

Replace with:

```python
        with transaction.atomic():
            reservation = Reservation.objects.create(
                marina=marina,
                guest_name=d['guest_name'],
                guest_email=d['guest_email'],
                guest_phone=d.get('guest_phone', ''),
                status='pending_review',
                booking_source='portal',
                estimated_arrival_time=d.get('estimated_arrival_time'),
                special_requests=d.get('special_requests', ''),
                shore_power_amperage=d.get('shore_power_amperage'),
                billing_street=d.get('billing_street', ''),
                billing_city=d.get('billing_city', ''),
                billing_postcode=d.get('billing_postcode', ''),
                billing_country=d.get('billing_country', ''),
                company_name=d.get('company_name', ''),
                vat_number=d.get('vat_number', ''),
                promo_code=d.get('promo_code', ''),
            )
            err = _enforce_terms_and_persist(reservation, marina, d.get('terms_accepted', False))
            if err is not None:
                transaction.set_rollback(True)
                return err
            reservation.save()  # persist terms_* if helper stamped them
```

Apply the same pattern to the `auto_tetris` path. Find the analogous `Reservation.objects.create(...)` block in `post()` (around line 137) and add the same new fields + the `_enforce_terms_and_persist` call + `reservation.save()` immediately after.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest apps/reservations/tests_phase1_booking.py::TermsAcceptanceTest -v`
Expected: PASS (all three).

- [ ] **Step 5: Run the existing intent view tests for regression**

Run: `cd backend && python -m pytest apps/reservations/tests.py::TestReservationIntentView -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/reservations/public_reservation_views.py backend/apps/reservations/tests_phase1_booking.py
git commit -m "feat(reservations): enforce + persist booking T&Cs at intent time"
```

---

## Task 7: Insurance token redemption + on_commit cleanup

**Files:**
- Modify: `backend/apps/reservations/public_reservation_views.py`
- Modify: `backend/apps/reservations/tests_phase1_booking.py`

- [ ] **Step 1: Write the failing tests**

Append to `backend/apps/reservations/tests_phase1_booking.py`:

```python
from django.core.files.base import ContentFile


class InsuranceTokenRedemptionTest(TestCase):
    def setUp(self):
        self.marina = make_marina(slug='tok-marina', booking_mode='manual')
        self.client = APIClient()
        self.intent_url = '/api/v1/public/reservations/intent/'
        self.upload_url = '/api/v1/public/reservations/insurance-upload/'
        self.headers = {'HTTP_X_MARINA_SLUG': self.marina.slug}

    def _upload(self):
        f = SimpleUploadedFile('cert.pdf', b'%PDF-1.4\n' + b'x' * 100, content_type='application/pdf')
        r = self.client.post(self.upload_url, {'file': f}, format='multipart', **self.headers)
        self.assertEqual(r.status_code, 201, r.content)
        return r.json()['token']

    def test_token_redemption_attaches_file_and_marks_consumed(self):
        token = self._upload()
        payload = {
            'check_in': '2026-08-01', 'check_out': '2026-08-05',
            'guest_name': 'A', 'guest_email': 'a@b.test',
            'items': [{'boat_loa': '10.0', 'insurance_upload_token': token}],
        }
        r = self.client.post(self.intent_url, payload, format='json', **self.headers)
        self.assertEqual(r.status_code, 201, r.content)
        from apps.reservations.models import Reservation, InsuranceUploadToken
        res = Reservation.objects.get(pk=r.json()['reservation_id'])
        item = res.items.first()
        self.assertTrue(item.insurance_certificate, 'FileField should be populated')
        tok = InsuranceUploadToken.objects.get(token=token)
        self.assertIsNotNone(tok.consumed_at)

    def test_shared_token_across_multiple_items(self):
        token = self._upload()
        payload = {
            'check_in': '2026-08-01', 'check_out': '2026-08-05',
            'guest_name': 'A', 'guest_email': 'a@b.test',
            'items': [
                {'boat_loa': '12.0', 'insurance_upload_token': token},
                {'boat_loa': '4.5',  'insurance_upload_token': token},
            ],
        }
        r = self.client.post(self.intent_url, payload, format='json', **self.headers)
        self.assertEqual(r.status_code, 201, r.content)
        from apps.reservations.models import Reservation
        res = Reservation.objects.get(pk=r.json()['reservation_id'])
        items = list(res.items.all())
        self.assertEqual(len(items), 2)
        for item in items:
            self.assertTrue(item.insurance_certificate)

    def test_unknown_token_rejected(self):
        payload = {
            'check_in': '2026-08-01', 'check_out': '2026-08-05',
            'guest_name': 'A', 'guest_email': 'a@b.test',
            'items': [{'boat_loa': '10.0', 'insurance_upload_token': 'tk_does_not_exist'}],
        }
        r = self.client.post(self.intent_url, payload, format='json', **self.headers)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json().get('detail'), 'insurance_token_invalid')

    def test_previously_consumed_token_rejected(self):
        token = self._upload()
        # First request consumes it.
        payload = {
            'check_in': '2026-08-01', 'check_out': '2026-08-05',
            'guest_name': 'A', 'guest_email': 'a@b.test',
            'items': [{'boat_loa': '10.0', 'insurance_upload_token': token}],
        }
        self.client.post(self.intent_url, payload, format='json', **self.headers)
        # Second request with same token: rejected.
        r = self.client.post(self.intent_url, payload, format='json', **self.headers)
        self.assertEqual(r.status_code, 400)
        self.assertEqual(r.json().get('detail'), 'insurance_token_consumed')
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest apps/reservations/tests_phase1_booking.py::InsuranceTokenRedemptionTest -v`
Expected: FAIL (token handling not yet implemented in the intent view).

- [ ] **Step 3: Add the token-redemption helper**

In `backend/apps/reservations/public_reservation_views.py`, add a helper near the top (after the existing imports):

```python
from django.core.files import File as _DjangoFile


def _redeem_insurance_tokens(items_data, marina, reservation_items_map):
    """
    items_data: the validated 'items' list from the serializer.
    reservation_items_map: dict { items_data_index → ReservationItem instance }.

    Returns (error_response_or_None, on_commit_callable_or_None).

    Validates every insurance_upload_token referenced in items_data:
      - exists, belongs to this marina, within TTL, not consumed in a *prior* request
    Copies the file into each referenced ReservationItem's insurance_certificate.
    Marks every distinct token consumed_at = now() (once per token, even if
    the token is referenced by multiple items in this request).
    Returns an on_commit callable that deletes the /tmp/ source file(s).
    """
    tmp_paths_to_delete = []
    now = timezone.now()
    seen_tokens = {}  # token_str → InsuranceUploadToken instance

    for idx, item in enumerate(items_data):
        tok_str = item.get('insurance_upload_token') or ''
        if not tok_str:
            continue
        if tok_str not in seen_tokens:
            try:
                tok = InsuranceUploadToken.objects.select_for_update().get(token=tok_str)
            except InsuranceUploadToken.DoesNotExist:
                return Response({'detail': 'insurance_token_invalid'}, status=status.HTTP_400_BAD_REQUEST), None
            if tok.marina_id != marina.id:
                return Response({'detail': 'insurance_token_invalid'}, status=status.HTTP_400_BAD_REQUEST), None
            if tok.consumed_at is not None:
                return Response({'detail': 'insurance_token_consumed'}, status=status.HTTP_400_BAD_REQUEST), None
            if (now - tok.created_at) > INSURANCE_TOKEN_TTL:
                return Response({'detail': 'insurance_token_expired'}, status=status.HTTP_400_BAD_REQUEST), None
            seen_tokens[tok_str] = tok

        tok = seen_tokens[tok_str]
        item_instance = reservation_items_map[idx]
        # Copy: open the tmp file, save through the FileField (which generates
        # an upload_to path) — that physically copies it.
        with default_storage.open(tok.file_path, 'rb') as src:
            filename = os.path.basename(tok.file_path)
            item_instance.insurance_certificate.save(filename, _DjangoFile(src), save=True)
        if tok.file_path not in tmp_paths_to_delete:
            tmp_paths_to_delete.append(tok.file_path)

    for tok in seen_tokens.values():
        tok.consumed_at = now
        tok.save(update_fields=['consumed_at'])

    if not tmp_paths_to_delete:
        return None, None

    def _delete_tmp_files():
        for p in tmp_paths_to_delete:
            try:
                default_storage.delete(p)
            except Exception:
                logger.exception('Failed to delete consumed insurance tmp file: %s', p)

    return None, _delete_tmp_files
```

- [ ] **Step 4: Wire redemption into the manual path**

In `_handle_manual()` after the `for item in d['items']: ReservationItem.objects.create(...)` block, build the map and call the helper. Replace the simple loop with:

```python
            items_map = {}
            for idx, item in enumerate(d['items']):
                items_map[idx] = ReservationItem.objects.create(
                    reservation=reservation,
                    berth=None,
                    check_in=check_in,
                    check_out=check_out,
                    nights=nights,
                    vessel_name=item.get('vessel_name', ''),
                    boat_loa=item.get('boat_loa'),
                    boat_beam=item.get('boat_beam'),
                    boat_draft=item.get('boat_draft'),
                    boat_air_draft=item.get('boat_air_draft'),
                    vessel_registration=item.get('vessel_registration', ''),
                    vessel_flag=(item.get('vessel_flag') or '').upper(),
                    crew_count=item.get('crew_count'),
                    status='unassigned',
                )
            err, on_commit_cb = _redeem_insurance_tokens(d['items'], marina, items_map)
            if err is not None:
                transaction.set_rollback(True)
                return err
            if on_commit_cb is not None:
                transaction.on_commit(on_commit_cb)
```

- [ ] **Step 5: Wire redemption into the auto_tetris path**

In `post()`, after the `ReservationItem.objects.bulk_create(item_records)` line, replace the subsequent block up to (but not including) the Stripe `create_payment_intent` call with:

```python
                ReservationItem.objects.bulk_create(item_records)
                # bulk_create with PKs is required by FileField operations
                # below; re-fetch the items keyed by ordinal position.
                created_items = list(
                    reservation.items.order_by('pk')
                )
                items_map = {idx: created_items[idx] for idx in range(len(created_items))}
                err, on_commit_cb = _redeem_insurance_tokens(d['items'], marina, items_map)
                if err is not None:
                    transaction.set_rollback(True)
                    return err
                if on_commit_cb is not None:
                    transaction.on_commit(on_commit_cb)

                # Apply new vessel fields onto items via direct update (not on the
                # in-memory instances since we re-fetched).
                for idx, item_data in enumerate(d['items']):
                    flat = {
                        'boat_air_draft':       item_data.get('boat_air_draft'),
                        'vessel_registration':  item_data.get('vessel_registration', ''),
                        'vessel_flag':          (item_data.get('vessel_flag') or '').upper(),
                        'crew_count':           item_data.get('crew_count'),
                    }
                    # Only touch fields that have a value (preserve nullable defaults).
                    update_kwargs = {k: v for k, v in flat.items() if v not in (None, '')}
                    if update_kwargs:
                        ReservationItem.objects.filter(pk=items_map[idx].pk).update(**update_kwargs)

                total = sum(r.item_price for r in item_records)
                reservation.total_price = total
                reservation.save(update_fields=['total_price'])
```

(The original `bulk_create` followed by total calc + Stripe intent code remains afterwards. This step only inserts the redemption block between `bulk_create` and the `total` calculation.)

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd backend && python -m pytest apps/reservations/tests_phase1_booking.py::InsuranceTokenRedemptionTest -v`
Expected: PASS (all 4 tests).

- [ ] **Step 7: Run all tests for regression**

Run: `cd backend && python -m pytest apps/reservations/tests.py apps/reservations/tests_phase1_booking.py -v`
Expected: All PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/apps/reservations/public_reservation_views.py backend/apps/reservations/tests_phase1_booking.py
git commit -m "feat(reservations): redeem insurance upload tokens at intent time"
```

---

## Task 8: Hourly purge Celery task + beat schedule

**Files:**
- Modify: `backend/apps/reservations/tasks.py`
- Modify: `backend/config/settings/base.py`
- Modify: `backend/apps/reservations/tests_phase1_booking.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/reservations/tests_phase1_booking.py`:

```python
from datetime import timedelta


class InsurancePurgeTaskTest(TestCase):
    def setUp(self):
        self.marina = make_marina(slug='purge-marina')

    def _make_tmp_file(self, name):
        return default_storage.save(f'reservations/insurance/tmp/{name}', ContentFile(b'%PDF-test'))

    def test_purges_expired_unconsumed_tokens(self):
        from apps.reservations.tasks import purge_expired_insurance_uploads

        path = self._make_tmp_file('old.pdf')
        tok = InsuranceUploadToken.objects.create(
            token='old_tok', marina=self.marina,
            file_path=path, mime_type='application/pdf', size_bytes=10,
        )
        # Backdate.
        InsuranceUploadToken.objects.filter(pk=tok.pk).update(
            created_at=timezone.now() - timedelta(hours=25),
        )
        purge_expired_insurance_uploads()
        self.assertFalse(InsuranceUploadToken.objects.filter(pk=tok.pk).exists())
        self.assertFalse(default_storage.exists(path))

    def test_keeps_fresh_unconsumed_tokens(self):
        from apps.reservations.tasks import purge_expired_insurance_uploads

        path = self._make_tmp_file('fresh.pdf')
        tok = InsuranceUploadToken.objects.create(
            token='fresh_tok', marina=self.marina,
            file_path=path, mime_type='application/pdf', size_bytes=10,
        )
        purge_expired_insurance_uploads()
        self.assertTrue(InsuranceUploadToken.objects.filter(pk=tok.pk).exists())
        self.assertTrue(default_storage.exists(path))

    def test_consumed_old_token_row_purged_file_already_gone(self):
        from apps.reservations.tasks import purge_expired_insurance_uploads

        # Consumed token, file already moved away.
        tok = InsuranceUploadToken.objects.create(
            token='consumed_old', marina=self.marina,
            file_path='reservations/insurance/tmp/already_gone.pdf',
            mime_type='application/pdf', size_bytes=10,
            consumed_at=timezone.now() - timedelta(days=31),
        )
        InsuranceUploadToken.objects.filter(pk=tok.pk).update(
            created_at=timezone.now() - timedelta(days=32),
        )
        purge_expired_insurance_uploads()
        self.assertFalse(InsuranceUploadToken.objects.filter(pk=tok.pk).exists())
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest apps/reservations/tests_phase1_booking.py::InsurancePurgeTaskTest -v`
Expected: FAIL — `ImportError: cannot import name 'purge_expired_insurance_uploads'`.

- [ ] **Step 3: Add the task**

Append to `backend/apps/reservations/tasks.py`:

```python
from datetime import timedelta
from django.core.files.storage import default_storage
from .models import InsuranceUploadToken


@shared_task(bind=True, name='reservations.purge_expired_insurance_uploads')
def purge_expired_insurance_uploads(self=None):
    """
    Hourly defensive backstop for the insurance-upload temp directory:
      - Unconsumed tokens older than 24h: delete the tmp file and the row.
      - Consumed tokens older than 30d: delete the row.
      - For any consumed token, if the tmp file still exists, delete it.
    """
    now = timezone.now()
    unconsumed_cutoff = now - timedelta(hours=24)
    consumed_cutoff   = now - timedelta(days=30)

    # Unconsumed expired: file + row.
    for tok in InsuranceUploadToken.objects.filter(consumed_at__isnull=True, created_at__lt=unconsumed_cutoff):
        try:
            if default_storage.exists(tok.file_path):
                default_storage.delete(tok.file_path)
        except Exception:
            logger.exception('Failed to delete expired insurance tmp file: %s', tok.file_path)
        tok.delete()

    # Consumed but old: row only.
    InsuranceUploadToken.objects.filter(consumed_at__isnull=False, consumed_at__lt=consumed_cutoff).delete()

    # Defensive: any consumed token whose tmp file still exists, delete the file.
    for tok in InsuranceUploadToken.objects.filter(consumed_at__isnull=False):
        try:
            if default_storage.exists(tok.file_path):
                default_storage.delete(tok.file_path)
        except Exception:
            logger.exception('Failed to delete leftover consumed insurance tmp file: %s', tok.file_path)
```

The `bind=True, self=None` signature lets both Celery and direct test calls work without an explicit task context.

- [ ] **Step 4: Add the beat schedule entry**

In `backend/config/settings/base.py`, locate `CELERY_BEAT_SCHEDULE` (~ line 311) and find the `# ── Reservations ──` section. Add inside that section:

```python
    'purge-expired-insurance-uploads': {
        'task': 'reservations.purge_expired_insurance_uploads',
        'schedule': 3600,                                # hourly
    },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && python -m pytest apps/reservations/tests_phase1_booking.py::InsurancePurgeTaskTest -v`
Expected: PASS (all 3).

- [ ] **Step 6: Commit**

```bash
git add backend/apps/reservations/tasks.py backend/config/settings/base.py backend/apps/reservations/tests_phase1_booking.py
git commit -m "feat(reservations): hourly purge task for insurance upload tokens"
```

---

## Task 9: Extend `MarinaPublicView` response

**Files:**
- Modify: `backend/apps/portal/views.py`
- Modify: `backend/apps/reservations/tests_phase1_booking.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/reservations/tests_phase1_booking.py`:

```python
class MarinaPublicViewPhase1Test(TestCase):
    def test_response_includes_phase1_fields(self):
        marina = make_marina(
            slug='public-test',
            booking_terms_pdf_url='https://example.com/tos.pdf',
            booking_terms_version='3.2',
            requires_air_draft=True,
            requires_insurance_at_booking=True,
        )
        client = APIClient()
        r = client.get('/api/v1/public/marina/', HTTP_X_MARINA_SLUG=marina.slug)
        self.assertEqual(r.status_code, 200, r.content)
        body = r.json()
        self.assertEqual(body.get('booking_terms_pdf_url'), 'https://example.com/tos.pdf')
        self.assertEqual(body.get('booking_terms_version'), '3.2')
        self.assertTrue(body.get('requires_air_draft'))
        self.assertTrue(body.get('requires_insurance_at_booking'))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest apps/reservations/tests_phase1_booking.py::MarinaPublicViewPhase1Test -v`
Expected: FAIL — keys absent from response.

- [ ] **Step 3: Extend the view**

In `backend/apps/portal/views.py`, locate `MarinaPublicView.get` and add the four new keys to the returned dict:

```python
        return Response({
            'id': marina.id,
            'name': marina.name,
            'slug': marina.slug,
            'timezone': marina.timezone,
            'currency': marina.currency,
            'contact_email': marina.contact_email,
            'phone': marina.phone,
            'booking_mode': marina.booking_mode,
            'vat_rate': str(marina.vat_rate),
            'logo_url': cfg.logo_url if cfg else '',
            'app_config': marina.app_config or {},
            # Phase 1 booking-flow additions
            'booking_terms_pdf_url':         marina.booking_terms_pdf_url,
            'booking_terms_version':         marina.booking_terms_version,
            'requires_air_draft':            marina.requires_air_draft,
            'requires_insurance_at_booking': marina.requires_insurance_at_booking,
        })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest apps/reservations/tests_phase1_booking.py::MarinaPublicViewPhase1Test -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/portal/views.py backend/apps/reservations/tests_phase1_booking.py
git commit -m "feat(portal): expose Phase 1 booking-flow fields on /public/marina/"
```

---

## Task 10: `uploadInsuranceCertificate` API helper in `shared/portal-ui`

**Files:**
- Modify: `shared/portal-ui/src/api.js`

- [ ] **Step 1: Add the helper**

Open `shared/portal-ui/src/api.js`. Locate the existing `createReservationIntent` / `confirmReservation` helpers and add (after them):

```js
export function uploadInsuranceCertificate(marinaSlug, file) {
  const form = new FormData();
  form.append('file', file);
  return api.post('/public/reservations/insurance-upload/', form, {
    headers: {
      'Content-Type': 'multipart/form-data',
      'X-Marina-Slug': marinaSlug,
    },
  });
}
```

- [ ] **Step 2: Verify it imports correctly from the booking app**

Run from repo root: `npm run build -w booking`
Expected: build succeeds (no broken imports). If your build script is named differently, run the equivalent.

- [ ] **Step 3: Commit**

```bash
git add shared/portal-ui/src/api.js
git commit -m "feat(portal-ui): add uploadInsuranceCertificate API helper"
```

---

## Task 11: `InsuranceUpload` component

**Files:**
- Create: `booking/src/components/InsuranceUpload.jsx`

- [ ] **Step 1: Create the component**

Create `booking/src/components/InsuranceUpload.jsx`:

```jsx
import { useState } from 'react';
import { uploadInsuranceCertificate } from '@docksbase/portal-ui/api';

const ALLOWED_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const MAX_BYTES = 5 * 1024 * 1024;

export default function InsuranceUpload({ marinaSlug, value, onChange, disabled }) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    if (!ALLOWED_TYPES.has(file.type)) {
      setError('Use PDF, JPG, or PNG.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('File must be 5 MB or smaller.');
      return;
    }
    setUploading(true);
    try {
      const { data } = await uploadInsuranceCertificate(marinaSlug, file);
      onChange({ token: data.token, filename: file.name, expiresAt: data.expires_at });
    } catch (err) {
      setError(err.response?.data?.detail || 'Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="p-field">
      <label className="p-label">Insurance certificate</label>
      {value?.token ? (
        <div className="p-insurance-uploaded">
          <span>✓ {value.filename}</span>
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            style={{ marginLeft: 8, fontSize: 12, background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer' }}
          >
            Remove
          </button>
        </div>
      ) : (
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          onChange={handleFile}
          disabled={uploading || disabled}
        />
      )}
      {uploading && <p style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>Uploading…</p>}
      {error && <p style={{ fontSize: 12, color: '#dc2626' }}>{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Verify Vite picks it up**

Run from repo root: `npm run build -w booking`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add booking/src/components/InsuranceUpload.jsx
git commit -m "feat(booking): InsuranceUpload component"
```

---

## Task 12: `BookingSummary` panel component

**Files:**
- Create: `booking/src/screens/quote/BookingSummary.jsx`

- [ ] **Step 1: Create the component**

Create `booking/src/screens/quote/BookingSummary.jsx`:

```jsx
import { useEffect, useState } from 'react';

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatMoney(value, currency = 'EUR') {
  const n = Number(value);
  if (Number.isNaN(n)) return '—';
  const symbol = { EUR: '€', GBP: '£', USD: '$' }[currency.toUpperCase()] || currency.toUpperCase() + ' ';
  return `${symbol}${n.toFixed(2)}`;
}

function HoldCountdown({ lockedUntil, onExpire }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!lockedUntil) return null;
  const remainingMs = new Date(lockedUntil).getTime() - now;
  if (remainingMs <= 0) {
    onExpire?.();
    return <p className="q-summary-expired">Your hold has expired. Please retry.</p>;
  }
  const mins = Math.floor(remainingMs / 60000);
  const secs = Math.floor((remainingMs % 60000) / 1000);
  return (
    <p className="q-summary-countdown">
      Hold expires in {mins}:{secs.toString().padStart(2, '0')}
    </p>
  );
}

export default function BookingSummary({ state, marina, intentData, onHoldExpired }) {
  const nights =
    state.checkIn && state.checkOut
      ? Math.round((new Date(state.checkOut) - new Date(state.checkIn)) / 86400000)
      : 0;
  const currency = marina?.currency || 'EUR';

  return (
    <aside className="q-summary">
      <div className="q-summary-header">
        <div className="q-summary-marina-name">{marina?.name || 'Your Marina'}</div>
        {marina?.address && <div className="q-summary-marina-address">{marina.address}</div>}
      </div>

      <div className="q-summary-section">
        <div className="q-summary-row">
          <span>Check-in</span><span>{formatDate(state.checkIn)}</span>
        </div>
        <div className="q-summary-row">
          <span>Check-out</span><span>{formatDate(state.checkOut)}</span>
        </div>
        <div className="q-summary-row">
          <span>Nights</span><span>{nights}</span>
        </div>
      </div>

      <div className="q-summary-section">
        {state.boats.map((boat, idx) => (
          <div key={idx} className="q-summary-boat">
            <div className="q-summary-boat-name">
              {boat.vesselName || `Boat ${idx + 1}`}
            </div>
            <div className="q-summary-boat-dims">
              {boat.loa ? `${boat.loa}m LOA` : ''}
              {boat.beam ? ` · ${boat.beam}m beam` : ''}
              {boat.draft ? ` · ${boat.draft}m draft` : ''}
            </div>
            {intentData?.items?.[idx] && (
              <div className="q-summary-boat-price">
                <span>{intentData.items[idx].berth_code || 'Berth TBD'}</span>
                <span>{formatMoney(intentData.items[idx].item_price, currency)}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {intentData?.total != null && (
        <div className="q-summary-total">
          <span>Total</span>
          <span>{formatMoney(intentData.total, currency)}</span>
        </div>
      )}

      {intentData?.lockedUntil && (
        <HoldCountdown lockedUntil={intentData.lockedUntil} onExpire={onHoldExpired} />
      )}

      {marina?.booking_terms_pdf_url && (
        <p className="q-summary-tos">
          <a href={marina.booking_terms_pdf_url} target="_blank" rel="noreferrer">
            Booking terms and cancellation policy
          </a>
        </p>
      )}
    </aside>
  );
}
```

- [ ] **Step 2: Verify build**

Run from repo root: `npm run build -w booking`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add booking/src/screens/quote/BookingSummary.jsx
git commit -m "feat(booking): BookingSummary right-side panel"
```

---

## Task 13: `VesselStep` component

**Files:**
- Create: `booking/src/screens/quote/VesselStep.jsx`

- [ ] **Step 1: Create the component**

Create `booking/src/screens/quote/VesselStep.jsx`:

```jsx
import InsuranceUpload from '../../components/InsuranceUpload';

const COUNTRIES = [
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT',
  'LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO',
  'CH','GB','US','CA','AU','NZ','TR','MC','ME','RS',
];

function boatComplete(boat, marina) {
  if (!boat.vesselName || !boat.loa || !boat.vesselRegistration || !boat.vesselFlag) return false;
  if (!boat.crewCount || Number(boat.crewCount) < 1) return false;
  if (marina?.requires_air_draft && !boat.airDraft) return false;
  if (marina?.requires_insurance_at_booking) {
    // Boat 1 must have its own token; boats 2+ may inherit from boat 0.
    if (!boat.insurance && !boat.shareInsuranceFromBoat0) return false;
  }
  return true;
}

export default function VesselStep({ state, updateBoat, addBoat, removeBoat, marina, onNext, onBack }) {
  const canContinue = state.boats.every(b => boatComplete(b, marina));

  return (
    <form
      className="q-step"
      onSubmit={e => { e.preventDefault(); if (canContinue) onNext(); }}
    >
      {state.boats.map((boat, idx) => (
        <div key={idx} className="q-boat-card">
          <div className="q-boat-header">
            <h3>{state.boats.length > 1 ? `Boat ${idx + 1}` : 'Vessel'}</h3>
            {state.boats.length > 1 && (
              <button type="button" className="q-link-danger" onClick={() => removeBoat(idx)}>Remove</button>
            )}
          </div>

          <div className="p-field">
            <label className="p-label">Vessel name *</label>
            <input className="p-input" required value={boat.vesselName || ''}
              onChange={e => updateBoat(idx, 'vesselName', e.target.value)} />
          </div>

          <div className="p-grid-3">
            <div className="p-field">
              <label className="p-label">LOA (m) *</label>
              <input className="p-input" type="number" step="0.1" min="1" required
                value={boat.loa} onChange={e => updateBoat(idx, 'loa', e.target.value)} />
            </div>
            <div className="p-field">
              <label className="p-label">Beam (m)</label>
              <input className="p-input" type="number" step="0.1" min="0"
                value={boat.beam || ''} onChange={e => updateBoat(idx, 'beam', e.target.value)} />
            </div>
            <div className="p-field">
              <label className="p-label">Draft (m)</label>
              <input className="p-input" type="number" step="0.1" min="0"
                value={boat.draft || ''} onChange={e => updateBoat(idx, 'draft', e.target.value)} />
            </div>
          </div>

          <div className="p-grid-3">
            <div className="p-field">
              <label className="p-label">
                Air draft (m){marina?.requires_air_draft ? ' *' : ''}
              </label>
              <input className="p-input" type="number" step="0.1" min="0"
                required={!!marina?.requires_air_draft}
                value={boat.airDraft || ''} onChange={e => updateBoat(idx, 'airDraft', e.target.value)} />
            </div>
            <div className="p-field">
              <label className="p-label">Registration # *</label>
              <input className="p-input" required value={boat.vesselRegistration || ''}
                onChange={e => updateBoat(idx, 'vesselRegistration', e.target.value)} />
            </div>
            <div className="p-field">
              <label className="p-label">Flag *</label>
              <select className="p-input" required value={boat.vesselFlag || ''}
                onChange={e => updateBoat(idx, 'vesselFlag', e.target.value)}>
                <option value="">—</option>
                {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <div className="p-field" style={{ maxWidth: 200 }}>
            <label className="p-label">Crew aboard *</label>
            <input className="p-input" type="number" min="1" required
              value={boat.crewCount || ''} onChange={e => updateBoat(idx, 'crewCount', e.target.value)} />
          </div>

          {idx === 0 ? (
            <InsuranceUpload
              marinaSlug={marina?.slug}
              value={boat.insurance}
              onChange={v => updateBoat(idx, 'insurance', v)}
            />
          ) : (
            <div className="p-field">
              <label className="p-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={!!boat.shareInsuranceFromBoat0}
                  onChange={e => updateBoat(idx, 'shareInsuranceFromBoat0', e.target.checked)}
                />
                Use insurance from Boat 1
              </label>
              {!boat.shareInsuranceFromBoat0 && (
                <InsuranceUpload
                  marinaSlug={marina?.slug}
                  value={boat.insurance}
                  onChange={v => updateBoat(idx, 'insurance', v)}
                />
              )}
            </div>
          )}
        </div>
      ))}

      <button type="button" className="q-link-add" onClick={addBoat}>+ Add another boat</button>

      <div className="q-step-footer">
        <button type="button" className="p-btn-outline" onClick={onBack}>← Back</button>
        <button type="submit" className="p-btn-gold" disabled={!canContinue}>Continue →</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Verify build**

Run from repo root: `npm run build -w booking`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add booking/src/screens/quote/VesselStep.jsx
git commit -m "feat(booking): VesselStep with multi-boat shared-insurance default"
```

---

## Task 14: `GuestStep` component

**Files:**
- Create: `booking/src/screens/quote/GuestStep.jsx`

- [ ] **Step 1: Create the component**

Create `booking/src/screens/quote/GuestStep.jsx`:

```jsx
import { useState } from 'react';

const COUNTRIES = [
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT',
  'LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE','IS','LI','NO',
  'CH','GB','US','CA','AU','NZ','TR','MC','ME','RS',
];

export default function GuestStep({ state, updateGuest, marina, onNext, onBack, error }) {
  const [showCompany, setShowCompany] = useState(!!state.guest.company_name);
  const termsRequired = !!marina?.booking_terms_pdf_url;

  const canContinue =
    state.guest.name && state.guest.email &&
    state.guest.billing_street && state.guest.billing_city &&
    state.guest.billing_postcode && state.guest.billing_country &&
    (!termsRequired || state.guest.terms_accepted);

  return (
    <form
      className="q-step"
      onSubmit={e => { e.preventDefault(); if (canContinue) onNext(); }}
    >
      <h3>Your details</h3>
      <div className="p-grid-2">
        <div className="p-field">
          <label className="p-label">Full name *</label>
          <input className="p-input" required value={state.guest.name}
            onChange={e => updateGuest('name', e.target.value)} />
        </div>
        <div className="p-field">
          <label className="p-label">Email *</label>
          <input className="p-input" type="email" required value={state.guest.email}
            onChange={e => updateGuest('email', e.target.value)} />
        </div>
      </div>
      <div className="p-field" style={{ maxWidth: 240 }}>
        <label className="p-label">Phone</label>
        <input className="p-input" type="tel" value={state.guest.phone || ''}
          onChange={e => updateGuest('phone', e.target.value)} />
      </div>

      <h3>Billing address</h3>
      <div className="p-field">
        <label className="p-label">Street *</label>
        <input className="p-input" required value={state.guest.billing_street}
          onChange={e => updateGuest('billing_street', e.target.value)} />
      </div>
      <div className="p-grid-3">
        <div className="p-field">
          <label className="p-label">City *</label>
          <input className="p-input" required value={state.guest.billing_city}
            onChange={e => updateGuest('billing_city', e.target.value)} />
        </div>
        <div className="p-field">
          <label className="p-label">Postcode *</label>
          <input className="p-input" required value={state.guest.billing_postcode}
            onChange={e => updateGuest('billing_postcode', e.target.value)} />
        </div>
        <div className="p-field">
          <label className="p-label">Country *</label>
          <select className="p-input" required value={state.guest.billing_country}
            onChange={e => updateGuest('billing_country', e.target.value)}>
            <option value="">—</option>
            {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, margin: '8px 0' }}>
        <input
          type="checkbox"
          checked={showCompany}
          onChange={e => {
            setShowCompany(e.target.checked);
            if (!e.target.checked) {
              updateGuest('company_name', '');
              updateGuest('vat_number', '');
            }
          }}
        />
        Booking on behalf of a company
      </label>
      {showCompany && (
        <div className="p-grid-2">
          <div className="p-field">
            <label className="p-label">Company name</label>
            <input className="p-input" value={state.guest.company_name}
              onChange={e => updateGuest('company_name', e.target.value)} />
          </div>
          <div className="p-field">
            <label className="p-label">VAT number</label>
            <input className="p-input" value={state.guest.vat_number}
              onChange={e => updateGuest('vat_number', e.target.value)} />
          </div>
        </div>
      )}

      <h3>Stay details</h3>
      <div className="p-grid-2">
        <div className="p-field">
          <label className="p-label">Estimated arrival time</label>
          <input className="p-input" type="time" value={state.guest.estimated_arrival_time || ''}
            onChange={e => updateGuest('estimated_arrival_time', e.target.value)} />
        </div>
        <div className="p-field">
          <label className="p-label">Shore power</label>
          <select className="p-input" value={state.guest.shore_power_amperage || ''}
            onChange={e => updateGuest('shore_power_amperage', e.target.value)}>
            <option value="">—</option>
            <option value="16A">16A</option>
            <option value="32A">32A</option>
            <option value="63A">63A</option>
            <option value="none">None needed</option>
          </select>
        </div>
      </div>
      <div className="p-field">
        <label className="p-label">Special requests</label>
        <textarea className="p-input" rows={3} value={state.guest.special_requests || ''}
          onChange={e => updateGuest('special_requests', e.target.value)} />
      </div>

      <div className="p-field" style={{ maxWidth: 240 }}>
        <label className="p-label">Promo code</label>
        <input className="p-input" disabled placeholder="Promo codes coming soon" />
      </div>

      {termsRequired && (
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, margin: '12px 0' }}>
          <input
            type="checkbox"
            checked={!!state.guest.terms_accepted}
            onChange={e => updateGuest('terms_accepted', e.target.checked)}
          />
          <span>
            I accept the{' '}
            <a href={marina.booking_terms_pdf_url} target="_blank" rel="noreferrer">
              booking terms and cancellation policy
            </a>
            .
          </span>
        </label>
      )}

      {error && <p style={{ fontSize: 13, color: '#dc2626', margin: '8px 0' }}>{error}</p>}

      <div className="q-step-footer">
        <button type="button" className="p-btn-outline" onClick={onBack}>← Back</button>
        <button type="submit" className="p-btn-gold" disabled={!canContinue}>Continue to payment →</button>
      </div>
    </form>
  );
}
```

- [ ] **Step 2: Verify build**

Run from repo root: `npm run build -w booking`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add booking/src/screens/quote/GuestStep.jsx
git commit -m "feat(booking): GuestStep with billing address, company/VAT, T&Cs"
```

---

## Task 15: `PaymentStep` with Stripe billing-details wiring

**Files:**
- Create: `booking/src/screens/quote/PaymentStep.jsx`

- [ ] **Step 1: Create the component**

Create `booking/src/screens/quote/PaymentStep.jsx`:

```jsx
import { useState } from 'react';
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js';
import { confirmReservation } from '@docksbase/portal-ui/api';

export default function PaymentStep({ state, intentData, onConfirmed, onError, onBack }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function handlePay(e) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true); setError('');

    const { error: stripeErr, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
      confirmParams: {
        return_url: `${window.location.origin}${window.location.pathname}`,
        payment_method_data: {
          billing_details: {
            name:  state.guest.name,
            email: state.guest.email,
            phone: state.guest.phone || undefined,
            address: {
              line1:       state.guest.billing_street,
              city:        state.guest.billing_city,
              postal_code: state.guest.billing_postcode,
              country:     state.guest.billing_country,
            },
          },
        },
      },
    });

    if (stripeErr) {
      setError(stripeErr.message || 'Payment failed. Please try again.');
      setBusy(false);
      return;
    }
    if (!paymentIntent) { setBusy(false); return; }

    try {
      await confirmReservation(intentData.marinaSlug, intentData.reservationId, paymentIntent.id);
      onConfirmed(intentData.reference);
    } catch (err) {
      if (err.response?.status === 409) {
        onConfirmed(intentData.reference);
        return;
      }
      setError('Payment received but confirmation failed. Please contact the marina with reference ' + intentData.reference);
      setBusy(false);
    }
  }

  return (
    <form className="q-step" onSubmit={handlePay}>
      <h3>Payment</h3>
      <div style={{ marginBottom: 20 }}>
        <PaymentElement
          options={{
            layout: 'tabs',
            fields: { billingDetails: { address: 'never' } },
          }}
        />
      </div>
      {error && <p style={{ fontSize: 13, color: '#dc2626', marginBottom: 12 }}>{error}</p>}
      <div className="q-step-footer">
        <button type="button" className="p-btn-outline" onClick={onBack} disabled={busy}>← Back</button>
        <button type="submit" className="p-btn-gold" disabled={busy || !stripe}>
          {busy ? 'Processing…' : `Confirm & Pay €${parseFloat(intentData.total).toFixed(2)}`}
        </button>
      </div>
      <p style={{ fontSize: 11, color: 'rgba(0,0,0,0.35)', textAlign: 'center', marginTop: 10 }}>
        Secure payment powered by Stripe.
      </p>
    </form>
  );
}
```

- [ ] **Step 2: Verify build**

Run from repo root: `npm run build -w booking`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add booking/src/screens/quote/PaymentStep.jsx
git commit -m "feat(booking): PaymentStep with billing_details wired into Stripe"
```

---

## Task 16: Rewire `QuoteScreen.jsx` as state machine with summary panel

**Files:**
- Modify: `booking/src/screens/QuoteScreen.jsx`

- [ ] **Step 1: Replace `QuoteScreen.jsx` with the new state machine**

Overwrite `booking/src/screens/QuoteScreen.jsx`:

```jsx
import { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import { Elements } from '@stripe/react-stripe-js';
import api, { createReservationIntent } from '@docksbase/portal-ui/api';
import { HarbourScene, WaveLines } from '../components/HarbourScene';
import VesselStep from './quote/VesselStep';
import GuestStep from './quote/GuestStep';
import PaymentStep from './quote/PaymentStep';
import BookingSummary from './quote/BookingSummary';

const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '');

const EMPTY_GUEST = {
  name: '', email: '', phone: '',
  billing_street: '', billing_city: '', billing_postcode: '', billing_country: '',
  company_name: '', vat_number: '',
  estimated_arrival_time: '', special_requests: '', shore_power_amperage: '',
  terms_accepted: false,
};

export default function QuoteScreen({ state, navigate, marina }) {
  const marinaSlug = marina?.slug || localStorage.getItem('portal_marina_slug') || '';

  const [currentStep, setCurrentStep] = useState('vessel');
  const [boats, setBoats] = useState(() => state.boats.map(b => ({
    ...b,
    vesselName: b.vesselName || '',
    airDraft: b.airDraft || '',
    vesselRegistration: b.vesselRegistration || '',
    vesselFlag: b.vesselFlag || '',
    crewCount: b.crewCount || '',
    insurance: b.insurance || null,
    shareInsuranceFromBoat0: false,
  })));
  const [guest, setGuest] = useState(EMPTY_GUEST);
  const [intentData, setIntentData] = useState(null);
  const [error, setError] = useState('');

  const updateBoat = (idx, key, value) =>
    setBoats(bs => bs.map((b, i) => i === idx ? { ...b, [key]: value } : b));
  const addBoat = () => setBoats(bs => [...bs, {
    loa: '', beam: '', draft: '', vesselName: '', airDraft: '',
    vesselRegistration: '', vesselFlag: '', crewCount: '',
    insurance: null, shareInsuranceFromBoat0: true,
  }]);
  const removeBoat = (idx) => setBoats(bs => bs.filter((_, i) => i !== idx));
  const updateGuest = (key, value) => setGuest(g => ({ ...g, [key]: value }));

  async function submitIntent() {
    setError('');
    const payload = {
      check_in:  state.checkIn,
      check_out: state.checkOut,
      guest_name:  guest.name,
      guest_email: guest.email,
      guest_phone: guest.phone,
      estimated_arrival_time: guest.estimated_arrival_time || null,
      special_requests: guest.special_requests,
      shore_power_amperage: guest.shore_power_amperage || null,
      billing_street:   guest.billing_street,
      billing_city:     guest.billing_city,
      billing_postcode: guest.billing_postcode,
      billing_country:  guest.billing_country,
      company_name:     guest.company_name,
      vat_number:       guest.vat_number,
      terms_accepted:   !!guest.terms_accepted,
      items: boats.map((boat, i) => {
        const token =
          boat.insurance?.token
          || (i > 0 && boat.shareInsuranceFromBoat0 ? boats[0].insurance?.token : '')
          || '';
        return {
          boat_loa:          parseFloat(boat.loa),
          boat_beam:         boat.beam  ? parseFloat(boat.beam)  : null,
          boat_draft:        boat.draft ? parseFloat(boat.draft) : null,
          boat_air_draft:    boat.airDraft ? parseFloat(boat.airDraft) : null,
          berth_category_id: boat.category?.id ?? null,
          vessel_name:           boat.vesselName,
          vessel_registration:   boat.vesselRegistration,
          vessel_flag:           boat.vesselFlag,
          crew_count:            boat.crewCount ? parseInt(boat.crewCount, 10) : null,
          insurance_upload_token: token,
        };
      }),
    };
    try {
      const { data } = await createReservationIntent(marinaSlug, payload);
      if (!data.requires_payment) {
        navigate('confirmed', {
          reservationReference: data.reference,
          reservationStatus: 'pending_review',
        });
        return;
      }
      setIntentData({
        clientSecret:  data.client_secret,
        reservationId: data.reservation_id,
        total:         data.total,
        reference:     data.reference,
        lockedUntil:   data.locked_until,
        marinaSlug,
        items:         data.items,
      });
      setCurrentStep('payment');
    } catch (err) {
      if (err.response?.status === 409) {
        const params = new URLSearchParams({
          check_in:  state.checkIn,
          check_out: state.checkOut,
          boat_loa:  boats[0].loa,
        });
        api.get(`/public/bookings/availability-alternatives/?${params}`)
          .then(r => navigate('alternatives', { alternatives: r.data }))
          .catch(() => navigate('alternatives', { alternatives: [] }));
        return;
      }
      const detail = err.response?.data?.detail;
      const map = {
        terms_not_accepted: 'You must accept the booking terms to continue.',
        insurance_token_invalid: 'Your insurance upload could not be found. Please re-upload.',
        insurance_token_consumed: 'Your insurance upload was already used. Please re-upload.',
        insurance_token_expired: 'Your insurance upload has expired. Please re-upload.',
      };
      setError(map[detail] || detail || 'Something went wrong. Please try again.');
    }
  }

  const stripeOptions = intentData ? {
    clientSecret: intentData.clientSecret,
    appearance: {
      theme: 'stripe',
      variables: {
        colorPrimary: '#b8965a', colorBackground: '#ede7d8',
        colorText: '#1a1a1a', fontFamily: 'IBM Plex Sans, system-ui, sans-serif',
        borderRadius: '5px',
      },
    },
  } : null;

  const stateForSummary = { checkIn: state.checkIn, checkOut: state.checkOut, boats };

  return (
    <div>
      <div className="p-hero" style={{ minHeight: 280 }}>
        <nav style={{
          maxWidth: 1180, margin: '0 auto', padding: '0 32px', height: 56,
          display: 'flex', alignItems: 'center', position: 'relative', zIndex: 1,
        }}>
          <button className="p-btn-outline"
            onClick={() => navigate(state.boats.some(b => b.categories?.length > 0) ? 'options' : 'search')}
            style={{ fontSize: 11, padding: '6px 14px', marginRight: 16 }}>
            ← Back to search
          </button>
          <span style={{ fontFamily: 'var(--font-brand)', fontSize: 15, fontWeight: 700, color: 'var(--cream)', flex: 1 }}>
            {marina?.name || 'Your Marina'}
          </span>
        </nav>
        <div className="p-hero-inner" style={{ paddingBottom: 64 }}>
          <div className="p-eyebrow">Complete your booking</div>
          <h1 className="p-title">
            {currentStep === 'vessel' && 'Vessel details'}
            {currentStep === 'guest' && 'Your details'}
            {currentStep === 'payment' && 'Payment'}
          </h1>
        </div>
        <HarbourScene />
      </div>

      <div className="q-checkout-section">
        <WaveLines />
        <div className="q-checkout-grid">
          <div className="q-checkout-form">
            {currentStep === 'vessel' && (
              <VesselStep
                state={{ boats }}
                updateBoat={updateBoat} addBoat={addBoat} removeBoat={removeBoat}
                marina={marina}
                onBack={() => navigate(state.boats.some(b => b.categories?.length > 0) ? 'options' : 'search')}
                onNext={() => setCurrentStep('guest')}
              />
            )}
            {currentStep === 'guest' && (
              <GuestStep
                state={{ guest }}
                updateGuest={updateGuest}
                marina={marina}
                onBack={() => setCurrentStep('vessel')}
                onNext={submitIntent}
                error={error}
              />
            )}
            {currentStep === 'payment' && intentData && (
              <Elements stripe={stripePromise} options={stripeOptions}>
                <PaymentStep
                  state={{ guest }}
                  intentData={intentData}
                  onBack={() => setCurrentStep('guest')}
                  onConfirmed={ref => navigate('confirmed', {
                    reservationReference: ref,
                    reservationStatus: 'confirmed',
                  })}
                />
              </Elements>
            )}
          </div>
          <BookingSummary
            state={stateForSummary}
            marina={marina}
            intentData={intentData}
            onHoldExpired={() => {
              setIntentData(null);
              setCurrentStep('vessel');
              setError('Your hold expired. Please redo the booking.');
            }}
          />
        </div>
        <p className="p-powered">Powered by DocksBase</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run from repo root: `npm run build -w booking`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add booking/src/screens/QuoteScreen.jsx
git commit -m "feat(booking): rewire QuoteScreen as 3-step state machine + summary"
```

---

## Task 17: CSS layout — grid + sticky panel + mobile bottom bar

**Files:**
- Modify: `booking/src/styles/booking.css`

- [ ] **Step 1: Append new styles**

Append to `booking/src/styles/booking.css`:

```css
/* ── Phase 1 checkout layout ────────────────────────────────────────────── */

.q-checkout-grid {
  max-width: 1180px;
  margin: 0 auto;
  padding: 0 32px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 32px;
  align-items: start;
}

.q-checkout-form {
  min-width: 0;
}

.q-summary {
  position: sticky;
  top: 24px;
  background: #ede7d8;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 6px;
  padding: 20px;
  font-family: var(--font-body, 'IBM Plex Sans', system-ui, sans-serif);
  font-size: 13px;
}

.q-summary-header { margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid rgba(0, 0, 0, 0.08); }
.q-summary-marina-name { font-family: var(--font-brand); font-size: 16px; font-weight: 700; color: #0c1f3d; }
.q-summary-marina-address { font-size: 12px; color: rgba(0, 0, 0, 0.55); margin-top: 2px; }
.q-summary-section { margin-bottom: 16px; padding-bottom: 12px; border-bottom: 1px solid rgba(0, 0, 0, 0.08); }
.q-summary-row { display: flex; justify-content: space-between; margin-bottom: 4px; }
.q-summary-boat { margin-bottom: 12px; }
.q-summary-boat-name { font-weight: 600; }
.q-summary-boat-dims { font-size: 12px; color: rgba(0, 0, 0, 0.5); }
.q-summary-boat-price { display: flex; justify-content: space-between; margin-top: 4px; font-size: 12px; }
.q-summary-total { display: flex; justify-content: space-between; font-size: 16px; font-weight: 700; padding-top: 8px; }
.q-summary-countdown { font-size: 12px; color: #b8965a; margin-top: 8px; }
.q-summary-expired { font-size: 13px; color: #dc2626; margin-top: 8px; }
.q-summary-tos { font-size: 11px; color: rgba(0, 0, 0, 0.5); margin-top: 12px; }
.q-summary-tos a { color: inherit; text-decoration: underline; }

/* Step components shared */
.q-step h3 { font-family: var(--font-brand); font-size: 14px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin: 16px 0 12px; color: #0c1f3d; }
.q-step h3:first-child { margin-top: 0; }
.q-step-footer { display: flex; justify-content: space-between; gap: 12px; margin-top: 24px; }
.q-step-footer .p-btn-gold,
.q-step-footer .p-btn-outline { flex: 1; }
.q-boat-card { padding: 16px; border: 1px solid rgba(0, 0, 0, 0.08); border-radius: 6px; margin-bottom: 16px; }
.q-boat-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.q-boat-header h3 { margin: 0; }
.q-link-danger { background: none; border: none; color: #dc2626; font-size: 12px; cursor: pointer; }
.q-link-add { background: none; border: none; color: var(--gold); font-size: 12px; cursor: pointer; padding: 0 0 16px; display: block; }

.p-grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }

.p-insurance-uploaded { font-size: 13px; color: #0c1f3d; }

/* Mobile: collapse to single column, sticky bottom bar for the summary */
@media (max-width: 880px) {
  .q-checkout-grid { grid-template-columns: 1fr; padding: 0 20px; }
  .q-summary {
    position: fixed;
    bottom: 0; left: 0; right: 0;
    top: auto;
    border-radius: 6px 6px 0 0;
    border-bottom: none;
    z-index: 50;
    max-height: 40vh;
    overflow: auto;
  }
  .q-checkout-form { padding-bottom: 200px; }
}
```

- [ ] **Step 2: Verify build**

Run from repo root: `npm run build -w booking`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add booking/src/styles/booking.css
git commit -m "style(booking): 2-col checkout grid + mobile bottom-bar summary"
```

---

## Task 18: Rewrite `QuoteScreen.test.jsx` for the multi-step flow

**Files:**
- Modify: `booking/src/screens/QuoteScreen.test.jsx`

- [ ] **Step 1: Replace the file**

Overwrite `booking/src/screens/QuoteScreen.test.jsx`:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import QuoteScreen from './QuoteScreen';

vi.mock('@docksbase/portal-ui/api', () => ({
  default: { get: vi.fn() },
  createReservationIntent: vi.fn(),
  confirmReservation: vi.fn(),
  uploadInsuranceCertificate: vi.fn(),
}));

vi.mock('@stripe/stripe-js', () => ({ loadStripe: () => Promise.resolve({}) }));
vi.mock('@stripe/react-stripe-js', () => ({
  Elements:   ({ children }) => <div>{children}</div>,
  PaymentElement: () => <div data-testid="payment-element" />,
  useStripe:  () => ({}),
  useElements:() => ({}),
}));

const baseMarina = {
  slug: 'demo-marina', name: 'Demo Marina', currency: 'EUR',
  booking_terms_pdf_url: 'https://example.com/tos.pdf',
  booking_terms_version: '1.0',
  requires_air_draft: false,
  requires_insurance_at_booking: false,
};

const baseState = {
  checkIn: '2026-08-01', checkOut: '2026-08-05',
  boats: [{ loa: '12', beam: '4', draft: '1.8', category: null, categories: [] }],
  errorBanner: '',
};

function renderScreen({ marina = baseMarina, state = baseState, navigate = vi.fn() } = {}) {
  return render(<QuoteScreen state={state} marina={marina} navigate={navigate} />);
}

describe('QuoteScreen multi-step', () => {
  beforeEach(() => vi.clearAllMocks());

  it('starts on VesselStep', () => {
    renderScreen();
    expect(screen.getByText(/Vessel/i)).toBeInTheDocument();
  });

  it('advances to GuestStep when vessel fields are filled', async () => {
    renderScreen();
    fireEvent.change(screen.getByLabelText(/Vessel name \*/), { target: { value: 'Bella' } });
    fireEvent.change(screen.getByLabelText(/Registration # \*/), { target: { value: 'GB-123' } });
    fireEvent.change(screen.getByLabelText(/Flag \*/), { target: { value: 'GB' } });
    fireEvent.change(screen.getByLabelText(/Crew aboard \*/), { target: { value: '2' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await waitFor(() => expect(screen.getByText(/Your details/i)).toBeInTheDocument());
  });

  it('blocks GuestStep submit when T&Cs unchecked', async () => {
    const { createReservationIntent } = await import('@docksbase/portal-ui/api');
    renderScreen();
    // Fast-forward to GuestStep
    fireEvent.change(screen.getByLabelText(/Vessel name \*/), { target: { value: 'B' } });
    fireEvent.change(screen.getByLabelText(/Registration # \*/), { target: { value: 'R' } });
    fireEvent.change(screen.getByLabelText(/Flag \*/), { target: { value: 'GB' } });
    fireEvent.change(screen.getByLabelText(/Crew aboard \*/), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /Continue/i }));
    await screen.findByText(/Your details/i);
    // Fill required guest fields except terms
    fireEvent.change(screen.getByLabelText(/Full name \*/), { target: { value: 'A' } });
    fireEvent.change(screen.getByLabelText(/Email \*/), { target: { value: 'a@b.test' } });
    fireEvent.change(screen.getByLabelText(/Street \*/), { target: { value: 'X' } });
    fireEvent.change(screen.getByLabelText(/City \*/), { target: { value: 'Y' } });
    fireEvent.change(screen.getByLabelText(/Postcode \*/), { target: { value: 'Z' } });
    fireEvent.change(screen.getByLabelText(/Country \*/), { target: { value: 'GB' } });
    // Submit button should be disabled while terms unchecked
    const btn = screen.getByRole('button', { name: /Continue to payment/i });
    expect(btn).toBeDisabled();
    expect(createReservationIntent).not.toHaveBeenCalled();
  });

  it('shows BookingSummary panel in every step', () => {
    renderScreen();
    expect(screen.getByText(/Demo Marina/i)).toBeInTheDocument();
    expect(screen.getByText(/Check-in/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests**

Run from repo root: `npm run test -w booking`
Expected: PASS (4 tests).

- [ ] **Step 3: Commit**

```bash
git add booking/src/screens/QuoteScreen.test.jsx
git commit -m "test(booking): multi-step QuoteScreen integration tests"
```

---

## Self-Review Notes

After writing the plan, I checked it against the spec sections and traced field coverage:

- **Spec §1 goals** — summary panel (Task 12, 16, 17), 3-step wizard (Tasks 13, 14, 15, 16), new fields (Tasks 1, 2, 5), T&Cs checkbox (Tasks 1, 6, 14). All covered.
- **Spec §3 model tables** — every field on the Reservation/ReservationItem/Marina/InsuranceUploadToken table is created by Tasks 1 and 2.
- **Spec §4 API** — serializer changes (Task 5), token redemption with shared-policy semantics (Task 7), insurance upload endpoint (Task 4), marina-public extension (Task 9). All covered.
- **Spec §5 frontend** — VesselStep (13), GuestStep (14), PaymentStep with Stripe billing details (15), QuoteScreen wiring (16), BookingSummary (12), CSS layout (17). All covered.
- **Spec §6 T&Cs** — model fields (Task 1), serializer enforcement (Task 6), frontend rendering (Task 14). All covered.
- **Spec §7 cleanup** — `transaction.on_commit` source delete inside Task 7's helper. Hourly purge task (Task 8). Covered.
- **Spec §8 country list** — Task 3 creates the constant; serializer references it (Task 5); frontend uses a duplicated short list in `VesselStep`/`GuestStep` — acknowledged duplication (worth a future helper, but inline for Phase 1 is fine).
- **Spec §9 testing** — every backend task includes a test class; Task 18 covers frontend integration.

**Placeholder scan:** no TBDs/TODOs/"appropriate error handling" patterns. All code blocks are complete.

**Type consistency:** state field names match between `QuoteScreen` (Task 16), `GuestStep` (Task 14), and `VesselStep` (Task 13) — `vesselName`, `airDraft`, `vesselRegistration`, `vesselFlag`, `crewCount`, `insurance`, `shareInsuranceFromBoat0`. Backend serializer keys match `state.boats[i]` → payload mapping in `QuoteScreen.submitIntent`.

**Known acceptable duplication:**
- The `COUNTRIES` array is duplicated across `VesselStep.jsx` and `GuestStep.jsx`. Pulled inline rather than via a shared module to keep each task self-contained; refactor candidate for Phase 2.
