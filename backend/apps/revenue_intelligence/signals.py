"""
Signals for Revenue Intelligence.

Registered in RevenueIntelligenceConfig.ready().
"""

from __future__ import annotations

import logging

from django.db import transaction
from django.db.models.signals import post_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)


@receiver(post_save, sender='revenue_intelligence.WaitlistOffer')
def _on_waitlist_offer_saved(sender, instance, created, **kwargs):
    """No-op placeholder — real notification logic goes here."""
    pass


@receiver(post_save, sender='revenue_intelligence.UpgradeCampaign')
def _on_upgrade_campaign_saved(sender, instance, created, **kwargs):
    """No-op placeholder — real notification logic goes here."""
    pass
