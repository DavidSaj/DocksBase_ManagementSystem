from datetime import timedelta
from decimal import Decimal

from django.conf import settings
from django.db import models, transaction

from apps.charter.models import CharterAgentCommission, CharterBooking, CharterManagementAgreement, RentalBooking


def calculate_commission(charter_booking_id: int) -> None:
    """
    Called via transaction.on_commit when a CharterBooking is confirmed.
    Creates CharterAgentCommission records for all active management agreements
    on the booking's vessel, splitting revenue by split_percentage.
    """
    booking = CharterBooking.objects.select_related('charter_vessel').get(pk=charter_booking_id)
    vessel = booking.charter_vessel
    today = booking.start_dt.date()

    active_agreements = CharterManagementAgreement.objects.filter(
        charter_vessel=vessel,
        valid_from__lte=today,
    ).filter(
        models.Q(valid_to__isnull=True) | models.Q(valid_to__gte=today)
    )

    for agreement in active_agreements:
        owner_revenue = booking.subtotal * (agreement.split_percentage / Decimal('100'))
        marina_commission = owner_revenue * (agreement.commission_rate / Decimal('100'))
        CharterAgentCommission.objects.get_or_create(
            booking=booking,
            agent_name=agreement.owner_label or 'Marina',
            defaults={
                'marina': booking.marina,
                'agent_email': agreement.member.email if agreement.member else '',
                'commission_rate': agreement.commission_rate,
                'commission_amount': marina_commission,
            },
        )


def check_rental_availability(unit, start_dt, end_dt) -> bool:
    """
    Returns True if the rental unit is available for [start_dt, end_dt]
    accounting for turnaround_minutes buffer on either side.
    Uses select_for_update — must be called inside transaction.atomic().
    """
    buffer = timedelta(minutes=unit.turnaround_minutes)
    conflict = RentalBooking.objects.select_for_update().filter(
        rental_unit=unit,
    ).exclude(status='cancelled').filter(
        start_dt__lt=end_dt + buffer,
        end_dt__gt=start_dt - buffer,
    )
    return not conflict.exists()


def create_charter_invoice(booking: CharterBooking):
    """
    Builds a billing.Invoice for a confirmed CharterBooking.
    Called after booking is confirmed and pricing is finalised.
    """
    from apps.billing.models import Invoice, InvoiceLineItem

    try:
        from apps.accounts.utils import generate_invoice_number
    except ImportError:
        def generate_invoice_number(marina):
            import uuid
            return f'CHR-{uuid.uuid4().hex[:8].upper()}'

    with transaction.atomic():
        invoice = Invoice.objects.create(
            marina=booking.marina,
            member=booking.charterer,
            source_type='charter_booking',
            source_id=str(booking.pk),
            invoice_number=generate_invoice_number(booking.marina),
            status='draft',
        )
        vessel = booking.charter_vessel

        if vessel.daily_rate_item and booking.duration_unit == 'daily':
            rate_item = vessel.daily_rate_item
        elif vessel.hourly_rate_item and booking.duration_unit == 'hourly':
            rate_item = vessel.hourly_rate_item
        elif vessel.weekly_rate_item and booking.duration_unit == 'weekly':
            rate_item = vessel.weekly_rate_item
        else:
            rate_item = None

        if rate_item:
            InvoiceLineItem.objects.create(
                invoice=invoice,
                description=f'Charter — {vessel.vessel.name}',
                chargeable_item=rate_item,
                quantity=Decimal('1.00'),
                unit_price=booking.subtotal,
                total_price=booking.subtotal,
                tax_rate=rate_item.tax_rate,
            )

        if booking.cleaning_fee and vessel.cleaning_fee_item:
            InvoiceLineItem.objects.create(
                invoice=invoice,
                description='Cleaning Fee',
                chargeable_item=vessel.cleaning_fee_item,
                quantity=Decimal('1.00'),
                unit_price=booking.cleaning_fee,
                total_price=booking.cleaning_fee,
                tax_rate=vessel.cleaning_fee_item.tax_rate,
            )

        if booking.skipper_fee and vessel.skipper_fee_item:
            InvoiceLineItem.objects.create(
                invoice=invoice,
                description='Skipper Fee',
                chargeable_item=vessel.skipper_fee_item,
                quantity=Decimal('1.00'),
                unit_price=booking.skipper_fee,
                total_price=booking.skipper_fee,
                tax_rate=vessel.skipper_fee_item.tax_rate,
            )

        subtotal = sum(item.total_price for item in invoice.items.all())
        invoice.subtotal = subtotal
        invoice.total = subtotal
        invoice.save(update_fields=['subtotal', 'total'])

        booking.invoice = invoice
        booking.save(update_fields=['invoice'])

    return invoice
