"""
apps/accounting/models.py
Financial Accounting models for DocksBase — Track 4.

Model dependency order (respect FK constraints):
  CostCentre → Account → CostCentreBudget
  → JournalEntry → JournalEntryLine
  → Currency → ExchangeRate
  → MemberCreditAccount → MemberCreditTransaction
  → SurchargeRule
  → PaymentPlan → PaymentPlanInstalment
  → DeferredRevenueEntry → DeferredRevenueRecognitionLog
  → FuelDutyRate → RedDieselSaleDeclaration → HMRCFuelDutyReturn
  → Supplier → APPurchaseOrder → APInvoice → APInvoiceLineItem
  → AccountingIntegrationConfig → AccountingSyncRecord

NOTE: `from fernet_fields import EncryptedJSONField` requires `django-fernet-fields`.
      Add `django-fernet-fields>=0.6` to requirements.txt and `fernet_fields` to
      THIRD_PARTY_APPS in settings. See INSTALL.md.
"""

from decimal import Decimal

from django.db import models
from django.db.models import Q, CheckConstraint
from django.core.exceptions import ValidationError

from apps.accounting.fields import EncryptedJSONField


# ---------------------------------------------------------------------------
# 1. CostCentre
# ---------------------------------------------------------------------------

class CostCentre(models.Model):
    marina    = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='cost_centres')
    code      = models.CharField(max_length=20)
    name      = models.CharField(max_length=200)
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = [('marina', 'code')]
        ordering = ['name']

    def __str__(self):
        return f'{self.code} — {self.name}'


# ---------------------------------------------------------------------------
# 2. Account (Chart of Accounts)
# ---------------------------------------------------------------------------

class Account(models.Model):
    class AccountType(models.TextChoices):
        ASSET     = 'asset',     'Asset'
        LIABILITY = 'liability', 'Liability'
        EQUITY    = 'equity',    'Equity'
        REVENUE   = 'revenue',   'Revenue'
        EXPENSE   = 'expense',   'Expense'

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='chart_of_accounts')
    code          = models.CharField(max_length=20)
    name          = models.CharField(max_length=200)
    account_type  = models.CharField(max_length=20, choices=AccountType.choices)
    parent        = models.ForeignKey(
        'self', null=True, blank=True, on_delete=models.SET_NULL, related_name='children'
    )
    is_active     = models.BooleanField(default=True)
    cost_centre   = models.ForeignKey(
        CostCentre, null=True, blank=True, on_delete=models.SET_NULL, related_name='accounts'
    )
    external_code = models.CharField(max_length=100, blank=True)

    class Meta:
        unique_together = [('marina', 'code')]
        ordering = ['code']

    def __str__(self):
        return f'{self.code} — {self.name}'


# ---------------------------------------------------------------------------
# 3. CostCentreBudget  (depends on Account)
# ---------------------------------------------------------------------------

class CostCentreBudget(models.Model):
    cost_centre     = models.ForeignKey(CostCentre, on_delete=models.CASCADE, related_name='budgets')
    period          = models.CharField(max_length=7)   # "YYYY-MM"
    account         = models.ForeignKey(Account, on_delete=models.CASCADE, related_name='budgets')
    budgeted_amount = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        unique_together = [('cost_centre', 'period', 'account')]
        ordering = ['period', 'cost_centre']


# ---------------------------------------------------------------------------
# 4. JournalEntry and JournalEntryLine
# ---------------------------------------------------------------------------

