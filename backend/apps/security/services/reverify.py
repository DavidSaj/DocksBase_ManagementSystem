"""
Email re-verification service.

Provides status_for(user) -> 'ok' | 'warning' | 'blocked'

Thresholds (per spec §Email re-verify):
  < 180 days  → 'ok'
  180–209 days → 'warning'  (X-Email-Reverify: warning header via middleware)
  ≥ 210 days  → 'blocked'   (DRF permission class returns False)

SMTP guard: If the marina has no smtp_host configured, we cannot actually
deliver the re-verification email, so we degrade gracefully to 'ok' rather
than hard-blocking a user who has no way to unblock themselves.

Users with no marina (platform admins, system tasks) are always 'ok'.
"""

from datetime import timedelta

from django.utils import timezone

THRESHOLD_WARN  = timedelta(days=180)
THRESHOLD_BLOCK = timedelta(days=210)


def status_for(user) -> str:
    """
    Return the email re-verification status for a user.

    Returns:
        'ok'      — no action required
        'warning' — approaching expiry; banner should prompt re-verification
        'blocked' — hard block; permission class will return 403
    """
    base = getattr(user, 'email_verified_at', None) or getattr(user, 'created_at', None)
    if base is None:
        return 'ok'  # defensive — never block on missing data

    age = timezone.now() - base
    if age < THRESHOLD_WARN:
        return 'ok'
    if age < THRESHOLD_BLOCK:
        return 'warning'

    # Hard block — but only if SMTP is configured (else we can't send the email)
    marina = getattr(user, 'marina', None)
    if marina is None or not getattr(marina, 'smtp_host', None):
        return 'ok'  # graceful degradation per spec

    return 'blocked'
