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

    # Pre-resolve known vessels in ONE query rather than per-reading.
    # A busy harbour can return 300+ AIS contacts and we run this every
    # 60 s — N+1 would exhaust the DB connection pool quickly.
    from apps.vessels.models import Vessel
    mmsis = [r.mmsi for r in readings]
    known_vessels = {
        v.mmsi: v for v in
        Vessel.objects.filter(marina=marina, mmsi__in=mmsis)
    }

    for reading in readings:
        upsert_position(marina, reading, vessel=known_vessels.get(reading.mmsi))

    logger.info('AIS poll marina=%s readings=%d matched=%d',
                marina_id, len(readings), sum(1 for r in readings if r.mmsi in known_vessels))
