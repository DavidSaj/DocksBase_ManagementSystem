# Utility Meter Setup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-05-14-utility-meter-setup-design.md`

**Goal:** Ship a manager-facing UI on `frontend/src/screens/Utilities.jsx` ("Meters" tab) that lets marina managers configure utility meter integrations via three paths (vendor-pull, push webhook, direct device push). All three paths are functional end-to-end. Credentials are hashed at rest. Reading ingest is bulk-create with `ignore_conflicts`. Auth-tracking writes are throttled to once per hour.

**Architecture:** New Django models for hashed webhook keys + per-meter device tokens, four new DRF views (CRUD + key management + two ingest endpoints), two new DRF authentication classes that verify hashed credentials and throttle `last_used_at` writes, and a four-panel React UI nested under the existing Utilities screen. The unique constraint on `MeterReading(meter, recorded_at)` lets us use `bulk_create(ignore_conflicts=True)` for idempotent ingest.

**Tech Stack:** Django 5 + DRF, React 18 (JSX), `django.contrib.auth.hashers.make_password/check_password`, `secrets.token_urlsafe`, `pytest` / Django `TestCase`. No new dependencies.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/apps/utilities/models.py` | Modify | Add `MarinaMeterWebhookKey`; add `hardware_id`, `device_token_prefix`, `device_token_hash`, `device_token_last_used_at` to `SmartMeter`; replace `MeterReading` index with `UniqueConstraint` |
| `backend/apps/utilities/migrations/0004_meter_setup.py` | Create | Auto-generated; docstring notes the pre-deploy dedup SQL |
| `backend/apps/utilities/authentication.py` | Modify | Add `MeterWebhookAuthentication`, `MeterDeviceAuthentication`, `_touch_last_used` helper |
| `backend/apps/utilities/serializers.py` | Modify | Add `credentials` (write-only) to `UtilityIntegrationSerializer`; add `MarinaMeterWebhookKeySerializer`, `DeviceTokenSerializer`, `ReadingIngestSerializer` |
| `backend/apps/utilities/views.py` | Modify | Add `UtilityIntegrationViewSet`, `MeterWebhookKeyView`, `MeterWebhookKeyRotateView`, `DeviceTokenView`, `WebhookReadingsView`, `DeviceReadingsView` |
| `backend/apps/utilities/urls.py` | Modify | Register integrations on router; add explicit paths for key + device-token + ingest endpoints |
| `backend/apps/utilities/vendors/base.py` | Modify | Add abstract `test_connection()` |
| `backend/apps/utilities/vendors/rolec.py` | Modify | Implement `test_connection()` |
| `backend/apps/utilities/vendors/marinesync.py` | Modify | Implement `test_connection()` |
| `backend/apps/utilities/tests/test_meter_setup.py` | Create | Full test suite |
| `frontend/src/screens/Utilities.jsx` | Modify | Add "Meters" as first tab; extract shared helpers to `_shared.jsx` |
| `frontend/src/screens/utilities/_shared.jsx` | Create | `Badge`, `Spinner`, `EmptyState`, `ErrorMsg`, `SuccessMsg` |
| `frontend/src/screens/utilities/MetersTab.jsx` | Create | Sub-tab bar + panel switch |
| `frontend/src/screens/utilities/RevealOnceModal.jsx` | Create | Shared one-time-reveal modal for plaintext credentials |
| `frontend/src/screens/utilities/IntegrationsPanel.jsx` | Create | Integrations list + add/edit modal + Test action |
| `frontend/src/screens/utilities/PushEndpointPanel.jsx` | Create | Webhook key display + Generate/Rotate/Revoke |
| `frontend/src/screens/utilities/DeviceTokensPanel.jsx` | Create | Per-meter token list + Generate/Rotate/Revoke |
| `frontend/src/screens/utilities/MetersListPanel.jsx` | Create | SmartMeter CRUD table |

---

## Task 1: Models — `MarinaMeterWebhookKey` + `SmartMeter` token fields + `MeterReading` unique constraint

**Files:**
- Modify: `backend/apps/utilities/models.py`

- [ ] **Step 1: Add `MarinaMeterWebhookKey`**

Append to the end of `backend/apps/utilities/models.py`:

```python
# ---------------------------------------------------------------------------
# MarinaMeterWebhookKey — one rotatable key per marina (hashed at rest)
# ---------------------------------------------------------------------------

class MarinaMeterWebhookKey(models.Model):
    """
    One webhook key per marina, used by external systems to POST readings
    to /utilities/webhook/readings/.

    Stored as `key_prefix` (plaintext, used for fast lookup + UI display) +
    `key_hash` (Django-hashed full plaintext). Plaintext is returned to the
    manager exactly once, when generated/rotated. There is no way to recover
    it later — the manager must rotate.
    """

    PREFIX_LEN = 11  # "sk_" + 8 random chars

    marina       = models.OneToOneField(
        'accounts.Marina', on_delete=models.CASCADE, related_name='meter_webhook_key'
    )
    key_prefix   = models.CharField(max_length=16, db_index=True, blank=True)
    key_hash     = models.CharField(max_length=128, blank=True)
    is_active    = models.BooleanField(default=True)
    created_at   = models.DateTimeField(auto_now_add=True)
    rotated_at   = models.DateTimeField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return f'Webhook key — {self.marina} ({self.key_prefix or "unissued"})'
```

- [ ] **Step 2: Add four fields to `SmartMeter`**

In `class SmartMeter(models.Model)` (`models.py:43`), after the existing `is_online` field add:

```python
    hardware_id               = models.CharField(max_length=64, blank=True, db_index=True,
                                                 help_text='Public identifier the device sends in X-Hardware-ID')
    device_token_prefix       = models.CharField(max_length=16, blank=True, db_index=True)
    device_token_hash         = models.CharField(max_length=128, blank=True)
    device_token_last_used_at = models.DateTimeField(null=True, blank=True)
```

- [ ] **Step 3: Replace `MeterReading.Meta` index with unique constraint**

In `class MeterReading(models.Model)` (`models.py:75`), change the `Meta` class to:

```python
    class Meta:
        ordering = ['recorded_at']
        constraints = [
            models.UniqueConstraint(
                fields=['meter', 'recorded_at'],
                name='utilities_meterreading_meter_recorded_uniq',
            ),
        ]
```

Delete the existing `indexes = [...]` line — the unique constraint serves as the covering index.

- [ ] **Step 4: Generate the migration**

```bash
cd backend
python manage.py makemigrations utilities --name meter_setup
```

Expected: creates `apps/utilities/migrations/0004_meter_setup.py` with `CreateModel(MarinaMeterWebhookKey)`, four `AddField` operations on `SmartMeter`, `RemoveIndex`, and `AddConstraint`.

- [ ] **Step 5: Add a docstring to the migration file** (warning operators about pre-existing duplicates)

Open `apps/utilities/migrations/0004_meter_setup.py` and insert at the top of the `Migration` class:

```python
class Migration(migrations.Migration):
    """
    Adds MarinaMeterWebhookKey + hashed device-token fields on SmartMeter,
    and converts MeterReading.(meter, recorded_at) to a unique constraint
    so the new bulk ingest endpoints can use bulk_create(ignore_conflicts=True).

    PRE-DEPLOY CHECK — run this on every production DB before applying:

        SELECT meter_id, recorded_at, count(*)
        FROM utilities_meterreading
        GROUP BY meter_id, recorded_at HAVING count(*) > 1;

    If any rows are returned, dedupe them before migrating (the unique
    constraint will otherwise fail).
    """
```

- [ ] **Step 6: Apply the migration locally**

```bash
cd backend
python manage.py migrate utilities
```

Expected: `Applying utilities.0004_meter_setup... OK`.

- [ ] **Step 7: Commit**

```bash
git add apps/utilities/models.py apps/utilities/migrations/0004_meter_setup.py
git commit -m "feat(utilities): add MarinaMeterWebhookKey, hashed device tokens, MeterReading uniq constraint"
```

---

## Task 2: Vendor `test_connection`

**Files:**
- Modify: `backend/apps/utilities/vendors/base.py`
- Modify: `backend/apps/utilities/vendors/rolec.py`
- Modify: `backend/apps/utilities/vendors/marinesync.py`

- [ ] **Step 1: Add the abstract method**

In `backend/apps/utilities/vendors/base.py`, inside `BaseMeterVendor` (after `fetch_readings_bulk`):

```python
    @abstractmethod
    def test_connection(self) -> None:
        """Raises VendorConnectionError if the configured credentials are invalid."""
        ...
```

- [ ] **Step 2: Implement on Rolec**

In `backend/apps/utilities/vendors/rolec.py`, add a method to `RolecAdapter`:

```python
    def test_connection(self) -> None:
        import requests
        try:
            resp = requests.get(
                f'{self.base_url.rstrip("/")}/v1/sites/',
                headers={'Authorization': f'Bearer {self.api_key}'},
                params={'limit': 1},
                timeout=10,
            )
        except requests.RequestException as e:
            raise VendorConnectionError(f'Rolec API unreachable: {e}')
        if not resp.ok:
            raise VendorConnectionError(
                f'Rolec API returned {resp.status_code}: {resp.text[:200]}'
            )
