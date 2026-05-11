# Track 4 — Financial & Accounting Back-Office: Design Spec
Date: 2026-05-07
Scope: Payment plans with instalments, prepayment / on-account credit, convenience fees and surcharges, red diesel / HMRC fuel duty compliance (UK), deferred revenue recognition, cost centre profitability, automated AP invoice capture, cash flow reporting, balance sheet and P&L statements, multi-currency, and accounting integrations (Xero, NetSuite, Dynamics 365, Sage Intacct, MYOB).

> Spec status: Final — reviewed 2026-05-08

---

## 1. Architectural Goal

Track 4 extends the existing `billing` Django app into a full back-office accounting engine without replacing it. The goal is to keep daily operations (invoicing, POS, boater accounts) unchanged while adding a new accounting layer beneath them. Every financial event generated anywhere in DocksBase — invoice issued, payment received, fuel sale completed, deferred revenue recognised — posts a double-entry journal entry to a `GeneralLedger` that drives all reporting.

Key constraints:
- Multi-tenancy: every new model carries `marina = ForeignKey(Marina)`.
- `ChargeableItem` remains the single source of truth for all pricing and cost-centre assignment.
- No existing model fields are removed in this track. All additions are additive via new models or nullable FKs.
- Background jobs use Celery Beat with Redis as the message broker. Celery provides guaranteed execution, built-in retry mechanics, dead-letter queues, and concurrency control — essential for the volume of journal entries and external API pushes this track generates.
- Accounting adapter integrations follow a single pluggable pattern (see Section 6). No single integration is hardcoded into application logic. The first integration to be implemented is **Xero** (OAuth2), followed by **NetSuite**.
- The HMRC red diesel / fuel duty feature is behind a per-marina feature flag (`marina.hmrc_fuel_duty_enabled`). Data models are present for all marinas, but the UI and background aggregators are skipped when the flag is off. Non-UK marinas are unaffected.

---

## 2. Data Models (Django class definitions)

All new models live in `billing/models.py` unless noted. New Django apps (`ap_capture`, `cost_centres`) are created only if the model count in `billing` becomes unmanageable; by default every model below is in `billing`.

---

### 2.1 General Ledger

The GL is the foundation for all reporting. Every financial event produces one `JournalEntry` with two or more `JournalEntryLine` rows that balance to zero (debits = credits).

```python
class Account(models.Model):
    """Chart of accounts. Each marina maintains its own chart."""

    class AccountType(models.TextChoices):
        ASSET     = 'asset',     'Asset'
        LIABILITY = 'liability', 'Liability'
        EQUITY    = 'equity',    'Equity'
        REVENUE   = 'revenue',   'Revenue'
        EXPENSE   = 'expense',   'Expense'

    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='chart_of_accounts')
    code         = models.CharField(max_length=20)           # e.g. "4100"
    name         = models.CharField(max_length=200)          # e.g. "Berth Revenue"
    account_type = models.CharField(max_length=20, choices=AccountType.choices)
    parent       = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='children')
    is_active    = models.BooleanField(default=True)
    # Cost centre assignment (null = not assigned to a cost centre)
    cost_centre  = models.ForeignKey('CostCentre', null=True, blank=True, on_delete=models.SET_NULL, related_name='accounts')
    # External accounting system code — populated by integration sync
    external_code = models.CharField(max_length=100, blank=True)

    class Meta:
        unique_together = [('marina', 'code')]
        ordering = ['code']

    def __str__(self):
        return f'{self.code} — {self.name}'


class JournalEntry(models.Model):
    """One accounting transaction. Lines must balance (sum of debits = sum of credits)."""

    class SourceType(models.TextChoices):
        INVOICE              = 'invoice',              'Invoice'
        PAYMENT              = 'payment',              'Payment'
        CREDIT_NOTE          = 'credit_note',          'Credit Note'
        DEFERRED_RECOGNITION = 'deferred_recognition', 'Deferred Revenue Recognition'
        AP_INVOICE           = 'ap_invoice',           'AP Invoice'
        AP_PAYMENT           = 'ap_payment',           'AP Payment'
        MANUAL               = 'manual',               'Manual Journal'
        FX_REVALUATION       = 'fx_revaluation',       'FX Revaluation'

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='journal_entries')
    entry_date  = models.DateField()
    source_type = models.CharField(max_length=40, choices=SourceType.choices)
    source_id   = models.IntegerField(null=True, blank=True, db_index=True)  # FK to the originating object
    reference   = models.CharField(max_length=100, blank=True)
    description = models.TextField(blank=True)
    currency    = models.CharField(max_length=3, default='EUR')     # ISO 4217
    fx_rate     = models.DecimalField(max_digits=14, decimal_places=6, default=1.0)  # rate to base currency
    created_at  = models.DateTimeField(auto_now_add=True)
    created_by  = models.ForeignKey('staff.StaffMember', null=True, blank=True, on_delete=models.SET_NULL)
    is_posted   = models.BooleanField(default=True)   # False = draft manual journal

    def save(self, *args, **kwargs):
        if self.pk and self.is_posted:
            raise PermissionError("Cannot modify a posted journal entry.")
        super().save(*args, **kwargs)

    class Meta:
        ordering = ['-entry_date', '-created_at']

    def __str__(self):
        return f'JE-{self.pk} {self.entry_date} ({self.source_type})'


class JournalEntryLine(models.Model):
    """
    Base-currency line of a journal entry.

    `debit` and `credit` are ALWAYS stored in the marina's base currency,
    converted at the `JournalEntry.fx_rate` at posting time. This guarantees
    that a Trial Balance query can sum all lines with plain SQL arithmetic —
    no runtime FX multiplication, no floating-point accumulation across millions
    of rows. The primary columns are the single source of truth for the GL.

    `amount_foreign_debit` / `amount_foreign_credit` capture the original
    transaction-currency amounts for display, audit, and FX-revaluation
    calculations. They are informational only and are never summed for
    balance-sheet or P&L aggregation.
    """
    entry       = models.ForeignKey(JournalEntry, on_delete=models.CASCADE, related_name='lines')
    account     = models.ForeignKey(Account, on_delete=models.PROTECT, related_name='journal_lines')
    # Base-currency amounts — always populated; used for all GL aggregation
    debit       = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    credit      = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    # Original transaction-currency amounts — null when currency == base currency
    amount_foreign_debit  = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    amount_foreign_credit = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    description = models.CharField(max_length=255, blank=True)
    cost_centre = models.ForeignKey('CostCentre', null=True, blank=True, on_delete=models.SET_NULL)

    def clean(self):
        if (self.debit > 0) == (self.credit > 0):
            raise ValidationError("A journal line must have exactly one of debit or credit non-zero.")

    class Meta:
        constraints = [
            CheckConstraint(
                check=(Q(debit=0, credit__gt=0) | Q(debit__gt=0, credit=0)),
                name='journal_line_debit_xor_credit',
            )
        ]

    def __str__(self):
        return f'JEL-{self.pk}: Dr {self.debit} Cr {self.credit} → {self.account}'
```

---

### 2.2 Payment Plans

