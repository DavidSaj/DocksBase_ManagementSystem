"""
apps/accounting/services/gl_posting.py

All GL posting functions.  Every function creates journal entries atomically.

Base-currency conversion rule — enforced in every function:
  _to_base(amount, fx_rate) → Decimal rounded to 0.01 (ROUND_HALF_UP)

All GL lines carry base-currency amounts.  FX conversion happens at posting
time, never at reporting time.
"""

import datetime
from decimal import Decimal, ROUND_HALF_UP

from django.db import transaction

from apps.accounting.models import (
    JournalEntry,
    JournalEntryLine,
    Account,
)


def _to_base(amount: Decimal, fx_rate: Decimal) -> Decimal:
    return (amount * fx_rate).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def _get_default_account(marina, account_type: str, code: str) -> Account | None:
    """
    Return the first active Account matching (marina, code) or (marina, account_type).
    Falls back gracefully — callers must handle None if no account is configured.
    """
    qs = Account.objects.filter(marina=marina, is_active=True)
    account = qs.filter(code=code).first()
    if account:
        return account
    return qs.filter(account_type=account_type).first()


@transaction.atomic
def post_invoice_gl(invoice) -> JournalEntry:
    """
    Dr Debtors (Asset)                     invoice.total
        Cr Revenue accounts (per line item)    each line.total_price
        Cr VAT Liability (if applicable)       invoice.tax_total
    source_type='invoice', source_id=invoice.pk
    """
    marina = invoice.marina
    fx_rate = Decimal('1.000000')  # invoices are in marina base currency by default
    entry_date = (invoice.created_at.date() if invoice.created_at else datetime.date.today())

    je = JournalEntry.objects.create(
        marina=marina,
        entry_date=entry_date,
        source_type=JournalEntry.SourceType.INVOICE,
        source_id=invoice.pk,
        reference=invoice.invoice_number,
        description=f'Invoice {invoice.invoice_number}',
        currency=getattr(marina, 'base_currency', 'EUR'),
        fx_rate=fx_rate,
        is_posted=True,
    )

    # Debtors line
    debtors_account = _get_default_account(marina, Account.AccountType.ASSET, '1100')
    JournalEntryLine.objects.create(
        entry=je,
        account=debtors_account,
        debit=_to_base(invoice.total, fx_rate),
        credit=Decimal('0.00'),
        description=f'Debtors — invoice {invoice.invoice_number}',
    )

    # Revenue lines — group by account from chargeable_item.cost_centre → account
    revenue_by_account: dict = {}
    for line in invoice.items.select_related('chargeable_item__cost_centre').all():
        account = None
        if line.chargeable_item and hasattr(line.chargeable_item, 'cost_centre') and line.chargeable_item.cost_centre:
            account = Account.objects.filter(
                cost_centre=line.chargeable_item.cost_centre,
                account_type=Account.AccountType.REVENUE,
                is_active=True,
            ).first()
        if account is None:
            account = _get_default_account(marina, Account.AccountType.REVENUE, '4100')
        key = account.pk if account else None
        revenue_by_account.setdefault(key, {'account': account, 'total': Decimal('0.00')})
        revenue_by_account[key]['total'] += _to_base(line.total_price, fx_rate)

    for key, data in revenue_by_account.items():
        if data['account']:
            JournalEntryLine.objects.create(
                entry=je,
                account=data['account'],
                debit=Decimal('0.00'),
                credit=data['total'],
                description='Revenue',
            )

    # VAT liability line
    if invoice.tax_total and invoice.tax_total > 0:
        vat_account = _get_default_account(marina, Account.AccountType.LIABILITY, '2200')
        if vat_account:
            JournalEntryLine.objects.create(
                entry=je,
                account=vat_account,
                debit=Decimal('0.00'),
                credit=_to_base(invoice.tax_total, fx_rate),
                description='VAT Liability',
            )

    return je