```

Make sure `VendorConnectionError` is imported at the top: `from .base import BaseMeterVendor, VendorConnectionError, VendorReading`.

- [ ] **Step 3: Implement on MarineSync**

Same shape in `backend/apps/utilities/vendors/marinesync.py`:

```python
    def test_connection(self) -> None:
        import requests
        try:
            resp = requests.get(
                f'{self.base_url.rstrip("/")}/api/account',
                headers={'X-API-Key': self.api_key},
                timeout=10,
            )
        except requests.RequestException as e:
            raise VendorConnectionError(f'MarineSync API unreachable: {e}')
        if not resp.ok:
            raise VendorConnectionError(
                f'MarineSync API returned {resp.status_code}: {resp.text[:200]}'
            )
```

- [ ] **Step 4: Smoke check**

```bash
cd backend
python manage.py check
```

Expected: `System check identified no issues.`

- [ ] **Step 5: Commit**

```bash
git add apps/utilities/vendors/
git commit -m "feat(utilities): vendors implement test_connection()"
```

---

## Task 3: Authentication classes

**Files:**
- Modify: `backend/apps/utilities/authentication.py`

- [ ] **Step 1: Add the shared helper + the two auth classes**

Replace the file with (or append to — file currently only has `ForkliftDeviceTokenAuthentication`):

```python
from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from django.contrib.auth.hashers import check_password
from django.utils import timezone


# Existing ForkliftDeviceTokenAuthentication stays here, unchanged.
# ... (keep existing code) ...


def _touch_last_used(model, pk, current, field='last_used_at'):
    """
    Throttle last-used-at updates to once per hour to avoid write contention
    on configuration tables under IoT load.
    """
    now = timezone.now()
    if current is None or (now - current).total_seconds() > 3600:
        model.objects.filter(pk=pk).update(**{field: now})


class MeterWebhookAuthentication(BaseAuthentication):
    """
    Authenticates requests bearing an X-Webhook-Key header.
    Lookup is O(1) via the indexed plaintext prefix; verification is
    constant-time via Django's password hashers.
    Returns (None, key_row); request.auth.marina gives the marina.
    """

    def authenticate(self, request):
        plaintext = request.headers.get('X-Webhook-Key')
        if not plaintext:
            return None

        from apps.utilities.models import MarinaMeterWebhookKey

        prefix = plaintext[:MarinaMeterWebhookKey.PREFIX_LEN]
        try:
            row = MarinaMeterWebhookKey.objects.select_related('marina').get(
                key_prefix=prefix, is_active=True,
            )
        except MarinaMeterWebhookKey.DoesNotExist:
            raise AuthenticationFailed('Invalid webhook key.')

        if not row.key_hash or not check_password(plaintext, row.key_hash):
            raise AuthenticationFailed('Invalid webhook key.')

        _touch_last_used(MarinaMeterWebhookKey, row.pk, row.last_used_at)
        return (None, row)

    def authenticate_header(self, request):
        return 'X-Webhook-Key'


class MeterDeviceAuthentication(BaseAuthentication):
    """
    Authenticates requests from a single meter via X-Hardware-ID + X-Device-Token.
    Returns (None, smart_meter); request.auth.marina gives the marina.
    """

    def authenticate(self, request):
        hardware_id = request.headers.get('X-Hardware-ID')
        plaintext   = request.headers.get('X-Device-Token')
        if not hardware_id or not plaintext:
            return None

        from apps.utilities.models import SmartMeter

        try:
            meter = SmartMeter.objects.select_related('marina').get(
                hardware_id=hardware_id, is_active=True,
            )
        except SmartMeter.DoesNotExist:
            raise AuthenticationFailed('Invalid device credentials.')

        if not meter.device_token_hash or not check_password(plaintext, meter.device_token_hash):
            raise AuthenticationFailed('Invalid device credentials.')

        _touch_last_used(SmartMeter, meter.pk, meter.device_token_last_used_at,
                         field='device_token_last_used_at')
        return (None, meter)

    def authenticate_header(self, request):
        return 'X-Hardware-ID, X-Device-Token'
```

- [ ] **Step 2: Smoke check**

```bash
cd backend
python -c "from apps.utilities.authentication import MeterWebhookAuthentication, MeterDeviceAuthentication, _touch_last_used; print('ok')"
```

Expected: `ok`.

- [ ] **Step 3: Commit**

```bash
git add apps/utilities/authentication.py
git commit -m "feat(utilities): meter webhook + device auth with hashed creds and throttled last_used_at"
```

---

## Task 4: Serializers

**Files:**
- Modify: `backend/apps/utilities/serializers.py`

- [ ] **Step 1: Extend `UtilityIntegrationSerializer` to accept `credentials` as write-only**

Replace the existing `UtilityIntegrationSerializer` class (`serializers.py:30`) with:

```python
class UtilityIntegrationSerializer(serializers.ModelSerializer):
    credentials = serializers.JSONField(write_only=True, required=False)

    class Meta:
        model  = UtilityIntegration
        fields = [
            'id', 'marina', 'vendor', 'credentials', 'is_active',
            'last_sync_at', 'last_sync_ok', 'last_sync_error',
        ]
        read_only_fields = ['marina', 'last_sync_at', 'last_sync_ok', 'last_sync_error']

    def validate_credentials(self, value):
        if not isinstance(value, dict):
            raise serializers.ValidationError('credentials must be a JSON object.')
        if 'api_key' not in value or not value['api_key']:
            raise serializers.ValidationError('credentials.api_key is required.')
        return value
```

- [ ] **Step 2: Add `MarinaMeterWebhookKeySerializer`**

Append to `serializers.py`:

```python
from apps.utilities.models import MarinaMeterWebhookKey


class MarinaMeterWebhookKeySerializer(serializers.ModelSerializer):
    """
    Read-only public view of the key. The plaintext is NEVER serialized here —
    it is only returned by the rotate view, as a sibling top-level field.
    """
    endpoint_url = serializers.SerializerMethodField()
    status       = serializers.SerializerMethodField()

    class Meta:
        model  = MarinaMeterWebhookKey
        fields = ['key_prefix', 'is_active', 'created_at', 'rotated_at',
                  'last_used_at', 'endpoint_url', 'status']
        read_only_fields = fields

    def get_endpoint_url(self, obj):
        request = self.context.get('request')
        if request is None:
            return '/api/v1/utilities/webhook/readings/'
        return request.build_absolute_uri('/api/v1/utilities/webhook/readings/')

    def get_status(self, obj):
        if not obj.key_hash:
            return 'unissued'
        return 'active' if obj.is_active else 'revoked'
```

- [ ] **Step 3: Add ingest envelope validator**

Append to `serializers.py`:

```python
class ReadingIngestItemSerializer(serializers.Serializer):
    device_id      = serializers.CharField(required=False, allow_blank=True)
    recorded_at    = serializers.DateTimeField()
    cumulative_kwh = serializers.DecimalField(max_digits=12, decimal_places=3,
                                              required=False, allow_null=True)
    cumulative_m3  = serializers.DecimalField(max_digits=12, decimal_places=3,
                                              required=False, allow_null=True)

    def validate(self, attrs):
        if attrs.get('cumulative_kwh') is None and attrs.get('cumulative_m3') is None:
            raise serializers.ValidationError('At least one of cumulative_kwh / cumulative_m3 is required.')
        return attrs


class ReadingIngestSerializer(serializers.Serializer):
    readings = ReadingIngestItemSerializer(many=True)

    def validate_readings(self, value):
        if not value:
            raise serializers.ValidationError('readings[] must contain at least one entry.')
        if len(value) > 5000:
            raise serializers.ValidationError('Maximum 5000 readings per request.')
        return value
```

- [ ] **Step 4: Smoke check**

```bash
cd backend
python -c "from apps.utilities.serializers import UtilityIntegrationSerializer, MarinaMeterWebhookKeySerializer, ReadingIngestSerializer; print('ok')"
```

Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add apps/utilities/serializers.py
git commit -m "feat(utilities): serializers for integrations, webhook key, ingest envelope"
```

---

## Task 5: Tests — write the full suite BEFORE views (TDD)

**Files:**
- Create: `backend/apps/utilities/tests/test_meter_setup.py`

- [ ] **Step 1: Write the test file**

Create `backend/apps/utilities/tests/test_meter_setup.py`:

