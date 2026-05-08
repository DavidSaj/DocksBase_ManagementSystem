"""
apps/access_control/tasks.py

All tasks are plain functions. When Celery is introduced, uncomment @shared_task.

Beat schedule (add to CELERY_BEAT_SCHEDULE in settings/base.py when Celery is wired):
    'deactivate-expired-access-cards': {
        'task': 'access_control.deactivate_expired_access_cards',
        'schedule': crontab(hour=1, minute=0),
    },
    'detect-fraud-anomalies': {
        'task': 'access_control.detect_fraud_anomalies',
        'schedule': crontab(hour=3, minute=0),
    },
    'purge-old-access-events': {
        'task': 'access_control.purge_old_access_events',
        'schedule': crontab(hour=2, minute=0),
    },
"""

import hashlib
import logging
from datetime import date, timedelta

from django.utils import timezone

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# On-demand: sync a reader's credential table
# ---------------------------------------------------------------------------

# @shared_task
def sync_zone_task(reader_id: int):
    """
    Build the full allowed-credential list for a reader's zone and push it
    to the hardware via adapter.sync_zone().
    """
    from apps.access_control.models import AccessCard, AccessReader, AccessZone, ZoneAccessRule
    from apps.access_control.hal.factory import get_rfid_adapter
    from apps.access_control.hal.base import CardCredential

    try:
        reader = AccessReader.objects.select_related('marina', 'zone').get(pk=reader_id)
    except AccessReader.DoesNotExist:
        logger.warning("sync_zone_task: reader %s not found", reader_id)
        return

    zone    = reader.zone
    marina  = reader.marina
    adapter = get_rfid_adapter(marina)

    # Collect all active cards that have access to this zone
    allowed_cards = AccessCard.objects.filter(
        marina=marina, is_active=True,
    ).filter(
        # Either card has a direct zone override, or the member's rule includes the zone
        zones_override=zone,
    ) | AccessCard.objects.filter(
        marina=marina, is_active=True,
        member__marina=marina,
    )
    # Deduplicate
    allowed_credentials = [
        CardCredential(card_uid=c.card_uid, facility_code=c.facility_code, member_id=c.member_id)
        for c in allowed_cards.distinct()
    ]

    success = adapter.sync_zone(reader.reader_uid, allowed_credentials)
    if not success:
        logger.error("sync_zone_task: hardware sync failed reader=%s", reader_id)


# ---------------------------------------------------------------------------
# On-demand (triggered by signal on_commit): revoke card from all readers
# ---------------------------------------------------------------------------

# @shared_task
def revoke_access_on_card_deactivate(card_id: int):
    """
    Revoke a deactivated card's access from all active readers in zones
    the card had access to.
    """
    from apps.access_control.models import AccessCard, AccessReader
    from apps.access_control.hal.factory import get_rfid_adapter
    from apps.access_control.hal.base import CardCredential

    try:
        card = AccessCard.objects.select_related('marina', 'member').get(pk=card_id)
    except AccessCard.DoesNotExist:
        logger.warning("revoke_access_on_card_deactivate: card %s not found", card_id)
        return

    marina     = card.marina
    adapter    = get_rfid_adapter(marina)
    credential = CardCredential(
        card_uid=card.card_uid,
        facility_code=card.facility_code,
        member_id=card.member_id,
    )

    readers = AccessReader.objects.filter(marina=marina, is_active=True)
    for reader in readers:
        success = adapter.revoke_access(reader.reader_uid, credential)
        if not success:
            logger.error(
                "revoke_access_on_card_deactivate: hardware revoke failed card=%s reader=%s",
                card_id, reader.pk,
            )


# ---------------------------------------------------------------------------
# Daily at 01:00: deactivate expired cards
# ---------------------------------------------------------------------------

# @shared_task
def deactivate_expired_access_cards():
    """Daily sweep — deactivates all cards whose valid_to has passed."""
    from apps.accounts.models import Marina
    from apps.access_control.services.card_lifecycle import deactivate_expired_cards_for_marina

    for marina in Marina.objects.all():
        count = deactivate_expired_cards_for_marina(marina)
        if count:
            logger.info("Deactivated %d expired cards for marina=%s", count, marina.pk)


# ---------------------------------------------------------------------------
# Daily at 03:00: detect fraud anomalies
# ---------------------------------------------------------------------------

