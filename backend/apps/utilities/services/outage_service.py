"""
Outage detection service.

check_outages(marina_id):
  - For each active SmartMeter:
    - If last_polled is overdue (> poll_interval_minutes * 2) AND is_online=True:
        mark offline, create MeterOutageAlert, notify maintenance inbox.
    - If last_polled is recent AND is_online=False:
        mark online, resolve any open MeterOutageAlert.

Called by poll_service.poll_all_meters() after every poll cycle.
Also wired as a standalone Celery task for paranoia checks.
"""

import logging
from datetime import timedelta

from django.utils import timezone

logger = logging.getLogger(__name__)


def check_outages(marina_id: int) -> None:
    from apps.utilities.models import MeterOutageAlert, SmartMeter

    now = timezone.now()
    meters = SmartMeter.objects.filter(marina_id=marina_id, is_active=True)

    for meter in meters:
        if not meter.last_polled:
            # Never polled — skip outage detection until first reading arrives
            continue

        threshold = timedelta(minutes=meter.poll_interval_minutes * 2)
        overdue = (now - meter.last_polled) > threshold

        if overdue and meter.is_online:
            meter.is_online = False
            meter.save(update_fields=['is_online'])
            alert = MeterOutageAlert.objects.create(meter=meter)
            _notify_outage(alert)
            logger.warning(
                'Meter %s (id=%s) marked offline — overdue by %s',
                meter.device_id, meter.pk, now - meter.last_polled,
            )

        elif not overdue and not meter.is_online:
            meter.is_online = True
            meter.save(update_fields=['is_online'])
            MeterOutageAlert.objects.filter(meter=meter, resolved_at__isnull=True).update(
                resolved_at=now
            )
            logger.info('Meter %s (id=%s) back online — outage resolved', meter.device_id, meter.pk)


def _notify_outage(alert) -> None:
    """
    Notify the marina's maintenance inbox of a new meter outage.
    Uses the comms/notifications app if available; falls back to logging.
    Extend this stub to send email/in-app notification in production.
    """
    logger.error(
        'METER OUTAGE: %s started at %s — marina_id=%s',
        alert.meter.device_id,
        alert.started_at,
        alert.meter.marina_id,
    )
    # TODO: wire to apps.accounts.notifications.send_notification or similar
