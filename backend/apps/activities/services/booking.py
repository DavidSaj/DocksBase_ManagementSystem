"""
Core booking service for activities.

book_activity_session() is the single entry point for creating activity bookings.
It wraps enrollment + asset reservation + invoice creation in a single transaction.atomic().
"""
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from apps.activities.models import (
    ActivityBooking,
    ActivityBookingExtra,
    ActivityBookingParticipant,
    AssetReservation,
)
from apps.activities.services.availability import (
    check_asset_availability,
    check_instructor_availability,
)
from apps.activities.services.billing import create_activity_invoice


class SeasonWarning(Exception):
    """Raised when booking date is outside season window and season_override is False."""


class ResourceUnavailable(Exception):
    """Raised when a required instructor or asset is not available."""


def _find_available_instructor(marina, required_role, start_dt, end_dt):
    """
    Find any active StaffMember with the required role that is available
    for the given datetime window. Returns the first available or None.
    """
    from apps.staff.models import StaffMember
    candidates = StaffMember.objects.filter(
        marina=marina,
        role=required_role,
        is_active=True,
    )
    for candidate in candidates:
        if check_instructor_availability(candidate, start_dt, end_dt):
            return candidate
    return None


def _fire_activity_booked_journey(booking):
    """
    Fire a Track 7 journey trigger for ACTIVITY_BOOKED.
    Non-blocking — failures are swallowed so booking creation is never rolled back.
    """
    try:
        from apps.communications.services.journey import trigger_journey
        trigger_journey(
            marina_id=booking.marina_id,
            trigger='activity_booked',
            member_id=booking.member_id,
            context={'booking_id': booking.pk, 'activity': booking.activity.name},
        )
    except Exception:
        pass


def book_activity_session(
    marina,
    activity,
    start_datetime,
    member=None,
    lead_name='',
    lead_email='',
    lead_phone='',
    participant_data=None,
    extras_data=None,
    payment_mode='direct',
    season_override=False,
    assigned_instructor_id=None,
):
    """
    Create an ActivityBooking atomically: booking + participant rows + asset reservations + invoice.

    Raises SeasonWarning if the booking date is outside the activity's season and
    season_override is False. Frontend should catch this and prompt user to confirm.

    Raises ResourceUnavailable if no instructor or asset is free for the requested window.

    The ExclusionConstraint on AssetReservation will raise IntegrityError on a race condition
    double-book — the transaction rolls back cleanly, leaving the DB in a consistent state.
    """
    from psycopg2.extras import DateTimeTZRange
    from apps.staff.models import StaffMember

    participant_data  = participant_data or []
    extras_data       = extras_data or []
    end_datetime      = start_datetime + timedelta(minutes=activity.duration_minutes)
    participant_count = len(participant_data) or 1

    # Season window check — soft warning, not hard rejection
    if activity.season_start and activity.season_end and not season_override:
        booking_date = start_datetime.date()
        if not (activity.season_start <= booking_date <= activity.season_end):
            raise SeasonWarning(
                f'Booking date {booking_date} is outside the activity season window '
                f'({activity.season_start} – {activity.season_end}).'
            )

    # Capacity check
    if participant_count < activity.capacity_min or participant_count > activity.capacity_max:
        raise ValueError(
            f'Participant count {participant_count} outside allowed range '
            f'[{activity.capacity_min}, {activity.capacity_max}].'
        )

    # Resource availability checks (performed before the atomic block to give fast feedback)
    resolved_instructor = None
    required_assets = []

    for req in activity.resource_requirements.select_related('staff_member', 'asset').all():
        if req.resource_type == 'instructor':
            candidate = req.staff_member or _find_available_instructor(
                marina, req.required_role, start_datetime, end_datetime
            )
            if candidate is None:
                raise ResourceUnavailable(
                    f'No instructor with role "{req.required_role}" is available for {start_datetime}.'
                )
            if not check_instructor_availability(candidate, start_datetime, end_datetime):
                raise ResourceUnavailable(
                    f'Instructor {candidate.name} is unavailable for {start_datetime}.'
                )
            # If an explicit instructor was requested, use them; otherwise use auto-resolved candidate
            if assigned_instructor_id:
                try:
                    resolved_instructor = StaffMember.objects.get(pk=assigned_instructor_id)
                except StaffMember.DoesNotExist:
                    resolved_instructor = candidate
            else:
                resolved_instructor = candidate

        elif req.resource_type == 'asset' and req.asset:
            if not check_asset_availability(req.asset, start_datetime, end_datetime):
                raise ResourceUnavailable(
                    f'Asset "{req.asset.name}" is unavailable for {start_datetime}.'
                )
            required_assets.append((req.asset, req.quantity_required))

    # Atomic: booking + participant rows + asset reservations + invoice — all or nothing
    with transaction.atomic():
        booking = ActivityBooking.objects.create(
            marina=marina,
            activity=activity,
            member=member,
            lead_name=lead_name,
            lead_email=lead_email,
            lead_phone=lead_phone,
            start_datetime=start_datetime,
            end_datetime=end_datetime,
            participant_count=participant_count,
            status=ActivityBooking.Status.CONFIRMED,
            payment_mode=payment_mode,
            season_override=season_override,
            assigned_instructor=resolved_instructor,
            expires_at=(
                timezone.now() + timedelta(minutes=15)
                if payment_mode == 'direct' else None
            ),
        )

        # Participants
        for pdata in participant_data:
            ActivityBookingParticipant.objects.create(booking=booking, **pdata)

        # Extras
        for edata in extras_data:
            ActivityBookingExtra.objects.create(booking=booking, **edata)

        # Asset reservations — ExclusionConstraint will raise IntegrityError on double-book
        window = DateTimeTZRange(start_datetime, end_datetime)
        for asset, qty in required_assets:
            for _ in range(qty):
                AssetReservation.objects.create(
                    marina=marina,
                    asset=asset,
                    activity_booking=booking,
                    time_range=window,
                )

        # Invoice creation (for direct payment and berth_invoice modes)
        if payment_mode in ('direct', 'berth_invoice'):
            invoice = create_activity_invoice(booking)
            booking.invoice = invoice
            booking.save(update_fields=['invoice'])

    # Non-blocking: fire ACTIVITY_BOOKED journey trigger (Track 7)
    # Registered on_commit so it only fires after the transaction commits successfully
    transaction.on_commit(lambda: _fire_activity_booked_journey(booking))

    return booking
