# Documents & eSign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Documents & eSign module — Dropbox Sign contract templates, envelope send/track, member insurance/registration uploads, and expiry management.

**Architecture:** Django `documents` app enriched with three models (DocTemplate, Envelope, MemberDocument), a Dropbox Sign service layer in `services.py`, and a webhook handler that is HMAC-verified and double-keyed by `marina_id` to prevent cross-tenant data access. Frontend gets three new hooks and two screens wired up.

**Tech Stack:** Django 6, DRF, `dropbox-sign` Python SDK, Django FileField (MEDIA_ROOT), React hooks.

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `backend/requirements.txt` | Modify | Add `dropbox-sign` |
| `backend/.env.example` | Create | Document DROPBOX_SIGN_* env vars |
| `backend/config/settings/base.py` | Modify | MEDIA_ROOT, MEDIA_URL, DROPBOX_SIGN_* settings |
| `backend/config/settings/dev.py` | Modify | MEDIA serving in debug |
| `backend/config/urls.py` | Modify | Add `static(MEDIA_URL, …)` in DEBUG |
| `backend/apps/documents/models.py` | Modify | Enrich DocTemplate + Envelope; add MemberDocument |
| `backend/apps/documents/migrations/0002_doctemplate_file_and_dsign_id.py` | Create | Add `file` + `dropboxsign_template_id` to DocTemplate |
| `backend/apps/documents/migrations/0003_envelope_ordering_dsign_request_id.py` | Create | Add `dropboxsign_request_id` + Meta.ordering to Envelope |
| `backend/apps/documents/migrations/0004_memberdocument.py` | Create | New MemberDocument model |
| `backend/apps/documents/serializers.py` | Create | DocTemplateSerializer, EnvelopeSerializer, MemberDocumentSerializer |
| `backend/apps/documents/services.py` | Create | Dropbox Sign API calls (mocked in tests) |
| `backend/apps/documents/views.py` | Modify | Replace placeholder; all views + webhook handler |
| `backend/apps/documents/urls.py` | Modify | Wire all endpoints |
| `backend/apps/documents/management/__init__.py` | Create | Package init |
| `backend/apps/documents/management/commands/__init__.py` | Create | Package init |
| `backend/apps/documents/management/commands/check_document_expiry.py` | Create | Daily expiry management command |
| `backend/apps/documents/tests.py` | Create | Full test suite |
| `backend/apps/documents/admin.py` | Modify | Register MemberDocument |
| `frontend/src/hooks/useDocTemplates.js` | Create | CRUD + prepare + send for doc templates |
| `frontend/src/hooks/useEnvelopes.js` | Create | List + create + download for envelopes |
| `frontend/src/hooks/useMemberDocuments.js` | Create | List + upload + patch for member docs |
| `frontend/src/screens/Documents.jsx` | Modify | Wire Templates + Envelopes tabs to real API |
| `frontend/src/screens/Members.jsx` | Modify | Wire Document Vault tab to real API |

---

### Task 1: Dependencies, Settings, and Media

**Files:**
- Modify: `backend/requirements.txt`
- Create: `backend/.env.example`
- Modify: `backend/config/settings/base.py`
- Modify: `backend/config/settings/dev.py`
- Modify: `backend/config/urls.py`

- [ ] **Step 1: Add dropbox-sign to requirements**

Append to `backend/requirements.txt`:
```
dropbox-sign>=1.0,<2.0
```

- [ ] **Step 2: Create .env.example**

Create `backend/.env.example`:
```
# Dropbox Sign (HelloSign)
DROPBOX_SIGN_API_KEY=
DROPBOX_SIGN_CLIENT_ID=
DROPBOX_SIGN_WEBHOOK_SECRET=
```

- [ ] **Step 3: Add settings to base.py**

In `backend/config/settings/base.py`, after `STATIC_URL = 'static/'`, add:
```python
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

import environ
env = environ.Env()
DROPBOX_SIGN_API_KEY = env('DROPBOX_SIGN_API_KEY', default='')
DROPBOX_SIGN_CLIENT_ID = env('DROPBOX_SIGN_CLIENT_ID', default='')
DROPBOX_SIGN_WEBHOOK_SECRET = env('DROPBOX_SIGN_WEBHOOK_SECRET', default='')
```

Wait — the project doesn't use `django-environ`. Use `os.environ.get` instead:

```python
import os

MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

DROPBOX_SIGN_API_KEY = os.environ.get('DROPBOX_SIGN_API_KEY', '')
DROPBOX_SIGN_CLIENT_ID = os.environ.get('DROPBOX_SIGN_CLIENT_ID', '')
DROPBOX_SIGN_WEBHOOK_SECRET = os.environ.get('DROPBOX_SIGN_WEBHOOK_SECRET', '')
```

- [ ] **Step 4: Serve media files in dev**

In `backend/config/settings/dev.py`, add at bottom:
```python
MEDIA_ROOT = BASE_DIR / 'media'
```

(already set in base but explicit override is fine; dev.py sets DEBUG = True so the urls.py check works)

In `backend/config/urls.py`, add media serving:
```python
from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('admin/', admin.site.urls),
    path('api/v1/', include([
        path('auth/', include('apps.accounts.urls')),
        path('', include('apps.berths.urls')),
        path('', include('apps.reservations.urls')),
        path('', include('apps.vessels.urls')),
        path('', include('apps.members.urls')),
        path('', include('apps.billing.urls')),
        path('', include('apps.maintenance.urls')),
        path('', include('apps.staff.urls')),
        path('', include('apps.boatyard.urls')),
        path('', include('apps.documents.urls')),
        path('', include('apps.restaurant.urls')),
        path('', include('apps.events.urls')),
        path('', include('apps.sales.urls')),
        path('', include('apps.reports.urls')),
        path('', include('apps.fuel_dock.urls')),
        path('marina/', include('apps.accounts.marina_urls')),
    ])),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
```

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt backend/.env.example backend/config/settings/base.py backend/config/urls.py
git commit -m "feat(documents): add dropbox-sign dep, media settings, and DROPBOX_SIGN_* env vars"
```

---

### Task 2: Model Enrichment and Migrations

**Files:**
- Modify: `backend/apps/documents/models.py`
- Create: `backend/apps/documents/migrations/0002_doctemplate_file_and_dsign_id.py`
- Create: `backend/apps/documents/migrations/0003_envelope_ordering_dsign_request_id.py`
- Create: `backend/apps/documents/migrations/0004_memberdocument.py`
- Modify: `backend/apps/documents/admin.py`

- [ ] **Step 1: Write the failing test**

In `backend/apps/documents/tests.py`:
```python
from django.test import TestCase
from django.contrib.auth import get_user_model
from apps.accounts.models import Marina
from apps.members.models import Member
from apps.vessels.models import Vessel
from apps.documents.models import DocTemplate, Envelope, MemberDocument

User = get_user_model()


def make_marina():
    return Marina.objects.create(name='Test Marina', slug='test-marina')


def make_member(marina):
    return Member.objects.create(marina=marina, name='Alice Skipper', email='alice@example.com')


def make_vessel(marina, member):
    return Vessel.objects.create(marina=marina, name='Sea Witch', owner=member)


class ModelFieldTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)
        self.vessel = make_vessel(self.marina, self.member)

    def test_doctemplate_has_dsign_id_field(self):
        t = DocTemplate.objects.create(marina=self.marina, name='Lease', category='lease')
        t.dropboxsign_template_id = 'tpl_abc123'
        t.save()
        self.assertEqual(DocTemplate.objects.get(pk=t.pk).dropboxsign_template_id, 'tpl_abc123')

    def test_envelope_has_dsign_request_id(self):
        tpl = DocTemplate.objects.create(marina=self.marina, name='Lease', category='lease')
        env = Envelope.objects.create(marina=self.marina, template=tpl, recipient=self.member)
        env.dropboxsign_request_id = 'req_xyz789'
        env.save()
        self.assertEqual(Envelope.objects.get(pk=env.pk).dropboxsign_request_id, 'req_xyz789')

    def test_memberdocument_creates(self):
        doc = MemberDocument.objects.create(
            marina=self.marina,
            member=self.member,
            doc_type='insurance',
            status='pending_upload',
        )
        self.assertEqual(doc.marina, self.marina)
        self.assertEqual(doc.doc_type, 'insurance')
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python manage.py test apps.documents.tests.ModelFieldTest --settings=config.settings.dev -v2
```

Expected: `AttributeError` — `DocTemplate has no attribute dropboxsign_template_id` or `MemberDocument not found`.

- [ ] **Step 3: Update models.py**

Replace `backend/apps/documents/models.py` entirely:
```python
from django.db import models


class DocTemplate(models.Model):
    CATEGORY = [('lease', 'Lease'), ('insurance', 'Insurance'), ('waiver', 'Waiver'), ('other', 'Other')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='doc_templates')
    name = models.CharField(max_length=200)
    category = models.CharField(max_length=20, choices=CATEGORY, default='other')
    pages = models.IntegerField(default=1)
    fields_count = models.IntegerField(default=0)
    uses_count = models.IntegerField(default=0)
    last_used = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    file = models.FileField(upload_to='doc_templates/', blank=True)
    dropboxsign_template_id = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return self.name


class Envelope(models.Model):
    STATUS = [('pending', 'Pending'), ('completed', 'Completed'), ('expired', 'Expired')]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='envelopes')
    template = models.ForeignKey(DocTemplate, on_delete=models.PROTECT)
    recipient = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True)
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True)
    sent_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS, default='pending')
    reminders_sent = models.IntegerField(default=0)
    dropboxsign_request_id = models.CharField(max_length=200, blank=True)

    class Meta:
        ordering = ['-sent_at']

    def __str__(self):
        return f'Envelope #{self.pk} — {self.template.name}'