```python
from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth.hashers import make_password
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from apps.accounts.models import Marina, User
from apps.utilities.models import (
    MarinaMeterWebhookKey, MeterReading, SmartMeter, UtilityIntegration,
)


class _Base(TestCase):
    def setUp(self):
        self.marina       = Marina.objects.create(name='Test Marina')
        self.other_marina = Marina.objects.create(name='Other Marina')
        self.user = User.objects.create_user(
            email='staff@test.com', password='pass', marina=self.marina, role='manager',
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)


class IntegrationCrudTests(_Base):
    def test_list_scoped_to_user_marina(self):
        UtilityIntegration.objects.create(marina=self.marina,       vendor='rolec',
                                          credentials={'api_key': 'a'})
        UtilityIntegration.objects.create(marina=self.other_marina, vendor='rolec',
                                          credentials={'api_key': 'b'})
        r = self.client.get('/api/v1/utilities/integrations/')
        self.assertEqual(r.status_code, 200)
        rows = r.json().get('results', r.json())
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['vendor'], 'rolec')

    def test_cannot_access_other_marina_integration(self):
        other = UtilityIntegration.objects.create(
            marina=self.other_marina, vendor='rolec', credentials={'api_key': 'b'},
        )
        r = self.client.get(f'/api/v1/utilities/integrations/{other.pk}/')
        self.assertEqual(r.status_code, 404)

    def test_create_persists_credentials_but_omits_from_response(self):
        r = self.client.post('/api/v1/utilities/integrations/', {
            'vendor': 'rolec',
            'credentials': {'api_key': 'secret', 'base_url': 'https://api.rolec.test'},
        }, format='json')
        self.assertEqual(r.status_code, 201)
        self.assertNotIn('credentials', r.json())
        row = UtilityIntegration.objects.get(pk=r.json()['id'])
        self.assertEqual(row.credentials['api_key'], 'secret')

    @patch('apps.utilities.views.get_vendor_adapter')
    def test_test_action_success(self, mock_factory):
        mock_factory.return_value.test_connection.return_value = None
        i = UtilityIntegration.objects.create(marina=self.marina, vendor='rolec',
                                              credentials={'api_key': 'a'})
        r = self.client.post(f'/api/v1/utilities/integrations/{i.pk}/test/')
        self.assertEqual(r.status_code, 200)
        self.assertTrue(r.json()['ok'])

    @patch('apps.utilities.views.get_vendor_adapter')
    def test_test_action_failure(self, mock_factory):
        from apps.utilities.vendors.base import VendorConnectionError
        mock_factory.return_value.test_connection.side_effect = VendorConnectionError('401: bad token')
        i = UtilityIntegration.objects.create(marina=self.marina, vendor='rolec',
                                              credentials={'api_key': 'a'})
        r = self.client.post(f'/api/v1/utilities/integrations/{i.pk}/test/')
        self.assertEqual(r.status_code, 200)
        self.assertFalse(r.json()['ok'])
        self.assertIn('401', r.json()['error'])


class WebhookKeyTests(_Base):
    def test_get_when_unissued(self):
        r = self.client.get('/api/v1/utilities/webhook-key/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['status'], 'unissued')
        self.assertEqual(r.json()['key_prefix'], '')
        self.assertTrue(r.json()['endpoint_url'].endswith('/utilities/webhook/readings/'))

    def test_rotate_returns_plaintext_once(self):
        r = self.client.post('/api/v1/utilities/webhook-key/rotate/')
        self.assertEqual(r.status_code, 200)
        plaintext = r.json()['key']
        self.assertTrue(plaintext.startswith('sk_'))
        self.assertGreater(len(plaintext), 40)

        # second GET must NOT include the plaintext
        r2 = self.client.get('/api/v1/utilities/webhook-key/')
        self.assertNotIn('key', r2.json())
        self.assertEqual(r2.json()['status'], 'active')

    def test_rotate_replaces_previous_key(self):
        r1 = self.client.post('/api/v1/utilities/webhook-key/rotate/')
        old_plain = r1.json()['key']
        r2 = self.client.post('/api/v1/utilities/webhook-key/rotate/')
        new_plain = r2.json()['key']
        self.assertNotEqual(old_plain, new_plain)

        # old key no longer authenticates
        ingest = self.client.post(
            '/api/v1/utilities/webhook/readings/',
            {'readings': []},
            format='json',
            HTTP_X_WEBHOOK_KEY=old_plain,
        )
        self.assertEqual(ingest.status_code, 401)

    def test_revoke(self):
        self.client.post('/api/v1/utilities/webhook-key/rotate/')
        r = self.client.delete('/api/v1/utilities/webhook-key/')
        self.assertEqual(r.status_code, 204)
        self.assertEqual(
            MarinaMeterWebhookKey.objects.get(marina=self.marina).key_hash, ''
        )


class WebhookIngestTests(_Base):
    def setUp(self):
        super().setUp()
        self.client.post('/api/v1/utilities/webhook-key/rotate/')
        self.key = MarinaMeterWebhookKey.objects.get(marina=self.marina)
        # Re-rotate to capture plaintext (the previous response is lost; use a fresh one)
        rot = self.client.post('/api/v1/utilities/webhook-key/rotate/')
        self.plaintext = rot.json()['key']

        self.meter = SmartMeter.objects.create(
            marina=self.marina, vendor='rolec', meter_type='electricity',
            device_id='ROLEC-1', label='Berth 1',
        )
        self.client.credentials()  # drop JWT — ingest must work without it

    def _post(self, payload, key=None):
        return self.client.post(
            '/api/v1/utilities/webhook/readings/',
            payload, format='json',
            HTTP_X_WEBHOOK_KEY=key or self.plaintext,
        )

    def test_happy_path(self):
        r = self._post({'readings': [{
            'device_id': 'ROLEC-1',
            'recorded_at': '2026-05-14T10:00:00Z',
            'cumulative_kwh': '123.456',
        }]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['accepted'], 1)
        self.assertEqual(r.json()['rejected'], [])
        self.assertEqual(MeterReading.objects.count(), 1)

    def test_unknown_device_rejected(self):
        r = self._post({'readings': [{
            'device_id': 'NOPE',
            'recorded_at': '2026-05-14T10:00:00Z',
            'cumulative_kwh': '1.0',
        }]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()['accepted'], 0)
        self.assertEqual(r.json()['rejected'][0]['device_id'], 'NOPE')

    def test_duplicate_silently_deduped(self):
        body = {'readings': [{'device_id': 'ROLEC-1',
                              'recorded_at': '2026-05-14T10:00:00Z',
                              'cumulative_kwh': '1.0'}]}
        self._post(body)
        self._post(body)
        self.assertEqual(MeterReading.objects.count(), 1)

    def test_missing_header_returns_401(self):
        r = self.client.post('/api/v1/utilities/webhook/readings/', {'readings': []},
                             format='json')
        self.assertEqual(r.status_code, 401)

    def test_bad_key_returns_401(self):
        r = self._post({'readings': []}, key='sk_aaaaaaaa_wrong')
        self.assertEqual(r.status_code, 401)


class DeviceTokenTests(_Base):
    def setUp(self):
        super().setUp()
        self.meter = SmartMeter.objects.create(
            marina=self.marina, vendor='rolec', meter_type='electricity',
            device_id='DEV-1', label='Direct Meter',
        )

    def test_generate(self):
        r = self.client.post(f'/api/v1/utilities/smart-meters/{self.meter.pk}/device-token/')
        self.assertEqual(r.status_code, 200)
        self.assertIn('hardware_id', r.json())
        self.assertIn('device_token', r.json())
        self.meter.refresh_from_db()
        self.assertNotEqual(self.meter.hardware_id, '')
        self.assertNotEqual(self.meter.device_token_hash, '')

    def test_rotate_changes_token(self):
        r1 = self.client.post(f'/api/v1/utilities/smart-meters/{self.meter.pk}/device-token/')
        first = r1.json()['device_token']
        r2 = self.client.post(f'/api/v1/utilities/smart-meters/{self.meter.pk}/device-token/')
        self.assertNotEqual(first, r2.json()['device_token'])

    def test_revoke(self):
        self.client.post(f'/api/v1/utilities/smart-meters/{self.meter.pk}/device-token/')
        r = self.client.delete(f'/api/v1/utilities/smart-meters/{self.meter.pk}/device-token/')
        self.assertEqual(r.status_code, 204)
        self.meter.refresh_from_db()
        self.assertEqual(self.meter.hardware_id, '')
        self.assertEqual(self.meter.device_token_hash, '')


class DeviceIngestTests(_Base):
    def setUp(self):
        super().setUp()
        self.meter = SmartMeter.objects.create(
            marina=self.marina, vendor='rolec', meter_type='electricity',
            device_id='DEV-1', label='Direct Meter',
        )
        r = self.client.post(f'/api/v1/utilities/smart-meters/{self.meter.pk}/device-token/')
        self.hw    = r.json()['hardware_id']
        self.token = r.json()['device_token']
        self.client.credentials()

    def _post(self, payload, hw=None, token=None):
        return self.client.post(
            '/api/v1/utilities/devices/readings/',
            payload, format='json',
            HTTP_X_HARDWARE_ID=hw or self.hw,
            HTTP_X_DEVICE_TOKEN=token or self.token,
        )

    def test_happy_path(self):
        r = self._post({'readings': [{
            'recorded_at': '2026-05-14T10:00:00Z',
            'cumulative_kwh': '5.0',
        }]})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(MeterReading.objects.filter(meter=self.meter).count(), 1)

    def test_missing_token_returns_401(self):
        r = self.client.post('/api/v1/utilities/devices/readings/',
                             {'readings': []}, format='json',
                             HTTP_X_HARDWARE_ID=self.hw)
        self.assertEqual(r.status_code, 401)

    def test_wrong_token_returns_401(self):
        r = self._post({'readings': []}, token='sk_wrongwrong_zzzzzz')
        self.assertEqual(r.status_code, 401)

    def test_inactive_meter_returns_401(self):
        SmartMeter.objects.filter(pk=self.meter.pk).update(is_active=False)
        r = self._post({'readings': []})
        self.assertEqual(r.status_code, 401)


class LastUsedThrottleTests(_Base):
    def test_second_auth_within_hour_does_not_update(self):
        rot = self.client.post('/api/v1/utilities/webhook-key/rotate/')
        plaintext = rot.json()['key']
        self.client.credentials()

        self.client.post('/api/v1/utilities/webhook/readings/',
                         {'readings': []}, format='json',
                         HTTP_X_WEBHOOK_KEY=plaintext)
        row = MarinaMeterWebhookKey.objects.get(marina=self.marina)
        first = row.last_used_at
        self.assertIsNotNone(first)

        # Second auth a few ms later — must not bump
        self.client.post('/api/v1/utilities/webhook/readings/',
                         {'readings': []}, format='json',
                         HTTP_X_WEBHOOK_KEY=plaintext)
        row.refresh_from_db()
        self.assertEqual(row.last_used_at, first)

    def test_auth_after_an_hour_updates(self):
        rot = self.client.post('/api/v1/utilities/webhook-key/rotate/')
        plaintext = rot.json()['key']
        self.client.credentials()

        self.client.post('/api/v1/utilities/webhook/readings/',
                         {'readings': []}, format='json',
                         HTTP_X_WEBHOOK_KEY=plaintext)
        # Backdate
        MarinaMeterWebhookKey.objects.filter(marina=self.marina).update(
            last_used_at=timezone.now() - timedelta(hours=2),
        )
        self.client.post('/api/v1/utilities/webhook/readings/',
                         {'readings': []}, format='json',
                         HTTP_X_WEBHOOK_KEY=plaintext)
        row = MarinaMeterWebhookKey.objects.get(marina=self.marina)
        self.assertGreater(row.last_used_at, timezone.now() - timedelta(seconds=5))
```