class JournalEntry(models.Model):
    class SourceType(models.TextChoices):
        INVOICE              = 'invoice',              'Invoice'
        PAYMENT              = 'payment',              'Payment'
        CREDIT_NOTE          = 'credit_note',          'Credit Note'
        DEFERRED_RECOGNITION = 'deferred_recognition', 'Deferred Revenue Recognition'
        AP_INVOICE           = 'ap_invoice',           'AP Invoice'
        AP_PAYMENT           = 'ap_payment',           'AP Payment'
        MANUAL               = 'manual',               'Manual Journal'
        FX_REVALUATION       = 'fx_revaluation',       'FX Revaluation'

    marina      = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='journal_entries'
    )
    entry_date  = models.DateField()
    source_type = models.CharField(max_length=40, choices=SourceType.choices)
    source_id   = models.IntegerField(null=True, blank=True, db_index=True)
    reference   = models.CharField(max_length=100, blank=True)
    description = models.TextField(blank=True)
    currency    = models.CharField(max_length=3, default='EUR')
    fx_rate     = models.DecimalField(max_digits=14, decimal_places=6, default=Decimal('1.000000'))
    created_at  = models.DateTimeField(auto_now_add=True)
    created_by  = models.ForeignKey(
        'staff.StaffMember', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='journal_entries_created'
    )
    is_posted   = models.BooleanField(default=True)

    def save(self, *args, **kwargs):
        """Guard: a posted journal entry is immutable."""
        if self.pk and self.is_posted:
            try:
                original = JournalEntry.objects.get(pk=self.pk)
                if original.is_posted:
                    raise PermissionError("Cannot modify a posted journal entry.")
            except JournalEntry.DoesNotExist:
                pass
        super().save(*args, **kwargs)

    class Meta:
        ordering = ['-entry_date', '-created_at']

    def __str__(self):
        return f'JE-{self.pk} {self.entry_date} ({self.source_type})'


class JournalEntryLine(models.Model):
    """
    Base-currency GL line. debit and credit are always in marina base currency.
    amount_foreign_* capture original transaction currency for audit/FX revaluation.
    Constraint: exactly one of debit or credit must be non-zero.
    """
    entry                 = models.ForeignKey(
        JournalEntry, on_delete=models.CASCADE, related_name='lines'
    )
    account               = models.ForeignKey(
        Account, on_delete=models.PROTECT, related_name='journal_lines'
    )
    debit                 = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    credit                = models.DecimalField(max_digits=14, decimal_places=2, default=Decimal('0.00'))
    amount_foreign_debit  = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    amount_foreign_credit = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    description           = models.CharField(max_length=255, blank=True)
    cost_centre           = models.ForeignKey(
        CostCentre, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='journal_lines'
    )

    def clean(self):
        debit  = self.debit  or Decimal('0.00')
        credit = self.credit or Decimal('0.00')
        if (debit > 0) == (credit > 0):
            raise ValidationError(
                "A journal line must have exactly one of debit or credit non-zero."
            )

    class Meta:
        constraints = [
            CheckConstraint(
                condition=(Q(debit=0, credit__gt=0) | Q(debit__gt=0, credit=0)),
                name='accounting_journal_line_debit_xor_credit',
            )
        ]

    def __str__(self):
        return f'JEL-{self.pk}: Dr {self.debit} Cr {self.credit} → {self.account}'


# ---------------------------------------------------------------------------
# 5. Currency and ExchangeRate
# ---------------------------------------------------------------------------

class Currency(models.Model):
    marina    = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='currencies')
    code      = models.CharField(max_length=3)
    name      = models.CharField(max_length=100)
    symbol    = models.CharField(max_length=5)
    is_base   = models.BooleanField(default=False)  # exactly one per marina; locked after first JE
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = [('marina', 'code')]

    def __str__(self):
        return f'{self.code} ({self.name})'


class ExchangeRate(models.Model):
    marina        = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='exchange_rates'
    )
    from_currency = models.CharField(max_length=3)
    to_currency   = models.CharField(max_length=3)
    rate          = models.DecimalField(max_digits=14, decimal_places=6)
    rate_date     = models.DateField()
    source        = models.CharField(max_length=50, blank=True)  # 'ecb', 'openexchangerates', 'manual'

    class Meta:
        unique_together = [('marina', 'from_currency', 'to_currency', 'rate_date')]
        ordering = ['-rate_date']