class MemberDocument(models.Model):
    DOC_TYPE = [('insurance', 'Insurance'), ('registration', 'Registration')]
    STATUS = [
        ('pending_upload', 'Pending Upload'),
        ('uploaded', 'Uploaded'),
        ('verified', 'Verified'),
        ('due_soon', 'Due Soon'),
        ('expired', 'Expired'),
    ]

    marina = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='member_documents')
    member = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='documents')
    vessel = models.ForeignKey('vessels.Vessel', on_delete=models.SET_NULL, null=True, blank=True, related_name='documents')
    doc_type = models.CharField(max_length=20, choices=DOC_TYPE)
    file = models.FileField(upload_to='member_docs/', blank=True)
    expiry_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=20, choices=STATUS, default='pending_upload')
    notes = models.TextField(blank=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-uploaded_at']

    def __str__(self):
        return f'{self.get_doc_type_display()} — {self.member.name}'
```

- [ ] **Step 4: Generate migrations**

```bash
cd backend && python manage.py makemigrations documents --settings=config.settings.dev
```

Expected: three migration files created (0002, 0003, 0004).

- [ ] **Step 5: Apply migrations**

```bash
cd backend && python manage.py migrate --settings=config.settings.dev
```

Expected: `OK` for all three.

- [ ] **Step 6: Update admin.py**

Replace `backend/apps/documents/admin.py`:
```python
from django.contrib import admin
from .models import DocTemplate, Envelope, MemberDocument

admin.site.register(DocTemplate)
admin.site.register(Envelope)
admin.site.register(MemberDocument)
```

- [ ] **Step 7: Run model tests**

```bash
cd backend && python manage.py test apps.documents.tests.ModelFieldTest --settings=config.settings.dev -v2
```

Expected: 3 tests PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/apps/documents/models.py backend/apps/documents/migrations/ backend/apps/documents/admin.py backend/apps/documents/tests.py
git commit -m "feat(documents): enrich DocTemplate/Envelope models; add MemberDocument"
```

---

### Task 3: Serializers

**Files:**
- Create: `backend/apps/documents/serializers.py`

- [ ] **Step 1: Write failing test**

Add to `backend/apps/documents/tests.py`:
```python
from apps.documents.serializers import DocTemplateSerializer, EnvelopeSerializer, MemberDocumentSerializer


class SerializerTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)
        self.vessel = make_vessel(self.marina, self.member)
        self.template = DocTemplate.objects.create(marina=self.marina, name='Lease', category='lease')

    def test_doctemplate_serializer_fields(self):
        s = DocTemplateSerializer(self.template)
        self.assertIn('id', s.data)
        self.assertIn('dropboxsign_template_id', s.data)
        self.assertIn('file', s.data)

    def test_envelope_serializer_fields(self):
        env = Envelope.objects.create(marina=self.marina, template=self.template, recipient=self.member)
        s = EnvelopeSerializer(env)
        self.assertIn('id', s.data)
        self.assertIn('template_name', s.data)
        self.assertIn('recipient_name', s.data)
        self.assertIn('status', s.data)

    def test_memberdocument_serializer_fields(self):
        doc = MemberDocument.objects.create(marina=self.marina, member=self.member, doc_type='insurance')
        s = MemberDocumentSerializer(doc)
        self.assertIn('id', s.data)
        self.assertIn('member_name', s.data)
        self.assertIn('doc_type', s.data)
        self.assertIn('status', s.data)
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python manage.py test apps.documents.tests.SerializerTest --settings=config.settings.dev -v2
```

Expected: `ImportError` — `serializers` module does not exist.

- [ ] **Step 3: Create serializers.py**

Create `backend/apps/documents/serializers.py`:
```python
from rest_framework import serializers
from .models import DocTemplate, Envelope, MemberDocument


class DocTemplateSerializer(serializers.ModelSerializer):
    class Meta:
        model = DocTemplate
        fields = [
            'id', 'name', 'category', 'pages', 'fields_count',
            'uses_count', 'last_used', 'created_at',
            'file', 'dropboxsign_template_id',
        ]
        read_only_fields = ['uses_count', 'last_used', 'created_at', 'dropboxsign_template_id']


class EnvelopeSerializer(serializers.ModelSerializer):
    template_name = serializers.CharField(source='template.name', read_only=True)
    recipient_name = serializers.CharField(source='recipient.name', read_only=True, default='')
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, default='')

    class Meta:
        model = Envelope
        fields = [
            'id', 'template', 'template_name',
            'recipient', 'recipient_name',
            'vessel', 'vessel_name',
            'sent_at', 'expires_at', 'completed_at',
            'status', 'reminders_sent', 'dropboxsign_request_id',
        ]
        read_only_fields = ['sent_at', 'completed_at', 'status', 'reminders_sent', 'dropboxsign_request_id']


class MemberDocumentSerializer(serializers.ModelSerializer):
    member_name = serializers.CharField(source='member.name', read_only=True)
    vessel_name = serializers.CharField(source='vessel.name', read_only=True, default='')

    class Meta:
        model = MemberDocument
        fields = [
            'id', 'member', 'member_name', 'vessel', 'vessel_name',
            'doc_type', 'file', 'expiry_date', 'status', 'notes', 'uploaded_at',
        ]
        read_only_fields = ['uploaded_at']
```

- [ ] **Step 4: Run tests**

```bash
cd backend && python manage.py test apps.documents.tests.SerializerTest --settings=config.settings.dev -v2
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/documents/serializers.py backend/apps/documents/tests.py
git commit -m "feat(documents): add DocTemplate, Envelope, MemberDocument serializers"
```

---

### Task 4: Dropbox Sign Service Layer

**Files:**
- Create: `backend/apps/documents/services.py`

- [ ] **Step 1: Write failing test**

Add to `backend/apps/documents/tests.py`:
```python
from unittest.mock import patch, MagicMock
from apps.documents.services import (
    create_embedded_template_draft,
    send_envelope,
    get_signed_pdf_url,
)


class ServiceLayerTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)
        self.template = DocTemplate.objects.create(marina=self.marina, name='Lease', category='lease')

    @patch('apps.documents.services.dropbox_sign')
    def test_create_embedded_template_draft_returns_edit_url(self, mock_ds):
        mock_api = MagicMock()
        mock_ds.TemplateApi.return_value = mock_api
        mock_api.create_embedded_template_draft.return_value.embedded_template.edit_url = 'https://dsign.example/edit/abc'

        result = create_embedded_template_draft(self.template, file_path='/tmp/test.pdf')

        self.assertEqual(result, 'https://dsign.example/edit/abc')
        mock_api.create_embedded_template_draft.assert_called_once()

    @patch('apps.documents.services.dropbox_sign')
    def test_send_envelope_returns_request_id(self, mock_ds):
        mock_api = MagicMock()
        mock_ds.SignatureRequestApi.return_value = mock_api
        mock_api.send_with_template.return_value.signature_request.signature_request_id = 'req_abc123'

        tpl = DocTemplate.objects.create(
            marina=self.marina, name='Waiver', category='waiver',
            dropboxsign_template_id='tpl_real_id',
        )
        env = Envelope.objects.create(marina=self.marina, template=tpl, recipient=self.member)
        result = send_envelope(env)

        self.assertEqual(result, 'req_abc123')
        mock_api.send_with_template.assert_called_once()

    @patch('apps.documents.services.dropbox_sign')
    def test_get_signed_pdf_url(self, mock_ds):
        mock_api = MagicMock()
        mock_ds.SignatureRequestApi.return_value = mock_api
        mock_api.get.return_value.signature_request.signing_url = 'https://dsign.example/signed.pdf'

        url = get_signed_pdf_url('req_abc123')
        self.assertEqual(url, 'https://dsign.example/signed.pdf')
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd backend && python manage.py test apps.documents.tests.ServiceLayerTest --settings=config.settings.dev -v2
```

Expected: `ImportError` — `services` module does not exist.

- [ ] **Step 3: Create services.py**

Create `backend/apps/documents/services.py`:
```python
import dropbox_sign as dropbox_sign
from dropbox_sign import ApiClient, ApiException
from dropbox_sign.models import (
    EmbeddedCreateEmbeddedTemplateDraftRequest,
    SignatureRequestSendWithTemplateRequest,
    SubSignatureRequestTemplateSigner,
    SubFieldOptions,
)
from django.conf import settings


def _client():
    configuration = dropbox_sign.Configuration(username=settings.DROPBOX_SIGN_API_KEY)
    return ApiClient(configuration)


def create_embedded_template_draft(template, file_path: str) -> str:
    """Upload PDF to Dropbox Sign embedded editor. Returns edit_url."""
    with _client() as client:
        api = dropbox_sign.TemplateApi(client)
        data = EmbeddedCreateEmbeddedTemplateDraftRequest(
            client_id=settings.DROPBOX_SIGN_CLIENT_ID,
            files=[open(file_path, 'rb')],
            title=template.name,
            signer_roles=[{'name': 'Member', 'order': 0}],
            metadata={
                'marina_id': str(template.marina_id),
                'template_pk': str(template.pk),
            },
        )
        result = api.create_embedded_template_draft(data)
        return result.embedded_template.edit_url


def send_envelope(envelope) -> str:
    """Send signature request for an envelope. Returns dropboxsign_request_id."""
    with _client() as client:
        api = dropbox_sign.SignatureRequestApi(client)
        signers = [
            SubSignatureRequestTemplateSigner(
                role='Member',
                name=envelope.recipient.name,
                email_address=envelope.recipient.email,
            )
        ]
        data = SignatureRequestSendWithTemplateRequest(
            template_ids=[envelope.template.dropboxsign_template_id],
            signers=signers,
            metadata={
                'marina_id': str(envelope.marina_id),
                'envelope_pk': str(envelope.pk),
            },
        )
        if envelope.expires_at:
            data.expires_at = int(envelope.expires_at.strftime('%s'))
        result = api.send_with_template(data)
        return result.signature_request.signature_request_id


def get_signed_pdf_url(signature_request_id: str) -> str:
    """Fetch the signed PDF download URL from Dropbox Sign."""
    with _client() as client:
        api = dropbox_sign.SignatureRequestApi(client)
        result = api.get(signature_request_id)
        return result.signature_request.signing_url
```

- [ ] **Step 4: Run tests**

```bash
cd backend && python manage.py test apps.documents.tests.ServiceLayerTest --settings=config.settings.dev -v2
```

Expected: 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/documents/services.py backend/apps/documents/tests.py
git commit -m "feat(documents): add Dropbox Sign service layer with marina_id metadata injection"
```

---

### Task 5: Views and Webhook Handler

**Files:**
- Modify: `backend/apps/documents/views.py`

- [ ] **Step 1: Write failing tests**

Add to `backend/apps/documents/tests.py`:
```python
import json
import hmac
import hashlib
import time
from django.urls import reverse
from rest_framework.test import APIClient
from unittest.mock import patch

User = get_user_model()


def make_user(marina):
    u = User.objects.create_user(username='manager', password='pass', marina=marina)
    return u


class DocTemplateViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.user = make_user(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_list_scoped_to_marina(self):
        DocTemplate.objects.create(marina=self.marina, name='Lease', category='lease')
        other = Marina.objects.create(name='Other Marina', slug='other')
        DocTemplate.objects.create(marina=other, name='Other Lease', category='lease')

        resp = self.client.get('/api/v1/doc-templates/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(resp.data['results'] if 'results' in resp.data else resp.data), 1)

    @patch('apps.documents.views.create_embedded_template_draft')
    def test_prepare_returns_edit_url(self, mock_prepare):
        mock_prepare.return_value = 'https://dsign.example/edit/abc'
        tpl = DocTemplate.objects.create(marina=self.marina, name='Lease', category='lease')
        resp = self.client.post(f'/api/v1/doc-templates/{tpl.pk}/prepare/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data['edit_url'], 'https://dsign.example/edit/abc')


class EnvelopeViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)
        self.user = make_user(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.template = DocTemplate.objects.create(
            marina=self.marina, name='Lease', category='lease',
            dropboxsign_template_id='tpl_real',
        )

    @patch('apps.documents.views.send_envelope')
    def test_create_envelope_calls_dropboxsign(self, mock_send):
        mock_send.return_value = 'req_abc'
        resp = self.client.post('/api/v1/envelopes/', {
            'template': self.template.pk,
            'recipient': self.member.pk,
        })
        self.assertEqual(resp.status_code, 201)
        env = Envelope.objects.get(pk=resp.data['id'])
        self.assertEqual(env.dropboxsign_request_id, 'req_abc')

    def test_webhook_rejects_invalid_hmac(self):
        resp = self.client.post(
            '/api/v1/documents/webhook/',
            data='{"event": {}}',
            content_type='application/json',
            HTTP_X_HELLOSIGN_SIGNATURE='badsig',
            HTTP_X_HELLOSIGN_EVENT_TIME='12345',
        )
        self.assertEqual(resp.status_code, 400)

    def test_webhook_marks_envelope_completed(self):
        env = Envelope.objects.create(
            marina=self.marina, template=self.template,
            recipient=self.member,
            dropboxsign_request_id='req_abc',
        )
        event_time = str(int(time.time()))
        event_type = 'signature_request_all_signed'
        secret = 'test-secret'
        sig = hmac.new(secret.encode(), (event_time + event_type).encode(), hashlib.sha256).hexdigest()

        payload = {
            'event': {
                'event_type': event_type,
                'event_time': event_time,
                'signature_request': {
                    'signature_request_id': 'req_abc',
                    'metadata': {
                        'marina_id': str(self.marina.pk),
                        'envelope_pk': str(env.pk),
                    },
                },
            }
        }
        with self.settings(DROPBOX_SIGN_WEBHOOK_SECRET=secret):
            resp = self.client.post(
                '/api/v1/documents/webhook/',
                data=json.dumps({'json': json.dumps(payload)}),
                content_type='application/x-www-form-urlencoded',
                HTTP_X_HELLOSIGN_SIGNATURE=sig,
                HTTP_X_HELLOSIGN_EVENT_TIME=event_time,
            )
        self.assertEqual(resp.status_code, 200)
        env.refresh_from_db()
        self.assertEqual(env.status, 'completed')


class MemberDocumentViewTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)
        self.user = make_user(self.marina)
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_list_scoped_to_marina(self):
        MemberDocument.objects.create(marina=self.marina, member=self.member, doc_type='insurance')
        other = Marina.objects.create(name='Other Marina', slug='other2')
        other_member = Member.objects.create(marina=other, name='Bob', email='bob@example.com')
        MemberDocument.objects.create(marina=other, member=other_member, doc_type='registration')

        resp = self.client.get('/api/v1/member-documents/')
        data = resp.data['results'] if 'results' in resp.data else resp.data
        self.assertEqual(len(data), 1)

    def test_patch_expiry_date(self):
        doc = MemberDocument.objects.create(marina=self.marina, member=self.member, doc_type='insurance')
        resp = self.client.patch(f'/api/v1/member-documents/{doc.pk}/', {'expiry_date': '2027-01-01', 'status': 'verified'})
        self.assertEqual(resp.status_code, 200)
        doc.refresh_from_db()
        self.assertEqual(str(doc.expiry_date), '2027-01-01')
        self.assertEqual(doc.status, 'verified')
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python manage.py test apps.documents.tests.DocTemplateViewTest apps.documents.tests.EnvelopeViewTest apps.documents.tests.MemberDocumentViewTest --settings=config.settings.dev -v2
```

Expected: `404` on all URL lookups — views not implemented yet.

- [ ] **Step 3: Write views.py**

Replace `backend/apps/documents/views.py` entirely:
```python
import json
import hmac
import hashlib
from django.conf import settings
from django.utils import timezone
from rest_framework import generics, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import DocTemplate, Envelope, MemberDocument
from .serializers import DocTemplateSerializer, EnvelopeSerializer, MemberDocumentSerializer
from .services import create_embedded_template_draft, send_envelope, get_signed_pdf_url


class DocTemplateList(generics.ListCreateAPIView):
    serializer_class = DocTemplateSerializer
    parser_classes = [*generics.ListCreateAPIView.parser_classes]

    def get_queryset(self):
        return DocTemplate.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class DocTemplateDetail(generics.RetrieveUpdateDestroyAPIView):
    serializer_class = DocTemplateSerializer

    def get_queryset(self):
        return DocTemplate.objects.filter(marina=self.request.user.marina)


class DocTemplatePrepare(APIView):
    def post(self, request, pk):
        try:
            template = DocTemplate.objects.get(pk=pk, marina=request.user.marina)
        except DocTemplate.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if not template.file:
            return Response({'detail': 'No file uploaded yet.'}, status=status.HTTP_400_BAD_REQUEST)

        edit_url = create_embedded_template_draft(template, template.file.path)
        return Response({'edit_url': edit_url})


class EnvelopeList(generics.ListCreateAPIView):
    serializer_class = EnvelopeSerializer

    def get_queryset(self):
        return Envelope.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        envelope = serializer.save(marina=self.request.user.marina)
        request_id = send_envelope(envelope)
        envelope.dropboxsign_request_id = request_id
        envelope.save(update_fields=['dropboxsign_request_id'])


class EnvelopeDetail(generics.RetrieveAPIView):
    serializer_class = EnvelopeSerializer

    def get_queryset(self):
        return Envelope.objects.filter(marina=self.request.user.marina)


class EnvelopeDownload(APIView):
    def get(self, request, pk):
        try:
            envelope = Envelope.objects.get(pk=pk, marina=request.user.marina)
        except Envelope.DoesNotExist:
            return Response(status=status.HTTP_404_NOT_FOUND)

        if envelope.status != 'completed':
            return Response({'detail': 'Not yet signed.'}, status=status.HTTP_400_BAD_REQUEST)

        url = get_signed_pdf_url(envelope.dropboxsign_request_id)
        return Response({'url': url})


class MemberDocumentList(generics.ListCreateAPIView):
    serializer_class = MemberDocumentSerializer

    def get_queryset(self):
        return MemberDocument.objects.filter(marina=self.request.user.marina)

    def perform_create(self, serializer):
        serializer.save(marina=self.request.user.marina)


class MemberDocumentDetail(generics.RetrieveUpdateAPIView):
    serializer_class = MemberDocumentSerializer

    def get_queryset(self):
        return MemberDocument.objects.filter(marina=self.request.user.marina)


def _verify_hmac(request) -> bool:
    secret = settings.DROPBOX_SIGN_WEBHOOK_SECRET
    if not secret:
        return False
    event_time = request.META.get('HTTP_X_HELLOSIGN_EVENT_TIME', '')
    received_sig = request.META.get('HTTP_X_HELLOSIGN_SIGNATURE', '')
    # Dropbox Sign signs the raw body with SHA-256 HMAC
    body = request.body.decode('utf-8')
    # For form-encoded webhooks, the event_type is inside the JSON
    # Dropbox Sign HMAC = HMAC-SHA256(api_key, event_time + event_type)
    # We need to parse event_type from the payload first
    try:
        if 'json=' in body:
            import urllib.parse
            parsed = urllib.parse.parse_qs(body)
            payload = json.loads(parsed['json'][0])
        else:
            payload = json.loads(body)
        event_type = payload['event']['event_type']
    except (KeyError, json.JSONDecodeError, IndexError):
        return False
    expected = hmac.new(secret.encode(), (event_time + event_type).encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, received_sig)


class DropboxSignWebhook(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        if not _verify_hmac(request):
            return Response({'detail': 'Invalid signature.'}, status=status.HTTP_400_BAD_REQUEST)

        body = request.body.decode('utf-8')
        try:
            if 'json=' in body:
                import urllib.parse
                parsed = urllib.parse.parse_qs(body)
                payload = json.loads(parsed['json'][0])
            else:
                payload = json.loads(body)
            event = payload['event']
            event_type = event['event_type']
        except (KeyError, json.JSONDecodeError, IndexError):
            return Response({'detail': 'Malformed payload.'}, status=status.HTTP_400_BAD_REQUEST)

        if event_type == 'signature_request_all_signed':
            sig_req = event.get('signature_request', {})
            metadata = sig_req.get('metadata', {})
            marina_id = metadata.get('marina_id')
            envelope_pk = metadata.get('envelope_pk')
            if not marina_id or not envelope_pk:
                return Response({'detail': 'Missing marina_id or envelope_pk in metadata.'}, status=status.HTTP_400_BAD_REQUEST)
            try:
                envelope = Envelope.objects.get(pk=envelope_pk, marina_id=marina_id)
            except Envelope.DoesNotExist:
                return Response({'detail': 'Envelope not found.'}, status=status.HTTP_400_BAD_REQUEST)
            envelope.status = 'completed'
            envelope.completed_at = timezone.now()
            envelope.save(update_fields=['status', 'completed_at'])

        elif event_type == 'template_created':
            template_data = event.get('template', {})
            metadata = template_data.get('metadata', {})
            marina_id = metadata.get('marina_id')
            template_pk = metadata.get('template_pk')
            dsign_template_id = template_data.get('template_id', '')
            if not marina_id or not template_pk:
                return Response({'detail': 'Missing marina_id or template_pk in metadata.'}, status=status.HTTP_400_BAD_REQUEST)
            try:
                tpl = DocTemplate.objects.get(pk=template_pk, marina_id=marina_id)
            except DocTemplate.DoesNotExist:
                return Response({'detail': 'Template not found.'}, status=status.HTTP_400_BAD_REQUEST)
            tpl.dropboxsign_template_id = dsign_template_id
            tpl.save(update_fields=['dropboxsign_template_id'])

        return Response({'hash': 'hello api event received'})
```

- [ ] **Step 4: Run tests**

```bash
cd backend && python manage.py test apps.documents.tests.DocTemplateViewTest apps.documents.tests.EnvelopeViewTest apps.documents.tests.MemberDocumentViewTest --settings=config.settings.dev -v2
```

Expected: failures because URLs not wired yet — proceed to Task 6 first, then re-run.

- [ ] **Step 5: Commit work in progress**

```bash
git add backend/apps/documents/views.py backend/apps/documents/tests.py
git commit -m "feat(documents): add DocTemplate, Envelope, MemberDocument views + Dropbox Sign webhook handler"
```

---

### Task 6: URLs

**Files:**
- Modify: `backend/apps/documents/urls.py`

- [ ] **Step 1: Replace urls.py**

Replace `backend/apps/documents/urls.py` entirely:
```python
from django.urls import path
from .views import (
    DocTemplateList, DocTemplateDetail, DocTemplatePrepare,
    EnvelopeList, EnvelopeDetail, EnvelopeDownload,
    MemberDocumentList, MemberDocumentDetail,
    DropboxSignWebhook,
)

urlpatterns = [
    path('doc-templates/', DocTemplateList.as_view()),
    path('doc-templates/<int:pk>/', DocTemplateDetail.as_view()),
    path('doc-templates/<int:pk>/prepare/', DocTemplatePrepare.as_view()),
    path('envelopes/', EnvelopeList.as_view()),
    path('envelopes/<int:pk>/', EnvelopeDetail.as_view()),
    path('envelopes/<int:pk>/download/', EnvelopeDownload.as_view()),
    path('member-documents/', MemberDocumentList.as_view()),
    path('member-documents/<int:pk>/', MemberDocumentDetail.as_view()),
    path('documents/webhook/', DropboxSignWebhook.as_view()),
]
```

- [ ] **Step 2: Run all document tests**

```bash
cd backend && python manage.py test apps.documents --settings=config.settings.dev -v2
```

Expected: all tests PASS.

- [ ] **Step 3: Commit**

```bash
git add backend/apps/documents/urls.py
git commit -m "feat(documents): wire all document, envelope, member-doc, and webhook URLs"
```

---

### Task 7: Expiry Management Command

**Files:**
- Create: `backend/apps/documents/management/__init__.py`
- Create: `backend/apps/documents/management/commands/__init__.py`
- Create: `backend/apps/documents/management/commands/check_document_expiry.py`

- [ ] **Step 1: Write failing test**

Add to `backend/apps/documents/tests.py`:
```python
from datetime import date, timedelta
from django.core.management import call_command


class ExpiryCommandTest(TestCase):
    def setUp(self):
        self.marina = make_marina()
        self.member = make_member(self.marina)
        self.template = DocTemplate.objects.create(marina=self.marina, name='Lease', category='lease')

    def test_verified_doc_past_expiry_becomes_expired(self):
        doc = MemberDocument.objects.create(
            marina=self.marina, member=self.member, doc_type='insurance',
            status='verified', expiry_date=date.today() - timedelta(days=1),
        )
        call_command('check_document_expiry')
        doc.refresh_from_db()
        self.assertEqual(doc.status, 'expired')

    def test_verified_doc_within_30_days_becomes_due_soon(self):
        doc = MemberDocument.objects.create(
            marina=self.marina, member=self.member, doc_type='registration',
            status='verified', expiry_date=date.today() + timedelta(days=15),
        )
        call_command('check_document_expiry')
        doc.refresh_from_db()
        self.assertEqual(doc.status, 'due_soon')

    def test_pending_envelope_past_expiry_becomes_expired(self):
        env = Envelope.objects.create(
            marina=self.marina, template=self.template, recipient=self.member,
            status='pending', expires_at=date.today() - timedelta(days=1),
        )
        call_command('check_document_expiry')
        env.refresh_from_db()
        self.assertEqual(env.status, 'expired')

    def test_completed_envelope_not_touched(self):
        env = Envelope.objects.create(
            marina=self.marina, template=self.template, recipient=self.member,
            status='completed', expires_at=date.today() - timedelta(days=1),
        )
        call_command('check_document_expiry')
        env.refresh_from_db()
        self.assertEqual(env.status, 'completed')
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend && python manage.py test apps.documents.tests.ExpiryCommandTest --settings=config.settings.dev -v2
```

Expected: `CommandError` — command not found.

- [ ] **Step 3: Create management package**

```bash
mkdir -p backend/apps/documents/management/commands
touch backend/apps/documents/management/__init__.py
touch backend/apps/documents/management/commands/__init__.py
```

- [ ] **Step 4: Create the command**

Create `backend/apps/documents/management/commands/check_document_expiry.py`:
```python
from datetime import date, timedelta
from django.core.management.base import BaseCommand
from apps.documents.models import MemberDocument, Envelope


class Command(BaseCommand):
    help = 'Mark expired and due-soon documents; expire pending envelopes.'

    def handle(self, *args, **options):
        today = date.today()
        due_soon_threshold = today + timedelta(days=30)

        # MemberDocument: verified → expired
        expired_docs = MemberDocument.objects.filter(
            expiry_date__lte=today,
        ).exclude(status='expired')
        count_expired = expired_docs.update(status='expired')

        # MemberDocument: verified → due_soon (only verified, not already expired/due_soon)
        due_soon_docs = MemberDocument.objects.filter(
            expiry_date__gt=today,
            expiry_date__lte=due_soon_threshold,
            status='verified',
        )
        count_due_soon = due_soon_docs.update(status='due_soon')

        # Envelope: pending → expired
        expired_envelopes = Envelope.objects.filter(
            expires_at__lte=today,
            status='pending',
        )
        count_env_expired = expired_envelopes.update(status='expired')

        # Phase 3 note: add email (SendGrid) and SMS (Twilio) notifications here
        # before flipping status, using the due_soon_docs / expired_docs querysets.

        self.stdout.write(
            f'Done: {count_expired} docs expired, {count_due_soon} due soon, '
            f'{count_env_expired} envelopes expired.'
        )
```

- [ ] **Step 5: Run tests**

```bash
cd backend && python manage.py test apps.documents.tests.ExpiryCommandTest --settings=config.settings.dev -v2
```

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/apps/documents/management/ backend/apps/documents/tests.py
git commit -m "feat(documents): add check_document_expiry management command"
```

---

### Task 8: Frontend Hooks

**Files:**
- Create: `frontend/src/hooks/useDocTemplates.js`
- Create: `frontend/src/hooks/useEnvelopes.js`
- Create: `frontend/src/hooks/useMemberDocuments.js`

- [ ] **Step 1: Create useDocTemplates.js**

Create `frontend/src/hooks/useDocTemplates.js`:
```javascript
import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useDocTemplates() {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/doc-templates/').then(r => {
      setTemplates(r.data.results ?? r.data);
    }).finally(() => setLoading(false));
  }, []);

  async function uploadTemplate(formData) {
    const { data } = await api.post('/doc-templates/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    setTemplates(prev => [data, ...prev]);
    return data;
  }

  async function prepareTemplate(id) {
    const { data } = await api.post(`/doc-templates/${id}/prepare/`);
    return data.edit_url;
  }

  return { templates, loading, uploadTemplate, prepareTemplate };
}
```

- [ ] **Step 2: Create useEnvelopes.js**

Create `frontend/src/hooks/useEnvelopes.js`:
```javascript
import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useEnvelopes() {
  const [envelopes, setEnvelopes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/envelopes/').then(r => {
      setEnvelopes(r.data.results ?? r.data);
    }).finally(() => setLoading(false));
  }, []);

  async function sendEnvelope(payload) {
    const { data } = await api.post('/envelopes/', payload);
    setEnvelopes(prev => [data, ...prev]);
    return data;
  }

  async function getDownloadUrl(id) {
    const { data } = await api.get(`/envelopes/${id}/download/`);
    return data.url;
  }

  return { envelopes, loading, sendEnvelope, getDownloadUrl };
}
```

- [ ] **Step 3: Create useMemberDocuments.js**

Create `frontend/src/hooks/useMemberDocuments.js`:
```javascript
import { useState, useEffect } from 'react';
import api from '../api.js';

export default function useMemberDocuments() {
  const [memberDocs, setMemberDocs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/member-documents/').then(r => {
      setMemberDocs(r.data.results ?? r.data);
    }).finally(() => setLoading(false));
  }, []);

  async function uploadDoc(formData) {
    const { data } = await api.post('/member-documents/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    setMemberDocs(prev => [data, ...prev]);
    return data;
  }

  async function updateDoc(id, payload) {
    const { data } = await api.patch(`/member-documents/${id}/`, payload);
    setMemberDocs(prev => prev.map(d => d.id === id ? data : d));
    return data;
  }

  return { memberDocs, loading, uploadDoc, updateDoc };
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useDocTemplates.js frontend/src/hooks/useEnvelopes.js frontend/src/hooks/useMemberDocuments.js
git commit -m "feat(documents): add useDocTemplates, useEnvelopes, useMemberDocuments hooks"
```

---

### Task 9: Wire Documents.jsx — Templates Tab

**Files:**
- Modify: `frontend/src/screens/Documents.jsx`

- [ ] **Step 1: Replace the import block and add upload modal**

Replace the top of `frontend/src/screens/Documents.jsx` (lines 1–11) to add the hook and state for the upload modal:

```javascript
import { useState } from 'react';
import useDocTemplates from '../hooks/useDocTemplates.js';
import useEnvelopes from '../hooks/useEnvelopes.js';
import useMembers from '../hooks/useMembers.js';
import StatusBadge from '../components/ui/Badge.jsx';
import Ic from '../components/ui/Icon.jsx';
```

- [ ] **Step 2: Add UploadTemplateModal component**

Add before `export default function Documents()`:
```javascript
function UploadTemplateModal({ onClose, onUpload }) {
  const [name, setName] = useState('');
  const [category, setCategory] = useState('other');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) { setErr('Please select a PDF file.'); return; }
    setSaving(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('name', name);
      fd.append('category', category);
      fd.append('file', file);
      await onUpload(fd);
      onClose();
    } catch (ex) {
      setErr(ex?.response?.data?.detail ?? ex?.message ?? 'Upload failed');
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 460, padding: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 18 }}>Upload Template</div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Template Name</label>
              <input required value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Seasonal Berth Lease" />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Category</label>
              <select value={category} onChange={e => setCategory(e.target.value)}>
                <option value="lease">Lease</option>
                <option value="insurance">Insurance</option>
                <option value="waiver">Waiver</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>PDF File</label>
              <input type="file" accept=".pdf" required onChange={e => setFile(e.target.files[0])} />
            </div>
            {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Uploading…' : 'Upload'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SendEnvelopeModal({ template, members, onClose, onSend }) {
  const [recipientId, setRecipientId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    try {
      await onSend({ template: template.id, recipient: recipientId || null, expires_at: expiresAt || null });
      onClose();
    } catch (ex) {
      setErr(ex?.response?.data?.detail ?? ex?.message ?? 'Send failed');
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 420, padding: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 4 }}>Send Contract</div>
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)', marginBottom: 18 }}>{template.name}</div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Recipient</label>
              <select required value={recipientId} onChange={e => setRecipientId(e.target.value)}>
                <option value="">Select member…</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Expiry Date (optional)</label>
              <input type="date" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
            </div>
            {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Sending…' : 'Send'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite the Documents component**

Replace `export default function Documents()` through end of file:
```javascript
const stMap = {
  completed: 'badge-green',
  pending:   'badge-gold',
  expired:   'badge-red',
};

export default function Documents() {
  const { templates, loading: tplLoading, uploadTemplate, prepareTemplate } = useDocTemplates();
  const { envelopes, loading: envLoading, sendEnvelope, getDownloadUrl } = useEnvelopes();
  const { members } = useMembers();
  const [tab, setTab] = useState('templates');
  const [envFilter, setEnvFilter] = useState('all');
  const [selEnv, setSelEnv] = useState(null);
  const [showUpload, setShowUpload] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState(null);
  const [preparing, setPreparing] = useState(null);

  const filteredEnv = envFilter === 'all' ? envelopes : envelopes.filter(e => e.status === envFilter);

  async function handlePrepare(tpl) {
    setPreparing(tpl.id);
    try {
      const url = await prepareTemplate(tpl.id);
      window.open(url, '_blank');
    } finally {
      setPreparing(null);
    }
  }

  async function handleDownload(env) {
    const url = await getDownloadUrl(env.id);
    window.open(url, '_blank');
  }

  return (
    <div>
      {showUpload && (
        <UploadTemplateModal
          onClose={() => setShowUpload(false)}
          onUpload={uploadTemplate}
        />
      )}
      {sendingTemplate && (
        <SendEnvelopeModal
          template={sendingTemplate}
          members={members}
          onClose={() => setSendingTemplate(null)}
          onSend={sendEnvelope}
        />
      )}

      <div className="tabs">
        {[['templates','Templates'],['envelopes','Envelopes'],['masssend','Mass Send']].map(([v,l]) => (
          <div key={v} className={`tab${tab === v ? ' active' : ''}`} onClick={() => setTab(v)}>{l}</div>
        ))}
      </div>

      {tab === 'templates' && (
        <div>
          <div className="sec-hdr">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div className="sec-hdr-title">Document Templates</div>
              <span className="badge badge-navy">{templates.length}</span>
            </div>
            <button className="btn btn-primary" onClick={() => setShowUpload(true)}><Ic n="plus" s={12} />New Template</button>
          </div>
          {tplLoading ? (
            <div style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
              {templates.map(t => (
                <div key={t.id} className="template-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div className="template-card-name">{t.name}</div>
                    <span className={`badge ${t.dropboxsign_template_id ? 'badge-green' : 'badge-gold'}`} style={{ fontSize: 10, whiteSpace: 'nowrap' }}>
                      {t.dropboxsign_template_id ? 'Ready' : 'Needs Setup'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                    <span className="badge badge-navy">{t.category}</span>
                    <span className="badge badge-gray">{t.pages}p</span>
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)', marginBottom: 14 }}>
                    {t.uses_count} uses · {t.last_used ? `Last used: ${t.last_used}` : 'Never sent'}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {t.dropboxsign_template_id ? (
                      <button className="btn btn-primary btn-sm" onClick={() => setSendingTemplate(t)}><Ic n="pen" s={11} />Send Contract</button>
                    ) : (
                      <button className="btn btn-primary btn-sm" onClick={() => handlePrepare(t)} disabled={preparing === t.id}>
                        {preparing === t.id ? 'Opening…' : 'Prepare for eSign'}
                      </button>
                    )}
                    {t.file && <a className="btn btn-ghost btn-sm" href={t.file} target="_blank" rel="noreferrer">Download</a>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'envelopes' && (
        <div>
          <div className="sec-hdr">
            <div style={{ display: 'flex', gap: 8 }}>
              {[['all','All'],['pending','Pending'],['completed','Completed'],['expired','Expired']].map(([v,l]) => (
                <div
                  key={v}
                  onClick={() => { setEnvFilter(v); setSelEnv(null); }}
                  style={{ cursor: 'pointer', padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 600, background: envFilter === v ? 'var(--navy)' : 'var(--white)', color: envFilter === v ? '#fff' : 'rgba(0,0,0,0.5)', border: 'var(--border)' }}
                >
                  {l}
                  <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: envFilter === v ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.35)' }}>
                    {v === 'all' ? envelopes.length : envelopes.filter(e => e.status === v).length}
                  </span>
                </div>
              ))}
            </div>
          </div>
          {envLoading ? (
            <div style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: selEnv ? '1fr 300px' : '1fr', gap: 16, alignItems: 'start' }}>
              <div className="card" style={{ overflow: 'hidden' }}>
                <table className="tbl">
                  <thead>
                    <tr><th>Template</th><th>Recipient</th><th>Sent</th><th>Expires</th><th>Status</th><th></th></tr>
                  </thead>
                  <tbody>
                    {filteredEnv.map(e => (
                      <tr key={e.id} style={{ cursor: 'pointer', background: selEnv?.id === e.id ? '#f5f8ff' : '' }} onClick={() => setSelEnv(e)}>
                        <td style={{ fontSize: 12 }}>{e.template_name}</td>
                        <td><div className="tbl-name">{e.recipient_name || '—'}</div><div className="tbl-sub">{e.vessel_name}</div></td>
                        <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{e.sent_at ? new Date(e.sent_at).toLocaleDateString() : '—'}</td>
                        <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{e.expires_at || '—'}</td>
                        <td><span className={`badge ${stMap[e.status] || 'badge-gray'}`}>{e.status}</span></td>
                        <td>
                          {e.status === 'completed' && (
                            <button className="btn btn-ghost btn-sm" onClick={ev => { ev.stopPropagation(); handleDownload(e); }}>View PDF</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {selEnv && (
                <div className="detail">
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div className="detail-title">Envelope #{selEnv.id}</div>
                    <button className="btn btn-ghost btn-sm" onClick={() => setSelEnv(null)} style={{ padding: '3px 7px' }}><Ic n="x" s={12} /></button>
                  </div>
                  <span className={`badge ${stMap[selEnv.status] || 'badge-gray'}`} style={{ marginBottom: 14, display: 'inline-block' }}>{selEnv.status}</span>
                  <div style={{ marginTop: 10 }}>
                    {[
                      ['Template', selEnv.template_name],
                      ['Recipient', selEnv.recipient_name || '—'],
                      ['Vessel', selEnv.vessel_name || '—'],
                      ['Sent', selEnv.sent_at ? new Date(selEnv.sent_at).toLocaleDateString() : '—'],
                      ['Expires', selEnv.expires_at || '—'],
                      ['Completed', selEnv.completed_at ? new Date(selEnv.completed_at).toLocaleDateString() : '—'],
                      ['Reminders', selEnv.reminders_sent + ' sent'],
                    ].map(([k, v]) => (
                      <div key={k} className="detail-row">
                        <div className="detail-key">{k}</div>
                        <div className="detail-val">{v}</div>
                      </div>
                    ))}
                  </div>
                  <div className="detail-actions">
                    {selEnv.status === 'completed' && (
                      <button className="btn btn-primary" style={{ justifyContent: 'center' }} onClick={() => handleDownload(selEnv)}>
                        View Signed PDF
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === 'masssend' && (
        <div className="card" style={{ padding: 24, maxWidth: 500 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Mass Send</div>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.4)' }}>
            Mass send requires email/SMS infrastructure. This is scheduled for Phase 3.
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/screens/Documents.jsx
git commit -m "feat(documents): wire Documents.jsx Templates and Envelopes tabs to real API"
```

---

### Task 10: Wire Members.jsx — Document Vault Tab

**Files:**
- Modify: `frontend/src/screens/Members.jsx`

- [ ] **Step 1: Add hook import**

At the top of `frontend/src/screens/Members.jsx`, add:
```javascript
import useMemberDocuments from '../hooks/useMemberDocuments.js';
```

- [ ] **Step 2: Add hook call inside the component**

Inside `export default function Members()`, after existing hook calls, add:
```javascript
const { memberDocs, loading: docsLoading, uploadDoc, updateDoc } = useMemberDocuments();
```

- [ ] **Step 3: Add UploadDocModal component** 

Add before `export default function Members()`:
```javascript
function UploadDocModal({ memberId, members, onClose, onUpload }) {
  const [selectedMember, setSelectedMember] = useState(memberId || '');
  const [docType, setDocType] = useState('insurance');
  const [file, setFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!file) { setErr('Please select a file.'); return; }
    setSaving(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('member', selectedMember);
      fd.append('doc_type', docType);
      fd.append('file', file);
      await onUpload(fd);
      onClose();
    } catch (ex) {
      setErr(ex?.response?.data?.detail ?? ex?.message ?? 'Upload failed');
      setSaving(false);
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="card" style={{ width: 420, padding: 24 }}>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 18 }}>Upload Document</div>
        <form onSubmit={handleSubmit}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Member</label>
              <select required value={selectedMember} onChange={e => setSelectedMember(e.target.value)}>
                <option value="">Select member…</option>
                {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Document Type</label>
              <select value={docType} onChange={e => setDocType(e.target.value)}>
                <option value="insurance">Insurance</option>
                <option value="registration">Registration</option>
              </select>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.4)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>File</label>
              <input type="file" required onChange={e => setFile(e.target.files[0])} />
            </div>
            {err && <div style={{ fontSize: 12, color: 'var(--red)' }}>{err}</div>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Uploading…' : 'Upload'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Replace the `docs` tab section**

Find `{tab === 'docs' && (` in `Members.jsx` and replace the entire `docs` tab block with:
```javascript
      {tab === 'docs' && (
        <div>
          <div className="sec-hdr">
            <div className="sec-hdr-title">Document Vault</div>
            <button className="btn btn-primary btn-sm" onClick={() => setShowUploadDoc(true)}><Ic n="plus" s={11} />Upload Document</button>
          </div>
          {showUploadDoc && (
            <UploadDocModal
              members={members}
              onClose={() => setShowUploadDoc(false)}
              onUpload={uploadDoc}
            />
          )}
          <div className="card" style={{ overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Member</th><th>Type</th><th>Expiry</th><th>Status</th><th>Notes</th><th>Actions</th></tr></thead>
              <tbody>
                {docsLoading ? (
                  <tr><td colSpan={6} style={{ textAlign: 'center', color: 'rgba(0,0,0,0.35)', padding: '20px 0', fontSize: 12 }}>Loading…</td></tr>
                ) : memberDocs.map(d => (
                  <tr key={d.id}>
                    <td className="tbl-name">{d.member_name}</td>
                    <td style={{ fontSize: 12 }}>{d.doc_type}</td>
                    <td style={{ fontSize: 12, color: 'rgba(0,0,0,0.45)' }}>{d.expiry_date || '—'}</td>
                    <td>
                      <span className={`badge ${
                        d.status === 'verified'      ? 'badge-green' :
                        d.status === 'due_soon'      ? 'badge-gold'  :
                        d.status === 'expired'       ? 'badge-red'   : 'badge-gray'
                      }`}>{d.status.replace('_', ' ')}</span>
                    </td>
                    <td style={{ fontSize: 11, color: 'rgba(0,0,0,0.4)' }}>{d.notes || '—'}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      {d.file && <a className="btn btn-ghost btn-sm" href={d.file} target="_blank" rel="noreferrer">View</a>}
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => {
                          const expiry = prompt('Set expiry date (YYYY-MM-DD):', d.expiry_date || '');
                          if (expiry) updateDoc(d.id, { expiry_date: expiry, status: 'verified' });
                        }}
                      >
                        Set Expiry
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Add `showUploadDoc` state**

In `export default function Members()`, find existing `useState` declarations and add:
```javascript
const [showUploadDoc, setShowUploadDoc] = useState(false);
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/screens/Members.jsx
git commit -m "feat(documents): wire Members Document Vault tab to real API"
```

---

## Self-Review

### Spec coverage check

| Spec requirement | Covered in Task |
|---|---|
| `dropbox-sign` dependency | Task 1 |
| `DROPBOX_SIGN_API_KEY/CLIENT_ID/WEBHOOK_SECRET` settings | Task 1 |
| `MEDIA_ROOT` + dev media serving | Task 1 |
| `DocTemplate.file` + `dropboxsign_template_id` | Task 2 |
| `Envelope.dropboxsign_request_id` + `Meta.ordering` | Task 2 |
| `MemberDocument` model (all fields) | Task 2 |
| All serializers with `template_name`, `recipient_name` | Task 3 |
| `create_embedded_template_draft` injects `marina_id` metadata | Task 4 |
| `send_envelope` injects `marina_id` + `envelope_pk` metadata | Task 4 |
| DocTemplate CRUD + `/prepare/` endpoint | Tasks 5–6 |
| Envelope list/create/detail/download endpoints | Tasks 5–6 |
| MemberDocument list/create/detail/patch endpoints | Tasks 5–6 |
| Webhook HMAC verification | Task 5 |
| Webhook double-keyed `marina_id` lookups | Task 5 |
| `template_created` webhook handler | Task 5 |
| `signature_request_all_signed` webhook handler | Task 5 |
| `check_document_expiry` command | Task 7 |
| Phase 3 email/SMS note in command | Task 7 |
| `useDocTemplates`, `useEnvelopes`, `useMemberDocuments` hooks | Task 8 |
| Documents.jsx Templates tab (upload, prepare, send, status badge) | Task 9 |
| Documents.jsx Envelopes tab (filter, detail, download) | Task 9 |
| Mass Send tab → Phase 3 placeholder | Task 9 |
| Members.jsx Document Vault tab (upload, expiry, status badges) | Task 10 |

### Placeholder scan — none found.

### Type consistency — verified: `dropboxsign_template_id` used consistently, `marina_id`/`envelope_pk`/`template_pk` metadata keys consistent across services.py and views.py.