```python
class PaymentPlan(models.Model):
    """A scheduled series of instalments attached to a contract or booking."""

    class Status(models.TextChoices):
        ACTIVE    = 'active',    'Active'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'
        PAUSED    = 'paused',    'Paused'

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='payment_plans')
    member          = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='payment_plans')
    booking         = models.ForeignKey('reservations.Booking', null=True, blank=True, on_delete=models.SET_NULL, related_name='payment_plans')
    name            = models.CharField(max_length=200)  # e.g. "2026 Seasonal Berth — 6 Month Plan"
    total_amount    = models.DecimalField(max_digits=12, decimal_places=2)
    status          = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    # auto_issue defaults to True platform-wide; each instalment invoice is auto-issued on its due_date without manager approval
    auto_issue      = models.BooleanField(default=True)
    # Direct debit config — executed via Stripe SEPA/BACS Direct Debit
    dd_mandate_ref  = models.CharField(max_length=100, blank=True)  # Stripe SEPA/BACS mandate reference
    dd_advance_days = models.PositiveIntegerField(default=3)        # days advance notice before debit
    created_at      = models.DateTimeField(auto_now_add=True)
    created_by      = models.ForeignKey('staff.StaffMember', null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.name} ({self.status})'


class PaymentPlanInstalment(models.Model):
    """One instalment within a PaymentPlan."""

    class Status(models.TextChoices):
        SCHEDULED = 'scheduled', 'Scheduled'
        NOTIFIED  = 'notified',  'Advance Notice Sent'
        INVOICED  = 'invoiced',  'Invoice Generated'
        PAID      = 'paid',      'Paid'
        FAILED    = 'failed',    'Payment Failed'
        OVERDUE   = 'overdue',   'Overdue'
        WAIVED    = 'waived',    'Waived'

    plan           = models.ForeignKey(PaymentPlan, on_delete=models.CASCADE, related_name='instalments')
    sequence       = models.PositiveSmallIntegerField()   # 1-based ordinal
    due_date       = models.DateField()
    amount         = models.DecimalField(max_digits=12, decimal_places=2)
    status         = models.CharField(max_length=20, choices=Status.choices, default=Status.SCHEDULED)
    invoice        = models.OneToOneField(
        'Invoice', null=True, blank=True, on_delete=models.SET_NULL, related_name='plan_instalment'
    )
    retry_count    = models.PositiveSmallIntegerField(default=0)
    last_retry_at  = models.DateTimeField(null=True, blank=True)
    failure_reason = models.TextField(blank=True)
    notified_at    = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = [('plan', 'sequence')]
        ordering = ['due_date']

    def __str__(self):
        return f'Instalment {self.sequence} of {self.plan} — {self.amount}'
```

---

### 2.3 On-Account Credit (prepayment wallet)

The existing `AccountPayment` model tracks cash payments against a member. Track 4 formalises the on-account credit balance as a proper ledger with debit/credit transactions.

```python
class MemberCreditAccount(models.Model):
    """One record per marina-member pair. Balance is the running total of credits minus debits."""

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='member_credit_accounts')
    member          = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='credit_account')
    balance         = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    auto_deduct     = models.BooleanField(default=False)   # member opt-in for auto-deduction on invoice
    last_updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [('marina', 'member')]

    def __str__(self):
        return f'{self.member} credit balance: {self.balance}'


class MemberCreditTransaction(models.Model):
    """Immutable ledger row for the on-account credit account."""

    class TransactionType(models.TextChoices):
        TOP_UP        = 'top_up',        'Top-Up (credit added)'
        AUTO_DEDUCT   = 'auto_deduct',   'Auto-Deducted against Invoice'
        MANUAL_DEDUCT = 'manual_deduct', 'Manual Deduction by Staff'
        REFUND        = 'refund',        'Refund to Balance'
        LOYALTY_AWARD = 'loyalty_award', 'Loyalty Points Redemption'
        ADJUSTMENT    = 'adjustment',    'Staff Adjustment'

    credit_account   = models.ForeignKey(MemberCreditAccount, on_delete=models.CASCADE, related_name='transactions')
    transaction_type = models.CharField(max_length=30, choices=TransactionType.choices)
    amount           = models.DecimalField(max_digits=12, decimal_places=2)  # always positive; sign implied by type
    direction        = models.CharField(max_length=6, choices=[('credit','Credit'),('debit','Debit')])
    balance_after    = models.DecimalField(max_digits=12, decimal_places=2)
    invoice          = models.ForeignKey('Invoice', null=True, blank=True, on_delete=models.SET_NULL)
    payment_method   = models.CharField(max_length=30, blank=True)  # card/bank_transfer for top-ups
    stripe_payment_intent = models.CharField(max_length=200, blank=True)
    notes            = models.CharField(max_length=500, blank=True)
    recorded_by      = models.ForeignKey('staff.StaffMember', null=True, blank=True, on_delete=models.SET_NULL)
    created_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'{self.transaction_type} {self.direction} {self.amount} on {self.credit_account}'
```

---

### 2.4 Convenience Fees and Surcharges

Surcharge compliance is the marina operator's responsibility. The UI presents a warning label ("Check your local regulations before enabling surcharges") but does not enforce jurisdiction-specific restrictions. There is no `jurisdiction_restriction` field.

```python
class SurchargeRule(models.Model):
    """Configurable surcharge applied to specific transaction types or payment methods."""

    class TriggerType(models.TextChoices):
        PAYMENT_METHOD   = 'payment_method',   'Payment Method (e.g. card fee)'
        CHARGEABLE_ITEM  = 'chargeable_item',  'Specific Chargeable Item'
        CATEGORY         = 'category',         'Chargeable Item Category'

    class AmountType(models.TextChoices):
        PERCENTAGE = 'percentage', 'Percentage'
        FLAT       = 'flat',       'Flat Amount'

    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='surcharge_rules')
    name             = models.CharField(max_length=200)
    trigger_type     = models.CharField(max_length=30, choices=TriggerType.choices)
    # For PAYMENT_METHOD triggers
    payment_method   = models.CharField(max_length=30, blank=True)  # 'card', 'stripe', etc.
    # For CHARGEABLE_ITEM triggers
    chargeable_item  = models.ForeignKey('ChargeableItem', null=True, blank=True, on_delete=models.SET_NULL)
    # For CATEGORY triggers
    item_category    = models.CharField(max_length=20, blank=True, choices=ChargeableItem.Category.choices)
    amount_type      = models.CharField(max_length=20, choices=AmountType.choices)
    amount           = models.DecimalField(max_digits=8, decimal_places=4)  # pct (e.g. 1.5) or flat (e.g. 2.50)
    description_label = models.CharField(max_length=200, default='Surcharge')  # shown on invoice line
    is_active        = models.BooleanField(default=True)
    # GL account to post surcharge revenue to
    gl_account       = models.ForeignKey('Account', null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return f'{self.name} ({self.get_amount_type_display()}: {self.amount})'
```

---

### 2.5 Red Diesel / HMRC Fuel Duty (UK)

These models are present in every marina's database. The `marina.hmrc_fuel_duty_enabled` flag gates the UI and background aggregators; non-UK marinas are unaffected at the application layer.

```python
class FuelDutyRate(models.Model):
    """HMRC duty rates per litre for each fuel product. Updated when rates change."""

    class UseType(models.TextChoices):
        PROPULSION     = 'propulsion',     'Propulsion (higher rate for red diesel)'
        NON_PROPULSION = 'non_propulsion', 'Non-Propulsion / Heating (rebated rate)'

    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='fuel_duty_rates')
    fuel_type       = models.CharField(max_length=20)   # matches FuelDockEntry.FUEL_TYPE_CHOICES; 'red_diesel' added
    use_type        = models.CharField(max_length=20, choices=UseType.choices)
    duty_rate       = models.DecimalField(max_digits=10, decimal_places=6)   # £ per litre
    effective_from  = models.DateField()
    effective_to    = models.DateField(null=True, blank=True)
    is_active       = models.BooleanField(default=True)

    class Meta:
        ordering = ['-effective_from']

    def __str__(self):
        return f'{self.fuel_type} {self.use_type} @ {self.duty_rate}/L from {self.effective_from}'


class RedDieselSaleDeclaration(models.Model):
    """
    Extends a FuelDockEntry for red diesel sales. Records the buyer's propulsion split
    declaration as required by HMRC regulations.
    """

    fuel_dock_entry     = models.OneToOneField(
        'fuel_dock.FuelDockEntry', on_delete=models.CASCADE, related_name='red_diesel_declaration'
    )
    propulsion_litres   = models.DecimalField(max_digits=10, decimal_places=3)
    non_propulsion_litres = models.DecimalField(max_digits=10, decimal_places=3)
    # Duty amounts computed at time of sale
    propulsion_duty     = models.DecimalField(max_digits=10, decimal_places=2)
    non_propulsion_duty = models.DecimalField(max_digits=10, decimal_places=2)
    declaration_by      = models.CharField(max_length=200, blank=True)  # skipper name or vessel rep
    declaration_date    = models.DateField()
    # HMRC period this sale is included in (YYYY-MM for quarterly grouping)
    duty_period         = models.CharField(max_length=7, db_index=True)

    class Meta:
        ordering = ['-declaration_date']

    def __str__(self):
        return f'Red diesel decl. {self.fuel_dock_entry_id} — {self.declaration_date}'


class HMRCFuelDutyReturn(models.Model):
    """
    A periodic summary record generated by the nightly job for HMRC duty return preparation.
    One record per duty_period (quarter) per marina.
    """

    class ReturnStatus(models.TextChoices):
        DRAFT     = 'draft',     'Draft'
        FINALISED = 'finalised', 'Finalised'
        SUBMITTED = 'submitted', 'Submitted to HMRC'

    marina                   = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='hmrc_returns')
    duty_period              = models.CharField(max_length=7)   # e.g. "2026-Q1"
    period_start             = models.DateField()
    period_end               = models.DateField()
    total_litres_sold        = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    propulsion_litres        = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    non_propulsion_litres    = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    propulsion_duty_payable  = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    non_propulsion_duty_payable = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_duty_payable       = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status                   = models.CharField(max_length=20, choices=ReturnStatus.choices, default=ReturnStatus.DRAFT)
    generated_at             = models.DateTimeField(auto_now_add=True)
    submitted_at             = models.DateTimeField(null=True, blank=True)
    submission_ref           = models.CharField(max_length=100, blank=True)

    class Meta:
        unique_together = [('marina', 'duty_period')]
        ordering = ['-period_start']

    def __str__(self):
        return f'HMRC Return {self.duty_period} — {self.marina}'
```

