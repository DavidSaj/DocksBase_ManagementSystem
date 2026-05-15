# API Access — Design

**Date:** 2026-05-15
**Status:** Approved for implementation
**Scope:** Build a real API key system to replace the "Coming Soon" API Access placeholder card in Settings. Owner-only. Multiple named keys per marina. Keys authenticate as their creator. Plus a small curated API docs page so key holders know what to call.

## Problem

The Settings → API Access card is a disabled placeholder showing "Production key · No key generated". Marinas have asked for programmatic access — accounting exports, in-house dashboards, automations — and currently the only option is to scrape the dashboard or share JWT tokens, neither of which is acceptable for production integration.

## Goals

- Owners can create, view, and revoke long-lived API keys for their marina.
- Keys authenticate inbound HTTP requests as the user who created them, so existing per-user marina scoping continues to work with zero changes to any viewset.
- Keys are stored hashed at rest; the raw key is shown exactly once at creation.
- Each key tracks `last_used_at` so dormant keys are easy to spot.
- Optional per-key expiry.
- A small in-app docs page (`Settings → API Access → View docs`) shows authentication + a curated list of useful endpoints with curl examples.

## Non-goals

- **No per-key scopes.** Every key has the same access as its creator. Scopes can be added later.
- **No webhooks / event subscriptions.**
- **No IP allowlist per key.** That's the future Security PR.
- **No auto-generated OpenAPI schema.** DRF has ~200 endpoints including internal admin / portal / impersonation routes; auto-doc would be noisy and a security liability. We ship hand-curated docs covering the v1 surface.
- **No OAuth / app-installation flow.**
- **No CLI / SDK.** Just a key + the HTTP API.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Scope of key | Marina-wide service account; full access of the creator. |
| Who can manage | Owner role only. |
| Multiple keys? | Yes, multiple named keys per marina. |
| Track last used? | Yes — update on every successful auth. |
| Optional expiry? | Yes, per key. |
| Key format | `db_live_<8-char prefix>_<32-char tail>` (Stripe-style). |
| Auth-as | The user who created the key. Revoking the user revokes their keys. |
| Docs surface | Curated hand-written page accessible from the API Access card. No drf-spectacular in v1. |

## Architecture

```
backend/apps/api_keys/                       ← new Django app
  __init__.py
  apps.py                  ApiKeysConfig
  models.py                APIKey
  authentication.py        APIKeyAuthentication (DRF auth class)
  serializers.py
  views.py                 APIKeyViewSet, ApiDocsView (returns markdown)
  urls.py
  permissions.py           IsMarinaOwner
  tests/__init__.py
  tests/conftest.py        owner_user, manager_user fixtures
  tests/test_models.py
  tests/test_authentication.py
  tests/test_viewset.py
  migrations/0001_initial.py

backend/config/settings/base.py              ← add APIKeyAuthentication to DEFAULT_AUTHENTICATION_CLASSES (before JWT); add 'apps.api_keys' to INSTALLED_APPS; add throttle scope 'api_key'
backend/config/urls.py                       ← include apps.api_keys.urls under /api/v1/

frontend/src/screens/Settings.jsx            ← replace API Access placeholder card with real UI
frontend/src/screens/Settings/ApiDocsModal.jsx ← new modal that renders the docs markdown
```

`ApiDocsModal` is a small new file rather than yet another inline block in the 1500-line Settings.jsx — Settings is already too dense.

## Data model

```python
# backend/apps/api_keys/models.py
class APIKey(models.Model):
    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='api_keys')
    created_by   = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='api_keys')
    name         = models.CharField(max_length=200)
    key_prefix   = models.CharField(max_length=20, unique=True, db_index=True)  # 'db_live_aB3xK9pQ' (16 chars in practice)
    key_hash     = models.CharField(max_length=64)                              # sha256 hex digest
    last_four    = models.CharField(max_length=4)
    expires_at   = models.DateTimeField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    revoked_at   = models.DateTimeField(null=True, blank=True)
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    @property
    def is_active(self):
        if self.revoked_at:
            return False
        if self.expires_at and self.expires_at <= timezone.now():
            return False
        return True

    @property
    def status(self) -> str:
        if self.revoked_at:                                    return 'revoked'
        if self.expires_at and self.expires_at <= timezone.now(): return 'expired'
        return 'active'
```

