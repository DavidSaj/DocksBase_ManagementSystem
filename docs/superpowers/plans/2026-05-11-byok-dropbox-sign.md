# BYOK Dropbox Sign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each marina pastes their own Dropbox Sign API key + client ID into Settings > Integrations; the service layer uses those credentials so DS billing goes directly to the marina; the waiver flow automatically uses e-signature when credentials are present and falls back to click-wrap when they are not.

**Architecture:** Two new fields on `Marina` (`dropboxsign_api_key`, `dropboxsign_client_id`) stored as plain text (no encryption at this stage). A new `DropboxSignSettingsView` (GET/PATCH) under `marina/integrations/dropbox-sign/` exposes them — GET always masks the key. `documents/services.py` functions accept explicit `api_key`/`client_id` params. `WaiverView` inspects marina credentials: missing → click-wrap mode, present → DS embedded-sign mode. `WaiverItem.jsx` handles both modes from a single GET response.

**Tech Stack:** Django REST Framework, Dropbox Sign Python SDK (`dropbox-sign`), React (no Tailwind)

---

## File Structure

| File | Change |
|---|---|
| `backend/apps/accounts/models.py` | Add 2 fields to Marina |
| `backend/apps/accounts/migrations/0021_marina_dropboxsign_fields.py` | New migration |
| `backend/apps/accounts/views.py` | Add `DropboxSignSettingsView` |
| `backend/apps/accounts/marina_urls.py` | Register new route |
| `backend/apps/accounts/tests.py` | Tests for settings view |
| `backend/apps/documents/services.py` | Accept explicit `api_key`/`client_id` |
| `backend/apps/documents/views.py` | Pass marina credentials to service calls |
| `backend/apps/portal/checkin_views.py` | Restore DS flow (with marina creds) alongside click-wrap |
| `backend/apps/portal/tests_checkin.py` | Update waiver tests for both modes |
| `frontend/src/screens/Settings.jsx` | Add Integrations tab with DS form |
| `portal/src/components/portal/checklist/WaiverItem.jsx` | Handle `mode: clickwrap` and `mode: esign` |

---

### Task 1: Add DS fields to Marina model + migration

**Files:**
- Modify: `backend/apps/accounts/models.py`
- Create: `backend/apps/accounts/migrations/0021_marina_dropboxsign_fields.py`

**Context:** `Marina` is defined at line 17 of `models.py`. The latest migration is `0020`. The new fields are plain text — no encryption needed for an MVP.

- [ ] **Step 1: Write the failing test**

In `backend/apps/accounts/tests.py`, add:

```python
from django.test import TestCase
from apps.accounts.models import Marina

class MarinaDropboxSignFieldsTest(TestCase):
    def test_fields_exist_and_default_blank(self):
        m = Marina.objects.create(name='Test', slug='test-ds-fields')
        self.assertEqual(m.dropboxsign_api_key, '')
        self.assertEqual(m.dropboxsign_client_id, '')
```

- [ ] **Step 2: Run test to verify it fails**

```
cd backend
python -m pytest apps/accounts/tests.py::MarinaDropboxSignFieldsTest -v
```

Expected: `FAILED` — `Marina has no attribute dropboxsign_api_key`

- [ ] **Step 3: Add fields to Marina model**

In `backend/apps/accounts/models.py`, after the line:
```python
    waiver_template_id = models.CharField(max_length=255, null=True, blank=True)
```
add:
```python
    dropboxsign_api_key    = models.CharField(max_length=255, blank=True, default='')
    dropboxsign_client_id  = models.CharField(max_length=255, blank=True, default='')
```

- [ ] **Step 4: Create migration**

Create `backend/apps/accounts/migrations/0021_marina_dropboxsign_fields.py`:

```python
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('accounts', '0020_marina_support_access_granted_until'),
    ]

    operations = [
        migrations.AddField(
            model_name='marina',
            name='dropboxsign_api_key',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
        migrations.AddField(
            model_name='marina',
            name='dropboxsign_client_id',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
    ]
```

- [ ] **Step 5: Run test to verify it passes**

```
python -m pytest apps/accounts/tests.py::MarinaDropboxSignFieldsTest -v
```

Expected: `PASSED`

- [ ] **Step 6: Commit**

```
git add apps/accounts/models.py apps/accounts/migrations/0021_marina_dropboxsign_fields.py apps/accounts/tests.py
git commit -m "feat: add dropboxsign_api_key and dropboxsign_client_id fields to Marina"
```

---

### Task 2: Backend settings endpoint — GET/PATCH `/marina/integrations/dropbox-sign/`

**Files:**
- Modify: `backend/apps/accounts/views.py`
- Modify: `backend/apps/accounts/marina_urls.py`
- Modify: `backend/apps/accounts/tests.py`

