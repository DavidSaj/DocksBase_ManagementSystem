# Platform Admin Portal — Design Spec
**Date:** 2026-05-11
**Status:** Approved

---

## Overview

DocksBase requires a compliant, audit-ready internal admin portal structured in three strict layers:

1. **Level 1 — Platform Admin Dashboard**: metadata-only view of marina accounts, no boater PII
2. **Level 2 — Consent-Gated Impersonation**: support agents enter a marina's live UI only with consent and full audit trail
3. **Level 3 — Data Sanitizer**: CLI tool to anonymise a production DB dump for local dev use

This architecture follows the standard used by Shopify, Stripe, and Salesforce. It is designed to satisfy SOC 2 Type II and ISO 27001 audit requirements.

---

## Architecture

```
DocksBase_ManagementSystem/
├── backend/                        (shared Django API)
│   └── apps/
│       └── admin_portal/           (existing — minor additions for consent)
├── frontend/                       (existing marina app — banner addition only)
└── frontend-admin/                 (NEW — standalone Vite+React app)
```

`frontend-admin` is a completely independent Vite+React project. It runs on a separate port in dev (`:5174`) and deploys to a separate subdomain in production (e.g. `admin.docksbase.com`). It shares no code with `frontend/` — only the backend API.

Access is gated at the app level: on load, the decoded JWT is checked for `is_platform_admin=True`. Any token without this claim is immediately redirected to `/login`.

---

## Level 1 — Platform Admin Frontend

### Auth Flow

- Login screen uses the existing `POST /api/auth/token/` endpoint
- After login, the JWT is decoded client-side; if `is_platform_admin` is not `true`, the user is shown an "Access denied" screen and the token is discarded
- Token refresh follows the same pattern as the marina app

### Layout

Fixed left sidebar with nav items. No marina context, no setup guide, no MarinaContext provider. The layout is intentionally minimal — this is an internal ops tool, not a product UI.

### Screens

**Dashboard** (`/`)
Default landing page. Stat tiles: MRR, ARR, active marina count, trial marina count, GMV. Alert rail: trials ending within 14 days, overdue payments, suspended accounts. Recent signups table (5 rows).
→ `GET /api/admin/overview/`

**Accounts** (`/accounts`)
Searchable, filterable table of all marinas. Columns: Name, Plan, Status, MRR, Berths, Created. Clicking a row opens a detail drawer containing:
- Full marina metadata (read-only display)
- Plan and status controls: suspend (with reason field), reinstate, convert trial→active
- User list with per-user password-reset trigger
- Support access status: shows whether consent is currently granted and expiry time
- **Impersonate** button (see Level 2)
→ `GET /api/admin/marinas/`, `GET /api/admin/marinas/<id>/`, `PATCH /api/admin/marinas/<id>/`, action endpoints

**Finance** (`/finance`)
MRR/ARR breakdown by plan (bar chart + table), revenue-by-marina table sorted by MRR descending, payment history list.
→ `GET /api/admin/finance/`, `GET /api/admin/payments/`

**Feature Flags** (`/flags`)
Table of global platform feature flags. Each row has an inline toggle switch. Toggle calls `PATCH /api/admin/feature-flags/<name>/`.
→ `GET /api/admin/feature-flags/`

**Audit Log** (`/audit`)
Reverse-chronological table of all admin actions. Columns: Timestamp, Admin user, Action, Marina, Detail. Filterable by marina via dropdown. Impersonation-override actions are highlighted in amber.
→ `GET /api/admin/audit-logs/`

### No new backend endpoints required for Level 1

Every screen maps to an API that already exists in `apps/admin_portal/`.

---

## Level 2 — Consent-Gated Impersonation

### Consent Model (backend)

Add one field to `Marina`:

```python
support_access_granted_until = models.DateTimeField(null=True, blank=True)
```

Two new marina-side endpoints (in `apps/accounts/marina_urls.py`):

- `POST /api/marina/grant-support-access/` — sets `support_access_granted_until = now() + 48h`
- `DELETE /api/marina/grant-support-access/` — sets field to `null`

Both endpoints require `role=owner`. A new toggle in the marina `Settings` screen calls these endpoints and displays current consent status and expiry.

### Soft Gate Logic

Modified `AdminMarinaImpersonateView`:

**`platform_role=support`** — hard requirement:
- If `support_access_granted_until` is null or in the past → `403` with message: `"This marina has not granted support access."`
- If valid → proceed with impersonation, log `action='impersonate'`

**`platform_role=admin`** — soft gate:
- If consent is valid → proceed normally, log `action='impersonate'`
- If consent is absent/expired → allowed, but:
  - `bypass_reason` field is required in request body (returns `400` if missing)
  - Logs `action='impersonate_override'` with `bypass_reason` in detail
  - Audit log entry is flagged for elevated severity

### JWT Claims

