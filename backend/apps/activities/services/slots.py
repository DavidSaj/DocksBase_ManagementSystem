from datetime import date, datetime, timedelta, timezone as dt_timezone
from math import ceil
from django.db.models import Sum

from ..models import Activity, ActivityBooking


COUNTED_STATUSES = (ActivityBooking.Status.CONFIRMED, ActivityBooking.Status.REQUESTED)


def _booked_seats(activity_id: int, start_dt: datetime) -> int:
    agg = ActivityBooking.objects.filter(
        activity_id=activity_id,
        start_datetime=start_dt,
        status__in=COUNTED_STATUSES,
    ).aggregate(total=Sum('participant_count'))
    return agg['total'] or 0


def _state(available: int, capacity_max: int) -> str:
    if available <= 0:
        return 'full'
    if available <= ceil(capacity_max * 0.2):
        return 'low'
    return 'open'


def materialise_slots(activity: Activity, date_from: str, date_to: str) -> list[dict]:
    d_from = date.fromisoformat(date_from)
    d_to   = date.fromisoformat(date_to)
    if d_to < d_from:
        return []

    templates = list(activity.time_slots.filter(is_active=True))
    if not templates:
        return []

    season_start = activity.season_start
    season_end   = activity.season_end

    results = []
    cur = d_from
    while cur <= d_to:
        if (season_start is None or cur >= season_start) and (season_end is None or cur <= season_end):
            for tpl in templates:
                if tpl.weekday != cur.weekday():
                    continue
                start_dt = datetime.combine(cur, tpl.start_time, tzinfo=dt_timezone.utc)
                booked = _booked_seats(activity.pk, start_dt)
                available = max(activity.capacity_max - booked, 0)
                results.append({
                    'start_datetime': start_dt.isoformat(),
                    'end_datetime': (start_dt + timedelta(minutes=activity.duration_minutes)).isoformat(),
                    'capacity_max': activity.capacity_max,
                    'available': available,
                    'state': _state(available, activity.capacity_max),
                })
        cur += timedelta(days=1)
    return results
