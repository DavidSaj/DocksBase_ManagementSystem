# Security: TOTP MFA, IP allowlist, email re-verification, audit log — Design

**Date:** 2026-05-15
**Status:** Awaiting review
**Scope:** Replace the "Security — Coming Soon" placeholder card in Settings with four real, independently-toggleable security features, shipped as one bundled PR.

## Problem

The Settings → Security card is a disabled placeholder. The marina-facing app has no MFA, no IP-based access control, no periodic re-confirmation of operator identity, and no audit trail of security-relevant events. For a system that holds payment records, member PII, and booking data, this is a meaningful gap before serious operators trust it.

## Goals

Four sub-features, gated independently so a marina can adopt them at its own pace:

1. **TOTP MFA** — opt-in per user, can be made mandatory for owners/managers by marina policy. Microsoft Authenticator / Google Authenticator / Authy all work. 10 single-use backup codes. 30-day device trust.
2. **IP allowlist** — per-marina CIDR allowlist. Empty = off (default). Non-empty = all authenticated requests must originate inside the allowlist. Saving the list cannot lock the owner out.
3. **Periodic email re-verification** — every 180 days. Soft banner during 180–210d window, hard block after 210d until re-verified.
4. **Security audit log** — append-only record of security-relevant events. Owner-readable. Covers MFA events, allowlist changes, password changes, email re-verifications, and (retroactively) API key lifecycle from the PR #57 work.

## Non-goals

- **WebAuthn / passkeys.** Separate protocol, much bigger surface.
- **SMS- or voice-based MFA.** Carrier-dependent; cost; SIM swap risk.
- **Email-link as a second factor.** Inferior to TOTP for the threat model.
- **Per-endpoint IP allowlist exceptions.** All-or-nothing in v1.
- **SSO / SAML.** Out of scope for the foreseeable future.
- **Login-attempt rate-limiting.** Done by the existing DRF throttle scopes for now.
- **Audit log export to S3 / SIEM.** Internal table only.
- **Boater portal MFA / IP allowlist / email re-verify.** All four sub-features apply ONLY to marina staff (`role in {owner, manager, staff}`). Boaters (`role='boater'`) remain on the existing magic-link / member-auth flow and are never subjected to the new middleware. The boater PWA at `booking.docksbase.com` must continue to work from any IP, with no TOTP prompt, and without periodic re-verification — that's a different threat model with a near-zero blast radius (a compromised boater account exposes one boater's own reservations, not 500 marinas' worth of PII). Concretely: the IP allowlist middleware short-circuits to `None` when `user.role == 'boater'`, the email re-verify middleware already short-circuits the same way, and MFA enrollment is never offered to boaters.

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Bundle or split? | One PR, all four sub-features. |
| MFA enforcement | Optional per user; marina-level policy `require_mfa_for_managers` can force enrollment for owners/managers. |
| Backup codes | 10 single-use, shown once at enrollment, hashed at rest. |
| Trust this device? | Yes — 30-day signed cookie, opt-in on the TOTP prompt. |
| IP allowlist gates | All authenticated dashboard + API requests. Empty list = bypass. |
| Lockout protection | Saving the allowlist requires the requester's current IP to be covered. 400 otherwise. |
| Email re-verify cadence | 180 days; soft banner during 180–210d; hard block after 210d. |
| Audit log | Yes — new `SecurityAuditLog` table; covers MFA, allowlist, password, email re-verify, and (retroactive) API key events. |

## Architecture

```
backend/apps/security/                           ← new app
  apps.py                  SecurityConfig
  models.py                UserMFA, MFABackupCode, MarinaIPAllowlist,
                           SecurityAuditLog, MFAChallenge
  middleware.py            IPAllowlistMiddleware, EmailReverifyMiddleware
  services/
    mfa.py                 generate_secret, build_uri, verify_code,
                           issue_backup_codes, consume_backup_code,
                           is_device_trusted, mark_device_trusted
    audit.py               log_event(...)
    reverify.py            status_for(user)  # 'ok' | 'warning' | 'blocked'
  authentication.py        MFAGatedJWTAuthentication (wraps simplejwt)
  views.py                 MFAEnrollView, MFAVerifyView, MFADisableView,
                           IPAllowlistViewSet, AuditLogListView,
                           ReverifyEmailRequestView
  serializers.py
  urls.py
  signals.py               wires api_keys events into audit log
  tests/...

backend/apps/accounts/                           ← edit existing
  models.py                add User.email_verified_at,
                           add Marina.require_mfa_for_managers,
                           leave User.role / EmailVerification untouched
  views.py                 LoginView returns mfa_required, mfa_challenge_token
                           on success when user has MFA; new MFAVerifyView
                           issues the actual JWT pair.

backend/config/settings/base.py                  ← edit
  MIDDLEWARE += [
    'apps.security.middleware.IPAllowlistMiddleware',
    'apps.security.middleware.EmailReverifyMiddleware',
  ]
  REST_FRAMEWORK['DEFAULT_AUTHENTICATION_CLASSES'] swap JWT for
    MFAGatedJWTAuthentication
  ('apps.security' added to LOCAL_APPS)

backend/requirements.txt                         ← add pyotp, qrcode[pil]

frontend/src/screens/Settings/SecurityCard.jsx           ← new
frontend/src/screens/Settings/MFAEnrollDialog.jsx        ← new
frontend/src/screens/Settings/IPAllowlistEditor.jsx      ← new
frontend/src/screens/Settings/AuditLogModal.jsx          ← new
frontend/src/screens/Settings/ReverifyEmailBanner.jsx    ← new
frontend/src/screens/Login.jsx                           ← edit: handle MFA step
frontend/src/screens/Settings.jsx                        ← edit: replace placeholder
```

