# Bug Report Ticketing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Report Bug" button to the frontend topbar that opens a modal form; submissions are proxied through Django to `tickets.sajosi.com`.

**Architecture:** A new `apps.tickets` Django app exposes `POST /api/v1/tickets/`, validates the payload, and forwards it to the ingress webhook with the server-side secret. On the frontend, a new `BugReportModal` component handles form state, validation, and the three-state flow (idle → submitting → success). The Topbar gets a single new icon button that opens/closes the modal.

**Tech Stack:** React 18 (JSX), axios (`api.js`), Django REST Framework, `requests` library (Python), pytest / Django `TestCase`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `backend/apps/tickets/__init__.py` | Create | Empty — makes it a package |
| `backend/apps/tickets/apps.py` | Create | Django AppConfig |
| `backend/apps/tickets/views.py` | Create | `TicketView` — validates, generates UUID, forwards to webhook |
| `backend/apps/tickets/urls.py` | Create | `POST tickets/` route |
| `backend/apps/tickets/tests.py` | Create | All backend tests |
| `backend/config/settings/base.py` | Modify | Add `apps.tickets` to LOCAL_APPS + `INGRESS_WEBHOOK_SECRET` setting |
| `backend/config/urls.py` | Modify | Include `apps.tickets.urls` |
| `frontend/src/components/layout/BugReportModal.jsx` | Create | Form, validation, submission, success/error states |
| `frontend/src/components/layout/Topbar.jsx` | Modify | Add `bugOpen` state + alert-tri button + `<BugReportModal>` |

---

## Task 1: Create the `tickets` Django app skeleton

**Files:**
- Create: `backend/apps/tickets/__init__.py`
- Create: `backend/apps/tickets/apps.py`

- [ ] **Step 1: Create the package files**

```bash
# Run from backend/
mkdir apps/tickets
```

Create `backend/apps/tickets/__init__.py` — empty file.

Create `backend/apps/tickets/apps.py`:
```python
from django.apps import AppConfig


class TicketsConfig(AppConfig):
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.tickets'
```

- [ ] **Step 2: Register the app in settings**

In `backend/config/settings/base.py`, add `'apps.tickets'` to the end of `LOCAL_APPS`:
```python
LOCAL_APPS = [
    # ... existing entries ...
    'apps.marketplace',
    'apps.tickets',      # ← add this
]
```

Also add the webhook secret setting near the other webhook secrets (around line 139):
```python
INGRESS_WEBHOOK_SECRET = os.environ.get('INGRESS_WEBHOOK_SECRET', '')
```

- [ ] **Step 3: Add the env var placeholder**

In `backend/.env` (create if absent), add:
```
INGRESS_WEBHOOK_SECRET=your-secret-here
```

- [ ] **Step 4: Verify Django recognises the app**

```bash
cd backend
python manage.py check
```
Expected: `System check identified no issues (0 silenced).`

- [ ] **Step 5: Commit**

```bash
git add apps/tickets/__init__.py apps/tickets/apps.py config/settings/base.py
git commit -m "feat(tickets): scaffold tickets app and register in settings"
```

---

## Task 2: Write tests for the ticket endpoint (TDD)

**Files:**
- Create: `backend/apps/tickets/tests.py`

- [ ] **Step 1: Write the test file**

