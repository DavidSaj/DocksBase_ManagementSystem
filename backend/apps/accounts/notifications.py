"""
Notification-rule gating for per-marina email/SMS dispatches.

A "rule" is a stable key matched against marina.notification_rules, e.g.
``booking_arrival_reminder_24h``. Each rule has two channels: ``email`` and
``sms``. The keys correspond to the toggles in Settings → Notifications.

Default semantics when a rule is missing or a channel is unset:
  - email: ON  (preserves prior behavior — all existing emails fired
    unconditionally, so unset === ON keeps current customers' alerts working)
  - sms:   OFF (SMS is opt-in by construction)

When wiring a new send-site, prefer ``rule_enabled(marina, key, channel)``
to gate the dispatch. Use ``dispatch_notification(...)`` for the common case
of "send one email and/or one SMS to a single recipient".
"""

import logging
from typing import Optional

from django.conf import settings
from django.core.mail import send_mail

logger = logging.getLogger(__name__)


_CHANNEL_DEFAULTS = {'email': True, 'sms': False}


def rule_enabled(marina, rule_key: str, channel: str) -> bool:
    """Return True if `channel` is enabled for `rule_key` on this marina."""
    if marina is None:
        return _CHANNEL_DEFAULTS.get(channel, False)
    rules = getattr(marina, 'notification_rules', None) or {}
    rule = rules.get(rule_key)
    if not isinstance(rule, dict):
        return _CHANNEL_DEFAULTS.get(channel, False)
    if channel not in rule:
        return _CHANNEL_DEFAULTS.get(channel, False)
    return bool(rule[channel])


def dispatch_notification(
    *,
    marina,
    rule_key: str,
    subject: str,
    body: str,
    email_to: Optional[list] = None,
    sms_to: Optional[str] = None,
    html_message: Optional[str] = None,
    from_email: Optional[str] = None,
) -> dict:
    """
    Send `subject`/`body` to the given recipients via the channels enabled for
    `rule_key`. Returns ``{'email_sent': bool, 'sms_sent': bool}``.
    """
    result = {'email_sent': False, 'sms_sent': False}

    if email_to and rule_enabled(marina, rule_key, 'email'):
        try:
            send_mail(
                subject=subject,
                message=body,
                from_email=from_email or settings.DEFAULT_FROM_EMAIL,
                recipient_list=email_to,
                html_message=html_message,
                fail_silently=True,
            )
            result['email_sent'] = True
        except Exception as exc:
            logger.exception('dispatch_notification[%s]: email failed: %s', rule_key, exc)

    if sms_to and rule_enabled(marina, rule_key, 'sms'):
        from apps.berths.sms_service import send_sms
        try:
            result['sms_sent'] = send_sms(sms_to, body, marina=marina)
        except Exception as exc:
            logger.exception('dispatch_notification[%s]: sms failed: %s', rule_key, exc)

    return result