One new Django app (`apps.security`); no changes to the existing `accounts` model layer beyond two additive fields. No new dependency on the existing `notifications` app — audit log is its own thing.

## Data model

### `UserMFA`

```python
class UserMFA(models.Model):
    user        = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='mfa')
    secret      = models.CharField(max_length=64)  # base32 TOTP secret
    enrolled_at = models.DateTimeField(null=True, blank=True)   # set when first successful verify happens after enrollment
    disabled_at = models.DateTimeField(null=True, blank=True)
    last_verified_at = models.DateTimeField(null=True, blank=True)

    @property
    def is_active(self):
        return self.enrolled_at is not None and self.disabled_at is None
```

The row is created at enrollment-start with a fresh secret but `enrolled_at = None`. The user verifies the first code; on success we set `enrolled_at = now()`. Until then the user has no enforced MFA. This avoids the "I scanned the QR but never confirmed it works, now I'm locked out" failure mode.

**Re-enrollment / abandoned-enrollment handling.** Because `UserMFA` is `OneToOneField`, naïvely calling `UserMFA.objects.create(...)` on the second enrollment attempt would raise `IntegrityError`. The `start-enrollment` endpoint must use `update_or_create` semantics that distinguish three pre-existing states:

| Existing row state | start-enrollment behaviour |
|---|---|
| no row | create row with fresh secret, `enrolled_at=None` |
| row exists, `enrolled_at IS NULL` (abandoned) | overwrite `secret`, leave `enrolled_at=None`. No-op on row PK. Discard any orphan `MFABackupCode` rows for this user. |
| row exists, `is_active` (`enrolled_at` set, `disabled_at` null) | 400 — user already enrolled. They must explicitly disable first. |
| row exists, `disabled_at` set (was active, then disabled) | overwrite `secret`, clear `enrolled_at` and `disabled_at`. Discard any orphan `MFABackupCode` rows for this user. |

Implementation: a single `start_enrollment(user)` service function in `services/mfa.py` encapsulates the logic. The viewset calls only this helper.

### `MFABackupCode`

```python
class MFABackupCode(models.Model):
    user      = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='mfa_backup_codes')
    code_hash = models.CharField(max_length=64)            # sha256 of the raw code
    used_at   = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
```

Raw code shape: `XXXX-XXXX` (8 hex chars + dash, ~40 bits, fine for short-lived recovery). On enrollment, 10 codes are generated, hashed, persisted, and shown to the user once.

### `MFAChallenge`

```python
class MFAChallenge(models.Model):
    user        = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='mfa_challenges')
    token       = models.CharField(max_length=64, unique=True, db_index=True)  # secrets.token_urlsafe(48)
    expires_at  = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    failed_attempts = models.PositiveSmallIntegerField(default=0)
    invalidated_at  = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
```

The intermediate token issued by the password step. Expires in 5 minutes. **Bound to a specific user** via the FK. Single-use.

**Brute-force protection:** every failed attempt increments `failed_attempts`. After 5 failures the challenge is invalidated (`invalidated_at = now()`); subsequent calls return 401 regardless of code. The user must re-authenticate with email + password to obtain a fresh challenge. Without this cap, a 5-minute window against pyotp's `valid_window=1` (3 acceptable codes out of 10⁶) gives an attacker ~3 × N attempts; capping at 5 keeps brute-force probability ≤ 1.5 × 10⁻⁵.

**Binding semantics in the verify endpoint:** the endpoint receives only `(mfa_challenge_token, code, trust_device?)`. It does NOT accept a `user_id` or `email` parameter. The user is loaded exclusively from `MFAChallenge.user_id`. The final JWT pair is minted for `challenge.user` — never for any other user. This means a stolen challenge token cannot be used to log in as a different user; the worst case is brute-forcing the original user's TOTP, capped by `failed_attempts` above.

