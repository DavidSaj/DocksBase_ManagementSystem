"""
Utility Wallet service.

Functions:
  debit_wallet(wallet, amount, description, invoice_line=None)
  credit_wallet(wallet, amount, tx_type, description, stripe_payment_intent='')
  generate_monthly_utility_invoices(marina_id, month_str)

All monetary operations use select_for_update() inside atomic() to prevent
race conditions on wallet balance.

generate_monthly_utility_invoices() is the entry point for the management
command and will eventually be called by Celery Beat (monthly).
"""

import logging
from decimal import Decimal

from django.db import transaction as db_transaction

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Debit / Credit primitives
# ---------------------------------------------------------------------------

def debit_wallet(wallet, amount: Decimal, description: str, invoice_line=None):
    """
    Atomically deduct `amount` from wallet balance.
    Creates a UtilityWalletTransaction (DEDUCTION).
    Returns the updated wallet instance.

    Caller should check wallet.balance <= 0 after return to trigger
    bollard cut-off via bollard_service.switch_bollard().
    """
    from apps.utilities.models import UtilityWalletTransaction

    with db_transaction.atomic():
        wallet = type(wallet).objects.select_for_update().get(pk=wallet.pk)
        wallet.balance -= Decimal(str(amount))
        wallet.save(update_fields=['balance'])
        UtilityWalletTransaction.objects.create(
            wallet=wallet,
            tx_type=UtilityWalletTransaction.TxType.DEDUCTION,
            amount=-Decimal(str(amount)),   # stored as negative for deductions
            balance_after=wallet.balance,
            description=description,
            invoice_line=invoice_line,
        )

    _check_low_balance(wallet)
    return wallet


def credit_wallet(wallet, amount: Decimal, tx_type: str, description: str,
                  stripe_payment_intent: str = ''):
    """
    Atomically credit `amount` to wallet balance.
    Creates a UtilityWalletTransaction with the given tx_type.
    Returns the updated wallet instance.
    """
    from apps.utilities.models import UtilityWalletTransaction

    with db_transaction.atomic():
        wallet = type(wallet).objects.select_for_update().get(pk=wallet.pk)
        wallet.balance += Decimal(str(amount))
        wallet.save(update_fields=['balance'])
        UtilityWalletTransaction.objects.create(
            wallet=wallet,
            tx_type=tx_type,
            amount=Decimal(str(amount)),
            balance_after=wallet.balance,
            description=description,
            stripe_payment_intent=stripe_payment_intent,
        )

    return wallet


def _check_low_balance(wallet) -> None:
    """Log a low-balance warning. Extend to send notification in production."""
    if wallet.balance < wallet.low_balance_threshold:
        logger.warning(
            'Low balance: wallet_id=%s member_id=%s balance=%.2f threshold=%.2f',
            wallet.pk, wallet.member_id, wallet.balance, wallet.low_balance_threshold,
        )
        # TODO: record last_low_balance_alert and dispatch notification via comms app


# ---------------------------------------------------------------------------
# Monthly billing run
# ---------------------------------------------------------------------------