Also create `backend/apps/utilities/tests/__init__.py` if it doesn't exist (empty file).

- [ ] **Step 2: Run the tests — they must all fail (no endpoints exist yet)**

```bash
cd backend
python -m pytest apps/utilities/tests/test_meter_setup.py -v
```

Expected: every test fails with 404 or import errors. This confirms the TDD baseline.

- [ ] **Step 3: Commit**

```bash
git add apps/utilities/tests/test_meter_setup.py apps/utilities/tests/__init__.py
git commit -m "test(utilities): failing tests for meter setup CRUD, ingest, key/token lifecycle, throttling"
```

---

## Task 6: View — `UtilityIntegrationViewSet` + `/integrations/{id}/test/`

**Files:**
- Modify: `backend/apps/utilities/views.py`

- [ ] **Step 1: Add the imports + viewset**

At the top of `views.py`, add (if absent):

```python
import secrets
from django.contrib.auth.hashers import make_password
from apps.utilities.models import MarinaMeterWebhookKey, UtilityIntegration
from apps.utilities.serializers import (
    MarinaMeterWebhookKeySerializer,
    ReadingIngestSerializer,
    UtilityIntegrationSerializer,
)
from apps.utilities.vendors.base import VendorConnectionError, get_vendor_adapter
from apps.utilities.authentication import (
    MeterDeviceAuthentication, MeterWebhookAuthentication,
)
```

After `SmartMeterViewSet`, insert:

```python
class UtilityIntegrationViewSet(viewsets.ModelViewSet):
    serializer_class   = UtilityIntegrationSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return UtilityIntegration.objects.filter(marina=_marina(self.request))

    def perform_create(self, serializer):
        serializer.save(marina=_marina(self.request))

    @action(detail=True, methods=['post'], url_path='test')
    def test(self, request, pk=None):
        integration = self.get_object()
        try:
            adapter = get_vendor_adapter(integration.vendor, integration.marina_id)
            adapter.test_connection()
        except VendorConnectionError as e:
            return Response({'ok': False, 'error': str(e)})
        except Exception as e:
            return Response({'ok': False, 'error': f'Unexpected: {e}'})
        return Response({'ok': True})
```

- [ ] **Step 2: Run the integration CRUD tests**

```bash
cd backend
python -m pytest apps/utilities/tests/test_meter_setup.py::IntegrationCrudTests -v
```

Note: the URL conf in Task 11 wires this up. If the tests still fail with 404, that's fine — proceed to Task 11 and re-run.

- [ ] **Step 3: Commit**

```bash
git add apps/utilities/views.py
git commit -m "feat(utilities): UtilityIntegrationViewSet with test_connection action"
```

---

## Task 7: View — webhook key management

**Files:**
- Modify: `backend/apps/utilities/views.py`

- [ ] **Step 1: Add helper + two views**

After `UtilityIntegrationViewSet`, append:

```python
def _generate_key(prefix_len: int) -> tuple[str, str]:
    """Return (plaintext, hashed). Plaintext is sk_<base64>."""
    raw       = secrets.token_urlsafe(48)
    plaintext = f'sk_{raw}'
    return plaintext, make_password(plaintext)


class MeterWebhookKeyView(APIView):
    """
    GET    /api/v1/utilities/webhook-key/   Return prefix/status (no plaintext, ever).
    DELETE /api/v1/utilities/webhook-key/   Revoke — clears prefix + hash.
    """
    permission_classes = [IsAuthenticated]

    def _row(self, marina):
        row, _ = MarinaMeterWebhookKey.objects.get_or_create(marina=marina)
        return row

    def get(self, request):
        row = self._row(_marina(request))
        return Response(MarinaMeterWebhookKeySerializer(row, context={'request': request}).data)

    def delete(self, request):
        row = self._row(_marina(request))
        row.key_prefix = ''
        row.key_hash   = ''
        row.is_active  = False
        row.save(update_fields=['key_prefix', 'key_hash', 'is_active'])
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeterWebhookKeyRotateView(APIView):
    """
    POST /api/v1/utilities/webhook-key/rotate/
    Generate (or replace) the marina's webhook key. Plaintext returned ONCE.
    """
    permission_classes = [IsAuthenticated]

    def post(self, request):
        marina = _marina(request)
        row, _ = MarinaMeterWebhookKey.objects.get_or_create(marina=marina)

        plaintext, hashed = _generate_key(MarinaMeterWebhookKey.PREFIX_LEN)
        row.key_prefix = plaintext[:MarinaMeterWebhookKey.PREFIX_LEN]
        row.key_hash   = hashed
        row.is_active  = True
        row.rotated_at = timezone.now()
        row.save(update_fields=['key_prefix', 'key_hash', 'is_active', 'rotated_at'])

        data = MarinaMeterWebhookKeySerializer(row, context={'request': request}).data
        data['key'] = plaintext  # the one and only time it appears
        return Response(data)
```

- [ ] **Step 2: Commit**

```bash
git add apps/utilities/views.py
git commit -m "feat(utilities): webhook key issue/rotate/revoke endpoints (hashed at rest)"
```

---

## Task 8: View — device token management + revoke

**Files:**
- Modify: `backend/apps/utilities/views.py`

- [ ] **Step 1: Add the view**

Append to `views.py`:

```python
class DeviceTokenView(APIView):
    """
    POST   /api/v1/utilities/smart-meters/{pk}/device-token/   Issue or rotate.
    DELETE /api/v1/utilities/smart-meters/{pk}/device-token/   Revoke.

    Plaintext token is returned ONCE on POST. Hardware ID is auto-generated
    on first issue and reused on rotate (the device's identity is stable).
    """
    permission_classes = [IsAuthenticated]

    def _meter(self, request, pk):
        try:
            return SmartMeter.objects.get(pk=pk, marina=_marina(request))
        except SmartMeter.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound()

    def post(self, request, pk):
        meter = self._meter(request, pk)
        if not meter.hardware_id:
            meter.hardware_id = f'hw_{secrets.token_urlsafe(16)}'
        plaintext, hashed = _generate_key(prefix_len=11)
        meter.device_token_prefix = plaintext[:11]
        meter.device_token_hash   = hashed
        meter.save(update_fields=['hardware_id', 'device_token_prefix', 'device_token_hash'])
        return Response({'hardware_id': meter.hardware_id, 'device_token': plaintext})

    def delete(self, request, pk):
        meter = self._meter(request, pk)
        meter.hardware_id               = ''
        meter.device_token_prefix       = ''
        meter.device_token_hash         = ''
        meter.device_token_last_used_at = None
        meter.save(update_fields=[
            'hardware_id', 'device_token_prefix', 'device_token_hash',
            'device_token_last_used_at',
        ])
        return Response(status=status.HTTP_204_NO_CONTENT)
```

- [ ] **Step 2: Commit**

```bash
git add apps/utilities/views.py
git commit -m "feat(utilities): per-meter device token issue/rotate/revoke (hashed at rest)"
```

---