The same binding applies to `MFAEnrollment` — see §Login flow.

### `MarinaIPAllowlist`

```python
class MarinaIPAllowlist(models.Model):
    marina     = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='ip_allowlist')
    cidr       = models.CharField(max_length=43)  # e.g. '203.0.113.0/24' or '2001:db8::/32'
    label      = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name='+')

    class Meta:
        unique_together = [('marina', 'cidr')]
```

### `SecurityAuditLog`

```python
class SecurityAuditLog(models.Model):
    EVENT_CHOICES = [
        ('mfa_enrolled', 'MFA enrolled'),
        ('mfa_disabled', 'MFA disabled'),
        ('mfa_failed', 'MFA verification failed'),
        ('mfa_succeeded', 'MFA verification succeeded'),
        ('backup_code_used', 'Backup code used'),
        ('ip_allowlist_added', 'IP allowlist entry added'),
        ('ip_allowlist_removed', 'IP allowlist entry removed'),
        ('ip_blocked', 'Request blocked by IP allowlist'),
        ('password_changed', 'Password changed'),
        ('email_reverified', 'Email re-verified'),
        ('api_key_created', 'API key created'),
        ('api_key_revoked', 'API key revoked'),
        ('api_key_deleted', 'API key deleted'),
    ]
    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='security_events')
    actor        = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name='+')
    event_type   = models.CharField(max_length=40, choices=EVENT_CHOICES, db_index=True)
    payload      = models.JSONField(default=dict, blank=True)
    ip_address   = models.GenericIPAddressField(null=True, blank=True)
    user_agent   = models.CharField(max_length=500, blank=True)
    created_at   = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [models.Index(fields=['marina', '-created_at'])]
```

Append-only. No update, no delete from the API. Retention policy not yet defined — leave that to a future cleanup task.

### Additive fields on existing models

`accounts.User`:
- `email_verified_at = DateTimeField(null=True, blank=True)` — backfill = `created_at` for existing rows in the migration.

`accounts.Marina`:
- `require_mfa_for_managers = BooleanField(default=False)` — when True, owners and managers without active MFA are routed to enrollment on next login (after password step).

No other schema changes to existing models.

## Login flow

### Today

```
POST /api/v1/auth/token/  { email, password }
  → 200 { access, refresh, user }
```

### After

```
POST /api/v1/auth/token/  { email, password }

  Case A — user has no active MFA, marina does not require it:
    → 200 { access, refresh, user }              # unchanged

  Case B — user has active MFA, no trusted-device cookie:
    → 200 { mfa_required: true, mfa_challenge_token: '...' }

  Case C — user has active MFA, valid trusted-device cookie:
    → 200 { access, refresh, user }              # short-circuits MFA

  Case D — marina requires MFA for owners/managers, user has none:
    → 200 { mfa_enrollment_required: true,
            mfa_enrollment_token: '...',
            mfa_secret: '...',
            mfa_qr_uri: 'otpauth://...' }
```

After Case B:

```
POST /api/v1/auth/token/mfa-verify/
     Body: { mfa_challenge_token, code, trust_device?: true }
     Cookies: dbmfa_trust_<user_id> may be present
  → 200 { access, refresh, user }
    + on `trust_device: true`: Set-Cookie dbmfa_trust_<user_id>=<signed>; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax
```

`code` can be either the 6-digit TOTP or one of the 10 single-use backup codes (`XXXX-XXXX` format). The server tries TOTP first; on failure tries backup-code consumption; on either success emits the JWT pair and consumes the challenge.

After Case D:

```
POST /api/v1/auth/token/mfa-enroll-complete/
     Body: { mfa_enrollment_token, code }
  → 200 { access, refresh, user, backup_codes: [...] }
```

The 10 backup codes are returned **once** here. Same pattern as the API key reveal modal.

### Refresh endpoint

`POST /api/v1/auth/token/refresh/` is unchanged. A valid refresh token continues to mint access tokens. Refresh is intentionally not gated by MFA — the original access token was already MFA-gated, and refresh tokens are short-lived enough (30 days per `SIMPLE_JWT` config) that requiring MFA again would degrade the dashboard UX. IP allowlist DOES gate refresh.

### Token semantics

JWT payload gains nothing related to MFA. The "user has completed MFA" state is encoded in the existence of the access token itself — it's only minted after MFA passes.

## Authentication class

```python
class MFAGatedJWTAuthentication(JWTAuthentication):
    """
    Same as JWTAuthentication. The MFA gate happens at login time, not on
    every request. Renamed for clarity in the AUTHENTICATION_CLASSES list.
    """
```

