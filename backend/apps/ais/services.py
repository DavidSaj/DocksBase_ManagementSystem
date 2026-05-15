"""
AIS service layer — small functions called by the poll task and read API.
"""
from __future__ import annotations

import logging
from datetime import timedelta

from django.utils import timezone

from apps.ais.adapters.base import AISReading
from apps.ais.geometry import bearing_deg, haversine_nm
from apps.ais.models import VesselPosition
from apps.reservations.models import Booking

logger = logging.getLogger(__name__)


def upsert_position(
    marina,
    reading: AISReading,
    vessel=None,
    *,
    in_basin: bool = False,
    last_transition_at=None,
    transition: str | None = None,
):
    """
    Insert or update the latest position for (marina, mmsi).

    The caller (poll task) computes basin state via `compute_transition()`
    BEFORE invoking this function. `in_basin` and `last_transition_at` are
    written in the same UPDATE that records lat/lng, so a busy marina with
    300 contacts at 60 s polling produces 300 UPDATEs per cycle, not 600.

    Returns `(VesselPosition, transition)` where `transition` is one of
    'enter', 'exit', or None.
    """
    obj, _ = VesselPosition.objects.update_or_create(
        marina=marina, mmsi=reading.mmsi,
        defaults={
            'lat':                reading.lat,
            'lng':                reading.lng,
            'speed_kn':           reading.speed_kn,
            'course_deg':         reading.course_deg,
            'heading_deg':        reading.heading_deg,
            'nav_status':         reading.nav_status,
            'reported_at':        reading.reported_at,
            'vessel':             vessel,
            'source':             'marinetraffic',
            'in_basin':           in_basin,
            'last_transition_at': last_transition_at,
        },
    )
    return obj, transition


def get_inbound_etas(
    marina, *,
    horizon_hours: int = 24,
    max_distance_nm: float = 50.0,
):
    """
    Bookings within the next `horizon_hours` whose linked vessel has a
    recent AIS contact within `max_distance_nm` of the marina. Sorted by
    closest ETA first.
    """
    if marina.lat is None or marina.lng is None:
        return []

    now = timezone.now()
    window_end = (now + timedelta(hours=horizon_hours)).date()

    bookings = (
        Booking.objects
        .filter(
            marina=marina,
            status__in=['confirmed', 'awaiting_payment', 'pending_payment'],
            check_in__lte=window_end,
            check_in__gte=now.date(),
            vessel__isnull=False,
        )
        .select_related('vessel')
    )

    mmsis = {b.vessel.mmsi for b in bookings if b.vessel.mmsi}
    if not mmsis:
        return []

    positions = {
        p.mmsi: p for p in
        VesselPosition.objects.filter(marina=marina, mmsi__in=mmsis)
    }

    mlat, mlng = float(marina.lat), float(marina.lng)
    rows = []
    for booking in bookings:
        pos = positions.get(booking.vessel.mmsi)
        if not pos:
            continue
        plat, plng = float(pos.lat), float(pos.lng)
        distance = haversine_nm(plat, plng, mlat, mlng)
        if distance > max_distance_nm:
            continue
        bearing  = bearing_deg(plat, plng, mlat, mlng)
        speed    = float(pos.speed_kn) if pos.speed_kn is not None else 0.0
        eta_min  = round((distance / max(speed, 1.0)) * 60)
        eta_when = now + timedelta(minutes=eta_min)

        rows.append({
            'booking_id':   booking.id,
            'guest_name':   booking.guest_name or (booking.vessel.name or ''),
            'vessel_name':  booking.vessel.name or '',
            'mmsi':         pos.mmsi,
            'check_in':     booking.check_in.isoformat(),
            # ISO 8601 with offset — the React side renders this in the
            # browser's locale. Server-side strftime('%H:%M') on a UTC
            # datetime would show the wrong local time to Italian (CEST)
            # or US harbourmasters.
            'eta':          eta_when.isoformat(),
            'eta_minutes':  eta_min,
            'distance_nm':  round(distance, 1),
            'bearing_deg':  round(bearing),
            'speed_kn':     round(speed, 1),
            'last_seen':    pos.reported_at.isoformat(),
        })

    rows.sort(key=lambda r: r['eta_minutes'])
    return rows
