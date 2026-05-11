"""
apps/accounting/services/payment_plans.py

Payment plan creation and instalment invoice generation.
"""

import datetime
from decimal import Decimal, ROUND_DOWN

from django.db import transaction
from django.utils import timezone


def distribute_evenly(total: Decimal, count: int) -> list:
    """
    Split total into count amounts, rounding down to 2dp.
    Any shortfall (from rounding) is added to the last instalment.
    """
    base      = (total / count).quantize(Decimal('0.01'), rounding=ROUND_DOWN)
    shortfall = total - base * count
    amounts   = [base] * count
    amounts[-1] += shortfall
    return amounts


def create_payment_plan(
    marina,
    member,
    booking,
    name: str,
    total_amount: Decimal,
    auto_issue: bool,
    dd_mandate_ref: str,
    instalments_data: list,
    created_by=None,
):
    """
    Create a PaymentPlan + all PaymentPlanInstalment objects atomically.

    instalments_data: list of dicts with keys 'due_date' (date), 'amount' (Decimal).
    Validates:
      - sum(instalments) == total_amount
      - due_dates are unique and ascending
    Returns: PaymentPlan instance
    """
    from apps.accounting.models import PaymentPlan, PaymentPlanInstalment

    # Validation
    instalment_total = sum(Decimal(str(i['amount'])) for i in instalments_data)
    if instalment_total != total_amount:
        raise ValueError(
            f"Instalment total {instalment_total} does not equal plan total {total_amount}."
        )

    due_dates = [i['due_date'] for i in instalments_data]
    if len(due_dates) != len(set(due_dates)):
        raise ValueError("Instalment due dates must be unique.")
    if due_dates != sorted(due_dates):
        raise ValueError("Instalment due dates must be in ascending order.")

    with transaction.atomic():
        plan = PaymentPlan.objects.create(
            marina=marina,
            member=member,
            booking=booking,
            name=name,
            total_amount=total_amount,
            status=PaymentPlan.Status.ACTIVE,
            auto_issue=auto_issue,
            dd_mandate_ref=dd_mandate_ref or '',
            created_by=created_by,
        )
        for seq, data in enumerate(instalments_data, start=1):
            PaymentPlanInstalment.objects.create(
                plan=plan,
                sequence=seq,
                due_date=data['due_date'],
                amount=Decimal(str(data['amount'])),
                status=PaymentPlanInstalment.Status.SCHEDULED,
            )
    return plan


def issue_instalment_invoice(instalment) -> object:
    """
    Create an Invoice with one line item describing the instalment.
    Sets instalment.status = 'invoiced', links instalment.invoice.
    Called by instalment_processor task and the manual issue-invoice endpoint.
    Returns: Invoice instance
    """
    from apps.billing.models import Invoice, InvoiceLineItem, ChargeableItem

    plan   = instalment.plan
    marina = plan.marina
    member = plan.member

    with transaction.atomic():
        # Generate invoice number
        prefix = 'PP'
        last = Invoice.objects.filter(
            marina=marina,
            invoice_number__startswith=prefix,
        ).order_by('-invoice_number').first()

        if last:
            try:
                seq = int(last.invoice_number[len(prefix):]) + 1
            except ValueError:
                seq = 1
        else:
            seq = 1

        invoice_number = f'{prefix}{seq:06d}'

        invoice = Invoice.objects.create(
            marina=marina,
            member=member,
            invoice_number=invoice_number,
            status='unpaid',
            source_type='payment_plan',
            source_id=str(plan.pk),
            subtotal=instalment.amount,
            tax_total=Decimal('0.00'),
            total=instalment.amount,
            due_date=instalment.due_date,
            billing_period=instalment.due_date.strftime('%Y-%m'),
        )

        # Find a generic ChargeableItem for payment plan instalments, or leave blank
        InvoiceLineItem.objects.create(
            invoice=invoice,
            description=f'{plan.name} — instalment {instalment.sequence}',
            quantity=Decimal('1.00'),
            unit_price=instalment.amount,
            total_price=instalment.amount,
            tax_rate=Decimal('0.00'),
        )

        instalment.invoice = invoice
        instalment.status  = 'invoiced'
        instalment.save(update_fields=['invoice', 'status'])

    return invoice
