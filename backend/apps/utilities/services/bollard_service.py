"""
Service bollard remote switching service.

switch_bollard(bollard, action, triggered_by=None, reason='') -> dict

Creates a BollardSwitchEvent audit record regardless of success/failure.
Returns the vendor_response dict.

If the bollard vendor adapter does not implement switch(), the call will
raise NotImplementedError — catch in the caller to return a 501.
"""

import logging

from apps.utilities.vendors.base import VendorConnectionError, get_vendor_adapter

logger = logging.getLogger(__name__)


def switch_bollard(bollard, action: str, triggered_by=None, reason: str = '') -> dict:
    """
    Send a remote on/off command to a bollard via its vendor API.
    Creates BollardSwitchEvent audit record regardless of success.

    Args:
        bollard:      ServiceBollard instance (must have has_remote_switch=True).
        action:       'on' or 'off'
        triggered_by: User instance or None (e.g. system-triggered cut-off)
        reason:       Human-readable reason for audit trail.

    Returns:
        vendor_response dict from the adapter.

    Raises:
        ValueError: if bollard.has_remote_switch is False.
    """
    from apps.utilities.models import BollardSwitchEvent

    if not bollard.has_remote_switch:
        raise ValueError(f'Bollard {bollard.label!r} (id={bollard.pk}) does not support remote switching.')

    if action not in ('on', 'off'):
        raise ValueError(f'action must be "on" or "off", got: {action!r}')

    try:
        adapter = get_vendor_adapter(bollard.vendor, bollard.marina_id)
        vendor_response = adapter.switch(bollard.vendor_device_id, action)
        success = True
    except VendorConnectionError as exc:
        vendor_response = {'error': str(exc)}
        success = False
        logger.error(
            'Bollard switch failed (vendor error): bollard=%s action=%s error=%s',
            bollard.pk, action, exc,
        )
    except Exception as exc:
        vendor_response = {'error': str(exc)}
        success = False
        logger.exception('Bollard switch unexpected error: bollard=%s action=%s', bollard.pk, action)

    BollardSwitchEvent.objects.create(
        bollard=bollard,
        action=action,
        triggered_by=triggered_by,
        reason=reason,
        success=success,
        vendor_response=vendor_response,
    )

    if success:
        bollard.status = 'active' if action == 'on' else 'suspended'
        bollard.save(update_fields=['status'])
        logger.info('Bollard %s (id=%s) switched %s', bollard.label, bollard.pk, action)

    return vendor_response
