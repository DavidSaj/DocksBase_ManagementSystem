"""
Harbour Tariff Engine
=====================
Four-level specificity lookup, five due-type branches.

Lookup order (most specific wins):
  1. vessel_type match + flag_state match + GT band + effective date
  2. vessel_type match + no flag constraint (flag_state='') + GT band + date
  3. vessel_type='all'   + flag_state match + GT band + date
  4. vessel_type='all'   + no flag constraint (flag_state='') + GT band + date
"""

from decimal import Decimal

from django.db import models, transaction

from apps.harbour.models import CommercialMovement, HarbourDueInvoice, HarbourTariff


def get_tariff(marina, due_type, vessel_type, flag, gross_tonnage, date):
    """
    Returns the most-specific active HarbourTariff or None.
    """
    def _query(vt, fs):
        qs = HarbourTariff.objects.filter(
            marina=marina,
            due_type=due_type,
            vessel_type=vt,
            flag_state=fs,
            is_active=True,
            effective_from__lte=date,
        ).filter(
            models.Q(effective_to__isnull=True) | models.Q(effective_to__gte=date)
        )
        if gross_tonnage is not None:
            qs = qs.filter(
                models.Q(min_gt__isnull=True) | models.Q(min_gt__lte=gross_tonnage)
            ).filter(
                models.Q(max_gt__isnull=True) | models.Q(max_gt__gt=gross_tonnage)
            )
        # Order by specificity: prefer narrower GT bands (non-null wins over null)
        qs = qs.order_by(
            models.F('min_gt').desc(nulls_last=True),
            models.F('max_gt').asc(nulls_last=True),
        )
        return qs.first()

    return (
        _query(vessel_type, flag) or
        _query(vessel_type, '') or
        _query(HarbourTariff.CommercialVesselType.ALL, flag) or
        _query(HarbourTariff.CommercialVesselType.ALL, '')
    )


def _calculate_amount(tariff: HarbourTariff, quantity) -> Decimal:
    return tariff.base_fee + (tariff.multiplier_fee * Decimal(str(quantity)))


def _build_due_map(movement: CommercialMovement):
    """
    Returns a list of (due_type, trigger, quantity) for this movement.
    trigger=None means the due type does not apply.

    Five due-type branches per plan:
      1. harbour_dues      — quantity = gross_tonnage
      2. pilotage          — quantity = GT × distance_nm
      3. tug               — quantity = tug_duration_hours
      4. passenger_landing — quantity = passenger_count (only when > 0)
      5. cargo_handling    — quantity = cargo_weight_mt
    """
    gt = movement.gross_tonnage
    distance = movement.pilotage_distance_nm
    tug_h = movement.tug_duration_hours
    pax = movement.passenger_count
    cargo = movement.cargo_weight_mt

    pilotage_qty = (
        Decimal(str(gt or 0)) * Decimal(str(distance))
        if gt and distance else None
    )

    return [
        ('harbour_dues',      gt,                            gt),
        ('pilotage',          pilotage_qty,                  pilotage_qty),
        ('tug',               tug_h,                         tug_h),
        ('passenger_landing', pax if pax and pax > 0 else None, pax),
        ('cargo_handling',    cargo,                         cargo),
    ]


def preview_dues(movement: CommercialMovement) -> dict:
    """
    Calculate all applicable dues without persisting anything.
    Returns a preview dict suitable for the API response.
    """
    date = (movement.actual_arrival or movement.eta).date()
    results = []

    for due_type, trigger, quantity in _build_due_map(movement):
        if not trigger:
            continue
        tariff = get_tariff(
            movement.marina, due_type, movement.vessel_type,
            movement.flag, movement.gross_tonnage, date,
        )
        if not tariff:
            continue
        amount = _calculate_amount(tariff, quantity)
        results.append({
            'due_type':          due_type,
            'due_type_display':  tariff.get_due_type_display(),
            'tariff_id':         tariff.pk,
            'quantity':          str(quantity),
            'base_fee':          str(tariff.base_fee),
            'multiplier_fee':    str(tariff.multiplier_fee),
            'calculated_amount': str(amount),
        })

    total = sum(Decimal(r['calculated_amount']) for r in results)
    return {
        'movement_id': movement.pk,
        'vessel_name': movement.vessel_name,
        'dues':        results,
        'total':       str(total),
    }