# ---------------------------------------------------------------------------
# 6. MemberCreditAccount and MemberCreditTransaction
# ---------------------------------------------------------------------------

class MemberCreditAccount(models.Model):
    """
    One record per marina-member pair. Balance is the running total of credits minus debits.
    Always use select_for_update() before any balance read-modify-write.
    """
    marina          = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='member_credit_accounts'
    )
    member          = models.ForeignKey(
        'members.Member', on_delete=models.CASCADE, related_name='credit_account'
    )
    balance         = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    auto_deduct     = models.BooleanField(default=False)
    last_updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('marina', 'member')]

    def __str__(self):
        return f'{self.member} credit balance: {self.balance}'


class MemberCreditTransaction(models.Model):
    class TransactionType(models.TextChoices):
        TOP_UP        = 'top_up',        'Top-Up (credit added)'
        AUTO_DEDUCT   = 'auto_deduct',   'Auto-Deducted against Invoice'
        MANUAL_DEDUCT = 'manual_deduct', 'Manual Deduction by Staff'
        REFUND        = 'refund',        'Refund to Balance'
        LOYALTY_AWARD = 'loyalty_award', 'Loyalty Points Redemption'
        ADJUSTMENT    = 'adjustment',    'Staff Adjustment'

    credit_account        = models.ForeignKey(
        MemberCreditAccount, on_delete=models.CASCADE, related_name='transactions'
    )
    transaction_type      = models.CharField(max_length=30, choices=TransactionType.choices)
    amount                = models.DecimalField(max_digits=12, decimal_places=2)
    direction             = models.CharField(
        max_length=6, choices=[('credit', 'Credit'), ('debit', 'Debit')]
    )
    balance_after         = models.DecimalField(max_digits=12, decimal_places=2)
    invoice               = models.ForeignKey(
        'billing.Invoice', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='credit_transactions'
    )
    payment_method        = models.CharField(max_length=30, blank=True)
    stripe_payment_intent = models.CharField(max_length=200, blank=True)
    notes                 = models.CharField(max_length=500, blank=True)
    recorded_by           = models.ForeignKey(
        'staff.StaffMember', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='credit_transactions_recorded'
    )
    created_at            = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']


# ---------------------------------------------------------------------------
# 7. SurchargeRule
# ---------------------------------------------------------------------------

class SurchargeRule(models.Model):
    class TriggerType(models.TextChoices):
        PAYMENT_METHOD  = 'payment_method',  'Payment Method (e.g. card fee)'
        CHARGEABLE_ITEM = 'chargeable_item', 'Specific Chargeable Item'
        CATEGORY        = 'category',        'Chargeable Item Category'

    class AmountType(models.TextChoices):
        PERCENTAGE = 'percentage', 'Percentage'
        FLAT       = 'flat',       'Flat Amount'

    marina            = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='surcharge_rules'
    )
    name              = models.CharField(max_length=200)
    trigger_type      = models.CharField(max_length=30, choices=TriggerType.choices)
    payment_method    = models.CharField(max_length=30, blank=True)
    chargeable_item   = models.ForeignKey(
        'billing.ChargeableItem', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='surcharge_rules'
    )
    item_category     = models.CharField(max_length=20, blank=True)
    amount_type       = models.CharField(max_length=20, choices=AmountType.choices)
    amount            = models.DecimalField(max_digits=8, decimal_places=4)
    description_label = models.CharField(max_length=200, default='Surcharge')
    is_active         = models.BooleanField(default=True)
    gl_account        = models.ForeignKey(
        Account, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='surcharge_rules'
    )

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


# ---------------------------------------------------------------------------
# 8. PaymentPlan and PaymentPlanInstalment
# ---------------------------------------------------------------------------

