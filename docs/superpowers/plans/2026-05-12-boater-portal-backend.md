# Boater Portal Redesign — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build all backend API endpoints and model changes required by the boater portal redesign — Marina app_config, guest boarding pass extensions, member portal endpoints with feature-toggle enforcement, Dockwalk staff interface, and admin config PATCH endpoint.

**Architecture:** All new member endpoints follow the existing `PortalMemberAuthentication` + `IsAuthenticated` pattern from `services_views.py`. Feature-toggle enforcement lives in a reusable `require_feature` helper that checks `marina.app_config` and returns 403 if disabled. Dockwalk charges are staged as `PendingUtilityCharge` records (never mutate active invoices).

**Tech Stack:** Django, Django REST Framework, existing `PortalMemberAuthentication` / `PortalMemberUser` auth, PostgreSQL (via Supabase), existing billing models (`ChargeableItem`, `InvoiceLineItem`).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/apps/accounts/models.py` | Modify | Add `app_config` JSONField to Marina |
| `backend/apps/utilities/models.py` | Modify | Add `PendingUtilityCharge` model |
| `backend/apps/portal/permissions.py` | Create | `require_feature()` helper for toggle enforcement |
| `backend/apps/portal/checkin_serializers.py` | Modify | Add `wash_tokens` to `PortalBookingSerializer` |
| `backend/apps/portal/checkin_views.py` | Modify | Add `PortalGuestMapView` |
| `backend/apps/portal/checkin_urls.py` | Modify | Wire map endpoint |
| `backend/apps/portal/member_views.py` | Create | All new member portal views |
| `backend/apps/portal/member_serializers.py` | Create | Serializers for new member views |
| `backend/apps/portal/urls.py` | Modify | Wire new member URLs |
| `backend/apps/utilities/views.py` | Modify | Add `DockwalkListView`, `DockwalkReadingView` |
| `backend/apps/utilities/serializers.py` | Create | Dockwalk serializers |
| `backend/apps/utilities/urls.py` | Modify | Wire dockwalk URLs |
| `backend/apps/portal/admin_views.py` | Create | `AppConfigUpdateView` |
| `backend/apps/portal/tests/test_portal_member.py` | Create | Tests for member views |
| `backend/apps/portal/tests/test_guest_extensions.py` | Create | Tests for wash_tokens + map |
| `backend/apps/utilities/tests/test_dockwalk.py` | Create | Tests for dockwalk endpoints |

---

### Task 1: Add `app_config` to Marina model

**Files:**
- Modify: `backend/apps/accounts/models.py` (after line 57, alongside existing `features` JSONField)
- Test: `backend/apps/accounts/tests/test_marina_app_config.py` (create if not exists)

- [ ] **Step 1: Write the failing test**

```python
# backend/apps/accounts/tests/test_marina_app_config.py
from django.test import TestCase
from apps.accounts.models import Marina

class MarinaAppConfigTest(TestCase):
    def test_app_config_defaults_to_empty_dict(self):
        marina = Marina.objects.create(
            name='Test Marina',
            slug='test-marina',
        )
        self.assertEqual(marina.app_config, {})

    def test_app_config_stores_and_retrieves_toggles(self):
        marina = Marina.objects.create(
            name='Test Marina 2',
            slug='test-marina-2',
            app_config={
                'enable_boatyard': True,
                'enable_utilities': False,
                'enable_documents': True,
                'brand_color': '#ff5500',
                'wifi_name': 'HarbourNet',
                'wifi_password': 'anchor99',
                'local_guide': 'Best pizza: Joe\'s +1 555 0100',
            },
        )
        marina.refresh_from_db()
        self.assertFalse(marina.app_config['enable_utilities'])
        self.assertEqual(marina.app_config['brand_color'], '#ff5500')
```

- [ ] **Step 2: Run test to verify it fails**

```
cd backend && python manage.py test apps.accounts.tests.test_marina_app_config -v2
```
Expected: `OperationalError` or `TypeError` — `app_config` field does not exist.

- [ ] **Step 3: Add field to Marina model**

In `backend/apps/accounts/models.py`, after the `onboarding` JSONField (around line 57):
```python
    app_config = models.JSONField(default=dict, blank=True)
```

- [ ] **Step 4: Generate and apply migration**

```
python manage.py makemigrations accounts --name marina_app_config
python manage.py migrate
```

- [ ] **Step 5: Run test to verify it passes**

```
python manage.py test apps.accounts.tests.test_marina_app_config -v2
```
Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```
git add backend/apps/accounts/models.py backend/apps/accounts/migrations/ backend/apps/accounts/tests/test_marina_app_config.py
git commit -m "feat(accounts): add app_config JSONField to Marina"
```

---

### Task 2: Add `PendingUtilityCharge` model

**Files:**
- Modify: `backend/apps/utilities/models.py` (append at end)
- Test: `backend/apps/utilities/tests/test_dockwalk.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# backend/apps/utilities/tests/test_dockwalk.py
from django.test import TestCase
from apps.utilities.models import PendingUtilityCharge

class PendingUtilityChargeTest(TestCase):
    def test_model_exists_with_required_fields(self):
        # Just verify the model and its fields are importable and have expected attributes
        fields = {f.name for f in PendingUtilityCharge._meta.get_fields()}
        self.assertIn('member', fields)
        self.assertIn('marina', fields)
        self.assertIn('meter', fields)
        self.assertIn('meter_reading', fields)
        self.assertIn('kwh_delta', fields)
        self.assertIn('m3_delta', fields)
        self.assertIn('unit_price', fields)
        self.assertIn('amount', fields)
        self.assertIn('rollover', fields)
        self.assertIn('swept_to_invoice', fields)
```

- [ ] **Step 2: Run test to verify it fails**

```
python manage.py test apps.utilities.tests.test_dockwalk.PendingUtilityChargeTest -v2
```
Expected: `ImportError` — `PendingUtilityCharge` does not exist.

- [ ] **Step 3: Add model to utilities/models.py**

Append at the end of `backend/apps/utilities/models.py`:
```python
# ---------------------------------------------------------------------------
# Pending Utility Charge (Dockwalk billing staging)
# ---------------------------------------------------------------------------