def calculate_and_invoice(movement: CommercialMovement):
    """
    Persist HarbourDueInvoice records and assemble a billing.Invoice.
    Returns the Invoice.
    """
    from apps.billing.models import Invoice, InvoiceLineItem

    try:
        from apps.accounts.utils import generate_invoice_number
    except ImportError:
        def generate_invoice_number(marina):
            import uuid
            return f'HBR-{uuid.uuid4().hex[:8].upper()}'

    with transaction.atomic():
        invoice = Invoice.objects.create(
            marina=movement.marina,
            member=None,
            shipping_agent=movement.shipping_agent,
            source_type='commercial_movement',
            source_id=str(movement.pk),
            invoice_number=generate_invoice_number(movement.marina),
            status='draft',
        )

        date = (movement.actual_arrival or movement.eta).date()

        for due_type, trigger, quantity in _build_due_map(movement):
            if not trigger:
                continue
            tariff = get_tariff(
                movement.marina, due_type, movement.vessel_type,
                movement.flag, movement.gross_tonnage, date,
            )
            if not tariff:
                continue
            amount = _calculate_amount(tariff, quantity)

            HarbourDueInvoice.objects.create(
                marina=movement.marina,
                movement=movement,
                due_type=due_type,
                tariff=tariff,
                quantity=Decimal(str(quantity)),
                calculated_amount=amount,
                invoice=invoice,
            )

            InvoiceLineItem.objects.create(
                invoice=invoice,
                description=f'{tariff.get_due_type_display()} — {movement.vessel_name}',
                chargeable_item=tariff.chargeable_item,
                quantity=Decimal('1.00'),
                unit_price=amount,
                total_price=amount,
                tax_rate=Decimal(str(tariff.chargeable_item.tax_category.rate)),
            )

        subtotal = sum(item.total_price for item in invoice.items.all())
        invoice.subtotal = subtotal
        invoice.total = subtotal
        invoice.save(update_fields=['subtotal', 'total'])

    return invoice


def recalculate_movement_invoice(movement: CommercialMovement):
    """
    When a movement is edited post-invoice, issue a Credit Note and a new Invoice.
    Never deletes or voids an already-issued invoice.
    Returns (credit_note_or_None, new_invoice).
    """
    with transaction.atomic():
        first_due = movement.due_invoices.select_related('invoice').first()

        if not first_due or not first_due.invoice:
            return None, calculate_and_invoice(movement)

        original_invoice = first_due.invoice

        if original_invoice.status == 'draft':
            # Safe to regenerate in-place
            movement.due_invoices.all().delete()
            original_invoice.items.all().delete()
            original_invoice.delete()
            return None, calculate_and_invoice(movement)

        # Original is issued — issue a credit note
        credit_note = _issue_credit_note(original_invoice, movement.marina)

        # Clear old due records before recalculating
        movement.due_invoices.all().delete()

        new_invoice = calculate_and_invoice(movement)
        return credit_note, new_invoice


def _issue_credit_note(original_invoice, marina):
    from apps.billing.models import Invoice, InvoiceLineItem

    try:
        from apps.accounts.utils import generate_invoice_number
    except ImportError:
        def generate_invoice_number(marina):
            import uuid
            return f'CN-{uuid.uuid4().hex[:8].upper()}'

    credit_note = Invoice.objects.create(
        marina=marina,
        member=original_invoice.member,
        shipping_agent=original_invoice.shipping_agent,
        source_type='credit_note',
        source_id=str(original_invoice.pk),
        invoice_number=generate_invoice_number(marina),
        invoice_type='credit_note',
        related_invoice=original_invoice,
        status='issued',
        subtotal=-original_invoice.subtotal,
        total=-original_invoice.total,
    )

    for item in original_invoice.items.all():
        InvoiceLineItem.objects.create(
            invoice=credit_note,
            description=f'[Credit] {item.description}',
            chargeable_item=item.chargeable_item,
            quantity=-item.quantity,
            unit_price=item.unit_price,
            total_price=-item.total_price,
            tax_rate=item.tax_rate,
        )

    return credit_note