class PaymentPlan(models.Model):
    class Status(models.TextChoices):
        ACTIVE    = 'active',    'Active'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'
        PAUSED    = 'paused',    'Paused'

    marina          = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='payment_plans'
    )
    member          = models.ForeignKey(
        'members.Member', on_delete=models.SET_NULL, null=True, blank=True,
        related_name='payment_plans'
    )
    booking         = models.ForeignKey(
        'reservations.Booking', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='payment_plans'
    )
    name            = models.CharField(max_length=200)
    total_amount    = models.DecimalField(max_digits=12, decimal_places=2)
    status          = models.CharField(
        max_length=20, choices=Status.choices, default=Status.ACTIVE
    )
    auto_issue      = models.BooleanField(default=True)
    dd_mandate_ref  = models.CharField(max_length=100, blank=True)
    dd_advance_days = models.PositiveIntegerField(default=3)
    created_at      = models.DateTimeField(auto_now_add=True)
    created_by      = models.ForeignKey(
        'staff.StaffMember', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='payment_plans_created'
    )

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.name} ({self.status})'


class PaymentPlanInstalment(models.Model):
    class Status(models.TextChoices):
        SCHEDULED = 'scheduled', 'Scheduled'
        NOTIFIED  = 'notified',  'Advance Notice Sent'
        INVOICED  = 'invoiced',  'Invoice Generated'
        PAID      = 'paid',      'Paid'
        FAILED    = 'failed',    'Payment Failed'
        OVERDUE   = 'overdue',   'Overdue'
        WAIVED    = 'waived',    'Waived'

    plan           = models.ForeignKey(
        PaymentPlan, on_delete=models.CASCADE, related_name='instalments'
    )
    sequence       = models.PositiveSmallIntegerField()
    due_date       = models.DateField()
    amount         = models.DecimalField(max_digits=12, decimal_places=2)
    status         = models.CharField(
        max_length=20, choices=Status.choices, default=Status.SCHEDULED
    )
    invoice        = models.OneToOneField(
        'billing.Invoice', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='plan_instalment'
    )
    retry_count    = models.PositiveSmallIntegerField(default=0)
    last_retry_at  = models.DateTimeField(null=True, blank=True)
    failure_reason = models.TextField(blank=True)
    notified_at    = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = [('plan', 'sequence')]
        ordering = ['due_date']

    def __str__(self):
        return f'Instalment {self.sequence} of {self.plan} — {self.amount} due {self.due_date}'


# ---------------------------------------------------------------------------
# 9. DeferredRevenueEntry and DeferredRevenueRecognitionLog
# ---------------------------------------------------------------------------

class DeferredRevenueEntry(models.Model):
    class RevenueType(models.TextChoices):
        SEASONAL_BERTH = 'seasonal_berth', 'Seasonal Berth Pre-Payment'
        ANNUAL_BERTH   = 'annual_berth',   'Annual Berth Pre-Payment'
        GIFT_VOUCHER   = 'gift_voucher',   'Gift Voucher'
        DEPOSIT        = 'deposit',        'Event / Service Deposit'
        OTHER          = 'other',          'Other Advance Payment'

    marina              = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='deferred_revenue'
    )
    member              = models.ForeignKey(
        'members.Member', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='deferred_revenue_entries'
    )
    invoice             = models.ForeignKey(
        'billing.Invoice', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='deferred_revenue_entries'
    )
    revenue_type        = models.CharField(max_length=30, choices=RevenueType.choices)
    description         = models.CharField(max_length=255)
    total_amount        = models.DecimalField(max_digits=12, decimal_places=2)
    earned_amount       = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    deferred_amount     = models.DecimalField(max_digits=12, decimal_places=2)
    service_start       = models.DateField()
    service_end         = models.DateField()
    gl_deferred_account = models.ForeignKey(
        Account, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='deferred_entries'
    )
    gl_earned_account   = models.ForeignKey(
        Account, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='earned_entries'
    )
    is_fully_recognised = models.BooleanField(default=False)
    cancelled_at        = models.DateTimeField(null=True, blank=True)
    refunded_amount     = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    created_at          = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Deferred {self.description} — {self.deferred_amount} remaining'


