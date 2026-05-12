from calendar import monthrange
from datetime import date, timedelta
from decimal import Decimal
from django.db import transaction
from apps.tenants.models import Tenancy, RentScheduleEntry


def compute_pro_rata_amount(rent_amount: Decimal, lease_start: date, period_start: date, period_end: date):
    days_in_period = (period_end - period_start).days + 1
    active_start = max(lease_start, period_start)
    days_active = (period_end - active_start).days + 1
    if days_active == days_in_period:
        return rent_amount, False, days_active, days_in_period
    amount = (Decimal(days_active) / Decimal(days_in_period)) * rent_amount
    return amount.quantize(Decimal('0.01')), True, days_active, days_in_period


def _get_period_bounds_monthly(year: int, month: int):
    last_day = monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day), f'{year}-{month:02d}'


def run_rent_scheduler(marina, year: int, month: int):
    from apps.billing.models import Invoice, InvoiceLineItem
    from apps.accounts.utils import generate_invoice_number

    today = date.today()
    active_tenancies = Tenancy.objects.filter(
        marina=marina,
        status__in=['active', 'notice'],
    ).select_related('unit', 'tenant', 'rent_chargeable_item')

    for tenancy in active_tenancies:
        period_start, period_end, period_ref = _get_period_bounds_monthly(year, month)

        amount, is_pro_rata, days_active, days_in_period = compute_pro_rata_amount(
            rent_amount=tenancy.rent_amount + tenancy.service_charge,
            lease_start=tenancy.lease_start,
            period_start=period_start,
            period_end=period_end,
        )

        with transaction.atomic():
            entry, created = RentScheduleEntry.objects.get_or_create(
                tenancy=tenancy,
                period_ref=period_ref,
                defaults={
                    'marina': tenancy.marina,
                    'due_date': period_start,
                    'amount': amount,
                    'is_pro_rata': is_pro_rata,
                    'pro_rata_days': days_active if is_pro_rata else None,
                    'pro_rata_total_days': days_in_period if is_pro_rata else None,
                    'status': 'scheduled',
                }
            )

            if entry.status == 'invoiced':
                continue

            if entry.due_date > today:
                continue

            if not tenancy.rent_chargeable_item_id:
                continue

            invoice, inv_created = Invoice.objects.get_or_create(
                source_type='tenancy_rent',
                source_id=str(entry.pk),
                defaults={
                    'marina': tenancy.marina,
                    'member': None,
                    'tenant': tenancy.tenant,
                    'invoice_number': generate_invoice_number(tenancy.marina),
                    'status': 'draft',
                }
            )

            if inv_created:
                description = (
                    f'Rent — {tenancy.unit.unit_ref} ({days_active}/{days_in_period} days)'
                    if is_pro_rata
                    else f'Rent — {tenancy.unit.unit_ref}'
                )
                InvoiceLineItem.objects.create(
                    invoice=invoice,
                    description=description,
                    chargeable_item=tenancy.rent_chargeable_item,
                    quantity=1,
                    unit_price=entry.amount,
                    total_price=entry.amount,
                    tax_rate=Decimal(str(tenancy.rent_chargeable_item.tax_category.rate)),
                )
                invoice.subtotal = entry.amount
                invoice.total = entry.amount
                invoice.save(update_fields=['subtotal', 'total'])

            entry.status = 'invoiced'
            entry.invoice = invoice
            entry.save(update_fields=['status', 'invoice'])

            _ensure_future_entries(tenancy, year, month, lookahead=2)


def _ensure_future_entries(tenancy, current_year, current_month, lookahead=2):
    for i in range(1, lookahead + 1):
        month = current_month + i
        year = current_year + (month - 1) // 12
        month = ((month - 1) % 12) + 1
        period_start, period_end, period_ref = _get_period_bounds_monthly(year, month)

        if tenancy.lease_end and period_start > tenancy.lease_end:
            break

        amount, is_pro_rata, days_active, days_in_period = compute_pro_rata_amount(
            rent_amount=tenancy.rent_amount + tenancy.service_charge,
            lease_start=tenancy.lease_start,
            period_start=period_start,
            period_end=period_end,
        )

        RentScheduleEntry.objects.get_or_create(
            tenancy=tenancy,
            period_ref=period_ref,
            defaults={
                'marina': tenancy.marina,
                'due_date': period_start,
                'amount': amount,
                'is_pro_rata': is_pro_rata,
                'pro_rata_days': days_active if is_pro_rata else None,
                'pro_rata_total_days': days_in_period if is_pro_rata else None,
                'status': 'scheduled',
            }
        )


def create_rent_review_tasks(marina):
    from datetime import date, timedelta
    from apps.tenants.models import TenancyTask

    upcoming = date.today() + timedelta(days=60)
    tenancies = Tenancy.objects.filter(
        marina=marina,
        status='active',
        next_review_date__lte=upcoming,
        next_review_date__gte=date.today(),
    )
    for tenancy in tenancies:
        already_open = TenancyTask.objects.filter(
            tenancy=tenancy,
            task_type='rent_review',
            status__in=['open', 'in_progress'],
        ).exists()
        if not already_open:
            TenancyTask.objects.create(
                marina=marina,
                tenancy=tenancy,
                task_type='rent_review',
                title=f'Rent review due — {tenancy.unit.unit_ref} ({tenancy.tenant.display_name})',
                due_date=tenancy.next_review_date,
                status='open',
            )