## Task 9: View — webhook readings ingest

**Files:**
- Modify: `backend/apps/utilities/views.py`

- [ ] **Step 1: Add the bulk ingest view**

Append:

```python
class WebhookReadingsView(APIView):
    """
    POST /api/v1/utilities/webhook/readings/
    Bulk ingest. Auth: X-Webhook-Key. Idempotent via bulk_create(ignore_conflicts).
    """
    authentication_classes = [MeterWebhookAuthentication]
    permission_classes     = []

    def post(self, request):
        marina = request.auth.marina

        serializer = ReadingIngestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        items = serializer.validated_data['readings']

        device_ids = {i.get('device_id') for i in items if i.get('device_id')}
        meters = {
            m.device_id: m for m in
            SmartMeter.objects.filter(marina=marina, device_id__in=device_ids,
                                      is_active=True)
        }

        rows, rejected = [], []
        for item in items:
            device_id = item.get('device_id') or ''
            meter = meters.get(device_id)
            if not meter:
                rejected.append({'device_id': device_id, 'reason': 'unknown'})
                continue
            rows.append(MeterReading(
                meter=meter,
                recorded_at=item['recorded_at'],
                reading_kwh=item.get('cumulative_kwh'),
                reading_m3=item.get('cumulative_m3'),
                source='auto',
            ))

        MeterReading.objects.bulk_create(rows, ignore_conflicts=True)
        return Response({'accepted': len(rows), 'rejected': rejected})
```

- [ ] **Step 2: Run the webhook ingest tests**

```bash
cd backend
python -m pytest apps/utilities/tests/test_meter_setup.py::WebhookIngestTests apps/utilities/tests/test_meter_setup.py::WebhookKeyTests -v
```

Expected (after Task 11 wires URLs): all pass.

- [ ] **Step 3: Commit**

```bash
git add apps/utilities/views.py
git commit -m "feat(utilities): webhook ingest with bulk_create(ignore_conflicts=True)"
```

---

## Task 10: View — device readings ingest

**Files:**
- Modify: `backend/apps/utilities/views.py`

- [ ] **Step 1: Add the device ingest view**

Append:

```python
class DeviceReadingsView(APIView):
    """
    POST /api/v1/utilities/devices/readings/
    Auth: X-Hardware-ID + X-Device-Token. The meter is fixed by auth;
    device_id in payload (if any) is ignored.
    """
    authentication_classes = [MeterDeviceAuthentication]
    permission_classes     = []

    def post(self, request):
        meter = request.auth  # a SmartMeter instance

        serializer = ReadingIngestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        items = serializer.validated_data['readings']

        rows = [
            MeterReading(
                meter=meter,
                recorded_at=item['recorded_at'],
                reading_kwh=item.get('cumulative_kwh'),
                reading_m3=item.get('cumulative_m3'),
                source='auto',
            )
            for item in items
        ]
        MeterReading.objects.bulk_create(rows, ignore_conflicts=True)
        return Response({'accepted': len(rows), 'rejected': []})
```

- [ ] **Step 2: Commit**

```bash
git add apps/utilities/views.py
git commit -m "feat(utilities): device-token ingest endpoint (per-meter auth)"
```

---

## Task 11: URL wiring

**Files:**
- Modify: `backend/apps/utilities/urls.py`

- [ ] **Step 1: Register integrations on the router; add explicit paths**

Open `backend/apps/utilities/urls.py` and update:

```python
from django.urls import path
from rest_framework.routers import DefaultRouter

from .views import (
    DeviceReadingsView,
    DeviceTokenView,
    DockwalkListView,
    DockwalkReadingView,
    MeterOutageAlertViewSet,
    MeterWebhookKeyRotateView,
    MeterWebhookKeyView,
    OfgemReportView,
    ServiceBollardViewSet,
    SmartMeterViewSet,
    UtilityIntegrationViewSet,
    UtilityWalletViewSet,
    WashTokenRedeemView,
    WashTokenViewSet,
    WebhookReadingsView,
)

router = DefaultRouter()
router.register(r'smart-meters',   SmartMeterViewSet,           basename='smart-meter')
router.register(r'integrations',   UtilityIntegrationViewSet,   basename='utility-integration')
router.register(r'outage-alerts',  MeterOutageAlertViewSet,     basename='outage-alert')
router.register(r'wallets',        UtilityWalletViewSet,        basename='utility-wallet')
router.register(r'bollards',       ServiceBollardViewSet,       basename='service-bollard')
router.register(r'wash-tokens',    WashTokenViewSet,            basename='wash-token')

urlpatterns = [
    path('ofgem-report/',                       OfgemReportView.as_view(),           name='ofgem-report'),
    path('wash-tokens/redeem/',                 WashTokenRedeemView.as_view(),       name='wash-token-redeem'),

    # Meter setup — explicit paths BEFORE router.urls
    path('webhook-key/',                        MeterWebhookKeyView.as_view(),       name='meter-webhook-key'),
    path('webhook-key/rotate/',                 MeterWebhookKeyRotateView.as_view(), name='meter-webhook-key-rotate'),
    path('smart-meters/<int:pk>/device-token/', DeviceTokenView.as_view(),           name='smart-meter-device-token'),

    # Ingest endpoints (no JWT — auth via headers)
    path('webhook/readings/',                   WebhookReadingsView.as_view(),       name='webhook-readings'),
    path('devices/readings/',                   DeviceReadingsView.as_view(),        name='device-readings'),

    # Dockwalk staff endpoints (existing)
    path('dockwalk/',                           DockwalkListView.as_view(),          name='dockwalk-list'),
    path('dockwalk/<int:meter_id>/reading/',    DockwalkReadingView.as_view(),       name='dockwalk-reading'),
] + router.urls
```

- [ ] **Step 2: Run the full test suite**

```bash
cd backend
python -m pytest apps/utilities/tests/test_meter_setup.py -v
```

Expected: **all tests pass**. If any fail, fix the underlying view code — do not edit the test.

- [ ] **Step 3: Run the rest of the utilities tests to confirm no regression**

```bash
cd backend
python -m pytest apps/utilities/ -v
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/utilities/urls.py
git commit -m "feat(utilities): wire URL routes for integrations, key mgmt, ingest"
```

---

## Task 12: Frontend — extract shared helpers + add Meters tab

**Files:**
- Create: `frontend/src/screens/utilities/_shared.jsx`
- Modify: `frontend/src/screens/Utilities.jsx`

- [ ] **Step 1: Create `_shared.jsx`**

Create `frontend/src/screens/utilities/_shared.jsx`:

```jsx
export function Badge({ children, color = 'secondary' }) {
  const colors = {
    success:   { background: 'rgba(47,179,135,0.12)', color: '#1a9c6e' },
    danger:    { background: 'rgba(214,57,57,0.12)',  color: '#c0392b' },
    warning:   { background: 'rgba(240,173,78,0.14)', color: '#b07d0a' },
    info:      { background: 'rgba(26,117,187,0.12)', color: '#1a75bb' },
    secondary: { background: 'rgba(0,0,0,0.07)',      color: 'rgba(0,0,0,0.5)' },
    navy:      { background: 'rgba(26,45,74,0.1)',    color: 'var(--navy)' },
  };
  const s = colors[color] || colors.secondary;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: 20, fontSize: 11,
      fontWeight: 600, ...s,
    }}>
      {children}
    </span>
  );
}

export function Spinner() {
  return (
    <div style={{ padding: 40, color: 'rgba(0,0,0,0.35)', fontSize: 13, textAlign: 'center' }}>
      Loading…
    </div>
  );
}

export function EmptyState({ icon = '—', message }) {
  return (
    <div style={{ padding: '48px 24px', textAlign: 'center', color: 'rgba(0,0,0,0.35)', fontSize: 13 }}>
      <div style={{ fontSize: 28, marginBottom: 10, opacity: 0.4 }}>{icon}</div>
      {message}
    </div>
  );
}

export function ErrorMsg({ msg }) {
  if (!msg) return null;
  return (
    <div style={{
      background: 'rgba(214,57,57,0.08)', border: '1px solid rgba(214,57,57,0.18)',
      borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#c0392b', marginBottom: 12,
    }}>{msg}</div>
  );
}

export function SuccessMsg({ msg }) {
  if (!msg) return null;
  return (
    <div style={{
      background: 'rgba(47,179,135,0.08)', border: '1px solid rgba(47,179,135,0.2)',
      borderRadius: 6, padding: '8px 12px', fontSize: 12, color: '#1a9c6e', marginBottom: 12,
    }}>{msg}</div>
  );
}
```

- [ ] **Step 2: Replace local helpers in `Utilities.jsx` with imports**

At the top of `frontend/src/screens/Utilities.jsx` (after the existing imports), add:

```jsx
import MetersTab from './utilities/MetersTab.jsx';
import { Badge, Spinner, EmptyState, ErrorMsg, SuccessMsg } from './utilities/_shared.jsx';
```

Then **delete** the local definitions of `Badge`, `Spinner`, `EmptyState`, `ErrorMsg`, `SuccessMsg` (`Utilities.jsx:6-65`).

