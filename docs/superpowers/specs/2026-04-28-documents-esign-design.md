# Documents & eSign — Design Spec

**Date:** 2026-04-28
**Status:** Approved
**Branch:** feat/operations-reservations
**Scope:** Backend models, Dropbox Sign integration, member document uploads, expiry tracking, and frontend wire-up for the Documents & eSign screen and Members Document Vault tab.

---

## Context

The `documents` app exists with skeleton models (`DocTemplate`, `Envelope`) and a placeholder view. `Documents.jsx` exists with three tabs (Templates, Envelopes, Mass Send) running on mock data. This spec covers making it real.

---

## Decisions

| Concern | Decision |
|---|---|
| E-sign provider | Dropbox Sign (HelloSign) — clean REST API, Python SDK, embedded template editor, webhooks |
| Signed PDF storage | Dropbox Sign hosts them — backend saves `signature_request_id`, fetches on demand |
| Uploaded doc storage | Local `MEDIA_ROOT` (Django `FileField`) — S3-ready via single settings swap |
| Boater signing UX | Dropbox Sign hosted page — their branding, works on mobile, no custom page needed |
| Expiry notifications | Dashboard flagging only (Phase 3 note: add email via SendGrid + SMS via Twilio) |

---

## 1. Data Models

### `DocTemplate` (enrich existing)

Add to existing skeleton:

| Field | Type | Notes |
|---|---|---|
| `file` | `FileField(upload_to='doc_templates/')` | Original uploaded PDF |
| `dropboxsign_template_id` | `CharField(max_length=200, blank=True)` | Set after manager configures signature fields in Dropbox Sign editor |

Keep existing: `marina`, `name`, `category`, `pages`, `fields_count`, `uses_count`, `last_used`, `created_at`.

Migration: `0002_doctemplate_file_and_dsign_id.py`

---

### `Envelope` (enrich existing)

Add to existing skeleton:

| Field | Type | Notes |
|---|---|---|
| `dropboxsign_request_id` | `CharField(max_length=200, blank=True)` | Set when signature request is created |

Keep existing: `marina`, `template`, `recipient` (Member FK), `vessel` (Vessel FK, nullable), `sent_at`, `expires_at`, `completed_at`, `status` (pending / completed / expired), `reminders_sent`.

Add `Meta.ordering = ['-sent_at']`.

Migration: `0003_envelope_dsign_request_id.py`

---

### `MemberDocument` (new model)

```
MemberDocument
  marina        ForeignKey → accounts.Marina (CASCADE)
  member        ForeignKey → members.Member (CASCADE)
  vessel        ForeignKey → vessels.Vessel (SET_NULL, null=True, blank=True)
  doc_type      CharField(choices: insurance / registration)
  file          FileField(upload_to='member_docs/')
  expiry_date   DateField(null=True, blank=True)
  status        CharField(choices: pending_upload / uploaded / verified / due_soon / expired)
  notes         TextField(blank=True)
  uploaded_at   DateTimeField(auto_now_add=True)
```

`Meta.ordering = ['-uploaded_at']`

Migration: `0004_memberdocument.py`

---

## 2. API Endpoints

### Templates

| Method | URL | Purpose |
|---|---|---|
| GET / POST | `/api/v1/doc-templates/` | List marina templates; upload new PDF |
| GET / PUT / DELETE | `/api/v1/doc-templates/<pk>/` | Detail / update / delete |
| POST | `/api/v1/doc-templates/<pk>/prepare/` | Upload PDF to Dropbox Sign embedded template draft; returns `edit_url` for manager to open in new tab. On save, Dropbox Sign fires a webhook that writes `dropboxsign_template_id` back. |

### Envelopes

| Method | URL | Purpose |
|---|---|---|
| GET / POST | `/api/v1/envelopes/` | List marina envelopes; create (triggers Dropbox Sign `send_with_template`) |
| GET | `/api/v1/envelopes/<pk>/` | Detail + status |
| GET | `/api/v1/envelopes/<pk>/download/` | Returns a short-lived download URL from Dropbox Sign for the signed PDF |
| POST | `/api/v1/documents/webhook/` | Dropbox Sign webhook — no auth, HMAC verified. Handles `signature_request_all_signed` and `template_created` events. |

### Member Documents

