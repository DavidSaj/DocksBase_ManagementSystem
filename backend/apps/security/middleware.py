"""
Security middleware stubs.

Task 2 decision: IP allowlist enforcement is implemented as a DRF permission class
(`apps.security.permissions.IPAllowlistPermission`) rather than a Django middleware
entry.  Rationale: DRF runs its own authentication stack on the view, AFTER all
Django MIDDLEWARE has finished.  A standard middleware entry sees request.user set
only by Django's session-based AuthenticationMiddleware, not by the JWT
authentication class.  The DRF permission class runs post-JWT-decode and has access
to the fully-resolved request.user, matching the spec's intent.

The spec's §IPAllowlistMiddleware describes the conceptual behaviour; the actual
implementation lives in apps.security.permissions.IPAllowlistPermission and is
installed via REST_FRAMEWORK['DEFAULT_PERMISSION_CLASSES'].

IP client resolution:
  REMOTE_ADDR is used exclusively.  No SECURE_PROXY_SSL_HEADER or trusted-proxy
  config is present in base.py (verified 2026-05-15), so trusting X-Forwarded-For
  without a proxy whitelist would open IP spoofing.  If the deployment ever adds
  a trusted proxy, update _client_ip() in permissions.py accordingly.

TODO(audit-log): log ip_blocked event once SecurityAuditLog lands in T4.
  The placeholder lives in IPAllowlistPermission.has_permission() — search for
  the comment there to find the right insertion point.

Task 3 will add EmailReverifyMiddleware here as a real Django middleware (it
operates on response headers, making a DRF permission class less natural).
"""

# This file is intentionally sparse for Task 2.
# EmailReverifyMiddleware is added in Task 3.