def generate_monthly_utility_invoices(marina_id: int, month_str: str) -> None:
    """
    Generate one Invoice per member with a UtilityWallet for the given month.

    month_str: 'YYYY-MM'

    Logic:
    1. Parse the billing period date range (first day .. last day of month).
    2. For each active wallet in the marina:
       a. Find all SmartMeter records for the member's active berth(s).
       b. For each meter: compute consumption as (latest reading - first reading)
          for the month from MeterReading deltas.
       c. Look up the ChargeableItem for utility kWh (or m3) by category/code.
       d. Create one Invoice (status='unpaid') with one InvoiceLineItem per meter.
       e. Post a UtilityWalletTransaction.DEDUCTION if auto_deduct_enabled.
    3. Log totals.

    NOTE: This function is intentionally synchronous — Celery Beat wiring comes
    in a later track. Run via: python manage.py generate_utility_invoices
    """
    import calendar
    from datetime import date

    from django.db.models import Max, Min

    from apps.utilities.models import MeterReading, UtilityWallet

    try:
        year, month = int(month_str[:4]), int(month_str[5:7])
    except (ValueError, IndexError):
        raise ValueError(f'month_str must be YYYY-MM, got: {month_str!r}')

    first_day = date(year, month, 1)
    last_day  = date(year, month, calendar.monthrange(year, month)[1])

    wallets = UtilityWallet.objects.filter(
        marina_id=marina_id,
    ).select_related('member', 'marina')

    invoices_created = 0

    for wallet in wallets:
        member  = wallet.member
        marina  = wallet.marina

        # Find smart meters associated with the member's berth(s)
        # Members may occupy one or more berths — query via member's vessels
        meters = _get_meters_for_member(member, marina_id)
        if not meters:
            logger.info(
                'No smart meters found for member=%s marina=%s — skipping',
                member.pk, marina_id,
            )
            continue

        line_items_data = []
        for meter in meters:
            consumption = _compute_monthly_consumption(meter, first_day, last_day)
            if consumption is None or consumption <= 0:
                continue

            chargeable_item = _get_utility_chargeable_item(marina, meter)
            if not chargeable_item:
                logger.warning(
                    'No ChargeableItem found for meter type=%s marina=%s',
                    meter.meter_type, marina_id,
                )
                continue

            charge = (consumption * chargeable_item.unit_price).quantize(Decimal('0.01'))
            line_items_data.append({
                'meter': meter,
                'consumption': consumption,
                'chargeable_item': chargeable_item,
                'charge': charge,
            })

        if not line_items_data:
            continue

        total = sum(d['charge'] for d in line_items_data)
        invoice = _create_invoice(marina, member, month_str, total, line_items_data)

        if wallet.auto_deduct_enabled:
            debit_wallet(
                wallet,
                total,
                description=f'Utility charges {month_str}',
                invoice_line=invoice.items.first(),
            )

        invoices_created += 1
        logger.info('Created invoice %s for member=%s total=£%.2f', invoice.pk, member.pk, total)

    logger.info(
        'generate_monthly_utility_invoices complete: marina=%s month=%s invoices=%d',
        marina_id, month_str, invoices_created,
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_meters_for_member(member, marina_id):
    """Return SmartMeter queryset linked to the member's vessel berths."""
    from apps.utilities.models import SmartMeter

    vessel_berth_ids = (
        member.vessels
        .filter(marina_id=marina_id)
        .values_list('berth_id', flat=True)
        .distinct()
    )
    return SmartMeter.objects.filter(
        marina_id=marina_id,
        berth_id__in=vessel_berth_ids,
        is_active=True,
    )


def _compute_monthly_consumption(meter, first_day, last_day):
    """
    Return net consumption (last reading - first reading) for the month.
    Uses kWh for electricity meters, m3 for water meters.
    Returns None if insufficient data.
    """
    from apps.utilities.models import MeterReading

    qs = MeterReading.objects.filter(
        meter=meter,
        recorded_at__date__gte=first_day,
        recorded_at__date__lte=last_day,
    ).order_by('recorded_at')

    first = qs.first()
    last  = qs.last()

    if not first or not last or first.pk == last.pk:
        return None

    if meter.meter_type == 'electricity':
        if first.reading_kwh is None or last.reading_kwh is None:
            return None
        return last.reading_kwh - first.reading_kwh
    else:
        if first.reading_m3 is None or last.reading_m3 is None:
            return None
        return last.reading_m3 - first.reading_m3


def _get_utility_chargeable_item(marina, meter):
    """Look up the ChargeableItem for the meter's utility type."""
    from apps.billing.models import ChargeableItem

    category_map = {
        'electricity': 'utility_kwh',
        'water':       'utility_m3',
    }
    code = category_map.get(meter.meter_type)
    if not code:
        return None

    return ChargeableItem.objects.filter(
        marina=marina,
        category=code,
        is_active=True,
    ).first()


def _create_invoice(marina, member, billing_period, total, line_items_data):
    """Create an Invoice with InvoiceLineItem rows."""
    from apps.billing.models import Invoice, InvoiceLineItem

    # Generate invoice number (simple sequential — billing service handles real numbering)
    last_invoice = Invoice.objects.filter(marina=marina).order_by('-id').first()
    next_num     = (last_invoice.pk + 1) if last_invoice else 1
    inv_number   = f'UTIL-{billing_period}-{next_num:04d}'

    invoice = Invoice.objects.create(
        marina=marina,
        member=member,
        invoice_number=inv_number,
        status='unpaid',
        source_type='utility_billing',
        billing_period=billing_period,
        subtotal=total,
        total=total,
    )

    for d in line_items_data:
        meter = d['meter']
        label = f'{meter.get_meter_type_display()} — {meter.label or meter.device_id}'
        InvoiceLineItem.objects.create(
            invoice=invoice,
            description=label,
            quantity=d['consumption'],
            unit_price=d['chargeable_item'].unit_price,
            total_price=d['charge'],
            chargeable_item=d['chargeable_item'],
        )

    return invoice