---

### 2.6 Deferred Revenue

```python
class DeferredRevenueEntry(models.Model):
    """
    When a seasonal or advance payment is received, the full amount is deferred here.
    The nightly recognition job drains earned_amount forward each day.
    """

    class RevenueType(models.TextChoices):
        SEASONAL_BERTH = 'seasonal_berth', 'Seasonal Berth Pre-Payment'
        ANNUAL_BERTH   = 'annual_berth',   'Annual Berth Pre-Payment'
        GIFT_VOUCHER   = 'gift_voucher',   'Gift Voucher'
        DEPOSIT        = 'deposit',        'Event / Service Deposit'
        OTHER          = 'other',          'Other Advance Payment'

    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='deferred_revenue')
    member           = models.ForeignKey('members.Member', null=True, blank=True, on_delete=models.SET_NULL)
    invoice          = models.ForeignKey('Invoice', null=True, blank=True, on_delete=models.SET_NULL)
    revenue_type     = models.CharField(max_length=30, choices=RevenueType.choices)
    description      = models.CharField(max_length=255)
    total_amount     = models.DecimalField(max_digits=12, decimal_places=2)
    earned_amount    = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    deferred_amount  = models.DecimalField(max_digits=12, decimal_places=2)   # total - earned
    service_start    = models.DateField()   # start of the period being earned over
    service_end      = models.DateField()   # end; daily_rate = total / (end - start).days
    gl_deferred_account = models.ForeignKey(
        'Account', null=True, blank=True, on_delete=models.SET_NULL, related_name='deferred_entries'
    )
    gl_earned_account   = models.ForeignKey(
        'Account', null=True, blank=True, on_delete=models.SET_NULL, related_name='earned_entries'
    )
    is_fully_recognised = models.BooleanField(default=False)
    # Cancellation / partial refund tracking
    # When a booking is cancelled or an invoice is partially/fully refunded, these fields
    # must be updated immediately to prevent the nightly recogniser from continuing to
    # post "ghost" revenue against a contract that no longer exists.
    cancelled_at        = models.DateTimeField(null=True, blank=True)
    refunded_amount     = models.DecimalField(max_digits=12, decimal_places=2, default=0,
                                              help_text='Cumulative refunds applied against this '
                                                        'deferred entry. total_amount and '
                                                        'deferred_amount are reduced accordingly.')
    created_at          = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Deferred {self.description} — {self.deferred_amount} remaining'


class DeferredRevenueRecognitionLog(models.Model):
    """One row per nightly recognition job run per entry. Immutable audit trail."""

    deferred_entry   = models.ForeignKey(DeferredRevenueEntry, on_delete=models.CASCADE, related_name='recognition_logs')
    recognition_date = models.DateField()
    amount_recognised= models.DecimalField(max_digits=12, decimal_places=2)
    journal_entry    = models.ForeignKey(JournalEntry, null=True, blank=True, on_delete=models.SET_NULL)
    created_at       = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('deferred_entry', 'recognition_date')]
        ordering = ['-recognition_date']
```

---

### 2.7 Cost Centres

```python
class CostCentre(models.Model):
    """Department-level grouping for P&L reporting."""

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='cost_centres')
    code        = models.CharField(max_length=20)         # e.g. "FUEL", "BERTH", "REST"
    name        = models.CharField(max_length=200)        # e.g. "Fuel Dock"
    is_active   = models.BooleanField(default=True)

    class Meta:
        unique_together = [('marina', 'code')]
        ordering = ['name']

    def __str__(self):
        return f'{self.code} — {self.name}'


class CostCentreBudget(models.Model):
    """Monthly budget entry per cost centre per account type (revenue / expense)."""

    cost_centre    = models.ForeignKey(CostCentre, on_delete=models.CASCADE, related_name='budgets')
    period         = models.CharField(max_length=7)     # "YYYY-MM"
    account        = models.ForeignKey('Account', on_delete=models.CASCADE, related_name='budgets')
    budgeted_amount= models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        unique_together = [('cost_centre', 'period', 'account')]
        ordering = ['period', 'cost_centre']

    def __str__(self):
        return f'Budget {self.cost_centre} {self.period}: {self.budgeted_amount}'
```

---

### 2.8 Automated AP Invoice Capture (Accounts Payable)

The OCR webhook endpoint is generic — it accepts any provider's payload and normalises fields to the `APInvoice` draft format via a per-provider field mapping layer. This avoids vendor lock-in with Dext or AutoEntry and allows future providers (including an AI-based PDF reader) to be added without structural changes.

