from decimal import Decimal
from django.db.models import F, Sum, Value, DecimalField
from django.db.models.functions import Coalesce
from django.utils import timezone


def allocate_payment(member, amount, method, notes='', recorded_by=None):
    from .models import AccountPayment, PaymentAllocation, Invoice

    amount = Decimal(str(amount))
    if amount <= Decimal('0'):
        raise ValueError('amount must be greater than zero')

    payment = AccountPayment.objects.create(
        marina=member.marina,
        member=member,
        amount=amount,
        credit_remaining=Decimal('0.00'),
        method=method,
        recorded_by=recorded_by,
        notes=notes,
    )

    open_invoices = list(
        Invoice.objects
        .filter(member=member, status='open')
        .annotate(
            already_paid=Coalesce(
                Sum('allocations__allocated_amount'),
                Value(Decimal('0.00'), output_field=DecimalField()),
            )
        )
        .order_by(F('due_date').asc(nulls_last=True), 'created_at')
    )

    remaining = amount
    settled = []
    partial = []

    for inv in open_invoices:
        if remaining <= Decimal('0'):
            break
        balance_due = inv.total - inv.already_paid
        if balance_due <= Decimal('0'):
            continue
        apply = min(remaining, balance_due)
        PaymentAllocation.objects.create(
            payment=payment,
            invoice=inv,
            allocated_amount=apply,
        )
        remaining -= apply
        if apply >= balance_due:
            Invoice.objects.filter(pk=inv.pk, status='open').update(
                status='paid',
                paid_at=timezone.now(),
            )
            settled.append(inv.pk)
        else:
            partial.append(inv.pk)

    payment.credit_remaining = remaining
    payment.save(update_fields=['credit_remaining'])

    return payment, {
        'payment_id': payment.pk,
        'amount_received': str(amount),
        'amount_allocated': str(amount - remaining),
        'credit_remaining': str(remaining),
        'invoices_settled': settled,
        'invoices_partial': partial,
    }