### Key shape and storage

- Full key: `db_live_<8 random URL-safe chars>_<32 random URL-safe chars>`.
- `key_prefix` = `db_live_<8 chars>` (16 chars including the underscore prefix). Stored unique, indexed.
- `key_hash` = `sha256(full_key)` hex (64 chars).
- `last_four` = the final 4 chars of the full key.
- The raw 32-char tail is never stored.

```python
# generation
import secrets
def generate_key():
    pre  = secrets.token_urlsafe(6)[:8]    # 8 URL-safe chars
    tail = secrets.token_urlsafe(24)[:32]  # 32 URL-safe chars
    full = f'db_live_{pre}_{tail}'
    return full, f'db_live_{pre}', tail[-4:]
```

`secrets.token_urlsafe` yields characters in `[A-Za-z0-9_-]`. `[:N]` ensures fixed length.

### Display rules

API responses include `key_prefix` + `last_four` for masked display. The full key is returned **only** on the create response. Once that response is closed, the raw key is unrecoverable.

## Authentication class

```python
# backend/apps/api_keys/authentication.py
import hashlib, hmac
from django.utils import timezone
from rest_framework import authentication, exceptions
from .models import APIKey


class APIKeyAuthentication(authentication.BaseAuthentication):
    keyword = 'Bearer'

    def authenticate(self, request):
        header = request.META.get('HTTP_AUTHORIZATION', '')
        if not header.startswith('Bearer db_live_'):
            return None  # not our scheme — let JWT auth try next
        token = header[len('Bearer '):].strip()
        prefix = '_'.join(token.split('_')[:3])  # 'db_live_xxxxxxxx'
        try:
            key = APIKey.objects.select_related('marina', 'created_by').get(key_prefix=prefix)
        except APIKey.DoesNotExist:
            raise exceptions.AuthenticationFailed('Invalid API key.')

        presented_hash = hashlib.sha256(token.encode()).hexdigest()
        if not hmac.compare_digest(presented_hash, key.key_hash):
            raise exceptions.AuthenticationFailed('Invalid API key.')

        if not key.is_active:
            raise exceptions.AuthenticationFailed(f'API key is {key.status}.')

        if not key.created_by.is_active:
            raise exceptions.AuthenticationFailed('API key creator is deactivated.')

        # Update last_used_at without triggering save signals or auto_now logic.
        APIKey.objects.filter(pk=key.pk).update(last_used_at=timezone.now())

        return (key.created_by, key)

    def authenticate_header(self, request):
        return 'Bearer'
```

### Integration with settings

Add to `DEFAULT_AUTHENTICATION_CLASSES` **before** JWT, since `APIKeyAuthentication` short-circuits on non-`db_live_` tokens and JWT will then handle the rest:

```python
'DEFAULT_AUTHENTICATION_CLASSES': (
    'apps.api_keys.authentication.APIKeyAuthentication',
    'rest_framework_simplejwt.authentication.JWTAuthentication',
),
```

### Throttling

Add a `'api_key': '1000/hour'` scope to `DEFAULT_THROTTLE_RATES`. The existing `UserRateThrottle` will apply because `request.user` is set; the limit lands wherever DRF decides. For v1, the same `200/min` user rate is acceptable — the new `api_key` scope is added but not yet attached to a specific view. Concrete tightening (per-key throttle) is a follow-up if abuse appears.

## Endpoints

Mounted at `/api/v1/api-keys/`:

| Method | Path | Body | Response | Notes |
|---|---|---|---|---|
| GET    | `/api-keys/` | — | `[{id, name, key_prefix, last_four, status, expires_at, last_used_at, created_at}]` | Owner only. No `key_hash`, no full key. |
| POST   | `/api-keys/` | `{name, expires_at?}` | `{...same fields..., key}` | `key` is the raw `db_live_...` string. ONLY returned here. |
| POST   | `/api-keys/<id>/revoke/` | — | `200 {status: 'revoked'}` | Idempotent. Owner only. |
| DELETE | `/api-keys/<id>/` | — | `204` | Hard delete. Owner only. |
| GET    | `/api-keys/docs/` | — | `{markdown: '...'}` | Returns the API docs markdown. Accessible to owners only. |

