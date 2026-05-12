"""
Shared logic used by both the RunPython migration and the test suite.
Import via: from apps.reservations.migrations.backfill_helpers import backfill_booking
"""
from django.db import transaction


def backfill_booking(booking):
    """Create Reservation + ReservationItem for one Booking. Idempotent."""
    from apps.reservations.models import Reservation, ReservationItem

    if Reservation.objects.filter(legacy_booking=booking).exists():
        return

    member = None
    if booking.vessel_id and hasattr(booking, 'vessel') and booking.vessel_id:
        try:
            from apps.members.models import Member
            if hasattr(booking.vessel, 'owner_id') and booking.vessel.owner_id:
                member = Member.objects.filter(pk=booking.vessel.owner_id).first()
        except Exception:
            pass

    with transaction.atomic():
        reservation = Reservation.objects.create(
            marina=booking.marina,
            member=member,
            guest_name=booking.guest_name,
            guest_email=booking.guest_email,
            guest_phone=booking.guest_phone,
            status=booking.status,
            paid=booking.paid,
            total_price=booking.amount,
            waiver_envelope_id=booking.waiver_envelope_id,
            waiver_signed=booking.waiver_signed,
            self_checked_in=booking.self_checked_in,
            self_checked_in_at=booking.self_checked_in_at,
            booking_source=booking.booking_source,
            notes=booking.notes,
            legacy_booking=booking,
            created_at=booking.created_at,
        )
        ReservationItem.objects.create(
            reservation=reservation,
            berth=booking.berth,
            vessel=booking.vessel,
            vessel_name=booking.vessel_name,
            booking_type=booking.booking_type,
            check_in=booking.check_in,
            check_out=booking.check_out,
            nights=booking.nights,
            item_price=booking.amount,
            boat_loa=booking.boat_loa,
            boat_beam=booking.boat_beam,
            boat_draft=booking.boat_draft,
            eta=booking.eta,
            is_sublet=booking.is_sublet,
            is_hourly=booking.is_hourly,
            start_time=booking.start_time,
            end_time=booking.end_time,
            dynamic_price_applied=booking.dynamic_price_applied,
            ota_commission_amount=booking.ota_commission_amount,
            mysea_event_uid=booking.mysea_event_uid,
            insurance_doc=booking.insurance_doc,
            pre_cleared=booking.pre_cleared,
            insurance_verified=booking.insurance_verified,
            registration_verified=booking.registration_verified,
            waiver_verified=booking.waiver_verified,
            document_gate_cleared=booking.document_gate_cleared,
            document_gate_cleared_by=booking.document_gate_cleared_by,
            document_gate_cleared_at=booking.document_gate_cleared_at,
            created_at=booking.created_at,
        )
