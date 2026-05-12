---
name: bug-report-ticketing
description: Bug report button in topbar opens a modal form that proxies tickets to tickets.sajosi.com via Django backend
metadata:
  type: project
---

# Bug Report Ticketing — Design Spec

## Overview

Add a "Report Bug" button to the frontend topbar. Clicking it opens a modal where staff can submit a bug report with a title and detailed description. The submission is proxied through the Django backend (to keep the webhook secret server-side) and forwarded to `tickets.sajosi.com`, which feeds an AI triage pipeline.

---

## Architecture

```
Frontend (React)
  Topbar → BugReportModal
      ↓ POST /api/tickets/ (api.js)
Django backend
  tickets/views.py → POST https://tickets.sajosi.com/tickets
      X-Webhook-Secret: <INGRESS_WEBHOOK_SECRET>
AI pipeline (CT 100)
  ingress → redis → worker (Investigator + Reviewer) → Telegram
```

---

## Frontend

### 1. Topbar button

- New `topbar-icon-btn` using the existing `alert-tri` icon, placed between the notifications bell and the account avatar.
- Controls a new `bugOpen` boolean state in `Topbar.jsx`.
- Renders `<BugReportModal open={bugOpen} onClose={() => setBugOpen(false)} screen={screen} />`.

### 2. `BugReportModal.jsx` (new file: `frontend/src/components/layout/BugReportModal.jsx`)

**Props:** `open`, `onClose`, `screen`

**States:** `idle | submitting | success`

**Fields:**
- `title` — single-line text input, required, max 120 chars
- `description` — textarea (~6 rows). Placeholder: *"Describe what happened, what you expected, and any steps to reproduce. The more detail, the faster we can fix it."*

**Validation:**
- Description must reach a minimum of 15 words.
- Live word count displayed below the textarea (e.g. "8 / 15 words minimum").
- Submit button is disabled until the minimum is met and title is non-empty.

**Auto-captured context (not shown to user, sent in payload):**
```json
{
  "screen": "<current screen key>",
  "user_email": "<from useAuth>",
  "user_name": "<first + last from useAuth>",
  "user_role": "<user.role from useAuth>",
  "user_agent": "<navigator.userAgent>",
  "timestamp": "<ISO 8601>",
  "app_version": "1.0.0"
}
```

**Flow:**
1. `idle` — form is editable, "Send Report" button active when valid.
2. `submitting` — button shows spinner, inputs disabled, backdrop click is suppressed (no accidental close mid-request).
3. `success` — form replaced with: checkmark icon, heading "Report sent", body "We'll look at it within 24 hours. Thank you for helping us improve DocksBase." and a "Close" button.
4. On error — stays in `idle`, shows inline error message below the button ("Failed to send — please try again.").

**State reset:** Whenever `open` transitions from `true → false` (any close path), all form state resets to `idle` with empty fields, so reopening always shows a fresh form.

**Styling:** Centered fixed overlay with a semi-transparent backdrop. Card is ~420px wide, white background, `var(--shadow2)`, `border-radius: 12px`. Matches existing modal patterns in the codebase.

---

## Backend

### New endpoint: `POST /api/tickets/`

**Location:** new `tickets` Django app (or added to an existing `core` app — implementer's choice based on project structure).

**Authentication:** Requires a valid session token (same auth as all other API endpoints) — rejects unauthenticated requests with 401.

**Request body from frontend:**
```json
{
  "title": "string",
  "description": "string",
  "context": {
    "screen": "string",
    "user_email": "string",
    "user_name": "string",
    "user_role": "string",
    "user_agent": "string",
    "timestamp": "string",
    "app_version": "string"
  }
}
```

**Backend processing:**
1. Validate title (non-empty, ≤ 120 chars) and description (non-empty). Return 400 on failure.
2. Generate a UUID as `ticket_id`.
3. Build the forwarded payload:
```json
{
  "id": "<uuid>",
  "title": "<title>",
  "description": "<description>",
  "error": null,
  "context": { ...context fields }
}
```
4. POST to `https://tickets.sajosi.com/tickets` with header `X-Webhook-Secret: <INGRESS_WEBHOOK_SECRET>` (read from Django settings / env var).
5. On success: return `{"ticket_id": "<uuid>"}` with status 200.
6. On upstream failure: return 502 with `{"detail": "Ticket service unavailable."}`. Do not swallow — let frontend show the error state.

**Environment variable:** `INGRESS_WEBHOOK_SECRET` added to `.env` and Django settings.

---

## Spec Self-Review

- No placeholders or TBDs remaining.
- Architecture, fields, validation, and payload all consistent throughout.
- Scope is focused: one button, one modal, one backend endpoint.
- "tickets app vs core app" left to implementer — both are valid; no functional difference.