```python
class Supplier(models.Model):
    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='suppliers')
    name            = models.CharField(max_length=200)
    contact_email   = models.EmailField(blank=True)
    payment_terms   = models.PositiveIntegerField(default=30)   # days
    gl_account      = models.ForeignKey('Account', null=True, blank=True, on_delete=models.SET_NULL)
    external_id     = models.CharField(max_length=100, blank=True)   # ID in external accounting system
    is_active       = models.BooleanField(default=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class APInvoice(models.Model):
    """Supplier (accounts payable) invoice."""

    class Status(models.TextChoices):
        DRAFT       = 'draft',       'Draft — Awaiting Review'
        MATCHED     = 'matched',     'Three-Way Matched'
        DISCREPANCY = 'discrepancy', 'Matching Discrepancy — On Hold'
        APPROVED    = 'approved',    'Approved for Payment'
        PAID        = 'paid',        'Paid'
        DISPUTED    = 'disputed',    'Disputed'
        VOID        = 'void',        'Void'

    marina           = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='ap_invoices')
    supplier         = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name='invoices')
    supplier_invoice_number = models.CharField(max_length=100)
    invoice_date     = models.DateField()
    due_date         = models.DateField()
    currency         = models.CharField(max_length=3, default='EUR')
    subtotal         = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    tax_amount       = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_amount     = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status           = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    # OCR capture fields — provider-agnostic; populated by the generic webhook normaliser
    ocr_service      = models.CharField(max_length=50, blank=True)   # originating provider name
    ocr_document_id  = models.CharField(max_length=200, blank=True)
    ocr_confidence   = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    raw_document     = models.FileField(upload_to='ap_invoices/', null=True, blank=True)
    # Three-way matching
    purchase_order   = models.ForeignKey('APPurchaseOrder', null=True, blank=True, on_delete=models.SET_NULL, related_name='invoices')
    match_status     = models.CharField(max_length=30, blank=True)   # 'ok', 'amount_variance', 'no_po'
    match_variance   = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    approved_by      = models.ForeignKey('staff.StaffMember', null=True, blank=True, on_delete=models.SET_NULL)
    approved_at      = models.DateTimeField(null=True, blank=True)
    created_at       = models.DateTimeField(auto_now_add=True)
    journal_entry    = models.OneToOneField(JournalEntry, null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        ordering = ['-invoice_date']
        unique_together = [('marina', 'supplier', 'supplier_invoice_number')]

    def __str__(self):
        return f'AP-{self.pk} {self.supplier} {self.supplier_invoice_number}'


class APInvoiceLineItem(models.Model):
    """
    One cost line within an AP invoice.

    A supplier invoice is almost never monolithic. A €10,000 chandlery invoice
    might contain €8,000 of Parts Inventory (Asset account), €1,500 of Workshop
    Tools (Expense, Cost Centre: Maintenance), and €500 of Office Supplies
    (Expense, Cost Centre: Admin). Posting a single GL debit for the invoice
    total destroys cost-centre and account-level visibility.

    The GL posting engine iterates over APInvoiceLineItem records to generate
    the individual debit legs of the journal entry; it never uses APInvoice.subtotal
    as the sole debit amount. The credit leg (AP control account) remains a single
    line for the invoice total.

    OCR webhook: the normaliser attempts to extract line-item detail from the raw
    document. Unresolved lines are created with `account=null` and
    `cost_centre=null` so staff can complete the mapping in the approval UI
    before posting.
    """
    ap_invoice    = models.ForeignKey(APInvoice, on_delete=models.CASCADE, related_name='line_items')
    description   = models.CharField(max_length=255)
    quantity      = models.DecimalField(max_digits=10, decimal_places=4, default=1)
    unit_price    = models.DecimalField(max_digits=12, decimal_places=2)
    line_total    = models.DecimalField(max_digits=12, decimal_places=2)
    tax_amount    = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    # GL mapping — must be set before the invoice can be approved
    account       = models.ForeignKey('Account', null=True, blank=True, on_delete=models.SET_NULL,
                                      related_name='ap_line_items')
    cost_centre   = models.ForeignKey('CostCentre', null=True, blank=True, on_delete=models.SET_NULL,
                                      related_name='ap_line_items')
    # OCR-extracted description before staff editing
    ocr_description = models.CharField(max_length=500, blank=True)
    position      = models.PositiveSmallIntegerField(default=0)  # display order

    class Meta:
        ordering = ['ap_invoice', 'position']

    def __str__(self):
        return f'AP line: {self.description} — {self.line_total}'


class APPurchaseOrder(models.Model):
    """Purchase order for three-way matching."""

    class Status(models.TextChoices):
        OPEN      = 'open',      'Open'
        RECEIVED  = 'received',  'Goods Received'
        INVOICED  = 'invoiced',  'Invoiced'
        CLOSED    = 'closed',    'Closed'

    marina       = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='purchase_orders')
    supplier     = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name='purchase_orders')
    po_number    = models.CharField(max_length=50)
    issue_date   = models.DateField()
    expected_delivery = models.DateField(null=True, blank=True)
    total_amount = models.DecimalField(max_digits=12, decimal_places=2)
    status       = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    created_by   = models.ForeignKey('staff.StaffMember', null=True, blank=True, on_delete=models.SET_NULL)
    created_at   = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('marina', 'po_number')]
        ordering = ['-issue_date']

    def __str__(self):
        return f'PO-{self.po_number} — {self.supplier}'
```

---

### 2.9 Multi-Currency

The base currency is fixed at marina setup time. After the first journal entry has been posted, the base currency is hard-locked and cannot be changed. Any marina that needs a different base currency must be created as a new Marina instance.

```python
class Currency(models.Model):
    """Currencies enabled per marina. One record is marked as the base currency."""

    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='currencies')
    code           = models.CharField(max_length=3)    # ISO 4217: EUR, GBP, USD, AUD, NZD
    name           = models.CharField(max_length=100)
    symbol         = models.CharField(max_length=5)
    is_base        = models.BooleanField(default=False)   # exactly one per marina; locked after first JE posted
    is_active      = models.BooleanField(default=True)

    class Meta:
        unique_together = [('marina', 'code')]

    def __str__(self):
        return f'{self.code} ({self.name})'


class ExchangeRate(models.Model):
    """Daily exchange rate snapshot. Populated by a daily FX rate job."""

    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='exchange_rates')
    from_currency  = models.CharField(max_length=3)
    to_currency    = models.CharField(max_length=3)
    rate           = models.DecimalField(max_digits=14, decimal_places=6)
    rate_date      = models.DateField()
    source         = models.CharField(max_length=50, blank=True)  # 'ecb', 'openexchangerates', 'manual'

    class Meta:
        unique_together = [('marina', 'from_currency', 'to_currency', 'rate_date')]
        ordering = ['-rate_date']

    def __str__(self):
        return f'{self.from_currency}/{self.to_currency} @ {self.rate} on {self.rate_date}'
```

---

### 2.10 Accounting Integration Sync Log

```python
class AccountingIntegrationConfig(models.Model):
    """One record per accounting platform connected to a marina."""

    class Platform(models.TextChoices):
        XERO          = 'xero',         'Xero'
        NETSUITE      = 'netsuite',     'Oracle NetSuite'
        DYNAMICS_365  = 'dynamics365',  'Microsoft Dynamics 365 Business Central'
        SAGE_INTACCT  = 'sage_intacct', 'Sage Intacct'
        MYOB          = 'myob',         'MYOB'

    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='accounting_configs')
    platform       = models.CharField(max_length=30, choices=Platform.choices)
    is_active      = models.BooleanField(default=False)
    # Credentials are encrypted at rest using django-fernet-fields.
    # from fernet_fields import EncryptedJSONField
    credentials    = EncryptedJSONField(default=dict)
    company_id     = models.CharField(max_length=200, blank=True)   # tenant/company ID in external system
    base_url       = models.CharField(max_length=500, blank=True)   # for self-hosted NetSuite/Dynamics
    last_synced_at = models.DateTimeField(null=True, blank=True)
    sync_errors    = models.JSONField(default=list)

    class Meta:
        unique_together = [('marina', 'platform')]

    def __str__(self):
        return f'{self.marina} → {self.get_platform_display()}'


class AccountingSyncRecord(models.Model):
    """Audit log row for each object pushed to or pulled from an external accounting system."""

    class Direction(models.TextChoices):
        PUSH = 'push', 'Push to External'
        PULL = 'pull', 'Pull from External'

    class ObjectType(models.TextChoices):
        INVOICE   = 'invoice',   'Invoice'
        PAYMENT   = 'payment',   'Payment'
        GL_ENTRY  = 'gl_entry',  'GL Journal Entry'
        CONTACT   = 'contact',   'Member / Supplier Contact'
        ACCOUNT   = 'account',   'Chart of Account'

    config         = models.ForeignKey(AccountingIntegrationConfig, on_delete=models.CASCADE, related_name='sync_records')
    direction      = models.CharField(max_length=10, choices=Direction.choices)
    object_type    = models.CharField(max_length=20, choices=ObjectType.choices)
    local_id       = models.IntegerField(db_index=True)
    external_id    = models.CharField(max_length=200, blank=True)
    status         = models.CharField(max_length=20)    # 'ok', 'error', 'skipped'
    error_detail   = models.TextField(blank=True)
    synced_at      = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-synced_at']
```

---

## 3. Background Jobs / Scheduled Tasks

All jobs are Celery Beat tasks registered in `billing/tasks.py`. They are idempotent — running twice on the same day produces the same result. Celery provides built-in retry mechanics, dead-letter queues, and concurrency control; the message broker is Redis.

### 3.1 `instalment_processor` — runs nightly at 00:30 local time

Behaviour:
1. Query all `PaymentPlanInstalment` with `status='scheduled'` and `due_date <= today + dd_advance_days`.
   Use `.select_for_update(skip_locked=True)` on this queryset. Multiple Celery workers can execute this task concurrently; `skip_locked=True` ensures each instalment row is processed by exactly one worker — rows locked by another worker are silently skipped rather than causing the second worker to block or double-process.