Create `backend/apps/tickets/tests.py`:
```python
from unittest.mock import patch, MagicMock
from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from apps.accounts.models import Marina, User


@override_settings(INGRESS_WEBHOOK_SECRET='test-secret')
class TicketViewTests(TestCase):
    def setUp(self):
        self.marina = Marina.objects.create(name='Test Marina')
        self.user = User.objects.create_user(
            email='staff@test.com', password='pass', marina=self.marina, role='manager'
        )
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.valid_payload = {
            'title': 'Reservations page crashes on load',
            'description': 'When I navigate to the reservations screen it crashes immediately. I have tried refreshing and it still happens every time.',
            'context': {
                'screen': 'reservations',
                'user_email': 'staff@test.com',
                'user_name': 'Test User',
                'user_role': 'manager',
                'user_agent': 'Mozilla/5.0',
                'timestamp': '2026-05-13T10:00:00Z',
                'app_version': '1.0.0',
            },
        }

    @patch('apps.tickets.views.requests.post')
    def test_valid_submission_forwards_to_webhook(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.ok = True
        mock_post.return_value = mock_resp

        r = self.client.post('/api/v1/tickets/', self.valid_payload, format='json')

        self.assertEqual(r.status_code, 200)
        self.assertIn('ticket_id', r.json())
        mock_post.assert_called_once()

        call_kwargs = mock_post.call_args
        url = call_kwargs[0][0]
        headers = call_kwargs[1]['headers']
        body = call_kwargs[1]['json']

        self.assertEqual(url, 'https://tickets.sajosi.com/tickets')
        self.assertEqual(headers['X-Webhook-Secret'], 'test-secret')
        self.assertIn('id', body)
        self.assertEqual(body['title'], 'Reservations page crashes on load')
        self.assertIsNone(body['error'])

    @patch('apps.tickets.views.requests.post')
    def test_upstream_failure_returns_502(self, mock_post):
        mock_resp = MagicMock()
        mock_resp.ok = False
        mock_resp.status_code = 500
        mock_post.return_value = mock_resp

        r = self.client.post('/api/v1/tickets/', self.valid_payload, format='json')

        self.assertEqual(r.status_code, 502)
        self.assertEqual(r.json()['detail'], 'Ticket service unavailable.')

    @patch('apps.tickets.views.requests.post')
    def test_network_error_returns_502(self, mock_post):
        import requests as req
        mock_post.side_effect = req.RequestException('timeout')

        r = self.client.post('/api/v1/tickets/', self.valid_payload, format='json')

        self.assertEqual(r.status_code, 502)
        self.assertEqual(r.json()['detail'], 'Ticket service unavailable.')

    def test_missing_title_returns_400(self):
        payload = {**self.valid_payload, 'title': ''}
        r = self.client.post('/api/v1/tickets/', payload, format='json')
        self.assertEqual(r.status_code, 400)

    def test_missing_description_returns_400(self):
        payload = {**self.valid_payload, 'description': ''}
        r = self.client.post('/api/v1/tickets/', payload, format='json')
        self.assertEqual(r.status_code, 400)

    def test_title_too_long_returns_400(self):
        payload = {**self.valid_payload, 'title': 'x' * 121}
        r = self.client.post('/api/v1/tickets/', payload, format='json')
        self.assertEqual(r.status_code, 400)

    def test_unauthenticated_returns_401(self):
        anon = APIClient()
        r = anon.post('/api/v1/tickets/', self.valid_payload, format='json')
        self.assertEqual(r.status_code, 401)
```

- [ ] **Step 2: Run the tests — they must fail (no view yet)**

```bash
cd backend
python -m pytest apps/tickets/tests.py -v
```
Expected: `ImportError` or `404` failures — the endpoint doesn't exist yet. This confirms TDD baseline.

- [ ] **Step 3: Commit the tests**

```bash
git add apps/tickets/tests.py
git commit -m "test(tickets): add failing tests for ticket proxy endpoint"
```

---

## Task 3: Implement the ticket endpoint

**Files:**
- Create: `backend/apps/tickets/views.py`
- Create: `backend/apps/tickets/urls.py`
- Modify: `backend/config/urls.py`

- [ ] **Step 1: Write the view**

Create `backend/apps/tickets/views.py`:
```python
import uuid
import requests
from django.conf import settings
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from rest_framework import status


class TicketView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        title = (request.data.get('title') or '').strip()
        description = (request.data.get('description') or '').strip()
        context = request.data.get('context') or {}

        if not title:
            return Response({'detail': 'title is required.'}, status=status.HTTP_400_BAD_REQUEST)
        if len(title) > 120:
            return Response({'detail': 'title must be 120 characters or fewer.'}, status=status.HTTP_400_BAD_REQUEST)
        if not description:
            return Response({'detail': 'description is required.'}, status=status.HTTP_400_BAD_REQUEST)

        ticket_id = str(uuid.uuid4())
        payload = {
            'id': ticket_id,
            'title': title,
            'description': description,
            'error': None,
            'context': context,
        }

        try:
            resp = requests.post(
                'https://tickets.sajosi.com/tickets',
                json=payload,
                headers={'X-Webhook-Secret': settings.INGRESS_WEBHOOK_SECRET},
                timeout=10,
            )
        except requests.RequestException:
            return Response({'detail': 'Ticket service unavailable.'}, status=status.HTTP_502_BAD_GATEWAY)

        if not resp.ok:
            return Response({'detail': 'Ticket service unavailable.'}, status=status.HTTP_502_BAD_GATEWAY)

        return Response({'ticket_id': ticket_id}, status=status.HTTP_200_OK)
```

- [ ] **Step 2: Write the URL conf**