class DeferredRevenueRecognitionLog(models.Model):
    """Immutable. One row per nightly job run per entry. get_or_create for idempotency."""
    deferred_entry    = models.ForeignKey(
        DeferredRevenueEntry, on_delete=models.CASCADE, related_name='recognition_logs'
    )
    recognition_date  = models.DateField()
    amount_recognised = models.DecimalField(max_digits=12, decimal_places=2)
    journal_entry     = models.ForeignKey(
        JournalEntry, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='deferred_recognition_logs'
    )
    created_at        = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('deferred_entry', 'recognition_date')]
        ordering = ['-recognition_date']


# ---------------------------------------------------------------------------
# 10. FuelDutyRate, RedDieselSaleDeclaration, HMRCFuelDutyReturn
# ---------------------------------------------------------------------------

class FuelDutyRate(models.Model):
    class UseType(models.TextChoices):
        PROPULSION     = 'propulsion',     'Propulsion (higher rate for red diesel)'
        NON_PROPULSION = 'non_propulsion', 'Non-Propulsion / Heating (rebated rate)'

    marina         = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='fuel_duty_rates'
    )
    fuel_type      = models.CharField(max_length=20)
    use_type       = models.CharField(max_length=20, choices=UseType.choices)
    duty_rate      = models.DecimalField(max_digits=10, decimal_places=6)
    effective_from = models.DateField()
    effective_to   = models.DateField(null=True, blank=True)
    is_active      = models.BooleanField(default=True)

    class Meta:
        ordering = ['-effective_from']

    def __str__(self):
        return f'{self.fuel_type} {self.use_type} @ {self.duty_rate} (from {self.effective_from})'


class RedDieselSaleDeclaration(models.Model):
    """
    One declaration per fuel dock entry. FuelDockEntry must have red_diesel as fuel_type.
    Prerequisite: add 'red_diesel' to FuelDockEntry.FUEL_TYPE_CHOICES in fuel_dock/models.py.
    See INSTALL.md.
    """
    marina                = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='red_diesel_declarations'
    )
    fuel_dock_entry       = models.OneToOneField(
        'fuel_dock.FuelDockEntry', on_delete=models.CASCADE,
        related_name='red_diesel_declaration'
    )
    propulsion_litres     = models.DecimalField(max_digits=10, decimal_places=3)
    non_propulsion_litres = models.DecimalField(max_digits=10, decimal_places=3)
    propulsion_duty       = models.DecimalField(max_digits=10, decimal_places=2)
    non_propulsion_duty   = models.DecimalField(max_digits=10, decimal_places=2)
    declaration_by        = models.CharField(max_length=200, blank=True)
    declaration_date      = models.DateField()
    duty_period           = models.CharField(max_length=7, db_index=True)  # "YYYY-QN" e.g. "2026-Q1"

    class Meta:
        ordering = ['-declaration_date']

    def __str__(self):
        return f'RedDiesel decl {self.pk} — {self.duty_period}'


class HMRCFuelDutyReturn(models.Model):
    class ReturnStatus(models.TextChoices):
        DRAFT     = 'draft',     'Draft'
        FINALISED = 'finalised', 'Finalised'
        SUBMITTED = 'submitted', 'Submitted to HMRC'

    marina                      = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='hmrc_returns'
    )
    duty_period                 = models.CharField(max_length=7)
    period_start                = models.DateField()
    period_end                  = models.DateField()
    total_litres_sold           = models.DecimalField(max_digits=14, decimal_places=3, default=Decimal('0.000'))
    propulsion_litres           = models.DecimalField(max_digits=14, decimal_places=3, default=Decimal('0.000'))
    non_propulsion_litres       = models.DecimalField(max_digits=14, decimal_places=3, default=Decimal('0.000'))
    propulsion_duty_payable     = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    non_propulsion_duty_payable = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    total_duty_payable          = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    status                      = models.CharField(
        max_length=20, choices=ReturnStatus.choices, default=ReturnStatus.DRAFT
    )
    generated_at                = models.DateTimeField(auto_now_add=True)
    submitted_at                = models.DateTimeField(null=True, blank=True)
    submission_ref              = models.CharField(max_length=100, blank=True)

    class Meta:
        unique_together = [('marina', 'duty_period')]
        ordering = ['-period_start']

    def __str__(self):
        return f'HMRC Return {self.duty_period} ({self.status})'


