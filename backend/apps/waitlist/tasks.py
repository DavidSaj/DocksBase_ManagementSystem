"""Celery tasks for the seasonal-slip waitlist.

Three periodic jobs:

- ``send_offer_reminder_t24h`` — emails applicants 24 h before their offer
  expires (window: 23.5–24.5 h remaining).
- ``send_offer_reminder_t2h`` — same shape but at the 2 h mark.
- ``expire_overdue_offers`` — flips any pending offer past ``expires_at`` to
  ``outcome='expired'``, runs the 3-strikes logic on its entry (same path as
  a manual decline), and emits the relevant audit / notification.

The reminder tasks are guarded by ``WaitlistOffer.reminder_sent_t24h`` /
``reminder_sent_t2h`` BooleanFields so they cannot double-send in the same
window.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------
def _dispatch_reminder(offer, *, hours_label: str):
    """Render and dispatch the offer-expiring-soon email."""
    from .services import _dispatch  # local import to keep module light

    entry = offer.entry
    subject = f'Your waitlist offer expires in {hours_label}'
    body = (
        f'Hi {entry.applicant_name},\n\n'
        f'This is a reminder that your berth offer (token: {offer.magic_token}) '
        f'expires at {offer.expires_at.isoformat()} ({hours_label} from now).\n\n'
        'Please respond before then to accept or decline.\n'
    )
    _dispatch(entry.marina, entry.applicant_email, subject, body)


# ---------------------------------------------------------------------------
# T-24h reminder
# ---------------------------------------------------------------------------
@shared_task(name='waitlist.send_offer_reminder_t24h')
def send_offer_reminder_t24h() -> dict:
    """Send a 24-hour-out reminder for every pending offer in the T-24h window.

    Idempotent via ``reminder_sent_t24h``: only fires once per offer.
    """
    from .models import WaitlistOffer

    now = timezone.now()
    window_lo = now + timedelta(hours=23, minutes=30)
    window_hi = now + timedelta(hours=24, minutes=30)

    qs = WaitlistOffer.objects.filter(
        outcome='pending',
        reminder_sent_t24h=False,
        expires_at__gte=window_lo,
        expires_at__lte=window_hi,
    ).select_related('entry', 'entry__marina')

    sent = 0
    for offer in qs:
        _dispatch_reminder(offer, hours_label='24 hours')
        offer.reminder_sent_t24h = True
        offer.save(update_fields=['reminder_sent_t24h'])
        sent += 1
    if sent:
        logger.info('waitlist.send_offer_reminder_t24h: %d sent', sent)
    return {'sent': sent}


# ---------------------------------------------------------------------------
# T-2h reminder
# ---------------------------------------------------------------------------
@shared_task(name='waitlist.send_offer_reminder_t2h')
def send_offer_reminder_t2h() -> dict:
    """Send a 2-hour-out reminder for every pending offer in the T-2h window."""
    from .models import WaitlistOffer

    now = timezone.now()
    # Tighter window for the closer reminder.
    window_lo = now + timedelta(hours=1, minutes=45)
    window_hi = now + timedelta(hours=2, minutes=15)

    qs = WaitlistOffer.objects.filter(
        outcome='pending',
        reminder_sent_t2h=False,
        expires_at__gte=window_lo,
        expires_at__lte=window_hi,
    ).select_related('entry', 'entry__marina')

    sent = 0
    for offer in qs:
        _dispatch_reminder(offer, hours_label='2 hours')
        offer.reminder_sent_t2h = True
        offer.save(update_fields=['reminder_sent_t2h'])
        sent += 1
    if sent:
        logger.info('waitlist.send_offer_reminder_t2h: %d sent', sent)
    return {'sent': sent}


# ---------------------------------------------------------------------------
# Expire-overdue sweep
# ---------------------------------------------------------------------------
@shared_task(name='waitlist.expire_overdue_offers')
def expire_overdue_offers() -> dict:
    """Flip every pending offer past ``expires_at`` to ``expired`` and run
    the 3-strikes path on its entry. Row-locks each offer + entry inside its
    own transaction so it interleaves safely with manual decline flows.
    """
    from .models import WaitlistOffer
    from .services import expire_offer

    now = timezone.now()
    overdue_ids = list(
        WaitlistOffer.objects
        .filter(outcome='pending', expires_at__lte=now)
        .values_list('pk', flat=True)
    )

    expired = 0
    removed = 0
    for offer_id in overdue_ids:
        try:
            offer = WaitlistOffer.objects.get(pk=offer_id)
        except WaitlistOffer.DoesNotExist:
            continue
        result = expire_offer(offer)
        if result.get('skipped'):
            continue
        expired += 1
        if result.get('removed'):
            removed += 1
    if expired:
        logger.info(
            'waitlist.expire_overdue_offers: expired=%d removed=%d',
            expired, removed,
        )
    return {'expired': expired, 'removed': removed}