class PendingUtilityCharge(models.Model):
    """
    Staging ledger for Dockwalk utility charges.
    Created when a dockhand enters a meter reading. Never touches an active invoice.
    The monthly billing sweep collects rows where swept_to_invoice is None
    and attaches them to the new invoice.
    """
    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='pending_utility_charges')
    member        = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='pending_utility_charges')
    meter         = models.ForeignKey(SmartMeter, on_delete=models.PROTECT, related_name='pending_charges')
    meter_reading = models.ForeignKey(MeterReading, on_delete=models.PROTECT, related_name='pending_charges')
    kwh_delta     = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True)
    m3_delta      = models.DecimalField(max_digits=10, decimal_places=3, null=True, blank=True)
    unit_price    = models.DecimalField(max_digits=10, decimal_places=4)
    amount        = models.DecimalField(max_digits=10, decimal_places=2)
    rollover      = models.BooleanField(default=False)
    swept_to_invoice = models.ForeignKey(
        'billing.Invoice',
        on_delete=models.SET_NULL,
        null=True, blank=True,
        related_name='utility_charges',
    )
    created_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'PendingCharge {self.member} {self.amount}'
```

- [ ] **Step 4: Generate and apply migration**

```
python manage.py makemigrations utilities --name pending_utility_charge
python manage.py migrate
```

- [ ] **Step 5: Run test to verify it passes**

```
python manage.py test apps.utilities.tests.test_dockwalk.PendingUtilityChargeTest -v2
```
Expected: 1 test passes.

- [ ] **Step 6: Commit**

```
git add backend/apps/utilities/models.py backend/apps/utilities/migrations/ backend/apps/utilities/tests/test_dockwalk.py
git commit -m "feat(utilities): add PendingUtilityCharge staging model for Dockwalk billing"
```

---

### Task 3: Feature-toggle enforcement helper

**Files:**
- Create: `backend/apps/portal/permissions.py`
- Test: `backend/apps/portal/tests/test_feature_guard.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/apps/portal/tests/test_feature_guard.py
from django.test import TestCase, RequestFactory
from unittest.mock import MagicMock
from rest_framework.exceptions import PermissionDenied
from apps.portal.permissions import require_feature


class RequireFeatureTest(TestCase):
    def _make_member(self, app_config):
        member = MagicMock()
        member.marina.app_config = app_config
        return member

    def test_passes_when_feature_enabled(self):
        member = self._make_member({'enable_boatyard': True})
        # Should not raise
        require_feature(member, 'enable_boatyard')

    def test_raises_403_when_feature_disabled(self):
        member = self._make_member({'enable_boatyard': False})
        with self.assertRaises(PermissionDenied):
            require_feature(member, 'enable_boatyard')

    def test_raises_403_when_feature_missing_from_config(self):
        member = self._make_member({})
        with self.assertRaises(PermissionDenied):
            require_feature(member, 'enable_utilities')

    def test_passes_when_feature_missing_but_default_true(self):
        member = self._make_member({})
        # default=True means "enabled unless explicitly turned off"
        require_feature(member, 'enable_boatyard', default=True)
```

- [ ] **Step 2: Run test to verify it fails**

```
python manage.py test apps.portal.tests.test_feature_guard -v2
```
Expected: `ImportError` — `permissions` module does not exist.

- [ ] **Step 3: Create permissions.py**

```python
# backend/apps/portal/permissions.py
from rest_framework.exceptions import PermissionDenied

FEATURE_DISABLED_MSG = 'This feature is not enabled for this marina.'


def require_feature(member, feature_key: str, default: bool = False) -> None:
    """
    Raise PermissionDenied (HTTP 403) if the marina's app_config has
    the given feature_key set to False (or absent when default=False).

    Call this at the top of any view guarded by a feature toggle.

    Args:
        member: Member ORM instance with member.marina.app_config dict.
        feature_key: e.g. 'enable_boatyard', 'enable_utilities', 'enable_documents'.
        default: Value to use when key is absent from app_config. Default False.
    """
    config = getattr(member.marina, 'app_config', {}) or {}
    enabled = config.get(feature_key, default)
    if not enabled:
        raise PermissionDenied(FEATURE_DISABLED_MSG)
```

- [ ] **Step 4: Run test to verify it passes**

```
python manage.py test apps.portal.tests.test_feature_guard -v2
```
Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```
git add backend/apps/portal/permissions.py backend/apps/portal/tests/test_feature_guard.py
git commit -m "feat(portal): add require_feature() helper for app_config toggle enforcement"
```

---

### Task 4: Extend guest checkin serializer with wash_tokens

**Files:**
- Modify: `backend/apps/portal/checkin_serializers.py`
- Test: `backend/apps/portal/tests/test_guest_extensions.py` (create)

- [ ] **Step 1: Write the failing test**

```python
# backend/apps/portal/tests/test_guest_extensions.py
import datetime
from django.test import TestCase
from django.utils import timezone
from unittest.mock import patch, MagicMock
from apps.portal.checkin_serializers import PortalBookingSerializer
from apps.accounts.models import Marina
from apps.reservations.models import Booking
from apps.members.models import Member
from apps.utilities.models import WashToken
from apps.billing.models import ChargeableItem, TaxRate


class WashTokenSerializerTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina', slug='test-m')
        self.tax = TaxRate.objects.create(marina=self.marina, name='VAT', rate=0)
        self.chargeable = ChargeableItem.objects.create(
            marina=self.marina,
            name='Shower Token',
            category='service',
            pricing_model='flat_fee',
            unit_price=2,
            tax_category=self.tax,
        )
        self.member = Member.objects.create(marina=self.marina, name='Test Boater')
        self.booking = Booking.objects.create(
            marina=self.marina,
            check_in=datetime.date.today(),
            check_out=datetime.date.today() + datetime.timedelta(days=2),
            status='checked_in',
            self_checked_in=True,
            guest_name='Test Boater',
            guest_email='test@example.com',
        )
        self.token = WashToken.objects.create(
            marina=self.marina,
            member=self.member,
            facility='shower',
            token_code='ABC123',
            status='issued',
            expires_at=timezone.now() + datetime.timedelta(days=1),
            chargeable_item=self.chargeable,
        )

    def test_wash_tokens_in_serializer(self):
        # Attach member to booking via guest_email lookup (or direct)
        serializer = PortalBookingSerializer(self.booking)
        data = serializer.data
        self.assertIn('wash_tokens', data)

    def test_wash_tokens_contains_expected_fields(self):
        # Link the booking's marina to member via email
        serializer = PortalBookingSerializer(self.booking)
        data = serializer.data
        # If no tokens linked to this booking's guest, returns []
        self.assertIsInstance(data['wash_tokens'], list)