# ---------------------------------------------------------------------------
# 11. Supplier, APPurchaseOrder, APInvoice, APInvoiceLineItem
# ---------------------------------------------------------------------------

class Supplier(models.Model):
    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='suppliers')
    name          = models.CharField(max_length=200)
    contact_email = models.EmailField(blank=True)
    payment_terms = models.PositiveIntegerField(default=30)
    gl_account    = models.ForeignKey(
        Account, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='supplier_gl'
    )
    external_id   = models.CharField(max_length=100, blank=True)
    is_active     = models.BooleanField(default=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class APPurchaseOrder(models.Model):
    class Status(models.TextChoices):
        OPEN     = 'open',     'Open'
        RECEIVED = 'received', 'Goods Received'
        INVOICED = 'invoiced', 'Invoiced'
        CLOSED   = 'closed',   'Closed'

    marina            = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='purchase_orders'
    )
    supplier          = models.ForeignKey(
        Supplier, on_delete=models.PROTECT, related_name='purchase_orders'
    )
    po_number         = models.CharField(max_length=50)
    issue_date        = models.DateField()
    expected_delivery = models.DateField(null=True, blank=True)
    total_amount      = models.DecimalField(max_digits=12, decimal_places=2)
    status            = models.CharField(
        max_length=20, choices=Status.choices, default=Status.OPEN
    )
    created_by        = models.ForeignKey(
        'staff.StaffMember', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='purchase_orders_created'
    )
    created_at        = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('marina', 'po_number')]
        ordering = ['-issue_date']

    def __str__(self):
        return f'PO-{self.po_number} ({self.status})'


class APInvoice(models.Model):
    class Status(models.TextChoices):
        DRAFT       = 'draft',       'Draft — Awaiting Review'
        MATCHED     = 'matched',     'Three-Way Matched'
        DISCREPANCY = 'discrepancy', 'Matching Discrepancy — On Hold'
        APPROVED    = 'approved',    'Approved for Payment'
        PAID        = 'paid',        'Paid'
        DISPUTED    = 'disputed',    'Disputed'
        VOID        = 'void',        'Void'

    marina                  = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='ap_invoices'
    )
    supplier                = models.ForeignKey(
        Supplier, on_delete=models.PROTECT, related_name='invoices'
    )
    supplier_invoice_number = models.CharField(max_length=100)
    invoice_date            = models.DateField()
    due_date                = models.DateField()
    currency                = models.CharField(max_length=3, default='EUR')
    subtotal                = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    tax_amount              = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    total_amount            = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    status                  = models.CharField(
        max_length=20, choices=Status.choices, default=Status.DRAFT
    )
    ocr_service             = models.CharField(max_length=50, blank=True)
    ocr_document_id         = models.CharField(max_length=200, blank=True)
    ocr_confidence          = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    raw_document            = models.FileField(upload_to='ap_invoices/', null=True, blank=True)
    purchase_order          = models.ForeignKey(
        APPurchaseOrder, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='invoices'
    )
    match_status            = models.CharField(max_length=30, blank=True)
    match_variance          = models.DecimalField(max_digits=10, decimal_places=2, default=Decimal('0.00'))
    approved_by             = models.ForeignKey(
        'staff.StaffMember', null=True, blank=True, on_delete=models.SET_NULL,
        related_name='ap_invoices_approved'
    )
    approved_at             = models.DateTimeField(null=True, blank=True)
    created_at              = models.DateTimeField(auto_now_add=True)
    journal_entry           = models.OneToOneField(
        JournalEntry, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='ap_invoice'
    )

    class Meta:
        ordering = ['-invoice_date']
        unique_together = [('marina', 'supplier', 'supplier_invoice_number')]

    def __str__(self):
        return f'AP-INV {self.supplier_invoice_number} from {self.supplier} ({self.status})'