**Context:** Routes under `marina/` prefix are in `marina_urls.py` and registered in `config/urls.py` as `path('marina/', include('apps.accounts.marina_urls'))`. The new endpoint lives at `/api/v1/marina/integrations/dropbox-sign/`. GET returns `{client_id, api_key_tail}` — the key is never returned in full. PATCH accepts `{api_key, client_id}` and saves both. PATCH with `api_key: ""` and `client_id: ""` clears the integration.

- [ ] **Step 1: Write the failing tests**

In `backend/apps/accounts/tests.py`, add:

```python
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User

def make_manager(marina):
    return User.objects.create_user(
        email=f'mgr-{marina.id}@test.com',
        password='pw',
        marina=marina,
        role='manager',
        is_active=True,
    )


class DropboxSignSettingsViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.marina = Marina.objects.create(name='Test Marina', slug='test-ds-settings')
        self.user = make_manager(self.marina)
        self.client.force_authenticate(user=self.user)

    def test_get_returns_masked_key_and_client_id(self):
        self.marina.dropboxsign_api_key = 'sk_live_abc123456789'
        self.marina.dropboxsign_client_id = 'client_xyz'
        self.marina.save()
        resp = self.client.get('/api/v1/marina/integrations/dropbox-sign/')
        self.assertEqual(resp.status_code, 200)
        self.assertNotIn('sk_live_abc123456789', str(resp.data))
        self.assertEqual(resp.data['api_key_tail'], '6789')
        self.assertEqual(resp.data['client_id'], 'client_xyz')
        self.assertTrue(resp.data['connected'])

    def test_get_returns_not_connected_when_empty(self):
        resp = self.client.get('/api/v1/marina/integrations/dropbox-sign/')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(resp.data['connected'])
        self.assertEqual(resp.data['api_key_tail'], '')

    def test_patch_saves_credentials(self):
        resp = self.client.patch(
            '/api/v1/marina/integrations/dropbox-sign/',
            {'api_key': 'sk_live_newkey', 'client_id': 'new_client'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.marina.refresh_from_db()
        self.assertEqual(self.marina.dropboxsign_api_key, 'sk_live_newkey')
        self.assertEqual(self.marina.dropboxsign_client_id, 'new_client')

    def test_patch_empty_strings_clears_integration(self):
        self.marina.dropboxsign_api_key = 'old_key'
        self.marina.dropboxsign_client_id = 'old_client'
        self.marina.save()
        resp = self.client.patch(
            '/api/v1/marina/integrations/dropbox-sign/',
            {'api_key': '', 'client_id': ''},
            format='json',
        )
        self.assertEqual(resp.status_code, 200)
        self.marina.refresh_from_db()
        self.assertEqual(self.marina.dropboxsign_api_key, '')
        self.assertFalse(resp.data['connected'])
```

- [ ] **Step 2: Run tests to verify they fail**

```
python -m pytest apps/accounts/tests.py::DropboxSignSettingsViewTest -v
```

Expected: `FAILED` — 404 on the URL

- [ ] **Step 3: Add the view to `views.py`**

At the bottom of `backend/apps/accounts/views.py`, add:

```python
class DropboxSignSettingsView(APIView):
    def get(self, request):
        marina = request.user.marina
        key = marina.dropboxsign_api_key or ''
        return Response({
            'connected': bool(key and marina.dropboxsign_client_id),
            'client_id': marina.dropboxsign_client_id or '',
            'api_key_tail': key[-4:] if key else '',
        })

    def patch(self, request):
        marina = request.user.marina
        api_key   = request.data.get('api_key', marina.dropboxsign_api_key)
        client_id = request.data.get('client_id', marina.dropboxsign_client_id)
        marina.dropboxsign_api_key   = api_key   or ''
        marina.dropboxsign_client_id = client_id or ''
        marina.save(update_fields=['dropboxsign_api_key', 'dropboxsign_client_id'])
        key = marina.dropboxsign_api_key
        return Response({
            'connected': bool(key and marina.dropboxsign_client_id),
            'client_id': marina.dropboxsign_client_id,
            'api_key_tail': key[-4:] if key else '',
        })
```

- [ ] **Step 4: Register the route**

In `backend/apps/accounts/marina_urls.py`:

```python
from django.urls import path
from .views import MarinaProfileView, MarinaUsersView, InviteUserView, UserDetailView, MarinaOverviewView, DropboxSignSettingsView

urlpatterns = [
    path('profile/', MarinaProfileView.as_view(), name='marina_profile'),
    path('overview/', MarinaOverviewView.as_view(), name='marina_overview'),
    path('users/', MarinaUsersView.as_view(), name='marina_users'),
    path('users/invite/', InviteUserView.as_view(), name='invite_user'),
    path('users/<int:pk>/', UserDetailView.as_view(), name='user_detail'),
    path('integrations/dropbox-sign/', DropboxSignSettingsView.as_view(), name='dropboxsign_settings'),
]
```

- [ ] **Step 5: Run tests to verify they pass**

```
python -m pytest apps/accounts/tests.py::DropboxSignSettingsViewTest -v
```

