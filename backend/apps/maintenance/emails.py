"""Maintenance / Ops email helpers (critical defects, incident reports)."""

import logging

from django.conf import settings
from django.core.mail import send_mail

logger = logging.getLogger(__name__)


def _manager_recipients(marina):
    from apps.accounts.models import User
    return list(
        User.objects.filter(marina=marina, role__in=['owner', 'manager'])
        .values_list('email', flat=True)
    )


def send_critical_defect_email(defect):
    marina = defect.marina
    recipients = _manager_recipients(marina)
    if not recipients:
        logger.info('critical_defect: no manager recipients for marina %s, skipping', marina)
        return

    asset_line = f'Asset: {defect.asset.name}\n' if defect.asset_id else ''
    location_line = f'Location: {defect.location}\n' if defect.location else ''
    reporter_line = f'Reported by: {defect.reporter}\n' if defect.reporter else ''

    body = (
        f"Critical Defect — {marina.name}\n\n"
        f"A defect has been logged with critical severity and requires immediate attention.\n\n"
        f"Reference: DEF-{defect.pk}\n"
        f"{asset_line}"
        f"{location_line}"
        f"{reporter_line}"
        f"Severity: Critical\n\n"
        f"Description:\n{defect.description}\n\n"
        f"Open in DocksBase: {getattr(settings, 'FRONTEND_URL', '')}/maintenance\n\n"
        f"— DocksBase"
    )

    try:
        send_mail(
            subject=f"[Critical] DEF-{defect.pk} — {marina.name}",
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=recipients,
            fail_silently=False,
        )
        logger.info('critical_defect: alerted %d recipient(s) for DEF-%s', len(recipients), defect.pk)
    except Exception as exc:
        logger.exception('critical_defect: send failed for DEF-%s: %s', defect.pk, exc)


def send_incident_reported_email(incident):
    marina = incident.marina
    recipients = _manager_recipients(marina)
    if not recipients:
        logger.info('incident_reported: no manager recipients for marina %s, skipping', marina)
        return

    severity_label = dict(incident._meta.get_field('severity').choices).get(
        incident.severity, incident.severity.title()
    )
    vessel_line = f'Vessel: {incident.vessel.name}\n' if incident.vessel_id else ''
    berth_line = f'Berth: {incident.berth.code}\n' if incident.berth_id else ''
    reporter_line = f'Reported by: {incident.reporter}\n' if incident.reporter else ''
    occurred = incident.occurred_at.strftime('%d %B %Y %H:%M') if incident.occurred_at else '—'

    body = (
        f"Incident Reported — {marina.name}\n\n"
        f"A new incident has been logged.\n\n"
        f"Reference: INC-{incident.pk}\n"
        f"Severity: {severity_label}\n"
        f"Occurred: {occurred}\n"
        f"{vessel_line}"
        f"{berth_line}"
        f"{reporter_line}\n"
        f"Description:\n{incident.description}\n\n"
        f"Open in DocksBase: {getattr(settings, 'FRONTEND_URL', '')}/operations\n\n"
        f"— DocksBase"
    )

    try:
        send_mail(
            subject=f"[{severity_label}] INC-{incident.pk} — {marina.name}",
            message=body,
            from_email=settings.DEFAULT_FROM_EMAIL,
            recipient_list=recipients,
            fail_silently=False,
        )
        logger.info('incident_reported: alerted %d recipient(s) for INC-%s', len(recipients), incident.pk)
    except Exception as exc:
        logger.exception('incident_reported: send failed for INC-%s: %s', incident.pk, exc)