class APInvoiceLineItem(models.Model):
    ap_invoice      = models.ForeignKey(APInvoice, on_delete=models.CASCADE, related_name='line_items')
    description     = models.CharField(max_length=255)
    quantity        = models.DecimalField(max_digits=10, decimal_places=4, default=Decimal('1.0000'))
    unit_price      = models.DecimalField(max_digits=12, decimal_places=2)
    line_total      = models.DecimalField(max_digits=12, decimal_places=2)
    tax_amount      = models.DecimalField(max_digits=12, decimal_places=2, default=Decimal('0.00'))
    account         = models.ForeignKey(
        Account, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='ap_line_items'
    )
    cost_centre     = models.ForeignKey(
        CostCentre, null=True, blank=True, on_delete=models.SET_NULL,
        related_name='ap_line_items'
    )
    ocr_description = models.CharField(max_length=500, blank=True)
    position        = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['ap_invoice', 'position']

    def __str__(self):
        return f'AP line {self.position}: {self.description} — {self.line_total}'


# ---------------------------------------------------------------------------
# 12. AccountingIntegrationConfig and AccountingSyncRecord
# ---------------------------------------------------------------------------

class AccountingIntegrationConfig(models.Model):
    class Platform(models.TextChoices):
        XERO                = 'xero',                'Xero'
        QBO                 = 'qbo',                 'QuickBooks Online'
        SAGE_BUSINESS_CLOUD = 'sage_business_cloud', 'Sage Business Cloud Accounting'
        NETSUITE            = 'netsuite',            'Oracle NetSuite'
        DYNAMICS_365        = 'dynamics365',         'Microsoft Dynamics 365 Business Central'
        SAGE_INTACCT        = 'sage_intacct',        'Sage Intacct'
        MYOB                = 'myob',                'MYOB'

    marina         = models.ForeignKey(
        'accounts.Marina', on_delete=models.CASCADE, related_name='accounting_configs'
    )
    platform       = models.CharField(max_length=30, choices=Platform.choices)
    is_active      = models.BooleanField(default=False)
    credentials    = EncryptedJSONField(default=dict)   # requires django-fernet-fields
    company_id     = models.CharField(max_length=200, blank=True)
    base_url       = models.CharField(max_length=500, blank=True)
    last_synced_at = models.DateTimeField(null=True, blank=True)
    sync_errors    = models.JSONField(default=list)

    class Meta:
        unique_together = [('marina', 'platform')]

    def __str__(self):
        return f'{self.marina} → {self.get_platform_display()}'


class AccountingSyncRecord(models.Model):
    class Direction(models.TextChoices):
        PUSH = 'push', 'Push to External'
        PULL = 'pull', 'Pull from External'

    class ObjectType(models.TextChoices):
        INVOICE  = 'invoice',  'Invoice'
        PAYMENT  = 'payment',  'Payment'
        GL_ENTRY = 'gl_entry', 'GL Journal Entry'
        CONTACT  = 'contact',  'Member / Supplier Contact'
        ACCOUNT  = 'account',  'Chart of Account'

    config       = models.ForeignKey(
        AccountingIntegrationConfig, on_delete=models.CASCADE, related_name='sync_records'
    )
    direction    = models.CharField(max_length=10, choices=Direction.choices)
    object_type  = models.CharField(max_length=20, choices=ObjectType.choices)
    local_id     = models.IntegerField(db_index=True)
    external_id  = models.CharField(max_length=200, blank=True)
    status       = models.CharField(max_length=20)
    error_detail = models.TextField(blank=True)
    synced_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-synced_at']

    def __str__(self):
        return f'Sync {self.direction} {self.object_type} local={self.local_id} ({self.status})'