@transaction.atomic
def post_payment_gl(payment) -> JournalEntry:
    """
    Dr Bank/Cash (Asset)    payment.amount
        Cr Debtors (Asset)      payment.amount
    source_type='payment', source_id=payment.pk
    """
    invoice = payment.invoice
    marina = invoice.marina
    fx_rate = Decimal('1.000000')

    je = JournalEntry.objects.create(
        marina=marina,
        entry_date=payment.paid_at.date() if payment.paid_at else datetime.date.today(),
        source_type=JournalEntry.SourceType.PAYMENT,
        source_id=payment.pk,
        description=f'Payment against invoice {invoice.invoice_number}',
        currency=getattr(marina, 'base_currency', 'EUR'),
        fx_rate=fx_rate,
        is_posted=True,
    )

    bank_account = _get_default_account(marina, Account.AccountType.ASSET, '1010')
    debtors_account = _get_default_account(marina, Account.AccountType.ASSET, '1100')

    JournalEntryLine.objects.create(
        entry=je,
        account=bank_account,
        debit=_to_base(payment.amount, fx_rate),
        credit=Decimal('0.00'),
        description='Bank/Cash receipt',
    )
    JournalEntryLine.objects.create(
        entry=je,
        account=debtors_account,
        debit=Decimal('0.00'),
        credit=_to_base(payment.amount, fx_rate),
        description=f'Clear debtors — invoice {invoice.invoice_number}',
    )

    return je


@transaction.atomic
def post_credit_note_gl(invoice, amount: Decimal) -> JournalEntry:
    """
    Reverse of post_invoice_gl for the credited amount.
    Dr Revenue (reversal)   amount
        Cr Debtors              amount
    source_type='credit_note', source_id=invoice.pk
    """
    marina = invoice.marina
    fx_rate = Decimal('1.000000')

    je = JournalEntry.objects.create(
        marina=marina,
        entry_date=datetime.date.today(),
        source_type=JournalEntry.SourceType.CREDIT_NOTE,
        source_id=invoice.pk,
        description=f'Credit note against invoice {invoice.invoice_number}',
        currency=getattr(marina, 'base_currency', 'EUR'),
        fx_rate=fx_rate,
        is_posted=True,
    )

    revenue_account = _get_default_account(marina, Account.AccountType.REVENUE, '4100')
    debtors_account = _get_default_account(marina, Account.AccountType.ASSET, '1100')
    base_amount = _to_base(amount, fx_rate)

    JournalEntryLine.objects.create(
        entry=je,
        account=revenue_account,
        debit=base_amount,
        credit=Decimal('0.00'),
        description='Credit note revenue reversal',
    )
    JournalEntryLine.objects.create(
        entry=je,
        account=debtors_account,
        debit=Decimal('0.00'),
        credit=base_amount,
        description='Credit note debtor reduction',
    )

    return je


@transaction.atomic
def post_ap_invoice_gl(ap_invoice) -> JournalEntry:
    """
    Dr [account per APInvoiceLineItem]   line.line_total  (one debit per line)
        Cr AP Control Account                ap_invoice.total_amount  (one credit)
    Blocked if any line item has account=None — enforce at view level before calling this.
    source_type='ap_invoice', source_id=ap_invoice.pk
    """
    marina = ap_invoice.marina
    fx_rate = Decimal('1.000000')

    # Validate all lines have accounts
    unresolved = ap_invoice.line_items.filter(account__isnull=True).exists()
    if unresolved:
        raise ValueError(
            "Cannot post AP invoice GL: one or more line items have no account assigned."
        )

    je = JournalEntry.objects.create(
        marina=marina,
        entry_date=ap_invoice.invoice_date,
        source_type=JournalEntry.SourceType.AP_INVOICE,
        source_id=ap_invoice.pk,
        description=f'AP Invoice {ap_invoice.supplier_invoice_number} — {ap_invoice.supplier}',
        currency=ap_invoice.currency,
        fx_rate=fx_rate,
        is_posted=True,
    )

    # One debit per line item
    for line in ap_invoice.line_items.select_related('account', 'cost_centre').all():
        JournalEntryLine.objects.create(
            entry=je,
            account=line.account,
            debit=_to_base(line.line_total, fx_rate),
            credit=Decimal('0.00'),
            description=line.description,
            cost_centre=line.cost_centre,
        )

    # One credit for AP control account
    ap_control = _get_default_account(marina, Account.AccountType.LIABILITY, '2100')
    JournalEntryLine.objects.create(
        entry=je,
        account=ap_control,
        debit=Decimal('0.00'),
        credit=_to_base(ap_invoice.total_amount, fx_rate),
        description='AP Control Account',
    )

    # Link the journal entry back to the AP invoice
    ap_invoice.journal_entry = je
    ap_invoice.save(update_fields=['journal_entry'])

    return je