Create `backend/apps/tickets/urls.py`:
```python
from django.urls import path
from .views import TicketView

urlpatterns = [
    path('tickets/', TicketView.as_view()),
]
```

- [ ] **Step 3: Wire into main URL conf**

In `backend/config/urls.py`, add inside the `api/v1/` include block (after the last existing entry):
```python
        path('', include('apps.tickets.urls')),
```

- [ ] **Step 4: Run the tests — they must all pass**

```bash
cd backend
python -m pytest apps/tickets/tests.py -v
```
Expected output:
```
PASSED apps/tickets/tests.py::TicketViewTests::test_valid_submission_forwards_to_webhook
PASSED apps/tickets/tests.py::TicketViewTests::test_upstream_failure_returns_502
PASSED apps/tickets/tests.py::TicketViewTests::test_network_error_returns_502
PASSED apps/tickets/tests.py::TicketViewTests::test_missing_title_returns_400
PASSED apps/tickets/tests.py::TicketViewTests::test_missing_description_returns_400
PASSED apps/tickets/tests.py::TicketViewTests::test_title_too_long_returns_400
PASSED apps/tickets/tests.py::TicketViewTests::test_unauthenticated_returns_401
7 passed
```

- [ ] **Step 5: Commit**

```bash
git add apps/tickets/views.py apps/tickets/urls.py config/urls.py
git commit -m "feat(tickets): implement ticket proxy endpoint"
```

---

## Task 4: Build `BugReportModal` component

**Files:**
- Create: `frontend/src/components/layout/BugReportModal.jsx`

- [ ] **Step 1: Create the component**

Create `frontend/src/components/layout/BugReportModal.jsx`:
```jsx
import { useState, useEffect } from 'react';
import api from '../../api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import Ic from '../ui/Icon.jsx';

function wordCount(str) {
  return str.trim().split(/\s+/).filter(Boolean).length;
}

const MIN_WORDS = 15;

export default function BugReportModal({ open, onClose, screen }) {
  const { user } = useAuth();
  const [phase, setPhase] = useState('idle'); // idle | submitting | success
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');

  // Reset state every time the modal opens
  useEffect(() => {
    if (!open) {
      setPhase('idle');
      setTitle('');
      setDescription('');
      setError('');
    }
  }, [open]);

  if (!open) return null;

  const words = wordCount(description);
  const isValid = title.trim().length > 0 && words >= MIN_WORDS;

  async function handleSubmit() {
    if (!isValid || phase === 'submitting') return;
    setPhase('submitting');
    setError('');
    try {
      await api.post('tickets/', {
        title: title.trim(),
        description: description.trim(),
        context: {
          screen,
          user_email: user?.email || '',
          user_name: `${user?.first_name || ''} ${user?.last_name || ''}`.trim(),
          user_role: user?.role || '',
          user_agent: navigator.userAgent,
          timestamp: new Date().toISOString(),
          app_version: '1.0.0',
        },
      });
      setPhase('success');
    } catch {
      setPhase('idle');
      setError('Failed to send — please try again.');
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={phase === 'submitting' ? undefined : onClose}
    >
      <div
        style={{
          width: 420, background: '#fff', borderRadius: 12,
          boxShadow: 'var(--shadow2)', overflow: 'hidden',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 18px', borderBottom: 'var(--border)',
        }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>Report a Bug</span>
          {phase !== 'submitting' && (
            <div className="topbar-icon-btn" onClick={onClose} style={{ width: 24, height: 24 }}>
              <Ic n="x" s={12} />
            </div>
          )}
        </div>

        <div style={{ padding: '18px' }}>
          {phase === 'success' ? (
            <div style={{ textAlign: 'center', padding: '24px 0' }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'var(--green)', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                margin: '0 auto 14px',
              }}>
                <Ic n="check" s={22} color="#fff" />
              </div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6 }}>Report sent</div>
              <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)', marginBottom: 20 }}>
                We'll look at it within 24 hours. Thank you for helping us improve DocksBase.
              </div>
              <button className="btn" onClick={onClose}>Close</button>
            </div>
          ) : (
            <>
              {/* Title */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.55)', display: 'block', marginBottom: 4 }}>
                  Title
                </label>
                <input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  maxLength={120}
                  disabled={phase === 'submitting'}
                  placeholder="Short summary of the issue"
                  style={{
                    width: '100%', height: 32, padding: '0 10px',
                    fontSize: 12, border: 'var(--border2)',
                    borderRadius: 6, outline: 'none',
                    background: phase === 'submitting' ? 'var(--bg)' : '#fff',
                    color: 'rgba(0,0,0,0.85)', boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Description */}
              <div style={{ marginBottom: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'rgba(0,0,0,0.55)', display: 'block', marginBottom: 4 }}>
                  Description
                </label>
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  disabled={phase === 'submitting'}
                  rows={6}
                  placeholder="Describe what happened, what you expected, and any steps to reproduce. The more detail, the faster we can fix it."
                  style={{
                    width: '100%', padding: '8px 10px',
                    fontSize: 12, border: 'var(--border2)',
                    borderRadius: 6, outline: 'none', resize: 'vertical',
                    background: phase === 'submitting' ? 'var(--bg)' : '#fff',
                    color: 'rgba(0,0,0,0.85)', fontFamily: 'var(--font)',
                    lineHeight: 1.5, boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{
                fontSize: 10, color: words >= MIN_WORDS ? 'var(--green)' : 'rgba(0,0,0,0.38)',
                marginBottom: 14, textAlign: 'right',
              }}>
                {words} / {MIN_WORDS} words minimum
              </div>

              {error && (
                <div style={{ fontSize: 11, color: 'var(--red)', marginBottom: 10 }}>{error}</div>
              )}

              <button
                className="btn"
                onClick={handleSubmit}
                disabled={!isValid || phase === 'submitting'}
                style={{ width: '100%' }}
              >
                {phase === 'submitting' ? 'Sending…' : 'Send Report'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify no import errors**

Start the dev server:
```bash
cd frontend
npm run dev
```
Expected: no console errors on load.

- [ ] **Step 3: Commit**

```bash
git add src/components/layout/BugReportModal.jsx
git commit -m "feat(tickets): add BugReportModal component"
```

---

## Task 5: Wire the button into Topbar

**Files:**
- Modify: `frontend/src/components/layout/Topbar.jsx`

- [ ] **Step 1: Add import and state**

At the top of `Topbar.jsx`, add the import after the existing imports (line 6):
```jsx
import BugReportModal from './BugReportModal.jsx';
```

Inside the `Topbar` function, after the existing `useState` declarations (after line 42), add:
```jsx
const [bugOpen, setBugOpen] = useState(false);
```

- [ ] **Step 2: Add the button between bell and account avatar**

In the JSX, between the closing `</div>` of the notifications block (line 244) and the opening `<div>` of the account avatar block (line 247), insert:

```jsx
        {/* Report bug */}
        <div
          className="topbar-icon-btn"
          onClick={() => { setBugOpen(true); setNotifOpen(false); setAccountOpen(false); }}
          title="Report a bug"
        >
          <Ic n="alert-tri" s={14} />
        </div>
        <BugReportModal open={bugOpen} onClose={() => setBugOpen(false)} screen={screen} />