# @shared_task
def detect_fraud_anomalies():
    """Daily fraud detection sweep across all marinas."""
    from apps.accounts.models import Marina
    from apps.access_control.services.fraud_detector import detect_fraud_for_marina

    for marina in Marina.objects.all():
        alerts = detect_fraud_for_marina(marina)
        if alerts:
            logger.info("Created %d fraud alerts for marina=%s", len(alerts), marina.pk)


# ---------------------------------------------------------------------------
# Nightly at 02:00: purge old access events
# ---------------------------------------------------------------------------

# @shared_task
def purge_old_access_events():
    """
    Delete AccessEvent records older than marina.features['access_log_retention_days'] (default 730).
    Pseudonymise ANPREvent records (set matched_member=None, hash plate_detected).
    """
    from apps.accounts.models import Marina
    from apps.access_control.models import AccessEvent, ANPREvent

    for marina in Marina.objects.all():
        retention_days = marina.features.get('access_log_retention_days', 730)
        cutoff = timezone.now() - timedelta(days=retention_days)

        deleted_count, _ = AccessEvent.objects.filter(marina=marina, occurred_at__lt=cutoff).delete()
        if deleted_count:
            logger.info("Purged %d old AccessEvents for marina=%s", deleted_count, marina.pk)

        # Pseudonymise old ANPR events (GDPR — plate is personal data in some jurisdictions)
        old_anpr = ANPREvent.objects.filter(marina=marina, occurred_at__lt=cutoff)
        for event in old_anpr:
            hashed_plate = hashlib.sha256(event.plate_detected.encode()).hexdigest()[:16]
            event.plate_detected  = f"[hashed:{hashed_plate}]"
            event.matched_member  = None
            event.vehicle         = None
            event.save(update_fields=['plate_detected', 'matched_member', 'vehicle'])


# ---------------------------------------------------------------------------
# On-demand: GDPR biometric revocation with exponential backoff
# ---------------------------------------------------------------------------

# @shared_task(max_retries=20)
def revoke_biometric_enrolment(enrolment_pk: int):
    """
    GDPR Art. 17 — delete biometric template from hardware terminal.

    On success: hard-deletes the BiometricEnrolment row.
    On failure after 24h: creates FraudAnomalyAlert(alert_type='biometric_deletion_stalled').
    Designed for Celery retry with exponential backoff (30s → ~6h max interval).
    Uses all_objects manager (unfiltered) — pending_deletion rows are invisible
    to the default manager but must still be processed here.
    """
    from apps.access_control.models import BiometricEnrolment, FraudAnomalyAlert
    from apps.access_control.hal.factory import get_biometric_adapter

    enrolment = BiometricEnrolment.all_objects.filter(pk=enrolment_pk).first()
    if enrolment is None:
        return  # already hard-deleted — idempotent

    adapter = get_biometric_adapter(enrolment.marina)
    try:
        success = adapter.revoke_face(enrolment.terminal_uid, enrolment.template_handle)
    except Exception:
        success = False
        logger.exception("revoke_biometric_enrolment: adapter raised exception enrolment=%s", enrolment_pk)

    if success:
        enrolment.delete()  # hard delete — no residual biometric handle in DB
        logger.info("BiometricEnrolment %s hard-deleted after successful terminal wipe", enrolment_pk)
        return

    # Failed — check staleness
    if enrolment.pending_deletion_since:
        elapsed = timezone.now() - enrolment.pending_deletion_since
        if elapsed.total_seconds() > 86400:  # 24 hours
            subject_label = str(enrolment.member or enrolment.staff_member)
            FraudAnomalyAlert.objects.get_or_create(
                marina=enrolment.marina,
                alert_type='biometric_deletion_stalled',
                resolved_at__isnull=True,
                defaults={
                    'staff_member': None,
                    'period_start': enrolment.pending_deletion_since,
                    'period_end':   timezone.now(),
                    'event_count':  1,
                    'resolution_note': (
                        f"Terminal UID: {enrolment.terminal_uid}. "
                        f"Subject: {subject_label}. "
                        f"Deletion requested at: {enrolment.pending_deletion_since:%Y-%m-%d %H:%M}. "
                        "GDPR Art. 17 compliance at risk."
                    ),
                },
            )
            logger.error(
                "BiometricEnrolment %s deletion stalled >24h terminal=%s subject=%s",
                enrolment_pk, enrolment.terminal_uid, subject_label,
            )

    # Re-queue with exponential backoff (when Celery is available)
    # self.retry(countdown=min(30 * 2 ** self.request.retries, 21600))
    raise RuntimeError(f"Terminal unreachable — will retry (enrolment={enrolment_pk})")