2. For each, send the advance notice email via Resend (Anymail) and set `status='notified'`, `notified_at=now()`.
3. Query all `PaymentPlanInstalment` with `status IN ('scheduled','notified')` and `due_date <= today`.
   Also use `.select_for_update(skip_locked=True)` here for the same concurrency reason.
4. If `plan.auto_issue=True` (the platform-wide default), generate an `Invoice` (with a single line item describing the instalment), set `instalment.status='invoiced'`, link `instalment.invoice`.
5. If `plan.auto_issue=False`, create a manager task (email notification) to approve and issue.
6. Debit execution is via **Stripe SEPA/BACS Direct Debit** using the stored `dd_mandate_ref` as the Stripe mandate reference. If the Stripe charge attempt fails: increment `retry_count`, set `last_retry_at=now()`, schedule a Celery retry after `marina.dd_retry_days` (configurable, default 3 days). On second failure: set `status='failed'`, generate a manual payment request email, flag instalment as overdue.

### 3.2 `deferred_revenue_recogniser` — runs nightly at 01:00 local time

Behaviour:
1. Query all `DeferredRevenueEntry` where `is_fully_recognised=False` and `service_start <= today` and `cancelled_at IS NULL`.
2. For each, compute `daily_rate = total_amount / max((service_end - service_start).days, 1)`.
3. Check if a `DeferredRevenueRecognitionLog` already exists for today's date. If so, skip.
4. Compute `amount_to_recognise = min(daily_rate, deferred_amount)`.
5. Create a `JournalEntry` (source_type=`deferred_recognition`) with:
   - Dr `gl_deferred_account` (Deferred Revenue liability reduces)
   - Cr `gl_earned_account` (Earned Revenue increases)
6. Use `DeferredRevenueRecognitionLog.objects.get_or_create(deferred_entry=entry, recognition_date=today)` rather than a bare `create()`. The `unique_together` constraint on `(deferred_entry, recognition_date)` is the database-level guard, but Celery can retry a task after a partial failure (e.g. the process is killed after the `JournalEntry` is written but before the task returns). Without `get_or_create`, a retry would attempt a second `create()` and hit an `IntegrityError`. `get_or_create` makes the step idempotent: the second run retrieves the existing row and continues cleanly. Update `earned_amount` and `deferred_amount`. If `deferred_amount <= 0`, set `is_fully_recognised=True`.

**Cancellation / refund hook (runs synchronously, not nightly):**

When a `Booking` is cancelled or an `Invoice` refund is processed, the system must immediately call `adjust_deferred_entry(deferred_entry, refunded_amount)`:

```python
def adjust_deferred_entry(entry: DeferredRevenueEntry, refunded_amount: Decimal) -> None:
    """
    Called synchronously from the Booking cancellation and Invoice refund flows.
    Reduces total_amount and deferred_amount by the refunded value, then
    halts further recognition if deferred_amount reaches zero.
    Never re-opens already-recognised amounts — recognised revenue stays recognised.
    """
    with transaction.atomic():
        entry.refunded_amount += refunded_amount
        entry.total_amount    -= refunded_amount
        entry.deferred_amount  = max(entry.total_amount - entry.earned_amount, Decimal('0.00'))
        if entry.deferred_amount <= 0:
            entry.is_fully_recognised = True
            entry.cancelled_at = now()
        entry.save(update_fields=['refunded_amount', 'total_amount', 'deferred_amount',
                                  'is_fully_recognised', 'cancelled_at'])
        # Post a reversing JournalEntry for the refunded deferred liability
        post_deferred_refund_gl(entry, refunded_amount)
```

Without this hook, the nightly task will blindly post ghost revenue for months after a cancelled annual contract — inflating the P&L and creating a tax liability on income that was refunded.

### 3.3 `hmrc_duty_period_aggregator` — runs on the last day of each quarter at 02:00

Only executes for marinas where `marina.hmrc_fuel_duty_enabled=True`. All other marinas are skipped.

Behaviour:
1. Determine the current duty period (Q1 = Jan–Mar, Q2 = Apr–Jun, Q3 = Jul–Sep, Q4 = Oct–Dec).
2. For each qualifying marina, aggregate all `RedDieselSaleDeclaration` records in the period.
3. Upsert `HMRCFuelDutyReturn` with summed litres and computed duty amounts.
4. Set `status='draft'` and notify the marina accountant via email to review and mark as finalised.

### 3.4 `fx_rate_updater` — runs daily at 06:00 UTC

Behaviour:
1. For each marina with more than one active `Currency`, fetch daily rates from the configured source (ECB free API as default; OpenExchangeRates as fallback).
2. Upsert `ExchangeRate` records for today.
3. Log the source and any fetch errors to `AccountingIntegrationConfig.sync_errors`.

### 3.5 `accounting_sync_push` — runs every 15 minutes

Behaviour:
1. For each active `AccountingIntegrationConfig`, call the platform adapter (see Section 6).
2. Find all `Invoice`, `Payment`, and `JournalEntry` records created since `last_synced_at` that have no corresponding `AccountingSyncRecord` with `status='ok'`.
3. Push each object. Record a `AccountingSyncRecord` row with the result.
4. Update `last_synced_at` on success. Retry failed records on the next run (max 5 retries before alerting). Network timeouts and transient failures are handled by Celery's retry mechanism with exponential back-off.

### 3.6 `credit_auto_deduct` — runs at invoice creation time (Celery task triggered by signal)

Behaviour (Django `post_save` signal on `Invoice` when `status` changes to `unpaid` dispatches a Celery task):
1. Check if the invoice's member has a `MemberCreditAccount` with `auto_deduct=True`.
2. If the balance covers the full invoice total: create a `MemberCreditTransaction` (type=`auto_deduct`, direction=`debit`), decrement balance to zero, mark `Invoice.status='paid'`, post GL entries.
3. If the balance is less than the invoice total (partial coverage): auto-deduct the available balance immediately, create a `MemberCreditTransaction` for the partial amount, and record a `Payment` object against the invoice for the credit amount applied (so the invoice ledger reflects the partial settlement). **Never modify `Invoice.total`.** Altering the total of an issued invoice is illegal under European tax law (GoBD, LPF, etc.) — an invoice for €1,000 must remain €1,000 in perpetuity. The invoice's `amount_due` is derived as `total - sum(payments)` at query time, not stored as a mutable field. Send the member a Stripe payment link for `invoice.amount_due` (the remaining balance after the credit payment is recorded).

---

## 4. API Contract

All endpoints follow the pattern `/api/v1/<app>/<resource>/` with DRF `ModelViewSet` unless noted. All endpoints require the standard marina-scoped authentication. Pagination follows the existing DRF `PageNumberPagination` (default page size 50).

---

### 4.1 General Ledger

```
GET    /api/v1/billing/accounts/                         — chart of accounts list
POST   /api/v1/billing/accounts/                         — create account
PATCH  /api/v1/billing/accounts/{id}/                   — edit account
GET    /api/v1/billing/journal-entries/                  — list with ?date_from=&date_to=&source_type=
POST   /api/v1/billing/journal-entries/                  — create manual journal (is_posted=False by default)
POST   /api/v1/billing/journal-entries/{id}/post/        — post a draft manual journal
GET    /api/v1/billing/journal-entries/{id}/lines/       — lines for a journal entry
```

### 4.2 Payment Plans

```
GET    /api/v1/billing/payment-plans/                    — list plans ?member=&status=
POST   /api/v1/billing/payment-plans/                    — create plan + instalments in one request
GET    /api/v1/billing/payment-plans/{id}/               — plan detail with instalment list
PATCH  /api/v1/billing/payment-plans/{id}/               — edit plan (name, auto_issue, dd fields)
POST   /api/v1/billing/payment-plans/{id}/cancel/        — cancel plan; sets status=cancelled
GET    /api/v1/billing/payment-plans/{id}/instalments/   — list instalments
PATCH  /api/v1/billing/instalments/{id}/                 — mark waived / adjust amount
POST   /api/v1/billing/instalments/{id}/issue-invoice/   — manually issue invoice for this instalment
```