This rename is cosmetic — no behavioural difference from `JWTAuthentication`. Keeping the class so a future refactor can move per-request MFA checks here if needed.

## Middleware

### `IPAllowlistMiddleware`

```python
class IPAllowlistMiddleware(MiddlewareMixin):
    EXEMPT_PATHS = {
        '/api/v1/auth/token/',
        '/api/v1/auth/token/refresh/',
        '/api/v1/auth/token/mfa-verify/',
        '/api/v1/auth/token/mfa-enroll-complete/',
        '/api/v1/auth/verify-email/',
        '/api/v1/auth/reverify-email/request/',
        '/api/v1/auth/reverify-email/confirm/',
        '/api/v1/security/ip-allowlist/',          # roaming owner escape hatch (GET + POST)
        # DELETE /api/v1/security/ip-allowlist/<id>/ matches via the EXEMPT_PREFIXES set below
        '/api/v1/auth/me/',                        # FE app shell needs this to render
        '/healthz', '/api/v1/healthz',
    }
    EXEMPT_PREFIXES = (
        '/api/v1/security/ip-allowlist/',  # covers DELETE /api/v1/security/ip-allowlist/<id>/
    )

    def _is_exempt(self, path):
        return path in self.EXEMPT_PATHS or any(path.startswith(p) for p in self.EXEMPT_PREFIXES)

    def process_view(self, request, view_func, view_args, view_kwargs):
        if self._is_exempt(request.path):
            return None
        user = getattr(request, 'user', None)
        if user is None or not user.is_authenticated:
            return None
        # Boaters are explicitly out of scope — see §Non-goals.
        if getattr(user, 'role', None) == 'boater':
            return None
        marina = getattr(user, 'marina', None)
        if marina is None:
            return None
        entries = list(marina.ip_allowlist.all())
        if not entries:
            return None  # allowlist not configured — feature off
        ip = _client_ip(request)
        if any(_ip_in_cidr(ip, e.cidr) for e in entries):
            return None
        # Log and reject
        SecurityAuditLog.objects.create(
            marina=marina, actor=user, event_type='ip_blocked',
            ip_address=ip, payload={'path': request.path},
            user_agent=request.META.get('HTTP_USER_AGENT', '')[:500],
        )
        return JsonResponse(
            {'detail': 'Your IP address is not allowed for this marina.', 'code': 'ip_not_allowed'},
            status=403,
        )
```

`_client_ip`: prefer the first IP in `X-Forwarded-For` if present and the request came from a trusted proxy (existing infra likely uses `django.http.HttpRequest.META['REMOTE_ADDR']` — implementer reads `settings.SECURE_PROXY_SSL_HEADER` / any `IPWARE` config to decide). When in doubt, use `REMOTE_ADDR`. Don't trust client-controlled headers without a proxy whitelist.

The middleware skips when `marina` is None (platform admin sessions, system tasks) — those continue to work.

### `EmailReverifyMiddleware`

```python
EXEMPT_PATHS = {
    '/api/v1/auth/token/',
    '/api/v1/auth/token/refresh/',
    '/api/v1/auth/token/mfa-verify/',
    '/api/v1/auth/token/mfa-enroll-complete/',
    '/api/v1/auth/verify-email/',
    '/api/v1/auth/reverify-email/',           # this is the re-verify endpoint itself
    '/api/v1/auth/me/',                       # user info; UI needs it to show the banner
    '/healthz', '/api/v1/healthz',
}

def process_view(self, request, view_func, view_args, view_kwargs):
    if request.path in self.EXEMPT_PATHS: return None
    user = getattr(request, 'user', None)
    if not (user and user.is_authenticated): return None
    if user.role == 'boater': return None  # email re-verify is staff-only

    status = reverify.status_for(user)  # 'ok' | 'warning' | 'blocked'
    if status == 'warning':
        request._email_reverify_warning = True   # set the header in process_response of this same middleware
    elif status == 'blocked':
        return JsonResponse(
            {'detail': 'Email re-verification required.', 'code': 'email_reverify_required'},
            status=403,
        )
    return None
```

The 'warning' state propagates to the FE via a response header `X-Email-Reverify: warning` added by the SAME middleware's `process_response`: if `getattr(request, '_email_reverify_warning', False)` is True, set the header on the outgoing response. The FE shows the banner on receipt of that header.

Status logic in `reverify.status_for(user)`:

```python
THRESHOLD_WARN  = timedelta(days=180)
THRESHOLD_BLOCK = timedelta(days=210)

def status_for(user) -> str:
    base = user.email_verified_at or user.created_at
    age = now() - base
    if age < THRESHOLD_WARN:  return 'ok'
    if age < THRESHOLD_BLOCK: return 'warning'
    return 'blocked'
```

