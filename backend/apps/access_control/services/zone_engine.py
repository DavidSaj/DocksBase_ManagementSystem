"""
apps/access_control/services/zone_engine.py

Zone access resolution engine.

member_can_access_zone() resolution order (do NOT reorder):
  1. Card zones_override M2M — if zone is in override set, return True immediately.
     (Caller passes the card object when known; pass card=None to skip this check.)
  2. Look up ZoneAccessRule for (marina, member_type). If none, deny.
  3. If rule.link_to_berth_pier=True:
       Query active Bookings and (TODO) Contracts for berth__pier_label.
       Return zone.name in active pier labels.
  4. Otherwise: return rule.zones.filter(pk=zone.pk).exists().
"""

import logging
from datetime import date
from typing import Optional

logger = logging.getLogger(__name__)


def member_can_access_zone(member, zone, card=None, as_of: Optional[date] = None) -> bool:
    """
    Determine whether `member` may access `zone` on `as_of` date.

    Args:
        member:  apps.members.models.Member instance.
        zone:    apps.access_control.models.AccessZone instance.
        card:    apps.access_control.models.AccessCard instance, or None.
                 When provided, the card's zones_override M2M is checked first.
        as_of:   Date to evaluate time-bound bookings. Defaults to today.

    Returns:
        True if access is granted, False otherwise.
    """
    from apps.access_control.models import ZoneAccessRule

    as_of = as_of or date.today()

    # Step 1: card-level zone override
    if card is not None and card.is_active:
        if card.zones_override.filter(pk=zone.pk).exists():
            logger.debug(
                "access GRANTED via card override card=%s zone=%s member=%s",
                card.pk, zone.pk, member.pk,
            )
            return True

    # Step 2: lookup rule for member type
    rule = ZoneAccessRule.objects.filter(
        marina=member.marina,
        member_type=member.member_type,
    ).first()

    if rule is None:
        logger.debug(
            "access DENIED — no ZoneAccessRule for marina=%s member_type=%s",
            member.marina_id, member.member_type,
        )
        return False

    # Step 3: pier-linked rule
    if rule.link_to_berth_pier:
        pier_labels = _get_active_pier_labels(member, as_of)
        result = zone.name in pier_labels
        logger.debug(
            "access %s via pier check zone=%s pier_labels=%s member=%s",
            'GRANTED' if result else 'DENIED', zone.name, pier_labels, member.pk,
        )
        return result

    # Step 4: flat zone membership check
    result = rule.zones.filter(pk=zone.pk).exists()
    logger.debug(
        "access %s via flat zone rule zone=%s member=%s",
        'GRANTED' if result else 'DENIED', zone.pk, member.pk,
    )
    return result


def _get_active_pier_labels(member, as_of: date) -> set[str]:
    """
    Collect pier labels from all active bookings (and contracts when model is confirmed).
    Returns a set of pier_label strings for the member on as_of date.
    """
    pier_labels: set[str] = set()

    try:
        from apps.reservations.models import Booking
        booking_piers = Booking.objects.filter(
            vessel__owner=member,
            status='confirmed',
            check_in__lte=as_of,
            check_out__gte=as_of,
        ).values_list('berth__pier_label', flat=True)
        pier_labels.update(p for p in booking_piers if p)
    except Exception:
        logger.exception("Failed to query Booking pier labels for member=%s", member.pk)

    # TODO: Add Contract pier labels here once the Contract model is confirmed.
    # from apps.contracts.models import Contract
    # contract_piers = Contract.objects.filter(
    #     member=member, status='active',
    #     start_date__lte=as_of, end_date__gte=as_of,
    # ).values_list('berth__pier_label', flat=True)
    # pier_labels.update(p for p in contract_piers if p)

    return pier_labels
