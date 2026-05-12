import calendar
import datetime
from decimal import Decimal

from django.db import transaction

from .models import Invoice, ChargeableItem
from . import service as billing_service


def run_batch(marina, billing_period, member_type='all', chargeable_item_id=None):
    """
    Generate invoices for all active bookings in the given billing_period.

    billing_period: "YYYY-MM" string
    member_type:    "all" | "seasonal" | "transient"
    chargeable_item_id: optional — uses first active berth ChargeableItem if omitted

    Idempotency: skips any booking that already has a non-voided invoice for the
    same billing_period. This means paid, open, and draft invoices all block
    re-generation — only void invoices allow a new one.

    Returns { "created": N, "skipped": N }
    """
    from apps.reservations.models import Booking

    try:
        year, month = int(billing_period[:4]), int(billing_period[5:7])
    except (ValueError, IndexError):
        raise ValueError(f"Invalid billing_period '{billing_period}'. Use YYYY-MM format.")

    period_start = datetime.date(year, month, 1)
    period_end = datetime.date(year, month, calendar.monthrange(year, month)[1])

    # Bookings overlapping the billing period
    qs = (
        Booking.objects
        .filter(
            marina=marina,
            check_in__lte=period_end,
            check_out__gte=period_start,
        )
        .select_related('vessel', 'vessel__owner')
    )

    if member_type == 'seasonal':
        qs = qs.filter(booking_type='seasonal')
    elif member_type == 'transient':
        qs = qs.filter(booking_type='transient')

    # Resolve chargeable item
    chargeable_item = None
    if chargeable_item_id:
        chargeable_item = ChargeableItem.objects.filter(
            pk=chargeable_item_id, marina=marina, is_active=True
        ).first()
    if not chargeable_item:
        chargeable_item = ChargeableItem.objects.filter(
            marina=marina, category='berth', is_active=True
        ).order_by('created_at').first()

    created = 0
    skipped = 0

    for booking in qs:
        # Strict idempotency: skip if any non-voided invoice exists for this booking + period
        already_invoiced = Invoice.objects.filter(
            marina=marina,
            billing_period=billing_period,
            source_type='batch_berth',
            source_id=str(booking.pk),
        ).exclude(status='void').exists()

        if already_invoiced:
            skipped += 1
            continue

        # Resolve member via vessel owner
        member = None
        if booking.vessel_id and booking.vessel.owner_id:
            member = booking.vessel.owner

        with transaction.atomic():
            invoice = billing_service.create_invoice(
                marina=marina,
                member=member,
                source_type='batch_berth',
                source_id=str(booking.pk),
                billing_period=billing_period,
            )

            if chargeable_item:
                nights_in_period = max(
                    1,
                    (min(booking.check_out, period_end) - max(booking.check_in, period_start)).days,
                )
                loa = booking.boat_loa
                if loa is None and booking.vessel_id:
                    loa = getattr(booking.vessel, 'loa', None)

                if chargeable_item.pricing_model == 'per_night':
                    quantity = Decimal(str(nights_in_period))
                    description = f'Berth fee {billing_period} — {nights_in_period} nights'
                elif chargeable_item.pricing_model == 'per_meter_per_night' and loa:
                    quantity = Decimal(str(loa)) * Decimal(str(nights_in_period))
                    description = f'Berth fee {billing_period} — {loa}m × {nights_in_period} nights'
                else:
                    quantity = Decimal('1')
                    description = f'Berth fee {billing_period}'

                billing_service.add_line_item(
                    invoice=invoice,
                    description=description,
                    quantity=quantity,
                    unit_price=chargeable_item.unit_price,
                    tax_rate=Decimal(str(chargeable_item.tax_category.rate)),
                    chargeable_item=chargeable_item,
                )
            else:
                billing_service.add_line_item(
                    invoice=invoice,
                    description=f'Berth fee {billing_period}',
                    quantity=1,
                    unit_price=Decimal('0.00'),
                )

            billing_service.finalize_invoice(invoice)

        created += 1

    return {'created': created, 'skipped': skipped}