The impersonation JWT issued by `AdminMarinaImpersonateView` must include:
- `is_safe_mode = True`
- `impersonated_marina = <marina name>`
- `impersonated_marina_id = <marina pk>`
- `impersonator_user_id = <admin user pk>` ← NEW
- `impersonation_session_id = <uuid>` ← NEW (moved here from AuditLog section)
- `role = <target user role>`
- `is_platform_admin = False`

`impersonator_user_id` lets the backend identify the DocksBase employee on every request without a database lookup. `is_platform_admin=False` is correct — the token must not grant admin portal access — but identity must be preserved separately.

### Impersonation Audit Middleware

A new Django middleware `ImpersonationAuditMiddleware` sits after authentication middleware. On every request it reads the decoded JWT (available via DRF's `request.auth`) and checks for `is_safe_mode=True`. If present, it writes `impersonator_user_id` and `impersonation_session_id` to thread-local storage (using `threading.local()`).

The `AuditLog._log()` helper is updated to always read from thread-local storage. If impersonation context is present, it appends `impersonator_user_id` and `impersonation_session_id` to every `detail` dict, regardless of which view called `_log()`.

This means every POST/PATCH/DELETE that already calls `_log()` (billing, reservations, boatyard, etc.) automatically captures the impersonator's identity during a session — without modifying those views.

`AuditLog` model additions:

```python
impersonation_session_id = models.UUIDField(null=True, blank=True, db_index=True)
impersonator_user_id     = models.IntegerField(null=True, blank=True)
```

### Break-Glass Active Alerting

When `action='impersonate_override'` is triggered (admin bypasses absent/expired consent), `AdminMarinaImpersonateView` fires two synchronous notifications inside a `try/except` so a failed alert never blocks the override:

1. **Slack webhook** — POST to `settings.SECURITY_SLACK_WEBHOOK_URL` with: admin name, marina name, timestamp, `bypass_reason`. If the env var is unset, this step is skipped silently (logged to Django logger at WARNING level).
2. **Marina owner email** — `send_mail()` to `marina.contact_email` stating: `"DocksBase Support accessed your instance via Emergency Override at [timestamp]. Justification: [bypass_reason]. Contact support@docksbase.com if this was unexpected."`

Note: Celery is not currently set up in the project. Override events are rare; synchronous notification is sufficient. Celery can be introduced later if background task volume grows.

### Impersonation Banner (main marina frontend)

`AuthContext` decodes the JWT on load and checks for `is_safe_mode=True`. If present:

- A sticky banner renders above the entire app, above `Topbar`, full-width, highest z-index
- Background: red (`#DC2626`), white text
- Content: `⚠ IMPERSONATING [marina name] — ALL ACTIONS ARE AUDITED`
- Right side: `Exit Session` button → calls `signOut()` and redirects to `VITE_ADMIN_URL` env var (defaults to `http://localhost:5174` in dev)
- The banner cannot be dismissed or hidden

---

## Level 3 — Data Sanitizer

### Management Command

Location: `backend/apps/admin_portal/management/commands/sanitize_db.py`

Usage:
```bash
python manage.py sanitize_db
```

### Safety Guards

The command refuses to run if either condition is true:
- `settings.DEBUG` is `False`
- `settings.DATABASES['default']['NAME']` contains the string `prod`

If either guard triggers, it exits with a clear error and zero writes.

### Fields Sanitized

| Model | Fields |
|---|---|
| `User` | `email`, `first_name`, `last_name`, `password` (set to unusable via `set_unusable_password()`) |
| `Member` | `first_name`, `last_name`, `email`, `phone`, `address` |
| `Marina` | `contact_email` (Faker email), `phone` (Faker phone), `stripe_account_id` → `null`, `stripe_customer_id` → `null`, `stripe_subscription_id` → `null` |
| `Vessel` | `name`, `registration_number` |

Financial records (`Invoice`, `PlatformPayment`) are left as-is — amounts and dates are not PII.

### Implementation Notes

- Uses `Faker('en_GB')` locale for realistic marina names and contact details
- Processes each model in batches of 500 using `bulk_update()` to avoid memory issues on large datasets
- Prints a per-model summary on completion: `Sanitized 142 Users, 891 Members, 23 Marinas, 334 Vessels`
- `faker` added to `requirements-dev.txt` only — not in production requirements

---

## What Is Not In Scope

- A dedicated UI for per-action impersonation replay (the audit log table with `impersonation_session_id` filtering is sufficient; a full session-replay UI is a future hardening item)
- A UI for creating or editing `GlobalFeatureFlag` records (toggle only; creation is done via Django shell or migration)
- Multi-factor authentication for platform admin login (deferred — noted as a future hardening item)
- Automated weekly DB clone and sanitization pipeline (Level 3 is a CLI tool only; scheduling is an ops concern)
