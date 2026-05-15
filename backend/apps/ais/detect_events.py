"""
AIS Phase 2 — event detection.

Polygon math and hysteresis run BEFORE the database write. The poll task
passes the previous VesselPosition row (or None on first sighting) into
compute_transition(), then folds the returned (in_basin, last_transition_at)
into the same update_or_create that writes lat/lng. Booking handlers fire
AFTER the transaction commits.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from datetime import timedelta as _td
from typing import Optional, Tuple

from django.db import transaction as _txn
from django.utils import timezone as _tz

from apps.ais.geometry import point_in_polygon
from apps.ais.notifications import (
    notify_auto_checkin,
    notify_auto_checkout,
)
from apps.reservations.models import Booking as _Booking

logger = logging.getLogger(__name__)

DWELL = timedelta(minutes=5)


def compute_transition(
    prev,                          # VesselPosition | None
    lat: float,
    lng: float,
    polygon: list,
    now: datetime,
) -> Tuple[bool, Optional[datetime], Optional[str]]:
    """
    Decide what (in_basin, last_transition_at, transition) values to persist
    for this reading.

    `prev` is the existing VesselPosition row for (marina, mmsi) or None on
    first sighting. `polygon` is the marina's basin polygon (list of [lat,
    lng] pairs). `now` is the timestamp to record on a transition.

    Returns no transition (third tuple element is None) when the basin state
    is unchanged or the 5-minute dwell window has not elapsed since the
    previous flip.
    """
    if not polygon or len(polygon) < 3:
        return (False, prev.last_transition_at if prev else None, None)

    polygon_tuples = [(float(v[0]), float(v[1])) for v in polygon]
    new_in_basin = point_in_polygon(float(lat), float(lng), polygon_tuples)
    prev_in_basin = bool(prev.in_basin) if prev is not None else False
    prev_transition_at = prev.last_transition_at if prev else None

    if new_in_basin == prev_in_basin:
        return (new_in_basin, prev_transition_at, None)

    if prev_transition_at is not None and (now - prev_transition_at) < DWELL:
        return (prev_in_basin, prev_transition_at, None)

    transition = 'enter' if new_in_basin else 'exit'
    return (new_in_basin, now, transition)


def _today():
    return _tz.localdate()


def on_basin_enter(position, *, recipient):
    if position.vessel_id is None:
        return
    today = _today()
    candidates = _Booking.objects.filter(
        marina=position.marina,
        vessel_id=position.vessel_id,
        status='confirmed',
        check_in__lte=today + _td(days=1),
        check_out__gte=today,
    )
    matches = list(candidates[:2])
    if len(matches) == 0:
        return
    if len(matches) > 1:
        logger.warning(
            'ais.auto_checkin.multiple_match marina=%s vessel=%s count=%d',
            position.marina_id, position.vessel_id, len(matches),
        )
        return
    booking = matches[0]
    with _txn.atomic():
        booking.status = 'checked_in'
        booking.self_checked_in_at = position.reported_at
        booking.ais_no_show_predicted = False
        booking.save(update_fields=['status', 'self_checked_in_at', 'ais_no_show_predicted'])
    notify_auto_checkin(booking, recipient=recipient)


def on_basin_exit(position, *, recipient):
    if position.vessel_id is None:
        return
    today = _today()
    candidates = _Booking.objects.filter(
        marina=position.marina,
        vessel_id=position.vessel_id,
        status='checked_in',
        check_out__lte=today + _td(days=1),
    )
    matches = list(candidates[:2])
    if len(matches) != 1:
        if len(matches) > 1:
            logger.warning(
                'ais.auto_checkout.multiple_match marina=%s vessel=%s',
                position.marina_id, position.vessel_id,
            )
        return
    booking = matches[0]
    with _txn.atomic():
        booking.status = 'checked_out'
        booking.save(update_fields=['status'])
        _finalize_turnaround_invoice(booking)
    notify_auto_checkout(booking, recipient=recipient)


def _finalize_turnaround_invoice(booking):
    """Mirror the manual-checkout finalization in apps/reservations/views.py."""
    from apps.billing.models import Invoice
    from apps.billing import service as billing_service
    draft = Invoice.objects.filter(
        marina=booking.marina,
        source_type='berth_booking',
        source_id=str(booking.id),
        status='draft',
    ).first()
    if draft and draft.items.exists():
        try:
            billing_service.finalize_invoice(draft)
        except Exception:
            logger.exception('ais.turnaround.finalize_failed booking=%s', booking.id)
