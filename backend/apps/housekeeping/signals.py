"""
Signal handlers for the housekeeping app.

on_charter_checkout: feature-flagged receiver for charter checkout events from Track 9.
Connected in HousekeepingConfig.ready() only if apps.charter is installed.
"""
from django.conf import settings


def on_charter_checkout(
    sender,
    charter_booking_id,
    vessel_id,
    vessel_label,
    checkout_datetime,
    next_checkin_datetime,
    marina_id,
    **kwargs,
):
    """
    Feature-flagged receiver. Only creates tasks when HOUSEKEEPING_CHARTER_TRIGGER_ENABLED=True.
    Connected in housekeeping/apps.py ready() only if apps.charter is installed.

    Creates a HousekeepingTask with source_type='charter_checkout' and target_ready_by set
    to the next check-in datetime, so the matrix dashboard shows the urgency window.
    """
    if not getattr(settings, 'HOUSEKEEPING_CHARTER_TRIGGER_ENABLED', False):
        return

    from apps.housekeeping.models import HousekeepingTask

    # Idempotency guard: only create if no task already exists for this checkout
    already_exists = HousekeepingTask.objects.filter(
        marina_id=marina_id,
        source_type=HousekeepingTask.SourceType.CHARTER_CHECKOUT,
        source_id=str(charter_booking_id),
    ).exists()

    if already_exists:
        return

    HousekeepingTask.objects.create(
        marina_id=marina_id,
        source_type=HousekeepingTask.SourceType.CHARTER_CHECKOUT,
        source_id=str(charter_booking_id),
        unit_type=HousekeepingTask.UnitType.VESSEL,
        unit_id=str(vessel_id),
        unit_label=vessel_label,
        status=HousekeepingTask.Status.DIRTY,
        target_ready_by=next_checkin_datetime,
    )
