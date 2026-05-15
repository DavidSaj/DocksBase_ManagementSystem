"""
Security app permissions.

Task 2 adds:
  - IsMarinaOwner  — restricts a viewset to users whose role == 'owner'.
  - IPAllowlistPermission — global DRF permission class that enforces the
    per-marina IP allowlist.

Why a DRF permission class instead of Django middleware?
================================================
DRF runs its own authentication stack on the view, AFTER all Django middleware
has completed.  A standard Django MIDDLEWARE entry only sees request.user
populated by Django's AuthenticationMiddleware (session-based), but JWT users
won't have request.user set there — DRF sets it in dispatch().  Using a DRF
BasePermission subclass gives us access to the fully-resolved request.user
(post-JWT-decode) and integrates cleanly with the existing DEFAULT_PERMISSION_CLASSES
pattern already used by IsSafeModeReadOnly and ModulePermission.

The spec's "IPAllowlistMiddleware" is conceptual.  The actual mechanism is this
permission class; the behaviour is identical to what the spec describes.
"""

import ipaddress

from rest_framework.permissions import BasePermission


# ---------------------------------------------------------------------------
# IP helper utilities
# ---------------------------------------------------------------------------

def _client_ip(request) -> str:
    """
    Return the client's IP address.

    Strategy: use REMOTE_ADDR only.
    No SECURE_PROXY_SSL_HEADER or USE_X_FORWARDED_HOST is configured in
    base.py (verified 2026-05-15), so trusting X-Forwarded-For without a
    proxy whitelist would open IP spoofing.  REMOTE_ADDR is safe.
    If this deployment ever adds a trusted proxy, switch to reading the
    rightmost non-proxy IP from X-Forwarded-For instead.
    """
    return request.META.get('REMOTE_ADDR', '')


def _ip_in_cidr(ip_str: str, cidr_str: str) -> bool:
    """Return True when ip_str falls within the cidr_str network."""
    try:
        ip = ipaddress.ip_address(ip_str)
        network = ipaddress.ip_network(cidr_str, strict=False)
        return ip in network
    except ValueError:
        return False


# ---------------------------------------------------------------------------
# Exempt paths (mirrors the spec §IPAllowlistMiddleware)
# ---------------------------------------------------------------------------

_EXEMPT_PATHS = frozenset({
    '/api/v1/auth/token/',
    '/api/v1/auth/token/refresh/',
    '/api/v1/auth/token/mfa-verify/',
    '/api/v1/auth/token/mfa-enroll-complete/',
    '/api/v1/auth/verify-email/',
    '/api/v1/auth/reverify-email/request/',
    '/api/v1/auth/reverify-email/confirm/',
    '/api/v1/security/ip-allowlist/',   # roaming-owner GET + POST escape hatch
    '/api/v1/auth/me/',
    '/healthz',
    '/api/v1/healthz',
})

_EXEMPT_PREFIXES = (
    '/api/v1/security/ip-allowlist/',   # covers DELETE /…/<id>/
)


def _is_exempt(path: str) -> bool:
    return path in _EXEMPT_PATHS or any(path.startswith(p) for p in _EXEMPT_PREFIXES)


# ---------------------------------------------------------------------------
# IsMarinaOwner
# ---------------------------------------------------------------------------

class IsMarinaOwner(BasePermission):
    """
    Allows access only to authenticated users whose role is 'owner'.
    Managers, staff, boaters, and anonymous users all receive 403/401.
    """
    message = 'Only marina owners may perform this action.'

    def has_permission(self, request, view):
        return bool(
            request.user
            and request.user.is_authenticated
            and getattr(request.user, 'role', None) == 'owner'
        )


# ---------------------------------------------------------------------------
# IPAllowlistPermission
# ---------------------------------------------------------------------------

class IPAllowlistPermission(BasePermission):
    """
    Global DRF permission class enforcing the per-marina IP allowlist.

    Rules (per spec §IPAllowlistMiddleware):
    1. Exempt paths (auth, allowlist management) always pass.
    2. Anonymous users pass — IsAuthenticated handles the 401 separately.
    3. Boaters (role='boater') always pass — explicitly out of scope.
    4. Users with no marina (platform admins, system tasks) always pass.
    5. Empty allowlist → feature off, always pass.
    6. Non-empty allowlist → block if caller's IP is not covered by any entry.
    """

    def has_permission(self, request, view) -> bool:
        # 1. Exempt paths bypass IP enforcement (escape hatch for roaming owners,
        #    login endpoints, etc.)
        if _is_exempt(request.path):
            return True

        # 2. Anonymous — let IsAuthenticated handle it; we don't block here.
        user = getattr(request, 'user', None)
        if user is None or not user.is_authenticated:
            return True

        # 3. Boaters are explicitly out of scope — see spec §Non-goals.
        if getattr(user, 'role', None) == 'boater':
            return True

        # 4. No marina → platform admin / system task; skip.
        marina = getattr(user, 'marina', None)
        if marina is None:
            return True

        # 5. Empty allowlist → feature off.
        entries = list(marina.ip_allowlist.all())
        if not entries:
            return True

        # 6. Check caller's IP against all CIDR entries.
        ip = _client_ip(request)
        if any(_ip_in_cidr(ip, e.cidr) for e in entries):
            return True

        # TODO(audit-log): log ip_blocked event once SecurityAuditLog lands in T4
        self.message = {
            'detail': 'Your IP address is not allowed for this marina.',
            'code': 'ip_not_allowed',
        }
        return False
