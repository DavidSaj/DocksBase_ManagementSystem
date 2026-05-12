from django.db import migrations


def forwards(apps, schema_editor):
    Invoice = apps.get_model('billing', 'Invoice')
    Reservation = apps.get_model('reservations', 'Reservation')
    for inv in Invoice.objects.filter(booking__isnull=False, reservation__isnull=True).iterator():
        reservation = Reservation.objects.filter(legacy_booking_id=inv.booking_id).first()
        if reservation:
            inv.reservation = reservation
            inv.save(update_fields=['reservation_id'])


def backwards(apps, schema_editor):
    Invoice = apps.get_model('billing', 'Invoice')
    Invoice.objects.update(reservation=None)


class Migration(migrations.Migration):
    dependencies = [
        ('billing', '0020_invoice_reservation_fk'),
        ('reservations', '0016_backfill_reservations'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