In the `TABS` array near the bottom of `Utilities.jsx:777-781`, change to:

```jsx
const TABS = [
  { id: 'meters',       label: 'Meters' },
  { id: 'bollards',     label: 'Bollards' },
  { id: 'wash-tokens',  label: 'Wash Tokens' },
  { id: 'ofgem',        label: 'OFGEM Reports' },
];
```

In the `useState`, change `useState('bollards')` to `useState('meters')`.

In the tab-content switch (`Utilities.jsx:818-820`), add a new line first:

```jsx
{tab === 'meters'      && <MetersTab />}
```

- [ ] **Step 3: Smoke test**

```bash
cd frontend
npm run dev
```

The Utilities screen should still load (with the new Meters tab visible but empty until next tasks).

- [ ] **Step 4: Commit**

```bash
git add src/screens/utilities/_shared.jsx src/screens/Utilities.jsx
git commit -m "feat(utilities-ui): extract shared helpers; add Meters tab to Utilities screen"
```

---

## Task 13: Frontend — `MetersTab` shell + `RevealOnceModal`

**Files:**
- Create: `frontend/src/screens/utilities/MetersTab.jsx`
- Create: `frontend/src/screens/utilities/RevealOnceModal.jsx`

- [ ] **Step 1: Create `RevealOnceModal.jsx`**

```jsx
import { useState } from 'react';

export default function RevealOnceModal({ title, secrets, onClose }) {
  // secrets: [{ label, value }, ...]
  const [revealed, setRevealed] = useState({});

  function copy(text) {
    navigator.clipboard?.writeText(text);
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ background: '#fff', borderRadius: 10, width: 480, boxShadow: '0 8px 32px rgba(0,0,0,0.2)' }}
           onClick={e => e.stopPropagation()}>
        <div style={{ padding: '16px 20px', borderBottom: 'var(--border)' }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{title}</div>
          <div style={{ fontSize: 12, color: '#b07d0a', marginTop: 4 }}>
            ⚠ Save this now — it will not be shown again.
          </div>
        </div>
        <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {secrets.map(s => (
            <div key={s.label}>
              <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.5)', marginBottom: 4 }}>{s.label}</div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'var(--bg)', borderRadius: 6, padding: '8px 10px',
                fontFamily: 'monospace', fontSize: 12,
              }}>
                <span style={{ flex: 1, wordBreak: 'break-all' }}>
                  {revealed[s.label] ? s.value : '•'.repeat(Math.min(s.value.length, 32))}
                </span>
                {!revealed[s.label] && (
                  <button onClick={() => setRevealed(r => ({ ...r, [s.label]: true }))}
                          style={{ fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}>
                    Reveal
                  </button>
                )}
                <button onClick={() => copy(s.value)}
                        style={{ fontSize: 11, padding: '3px 8px', cursor: 'pointer' }}>
                  Copy
                </button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ padding: '12px 20px', borderTop: 'var(--border)', display: 'flex', justifyContent: 'flex-end' }}>
          <button onClick={onClose}
                  style={{ background: 'var(--navy)', color: '#fff', border: 'none',
                           borderRadius: 6, padding: '8px 16px', fontSize: 13, cursor: 'pointer' }}>
            I have saved it
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `MetersTab.jsx`**

```jsx
import { useState } from 'react';
import IntegrationsPanel from './IntegrationsPanel.jsx';
import PushEndpointPanel from './PushEndpointPanel.jsx';
import DeviceTokensPanel from './DeviceTokensPanel.jsx';
import MetersListPanel from './MetersListPanel.jsx';

const SUBTABS = [
  { id: 'integrations',    label: 'Integrations' },
  { id: 'push-endpoint',   label: 'Push Endpoint' },
  { id: 'device-tokens',   label: 'Device Tokens' },
  { id: 'meters',          label: 'Meters' },
];