Expected: 4 `PASSED`

- [ ] **Step 6: Commit**

```
git add apps/accounts/views.py apps/accounts/marina_urls.py apps/accounts/tests.py
git commit -m "feat: add DropboxSign settings endpoint GET/PATCH marina/integrations/dropbox-sign/"
```

---

### Task 3: Thread marina credentials through documents service layer

**Files:**
- Modify: `backend/apps/documents/services.py`
- Modify: `backend/apps/documents/views.py`
- Modify: `backend/apps/documents/tests.py`

**Context:** `services.py` currently calls `_api_client()` which reads global `settings.DROPBOX_SIGN_API_KEY`. Each function must instead accept explicit `api_key` and `client_id` params. `documents/views.py` calls `create_embedded_template_draft`, `send_envelope`, and `get_signed_pdf_url` — it must pass `request.user.marina.dropboxsign_api_key` and `request.user.marina.dropboxsign_client_id`.

- [ ] **Step 1: Write failing tests**

In `backend/apps/documents/tests.py`, find `ServiceLayerTest` and add:

```python
def test_create_draft_uses_marina_credentials(self):
    """create_embedded_template_draft must use passed api_key, not global settings."""
    with patch('apps.documents.services.dropbox_sign') as mock_ds:
        mock_client = MagicMock()
        mock_ds.ApiClient.return_value.__enter__ = lambda s: mock_client
        mock_ds.ApiClient.return_value.__exit__ = MagicMock(return_value=False)
        mock_ds.Configuration.return_value = MagicMock()
        mock_api = MagicMock()
        mock_ds.TemplateApi.return_value = mock_api
        mock_api.create_embedded_template_draft.return_value.embedded_template.edit_url = 'https://edit.url'

        from apps.documents.services import create_embedded_template_draft
        result = create_embedded_template_draft(self.template, '/fake/path.pdf', api_key='custom_key', client_id='custom_client')
        mock_ds.Configuration.assert_called_once_with(username='custom_key')
        self.assertEqual(result, 'https://edit.url')
```

- [ ] **Step 2: Run test to verify it fails**

```
python -m pytest apps/documents/tests.py::ServiceLayerTest::test_create_draft_uses_marina_credentials -v
```

Expected: `FAILED` — `create_embedded_template_draft() got an unexpected keyword argument 'api_key'`

- [ ] **Step 3: Update `services.py` to accept explicit credentials**

Replace the entire `services.py` with:

```python
from django.conf import settings

try:
    import dropbox_sign
except ImportError:
    dropbox_sign = None  # type: ignore[assignment]


def _api_client(api_key: str):
    configuration = dropbox_sign.Configuration(username=api_key)
    return dropbox_sign.ApiClient(configuration)


def _resolve_api_key(api_key):
    """Use marina key if provided, fall back to global setting."""
    return api_key or getattr(settings, 'DROPBOX_SIGN_API_KEY', '')


def create_embedded_template_draft(template, file_path: str, *, api_key: str, client_id: str) -> str:
    with _api_client(_resolve_api_key(api_key)) as client:
        api = dropbox_sign.TemplateApi(client)
        data = dropbox_sign.EmbeddedCreateEmbeddedTemplateDraftRequest(
            client_id=client_id or getattr(settings, 'DROPBOX_SIGN_CLIENT_ID', ''),
            files=[file_path],
            title=template.name,
            signer_roles=[{'name': 'Member', 'order': 0}],
            metadata={
                'marina_id': str(template.marina_id),
                'template_pk': str(template.pk),
            },
        )
        result = api.create_embedded_template_draft(data)
        return result.embedded_template.edit_url


def send_envelope(envelope, *, api_key: str, client_id: str = '') -> str:
    with _api_client(_resolve_api_key(api_key)) as client:
        api = dropbox_sign.SignatureRequestApi(client)
        signer = dropbox_sign.SubSignatureRequestTemplateSigner(
            role='Member',
            name=envelope.recipient.name,
            email_address=envelope.recipient.email,
        )
        data = dropbox_sign.SignatureRequestSendWithTemplateRequest(
            template_ids=[envelope.template.dropboxsign_template_id],
            signers=[signer],
            metadata={
                'marina_id': str(envelope.marina_id),
                'envelope_pk': str(envelope.pk),
            },
        )
        result = api.send_with_template(data)
        return result.signature_request.signature_request_id


def get_signed_pdf_url(signature_request_id: str, *, api_key: str) -> str:
    with _api_client(_resolve_api_key(api_key)) as client:
        api = dropbox_sign.SignatureRequestApi(client)
        result = api.get(signature_request_id)
        return result.signature_request.signing_url


def create_embedded_sign_url(
    booking,
    ds_template_id: str,
    *,
    api_key: str,
    client_id: str,
    envelope_pk=None,
) -> tuple[str, str]:
    """Create an embedded signature request for the boater waiver.

    Returns (signature_request_id, sign_url).
    """
    with _api_client(_resolve_api_key(api_key)) as client:
        sig_api = dropbox_sign.SignatureRequestApi(client)
        embedded_api = dropbox_sign.EmbeddedApi(client)

        metadata = {'booking_id': str(booking.id)}
        if envelope_pk is not None:
            metadata['envelope_pk'] = str(envelope_pk)

        data = dropbox_sign.SignatureRequestCreateEmbeddedWithTemplateRequest(
            client_id=client_id or getattr(settings, 'DROPBOX_SIGN_CLIENT_ID', ''),
            template_ids=[ds_template_id],
            subject='Marina Waiver',
            signers=[
                dropbox_sign.SubSignatureRequestTemplateSigner(
                    role='Boater',
                    name=booking.guest_name or 'Boater',
                    email_address=booking.guest_email,
                )
            ],
            metadata=metadata,
        )
        sig_response = sig_api.signature_request_create_embedded_with_template(data)
        request_id = sig_response.signature_request.signature_request_id
        signature_id = sig_response.signature_request.signatures[0].signature_id
        url_response = embedded_api.embedded_sign_url(signature_id)
        return request_id, url_response.embedded.sign_url


def get_existing_embedded_sign_url(signature_request_id: str, *, api_key: str) -> str:
    with _api_client(_resolve_api_key(api_key)) as client:
        sig_api = dropbox_sign.SignatureRequestApi(client)
        embedded_api = dropbox_sign.EmbeddedApi(client)
        sig_response = sig_api.signature_request_get(signature_request_id)
        signature_id = sig_response.signature_request.signatures[0].signature_id
        url_response = embedded_api.embedded_sign_url(signature_id)
        return url_response.embedded.sign_url
```