Request body for `POST /api/v1/billing/payment-plans/`:
```json
{
  "member_id": 12,
  "booking_id": null,
  "name": "2026 Seasonal Berth — 6 Month Plan",
  "total_amount": "3600.00",
  "auto_issue": true,
  "dd_mandate_ref": "MANDATE-0042",
  "instalments": [
    { "sequence": 1, "due_date": "2026-01-01", "amount": "900.00" },
    { "sequence": 2, "due_date": "2026-02-01", "amount": "540.00" },
    { "sequence": 3, "due_date": "2026-03-01", "amount": "540.00" },
    { "sequence": 4, "due_date": "2026-04-01", "amount": "540.00" },
    { "sequence": 5, "due_date": "2026-05-01", "amount": "540.00" },
    { "sequence": 6, "due_date": "2026-06-01", "amount": "540.00" }
  ]
}
```
Validation: `sum(instalments[].amount)` must equal `total_amount`. Instalment `due_date`s must be unique and in ascending order.

**Auto-distribution (backend and frontend):** When the manager sets a count and requests even distribution (rather than supplying explicit per-instalment amounts), the backend must apply the remainder-penny algorithm:

```python
def distribute_evenly(total: Decimal, count: int) -> list[Decimal]:
    base     = (total / count).quantize(Decimal('0.01'), rounding=ROUND_DOWN)
    shortfall = total - base * count          # e.g. €0.01 on €1000 / 3
    amounts  = [base] * count
    amounts[-1] += shortfall                 # final instalment absorbs the remainder
    return amounts
```

Example: €1,000 / 3 → [€333.33, €333.33, €333.34]. The sum is always exactly €1,000.00. The `PaymentPlanFormDrawer` frontend applies the same algorithm client-side so the totals row always shows a green checkmark before submission; it does not rely on the server error to surface the mismatch.

### 4.3 On-Account Credit

```
GET    /api/v1/billing/credit-accounts/                  — list accounts ?member=
GET    /api/v1/billing/credit-accounts/{member_id}/      — single member's credit account
POST   /api/v1/billing/credit-accounts/{member_id}/top-up/   — staff top-up (cash/bank_transfer)
POST   /api/v1/billing/credit-accounts/{member_id}/deduct/   — manual deduction by staff
PATCH  /api/v1/billing/credit-accounts/{member_id}/     — toggle auto_deduct
GET    /api/v1/billing/credit-accounts/{member_id}/transactions/  — ledger history (paginated)
POST   /api/v1/portal/credit/top-up/                    — member self-service top-up via Stripe
```

### 4.4 Surcharge Rules

```
GET    /api/v1/billing/surcharge-rules/
POST   /api/v1/billing/surcharge-rules/
PATCH  /api/v1/billing/surcharge-rules/{id}/
```

### 4.5 HMRC Fuel Duty

```
GET    /api/v1/billing/fuel-duty-rates/
POST   /api/v1/billing/fuel-duty-rates/
GET    /api/v1/billing/hmrc-returns/                     — list ?period=
GET    /api/v1/billing/hmrc-returns/{id}/                — return detail + declaration list
POST   /api/v1/billing/hmrc-returns/{id}/finalise/       — lock return for submission
GET    /api/v1/billing/hmrc-returns/{id}/export/         — download return as structured CSV/PDF
POST   /api/v1/fuel-dock/entries/{id}/red-diesel-declaration/  — attach declaration to a sale
```

### 4.6 Deferred Revenue

```
GET    /api/v1/billing/deferred-revenue/                 — list ?is_fully_recognised=false
POST   /api/v1/billing/deferred-revenue/                 — create entry manually (for non-invoice-linked deferrals)
GET    /api/v1/billing/deferred-revenue/{id}/logs/       — recognition log for one entry
GET    /api/v1/billing/deferred-revenue/summary/         — aggregate: total deferred, next 30/60/90 day schedule
```

### 4.7 Cost Centres and Budgets

```
GET    /api/v1/billing/cost-centres/
POST   /api/v1/billing/cost-centres/
PATCH  /api/v1/billing/cost-centres/{id}/
GET    /api/v1/billing/cost-centres/{id}/budgets/        — budgets ?period=2026-05
POST   /api/v1/billing/cost-centres/{id}/budgets/        — upsert a monthly budget line
GET    /api/v1/billing/cost-centres/{id}/pl/             — P&L report ?period_from=&period_to=
GET    /api/v1/billing/cost-centres/{id}/budget-vs-actuals/ — variance report ?period=
```

### 4.8 AP Invoice Capture

```
GET    /api/v1/billing/suppliers/
POST   /api/v1/billing/suppliers/
PATCH  /api/v1/billing/suppliers/{id}/
GET    /api/v1/billing/ap-invoices/                      — list ?status=&supplier=
POST   /api/v1/billing/ap-invoices/                      — create draft (used by OCR webhook)
PATCH  /api/v1/billing/ap-invoices/{id}/                 — edit fields on draft
POST   /api/v1/billing/ap-invoices/{id}/approve/         — approve for payment; blocked (400) if any APInvoiceLineItem has account=null or cost_centre=null
POST   /api/v1/billing/ap-invoices/{id}/mark-paid/       — record payment
POST   /api/v1/billing/ap-invoices/{id}/void/
POST   /api/v1/billing/ap-invoices/ocr-webhook/          — generic webhook; normalises any provider's payload to APInvoice draft
GET    /api/v1/billing/purchase-orders/
POST   /api/v1/billing/purchase-orders/
PATCH  /api/v1/billing/purchase-orders/{id}/
POST   /api/v1/billing/purchase-orders/{id}/receive/     — mark goods received
```

### 4.9 Reports

```
GET    /api/v1/reports/balance-sheet/                    — ?as_of_date=YYYY-MM-DD
GET    /api/v1/reports/profit-and-loss/                  — ?period_from=&period_to=&compare_prior=true
GET    /api/v1/reports/cash-flow/                        — ?period_from=&period_to=
GET    /api/v1/reports/cash-forecast/                    — rolling 8-week forward view
GET    /api/v1/reports/deferred-revenue/                 — balance sheet liability schedule
GET    /api/v1/reports/cost-centre-pl/                   — all cost centres, any period
```

Reports return JSON by default. Add `?format=pdf` to trigger server-side PDF generation using **WeasyPrint**. The interactive React view serves daily use; the PDF export yields an immutable, correctly paginated document suitable for auditors and board reporting.

### 4.10 Accounting Integrations

```
GET    /api/v1/billing/accounting-configs/
POST   /api/v1/billing/accounting-configs/               — connect a platform
PATCH  /api/v1/billing/accounting-configs/{id}/          — update credentials / toggle active
POST   /api/v1/billing/accounting-configs/{id}/sync-now/ — trigger immediate sync
POST   /api/v1/billing/accounting-configs/{id}/test/     — test connection
GET    /api/v1/billing/accounting-configs/{id}/sync-log/ — paginated AccountingSyncRecord list
```

### 4.11 Multi-Currency

```
GET    /api/v1/billing/currencies/
POST   /api/v1/billing/currencies/
PATCH  /api/v1/billing/currencies/{id}/                  — set base (blocked if any JE exists) / toggle active
GET    /api/v1/billing/exchange-rates/                   — ?from_currency=&date=
POST   /api/v1/billing/exchange-rates/                   — manual rate override
```

`PATCH /api/v1/billing/currencies/{id}/` returns `HTTP 409 Conflict` with an appropriate error message if `is_base` is being changed after journal entries exist for the marina.

---

## 5. Frontend Architecture

All new screens live under a new **Finance** top-level sidebar section. The general component pattern follows the existing `List / Drawer` approach established in `Billing.jsx`.

### 5.1 Sidebar additions

Add a new **Finance** sidebar group (below Billing) with these routes:

