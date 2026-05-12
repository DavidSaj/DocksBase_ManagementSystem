from django.db import migrations


def forwards(apps, schema_editor):
    Booking = apps.get_model('reservations', 'Booking')
    Reservation = apps.get_model('reservations', 'Reservation')
    ReservationItem = apps.get_model('reservations', 'ReservationItem')
    for booking in Booking.objects.select_related(
        'berth', 'vessel', 'vessel__owner', 'document_gate_cleared_by'
    ).iterator():
        _backfill_one(Reservation, ReservationItem, booking)


def _backfill_one(Reservation, ReservationItem, booking):
    if Reservation.objects.filter(legacy_booking=booking).exists():
        return

    member_id = None
    if booking.vessel_id:
        try:
            vessel = booking.vessel
            if vessel.owner_id:
                member_id = vessel.owner_id
        except Exception:
            pass

    reservation = Reservation.objects.create(
        marina_id=booking.marina_id,
        member_id=member_id,
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
    )
    Reservation.objects.filter(pk=reservation.pk).update(created_at=booking.created_at)
    item = ReservationItem.objects.create(
        reservation=reservation,
        berth_id=booking.berth_id,
        vessel_id=booking.vessel_id,
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
        document_gate_cleared_by_id=booking.document_gate_cleared_by_id,
        document_gate_cleared_at=booking.document_gate_cleared_at,
    )
    ReservationItem.objects.filter(pk=item.pk).update(created_at=booking.created_at)


def backwards(apps, schema_editor):
    Reservation = apps.get_model('reservations', 'Reservation')
    Reservation.objects.filter(legacy_booking__isnull=False).delete()


class Migration(migrations.Migration):
    dependencies = [
        ('reservations', '0015_reservation_and_item'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