```

- [ ] **Step 3: Manual smoke test**

With the dev server running, open the app and verify:
1. The alert-tri icon appears between the bell and avatar.
2. Clicking it opens the modal.
3. The word counter starts at `0 / 15 words minimum`.
4. The Send button is disabled until title is filled and description has ≥ 15 words.
5. Clicking the backdrop closes the modal.
6. After close and reopen, the form is blank (state reset confirmed).

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/Topbar.jsx
git commit -m "feat(tickets): wire bug report button into Topbar"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Button next to search and notifications → Task 5
- ✅ Modal with title + description field → Task 4
- ✅ Min 15-word validation + live counter → Task 4
- ✅ Placeholder guidance text → Task 4
- ✅ Backdrop disabled during submit → Task 4 (`phase === 'submitting'` guard)
- ✅ State resets on close → Task 4 (`useEffect` on `open`)
- ✅ `idle → submitting → success` flow → Task 4
- ✅ Error state → Task 4
- ✅ Auto-captured context (screen, user, UA, timestamp, version) → Task 4
- ✅ Django proxy endpoint → Task 3
- ✅ UUID generated server-side → Task 3
- ✅ `X-Webhook-Secret` header → Task 3
- ✅ `INGRESS_WEBHOOK_SECRET` env var → Task 1
- ✅ Auth required (401 for anon) → Task 2 + Task 3
- ✅ 400 on bad title/description → Task 2 + Task 3
- ✅ 502 on upstream failure → Task 2 + Task 3

**Placeholder scan:** No TBDs, no vague steps, all code blocks complete.

**Type consistency:** `TicketView` defined in Task 3, tested in Task 2 (tests import from `apps.tickets.views` which matches). `BugReportModal` props (`open`, `onClose`, `screen`) consistent between Task 4 definition and Task 5 usage.