### Permission

```python
# backend/apps/api_keys/permissions.py
class IsMarinaOwner(BasePermission):
    def has_permission(self, request, view):
        return request.user.is_authenticated and getattr(request.user, 'role', None) == 'owner'
```

Applied via `permission_classes = [IsAuthenticated, IsMarinaOwner]` on the viewset. Non-owners get 403, not 404, so the UI can hide the card cleanly based on role rather than probing.

## Serializers

```python
class APIKeyReadSerializer(ModelSerializer):
    status = serializers.CharField(read_only=True)  # uses property
    class Meta:
        model = APIKey
        fields = ['id', 'name', 'key_prefix', 'last_four', 'status',
                  'expires_at', 'last_used_at', 'created_at']
        read_only_fields = fields

class APIKeyCreateSerializer(ModelSerializer):
    class Meta:
        model = APIKey
        fields = ['name', 'expires_at']

    def validate_name(self, value):
        if not value.strip():
            raise serializers.ValidationError('Name is required.')
        return value.strip()
```

The viewset's `perform_create` generates the key, hashes it, persists, and the response uses a special `APIKeyCreatedSerializer` that includes a transient `key` field. That field is NEVER read from the DB; it's set on the in-memory instance just before serialization.

## Frontend

Replace the "Coming Soon" API Access card body in `Settings.jsx`. Show the card only when `marina.role === 'owner'` (or the existing user role check used elsewhere in the file — match the pattern). For non-owners, hide the card entirely.

### UI states

**List view** (default):

```
┌─────────────────────────────────────────────────────────────────┐
│ API Access                                          [View docs] │
├─────────────────────────────────────────────────────────────────┤
│  Production integration         [● Active]   Used 2h ago   ⋮    │
│  db_live_aB3xK9pQ_••••••AbCd                                    │
│                                                                  │
│  Old key (rotated)              [Revoked]    Used 14d ago  ⋮    │
│  db_live_zM2qN8rT_••••••K9Lp                                    │
│                                                                  │
│  + Generate new key                                              │
└─────────────────────────────────────────────────────────────────┘
```