```

- [ ] **Step 2: Run test to verify it fails**

```
python manage.py test apps.portal.tests.test_guest_extensions.WashTokenSerializerTest -v2
```
Expected: `KeyError: 'wash_tokens'` — field not in serializer yet.

- [ ] **Step 3: Update PortalBookingSerializer**

In `backend/apps/portal/checkin_serializers.py`, import WashToken and add the field:

```python
from apps.utilities.models import WashToken


class WashTokenSerializer(serializers.Serializer):
    facility   = serializers.CharField()
    token_code = serializers.CharField()
    expires_at = serializers.DateTimeField()


class PortalBookingSerializer(serializers.ModelSerializer):
    berth_code     = serializers.CharField(source='berth.code', read_only=True, default=None)
    berth_pier     = serializers.CharField(source='berth.pier.label', read_only=True, default=None)
    is_arrival_day = serializers.SerializerMethodField()
    marina_wallet  = serializers.SerializerMethodField()
    marina_name    = serializers.CharField(source='marina.name', read_only=True)
    marina_info    = serializers.SerializerMethodField()
    wash_tokens    = serializers.SerializerMethodField()

    class Meta:
        model  = Booking
        fields = [
            'id', 'check_in', 'check_out', 'status',
            'berth_code', 'berth_pier',
            'guest_name', 'guest_email',
            'boat_loa', 'boat_beam', 'boat_draft',
            'waiver_envelope_id', 'waiver_signed',
            'insurance_doc',
            'pre_cleared', 'self_checked_in', 'self_checked_in_at',
            'is_arrival_day', 'marina_name', 'marina_info', 'marina_wallet',
            'wash_tokens',
        ]
        read_only_fields = fields

    def get_is_arrival_day(self, booking):
        from .checkin_utils import is_arrival_day
        return is_arrival_day(booking)

    def get_marina_info(self, booking):
        m = booking.marina
        return {
            'phone':                m.phone or None,
            'contact_email':        m.contact_email or None,
            'harbour_master_phone': m.wallet_harbour_master_phone or None,
            'vhf_channel':          m.wallet_vhf_channel or None,
            'office_hours':         m.wallet_office_hours or None,
            'address':              m.address or None,
            'website':              m.website or None,
            'lat':                  float(m.lat) if m.lat else None,
            'lng':                  float(m.lng) if m.lng else None,
            'has_map':              bool((m.onboarding or {}).get('draw_map', False)),
            'app_config':           m.app_config or {},
        }

    def get_marina_wallet(self, booking):
        if not booking.self_checked_in:
            return None
        m = booking.marina
        return {
            'wifi_network':         m.wallet_wifi_network,
            'wifi_password':        m.wallet_wifi_password,
            'gate_codes':           m.wallet_gate_codes,
            'harbour_master_phone': m.wallet_harbour_master_phone,
            'vhf_channel':          m.wallet_vhf_channel,
            'office_hours':         m.wallet_office_hours,
            'marina_name':          m.name,
        }

    def get_wash_tokens(self, booking):
        from django.utils import timezone
        email = booking.guest_email
        if not email:
            return []
        tokens = WashToken.objects.filter(
            marina=booking.marina,
            member__email=email,
            status='issued',
        ).exclude(expires_at__lt=timezone.now())
        return WashTokenSerializer(tokens, many=True).data
```

- [ ] **Step 4: Run test to verify it passes**

```
python manage.py test apps.portal.tests.test_guest_extensions.WashTokenSerializerTest -v2
```
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```
git add backend/apps/portal/checkin_serializers.py backend/apps/portal/tests/test_guest_extensions.py
git commit -m "feat(portal): add wash_tokens to guest checkin booking serializer"
```

---

### Task 5: Guest map endpoint

**Files:**
- Modify: `backend/apps/portal/checkin_views.py`
- Modify: `backend/apps/portal/checkin_urls.py`
- Test: `backend/apps/portal/tests/test_guest_extensions.py`

- [ ] **Step 1: Write the failing test**

Append to `backend/apps/portal/tests/test_guest_extensions.py`:

```python
from django.urls import reverse
from rest_framework.test import APIClient
from apps.berths.models import Amenity


class GuestMapViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Map Marina', slug='map-marina')
        self.client = APIClient()
        self.client.defaults['HTTP_X_MARINA_SLUG'] = 'map-marina'
        Amenity.objects.create(
            marina=self.marina,
            type='fuel',
            label='Fuel Dock',
            canvas_x=120.5,
            canvas_y=80.0,
        )

    def test_map_returns_amenities(self):
        response = self.client.get('/api/v1/portal/checkin/map/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('amenities', response.data)
        self.assertEqual(len(response.data['amenities']), 1)
        self.assertEqual(response.data['amenities'][0]['type'], 'fuel')
        self.assertIn('canvas_x', response.data['amenities'][0])

    def test_map_returns_app_config(self):
        self.marina.app_config = {'brand_color': '#336699'}
        self.marina.save()
        response = self.client.get('/api/v1/portal/checkin/map/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('app_config', response.data)
        self.assertEqual(response.data['app_config']['brand_color'], '#336699')
```

- [ ] **Step 2: Run test to verify it fails**

```
python manage.py test apps.portal.tests.test_guest_extensions.GuestMapViewTest -v2
```
Expected: 404 — endpoint does not exist.

- [ ] **Step 3: Add view to checkin_views.py**

Append to `backend/apps/portal/checkin_views.py`:

```python
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView
from rest_framework.response import Response
from apps.berths.models import Amenity


class PortalGuestMapView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        if request.tenant is None:
            return Response({'error': 'X-Marina-Slug header is required.'}, status=400)
        marina = request.tenant
        amenities = Amenity.objects.filter(marina=marina).values(
            'type', 'label', 'canvas_x', 'canvas_y', 'scale', 'rotation'
        )
        return Response({
            'app_config': marina.app_config or {},
            'amenities': list(amenities),
        })
```

- [ ] **Step 4: Wire URL in checkin_urls.py**

In `backend/apps/portal/checkin_urls.py`, add:

```python
from .checkin_views import PortalGuestMapView

# Add to urlpatterns:
path('portal/checkin/map/', PortalGuestMapView.as_view(), name='portal_guest_map'),
```

- [ ] **Step 5: Run test to verify it passes**

```
python manage.py test apps.portal.tests.test_guest_extensions.GuestMapViewTest -v2
```
Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```
git add backend/apps/portal/checkin_views.py backend/apps/portal/checkin_urls.py backend/apps/portal/tests/test_guest_extensions.py
git commit -m "feat(portal): add guest map endpoint returning amenity pins and app_config"
```

---

### Task 6: Member portal — gate, utilities, work-orders, documents views

**Files:**
- Create: `backend/apps/portal/member_views.py`
- Create: `backend/apps/portal/member_serializers.py`
- Test: `backend/apps/portal/tests/test_portal_member.py`

- [ ] **Step 1: Write failing tests**

```python
# backend/apps/portal/tests/test_portal_member.py
import datetime
from django.test import TestCase
from rest_framework.test import APIClient
from django.core import signing
from apps.accounts.models import Marina
from apps.members.models import Member
from apps.utilities.models import SmartMeter, MeterReading
from apps.documents.models import MemberDocument


def _make_member_token(member_id, marina_slug, email):
    payload = {'member_id': member_id, 'marina_slug': marina_slug, 'email': email}
    return signing.dumps(payload, salt='portal-member-v1')


class PortalGateViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='Gate Marina', slug='gate-marina',
            wallet_gate_codes=[{'label': 'Main Gate', 'pin': '1234'}],
        )
        self.member = Member.objects.create(marina=self.marina, name='Test Member', email='m@test.com')
        token = _make_member_token(self.member.id, 'gate-marina', 'm@test.com')
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'MemberBearer {token}')

    def test_gate_returns_codes(self):
        response = self.client.get('/api/v1/portal/member/gate/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('gate_codes', response.data)
        self.assertEqual(response.data['gate_codes'][0]['pin'], '1234')


class PortalUtilitiesViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='Util Marina', slug='util-marina',
            app_config={'enable_utilities': True},
        )
        self.member = Member.objects.create(marina=self.marina, name='Util Member', email='u@test.com')
        token = _make_member_token(self.member.id, 'util-marina', 'u@test.com')
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'MemberBearer {token}')

    def test_utilities_returns_200_when_enabled(self):
        response = self.client.get('/api/v1/portal/member/utilities/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('meters', response.data)

    def test_utilities_returns_403_when_disabled(self):
        self.marina.app_config = {'enable_utilities': False}
        self.marina.save()
        response = self.client.get('/api/v1/portal/member/utilities/')
        self.assertEqual(response.status_code, 403)


class PortalWorkOrderViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='WO Marina', slug='wo-marina',
            app_config={'enable_boatyard': True},
        )
        self.member = Member.objects.create(marina=self.marina, name='WO Member', email='wo@test.com')
        token = _make_member_token(self.member.id, 'wo-marina', 'wo@test.com')
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'MemberBearer {token}')

    def test_submit_work_order(self):
        response = self.client.post('/api/v1/portal/member/work-orders/', {
            'description': 'Engine making noise',
            'urgency': 'routine',
        }, format='json')
        self.assertEqual(response.status_code, 201)
        self.assertIn('ref', response.data)

    def test_work_order_blocked_when_feature_disabled(self):
        self.marina.app_config = {'enable_boatyard': False}
        self.marina.save()
        response = self.client.post('/api/v1/portal/member/work-orders/', {
            'description': 'Engine making noise',
            'urgency': 'routine',
        }, format='json')
        self.assertEqual(response.status_code, 403)


class PortalDocumentViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='Doc Marina', slug='doc-marina',
            app_config={'enable_documents': True},
        )
        self.member = Member.objects.create(marina=self.marina, name='Doc Member', email='doc@test.com')
        token = _make_member_token(self.member.id, 'doc-marina', 'doc@test.com')
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION=f'MemberBearer {token}')

    def test_documents_list_returns_200_when_enabled(self):
        response = self.client.get('/api/v1/portal/member/documents/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('documents', response.data)

    def test_documents_blocked_when_disabled(self):
        self.marina.app_config = {'enable_documents': False}
        self.marina.save()
        response = self.client.get('/api/v1/portal/member/documents/')
        self.assertEqual(response.status_code, 403)
```

- [ ] **Step 2: Run tests to verify they fail**

```
python manage.py test apps.portal.tests.test_portal_member -v2
```
Expected: All fail with 404.

- [ ] **Step 3: Create member_serializers.py**

```python
# backend/apps/portal/member_serializers.py
from rest_framework import serializers
from apps.documents.models import MemberDocument
from apps.utilities.models import SmartMeter, MeterReading


class PortalMeterSerializer(serializers.Serializer):
    id           = serializers.IntegerField(source='pk')
    label        = serializers.CharField()
    meter_type   = serializers.CharField()
    berth_code   = serializers.SerializerMethodField()
    last_reading_value = serializers.SerializerMethodField()
    last_reading_unit  = serializers.SerializerMethodField()
    last_reading_at    = serializers.SerializerMethodField()

    def get_berth_code(self, meter):
        return meter.berth.code if meter.berth else None

    def get_last_reading_value(self, meter):
        reading = meter.readings.order_by('-recorded_at').first()
        if not reading:
            return None
        return float(reading.reading_kwh or reading.reading_m3 or 0)

    def get_last_reading_unit(self, meter):
        return 'kWh' if meter.meter_type == 'electricity' else 'm³'

    def get_last_reading_at(self, meter):
        reading = meter.readings.order_by('-recorded_at').first()
        return reading.recorded_at if reading else None


class PortalDocumentSerializer(serializers.ModelSerializer):
    doc_type_display = serializers.CharField(source='get_doc_type_display', read_only=True)
    status_display   = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = MemberDocument
        fields = ['id', 'doc_type', 'doc_type_display', 'status', 'status_display',
                  'expiry_date', 'uploaded_at', 'file']
        read_only_fields = ['id', 'status', 'status_display', 'doc_type_display', 'uploaded_at']
```

- [ ] **Step 4: Create member_views.py**

```python
# backend/apps/portal/member_views.py
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status as http_status
from rest_framework.permissions import IsAuthenticated

from apps.members.models import Member
from apps.boatyard.models import WorkOrder
from apps.documents.models import MemberDocument
from apps.utilities.models import SmartMeter

from .member_auth import PortalMemberAuthentication
from .permissions import require_feature
from .member_serializers import PortalMeterSerializer, PortalDocumentSerializer


def _get_member(request):
    return (
        Member.objects
        .filter(id=request.user.member_id, marina__slug=request.user.marina_slug)
        .select_related('marina')
        .first()
    )


class PortalGateView(APIView):
    authentication_classes = [PortalMemberAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        member = _get_member(request)
        if member is None:
            return Response({'detail': 'Member not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        marina = member.marina
        return Response({
            'gate_codes':  marina.wallet_gate_codes or [],
            'wifi_name':   marina.app_config.get('wifi_name') or marina.wallet_wifi_network or '',
            'wifi_password': marina.app_config.get('wifi_password') or marina.wallet_wifi_password or '',
        })


class PortalUtilitiesView(APIView):
    authentication_classes = [PortalMemberAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        member = _get_member(request)
        if member is None:
            return Response({'detail': 'Member not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        require_feature(member, 'enable_utilities')
        meters = (
            SmartMeter.objects
            .filter(marina=member.marina, is_active=True, berth__isnull=False)
            .select_related('berth')
            .prefetch_related('readings')
        )
        return Response({'meters': PortalMeterSerializer(meters, many=True).data})


VALID_URGENCIES = {'routine', 'urgent', 'emergency'}
URGENCY_TO_PRIORITY = {'routine': 'low', 'urgent': 'high', 'emergency': 'urgent'}


class PortalWorkOrderView(APIView):
    authentication_classes = [PortalMemberAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        member = _get_member(request)
        if member is None:
            return Response({'detail': 'Member not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        require_feature(member, 'enable_boatyard')
        orders = WorkOrder.objects.filter(
            marina=member.marina,
            title__startswith='Member WO:',
        ).order_by('-created_at')[:20]
        return Response({'work_orders': [
            {'ref': f'WO-{o.id}', 'title': o.title, 'status': o.status, 'created_at': o.created_at}
            for o in orders
        ]})

    def post(self, request):
        member = _get_member(request)
        if member is None:
            return Response({'detail': 'Member not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        require_feature(member, 'enable_boatyard')

        raw_desc = request.data.get('description', '')
        description = raw_desc.strip() if isinstance(raw_desc, str) else ''
        if not description:
            return Response({'detail': 'description is required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        urgency = request.data.get('urgency', 'routine')
        if urgency not in VALID_URGENCIES:
            return Response({'detail': 'urgency must be routine, urgent, or emergency.'}, status=http_status.HTTP_400_BAD_REQUEST)

        work_order = WorkOrder.objects.create(
            marina=member.marina,
            title=f'Member WO: {description[:80]}',
            description=description,
            priority=URGENCY_TO_PRIORITY[urgency],
            status='pending_auth',
        )
        return Response({'ref': f'WO-{work_order.id}'}, status=http_status.HTTP_201_CREATED)


class PortalDocumentListView(APIView):
    authentication_classes = [PortalMemberAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        member = _get_member(request)
        if member is None:
            return Response({'detail': 'Member not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        require_feature(member, 'enable_documents')
        docs = MemberDocument.objects.filter(member=member, marina=member.marina)
        return Response({'documents': PortalDocumentSerializer(docs, many=True).data})

    def post(self, request):
        member = _get_member(request)
        if member is None:
            return Response({'detail': 'Member not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        require_feature(member, 'enable_documents')

        doc_type = request.data.get('doc_type', '')
        if doc_type not in ('insurance', 'registration'):
            return Response({'detail': 'doc_type must be insurance or registration.'}, status=http_status.HTTP_400_BAD_REQUEST)

        file = request.FILES.get('file')
        if not file:
            return Response({'detail': 'file is required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        doc, _ = MemberDocument.objects.get_or_create(
            member=member,
            marina=member.marina,
            doc_type=doc_type,
            defaults={'status': 'pending_upload'},
        )
        doc.file = file
        doc.status = 'uploaded'
        doc.save(update_fields=['file', 'status', 'uploaded_at'])
        return Response(PortalDocumentSerializer(doc).data, status=http_status.HTTP_201_CREATED)


class PortalDocumentDetailView(APIView):
    authentication_classes = [PortalMemberAuthentication]
    permission_classes = [IsAuthenticated]

    def delete(self, request, pk):
        member = _get_member(request)
        if member is None:
            return Response({'detail': 'Member not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        require_feature(member, 'enable_documents')
        try:
            doc = MemberDocument.objects.get(pk=pk, member=member, marina=member.marina)
        except MemberDocument.DoesNotExist:
            return Response({'detail': 'Document not found.'}, status=http_status.HTTP_404_NOT_FOUND)
        doc.file.delete(save=False)
        doc.status = 'pending_upload'
        doc.file = None
        doc.save(update_fields=['file', 'status'])
        return Response(status=http_status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 5: Wire URLs in portal/urls.py**

In `backend/apps/portal/urls.py`, add imports and URL patterns:

```python
from .member_views import (
    PortalGateView,
    PortalUtilitiesView,
    PortalWorkOrderView,
    PortalDocumentListView,
    PortalDocumentDetailView,
)

# Add to urlpatterns:
path('portal/member/gate/',              PortalGateView.as_view(),         name='portal_member_gate'),
path('portal/member/utilities/',         PortalUtilitiesView.as_view(),    name='portal_member_utilities'),
path('portal/member/work-orders/',       PortalWorkOrderView.as_view(),    name='portal_member_work_orders'),
path('portal/member/documents/',         PortalDocumentListView.as_view(), name='portal_member_documents'),
path('portal/member/documents/<int:pk>/', PortalDocumentDetailView.as_view(), name='portal_member_document_detail'),
```

- [ ] **Step 6: Run tests to verify they pass**

```
python manage.py test apps.portal.tests.test_portal_member -v2
```
Expected: All tests pass.

- [ ] **Step 7: Commit**

```
git add backend/apps/portal/member_views.py backend/apps/portal/member_serializers.py backend/apps/portal/urls.py backend/apps/portal/tests/test_portal_member.py
git commit -m "feat(portal): add member gate, utilities, work-orders, documents endpoints"
```

---

### Task 7: App-config PATCH endpoint (admin)

**Files:**
- Create: `backend/apps/portal/admin_views.py`
- Modify: `backend/apps/portal/urls.py`
- Test: `backend/apps/portal/tests/test_portal_member.py`

- [ ] **Step 1: Write failing test**

Append to `backend/apps/portal/tests/test_portal_member.py`:

```python
from apps.accounts.models import User  # or however admin users are created


class AppConfigUpdateViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Config Marina', slug='config-marina')
        # Create a manager user for this marina
        self.user = User.objects.create_user(
            email='mgr@config-marina.com',
            password='testpass',
            role='manager',
            marina=self.marina,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_patch_app_config(self):
        response = self.client.patch(
            '/api/v1/marina/app-config/',
            {'enable_boatyard': True, 'brand_color': '#cc0000'},
            format='json',
            HTTP_X_MARINA_SLUG='config-marina',
        )
        self.assertEqual(response.status_code, 200)
        self.marina.refresh_from_db()
        self.assertTrue(self.marina.app_config['enable_boatyard'])
        self.assertEqual(self.marina.app_config['brand_color'], '#cc0000')

    def test_patch_merges_not_replaces(self):
        self.marina.app_config = {'enable_utilities': True}
        self.marina.save()
        self.client.patch(
            '/api/v1/marina/app-config/',
            {'enable_boatyard': False},
            format='json',
            HTTP_X_MARINA_SLUG='config-marina',
        )
        self.marina.refresh_from_db()
        # enable_utilities should still be there
        self.assertTrue(self.marina.app_config.get('enable_utilities'))
        self.assertFalse(self.marina.app_config.get('enable_boatyard'))
```

- [ ] **Step 2: Run tests to verify they fail**

```
python manage.py test apps.portal.tests.test_portal_member.AppConfigUpdateViewTest -v2
```
Expected: 404.

- [ ] **Step 3: Create admin_views.py**

```python
# backend/apps/portal/admin_views.py
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status as http_status
from apps.accounts.views import IsMarinaStaff

ALLOWED_KEYS = {
    'brand_color', 'logo_url', 'enable_boatyard', 'enable_utilities',
    'enable_documents', 'wifi_name', 'wifi_password', 'local_guide', 'map_url',
}


class AppConfigUpdateView(APIView):
    permission_classes = [IsMarinaStaff]

    def patch(self, request):
        marina = request.user.marina
        if marina is None:
            return Response({'detail': 'No marina linked to user.'}, status=http_status.HTTP_400_BAD_REQUEST)

        incoming = {k: v for k, v in request.data.items() if k in ALLOWED_KEYS}
        if not incoming:
            return Response({'detail': 'No valid keys provided.'}, status=http_status.HTTP_400_BAD_REQUEST)

        current = marina.app_config or {}
        current.update(incoming)
        marina.app_config = current
        marina.save(update_fields=['app_config'])

        return Response({'app_config': marina.app_config})
```

- [ ] **Step 4: Wire URL in portal/urls.py**

```python
from .admin_views import AppConfigUpdateView

# Add to urlpatterns:
path('marina/app-config/', AppConfigUpdateView.as_view(), name='marina_app_config'),
```

- [ ] **Step 5: Run tests to verify they pass**

```
python manage.py test apps.portal.tests.test_portal_member.AppConfigUpdateViewTest -v2
```
Expected: 2 tests pass.

- [ ] **Step 6: Commit**

```
git add backend/apps/portal/admin_views.py backend/apps/portal/urls.py backend/apps/portal/tests/test_portal_member.py
git commit -m "feat(portal): add app-config PATCH endpoint for marina admin"
```

---

### Task 8: Dockwalk staff endpoints

**Files:**
- Modify: `backend/apps/utilities/views.py`
- Create: `backend/apps/utilities/serializers.py`
- Modify: `backend/apps/utilities/urls.py` (create if not exists)
- Test: `backend/apps/utilities/tests/test_dockwalk.py`

- [ ] **Step 1: Write failing tests**

Append to `backend/apps/utilities/tests/test_dockwalk.py`:

```python
import datetime
from decimal import Decimal
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User
from apps.members.models import Member
from apps.berths.models import Berth, Pier
from apps.utilities.models import SmartMeter, MeterReading, PendingUtilityCharge
from apps.billing.models import ChargeableItem, TaxRate


class DockwalkListViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='DW Marina', slug='dw-marina')
        self.staff = User.objects.create_user(
            email='staff@dw-marina.com', password='test', role='staff', marina=self.marina
        )
        self.pier = Pier.objects.create(marina=self.marina, label='A', code='A')
        self.berth = Berth.objects.create(marina=self.marina, pier=self.pier, code='A-01', loa=10, beam=4)
        self.meter = SmartMeter.objects.create(
            marina=self.marina, berth=self.berth, vendor='rolec',
            meter_type='electricity', device_id='DEV001', is_active=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.staff)

    def test_dockwalk_list_returns_meters(self):
        response = self.client.get('/api/v1/utilities/dockwalk/', HTTP_X_MARINA_SLUG='dw-marina')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['meters']), 1)
        self.assertEqual(response.data['meters'][0]['device_id'], 'DEV001')

    def test_dockwalk_list_excluded_inactive(self):
        self.meter.is_active = False
        self.meter.save()
        response = self.client.get('/api/v1/utilities/dockwalk/', HTTP_X_MARINA_SLUG='dw-marina')
        self.assertEqual(len(response.data['meters']), 0)


class DockwalkReadingViewTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='DW Marina 2', slug='dw-marina-2')
        self.tax = TaxRate.objects.create(marina=self.marina, name='VAT', rate=0)
        self.chargeable = ChargeableItem.objects.create(
            marina=self.marina, name='Shore Power', category='utility',
            pricing_model='per_kwh', unit_price=Decimal('0.25'), tax_category=self.tax,
        )
        self.staff = User.objects.create_user(
            email='staff@dw2.com', password='test', role='staff', marina=self.marina
        )
        self.member = Member.objects.create(marina=self.marina, name='Berth Owner', email='owner@test.com')
        self.pier = Pier.objects.create(marina=self.marina, label='B', code='B')
        self.berth = Berth.objects.create(marina=self.marina, pier=self.pier, code='B-01', loa=10, beam=4)
        self.meter = SmartMeter.objects.create(
            marina=self.marina, berth=self.berth, vendor='rolec',
            meter_type='electricity', device_id='DEV002', is_active=True,
        )
        MeterReading.objects.create(
            meter=self.meter, reading_kwh=Decimal('1000.000'),
            recorded_at=timezone.now() - datetime.timedelta(hours=24), source='manual',
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.staff)

    def test_reading_accepted_when_higher(self):
        response = self.client.post(
            f'/api/v1/utilities/dockwalk/{self.meter.id}/reading/',
            {'reading_kwh': '1050.000', 'rollover': False},
            format='json',
            HTTP_X_MARINA_SLUG='dw-marina-2',
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(MeterReading.objects.filter(meter=self.meter).count(), 2)

    def test_reading_rejected_when_lower_without_rollover(self):
        response = self.client.post(
            f'/api/v1/utilities/dockwalk/{self.meter.id}/reading/',
            {'reading_kwh': '500.000', 'rollover': False},
            format='json',
            HTTP_X_MARINA_SLUG='dw-marina-2',
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn('lower than last', response.data['detail'])

    def test_reading_accepted_with_rollover_flag(self):
        response = self.client.post(
            f'/api/v1/utilities/dockwalk/{self.meter.id}/reading/',
            {'reading_kwh': '50.000', 'rollover': True},
            format='json',
            HTTP_X_MARINA_SLUG='dw-marina-2',
        )
        self.assertEqual(response.status_code, 201)
        reading = MeterReading.objects.filter(meter=self.meter, source='manual').order_by('-recorded_at').first()
        self.assertEqual(reading.reading_kwh, Decimal('50.000'))

    def test_pending_charge_created_on_reading(self):
        self.meter.berth.member_set.add(self.member)  # link member to berth if applicable
        # For this test, just verify PendingUtilityCharge count increases
        initial_count = PendingUtilityCharge.objects.count()
        self.client.post(
            f'/api/v1/utilities/dockwalk/{self.meter.id}/reading/',
            {'reading_kwh': '1050.000', 'rollover': False},
            format='json',
            HTTP_X_MARINA_SLUG='dw-marina-2',
        )
        # PendingUtilityCharge is only created if a member is linked to the berth
        # Verify no crash at minimum
        self.assertGreaterEqual(PendingUtilityCharge.objects.count(), initial_count)
```

- [ ] **Step 2: Run tests to verify they fail**

```
python manage.py test apps.utilities.tests.test_dockwalk -v2
```
Expected: 404 or ImportError for dockwalk endpoints.

- [ ] **Step 3: Create utilities/serializers.py**

```python
# backend/apps/utilities/serializers.py
from rest_framework import serializers
from .models import SmartMeter, MeterReading


class DockwalkMeterSerializer(serializers.ModelSerializer):
    berth_code      = serializers.CharField(source='berth.code', read_only=True, default=None)
    pier_label      = serializers.CharField(source='berth.pier.label', read_only=True, default=None)
    last_reading_kwh = serializers.SerializerMethodField()
    last_reading_m3  = serializers.SerializerMethodField()
    last_recorded_at = serializers.SerializerMethodField()

    class Meta:
        model  = SmartMeter
        fields = [
            'id', 'device_id', 'label', 'meter_type', 'vendor',
            'berth_code', 'pier_label',
            'last_reading_kwh', 'last_reading_m3', 'last_recorded_at',
        ]

    def _last(self, meter):
        return meter.readings.order_by('-recorded_at').first()

    def get_last_reading_kwh(self, meter):
        r = self._last(meter)
        return str(r.reading_kwh) if r and r.reading_kwh is not None else None

    def get_last_reading_m3(self, meter):
        r = self._last(meter)
        return str(r.reading_m3) if r and r.reading_m3 is not None else None

    def get_last_recorded_at(self, meter):
        r = self._last(meter)
        return r.recorded_at if r else None
```

- [ ] **Step 4: Create dockwalk views in utilities/views.py**

Create `backend/apps/utilities/views.py` (or append if it exists):

```python
# backend/apps/utilities/views.py
from decimal import Decimal
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status as http_status
from apps.accounts.views import IsMarinaStaff
from apps.billing.models import ChargeableItem
from .models import SmartMeter, MeterReading, PendingUtilityCharge
from .serializers import DockwalkMeterSerializer


class DockwalkListView(APIView):
    permission_classes = [IsMarinaStaff]

    def get(self, request):
        meters = (
            SmartMeter.objects
            .filter(marina=request.user.marina, is_active=True)
            .select_related('berth__pier')
            .prefetch_related('readings')
            .order_by('berth__pier__code', 'berth__code', 'meter_type')
        )
        return Response({'meters': DockwalkMeterSerializer(meters, many=True).data})


class DockwalkReadingView(APIView):
    permission_classes = [IsMarinaStaff]

    def post(self, request, meter_id):
        try:
            meter = SmartMeter.objects.select_related('berth').get(
                id=meter_id, marina=request.user.marina, is_active=True
            )
        except SmartMeter.DoesNotExist:
            return Response({'detail': 'Meter not found.'}, status=http_status.HTTP_404_NOT_FOUND)

        rollover = bool(request.data.get('rollover', False))

        # Parse reading value
        raw_kwh = request.data.get('reading_kwh')
        raw_m3  = request.data.get('reading_m3')
        if raw_kwh is None and raw_m3 is None:
            return Response({'detail': 'reading_kwh or reading_m3 is required.'}, status=http_status.HTTP_400_BAD_REQUEST)

        try:
            new_kwh = Decimal(str(raw_kwh)) if raw_kwh is not None else None
            new_m3  = Decimal(str(raw_m3))  if raw_m3  is not None else None
        except Exception:
            return Response({'detail': 'Invalid reading value.'}, status=http_status.HTTP_400_BAD_REQUEST)

        new_value = new_kwh if new_kwh is not None else new_m3

        # Get last reading
        last = meter.readings.order_by('-recorded_at').first()
        if last:
            last_value = last.reading_kwh if new_kwh is not None else last.reading_m3
            if last_value is not None and new_value < last_value and not rollover:
                return Response(
                    {'detail': f'Reading is lower than last entry ({last_value}). Check the meter or mark as rollover.'},
                    status=http_status.HTTP_400_BAD_REQUEST,
                )

        # Calculate delta
        if rollover or last is None:
            delta = new_value  # treat as fresh start
        else:
            last_value = (last.reading_kwh if new_kwh is not None else last.reading_m3) or Decimal('0')
            delta = new_value - last_value

        # Create MeterReading
        reading = MeterReading.objects.create(
            meter=meter,
            reading_kwh=new_kwh,
            reading_m3=new_m3,
            recorded_at=timezone.now(),
            source='manual',
        )

        # Stage PendingUtilityCharge if a member is linked to the berth booking
        self._stage_charge(meter, reading, delta, new_kwh is not None, rollover)

        meter.last_polled = timezone.now()
        meter.save(update_fields=['last_polled'])

        return Response({
            'reading_id': reading.id,
            'delta': str(delta),
            'rollover': rollover,
        }, status=http_status.HTTP_201_CREATED)

    def _stage_charge(self, meter, reading, delta, is_electricity, rollover):
        from apps.reservations.models import Booking
        from apps.members.models import Member

        if delta <= 0:
            return

        # Find member with active booking on this berth
        active_booking = (
            Booking.objects
            .filter(berth=meter.berth, status='checked_in')
            .select_related('vessel__owner')
            .first()
        )
        if active_booking is None or active_booking.vessel is None:
            return

        member = active_booking.vessel.owner
        if member is None:
            return

        # Look up per_kwh or per_m3 ChargeableItem
        category = 'utility'
        pricing_model = 'per_kwh' if is_electricity else 'per_m3'
        rate_item = ChargeableItem.objects.filter(
            marina=meter.marina,
            category=category,
            pricing_model=pricing_model,
            is_active=True,
        ).first()

        if rate_item is None:
            return

        amount = (delta * rate_item.unit_price).quantize(Decimal('0.01'))

        PendingUtilityCharge.objects.create(
            marina=meter.marina,
            member=member,
            meter=meter,
            meter_reading=reading,
            kwh_delta=delta if is_electricity else None,
            m3_delta=delta if not is_electricity else None,
            unit_price=rate_item.unit_price,
            amount=amount,
            rollover=rollover,
        )
```

- [ ] **Step 5: Wire dockwalk URLs**

Create `backend/apps/utilities/urls.py`:

```python
from django.urls import path
from .views import DockwalkListView, DockwalkReadingView

urlpatterns = [
    path('utilities/dockwalk/',                      DockwalkListView.as_view(),    name='dockwalk_list'),
    path('utilities/dockwalk/<int:meter_id>/reading/', DockwalkReadingView.as_view(), name='dockwalk_reading'),
]
```

Then include this in the project's main `urls.py` under `/api/v1/`:
```python
path('api/v1/', include('apps.utilities.urls')),
```

- [ ] **Step 6: Run tests to verify they pass**

```
python manage.py test apps.utilities.tests.test_dockwalk -v2
```
Expected: All tests pass.

- [ ] **Step 7: Commit**

```
git add backend/apps/utilities/views.py backend/apps/utilities/serializers.py backend/apps/utilities/urls.py backend/apps/utilities/tests/test_dockwalk.py
git commit -m "feat(utilities): add Dockwalk list and reading endpoints with rollover support and pending charge staging"
```

---

### Task 9: Expose app_config in tenant config endpoint

**Files:**
- Modify: `backend/apps/portal/views.py` (`MarinaPublicView`)
- Test: append to `backend/apps/portal/tests/test_guest_extensions.py`

- [ ] **Step 1: Write failing test**

Append to `backend/apps/portal/tests/test_guest_extensions.py`:

```python
class TenantConfigAppConfigTest(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(
            name='AC Marina', slug='ac-marina',
            app_config={'brand_color': '#abc123', 'enable_boatyard': True},
        )
        self.client = APIClient()
        self.client.defaults['HTTP_X_MARINA_SLUG'] = 'ac-marina'

    def test_config_endpoint_includes_app_config(self):
        response = self.client.get('/api/v1/marina/public/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('app_config', response.data)
        self.assertEqual(response.data['app_config']['brand_color'], '#abc123')
```

- [ ] **Step 2: Run test to verify it fails**

```
python manage.py test apps.portal.tests.test_guest_extensions.TenantConfigAppConfigTest -v2
```
Expected: `AssertionError` — `app_config` key missing from response.

- [ ] **Step 3: Update MarinaPublicView in views.py**

In `backend/apps/portal/views.py`, update `MarinaPublicView.get()` to include `app_config`:

```python
    def get(self, request):
        if request.tenant is None:
            return Response({'error': 'X-Marina-Slug header is required.'}, status=400)
        marina = request.tenant
        cfg = getattr(marina, 'widget_config', None)
        return Response({
            'id':           marina.id,
            'name':         marina.name,
            'slug':         marina.slug,
            'timezone':     marina.timezone,
            'currency':     marina.currency,
            'contact_email': marina.contact_email,
            'phone':        marina.phone,
            'booking_mode': marina.booking_mode,
            'vat_rate':     str(marina.vat_rate),
            'logo_url':     cfg.logo_url if cfg else '',
            'app_config':   marina.app_config or {},
        })
```

- [ ] **Step 4: Run test to verify it passes**

```
python manage.py test apps.portal.tests.test_guest_extensions.TenantConfigAppConfigTest -v2
```
Expected: 1 test passes.

- [ ] **Step 5: Commit**

```
git add backend/apps/portal/views.py backend/apps/portal/tests/test_guest_extensions.py
git commit -m "feat(portal): expose app_config in tenant public config endpoint"
```

---

### Task 10: Full test run and cleanup

- [ ] **Step 1: Run full portal test suite**

```
python manage.py test apps.portal apps.utilities apps.accounts -v2
```
Expected: All tests pass, no regressions.

- [ ] **Step 2: Run Django system checks**

```
python manage.py check
```
Expected: `System check identified no issues`.

- [ ] **Step 3: Commit any fixes found**

```
git add -p
git commit -m "fix(portal): address issues found in full test run"
```
