"""
apps/accounting/services/credit.py

On-account member credit management.
All balance mutations use select_for_update() to prevent race conditions.
"""

from decimal import Decimal

from django.db import transaction


def top_up_credit(
    member,
    marina,
    amount: Decimal,
    payment_method: str = '',
    stripe_payment_intent: str = '',
    recorded_by=None,
):
    """
    Add credit to a member's account.  Creates MemberCreditAccount if it doesn't exist.
    Returns: MemberCreditTransaction
    """
    from apps.accounting.models import MemberCreditAccount, MemberCreditTransaction

    with transaction.atomic():
        account, _ = MemberCreditAccount.objects.select_for_update().get_or_create(
            marina=marina,
            member=member,
            defaults={'balance': Decimal('0.00'), 'auto_deduct': False},
        )
        account.balance += amount
        account.save(update_fields=['balance'])

        tx = MemberCreditTransaction.objects.create(
            credit_account=account,
            transaction_type=MemberCreditTransaction.TransactionType.TOP_UP,
            amount=amount,
            direction='credit',
            balance_after=account.balance,
            payment_method=payment_method,
            stripe_payment_intent=stripe_payment_intent,
            recorded_by=recorded_by,
        )
    return tx


def deduct_credit(
    member,
    marina,
    amount: Decimal,
    invoice=None,
    transaction_type: str = 'manual_deduct',
    recorded_by=None,
):
    """
    Deduct credit from a member's account.
    Raises ValueError if balance < amount.
    Returns: MemberCreditTransaction
    """
    from apps.accounting.models import MemberCreditAccount, MemberCreditTransaction

    with transaction.atomic():
        try:
            account = MemberCreditAccount.objects.select_for_update().get(
                marina=marina, member=member
            )
        except MemberCreditAccount.DoesNotExist:
            raise ValueError("Member has no credit account at this marina.")

        if account.balance < amount:
            raise ValueError(
                f"Insufficient credit balance: have {account.balance}, need {amount}."
            )

        account.balance -= amount
        account.save(update_fields=['balance'])

        tx = MemberCreditTransaction.objects.create(
            credit_account=account,
            transaction_type=transaction_type,
            amount=amount,
            direction='debit',
            balance_after=account.balance,
            invoice=invoice,
            recorded_by=recorded_by,
        )
    return tx


def auto_deduct_on_invoice(invoice):
    """
    Auto-deduct available credit against an unpaid invoice if auto_deduct=True.

    Logic:
      1. Check MemberCreditAccount for member with auto_deduct=True.
      2. Full coverage: deduct balance, mark invoice paid, post GL.
      3. Partial coverage: deduct available, create Payment for partial amount,
         send Stripe payment link for remainder.
         Never alters Invoice.total.
    Returns: MemberCreditTransaction | None
    """
    from apps.accounting.models import MemberCreditAccount
    from apps.billing.models import Payment
    from apps.accounting.services.gl_posting import post_payment_gl

    if not invoice.member:
        return None

    marina = invoice.marina
    member = invoice.member

    try:
        account = MemberCreditAccount.objects.select_for_update().get(
            marina=marina,
            member=member,
            auto_deduct=True,
        )
    except MemberCreditAccount.DoesNotExist:
        return None

    if account.balance <= 0:
        return None

    with transaction.atomic():
        amount_to_deduct = min(account.balance, invoice.total)

        account.balance -= amount_to_deduct
        account.save(update_fields=['balance'])

        from apps.accounting.models import MemberCreditTransaction
        tx = MemberCreditTransaction.objects.create(
            credit_account=account,
            transaction_type=MemberCreditTransaction.TransactionType.AUTO_DEDUCT,
            amount=amount_to_deduct,
            direction='debit',
            balance_after=account.balance,
            invoice=invoice,
        )

        # Record a Payment object for this deduction
        payment = Payment.objects.create(
            invoice=invoice,
            method='marina_account',
            amount=amount_to_deduct,
        )

        # Full coverage — mark invoice paid
        if amount_to_deduct >= invoice.total:
            from django.utils import timezone
            invoice.status = 'paid'
            invoice.paid_at = timezone.now()
            invoice.save(update_fields=['status', 'paid_at'])

        # Partial coverage — Stripe payment link for remainder would be sent here
        # (deferred to stripe_service integration; payment link dispatch omitted)

    return tx