- Status pill colours: `Active` green, `Expired` orange, `Revoked` gray.
- `Used Xh ago` derived from `last_used_at` using the `relTime()` helper from the OTA polish PR (lift it into `frontend/src/utils/relTime.js` if it isn't already; otherwise inline).
- Kebab menu: `Revoke` (active keys only), `Delete` (revoked or expired keys), neither for active keys you should not be able to delete without revoking first.
- "View docs" opens `ApiDocsModal` which fetches `GET /api-keys/docs/` and renders the returned markdown.

**Generate form** (inline reveal when `+ Generate new key` is clicked):

- `Name` — required text input.
- `Expires` — date picker, optional. Helper text: "Leave blank for no expiry."
- `Generate` button → POST `/api-keys/` → opens the **Key Reveal Modal**.

**Key Reveal Modal:**

- Banner at top: ⚠ "Save this key now. You will not be able to view it again."
- Monospace block with the full key, copy button beside it.
- "Done" button closes the modal. After close, the list re-fetches; the new key appears with only its masked form.

### File touches

- Modify: `frontend/src/screens/Settings.jsx` — delete the disabled-state JSX inside the existing API Access card; render a new `<APIAccessCard />` component (defined in the same file for now to stay consistent with how OTAConnectionsCard, SupportAccessSection, etc. live there).
- Create: `frontend/src/screens/Settings/ApiDocsModal.jsx` — small standalone file because it bundles a markdown renderer call and we don't want to pollute Settings.jsx further.

### Markdown rendering

The docs payload is a string. To render it, use the `marked` library (~30 KB minified) — small, no dependency on React. If the repo already uses a markdown renderer somewhere (`grep -rn "marked\|react-markdown\|remark" frontend/`), reuse it. Otherwise add `marked` as a frontend dep in this PR.

## API docs page content (curated)

The `GET /api-keys/docs/` endpoint returns a markdown string. Stored as a Python module constant for now (`backend/apps/api_keys/docs.py`) — easier to edit than a static file and avoids static-file plumbing. Outline:

1. **Authentication** — `Authorization: Bearer db_live_...`. Curl example. Note that JWT tokens also work but are not the intended interface.
2. **Base URL** — `https://<marina>.docksbase.com/api/v1/` (or whatever the production URL is — implementer reads the prod config to confirm).
3. **Rate limits** — 200 req/min user scope; subject to change.
4. **Common endpoints** — short list, curl examples for each:
   - `GET /bookings/` — list bookings
   - `GET /bookings/<id>/` — get one
   - `POST /bookings/` — create a booking (mention required fields, link to the field reference inline)
   - `GET /berths/` — list berths
   - `GET /members/` — list members
   - `GET /vessels/` — list vessels
   - `GET /invoices/` — list invoices
5. **Errors** — 401/403/429 meanings.
6. **Versioning** — `/api/v1/` is current; deprecation policy.

I'll draft the markdown during implementation. User reviews and edits like any other text.

## Security considerations

- **Constant-time hash compare** via `hmac.compare_digest`.
- **No logging of `Authorization`** — verify Django's default `LOGGING` config doesn't log request headers; if it does, redact via a logging filter. (Likely already fine.)
- **Revoke-on-deactivation:** a `post_save` signal on `User` — when `is_active` flips False, set `revoked_at` on all the user's API keys. Prevents "user fired but their keys still work" surprise.
- **Audit trail:** `last_used_at` per key. No separate audit log table in v1 — adding one is a future task.
- **Key in DB dump:** only the hash is stored. A leaked SQL dump does not leak working keys.
- **Browser key reveal:** raw key is only ever in `response.data.key` in the create response. Frontend must not log it to console; the reveal modal should be the only consumer. Note in implementation.
- **CSRF:** API keys are stateless Bearer tokens. They sidestep Django's CSRF middleware (DRF authenticator marks `enforce_csrf_check` False by default — confirm via implementation).

## Testing

### Backend
- `test_models.py`: `is_active` / `status` matrix across active / revoked / expired / future-expiry. `generate_key()` returns distinct keys, prefix length, hash uniqueness.
- `test_authentication.py`: valid key → user attached. Tampered key (single char changed) → 401. Revoked → 401. Expired → 401. Creator deactivated → 401. Non-`db_live_` token returns None (lets JWT try). `last_used_at` updates on success.
- `test_viewset.py`: owner can list/create/revoke/delete. Manager and staff get 403. Create returns the raw key. List does NOT return the raw key. Revoke is idempotent. Hard delete works on revoked/expired keys only.
- End-to-end: generate a key in test, use it on `GET /api/v1/berths/`, expect 200 with the marina's berths.

### Frontend
- No new tests. Component is presentational; tests cost more than they're worth at this size. Manual smoke during PR review.

## Rollout

- One backend deploy (model migration + new auth class + new viewset).
- One FE deploy (replaces placeholder card).
- No flag — feature is on for all owners the moment it deploys. The card is hidden from non-owners by role gating, so non-owners see no change.
- Existing JWT auth continues working unchanged.

## Risks

- **Authentication ordering** — if `APIKeyAuthentication` is misordered relative to JWT, JWT might raise on a `db_live_...` token and prevent ours from running. Mitigated by adding ours FIRST and returning `None` when the header isn't our scheme (DRF then tries the next authenticator).
- **Performance** — `last_used_at` update on every API-keyed request adds one indexed UPDATE per request. At realistic request volumes this is negligible. If it becomes an issue later, we throttle the update to once per minute via a small cache layer (out of scope now).
- **Forgotten keys** — owners create a key, copy it, forget where they put it, and lose it. Acceptable — they regenerate. UX banner in the reveal modal warns clearly.
- **Multi-marina users** — a user belonging to multiple marinas (if that exists in the model — verify; the existing user model has a single `marina` FK, so this is fine for now) would have keys scoped per `marina` correctly because each key carries `marina_id`.

## Out of scope, documented for follow-ups

- IP allowlist per key — folded into the Security PR.
- Per-key scopes (`bookings:read`, etc.).
- Webhooks.
- Per-key request throttle (lower than user-default).
- Full audit log of API calls (currently we have `last_used_at` only).
- Auto-generated OpenAPI / Swagger UI page.
- Public-facing API docs site (separate from in-app docs).
