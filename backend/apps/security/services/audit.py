"""
Audit log service — Task 4.

log_event() is the single entry point for writing SecurityAuditLog rows.
All security-relevant events (MFA, IP allowlist, password change, email
re-verify, API key lifecycle) funnel through here.

API keys (api_key_created / api_key_revoked / api_key_deleted) wiring is
deferred pending PR #57 merge. Add a log_event() call in
apps.api_keys.views.APIKeyViewSet.create, revoke, and destroy once PR #57
lands on this branch.

Password-change wiring: no dedicated password-change endpoint was found in
apps.accounts.views (grep for set_password / ChangePassword confirmed no
standalone view). If a password-change endpoint is added in the future, call
log_event(marina=user.marina, actor=user, event_type='password_changed',
payload={}, request=request) from that view.
"""

from apps.security.permissions import _client_ip


def log_event(*, marina, actor, event_type, payload=None, request=None):
    """
    Persist a security audit event. Append-only.

    Args:
        marina:     accounts.Marina instance.
        actor:      User instance or None (e.g. for system-generated events).
        event_type: One of SecurityAuditLog.EVENT_CHOICES keys.
        payload:    dict — event-type-specific details. Defaults to {}.
                    Never include raw secrets, passwords, codes, or challenge
                    tokens. See spec §Audit log payload schema for the
                    canonical shape per event_type.
        request:    The current DRF/Django request, or None (e.g. from a
                    Celery task). When None, ip_address and user_agent are
                    left blank.

    Notes on IP resolution:
        Uses the same _client_ip() helper as IPAllowlistPermission (defined
        in apps.security.permissions) — currently REMOTE_ADDR only, since no
        trusted-proxy header is configured. When a proxy layer is added,
        update _client_ip() and this function benefits automatically.
    """
    from apps.security.models import SecurityAuditLog

    ip = None
    ua = ''
    if request is not None:
        ip = _client_ip(request) or None
        ua = (request.META.get('HTTP_USER_AGENT') or '')[:500]

    SecurityAuditLog.objects.create(
        marina=marina,
        actor=actor,
        event_type=event_type,
        payload=payload if payload is not None else {},
        ip_address=ip,
        user_agent=ua,
    )