- [ ] **Step 4: Update `documents/views.py` to pass marina credentials**

In `backend/apps/documents/views.py`, update the three service call sites:

`DocTemplatePrepare.post`:
```python
edit_url = create_embedded_template_draft(
    template,
    template.file.path,
    api_key=request.user.marina.dropboxsign_api_key,
    client_id=request.user.marina.dropboxsign_client_id,
)
```

`EnvelopeList.perform_create`:
```python
request_id = send_envelope(
    envelope,
    api_key=request.user.marina.dropboxsign_api_key,
)
```

`EnvelopeDownload.get`:
```python
url = get_signed_pdf_url(
    envelope.dropboxsign_request_id,
    api_key=request.user.marina.dropboxsign_api_key,
)
```

- [ ] **Step 5: Run tests to verify they pass**

```
python -m pytest apps/documents/tests.py -v
```

Expected: all `PASSED`

- [ ] **Step 6: Commit**

```
git add apps/documents/services.py apps/documents/views.py apps/documents/tests.py
git commit -m "feat: thread marina DS credentials through service layer; add create_embedded_sign_url helper"
```

---

### Task 4: Update WaiverView to support both modes

**Files:**
- Modify: `backend/apps/portal/checkin_views.py`
- Modify: `backend/apps/portal/tests_checkin.py`

**Context:** `WaiverView` currently lives in `checkin_views.py`. It has GET (returns `waiver_url` for click-wrap) and POST (marks `waiver_signed=True`). We need to expand it so:
- GET checks if marina has DS credentials AND the active template has a `dropboxsign_template_id` → returns `{mode: 'esign', waiver_url, sign_url}`. Otherwise → `{mode: 'clickwrap', waiver_url}`.
- POST in esign mode: creates DS request, returns `{sign_url}` (webhook marks signed later). POST in click-wrap mode: unchanged.

The active waiver template is looked up by `DocTemplate.objects.get(marina=marina, id=int(marina.waiver_template_id))`.

Import `create_embedded_sign_url` and `get_existing_embedded_sign_url` from `apps.documents.services`.

- [ ] **Step 1: Write failing tests**

In `backend/apps/portal/tests_checkin.py`, replace the `WaiverViewTest` class with:

```python
from django.core.files.base import ContentFile
from apps.documents.models import DocTemplate
from unittest.mock import patch


class WaiverViewClickWrapTest(TestCase):
    """Waiver flow when marina has no DS credentials (click-wrap mode)."""
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
        self.template = DocTemplate.objects.create(marina=self.marina, name='Waiver', category='waiver', pages=1)
        self.template.file.save('waiver.pdf', ContentFile(b'%PDF fake'), save=True)
        self.marina.waiver_template_id = str(self.template.pk)
        self.marina.save()

    def test_get_returns_clickwrap_mode(self):
        resp = self.client.get(f'/api/v1/portal/checkin/bookings/{self.booking.id}/waiver/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['mode'], 'clickwrap')
        self.assertIn('waiver_url', resp.data)

    def test_post_marks_signed_and_pre_cleared(self):
        self.booking.boat_loa = 10
        self.booking.boat_beam = 3
        self.booking.boat_draft = 1.5
        self.booking.save()
        resp = self.client.post(f'/api/v1/portal/checkin/bookings/{self.booking.id}/waiver/')
        self.assertEqual(resp.status_code, 200)
        self.booking.refresh_from_db()
        self.assertTrue(self.booking.waiver_signed)
        self.assertTrue(self.booking.pre_cleared)

    def test_post_idempotent(self):
        self.booking.waiver_signed = True
        self.booking.save()
        resp = self.client.post(f'/api/v1/portal/checkin/bookings/{self.booking.id}/waiver/')
        self.assertEqual(resp.status_code, 200)

    def test_get_400_when_no_template_configured(self):
        self.marina.waiver_template_id = None
        self.marina.save()
        resp = self.client.get(f'/api/v1/portal/checkin/bookings/{self.booking.id}/waiver/')
        self.assertEqual(resp.status_code, 400)


class WaiverViewEsignTest(TestCase):
    """Waiver flow when marina has DS credentials (esign mode)."""
    def setUp(self):
        self.client = APIClient()
        self.marina = make_marina()
        self.marina.dropboxsign_api_key = 'sk_live_test'
        self.marina.dropboxsign_client_id = 'client_test'
        self.marina.save()
        self.booking = make_booking(self.marina)
        session_token = make_portal_token(
            booking_id=self.booking.id,
            marina_slug=self.marina.slug,
            boater_email=self.booking.guest_email,
        )
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {session_token}')
        self.template = DocTemplate.objects.create(
            marina=self.marina,
            name='Waiver',
            category='waiver',
            pages=1,
            dropboxsign_template_id='tmpl_abc',
        )
        self.template.file.save('waiver.pdf', ContentFile(b'%PDF fake'), save=True)
        self.marina.waiver_template_id = str(self.template.pk)
        self.marina.save()

    @patch('apps.portal.checkin_views.create_embedded_sign_url')
    def test_get_returns_esign_mode_with_sign_url(self, mock_create):
        mock_create.return_value = ('req_123', 'https://sign.hellosign.com/abc')
        resp = self.client.get(f'/api/v1/portal/checkin/bookings/{self.booking.id}/waiver/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['mode'], 'esign')
        self.assertEqual(resp.data['sign_url'], 'https://sign.hellosign.com/abc')
        self.assertIn('waiver_url', resp.data)

    @patch('apps.portal.checkin_views.get_existing_embedded_sign_url')
    def test_get_reuses_existing_request(self, mock_existing):
        self.booking.waiver_envelope_id = 'req_existing'
        self.booking.save()
        mock_existing.return_value = 'https://sign.hellosign.com/existing'
        resp = self.client.get(f'/api/v1/portal/checkin/bookings/{self.booking.id}/waiver/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['sign_url'], 'https://sign.hellosign.com/existing')

    @patch('apps.portal.checkin_views.create_embedded_sign_url')
    def test_post_esign_creates_request_and_returns_sign_url(self, mock_create):
        mock_create.return_value = ('req_new', 'https://sign.hellosign.com/new')
        resp = self.client.post(f'/api/v1/portal/checkin/bookings/{self.booking.id}/waiver/')
        self.assertEqual(resp.status_code, 200)
        self.assertIn('sign_url', resp.data)
        self.booking.refresh_from_db()
        self.assertEqual(self.booking.waiver_envelope_id, 'req_new')
```

- [ ] **Step 2: Run tests to verify they fail**

```
python -m pytest apps/portal/tests_checkin.py::WaiverViewClickWrapTest apps/portal/tests_checkin.py::WaiverViewEsignTest -v
```

Expected: several `FAILED` — wrong response shapes and missing DS mode

- [ ] **Step 3: Update imports in `checkin_views.py`**

At the top of `backend/apps/portal/checkin_views.py`, add:

```python
from apps.documents.services import create_embedded_sign_url, get_existing_embedded_sign_url
```

- [ ] **Step 4: Rewrite `WaiverView`**

Replace the entire `WaiverView` class in `checkin_views.py` with:

