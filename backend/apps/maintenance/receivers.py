"""
Signal receivers for the maintenance app.

Currently dispatches notification rules:
  - ops_critical_defect   (Defect created with severity='critical')
  - ops_incident_reported (Incident created — any severity)
"""

import logging

from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

from apps.accounts.notifications import rule_enabled
from .emails import send_critical_defect_email, send_incident_reported_email
from .models import Defect, Incident

logger = logging.getLogger(__name__)


@receiver(post_save, sender=Defect, dispatch_uid='maintenance.notify_critical_defect')
def on_defect_saved(sender, instance, created, **kwargs):
    if not created:
        return
    if instance.severity != 'critical':
        return
    if not rule_enabled(instance.marina, 'ops_critical_defect', 'email'):
        return
    transaction.on_commit(lambda: send_critical_defect_email(instance))


@receiver(post_save, sender=Incident, dispatch_uid='maintenance.notify_incident_reported')
def on_incident_saved(sender, instance, created, **kwargs):
    if not created:
        return
    if not rule_enabled(instance.marina, 'ops_incident_reported', 'email'):
        return
    transaction.on_commit(lambda: send_incident_reported_email(instance))