**SMTP guard:** if `user.marina.smtp_host` is empty (the marina hasn't configured outbound email at all), the middleware degrades to 'ok' instead of 'blocked' — we can't reasonably block when re-verification is impossible. A platform admin can fix the SMTP config; the marina remains operational meanwhile.

## Trust-this-device cookie

```python
# apps.security.services.mfa
TRUST_COOKIE_NAME = lambda user_id: f'dbmfa_trust_{user_id}'
TRUST_COOKIE_TTL  = 30 * 24 * 3600

def is_device_trusted(request, user) -> bool:
    name = TRUST_COOKIE_NAME(user.id)
    raw = request.COOKIES.get(name)
    if not raw: return False
    try:
        payload = signing.loads(raw, salt='mfa-trust', max_age=TRUST_COOKIE_TTL)
    except signing.BadSignature:
        return False
    return payload.get('user_id') == user.id

def mark_device_trusted(response, user):
    raw = signing.dumps({'user_id': user.id, 'trusted_at': time.time()}, salt='mfa-trust')
    response.set_cookie(
        TRUST_COOKIE_NAME(user.id), raw,
        max_age=TRUST_COOKIE_TTL,
        httponly=True, secure=not settings.DEBUG, samesite='Lax',
    )
```

The cookie is per-user-id so multiple users on the same browser get separate trust states. Signed with Django's signing key — invalidating the key (rare) invalidates all trust cookies, which is the desired blast radius.

## Endpoints

All under `/api/v1/`:

### MFA

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `auth/token/` | none | `{email, password}` | See login flow section |
| POST | `auth/token/mfa-verify/` | none (challenge token only) | `{mfa_challenge_token, code, trust_device?}` | JWT pair + Set-Cookie |
| POST | `auth/token/mfa-enroll-complete/` | none (enroll token only) | `{mfa_enrollment_token, code}` | JWT pair + backup_codes |
| GET | `security/mfa/` | JWT | — | `{enrolled: bool, enrolled_at, has_backup_codes, backup_codes_remaining}` |
| POST | `security/mfa/start-enrollment/` | JWT | — | `{secret, qr_uri}` — creates non-enrolled UserMFA row |
| POST | `security/mfa/complete-enrollment/` | JWT | `{code}` | `{enrolled_at, backup_codes: [...]}` — only call from Settings, not login |
| POST | `security/mfa/disable/` | JWT (+ password confirmation in body) | `{password}` | 204 |

The two enrollment paths are split because login-time enrollment (Case D) needs to issue tokens, while in-Settings enrollment doesn't (the user already has tokens).

### IP allowlist

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| GET | `security/ip-allowlist/` | JWT, owner role | — | `[{id, cidr, label, created_at, created_by_email}]` |
| POST | `security/ip-allowlist/` | JWT, owner role | `{cidr, label?}` | 201 — refuses if current IP would not be in the new list (see "Lockout protection — additive only") |
| DELETE | `security/ip-allowlist/<id>/` | JWT, owner role | — | 204 — owners may delete any entry from any IP |

**Lockout protection — additive only.** The guard exists only on **add**, not on **remove**. The original spec's "deleting the last entry covering you → 400" rule would have stranded a roaming owner (e.g. one travelling, calling in from a hotel IP after configuring the allowlist from the office). The corrected semantics:

- `POST /security/ip-allowlist/` — refuse with 400 if the new full allowlist would not cover the caller's current IP. Rationale: prevents *accidental* lockout while configuring.
- `DELETE /security/ip-allowlist/<id>/` — succeed unconditionally for owners. The owner has already proven identity with password + MFA + (existing) JWT to reach this endpoint. They may deliberately empty the allowlist (effectively disabling the feature) from outside any current entry.

To make this reachable from a non-allowlisted IP, the IP allowlist management endpoints are added to the middleware exempt path set — see §IPAllowlistMiddleware.EXEMPT_PATHS below. Authentication still applies; only the IP gate is bypassed for these specific endpoints. This is the documented escape hatch.

### Audit log

| Method | Path | Auth | Returns |
|---|---|---|---|
| GET | `security/audit/` | JWT, owner role | Paginated list, newest first, max 100 per page |

### Email re-verify

| Method | Path | Auth | Body | Returns |
|---|---|---|---|---|
| POST | `auth/reverify-email/request/` | JWT | — | 204 — sends a re-verify email with a fresh token |
| POST | `auth/reverify-email/confirm/` | none (token only) | `{token}` | 200 — flips `user.email_verified_at = now()` |

## Frontend

### Login screen changes

`frontend/src/screens/Login.jsx`:

```
state: { step: 'password' | 'mfa' | 'enroll', challengeToken, enrollmentSecret, ... }

handleSubmit (password step):
  resp = POST /auth/token/
  if (resp.mfa_required) -> setStep('mfa'), keep challenge token
  else if (resp.mfa_enrollment_required) -> setStep('enroll'), keep enrollment token + secret/qr_uri
  else -> store tokens, redirect

mfa step UI:
  text "Enter the 6-digit code from your authenticator app"
  input (autofocus, numeric pattern, length 6)
  checkbox "Trust this device for 30 days"
  small "Use a backup code" toggle that swaps the input to text mode
  submit -> POST /auth/token/mfa-verify/

enroll step UI:
  QR code (rendered from qr_uri client-side using `qrcode` npm package — small)
  fallback "Or enter this secret manually:"
  input for the 6-digit confirmation code
  submit -> POST /auth/token/mfa-enroll-complete/
  -> backup codes reveal modal (same pattern as API keys reveal)
```

### Settings → Security card

Replace the placeholder block in `Settings.jsx` with `<SecurityCard />`. Owner role only. Other roles see a stripped-down version that only shows the MFA section (for self-enrollment) and not allowlist or audit log.

`SecurityCard.jsx` composes:

- **Two-factor authentication** — status pill (`Enabled` / `Not configured`), `Enable` / `Disable` button. Enable opens `MFAEnrollDialog` (QR + code + backup codes). Disable prompts for password.
- **Marina policy: require MFA for managers** — toggle, owner-only, persists `marina.require_mfa_for_managers`.
- **IP allowlist** — only the owner sees this. List of CIDR entries; `Add entry` form with `[Use my current IP]` button that pre-fills the CIDR with the detected client IP as `/32`. Remove button per row. Lockout protection feedback is server-side.
- **Audit log** — `View audit log` button → `AuditLogModal`, paginated, last 100 events with timestamp, event type label, actor, IP. Owner only.

### Re-verify banner

`ReverifyEmailBanner.jsx` — mounted near the top of the authenticated app shell. Reads `X-Email-Reverify` response header from `api.get('/auth/me/')` (already called on app load). When `warning`: yellow banner "Please verify your email is still current. [Send re-verification email]". When the middleware returns 403 `email_reverify_required`, the app shell traps it and shows a full-screen modal with the same content.

### MFA Enroll Dialog

- QR rendered via the `qrcode` npm package (~30 KB). Re-evaluate: `qrcode-svg` is even smaller; pick whichever the implementer can prove builds clean.
- Input for confirmation code.
- On success, switch to backup codes reveal: each code in a monospace block, copy-all button, download-as-text button, "I saved these" Done button.

### IP Allowlist Editor

- List view with `cidr` + label + delete.
- Add form: `cidr` text input, `label` text input, `[Use my current IP]` button that calls a tiny `GET /security/whoami-ip/` endpoint and pre-fills as `<ip>/32`.
- Server returns 400 with a clear `detail` when the change would lock out the caller. Surface the message verbatim.

### Audit Log Modal

- Table: timestamp, event, actor email, IP, payload summary (short).
- Pagination (next/prev). No filters in v1.
- Tooltip / expandable row to show the full `payload` JSON.

## Audit log wiring

Each event is logged via `apps.security.services.audit.log_event(...)`. Callers:

- `mfa_enrolled` — at end of complete-enrollment (Settings + login Case D).
- `mfa_disabled` — at end of disable endpoint.
- `mfa_succeeded` / `mfa_failed` — on every verify attempt.
- `backup_code_used` — when a code is consumed.
- `ip_allowlist_added` / `ip_allowlist_removed` — in the viewset's create/destroy.
- `ip_blocked` — from the IP middleware on rejection.
- `password_changed` — wherever the existing password-change happens (find via grep; one or two callsites in `accounts/views.py`).
- `email_reverified` — at end of confirm endpoint.
- `api_key_created` / `api_key_revoked` / `api_key_deleted` — retroactively into the existing `api_keys` viewset. Three lines added.

Each event captures `request.META.get('REMOTE_ADDR')` and `HTTP_USER_AGENT` (truncated to 500 chars).

## Audit log payload schema

Every event carries `marina`, `actor` (nullable), `event_type`, `ip_address`, `user_agent`, `created_at`. The `payload` JSON shape per event:

| `event_type` | `payload` shape |
|---|---|
| `mfa_enrolled` | `{}` — actor is the user themselves |
| `mfa_disabled` | `{disabled_via: 'self' | 'admin'}` |
| `mfa_failed` | `{reason: 'bad_code' | 'expired_challenge' | 'invalidated_challenge'}` |
| `mfa_succeeded` | `{method: 'totp' | 'backup_code'}` |
| `backup_code_used` | `{remaining: <int>}` |
| `ip_allowlist_added` | `{cidr: '203.0.113.0/24', label: 'office'}` |
| `ip_allowlist_removed` | `{cidr: '203.0.113.0/24', label: 'office'}` |
| `ip_blocked` | `{path: '/api/v1/berths/'}` |
| `password_changed` | `{}` |
| `email_reverified` | `{previous_verified_at: '2025-11-12T...'}` |
| `api_key_created` | `{name: 'Accounting integration', key_prefix: 'db_live_aB3xK9pQ'}` |
| `api_key_revoked` | `{name: 'Accounting integration', key_prefix: 'db_live_aB3xK9pQ'}` |
| `api_key_deleted` | `{name: 'Accounting integration', key_prefix: 'db_live_aB3xK9pQ'}` |

**Never put a raw key, secret, password, code, or challenge token in a payload.** `key_prefix` is safe (it's already public to the owner via the API Access card). Backup-code reveal at enrollment is NOT logged in payload — only `mfa_enrolled` with empty payload is.

The audit-log UI maps each `event_type` to a human-readable label and renders `payload` as a small key/value table in an expandable row.

## Migration / backfill

One migration in each affected app:

- `apps.security.0001_initial` — creates all four new models.
- `apps.accounts.0XXX_security_fields` — adds `email_verified_at` (default null, but with a data migration that sets it to `created_at` for existing rows) and `Marina.require_mfa_for_managers` (default False).

The backfill is critical: without it, every existing user hits the 210-day block on first login post-deploy because `email_verified_at = NULL` is treated as zero. The data migration sets `email_verified_at = created_at` for all existing rows.

## Testing

### Backend

`apps.security.tests.test_mfa`:
- Enrollment creates inactive UserMFA row.
- Complete-enrollment with wrong code → fails; with right code → enrollment_at set; backup codes generated and returned.
- **Abandoned enrollment**: user calls start-enrollment, never completes; a week later calls start-enrollment again → succeeds with a fresh secret (no IntegrityError on the OneToOne constraint). Old backup codes are not retained.
- **Re-enrollment after disable**: user enrolls, disables, then enrolls again → the row is reused with a fresh secret; `disabled_at` cleared.
- **Already-enrolled rejection**: an active user calling start-enrollment → 400 with a clear message ("disable existing MFA first").
- Disable requires password; succeeds; sets disabled_at.
- TOTP verify with valid current code → succeeds, increments last_verified_at.
- TOTP verify with code from prior 30s window → succeeds (clock skew tolerance built into pyotp).
- TOTP verify with wrong code → fails and logs `mfa_failed`.
- Backup code verify → succeeds, marks `used_at`, single-use semantics (second attempt with same code fails).
- Challenge token TTL: 5 minutes; expired → 401.
- **Brute-force protection**: 5 wrong attempts on the same challenge → challenge invalidated (`invalidated_at` set); 6th attempt with the CORRECT code still returns 401. User must re-do the password step.
- **Challenge binding**: a challenge created for user A cannot be consumed to mint a JWT for user B — the verify endpoint loads the user solely from `MFAChallenge.user_id` and ignores any user hint in the payload. Test: log in as A to obtain challenge, attempt verify, assert the returned JWT decodes to A's `user_id` and not anything else.

`apps.security.tests.test_scope_boater_exempt`:
- A boater (`role='boater'`) hitting any path is exempt from the IP allowlist regardless of marina configuration — even with a non-empty allowlist excluding their IP, they get through.
- A boater is never offered MFA enrollment, never subject to the marina policy flag, and is never blocked by the email re-verify middleware regardless of `email_verified_at` age.
- The boater portal endpoints (`/api/v1/portal/*`, `/api/v1/public/*`, `/api/v1/auth/member/*` etc.) are reachable by anonymous and boater users from outside the marina's IP allowlist.

`apps.security.tests.test_ip_allowlist`:
- Empty allowlist: any request allowed.
- Non-empty allowlist: matching IP allowed; non-matching IP returns 403 with `code: 'ip_not_allowed'` and an `ip_blocked` audit event.
- IPv4 CIDR (`/24`) and exact (`/32`) both work.
- IPv6 CIDR works.
- Saving an entry that excludes the caller's current IP → 400 (additive lockout protection).
- **Roaming owner**: from an IP outside the current allowlist, a DELETE on any entry succeeds (200/204). Same caller can still GET the list. POST (add) still gated by the additive guard.
- DELETE consumes auth + role (manager/staff → 403, anonymous → 401), so the escape hatch is only available to authenticated owners.
- Owner-role-only on the viewset; managers/staff → 403.
- Exempt paths (`auth/token/`, `security/ip-allowlist/...`) reachable from outside the allowlist; everything else from outside → 403.

`apps.security.tests.test_email_reverify`:
- `status_for(user)` with `email_verified_at = now() - 100d` → 'ok'.
- `... - 200d` → 'warning'.
- `... - 220d` → 'blocked'.
- Middleware returns 403 with the right code for 'blocked'.
- Marina without SMTP config → 'ok' even when stale (graceful degradation).

`apps.security.tests.test_audit_log`:
- Each event helper writes a row with the right type, payload, ip, ua.
- Viewset returns paginated, newest first.
- Non-owner → 403.

`apps.security.tests.test_login_flow`:
- User without MFA, no marina policy → JWT issued immediately. (Regression test.)
- User with MFA, no trust cookie → returns `mfa_required` + challenge.
- User with MFA, valid trust cookie → JWT issued, MFA skipped.
- Marina requires MFA, user has none → returns enrollment payload.
- `mfa-verify` with valid challenge + valid TOTP → JWT issued.
- `mfa-verify` with valid challenge + valid backup code → JWT issued, code consumed.
- `mfa-verify` with expired challenge → 401.
- `mfa-verify` consumes the challenge; replay → 401.

### Frontend

No new unit tests. Manual smoke via the existing dev environment:

1. Owner enrolls MFA → backup codes shown once.
2. Logout → log in again → prompted for TOTP.
3. Check "trust this device" → next login bypasses TOTP.
4. Add an IP allowlist entry with current IP → save succeeds. Try to remove it → 400.
5. View audit log → see enroll + login events.
6. Locally adjust DB to set `email_verified_at` 200d ago → reload app → yellow banner.
7. Adjust to 220d ago → reload → re-verify modal.

## Rollout

Single deploy. Feature is on the moment it lands but defaults are safe:

- MFA: nobody is enrolled. Login works exactly as before for everyone.
- IP allowlist: every marina starts empty → middleware bypasses.
- Email re-verify: existing users backfilled to `created_at`. The 180-day clock starts ticking from each user's account-creation date — many will see a banner soon after deploy, but no one is hard-blocked at deploy time unless they were already past the 210-day point (acceptable: those users haven't logged in in 7 months and re-verifying is reasonable).
- Audit log: empty.

A 24-hour observation window is recommended before announcing the feature publicly.

## Security considerations

- **TOTP secret entropy:** 160-bit base32, generated via `secrets.token_bytes(20)`. Standard.
- **Backup codes:** 32-bit each, generated via `secrets.token_hex(4)` formatted `XXXX-XXXX`. Hashed with SHA-256 at rest. Compared via `hmac.compare_digest`.
- **Challenge tokens:** 384-bit (`secrets.token_urlsafe(48)`). Single-use, 5-min expiry.
- **Trust cookies:** signed with Django's `SECRET_KEY`. HttpOnly, Secure (in prod), SameSite=Lax.
- **CSRF:** all the new endpoints are DRF (Bearer-auth), bypassing the Django CSRF middleware by default. The MFA login endpoints use the challenge token as the only credential; they're idempotent-on-failure.
- **Replay protection:** challenge tokens are single-use. Backup codes are single-use. TOTP codes have a built-in 30s window — pyotp's `valid_window=1` (one 30s slot of skew) is the recommended tolerance; matches what `google-authenticator-libpam` does. We use `valid_window=1`.
- **Timing attacks:** all hash comparisons via `hmac.compare_digest`.
- **Audit log immutability:** no API to update or delete. The Django ORM still permits it via shell — out of scope to enforce at the DB layer.
- **IP spoofing:** the middleware only trusts `REMOTE_ADDR` unless `SECURE_PROXY_SSL_HEADER` is set and the chain is verified. Implementer reads the current settings and decides; default to `REMOTE_ADDR` if unsure.
- **Lockout of last owner:** if the last owner of a marina enrolls MFA, then loses the device, AND has used all 10 backup codes, the marina is locked out. The platform admin (separate `is_platform_admin` flag) has an override path via the existing admin tooling — out of scope to build new tooling for this. Note in operations docs.

## Open questions documented for follow-up

- **MFA on the boater portal.** Out of scope. Boaters use magic links or member-auth; MFA there has a different threat model.
- **Per-endpoint IP exemptions** (e.g. webhooks). Not in v1.
- **Audit log retention.** Currently unlimited. Add a cleanup task at 1 year+ in a future task.
- **Push-based MFA** (Microsoft/Duo style). Out of scope.
- **Recovery codes for the marina** (not the individual user). Out of scope.
- **Hardware key (WebAuthn) support.** Out of scope; substantial protocol surface.

## Out-of-scope reminders (carried from earlier discussions)

- SSO / SAML / OAuth provider.
- Mobile app MFA flow (no native app changes in this PR — the existing dashboard frontend covers desktop).
- Risk-based step-up authentication (e.g. require MFA only on suspicious activity).

