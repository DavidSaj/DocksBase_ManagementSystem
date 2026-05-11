"""
Availability checking services for activities.

All checks use proper datetime overlap (start_datetime__lt=end_dt, end_datetime__gt=start_dt),
never date-only comparison. Date-only comparison would miss cross-midnight sessions and
produce false "no conflict" results for two bookings on the same day that genuinely overlap.
"""
from datetime import datetime, timedelta

from apps.activities.models import ActivityBooking, AssetReservation


# Map the day abbreviations stored in Shift to weekday() integers (Monday = 0)
_DAY_TO_WEEKDAY = {
    'mon': 0, 'tue': 1, 'wed': 2,
    'thu': 3, 'fri': 4, 'sat': 5, 'sun': 6,
}


def check_instructor_availability(staff_member, start_dt, end_dt, exclude_booking_id=None):
    """
    Returns True only if the instructor is both:
    1. Scheduled to work (has a Shift covering this datetime window), AND
    2. Not already assigned to another confirmed ActivityBooking that overlaps.

    Uses proper datetime overlap — NOT date-only comparison, which would miss
    cross-midnight sessions and cause false conflicts within the same day.
    """
    from apps.staff.models import Shift

    # Step 1: Check that a Shift covers the window.
    # Shift stores week_start + day abbreviation. We reconstruct the shift date as
    # week_start + offset(day) and combine with start_time/end_time to get datetimes.
    booking_date = start_dt.date()
    booking_weekday = booking_date.weekday()  # Monday=0

    shifts = Shift.objects.filter(
        staff_member=staff_member,
        week_start__lte=booking_date,
        is_off=False,
    )

    shift_covers = False
    for shift in shifts:
        # Reconstruct the date this shift applies to
        day_offset = _DAY_TO_WEEKDAY.get(shift.day, -1)
        if day_offset < 0:
            continue
        shift_date = shift.week_start + timedelta(days=day_offset)
        if shift_date != booking_date:
            continue
        if shift.start_time is None or shift.end_time is None:
            continue
        # Use the same tzinfo as start_dt so comparison is apples-to-apples
        tz = getattr(start_dt, 'tzinfo', None)
        shift_start = datetime.combine(shift_date, shift.start_time).replace(tzinfo=tz)
        shift_end   = datetime.combine(shift_date, shift.end_time).replace(tzinfo=tz)
        if shift_start <= start_dt and shift_end >= end_dt:
            shift_covers = True
            break

    if not shift_covers:
        return False

    # Step 2: Check no overlapping confirmed ActivityBooking already uses this instructor.
    # This uses proper datetime overlap: existing_start < our_end AND existing_end > our_start.
    qs = ActivityBooking.objects.filter(
        assigned_instructor=staff_member,
        status=ActivityBooking.Status.CONFIRMED,
        start_datetime__lt=end_dt,   # existing booking starts before our end
        end_datetime__gt=start_dt,   # existing booking ends after our start
    )
    if exclude_booking_id:
        qs = qs.exclude(pk=exclude_booking_id)
    return not qs.exists()


def check_asset_availability(asset, start_dt, end_dt, exclude_booking_id=None):
    """
    Checks AssetReservation for conflicts using DateTimeRangeField overlap.

    Uses time_range__overlap rather than start_datetime/end_datetime range filters
    because the ExclusionConstraint operates on DateTimeRangeField values.
    This check is a service-layer pre-flight; the database constraint is the hard guard.
    """
    from psycopg2.extras import DateTimeTZRange

    window = DateTimeTZRange(start_dt, end_dt)
    qs = AssetReservation.objects.filter(asset=asset, time_range__overlap=window)
    if exclude_booking_id:
        qs = qs.exclude(activity_booking_id=exclude_booking_id)
    return not qs.exists()


def get_activity_availability(activity, date_from, date_to):
    """
    Returns a list of slot dicts for the given activity between date_from and date_to (inclusive).
    Each dict has:
      - slot_start (datetime)
      - slot_end   (datetime)
      - bookable   (bool)
      - capacity_remaining (int)
      - instructor_available (bool)
      - equipment_available  (bool)
    """
    from datetime import timedelta
    import pytz

    tz = pytz.utc
    slots = []
    current_date = date_from
    duration = timedelta(minutes=activity.duration_minutes)

    while current_date <= date_to:
        # Build a single slot at 09:00 UTC per day as a default availability window.
        # In production this would expand based on marina operating hours.
        slot_start = datetime(current_date.year, current_date.month, current_date.day,
                              9, 0, tzinfo=tz)
        slot_end = slot_start + duration

        # Season check
        if activity.season_start and activity.season_end:
            if not (activity.season_start <= current_date <= activity.season_end):
                current_date += timedelta(days=1)
                continue

        # Count confirmed bookings overlapping this slot
        overlapping_count = ActivityBooking.objects.filter(
            activity=activity,
            status=ActivityBooking.Status.CONFIRMED,
            start_datetime__lt=slot_end,
            end_datetime__gt=slot_start,
        ).count()

        capacity_remaining = activity.capacity_max - overlapping_count

        # Check instructor availability
        instructor_available = True
        for req in activity.resource_requirements.filter(
                resource_type='instructor').select_related('staff_member'):
            candidate = req.staff_member
            if candidate:
                instructor_available = check_instructor_availability(
                    candidate, slot_start, slot_end
                )
            else:
                # Any staff with required_role — simplified: assume available if no specific person
                instructor_available = True
            if not instructor_available:
                break

        # Check equipment availability
        equipment_available = True
        for req in activity.resource_requirements.filter(
                resource_type='asset').select_related('asset'):
            if req.asset:
                equipment_available = check_asset_availability(req.asset, slot_start, slot_end)
            if not equipment_available:
                break

        bookable = (
            capacity_remaining >= activity.capacity_min
            and instructor_available
            and equipment_available
        )

        slots.append({
            'slot_start': slot_start.isoformat(),
            'slot_end': slot_end.isoformat(),
            'bookable': bookable,
            'capacity_remaining': max(capacity_remaining, 0),
            'instructor_available': instructor_available,
            'equipment_available': equipment_available,
        })

        current_date += timedelta(days=1)

    return slots