| Method | URL | Purpose |
|---|---|---|
| GET / POST | `/api/v1/member-documents/` | List; upload insurance or registration file |
| GET / PATCH | `/api/v1/member-documents/<pk>/` | Detail; manager sets `expiry_date` and `status` after reviewing |

---

## 3. Dropbox Sign Integration

### Settings

```python
DROPBOX_SIGN_API_KEY   = env('DROPBOX_SIGN_API_KEY', default='')
DROPBOX_SIGN_CLIENT_ID = env('DROPBOX_SIGN_CLIENT_ID', default='')
DROPBOX_SIGN_WEBHOOK_SECRET = env('DROPBOX_SIGN_WEBHOOK_SECRET', default='')
```

Added to `backend/.env.example`.

### Multi-Tenancy in Webhooks (Critical)

Dropbox Sign webhooks are fired against a single API account shared across all marinas. The webhook payload identifies a `signature_request_id` or `template_id` but carries no inherent marina context. A naive `Envelope.objects.get(dropboxsign_request_id=...)` lookup crosses tenant boundaries — violating the strict marina isolation rule applied everywhere else in the codebase.

**Fix: inject `marina_id` as Dropbox Sign metadata on every outbound API call**, then extract and verify it on every inbound webhook before any DB write.

### Template Setup Flow (one-time per document type)

1. Manager uploads PDF → `POST /api/v1/doc-templates/` → file saved to `MEDIA_ROOT/doc_templates/`
2. Manager clicks "Prepare for eSign" → `POST /api/v1/doc-templates/<pk>/prepare/`
3. Backend calls `dropbox_sign.TemplateApi.create_embedded_template_draft()` with the PDF file and `metadata={"marina_id": str(template.marina_id), "template_pk": str(template.pk)}`
4. Dropbox Sign returns `edit_url` → backend returns it to frontend
5. Frontend opens `edit_url` in a new browser tab
6. Manager drags Signature + Date fields onto the PDF, hits Save
7. Dropbox Sign fires `template_created` webhook → `POST /api/v1/documents/webhook/`
8. Backend extracts `marina_id` and `template_pk` from webhook metadata, looks up `DocTemplate.objects.get(pk=template_pk, marina_id=marina_id)` — marina-scoped — and saves `dropboxsign_template_id`

### Send Contract Flow

1. Manager selects template + member → `POST /api/v1/envelopes/`
2. Backend calls `dropbox_sign.SignatureRequestApi.send_with_template()` with `template_id`, member name + email, optional `expires_at`, and **`metadata={"marina_id": str(envelope.marina_id), "envelope_pk": str(envelope.pk)}`**
3. Dropbox Sign sends the boater a signing email with their hosted signing link
4. Backend saves `dropboxsign_request_id`, `status = pending`
5. Boater taps link on phone → signs on Dropbox Sign's mobile-optimised hosted page
6. Dropbox Sign fires `signature_request_all_signed` webhook
7. Backend extracts `marina_id` and `envelope_pk` from metadata, looks up `Envelope.objects.get(pk=envelope_pk, marina_id=marina_id)` — marina-scoped — marks `status = completed`, `completed_at = now()`
8. Signed PDF is permanently stored by Dropbox Sign — retrievable via `signature_request_id`

### Download Signed PDF

`GET /api/v1/envelopes/<pk>/download/` → JWT-authenticated, scoped to `request.user.marina` → backend calls `SignatureRequestApi.get()` to fetch the signed PDF URL → returns it as a redirect or JSON `{ url }`. The URL is short-lived.

### Webhook Handler

`POST /api/v1/documents/webhook/` is public (no JWT). Dropbox Sign signs the payload with an HMAC key. Handler:

1. Verifies HMAC against `DROPBOX_SIGN_WEBHOOK_SECRET` — rejects with 400 if invalid
2. Extracts `marina_id` from `event.signature_request.metadata` (or `event.template.metadata`) — rejects with 400 if missing
3. Dispatches on `event.event_type`:
   - `template_created` → `DocTemplate.objects.get(pk=metadata['template_pk'], marina_id=marina_id)` → saves `dropboxsign_template_id`
   - `signature_request_all_signed` → `Envelope.objects.get(pk=metadata['envelope_pk'], marina_id=marina_id)` → sets `status = completed`, `completed_at`
4. All DB lookups are double-keyed by both the record PK **and** `marina_id` — a spoofed or replayed webhook with a mismatched marina cannot update any record
5. Returns `{"hash": "..."}` (Dropbox Sign requires this exact acknowledgement)