export default function MetersTab() {
  const [sub, setSub] = useState('integrations');

  return (
    <div>
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid rgba(0,0,0,0.06)', marginBottom: 18 }}>
        {SUBTABS.map(t => (
          <button
            key={t.id}
            onClick={() => setSub(t.id)}
            style={{
              padding: '7px 14px', fontSize: 12,
              fontWeight: sub === t.id ? 700 : 500,
              border: 'none', background: 'none', cursor: 'pointer',
              color: sub === t.id ? 'var(--navy)' : 'rgba(0,0,0,0.5)',
              borderBottom: sub === t.id ? '2px solid var(--navy)' : '2px solid transparent',
              marginBottom: -1,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {sub === 'integrations'  && <IntegrationsPanel />}
      {sub === 'push-endpoint' && <PushEndpointPanel />}
      {sub === 'device-tokens' && <DeviceTokensPanel />}
      {sub === 'meters'        && <MetersListPanel />}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/screens/utilities/MetersTab.jsx src/screens/utilities/RevealOnceModal.jsx
git commit -m "feat(utilities-ui): MetersTab shell + RevealOnceModal for one-time secrets"
```

---

## Task 14: Frontend — `IntegrationsPanel`

**Files:**
- Create: `frontend/src/screens/utilities/IntegrationsPanel.jsx`

- [ ] **Step 1: Create the panel**

```jsx
import { useState, useEffect, useCallback } from 'react';
import api from '../../api.js';
import { Badge, Spinner, EmptyState, ErrorMsg, SuccessMsg } from './_shared.jsx';

const VENDORS = [
  { id: 'rolec',      label: 'Rolec Cloud' },
  { id: 'marinesync', label: 'MarineSync' },
];

function IntegrationModal({ initial, onClose, onSaved }) {
  const [vendor,   setVendor]   = useState(initial?.vendor || 'rolec');
  const [apiKey,   setApiKey]   = useState('');
  const [baseUrl,  setBaseUrl]  = useState('');
  const [saving,   setSaving]   = useState(false);
  const [err,      setErr]      = useState('');

  async function save(e) {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      const body = { vendor, credentials: { api_key: apiKey, base_url: baseUrl || undefined } };
      if (initial) await api.patch(`/utilities/integrations/${initial.id}/`, body);
      else         await api.post('/utilities/integrations/', body);
      onSaved();
      onClose();
    } catch (ex) {
      setErr(ex?.response?.data?.detail || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 10, width: 420, padding: 24 }}
           onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>
          {initial ? 'Edit Integration' : 'Add Integration'}
        </div>
        <ErrorMsg msg={err} />
        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Vendor</label>
            <select value={vendor} onChange={e => setVendor(e.target.value)} disabled={!!initial}
                    style={{ width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 5, border: 'var(--border)' }}>
              {VENDORS.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>API key</label>
            <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
                   placeholder={initial ? '(leave blank to keep existing)' : ''}
                   required={!initial}
                   style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '6px 8px', borderRadius: 5, border: 'var(--border)' }} />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Base URL (optional)</label>
            <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)}
                   placeholder="https://api.rolec.com"
                   style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '6px 8px', borderRadius: 5, border: 'var(--border)' }} />
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
            <button type="button" onClick={onClose}
                    style={{ padding: '7px 14px', borderRadius: 6, border: 'var(--border)', background: 'var(--bg)', fontSize: 12, cursor: 'pointer' }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
                    style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: 'var(--navy)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function IntegrationsPanel() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [msg,     setMsg]     = useState('');
  const [err,     setErr]     = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/utilities/integrations/')
      .then(r => setRows(r.data.results ?? r.data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function test(row) {
    setMsg(''); setErr('');
    try {
      const { data } = await api.post(`/utilities/integrations/${row.id}/test/`);
      if (data.ok) setMsg(`${row.vendor}: connection OK.`);
      else         setErr(`${row.vendor}: ${data.error}`);
    } catch {
      setErr('Test failed.');
    }
    setTimeout(() => { setMsg(''); setErr(''); }, 5000);
  }

  async function del(row) {
    if (!confirm(`Delete the ${row.vendor} integration?`)) return;
    await api.delete(`/utilities/integrations/${row.id}/`);
    load();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
          Connect to a meter vendor's cloud — we poll readings every 15 min.
        </div>
        <button onClick={() => setShowAdd(true)}
                style={{ background: 'var(--navy)', color: '#fff', border: 'none', borderRadius: 5, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>
          + Add Integration
        </button>
      </div>

      <ErrorMsg msg={err} />
      <SuccessMsg msg={msg} />

      {loading ? <Spinner /> : rows.length === 0 ? (
        <EmptyState icon="⚡" message="No vendor integrations. Click Add Integration to connect one." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map(row => (
            <div key={row.id} className="card" style={{ padding: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{(VENDORS.find(v => v.id === row.vendor) || {}).label || row.vendor}</div>
                <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginTop: 3 }}>
                  {row.last_sync_at ? `Last sync ${new Date(row.last_sync_at).toLocaleString()}` : 'Never synced'}
                  {row.last_sync_ok === false && row.last_sync_error && ` — ${row.last_sync_error}`}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Badge color={row.is_active ? 'success' : 'secondary'}>{row.is_active ? 'Active' : 'Paused'}</Badge>
                <button onClick={() => test(row)} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>Test</button>
                <button onClick={() => setEditing(row)} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>Edit</button>
                <button onClick={() => del(row)} className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: '#c0392b' }}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(showAdd || editing) && (
        <IntegrationModal
          initial={editing}
          onClose={() => { setShowAdd(false); setEditing(null); }}
          onSaved={load}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/screens/utilities/IntegrationsPanel.jsx
git commit -m "feat(utilities-ui): integrations panel with add/edit/test/delete"
```

---

## Task 15: Frontend — `PushEndpointPanel`

**Files:**
- Create: `frontend/src/screens/utilities/PushEndpointPanel.jsx`

- [ ] **Step 1: Create the panel**

```jsx
import { useState, useEffect, useCallback } from 'react';
import api from '../../api.js';
import { Spinner, ErrorMsg } from './_shared.jsx';
import RevealOnceModal from './RevealOnceModal.jsx';

export default function PushEndpointPanel() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(false);
  const [err,  setErr]        = useState('');
  const [reveal, setReveal]   = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/utilities/webhook-key/')
      .then(r => setData(r.data))
      .catch(() => setErr('Failed to load.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function rotate() {
    if (data?.status === 'active' && !confirm('Rotate the key? The old one will stop working immediately.')) return;
    setBusy(true); setErr('');
    try {
      const { data: rotated } = await api.post('/utilities/webhook-key/rotate/');
      const plaintext = rotated.key;
      setData({ ...rotated, key: undefined });
      setReveal([{ label: 'Webhook key', value: plaintext }]);
    } catch {
      setErr('Failed to rotate.');
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!confirm('Revoke the key? Any system using it will lose access.')) return;
    setBusy(true);
    await api.delete('/utilities/webhook-key/');
    setBusy(false);
    load();
  }

  if (loading) return <Spinner />;
  if (err)     return <ErrorMsg msg={err} />;

  const issued = data?.status !== 'unissued';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card" style={{ padding: 18 }}>
        <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>Push Endpoint</div>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginBottom: 14 }}>
          Use this to receive readings from any system that can make an HTTP POST.
          Useful when DocksBase doesn't have a built-in integration for your vendor.
        </div>

        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>Endpoint URL</div>
        <div style={{
          background: 'var(--bg)', borderRadius: 6, padding: '8px 10px', fontFamily: 'monospace',
          fontSize: 12, marginBottom: 14, wordBreak: 'break-all',
        }}>{data.endpoint_url}</div>

        <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)', marginBottom: 4 }}>API key</div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, background: 'var(--bg)',
          borderRadius: 6, padding: '8px 10px', fontFamily: 'monospace', fontSize: 12,
          marginBottom: 14,
        }}>
          <span style={{ flex: 1 }}>
            {issued ? `${data.key_prefix}${'•'.repeat(32)}` : 'No key issued yet'}
          </span>
          {issued ? (
            <>
              <button onClick={rotate} disabled={busy} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>Rotate</button>
              <button onClick={revoke} disabled={busy} className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: '#c0392b' }}>Revoke</button>
            </>
          ) : (
            <button onClick={rotate} disabled={busy} className="btn btn-sm"
                    style={{ background: 'var(--navy)', color: '#fff', border: 'none', padding: '4px 12px', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>
              Generate key
            </button>
          )}
        </div>

        {issued && (
          <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
            {data.last_used_at ? `Last used ${new Date(data.last_used_at).toLocaleString()}` : 'Never used'}
            {' · '} {data.rotated_at ? `Rotated ${new Date(data.rotated_at).toLocaleDateString()}` : `Issued ${new Date(data.created_at).toLocaleDateString()}`}
          </div>
        )}
      </div>

      <details className="card" style={{ padding: 14, fontSize: 12 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>How to use</summary>
        <pre style={{
          background: 'var(--bg)', padding: 12, borderRadius: 6, marginTop: 10, overflowX: 'auto',
          fontSize: 11, fontFamily: 'monospace',
        }}>{`curl -X POST ${data.endpoint_url} \\
  -H 'X-Webhook-Key: <your key>' \\
  -H 'Content-Type: application/json' \\
  -d '{
    "readings": [{
      "device_id": "ROLEC-12345",
      "recorded_at": "2026-05-14T10:00:00Z",
      "cumulative_kwh": 1234.567
    }]
  }'`}</pre>
        <div style={{ marginTop: 8, color: 'rgba(0,0,0,0.55)' }}>
          The <code>device_id</code> must match a meter you've registered under the Meters sub-tab.
          Duplicate <code>(device_id, recorded_at)</code> pairs are silently deduped.
        </div>
      </details>

      {reveal && (
        <RevealOnceModal
          title="Your webhook key"
          secrets={reveal}
          onClose={() => setReveal(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/screens/utilities/PushEndpointPanel.jsx
git commit -m "feat(utilities-ui): push endpoint panel with one-time reveal on rotate"
```

---

## Task 16: Frontend — `DeviceTokensPanel`

**Files:**
- Create: `frontend/src/screens/utilities/DeviceTokensPanel.jsx`

- [ ] **Step 1: Create the panel**

```jsx
import { useState, useEffect, useCallback } from 'react';
import api from '../../api.js';
import { Badge, Spinner, EmptyState, ErrorMsg } from './_shared.jsx';
import RevealOnceModal from './RevealOnceModal.jsx';

export default function DeviceTokensPanel() {
  const [meters, setMeters]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy]       = useState(null);
  const [err, setErr]         = useState('');
  const [reveal, setReveal]   = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/utilities/smart-meters/')
      .then(r => setMeters(r.data.results ?? r.data))
      .catch(() => setMeters([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function generate(m) {
    setBusy(m.id); setErr('');
    try {
      const { data } = await api.post(`/utilities/smart-meters/${m.id}/device-token/`);
      setReveal([
        { label: 'Hardware ID',  value: data.hardware_id },
        { label: 'Device Token', value: data.device_token },
      ]);
      load();
    } catch {
      setErr('Failed to generate.');
    } finally {
      setBusy(null);
    }
  }

  async function revoke(m) {
    if (!confirm(`Revoke the token for ${m.label || m.device_id}? The meter will lose access.`)) return;
    setBusy(m.id);
    await api.delete(`/utilities/smart-meters/${m.id}/device-token/`);
    setBusy(null);
    load();
  }

  return (
    <div>
      <div className="card" style={{ padding: 12, marginBottom: 14, fontSize: 12, color: 'rgba(0,0,0,0.6)' }}>
        Use device tokens for meters that POST directly to DocksBase
        (i.e. they don't go through a vendor's cloud). Each meter gets its own
        Hardware ID + Token pair. Treat the token like a password.
      </div>

      <ErrorMsg msg={err} />

      {loading ? <Spinner /> : meters.length === 0 ? (
        <EmptyState icon="📡" message="No meters registered. Add a meter on the Meters sub-tab first." />
      ) : (
        <div className="card">
          <table className="tbl" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Meter</th>
                <th>Hardware ID</th>
                <th>Token</th>
                <th>Last seen</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {meters.map(m => {
                const has = !!m.hardware_id;
                return (
                  <tr key={m.id}>
                    <td style={{ fontWeight: 600, fontSize: 13 }}>{m.label || m.device_id}</td>
                    <td style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(0,0,0,0.6)' }}>
                      {m.hardware_id || '—'}
                    </td>
                    <td>
                      {has
                        ? <Badge color="info">{m.device_token_prefix}…</Badge>
                        : <Badge color="secondary">Not issued</Badge>}
                    </td>
                    <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
                      {m.device_token_last_used_at ? new Date(m.device_token_last_used_at).toLocaleString() : '—'}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {has ? (
                        <>
                          <button onClick={() => generate(m)} disabled={busy === m.id} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>Rotate</button>
                          <button onClick={() => revoke(m)}   disabled={busy === m.id} className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: '#c0392b' }}>Revoke</button>
                        </>
                      ) : (
                        <button onClick={() => generate(m)} disabled={busy === m.id}
                                style={{ background: 'var(--navy)', color: '#fff', border: 'none', padding: '4px 10px', borderRadius: 5, fontSize: 11, cursor: 'pointer' }}>
                          Generate token
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {reveal && (
        <RevealOnceModal
          title="Device credentials"
          secrets={reveal}
          onClose={() => setReveal(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Update `SmartMeterSerializer` to expose `hardware_id`, `device_token_prefix`, `device_token_last_used_at`**

In `backend/apps/utilities/serializers.py`, modify `SmartMeterSerializer.Meta.fields` to include the new fields:

```python
class SmartMeterSerializer(serializers.ModelSerializer):
    class Meta:
        model  = SmartMeter
        fields = [
            'id', 'marina', 'berth', 'vendor', 'meter_type',
            'device_id', 'label', 'poll_interval_minutes',
            'is_active', 'last_polled', 'is_online',
            'hardware_id', 'device_token_prefix', 'device_token_last_used_at',
        ]
        read_only_fields = ['last_polled', 'is_online',
                            'hardware_id', 'device_token_prefix', 'device_token_last_used_at']
```

- [ ] **Step 3: Commit**

```bash
git add src/screens/utilities/DeviceTokensPanel.jsx
git add ../backend/apps/utilities/serializers.py  # adjust path if running from repo root
git commit -m "feat(utilities-ui): device tokens panel; expose token prefix on SmartMeter API"
```

---

## Task 17: Frontend — `MetersListPanel`

**Files:**
- Create: `frontend/src/screens/utilities/MetersListPanel.jsx`

- [ ] **Step 1: Create the panel**

```jsx
import { useState, useEffect, useCallback } from 'react';
import api from '../../api.js';
import { Badge, Spinner, EmptyState, ErrorMsg } from './_shared.jsx';

const VENDORS  = [{ id: 'rolec', label: 'Rolec' }, { id: 'marinesync', label: 'MarineSync' }];
const TYPES    = [{ id: 'electricity', label: 'Electricity' }, { id: 'water', label: 'Water' }];

function MeterModal({ initial, onClose, onSaved }) {
  const [form, setForm] = useState({
    vendor: initial?.vendor || 'rolec',
    meter_type: initial?.meter_type || 'electricity',
    device_id: initial?.device_id || '',
    label: initial?.label || '',
    berth: initial?.berth || '',
    poll_interval_minutes: initial?.poll_interval_minutes || 60,
    is_active: initial?.is_active ?? true,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr]       = useState('');

  async function save(e) {
    e.preventDefault();
    setSaving(true); setErr('');
    const body = { ...form, berth: form.berth || null };
    try {
      if (initial) await api.patch(`/utilities/smart-meters/${initial.id}/`, body);
      else         await api.post('/utilities/smart-meters/', body);
      onSaved(); onClose();
    } catch (ex) {
      setErr(ex?.response?.data?.detail || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(0,0,0,0.4)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center' }}
         onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 10, width: 420, padding: 24 }}
           onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>
          {initial ? 'Edit Meter' : 'Add Meter'}
        </div>
        <ErrorMsg msg={err} />
        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            ['Label',      'label',      'text',   false],
            ['Device ID',  'device_id',  'text',   true],
          ].map(([label, key, type, req]) => (
            <div key={key}>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>{label}</label>
              <input type={type} required={req}
                     value={form[key]}
                     onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
                     style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: '6px 8px', borderRadius: 5, border: 'var(--border)' }} />
            </div>
          ))}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Vendor</label>
              <select value={form.vendor} onChange={e => setForm(f => ({ ...f, vendor: e.target.value }))}
                      style={{ width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 5, border: 'var(--border)' }}>
                {VENDORS.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>Type</label>
              <select value={form.meter_type} onChange={e => setForm(f => ({ ...f, meter_type: e.target.value }))}
                      style={{ width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 5, border: 'var(--border)' }}>
                {TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
            <button type="button" onClick={onClose}
                    style={{ padding: '7px 14px', borderRadius: 6, border: 'var(--border)', background: 'var(--bg)', fontSize: 12, cursor: 'pointer' }}>Cancel</button>
            <button type="submit" disabled={saving}
                    style={{ padding: '7px 14px', borderRadius: 6, border: 'none', background: 'var(--navy)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function MetersListPanel() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [adding, setAdding]   = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/utilities/smart-meters/')
      .then(r => setRows(r.data.results ?? r.data))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function del(row) {
    if (!confirm(`Delete meter ${row.label || row.device_id}?`)) return;
    await api.delete(`/utilities/smart-meters/${row.id}/`);
    load();
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
          Register each physical meter. Vendor-pull meters need a matching Integration;
          direct-push meters get a token under the Device Tokens tab.
        </div>
        <button onClick={() => setAdding(true)}
                style={{ background: 'var(--navy)', color: '#fff', border: 'none', borderRadius: 5, padding: '6px 14px', fontSize: 12, cursor: 'pointer' }}>
          + Add Meter
        </button>
      </div>

      {loading ? <Spinner /> : rows.length === 0 ? (
        <EmptyState icon="📊" message="No meters registered yet." />
      ) : (
        <div className="card">
          <table className="tbl" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Label</th>
                <th>Vendor</th>
                <th>Type</th>
                <th>Device ID</th>
                <th>Online</th>
                <th>Last polled</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600, fontSize: 13 }}>{r.label || '—'}</td>
                  <td style={{ fontSize: 12 }}>{r.vendor}</td>
                  <td style={{ fontSize: 12 }}>{r.meter_type}</td>
                  <td style={{ fontSize: 12, fontFamily: 'monospace' }}>{r.device_id}</td>
                  <td><Badge color={r.is_online ? 'success' : 'danger'}>{r.is_online ? 'Online' : 'Offline'}</Badge></td>
                  <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.45)' }}>
                    {r.last_polled ? new Date(r.last_polled).toLocaleString() : '—'}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button onClick={() => setEditing(r)} className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}>Edit</button>
                    <button onClick={() => del(r)} className="btn btn-ghost btn-sm" style={{ fontSize: 11, color: '#c0392b' }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(adding || editing) && (
        <MeterModal
          initial={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={load}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/screens/utilities/MetersListPanel.jsx
git commit -m "feat(utilities-ui): meters list panel with add/edit/delete"
```

---

## Task 18: End-to-end verification

- [ ] **Step 1: Backend tests**

```bash
cd backend
python -m pytest apps/utilities/ -v
```

Expected: all green.

- [ ] **Step 2: Frontend build**

```bash
cd frontend
npm run build
```

Expected: clean build, no errors.

- [ ] **Step 3: Manual smoke (dev server)**

```bash
cd frontend && npm run dev
```

Log in as a marina staff user; navigate to Utilities → Meters and verify:

1. **Integrations**: + Add → create a Rolec integration with a dummy api_key → test → see error toast (no real Rolec endpoint locally — that's expected). Edit, delete work.
2. **Meters**: + Add a meter with `device_id: ROLEC-1`, type electricity. Appears in list.
3. **Push Endpoint**: Click Generate key → modal shows plaintext + reveal/copy. Click "I have saved it" → list shows `sk_xxxxxxxx…`, last-used "—".
   - In a separate terminal:
     ```bash
     curl -X POST http://localhost:8000/api/v1/utilities/webhook/readings/ \
       -H 'X-Webhook-Key: <plaintext>' \
       -H 'Content-Type: application/json' \
       -d '{"readings":[{"device_id":"ROLEC-1","recorded_at":"2026-05-14T10:00:00Z","cumulative_kwh":1234.5}]}'
     ```
     Expected response: `{"accepted":1,"rejected":[]}`.
4. **Device Tokens**: Click Generate token on the meter → modal shows `hw_*` + `sk_*`. Confirm.
   - `curl -X POST http://localhost:8000/api/v1/utilities/devices/readings/ \
        -H 'X-Hardware-ID: <hw>' -H 'X-Device-Token: <sk>' \
        -H 'Content-Type: application/json' \
        -d '{"readings":[{"recorded_at":"2026-05-14T11:00:00Z","cumulative_kwh":1240.0}]}'`
     Expected: `{"accepted":1,"rejected":[]}`.
5. **Rotate**: rotate the webhook key. Old curl call from step 3 now returns 401.
6. **Browser console**: no errors.

- [ ] **Step 4: Final commit (if anything stylistic surfaced)** + push branch

```bash
git push -u origin feature/utility-meter-setup
```

---

## Self-Review

**Spec coverage:**
- ✅ Hashed credentials at rest (Day 1) — Task 7 (webhook), Task 8 (device) use `make_password`; auth verifies with `check_password` (Task 3).
- ✅ Plaintext one-time reveal in API + UI — Task 7/8 return `key`/`device_token` only in rotate response; Task 13 `RevealOnceModal`.
- ✅ No `?reveal` re-fetch — `MarinaMeterWebhookKeySerializer` (Task 4) never serializes plaintext.
- ✅ `bulk_create(ignore_conflicts=True)` ingest — Tasks 9, 10.
- ✅ `MeterReading` unique constraint — Task 1 Step 3.
- ✅ Throttled `last_used_at` — Task 3 `_touch_last_used`.
- ✅ All three options exposed in UI — Tasks 14 (vendor pull), 15 (webhook), 16 (device tokens).
- ✅ CRUD scoping — Task 6 `get_queryset` filters by `_marina(self.request)`.
- ✅ Vendor `test_connection` — Tasks 2, 6.
- ✅ Migration safety note — Task 1 Step 5.
- ✅ 5000-reading payload guard — Task 4 (`ReadingIngestSerializer.validate_readings`).

**Placeholder scan:** No TBDs, no "implement later", all code blocks are complete.

**Type consistency:**
- `_marina(request)` from existing `views.py:60` — used consistently.
- `MarinaMeterWebhookKey.PREFIX_LEN = 11` — defined in Task 1 model, used in Tasks 3 and 7.
- `MeterWebhookAuthentication` and `MeterDeviceAuthentication` — defined Task 3, imported in Task 6 prelude and used in Tasks 9 / 10.
- `RevealOnceModal` props `{title, secrets: [{label, value}], onClose}` — used identically in Tasks 15 and 16.
- API paths in tests (Task 5) match URL conf (Task 11) exactly.