```python
class WaiverView(PortalBookingMixin, APIView):
    def _get_waiver_template(self, marina):
        if not marina.waiver_template_id:
            return None
        try:
            return DocTemplate.objects.get(marina=marina, id=int(marina.waiver_template_id))
        except (DocTemplate.DoesNotExist, ValueError, TypeError):
            return None

    def _uses_esign(self, marina, tpl):
        return bool(
            marina.dropboxsign_api_key
            and marina.dropboxsign_client_id
            and tpl.dropboxsign_template_id
        )

    def get(self, request, pk):
        booking, err = self.get_booking(request, pk)
        if err:
            return err

        tpl = self._get_waiver_template(booking.marina)
        if not tpl or not tpl.file:
            return Response(
                {'detail': 'No waiver document available for this marina.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        waiver_url = tpl.file.url

        if not self._uses_esign(booking.marina, tpl):
            return Response({'mode': 'clickwrap', 'waiver_url': waiver_url})

        marina = booking.marina
        if booking.waiver_envelope_id:
            sign_url = get_existing_embedded_sign_url(
                booking.waiver_envelope_id,
                api_key=marina.dropboxsign_api_key,
            )
        else:
            request_id, sign_url = create_embedded_sign_url(
                booking,
                tpl.dropboxsign_template_id,
                api_key=marina.dropboxsign_api_key,
                client_id=marina.dropboxsign_client_id,
            )
            booking.waiver_envelope_id = request_id
            booking.save(update_fields=['waiver_envelope_id'])

        return Response({'mode': 'esign', 'waiver_url': waiver_url, 'sign_url': sign_url})

    def post(self, request, pk):
        booking, err = self.get_booking(request, pk)
        if err:
            return err

        tpl = self._get_waiver_template(booking.marina)
        if not tpl:
            return Response(
                {'detail': 'No waiver template configured for this marina.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if self._uses_esign(booking.marina, tpl):
            marina = booking.marina
            if booking.waiver_envelope_id:
                sign_url = get_existing_embedded_sign_url(
                    booking.waiver_envelope_id,
                    api_key=marina.dropboxsign_api_key,
                )
            else:
                request_id, sign_url = create_embedded_sign_url(
                    booking,
                    tpl.dropboxsign_template_id,
                    api_key=marina.dropboxsign_api_key,
                    client_id=marina.dropboxsign_client_id,
                )
                booking.waiver_envelope_id = request_id
                booking.save(update_fields=['waiver_envelope_id'])
            return Response({'sign_url': sign_url})

        # Click-wrap path
        if not booking.waiver_signed:
            booking.waiver_signed = True
            booking.save(update_fields=['waiver_signed'])
            evaluate_pre_cleared(booking)
            booking.refresh_from_db()

        return Response(PortalBookingSerializer(booking).data)
```

- [ ] **Step 5: Run tests to verify they pass**

```
python -m pytest apps/portal/tests_checkin.py -v
```

Expected: all `PASSED`

- [ ] **Step 6: Commit**

```
git add apps/portal/checkin_views.py apps/portal/tests_checkin.py
git commit -m "feat: WaiverView supports both click-wrap and DS esign modes based on marina credentials"
```

---

### Task 5: Update `WaiverItem.jsx` to handle both modes

**Files:**
- Modify: `portal/src/components/portal/checklist/WaiverItem.jsx`

**Context:** The current `WaiverItem.jsx` (click-wrap only) calls GET on mount and shows a checkbox + confirm button. Now GET returns `{mode, waiver_url}` for click-wrap or `{mode, waiver_url, sign_url}` for esign. The esign UI shows the PDF link, a "Sign with Dropbox Sign" button that opens `sign_url` in a new tab, then a "I've signed — refresh" button. POST is only called for click-wrap confirmation.

- [ ] **Step 1: Replace `WaiverItem.jsx`**

