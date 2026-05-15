"""
AIS Celery tasks.

`poll_ais_for_all_marinas` is the beat-driven entry point. It fans out one
sub-task per marina that has a MarineTraffic key configured. Per-marina
failures are swallowed and logged so one bad marina cannot starve the rest.
"""
from __future__ import annotations

import logging
from math import cos, radians

from celery import shared_task

from apps.accounts.models import Marina
from apps.ais.adapters.marinetraffic import MarineTrafficAdapter
from apps.ais.services import upsert_position
from apps.vessels.models import Vessel

logger = logging.getLogger(__name__)

# 1° of latitude ≈ 60 nm. Longitude shrinks with cos(lat).
_NM_PER_LAT_DEG = 60.0


def _bbox(lat: float, lng: float, radius_nm: int) -> tuple[float, float, float, float]:
    dlat = radius_nm / _NM_PER_LAT_DEG
    dlng = radius_nm / max(_NM_PER_LAT_DEG * cos(radians(lat)), 1e-6)
    return (lat - dlat, lat + dlat, lng - dlng, lng + dlng)


@shared_task(name='apps.ais.tasks.poll_ais_for_all_marinas')
def poll_ais_for_all_marinas():
    """Beat entrypoint — fan out to every configured marina."""
    qs = Marina.objects.exclude(marinetraffic_api_key='').filter(
        lat__isnull=False, lng__isnull=False,
    )
    for marina_id in qs.values_list('id', flat=True):
        poll_ais_for_marina.delay(marina_id)


@shared_task(name='apps.ais.tasks.poll_ais_for_marina')
def poll_ais_for_marina(marina_id: int):
    try:
        marina = Marina.objects.get(pk=marina_id)
    except Marina.DoesNotExist:
        return
    if not marina.marinetraffic_api_key or marina.lat is None or marina.lng is None:
        return

    bbox = _bbox(float(marina.lat), float(marina.lng), marina.ais_poll_radius_nm)
    try:
        readings = MarineTrafficAdapter(marina.marinetraffic_api_key).fetch_positions(bbox)
    except Exception as e:  # noqa: BLE001
        logger.warning('AIS poll failed for marina %s: %s', marina_id, e)
        return

    from django.utils import timezone as _tz
    from apps.ais.detect_events import (
        compute_transition,
        on_basin_enter, on_basin_exit,
        detect_no_shows,
    )
    from apps.ais.models import VesselPosition

    mmsis = [r.mmsi for r in readings]
    known_vessels = {
        v.mmsi: v for v in
        Vessel.objects.filter(marina=marina, mmsi__in=mmsis)
    }
    prev_positions = {
        p.mmsi: p for p in
        VesselPosition.objects.filter(marina=marina, mmsi__in=mmsis)
    }

    polygon = marina.basin_polygon or []
    now = _tz.now()
    recipient = _pick_event_recipient(marina)
    transitions = []

    for reading in readings:
        in_basin, last_at, transition = compute_transition(
            prev_positions.get(reading.mmsi),
            float(reading.lat), float(reading.lng),
            polygon, now,
        )
        position, _ = upsert_position(
            marina, reading, vessel=known_vessels.get(reading.mmsi),
            in_basin=in_basin, last_transition_at=last_at, transition=transition,
        )
        if transition:
            transitions.append((position, transition))

    for position, transition in transitions:
        if transition == 'enter':
            on_basin_enter(position, recipient=recipient)
        else:
            on_basin_exit(position, recipient=recipient)

    if recipient is not None:
        detect_no_shows(marina, recipient=recipient)

    logger.info('AIS poll marina=%s readings=%d matched=%d transitions=%d',
                marina_id, len(readings),
                sum(1 for r in readings if r.mmsi in known_vessels),
                len(transitions))


def _pick_event_recipient(marina):
    """Owner of the marina is the default in-app recipient for AIS events."""
    from apps.accounts.models import User
    return User.objects.filter(marina=marina, role='owner').first() or \
           User.objects.filter(marina=marina).first()