---

## 4. Expiry Management Command

`python manage.py check_document_expiry`

Runs daily (cron or Task Scheduler). No external dependencies.

Logic:
- `MemberDocument` where `expiry_date` <= today and status not already `expired` → set `status = expired`
- `MemberDocument` where `expiry_date` within 30 days and `status = verified` → set `status = due_soon`
- `Envelope` where `expires_at` <= today and `status = pending` → set `status = expired`

**Phase 3 note:** this command is the injection point for email reminders (SendGrid) and SMS alerts (Twilio). When email is configured, add a notification step before flipping status.

---

## 5. Frontend

### `Documents.jsx` — Templates Tab

- Card grid from `useDocTemplates` hook (`GET /api/v1/doc-templates/`)
- "Upload Template" button → modal: file input, name, category → `POST /api/v1/doc-templates/`
- Card actions:
  - **Prepare for eSign** (shown when `dropboxsign_template_id` is blank) → calls `/prepare/`, opens `edit_url` in new tab
  - **Send Contract** (shown when `dropboxsign_template_id` is set) → opens envelope creation modal (select member, optional expiry date)
  - **Download Original** → link to `file` URL
- Status indicator on card: "Ready" (template ID set) or "Needs Setup" (no template ID)
- Manager can re-run "Prepare for eSign" at any time if they closed the editor without saving — `/prepare/` is idempotent (creates a new draft, overwrites `edit_url`)

### `Documents.jsx` — Envelopes Tab

- Filter tabs: All / Pending / Completed / Expired
- Table from `useEnvelopes` hook (`GET /api/v1/envelopes/`)
- Columns: Member, Template, Sent, Expires, Status badge
- Click row → detail panel: member name, vessel, template name, sent date, expiry, status, `completed_at`
- "View Signed PDF" button on completed envelopes → `GET /api/v1/envelopes/<pk>/download/` → opens URL in new tab

### `Documents.jsx` — Mass Send Tab

Kept as mock UI. Not wired — Phase 3 (requires email/SMS infrastructure).

### `Members.jsx` — Document Vault Tab

Currently mock. Wire to `useMemberDocuments` hook:
- Table rows: member name, insurance status + expiry, registration status + expiry
- Status badges: `verified` (green), `due_soon` (orange), `expired` (red), `pending_upload` (grey)
- "Upload" button per document type → modal with file input → `POST /api/v1/member-documents/`
- Manager can click a row to set `expiry_date` via PATCH

### New Hooks

- `frontend/src/hooks/useDocTemplates.js`
- `frontend/src/hooks/useEnvelopes.js`
- `frontend/src/hooks/useMemberDocuments.js`

---

## 6. Dependencies

```
dropbox-sign          # Dropbox Sign Python SDK
```

Add to `backend/requirements.txt`.

Django `MEDIA_URL` and `MEDIA_ROOT` must be configured and served in dev:

```python
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'
```

In `config/urls.py` (dev only):
```python
from django.conf import settings
from django.conf.urls.static import static
if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
```

---

## 7. Tests

### `apps/documents/tests.py`

| Class | Tests |
|---|---|
| `DocTemplateTest` | POST creates template with file; GET list scoped to marina; prepare/ returns edit_url (mocked Dropbox Sign call) |
| `EnvelopeTest` | POST creates envelope + calls Dropbox Sign (mocked); webhook `signature_request_all_signed` marks completed; webhook rejects invalid HMAC |
| `MemberDocumentTest` | POST uploads file; PATCH sets expiry_date and status; GET list scoped to marina |
| `ExpiryCommandTest` | verified doc with past expiry → expired; verified doc within 30 days → due_soon; pending envelope past expires_at → expired |

Dropbox Sign API calls are mocked with `unittest.mock.patch` — no live API calls in tests.

---

## Design Constraints

- All models carry a `marina` FK — no cross-marina data leakage
- Webhook endpoint is public but HMAC-verified — no JWT required
- `dropboxsign_template_id` blank = template not yet configured → "Prepare for eSign" shown instead of "Send Contract"
- File uploads use Django's built-in `FileField` — no extra storage library needed for dev
- Mass Send tab deferred to Phase 3 (requires email/SMS)
- Expiry email reminders deferred to Phase 3 (requires SendGrid/Twilio)