```jsx
// portal/src/components/portal/checklist/WaiverItem.jsx
import { useState, useEffect } from 'react';
import api from '../../../api';

function PdfLink({ url }) {
  if (!url) return null;
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6,
        marginBottom: 18, textDecoration: 'none',
        fontSize: 13, fontWeight: 600, color: 'var(--navy)',
      }}
    >
      <svg
        style={{ width: 14, height: 14, stroke: 'currentColor', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', flexShrink: 0 }}
        viewBox="0 0 24 24"
      >
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <polyline points="14 2 14 8 20 8"/>
      </svg>
      Read Waiver (PDF)
    </a>
  );
}

function ClickWrapUI({ waiverUrl, bookingId, onUpdate }) {
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  async function handleConfirm() {
    setSubmitting(true);
    setError(null);
    try {
      await api.post(`/portal/checkin/bookings/${bookingId}/waiver/`);
      onUpdate();
    } catch {
      setError('Something went wrong. Please try again.');
      setSubmitting(false);
    }
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 16, lineHeight: 1.6 }}>
        The marina requires you to read and accept the waiver before arrival.
      </p>
      <PdfLink url={waiverUrl} />
      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', marginBottom: 18 }}>
        <input
          type="checkbox"
          checked={agreed}
          onChange={e => setAgreed(e.target.checked)}
          style={{ marginTop: 2, flexShrink: 0, width: 16, height: 16 }}
        />
        <span style={{ fontSize: 13, color: 'rgba(0,0,0,0.75)', lineHeight: 1.5 }}>
          I have read and agree to the marina waiver
        </span>
      </label>
      {error && <p style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</p>}
      <button
        className="p-btn p-btn--primary"
        disabled={!agreed || submitting}
        onClick={handleConfirm}
      >
        {submitting ? 'Confirming…' : 'Confirm Agreement'}
      </button>
    </div>
  );
}

function EsignUI({ waiverUrl, signUrl, onUpdate }) {
  const [opened, setOpened] = useState(false);

  function handleSign() {
    window.open(signUrl, '_blank', 'noopener,noreferrer');
    setOpened(true);
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)', marginBottom: 16, lineHeight: 1.6 }}>
        The marina requires a signed waiver before arrival. Review the document then sign electronically.
      </p>
      <PdfLink url={waiverUrl} />
      <button className="p-btn p-btn--primary" onClick={handleSign} style={{ marginBottom: 12 }}>
        <svg style={{ width: 14, height: 14, verticalAlign: 'middle', marginRight: 6, stroke: 'currentColor', fill: 'none', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }} viewBox="0 0 24 24">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
        Sign Waiver
      </button>
      {opened && (
        <button
          style={{ display: 'block', width: '100%', marginTop: 4, height: 44, background: 'transparent', border: 'none', fontSize: 14, color: 'rgba(0,0,0,0.4)', cursor: 'pointer', fontFamily: 'IBM Plex Sans, sans-serif' }}
          onClick={onUpdate}
        >
          I've signed — refresh
        </button>
      )}
    </div>
  );
}

export default function WaiverItem({ booking, onUpdate }) {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/portal/checkin/bookings/${booking.id}/waiver/`)
      .then(res => setState(res.data))
      .catch(() => setState(null))
      .finally(() => setLoading(false));
  }, [booking.id]);

  if (loading) {
    return <p style={{ fontSize: 13, color: 'rgba(0,0,0,0.4)' }}>Loading waiver…</p>;
  }

  if (!state) {
    return <p style={{ fontSize: 13, color: 'var(--red)' }}>Waiver not available. Contact the marina.</p>;
  }

  if (state.mode === 'esign') {
    return <EsignUI waiverUrl={state.waiver_url} signUrl={state.sign_url} onUpdate={onUpdate} />;
  }

  return <ClickWrapUI waiverUrl={state.waiver_url} bookingId={booking.id} onUpdate={onUpdate} />;
}
```

- [ ] **Step 2: Verify no import errors by running the portal dev server briefly**

```
cd portal
npm run dev
```

Check the browser console on the checklist screen — no JS errors. Then stop the server.

- [ ] **Step 3: Commit**

```
git add portal/src/components/portal/checklist/WaiverItem.jsx
git commit -m "feat: WaiverItem handles click-wrap and esign modes"
```

---

### Task 6: Add Integrations tab to Settings.jsx

**Files:**
- Modify: `frontend/src/screens/Settings.jsx`

**Context:** `Settings.jsx` has a tab bar defined at line ~515. Tabs array: `[['marina', ...], ['users', ...], ['billing', ...], ['notifications', ...], ['system', ...]]`. Add `['integrations', 'Integrations', false]`. The integrations panel is a single card with a Dropbox Sign section. It calls `GET /api/v1/marina/integrations/dropbox-sign/` on load and `PATCH` on save. The form has: Client ID (text input), API Key (password input, placeholder "Paste new key to update, leave blank to keep current"), a Save button, and a Disconnect button (visible only when `connected`).

- [ ] **Step 1: Add a `useDropboxSignSettings` hook inline at the top of the settings component**

Find the section near the top of `Settings.jsx` where `useState` hooks are declared (around line 343, where `const [tab, setTab] = useState('marina')` lives). Below the existing state declarations, add:

```javascript
// Integrations — Dropbox Sign
const [dsSettings, setDsSettings] = useState(null);
const [dsLoading, setDsLoading]   = useState(false);
const [dsApiKey, setDsApiKey]     = useState('');
const [dsClientId, setDsClientId] = useState('');
const [dsSaving, setDsSaving]     = useState(false);
const [dsMsg, setDsMsg]           = useState(null);

useEffect(() => {
  if (tab !== 'integrations') return;
  setDsLoading(true);
  api.get('/marina/integrations/dropbox-sign/')
    .then(r => {
      setDsSettings(r.data);
      setDsClientId(r.data.client_id || '');
    })
    .finally(() => setDsLoading(false));
}, [tab]);

async function handleDsSave() {
  setDsSaving(true);
  setDsMsg(null);
  try {
    const r = await api.patch('/marina/integrations/dropbox-sign/', {
      api_key: dsApiKey,
      client_id: dsClientId,
    });
    setDsSettings(r.data);
    setDsApiKey('');
    setDsMsg({ type: 'ok', text: r.data.connected ? 'Connected.' : 'Settings saved.' });
  } catch {
    setDsMsg({ type: 'err', text: 'Save failed. Check credentials and try again.' });
  } finally {
    setDsSaving(false);
  }
}

