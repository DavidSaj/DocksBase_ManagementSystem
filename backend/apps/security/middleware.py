"""
Security middleware.

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

Task 3 adds EmailReverifyHeaderMiddleware (below): a real Django middleware that
adds X-Email-Reverify: warning response headers for users in the warning state.
Using Django middleware here (rather than a DRF permission class) is correct
because we need to mutate the response, which DRF BasePermission cannot do.
request.user IS populated by the time process_response runs because the DRF view
dispatch has already authenticated the user.
"""

from django.utils.deprecation import MiddlewareMixin


class EmailReverifyHeaderMiddleware(MiddlewareMixin):
    """
    Adds X-Email-Reverify: warning header when the authenticated user is in
    warning state (180–209 days since email_verified_at).

    Boaters are exempt from the re-verification feature entirely, so they
    never receive the header.

    This runs AFTER the DRF view, so request.user is the fully JWT-authenticated
    user (not just Django's session user).
    """

    def process_response(self, request, response):
        user = getattr(request, 'user', None)
        if not (user and getattr(user, 'is_authenticated', False)):
            return response

        # Boaters are exempt per spec §Non-goals
        if getattr(user, 'role', None) == 'boater':
            return response

        from .services.reverify import status_for
        if status_for(user) == 'warning':
            response['X-Email-Reverify'] = 'warning'

        return response
