"""
Geographic helpers for AIS work.

All distances are in nautical miles (1 nm = 1852 m). All bearings are
compass-style: 0° = North, increasing clockwise, in the range [0, 360).
"""
from __future__ import annotations

import math

EARTH_RADIUS_NM = 3440.065  # mean earth radius in nautical miles


def haversine_nm(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance between two points, in nautical miles."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlng / 2) ** 2
    c = 2 * math.asin(math.sqrt(a))
    return EARTH_RADIUS_NM * c


def bearing_deg(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """
    Initial compass bearing from (lat1, lng1) toward (lat2, lng2).
    Returns 0–360.
    """
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlng = math.radians(lng2 - lng1)
    y = math.sin(dlng) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dlng)
    brg = math.degrees(math.atan2(y, x))
    return (brg + 360) % 360


def point_in_polygon(lat: float, lng: float, polygon: list[tuple[float, float]]) -> bool:
    """
    Ray-casting test for whether (lat, lng) lies inside `polygon`.
    `polygon` is a list of (lat, lng) tuples; the last vertex implicitly
    connects to the first. Empty / <3-vertex polygons return False.
    """
    n = len(polygon)
    if n < 3:
        return False
    inside = False
    j = n - 1
    for i in range(n):
        lat_i, lng_i = polygon[i]
        lat_j, lng_j = polygon[j]
        intersect = ((lng_i > lng) != (lng_j > lng)) and (
            lat < (lat_j - lat_i) * (lng - lng_i) / (lng_j - lng_i + 1e-12) + lat_i
        )
        if intersect:
            inside = not inside
        j = i
    return inside