async function handleDsDisconnect() {
  setDsSaving(true);
  setDsMsg(null);
  try {
    const r = await api.patch('/marina/integrations/dropbox-sign/', { api_key: '', client_id: '' });
    setDsSettings(r.data);
    setDsClientId('');
    setDsApiKey('');
    setDsMsg({ type: 'ok', text: 'Disconnected.' });
  } finally {
    setDsSaving(false);
  }
}
```

- [ ] **Step 2: Add the tab to the tab bar**

Find the tabs array (around line 515–521):
```javascript
{[
  ['marina',        'Marina Profile',   false],
  ['users',         'Users & Roles',    false],
  ['billing',       'Billing',          false],
  ['notifications', 'Notifications',    true],
  ['system',        'System',           false],
].map(...)
```

Replace with:
```javascript
{[
  ['marina',        'Marina Profile',   false],
  ['users',         'Users & Roles',    false],
  ['billing',       'Billing',          false],
  ['notifications', 'Notifications',    true],
  ['integrations',  'Integrations',     false],
  ['system',        'System',           false],
].map(...)
```

- [ ] **Step 3: Add the integrations panel**

Find the end of the `{tab === 'system' && ...}` block and add after it:

```jsx
{tab === 'integrations' && (
  <div style={{ maxWidth: 560 }}>
    <div className="card">
      <div className="card-header">
        <div className="card-header-title">Dropbox Sign</div>
        {dsSettings?.connected && (
          <span className="badge badge-green" style={{ fontSize: 10 }}>Connected</span>
        )}
      </div>
      <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {dsLoading ? (
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.35)' }}>Loading…</div>
        ) : (
          <>
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', lineHeight: 1.6 }}>
              Connect your marina's own Dropbox Sign account to enable e-signatures on waivers. Your account is billed directly by Dropbox Sign — DocksBase never sees payment.{' '}
              <a href="https://app.hellosign.com/account/signUp" target="_blank" rel="noreferrer" style={{ color: 'var(--navy)' }}>
                Create a Dropbox Sign account →
              </a>
            </div>
            <FieldRow label="Client ID" hint="Found in Dropbox Sign → API → App Settings">
              <input
                type="text"
                value={dsClientId}
                onChange={e => setDsClientId(e.target.value)}
                placeholder="e.g. a1b2c3d4e5f6..."
              />
            </FieldRow>
            <FieldRow
              label="API Key"
              hint={dsSettings?.connected ? `Current key ending in ···${dsSettings.api_key_tail}` : 'Found in Dropbox Sign → API → API Keys'}
            >
              <input
                type="password"
                value={dsApiKey}
                onChange={e => setDsApiKey(e.target.value)}
                placeholder={dsSettings?.connected ? 'Leave blank to keep current key' : 'Paste API key here'}
                autoComplete="new-password"
              />
            </FieldRow>
            {dsMsg && (
              <div style={{ fontSize: 12, color: dsMsg.type === 'ok' ? 'var(--teal)' : 'var(--red)', fontWeight: 600 }}>
                {dsMsg.text}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={handleDsSave} disabled={dsSaving}>
                {dsSaving ? 'Saving…' : dsSettings?.connected ? 'Update' : 'Connect'}
              </button>
              {dsSettings?.connected && (
                <button className="btn btn-ghost" style={{ color: 'var(--red)' }} onClick={handleDsDisconnect} disabled={dsSaving}>
                  Disconnect
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Run the management dev server and manually verify**

```
cd frontend
npm run dev
```

Navigate to Settings → Integrations. Verify:
- Page loads without errors
- "Connect" button shows when not connected
- Pasting a fake key and client ID and clicking Connect shows "Connected." with the badge
- Disconnect clears and shows "Disconnected."

Stop the server.

- [ ] **Step 5: Commit**

```
git add frontend/src/screens/Settings.jsx
git commit -m "feat: add Integrations tab to Settings with Dropbox Sign connect/disconnect form"
```

---

### Task 7: Final integration smoke test

**Files:**
- No new files

**Context:** Run the full test suite to confirm nothing is broken end to end.

- [ ] **Step 1: Run all affected test modules**

```
cd backend
python -m pytest apps/accounts/tests.py apps/documents/tests.py apps/portal/tests_checkin.py -v
```

Expected: all `PASSED`

- [ ] **Step 2: Commit if any test fixes were needed**

```
git add -A
git commit -m "fix: resolve any test failures from BYOK DS integration"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Task |
|---|---|
| Per-marina `api_key` + `client_id` fields | Task 1 |
| GET/PATCH `/marina/integrations/dropbox-sign/` | Task 2 |
| API key never returned in full (masked) | Task 2 |
| Service layer uses marina credentials | Task 3 |
| `create_embedded_sign_url` helper | Task 3 |
| WaiverView click-wrap fallback | Task 4 |
| WaiverView esign mode with DS | Task 4 |
| WaiverItem handles both modes | Task 5 |
| Settings Integrations tab UI | Task 6 |
| Connect/disconnect form | Task 6 |

All requirements covered. No placeholders found. Type/method names are consistent across tasks (`create_embedded_sign_url`, `get_existing_embedded_sign_url`, `dropboxsign_api_key`, `dropboxsign_client_id`).