| Route | Screen |
|---|---|
| `/finance/payment-plans` | PaymentPlansScreen |
| `/finance/deferred-revenue` | DeferredRevenueScreen |
| `/finance/cost-centres` | CostCentresScreen |
| `/finance/ap-invoices` | APInvoiceScreen |
| `/finance/accounting-integrations` | AccountingIntegrationsScreen |
| `/finance/reports/balance-sheet` | BalanceSheetScreen |
| `/finance/reports/pl` | PLStatementScreen |
| `/finance/reports/cash-flow` | CashFlowScreen |

The existing `Billing` screen gains two new tabs:
- **Payment Plans** (tab value `'payment-plans'`) — summary card per plan with instalment timeline
- **On-Account Credit** (tab value `'credit-accounts'`) — replaces the coming-soon "Apply Credit" button in the boater account drawer

---

### 5.2 New components

**`PaymentPlansScreen.jsx`**
- List of all plans with status badge, member name, total amount, and progress bar (`paid instalments / total instalments`).
- Top-right `[ + New Payment Plan ]` opens `PaymentPlanFormDrawer`.
- Clicking a plan row opens `PaymentPlanDetailDrawer` showing the instalment timeline as a vertical step list with status icons.

**`PaymentPlanFormDrawer.jsx`**
- Member search (existing pattern from `Billing.jsx`).
- Dynamic instalment rows: manager sets count and dates; amounts auto-distribute using the remainder-penny algorithm (final instalment absorbs any rounding difference — see Section 4.2). Manual override per row is allowed; the totals row shows a running sum with a green checkmark when it matches `total_amount`.
- Validation: instalment total must equal plan total (shown inline as a running delta, not just at submit time).
- `auto_issue` toggle (defaults to on) and direct debit mandate field (shown only when relevant).

**`CreditAccountDrawer.jsx`** (embedded in boater account drawer)
- Shows current balance and last 10 transactions.
- `[ Top Up ]` button → opens amount + method form → calls `POST /api/v1/billing/credit-accounts/{id}/top-up/`.
- `[ Manual Deduct ]` → staff deduction with reason field.
- `auto_deduct` toggle with tooltip: when enabled, the credit balance will be applied automatically to new invoices as a Payment against the invoice — the invoice total is never altered. The UI displays: Invoice Total / Credits Applied / Amount Due. A Stripe payment link is sent for Amount Due when partial coverage applies.

**`APInvoiceScreen.jsx`**
- Three sub-tabs: `Inbox` (draft/discrepancy), `Approved`, `Paid`.
- Inbox tab shows OCR-extracted fields with a confidence indicator. The source provider name is displayed. Staff can edit header fields before approving.
- **Line items panel:** Each AP invoice expands to show its `APInvoiceLineItem` rows. Each line has an account picker (filtered to expense/asset accounts) and a cost centre picker. Unmapped lines are highlighted in amber — the Approve button is disabled until all lines have an account assigned.
- Three-way match status shown as a coloured badge: `Matched`, `Discrepancy`, `No PO`.
- `[ Approve ]` and `[ Dispute ]` action buttons per row.

**`DeferredRevenueScreen.jsx`**
- Summary cards: Total Deferred, Expected next 30 days, Next 60 days, Next 90 days.
- Table of active entries with progress bar (`earned / total`), service period, and daily rate.
- Drillable to recognition log for each entry.

**`CostCentresScreen.jsx`**
- Two sub-tabs: `P&L` and `Budgets`.
- P&L tab: period date pickers → table of cost centres with revenue, direct costs, contribution margin, and margin %. Historical transactions before cost-centre configuration show as `Unassigned`.
- Budgets tab: grid of cost centres × months; editable cells (inline `PUT` on blur).

**`BalanceSheetScreen.jsx`**
- `as_of_date` date picker (defaults to today).
- Three column sections: Assets, Liabilities, Equity — mirroring standard balance sheet layout.
- `[ Export PDF ]` button → `GET /api/v1/reports/balance-sheet/?as_of_date=...&format=pdf` — server-generated WeasyPrint PDF.

**`PLStatementScreen.jsx`**
- Period range pickers. Optional toggle: compare prior period.
- Revenue section and Expense section with account-level rows. Drillable to journal lines.
- `[ Export PDF ]` button → server-generated WeasyPrint PDF.

**`CashFlowScreen.jsx`**
- Toggle between historical (`Cash Flow Statement`) and forward-looking (`8-Week Forecast`).
- Forecast view: weekly column chart (recharts) showing expected inflows vs outflows.

**`AccountingIntegrationsScreen.jsx`**
- Card per connected platform. Status badge (`Connected`, `Error`, `Inactive`).
- Platform order reflects integration priority: Xero first, then NetSuite, then Dynamics 365, Sage Intacct, MYOB.
- `[ Connect ]` opens platform-specific credential form (OAuth2 flow for Xero; API key / OAuth1.0a for NetSuite; API key for Dynamics/Sage/MYOB).
- `[ Sync Now ]` triggers `POST /api/v1/billing/accounting-configs/{id}/sync-now/`.
- Sync log table below the card: last 50 sync events with status and error detail.

---

### 5.3 React Query hooks (new)

```js
// hooks/usePaymentPlans.js       — GET/POST/PATCH plans + instalments
// hooks/useCreditAccounts.js     — GET credit account + transactions; topUp / deduct mutations
// hooks/useAPInvoices.js         — GET/POST/PATCH AP invoices; approve / mark-paid mutations
// hooks/useDeferredRevenue.js    — GET deferred entries + summary
// hooks/useCostCentres.js        — GET cost centres + P&L + budgets; upsert budget mutation
// hooks/useReports.js            — GET balance sheet / P&L / cash flow (query params drive cache key)
// hooks/useAccountingIntegrations.js  — GET configs; syncNow / testConnection mutations
```

All hooks follow the existing pattern in `useBoaterAccounts.js`: React Query + Axios, toast on mutation success/error, query-key invalidation on mutation success.

---

## 6. Accounting Integration Architecture (pattern for all external accounting adapters)

Each accounting platform adapter is a Python class that implements a common interface. No platform-specific logic leaks into views, serializers, or management commands.

```python
# billing/integrations/base.py

from abc import ABC, abstractmethod
from typing import Any

class AccountingAdapter(ABC):
    """
    Base class for all external accounting platform adapters.
    Instantiated with the marina's AccountingIntegrationConfig.
    """

    def __init__(self, config: 'AccountingIntegrationConfig'):
        self.config = config

    @abstractmethod
    def test_connection(self) -> dict:
        """Return {'ok': True} or {'ok': False, 'error': str}."""

    @abstractmethod
    def push_invoice(self, invoice: 'Invoice') -> str:
        """
        Create or update the invoice in the external system.
        Return the external invoice ID on success. Raise AdapterError on failure.
        """

    @abstractmethod
    def push_payment(self, payment: 'Payment') -> str:
        """Push a payment record. Return external payment ID."""

    @abstractmethod
    def push_journal_entry(self, entry: 'JournalEntry') -> str:
        """Push a GL journal entry. Return external journal ID."""

    @abstractmethod
    def sync_chart_of_accounts(self) -> list[dict]:
        """
        Pull account codes from external system and upsert local Account records.
        Return list of {'code', 'name', 'account_type', 'external_code'}.
        """

    @abstractmethod
    def sync_contacts(self) -> list[dict]:
        """Pull or push member/supplier contacts. Return sync summary."""


class AdapterError(Exception):
    """Raised by adapters on non-retryable errors (auth failure, invalid data)."""

class AdapterRetryableError(Exception):
    """Raised by adapters on transient errors (rate limit, 503). Will be retried by Celery."""
```

Concrete adapters live in `billing/integrations/`. Implementation priority order: Xero first, then NetSuite.

```
billing/integrations/
    __init__.py
    base.py
    xero.py          — Xero OAuth2 adapter (first integration; replaces existing CSV export)
    netsuite.py      — Oracle NetSuite REST adapter (SuiteQL + REST Record API) — second
    dynamics365.py   — Microsoft Dynamics 365 Business Central REST adapter
    sage_intacct.py  — Sage Intacct XML Web Services adapter
    myob.py          — MYOB AccountRight API adapter
```