@transaction.atomic
def post_deferred_refund_gl(entry, refunded_amount: Decimal) -> JournalEntry:
    """
    Dr Deferred Revenue (Liability)   refunded_amount
        Cr Debtors / Bank                 refunded_amount
    Called from adjust_deferred_entry() in deferred_revenue service.
    source_type='credit_note', source_id=entry.pk (reuses credit_note source type for reversal)
    """
    marina = entry.marina
    fx_rate = Decimal('1.000000')
    base_amount = _to_base(refunded_amount, fx_rate)

    je = JournalEntry.objects.create(
        marina=marina,
        entry_date=datetime.date.today(),
        source_type=JournalEntry.SourceType.CREDIT_NOTE,
        source_id=entry.pk,
        description=f'Deferred revenue refund — {entry.description}',
        currency=getattr(marina, 'base_currency', 'EUR'),
        fx_rate=fx_rate,
        is_posted=True,
    )

    deferred_account = entry.gl_deferred_account or _get_default_account(
        marina, Account.AccountType.LIABILITY, '2300'
    )
    debtors_account = _get_default_account(marina, Account.AccountType.ASSET, '1100')

    JournalEntryLine.objects.create(
        entry=je,
        account=deferred_account,
        debit=base_amount,
        credit=Decimal('0.00'),
        description='Deferred revenue reversal (refund)',
    )
    JournalEntryLine.objects.create(
        entry=je,
        account=debtors_account,
        debit=Decimal('0.00'),
        credit=base_amount,
        description='Refund to debtor/bank',
    )

    return je


@transaction.atomic
def post_deferred_recognition_gl(entry, amount: Decimal, recognition_date) -> JournalEntry:
    """
    Dr Deferred Revenue (Liability)   amount
        Cr Revenue (recognised)           amount
    Called by deferred_revenue_recogniser Celery task.
    source_type='deferred_recognition', source_id=entry.pk
    """
    marina = entry.marina
    fx_rate = Decimal('1.000000')
    base_amount = _to_base(amount, fx_rate)

    je = JournalEntry.objects.create(
        marina=marina,
        entry_date=recognition_date,
        source_type=JournalEntry.SourceType.DEFERRED_RECOGNITION,
        source_id=entry.pk,
        description=f'Deferred revenue recognition — {entry.description}',
        currency=getattr(marina, 'base_currency', 'EUR'),
        fx_rate=fx_rate,
        is_posted=True,
    )

    deferred_account = entry.gl_deferred_account or _get_default_account(
        marina, Account.AccountType.LIABILITY, '2300'
    )
    earned_account = entry.gl_earned_account or _get_default_account(
        marina, Account.AccountType.REVENUE, '4100'
    )

    JournalEntryLine.objects.create(
        entry=je,
        account=deferred_account,
        debit=base_amount,
        credit=Decimal('0.00'),
        description='Deferred revenue recognition debit',
    )
    JournalEntryLine.objects.create(
        entry=je,
        account=earned_account,
        debit=Decimal('0.00'),
        credit=base_amount,
        description='Revenue earned (deferred recognition)',
    )

    return je
