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
from typing import Optional, Tuple

from apps.ais.geometry import point_in_polygon

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