The `accounting_sync_push` Celery task calls:
```python
adapter_class = {
    'xero':         XeroAdapter,
    'netsuite':     NetSuiteAdapter,
    'dynamics365':  Dynamics365Adapter,
    'sage_intacct': SageIntacctAdapter,
    'myob':         MYOBAdapter,
}.get(config.platform)
adapter = adapter_class(config)
```

No other application code references platform names directly.

**Xero** uses the Xero OAuth2 API. Auth via OAuth2 with token refresh. This is the first integration to be fully implemented — it replaces the existing CSV export for Xero-connected marinas and serves as the pattern for all subsequent adapters.

**NetSuite** uses the REST Record API (`/services/rest/record/v1/`) and SuiteQL for reads. Auth via OAuth 1.0a (Token-Based Authentication). Second integration to be implemented; unlocks multi-location superyacht marina networks.

**Dynamics 365 Business Central** uses the OData v4 REST API (`/api/v2.0/` endpoint). Auth via Azure AD OAuth2 client credentials.

**Sage Intacct** uses the XML Web Services gateway (`https://api.intacct.com/ia/xml/xmlgw.phtml`). Auth via session token (company/user/password credentials in `config.credentials`).

**MYOB** uses the AccountRight API v2 (`https://api.myob.com/accountright/`). Auth via OAuth2 with MYOB Developer portal client credentials.

---

## 7. Implementation Steps (ordered — respect migration dependencies)

> Steps are ordered to respect Django migration and architectural dependencies. Do not reorder.

1. **Create `CostCentre` and `Account` models** — no FK dependencies on other new models. Run migration.

2. **Create `JournalEntry` and `JournalEntryLine` models** — depend on `Account` and `CostCentre`. Run migration.

3. **Create `Currency` and `ExchangeRate` models** — standalone. Run migration.

4. **Create `MemberCreditAccount` and `MemberCreditTransaction` models** — depend on existing `Invoice`. Run migration. Seed one `MemberCreditAccount` per existing member (balance=0) via a `RunPython` data migration.

5. **Create `SurchargeRule` model** — depends on `ChargeableItem` and `Account`. Run migration.

6. **Create `PaymentPlan` and `PaymentPlanInstalment` models** — depend on existing `Invoice`, `Booking`, `Member`. Run migration.

7. **Create `DeferredRevenueEntry` and `DeferredRevenueRecognitionLog` models** — depend on `Account`, `Invoice`. Run migration.

8. **Add `fuel_dock_type = 'red_diesel'` to `FuelDockEntry.FUEL_TYPE_CHOICES`** — additive change to existing `fuel_dock` app. Run migration. Verify existing POS items are unaffected.

9. **Create `FuelDutyRate`, `RedDieselSaleDeclaration`, `HMRCFuelDutyReturn` models** — depend on `FuelDockEntry`. Run migration.

10. **Create `Supplier`, `APPurchaseOrder`, `APInvoice`, `APInvoiceLineItem` models** — depend on `Account`, `CostCentre`, `JournalEntry`. Run migration. The OCR webhook normaliser must attempt to extract individual line items from the raw document and create `APInvoiceLineItem` rows with `account=null` for any it cannot resolve automatically.

11. **Create `AccountingIntegrationConfig` and `AccountingSyncRecord` models** — standalone. Run migration.

12. **Create `CostCentreBudget` model** — depends on `CostCentre` and `Account`. Run migration.

13. **Add `cost_centre` FK to `ChargeableItem`** (nullable, `on_delete=SET_NULL`) — links revenue items to cost centres. Run migration.

14. **Implement GL posting service** (`billing/services/gl_posting.py`) — functions: `post_invoice_gl()`, `post_payment_gl()`, `post_credit_note_gl()`, `post_ap_invoice_gl()`. Wire via Django `post_save` signal on `Invoice` and `Payment`. Trigger `post_ap_invoice_gl()` from the `approve` action (not on draft creation). Write unit tests first.

    **`post_ap_invoice_gl()` line-item iteration rule:** The function must iterate over `ap_invoice.line_items.all()` to generate one debit `JournalEntryLine` per `APInvoiceLineItem`, each carrying the line's `account` and `cost_centre`. The single credit leg is posted to the AP control account for the full invoice total. Never post a single debit for `APInvoice.subtotal` — that collapses multi-account, multi-cost-centre invoices into a single GL line and makes cost-centre P&L meaningless.

    **Base-currency conversion rule (enforced in every posting function):** When creating a `JournalEntryLine`, always compute:
    ```python
    debit  = (foreign_debit  * fx_rate).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    credit = (foreign_credit * fx_rate).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
    ```
    Store the raw transaction-currency amounts in `amount_foreign_debit` / `amount_foreign_credit`. When the transaction currency equals the base currency, `fx_rate=1.0` and the foreign fields may be left null. Never store unconverted foreign amounts in `debit` / `credit`. The Trial Balance report queries only `debit` and `credit` — no FX multiplication is performed at reporting time.

15. **Implement `credit_auto_deduct` Celery task** — dispatched by `post_save` signal on `Invoice`. Applies full or partial credit balance; sends Stripe payment link for any remainder. Write unit tests.

16. **Seed default Chart of Accounts** — a `RunPython` migration (or management command) that inserts a standard marina chart of accounts for each existing marina: Debtors (Asset), Deferred Revenue (Liability), Berth Revenue (Revenue), Fuel Revenue (Revenue), etc.

17. **Configure Celery + Redis** — add `celery.py`, `tasks.py`, and Celery Beat schedule. Implement `instalment_processor`, `deferred_revenue_recogniser`, `hmrc_duty_period_aggregator` (gated by `marina.hmrc_fuel_duty_enabled`), `fx_rate_updater`, and `accounting_sync_push` tasks (see Section 3).

    **Wire deferred revenue cancellation hook:** Add a Django `post_save` signal on `Booking` that fires when `status` transitions to `cancelled`. If the booking has a linked `DeferredRevenueEntry` (via `entry.invoice.booking`), call `adjust_deferred_entry(entry, refunded_amount)` synchronously before returning the API response. Add a second signal on the refund processing path (`Invoice` when a credit note or refund is posted) for the same purpose. Write integration tests: cancel an annual booking in month 6, verify the recogniser posts zero revenue in months 7–12.

18. **Implement API ViewSets and serializers** — in the order of Section 4. Each group of endpoints can be implemented as one PR.

19. **Implement accounting adapter base class and Xero adapter** — implement `XeroAdapter` first as the pattern adapter; ship stub implementations for the remaining adapters in the same PR.

20. **Build frontend screens** — in parallel with Step 18 (different developer or branch). Add `Finance` sidebar group, implement screens in the order of Section 5.2.

21. **Implement portal self-service top-up** — `POST /api/v1/portal/credit/top-up/` using existing Stripe integration pattern from the portal app.

22. **Report endpoints and PDF export** — implement after all GL posting is in place so report data is valid. Use WeasyPrint for server-side PDF generation.

23. **Implement NetSuite adapter** — second integration after Xero is battle-tested. Follow the established `AccountingAdapter` pattern exactly.

24. **Integration testing** — end-to-end test: create a seasonal booking → auto-create `DeferredRevenueEntry` → run recogniser → verify GL balance → push to Xero sandbox → verify `AccountingSyncRecord` status=ok.

---

## 8. Onboarding Notes

### Cost centre historical data
When cost centres are first configured, existing `InvoiceLineItem` records will have no cost centre assigned. No backfill script is run. Historical transactions before cost-centre configuration appear as `Unassigned` in all P&L reports. This is intentional — retrospectively guessing cost-centre assignments from `chargeable_item.category` risks corrupting prior-period P&L and is not permitted.

### Deferred revenue opening balances
When Track 4 is deployed, existing seasonal contracts that were paid in advance will have no `DeferredRevenueEntry` records. The marina's accountant enters opening balance entries manually on go-live day using the `POST /api/v1/billing/deferred-revenue/` endpoint (or a dedicated onboarding UI). The automated recognition engine takes over from that point forward. Automated inference of previously recognised amounts from legacy data is not attempted.
