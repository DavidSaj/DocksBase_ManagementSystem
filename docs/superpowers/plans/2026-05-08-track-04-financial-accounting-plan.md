# Track 4 — Financial Accounting: Implementation Plan
Date: 2026-05-08
Spec: `docs/superpowers/specs/2026-05-07-track-04-financial-accounting-design.md`

---

## Overview

Track 4 adds a complete accounting back-office layer to the existing `billing` app without replacing any existing models. All new models live in `billing/models.py` (the spec's default choice). One new package, `django-fernet-fields`, must be added to `requirements.txt` for encrypted credential storage. Celery + Redis is introduced as the async task layer; previously the project used `transaction.on_commit()` with sync functions.

Key invariants enforced throughout:
- `ChargeableItem` is the single source of truth for all pricing and cost-centre assignment.
- `Invoice.total` is never mutated after issue — credit and partial payments are recorded as `Payment` objects; `amount_due` is derived at query time.
- All GL lines carry base-currency amounts; FX conversion happens at posting time, never at reporting time.
- Every background job is idempotent — running it twice on the same day produces the same result.

---

## 1. New App: No separate app needed

All models go in `billing/models.py` as specified. If the file grows unwieldy, split into `billing/models/gl.py`, `billing/models/payment_plans.py`, etc., and re-export from `billing/models/__init__.py`. Do not create a separate Django app.

Exception: the integration adapter modules live in a new sub-package `billing/integrations/`.

---

## 2. Dependencies

### `requirements.txt` addition

```
django-fernet-fields>=0.6
```

Add to the project's `requirements.txt` (or `requirements/base.txt` if split). The package provides `EncryptedJSONField` used by `AccountingIntegrationConfig.credentials`.

Also add (if not already present):
```
celery[redis]>=5.3
redis>=5.0
weasyprint>=60.0
python-dateutil>=2.8
```

### `config/settings/base.py` additions

```python
# Celery
CELERY_BROKER_URL = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
CELERY_RESULT_BACKEND = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
CELERY_TIMEZONE = 'UTC'
CELERY_BEAT_SCHEDULE = {
    'instalment-processor': {
        'task': 'apps.billing.tasks.instalment_processor',
        'schedule': crontab(hour=0, minute=30),
    },
    'deferred-revenue-recogniser': {
        'task': 'apps.billing.tasks.deferred_revenue_recogniser',
        'schedule': crontab(hour=1, minute=0),
    },
    'hmrc-duty-aggregator': {
        'task': 'apps.billing.tasks.hmrc_duty_period_aggregator',
        'schedule': crontab(hour=2, minute=0, day_of_month='31,30,29,28', month_of_year='3,6,9,12'),
    },
    'fx-rate-updater': {
        'task': 'apps.billing.tasks.fx_rate_updater',
        'schedule': crontab(hour=6, minute=0),
    },
    'accounting-sync-push': {
        'task': 'apps.billing.tasks.accounting_sync_push',
        'schedule': crontab(minute='*/15'),
    },
}

# django-fernet-fields
FERNET_KEYS = [os.environ.get('FERNET_KEY', '')]  # generate with: from cryptography.fernet import Fernet; Fernet.generate_key()

# Marina base currency (used as default for new Marina instances)
DEFAULT_BASE_CURRENCY = os.environ.get('DEFAULT_BASE_CURRENCY', 'EUR')

# HMRC feature flag default (off for non-UK marinas)
# Per-marina field: marina.hmrc_fuel_duty_enabled (see Step 3)

# DD retry config default
DD_RETRY_DAYS_DEFAULT = 3
```

Add `from celery.schedules import crontab` at the top of settings.

### New file: `backend/config/celery.py`

```python
import os
from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.base')
app = Celery('docksbase')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()
```

Update `backend/config/__init__.py`:
```python
from .celery import app as celery_app
__all__ = ('celery_app',)
```

---

## 3. Marina model additions (`accounts/models.py`)

Add the following fields to the existing `Marina` model:

```python
# backend/apps/accounts/models.py — additions to Marina

# Accounting
hmrc_fuel_duty_enabled = models.BooleanField(default=False)
dd_retry_days          = models.PositiveIntegerField(default=3)  # days between direct debit retries
base_currency          = models.CharField(max_length=3, default='EUR')  # ISO 4217; locked after first JE
```

Migration filename: `accounts/migrations/0XXX_add_marina_accounting_fields.py`

---

## 4. Models (`billing/models.py` additions)

Add all models in the order below to respect FK dependencies. Import `EncryptedJSONField` at the top of the file:

```python
from fernet_fields import EncryptedJSONField
from django.db.models import Q, CheckConstraint, F, Sum
from django.core.exceptions import ValidationError
```

### 4.1 `CostCentre` and `CostCentreBudget`

Add first — referenced by `Account`, `JournalEntryLine`, `ChargeableItem`, `APInvoiceLineItem`.

```python
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
```

`CostCentreBudget` — add after `Account` is defined (FK to `Account`). See §4.2.

### 4.2 `Account` (Chart of Accounts) and `CostCentreBudget`

```python
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
    parent        = models.ForeignKey('self', null=True, blank=True, on_delete=models.SET_NULL, related_name='children')
    is_active     = models.BooleanField(default=True)
    cost_centre   = models.ForeignKey(CostCentre, null=True, blank=True, on_delete=models.SET_NULL, related_name='accounts')
    external_code = models.CharField(max_length=100, blank=True)

    class Meta:
        unique_together = [('marina', 'code')]
        ordering = ['code']

    def __str__(self):
        return f'{self.code} — {self.name}'


class CostCentreBudget(models.Model):
    cost_centre     = models.ForeignKey(CostCentre, on_delete=models.CASCADE, related_name='budgets')
    period          = models.CharField(max_length=7)   # "YYYY-MM"
    account         = models.ForeignKey(Account, on_delete=models.CASCADE, related_name='budgets')
    budgeted_amount = models.DecimalField(max_digits=14, decimal_places=2)

    class Meta:
        unique_together = [('cost_centre', 'period', 'account')]
        ordering = ['period', 'cost_centre']
```

### 4.3 `JournalEntry` and `JournalEntryLine`

```python
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

    marina      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='journal_entries')
    entry_date  = models.DateField()
    source_type = models.CharField(max_length=40, choices=SourceType.choices)
    source_id   = models.IntegerField(null=True, blank=True, db_index=True)
    reference   = models.CharField(max_length=100, blank=True)
    description = models.TextField(blank=True)
    currency    = models.CharField(max_length=3, default='EUR')
    fx_rate     = models.DecimalField(max_digits=14, decimal_places=6, default=1.0)
    created_at  = models.DateTimeField(auto_now_add=True)
    created_by  = models.ForeignKey('staff.StaffMember', null=True, blank=True, on_delete=models.SET_NULL)
    is_posted   = models.BooleanField(default=True)

    def save(self, *args, **kwargs):
        # Guard: a posted journal entry is immutable
        if self.pk and self.is_posted:
            # Re-fetch from DB to confirm it was already posted before this save call
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
    entry                = models.ForeignKey(JournalEntry, on_delete=models.CASCADE, related_name='lines')
    account              = models.ForeignKey(Account, on_delete=models.PROTECT, related_name='journal_lines')
    debit                = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    credit               = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    amount_foreign_debit = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    amount_foreign_credit= models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    description          = models.CharField(max_length=255, blank=True)
    cost_centre          = models.ForeignKey(CostCentre, null=True, blank=True, on_delete=models.SET_NULL)

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

### 4.4 `Currency` and `ExchangeRate`

```python
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
    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='exchange_rates')
    from_currency = models.CharField(max_length=3)
    to_currency   = models.CharField(max_length=3)
    rate          = models.DecimalField(max_digits=14, decimal_places=6)
    rate_date     = models.DateField()
    source        = models.CharField(max_length=50, blank=True)  # 'ecb', 'openexchangerates', 'manual'

    class Meta:
        unique_together = [('marina', 'from_currency', 'to_currency', 'rate_date')]
        ordering = ['-rate_date']
```

### 4.5 `MemberCreditAccount` and `MemberCreditTransaction`

> Note: `loyalty/models.py` currently has `MemberCreditAccount` and `CreditTransaction`. Track 4 creates the canonical versions in `billing/models.py`. After Track 4 is deployed, the loyalty versions should be deprecated (a later cleanup migration can rename or drop them — do not delete them in this track to avoid breaking existing views).

```python
class MemberCreditAccount(models.Model):
    """
    One record per marina-member pair. Balance is the running total of credits minus debits.
    Use select_for_update() before any balance read-modify-write.
    """
    marina          = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='member_credit_accounts')
    member          = models.ForeignKey('members.Member', on_delete=models.CASCADE, related_name='credit_account')
    balance         = models.DecimalField(max_digits=12, decimal_places=2, default=0)
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

    credit_account        = models.ForeignKey(MemberCreditAccount, on_delete=models.CASCADE, related_name='transactions')
    transaction_type      = models.CharField(max_length=30, choices=TransactionType.choices)
    amount                = models.DecimalField(max_digits=12, decimal_places=2)
    direction             = models.CharField(max_length=6, choices=[('credit', 'Credit'), ('debit', 'Debit')])
    balance_after         = models.DecimalField(max_digits=12, decimal_places=2)
    invoice               = models.ForeignKey('Invoice', null=True, blank=True, on_delete=models.SET_NULL)
    payment_method        = models.CharField(max_length=30, blank=True)
    stripe_payment_intent = models.CharField(max_length=200, blank=True)
    notes                 = models.CharField(max_length=500, blank=True)
    recorded_by           = models.ForeignKey('staff.StaffMember', null=True, blank=True, on_delete=models.SET_NULL)
    created_at            = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']
```

### 4.6 `SurchargeRule`

```python
class SurchargeRule(models.Model):
    class TriggerType(models.TextChoices):
        PAYMENT_METHOD  = 'payment_method',  'Payment Method (e.g. card fee)'
        CHARGEABLE_ITEM = 'chargeable_item', 'Specific Chargeable Item'
        CATEGORY        = 'category',        'Chargeable Item Category'

    class AmountType(models.TextChoices):
        PERCENTAGE = 'percentage', 'Percentage'
        FLAT       = 'flat',       'Flat Amount'

    marina            = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='surcharge_rules')
    name              = models.CharField(max_length=200)
    trigger_type      = models.CharField(max_length=30, choices=TriggerType.choices)
    payment_method    = models.CharField(max_length=30, blank=True)
    chargeable_item   = models.ForeignKey('ChargeableItem', null=True, blank=True, on_delete=models.SET_NULL)
    item_category     = models.CharField(max_length=20, blank=True, choices=ChargeableItem.Category.choices)
    amount_type       = models.CharField(max_length=20, choices=AmountType.choices)
    amount            = models.DecimalField(max_digits=8, decimal_places=4)
    description_label = models.CharField(max_length=200, default='Surcharge')
    is_active         = models.BooleanField(default=True)
    gl_account        = models.ForeignKey(Account, null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        ordering = ['name']
```

### 4.7 `PaymentPlan` and `PaymentPlanInstalment`

```python
class PaymentPlan(models.Model):
    class Status(models.TextChoices):
        ACTIVE    = 'active',    'Active'
        COMPLETED = 'completed', 'Completed'
        CANCELLED = 'cancelled', 'Cancelled'
        PAUSED    = 'paused',    'Paused'

    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='payment_plans')
    member        = models.ForeignKey('members.Member', on_delete=models.SET_NULL, null=True, blank=True, related_name='payment_plans')
    booking       = models.ForeignKey('reservations.Booking', null=True, blank=True, on_delete=models.SET_NULL, related_name='payment_plans')
    name          = models.CharField(max_length=200)
    total_amount  = models.DecimalField(max_digits=12, decimal_places=2)
    status        = models.CharField(max_length=20, choices=Status.choices, default=Status.ACTIVE)
    auto_issue    = models.BooleanField(default=True)
    dd_mandate_ref  = models.CharField(max_length=100, blank=True)
    dd_advance_days = models.PositiveIntegerField(default=3)
    created_at    = models.DateTimeField(auto_now_add=True)
    created_by    = models.ForeignKey('staff.StaffMember', null=True, blank=True, on_delete=models.SET_NULL)

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

    plan           = models.ForeignKey(PaymentPlan, on_delete=models.CASCADE, related_name='instalments')
    sequence       = models.PositiveSmallIntegerField()
    due_date       = models.DateField()
    amount         = models.DecimalField(max_digits=12, decimal_places=2)
    status         = models.CharField(max_length=20, choices=Status.choices, default=Status.SCHEDULED)
    invoice        = models.OneToOneField('Invoice', null=True, blank=True, on_delete=models.SET_NULL, related_name='plan_instalment')
    retry_count    = models.PositiveSmallIntegerField(default=0)
    last_retry_at  = models.DateTimeField(null=True, blank=True)
    failure_reason = models.TextField(blank=True)
    notified_at    = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = [('plan', 'sequence')]
        ordering = ['due_date']
```

### 4.8 `DeferredRevenueEntry` and `DeferredRevenueRecognitionLog`

```python
class DeferredRevenueEntry(models.Model):
    class RevenueType(models.TextChoices):
        SEASONAL_BERTH = 'seasonal_berth', 'Seasonal Berth Pre-Payment'
        ANNUAL_BERTH   = 'annual_berth',   'Annual Berth Pre-Payment'
        GIFT_VOUCHER   = 'gift_voucher',   'Gift Voucher'
        DEPOSIT        = 'deposit',        'Event / Service Deposit'
        OTHER          = 'other',          'Other Advance Payment'

    marina               = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='deferred_revenue')
    member               = models.ForeignKey('members.Member', null=True, blank=True, on_delete=models.SET_NULL)
    invoice              = models.ForeignKey('Invoice', null=True, blank=True, on_delete=models.SET_NULL)
    revenue_type         = models.CharField(max_length=30, choices=RevenueType.choices)
    description          = models.CharField(max_length=255)
    total_amount         = models.DecimalField(max_digits=12, decimal_places=2)
    earned_amount        = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    deferred_amount      = models.DecimalField(max_digits=12, decimal_places=2)
    service_start        = models.DateField()
    service_end          = models.DateField()
    gl_deferred_account  = models.ForeignKey(Account, null=True, blank=True, on_delete=models.SET_NULL, related_name='deferred_entries')
    gl_earned_account    = models.ForeignKey(Account, null=True, blank=True, on_delete=models.SET_NULL, related_name='earned_entries')
    is_fully_recognised  = models.BooleanField(default=False)
    cancelled_at         = models.DateTimeField(null=True, blank=True)
    refunded_amount      = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    created_at           = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-created_at']

    def __str__(self):
        return f'Deferred {self.description} — {self.deferred_amount} remaining'


class DeferredRevenueRecognitionLog(models.Model):
    """Immutable. One row per nightly job run per entry. get_or_create for idempotency."""
    deferred_entry    = models.ForeignKey(DeferredRevenueEntry, on_delete=models.CASCADE, related_name='recognition_logs')
    recognition_date  = models.DateField()
    amount_recognised = models.DecimalField(max_digits=12, decimal_places=2)
    journal_entry     = models.ForeignKey(JournalEntry, null=True, blank=True, on_delete=models.SET_NULL)
    created_at        = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('deferred_entry', 'recognition_date')]
        ordering = ['-recognition_date']
```

### 4.9 `FuelDutyRate`, `RedDieselSaleDeclaration`, `HMRCFuelDutyReturn`

> Prerequisite: add `'red_diesel'` to `FuelDockEntry.FUEL_TYPE_CHOICES` in `fuel_dock/models.py`.

```python
class FuelDutyRate(models.Model):
    class UseType(models.TextChoices):
        PROPULSION     = 'propulsion',     'Propulsion (higher rate for red diesel)'
        NON_PROPULSION = 'non_propulsion', 'Non-Propulsion / Heating (rebated rate)'

    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='fuel_duty_rates')
    fuel_type      = models.CharField(max_length=20)
    use_type       = models.CharField(max_length=20, choices=UseType.choices)
    duty_rate      = models.DecimalField(max_digits=10, decimal_places=6)
    effective_from = models.DateField()
    effective_to   = models.DateField(null=True, blank=True)
    is_active      = models.BooleanField(default=True)

    class Meta:
        ordering = ['-effective_from']


class RedDieselSaleDeclaration(models.Model):
    fuel_dock_entry       = models.OneToOneField('fuel_dock.FuelDockEntry', on_delete=models.CASCADE, related_name='red_diesel_declaration')
    propulsion_litres     = models.DecimalField(max_digits=10, decimal_places=3)
    non_propulsion_litres = models.DecimalField(max_digits=10, decimal_places=3)
    propulsion_duty       = models.DecimalField(max_digits=10, decimal_places=2)
    non_propulsion_duty   = models.DecimalField(max_digits=10, decimal_places=2)
    declaration_by        = models.CharField(max_length=200, blank=True)
    declaration_date      = models.DateField()
    duty_period           = models.CharField(max_length=7, db_index=True)

    class Meta:
        ordering = ['-declaration_date']


class HMRCFuelDutyReturn(models.Model):
    class ReturnStatus(models.TextChoices):
        DRAFT     = 'draft',     'Draft'
        FINALISED = 'finalised', 'Finalised'
        SUBMITTED = 'submitted', 'Submitted to HMRC'

    marina                      = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='hmrc_returns')
    duty_period                 = models.CharField(max_length=7)
    period_start                = models.DateField()
    period_end                  = models.DateField()
    total_litres_sold           = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    propulsion_litres           = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    non_propulsion_litres       = models.DecimalField(max_digits=14, decimal_places=3, default=0)
    propulsion_duty_payable     = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    non_propulsion_duty_payable = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_duty_payable          = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status                      = models.CharField(max_length=20, choices=ReturnStatus.choices, default=ReturnStatus.DRAFT)
    generated_at                = models.DateTimeField(auto_now_add=True)
    submitted_at                = models.DateTimeField(null=True, blank=True)
    submission_ref              = models.CharField(max_length=100, blank=True)

    class Meta:
        unique_together = [('marina', 'duty_period')]
        ordering = ['-period_start']
```

### 4.10 `Supplier`, `APPurchaseOrder`, `APInvoice`, `APInvoiceLineItem`

```python
class Supplier(models.Model):
    marina        = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='suppliers')
    name          = models.CharField(max_length=200)
    contact_email = models.EmailField(blank=True)
    payment_terms = models.PositiveIntegerField(default=30)
    gl_account    = models.ForeignKey(Account, null=True, blank=True, on_delete=models.SET_NULL)
    external_id   = models.CharField(max_length=100, blank=True)
    is_active     = models.BooleanField(default=True)

    class Meta:
        ordering = ['name']


class APPurchaseOrder(models.Model):
    class Status(models.TextChoices):
        OPEN     = 'open',     'Open'
        RECEIVED = 'received', 'Goods Received'
        INVOICED = 'invoiced', 'Invoiced'
        CLOSED   = 'closed',   'Closed'

    marina            = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='purchase_orders')
    supplier          = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name='purchase_orders')
    po_number         = models.CharField(max_length=50)
    issue_date        = models.DateField()
    expected_delivery = models.DateField(null=True, blank=True)
    total_amount      = models.DecimalField(max_digits=12, decimal_places=2)
    status            = models.CharField(max_length=20, choices=Status.choices, default=Status.OPEN)
    created_by        = models.ForeignKey('staff.StaffMember', null=True, blank=True, on_delete=models.SET_NULL)
    created_at        = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = [('marina', 'po_number')]
        ordering = ['-issue_date']


class APInvoice(models.Model):
    class Status(models.TextChoices):
        DRAFT       = 'draft',       'Draft — Awaiting Review'
        MATCHED     = 'matched',     'Three-Way Matched'
        DISCREPANCY = 'discrepancy', 'Matching Discrepancy — On Hold'
        APPROVED    = 'approved',    'Approved for Payment'
        PAID        = 'paid',        'Paid'
        DISPUTED    = 'disputed',    'Disputed'
        VOID        = 'void',        'Void'

    marina                 = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='ap_invoices')
    supplier               = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name='invoices')
    supplier_invoice_number= models.CharField(max_length=100)
    invoice_date           = models.DateField()
    due_date               = models.DateField()
    currency               = models.CharField(max_length=3, default='EUR')
    subtotal               = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    tax_amount             = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    total_amount           = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    status                 = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    ocr_service            = models.CharField(max_length=50, blank=True)
    ocr_document_id        = models.CharField(max_length=200, blank=True)
    ocr_confidence         = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    raw_document           = models.FileField(upload_to='ap_invoices/', null=True, blank=True)
    purchase_order         = models.ForeignKey(APPurchaseOrder, null=True, blank=True, on_delete=models.SET_NULL, related_name='invoices')
    match_status           = models.CharField(max_length=30, blank=True)
    match_variance         = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    approved_by            = models.ForeignKey('staff.StaffMember', null=True, blank=True, on_delete=models.SET_NULL)
    approved_at            = models.DateTimeField(null=True, blank=True)
    created_at             = models.DateTimeField(auto_now_add=True)
    journal_entry          = models.OneToOneField(JournalEntry, null=True, blank=True, on_delete=models.SET_NULL)

    class Meta:
        ordering = ['-invoice_date']
        unique_together = [('marina', 'supplier', 'supplier_invoice_number')]


class APInvoiceLineItem(models.Model):
    ap_invoice      = models.ForeignKey(APInvoice, on_delete=models.CASCADE, related_name='line_items')
    description     = models.CharField(max_length=255)
    quantity        = models.DecimalField(max_digits=10, decimal_places=4, default=1)
    unit_price      = models.DecimalField(max_digits=12, decimal_places=2)
    line_total      = models.DecimalField(max_digits=12, decimal_places=2)
    tax_amount      = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    account         = models.ForeignKey(Account, null=True, blank=True, on_delete=models.SET_NULL, related_name='ap_line_items')
    cost_centre     = models.ForeignKey(CostCentre, null=True, blank=True, on_delete=models.SET_NULL, related_name='ap_line_items')
    ocr_description = models.CharField(max_length=500, blank=True)
    position        = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ['ap_invoice', 'position']
```

### 4.11 `AccountingIntegrationConfig` and `AccountingSyncRecord`

```python
class AccountingIntegrationConfig(models.Model):
    class Platform(models.TextChoices):
        XERO         = 'xero',         'Xero'
        NETSUITE     = 'netsuite',     'Oracle NetSuite'
        DYNAMICS_365 = 'dynamics365',  'Microsoft Dynamics 365 Business Central'
        SAGE_INTACCT = 'sage_intacct', 'Sage Intacct'
        MYOB         = 'myob',         'MYOB'

    marina         = models.ForeignKey('accounts.Marina', on_delete=models.CASCADE, related_name='accounting_configs')
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

    config       = models.ForeignKey(AccountingIntegrationConfig, on_delete=models.CASCADE, related_name='sync_records')
    direction    = models.CharField(max_length=10, choices=Direction.choices)
    object_type  = models.CharField(max_length=20, choices=ObjectType.choices)
    local_id     = models.IntegerField(db_index=True)
    external_id  = models.CharField(max_length=200, blank=True)
    status       = models.CharField(max_length=20)
    error_detail = models.TextField(blank=True)
    synced_at    = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['-synced_at']
```

### 4.12 `ChargeableItem` addition: `cost_centre` FK

Add to the existing `ChargeableItem` model:
```python
cost_centre = models.ForeignKey(
    'CostCentre', null=True, blank=True, on_delete=models.SET_NULL,
    related_name='chargeable_items'
)
```
Migration: additive nullable FK — no data migration needed.

### 4.13 `Invoice` addition: `billing_contact` FK (Track 3/4 shared)

Add to the existing `Invoice` model (can be included in any billing migration):
```python
billing_contact = models.ForeignKey(
    'members.SecondaryContact', on_delete=models.SET_NULL,
    null=True, blank=True, related_name='billed_invoices',
    help_text='When set, invoice PDF uses this contact\'s details in the Bill To block instead of the member\'s PII.',
)
```

---

## 5. Service Layer

### File: `backend/apps/billing/services/gl_posting.py`

All GL posting functions live here. All functions build and write journal entries atomically.

**Base-currency conversion rule (enforced in every function):**
```python
from decimal import Decimal, ROUND_HALF_UP

def _to_base(amount: Decimal, fx_rate: Decimal) -> Decimal:
    return (amount * fx_rate).quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)
```

#### `post_invoice_gl(invoice) -> JournalEntry`
```
Dr Debtors (Asset)              invoice.total
    Cr Revenue accounts (per line item account)    each line.total_price
    Cr VAT Liability (if applicable)               invoice.tax_total
```
- Source_type = `'invoice'`, `source_id = invoice.pk`.
- Look up `Account` for each `InvoiceLineItem` via `line.chargeable_item.cost_centre → Account`. Fall back to a configurable default Revenue account if no cost_centre/account is mapped.
- One `JournalEntryLine` per revenue account grouping (or per line item if different accounts).

#### `post_payment_gl(payment) -> JournalEntry`
```
Dr Bank/Cash (Asset)        payment.amount
    Cr Debtors (Asset)          payment.amount
```
- `source_type = 'payment'`, `source_id = payment.pk`.

#### `post_credit_note_gl(invoice, amount) -> JournalEntry`
Reverse of `post_invoice_gl` for the credited amount.

#### `post_ap_invoice_gl(ap_invoice) -> JournalEntry`
```
Dr [account per APInvoiceLineItem]   line.line_total  (one debit per line)
    Cr AP Control Account                ap_invoice.total_amount  (one credit)
```
- Iterates `ap_invoice.line_items.all()`. Never uses `ap_invoice.subtotal` as sole debit.
- Each debit line carries `cost_centre` from `APInvoiceLineItem.cost_centre`.
- Blocked if any line item has `account=None` (enforced at view level before calling this).

#### `post_deferred_refund_gl(entry, refunded_amount) -> JournalEntry`
```
Dr Deferred Revenue (Liability)   refunded_amount
    Cr Debtors / Bank                 refunded_amount
```
Called synchronously from booking cancellation and invoice refund flows.

### File: `backend/apps/billing/services/deferred_revenue.py`

#### `adjust_deferred_entry(entry: DeferredRevenueEntry, refunded_amount: Decimal) -> None`
Exact implementation from spec §3.2:
```python
def adjust_deferred_entry(entry, refunded_amount):
    from django.utils.timezone import now
    with transaction.atomic():
        entry.refunded_amount += refunded_amount
        entry.total_amount    -= refunded_amount
        entry.deferred_amount  = max(entry.total_amount - entry.earned_amount, Decimal('0.00'))
        if entry.deferred_amount <= 0:
            entry.is_fully_recognised = True
            entry.cancelled_at = now()
        entry.save(update_fields=[
            'refunded_amount', 'total_amount', 'deferred_amount',
            'is_fully_recognised', 'cancelled_at'
        ])
        from apps.billing.services.gl_posting import post_deferred_refund_gl
        post_deferred_refund_gl(entry, refunded_amount)
```

### File: `backend/apps/billing/services/payment_plans.py`

#### `distribute_evenly(total: Decimal, count: int) -> list[Decimal]`
```python
from decimal import Decimal, ROUND_DOWN

def distribute_evenly(total: Decimal, count: int) -> list[Decimal]:
    base      = (total / count).quantize(Decimal('0.01'), rounding=ROUND_DOWN)
    shortfall = total - base * count
    amounts   = [base] * count
    amounts[-1] += shortfall
    return amounts
```

#### `create_payment_plan(marina, member, booking, name, total_amount, auto_issue, dd_mandate_ref, instalments_data, created_by) -> PaymentPlan`
- Validates `sum(instalments) == total_amount`.
- Validates `due_date`s are unique and ascending.
- Creates `PaymentPlan` + all `PaymentPlanInstalment` objects in one `transaction.atomic()` block.

#### `issue_instalment_invoice(instalment: PaymentPlanInstalment) -> Invoice`
Creates an `Invoice` with one line item describing the instalment. Sets `instalment.status = 'invoiced'`, links `instalment.invoice`. Called by `instalment_processor` task and the manual `issue-invoice` endpoint.

### File: `backend/apps/billing/services/credit.py`

#### `top_up_credit(member, marina, amount, payment_method='', stripe_payment_intent='', recorded_by=None) -> MemberCreditTransaction`
Uses `select_for_update()` on `MemberCreditAccount`.

#### `deduct_credit(member, marina, amount, invoice=None, transaction_type='manual_deduct', recorded_by=None) -> MemberCreditTransaction`
Uses `select_for_update()`. Raises `ValueError` if balance < amount.

#### `auto_deduct_on_invoice(invoice) -> MemberCreditTransaction | None`
Called by Celery task `credit_auto_deduct`. Logic per spec §3.6:
1. Check `MemberCreditAccount` for member with `auto_deduct=True`.
2. Full coverage: deduct balance, mark invoice paid, post GL.
3. Partial coverage: deduct available, create `Payment` for partial amount, send Stripe payment link for remainder. Never alter `Invoice.total`.

---

## 6. Signals

### File: `backend/apps/billing/signals.py` (add to existing)

#### Signal: post GL on Invoice save (status → `unpaid`)
```python
@receiver(post_save, sender=Invoice)
def post_invoice_to_gl(sender, instance, created, **kwargs):
    if instance.status == 'unpaid':
        # Use transaction.on_commit to avoid posting before the save commits
        from apps.billing.services.gl_posting import post_invoice_gl
        transaction.on_commit(lambda: post_invoice_gl(instance))
        # Also dispatch credit_auto_deduct Celery task
        from apps.billing.tasks import credit_auto_deduct
        transaction.on_commit(lambda: credit_auto_deduct.delay(instance.pk))
```

#### Signal: post GL on Payment save
```python
@receiver(post_save, sender=Payment)
def post_payment_to_gl(sender, instance, created, **kwargs):
    if not created:
        return
    from apps.billing.services.gl_posting import post_payment_gl
    transaction.on_commit(lambda: post_payment_gl(instance))
```

#### Signal: adjust deferred entry on Booking cancellation
```python
@receiver(post_save, sender='reservations.Booking')
def handle_booking_cancellation(sender, instance, **kwargs):
    if instance.status == 'cancelled':
        from apps.billing.models import DeferredRevenueEntry
        from apps.billing.services.deferred_revenue import adjust_deferred_entry
        entries = DeferredRevenueEntry.objects.filter(
            invoice__booking=instance,
            is_fully_recognised=False,
            cancelled_at__isnull=True,
        )
        for entry in entries:
            # refunded_amount = entry.deferred_amount (remaining unrecognised portion)
            adjust_deferred_entry(entry, entry.deferred_amount)
```

---

## 7. Celery Tasks (`billing/tasks.py`)

### `instalment_processor` (nightly, 00:30)
```python
@app.task(bind=True, max_retries=3)
def instalment_processor(self):
    from django.utils import timezone
    from apps.billing.models import PaymentPlanInstalment, PaymentPlan
    today = timezone.now().date()

    # Step 1: Send advance notices
    with transaction.atomic():
        qs = PaymentPlanInstalment.objects.select_for_update(skip_locked=True).filter(
            status='scheduled',
            due_date__lte=today + timedelta(days=F('plan__dd_advance_days')),
        ).select_related('plan')
        for instalment in qs:
            _send_advance_notice(instalment)
            instalment.status = 'notified'
            instalment.notified_at = timezone.now()
            instalment.save(update_fields=['status', 'notified_at'])

    # Step 2: Issue invoices for due instalments
    with transaction.atomic():
        qs = PaymentPlanInstalment.objects.select_for_update(skip_locked=True).filter(
            status__in=['scheduled', 'notified'],
            due_date__lte=today,
        ).select_related('plan')
        for instalment in qs:
            if instalment.plan.auto_issue:
                from apps.billing.services.payment_plans import issue_instalment_invoice
                issue_instalment_invoice(instalment)
            else:
                _notify_manager_approval(instalment)
            # Attempt Stripe DD charge if mandate exists
            if instalment.plan.dd_mandate_ref:
                _attempt_dd_charge(instalment)
```

`_attempt_dd_charge`: on Stripe failure, increment `retry_count`, set `last_retry_at`, schedule Celery retry with `countdown = plan.marina.dd_retry_days * 86400`. On second failure: `status='failed'`.

### `deferred_revenue_recogniser` (nightly, 01:00)
```python
@app.task(bind=True)
def deferred_revenue_recogniser(self):
    from django.utils import timezone
    from apps.billing.models import DeferredRevenueEntry, DeferredRevenueRecognitionLog
    from apps.billing.services.gl_posting import post_deferred_recognition_gl
    today = timezone.now().date()
    entries = DeferredRevenueEntry.objects.filter(
        is_fully_recognised=False,
        service_start__lte=today,
        cancelled_at__isnull=True,
    )
    for entry in entries:
        days = max((entry.service_end - entry.service_start).days, 1)
        daily_rate = entry.total_amount / days
        amount = min(daily_rate, entry.deferred_amount).quantize(Decimal('0.01'))
        # Idempotent: get_or_create prevents double-posting on Celery retry
        log, created = DeferredRevenueRecognitionLog.objects.get_or_create(
            deferred_entry=entry,
            recognition_date=today,
            defaults={'amount_recognised': amount},
        )
        if not created:
            continue  # already ran today
        je = post_deferred_recognition_gl(entry, amount, today)
        log.journal_entry = je
        log.save(update_fields=['journal_entry'])
        entry.earned_amount   += amount
        entry.deferred_amount -= amount
        if entry.deferred_amount <= 0:
            entry.is_fully_recognised = True
        entry.save(update_fields=['earned_amount', 'deferred_amount', 'is_fully_recognised'])
```

### `hmrc_duty_period_aggregator` (quarterly, last day of quarter, 02:00)
Only processes marinas where `marina.hmrc_fuel_duty_enabled=True`. Aggregates `RedDieselSaleDeclaration` for the quarter into `HMRCFuelDutyReturn` (upsert by `duty_period`). Sends email to marina accountant.

### `fx_rate_updater` (daily, 06:00 UTC)
For each marina with multiple active `Currency` records, fetch rates from ECB free API. Upsert `ExchangeRate`. Log errors to `AccountingIntegrationConfig.sync_errors` for the marina's integration config (or to a separate log if no config exists).

### `accounting_sync_push` (every 15 minutes)
```python
@app.task(bind=True, max_retries=5, default_retry_delay=60)
def accounting_sync_push(self):
    from apps.billing.models import AccountingIntegrationConfig, AccountingSyncRecord
    configs = AccountingIntegrationConfig.objects.filter(is_active=True)
    for config in configs:
        adapter = _get_adapter(config)
        _push_new_records(adapter, config)
        config.last_synced_at = timezone.now()
        config.save(update_fields=['last_synced_at'])
```
`_push_new_records`: finds `Invoice`, `Payment`, `JournalEntry` created since `last_synced_at` with no `AccountingSyncRecord(status='ok')`. Pushes each. Records `AccountingSyncRecord`. Retries with exponential back-off on `AdapterRetryableError`.

### `credit_auto_deduct` (dispatched by Invoice post_save signal)
```python
@app.task(bind=True, max_retries=3)
def credit_auto_deduct(self, invoice_pk):
    from apps.billing.models import Invoice
    from apps.billing.services.credit import auto_deduct_on_invoice
    invoice = Invoice.objects.get(pk=invoice_pk)
    if invoice.status not in ('unpaid', 'open'):
        return
    auto_deduct_on_invoice(invoice)
```

---

## 8. Integration Adapter Architecture

### File: `backend/apps/billing/integrations/__init__.py`
Empty.

### File: `backend/apps/billing/integrations/base.py`
Exact implementation from spec §6 — `AccountingAdapter` ABC with `test_connection`, `push_invoice`, `push_payment`, `push_journal_entry`, `sync_chart_of_accounts`, `sync_contacts`. Plus `AdapterError` and `AdapterRetryableError`.

### File: `backend/apps/billing/integrations/xero.py`
First integration to implement fully. Uses Xero OAuth2 API. Stores access/refresh tokens in `config.credentials` (encrypted). Token refresh handled transparently in `_get_client()`. Implements all abstract methods.

### Files: `netsuite.py`, `dynamics365.py`, `sage_intacct.py`, `myob.py`
Ship stub implementations in the same PR as Xero. Each raises `NotImplementedError` from all abstract methods with a `"Not yet implemented"` message. This allows the adapter dispatcher to instantiate them safely without crashing.

### Adapter dispatcher in `tasks.py`
```python
from apps.billing.integrations.xero import XeroAdapter
from apps.billing.integrations.netsuite import NetSuiteAdapter
from apps.billing.integrations.dynamics365 import Dynamics365Adapter
from apps.billing.integrations.sage_intacct import SageIntacctAdapter
from apps.billing.integrations.myob import MYOBAdapter

ADAPTER_MAP = {
    'xero':         XeroAdapter,
    'netsuite':     NetSuiteAdapter,
    'dynamics365':  Dynamics365Adapter,
    'sage_intacct': SageIntacctAdapter,
    'myob':         MYOBAdapter,
}

def _get_adapter(config):
    cls = ADAPTER_MAP.get(config.platform)
    if not cls:
        raise ValueError(f'Unknown accounting platform: {config.platform}')
    return cls(config)
```

---

## 9. API Endpoints

All ViewSets are `ModelViewSet` subclasses. All filter by `request.user.marina`. All use `PageNumberPagination` (default page size 50). Register in `billing/urls.py` using DRF `DefaultRouter` for ViewSets; `path()` for action-only views.

### 9.1 Chart of Accounts

```
GET    /api/v1/billing/accounts/
POST   /api/v1/billing/accounts/
PATCH  /api/v1/billing/accounts/{id}/
```
ViewSet: `AccountViewSet`. Filter by `?account_type=`, `?is_active=`, `?cost_centre=`.

### 9.2 Journal Entries

```
GET    /api/v1/billing/journal-entries/
POST   /api/v1/billing/journal-entries/         — creates manual draft (is_posted=False)
POST   /api/v1/billing/journal-entries/{id}/post/   — posts draft; validates debits == credits first
GET    /api/v1/billing/journal-entries/{id}/lines/
```
`post` action: validate `sum(lines.debit) == sum(lines.credit)`. If valid, set `is_posted=True`. Returns `400` with error if imbalanced.

### 9.3 Payment Plans

```
GET    /api/v1/billing/payment-plans/            — ?member=&status=
POST   /api/v1/billing/payment-plans/            — creates plan + all instalments atomically
GET    /api/v1/billing/payment-plans/{id}/
PATCH  /api/v1/billing/payment-plans/{id}/
POST   /api/v1/billing/payment-plans/{id}/cancel/
GET    /api/v1/billing/payment-plans/{id}/instalments/
PATCH  /api/v1/billing/instalments/{id}/         — mark waived / adjust amount
POST   /api/v1/billing/instalments/{id}/issue-invoice/
```
`POST /payment-plans/` request body: validated by `PaymentPlanCreateSerializer` which accepts nested `instalments[]`. Calls `create_payment_plan()` service.

### 9.4 On-Account Credit

```
GET    /api/v1/billing/credit-accounts/
GET    /api/v1/billing/credit-accounts/{member_id}/
POST   /api/v1/billing/credit-accounts/{member_id}/top-up/
POST   /api/v1/billing/credit-accounts/{member_id}/deduct/
PATCH  /api/v1/billing/credit-accounts/{member_id}/      — toggle auto_deduct
GET    /api/v1/billing/credit-accounts/{member_id}/transactions/
POST   /api/v1/portal/credit/top-up/                 — member self-service via Stripe
```

### 9.5 Surcharge Rules

```
GET    /api/v1/billing/surcharge-rules/
POST   /api/v1/billing/surcharge-rules/
PATCH  /api/v1/billing/surcharge-rules/{id}/
```

### 9.6 HMRC Fuel Duty

```
GET    /api/v1/billing/fuel-duty-rates/
POST   /api/v1/billing/fuel-duty-rates/
GET    /api/v1/billing/hmrc-returns/            — ?period=
GET    /api/v1/billing/hmrc-returns/{id}/
POST   /api/v1/billing/hmrc-returns/{id}/finalise/
GET    /api/v1/billing/hmrc-returns/{id}/export/    — CSV/PDF download
POST   /api/v1/fuel-dock/entries/{id}/red-diesel-declaration/
```
All HMRC endpoints return `403` for marinas where `marina.hmrc_fuel_duty_enabled=False`.

### 9.7 Deferred Revenue

```
GET    /api/v1/billing/deferred-revenue/         — ?is_fully_recognised=false
POST   /api/v1/billing/deferred-revenue/
GET    /api/v1/billing/deferred-revenue/{id}/logs/
GET    /api/v1/billing/deferred-revenue/summary/ — aggregate: total deferred, next 30/60/90 day schedule
```

### 9.8 Cost Centres and Budgets

```
GET    /api/v1/billing/cost-centres/
POST   /api/v1/billing/cost-centres/
PATCH  /api/v1/billing/cost-centres/{id}/
GET    /api/v1/billing/cost-centres/{id}/budgets/    — ?period=YYYY-MM
POST   /api/v1/billing/cost-centres/{id}/budgets/    — upsert monthly budget line
GET    /api/v1/billing/cost-centres/{id}/pl/         — P&L ?period_from=&period_to=
GET    /api/v1/billing/cost-centres/{id}/budget-vs-actuals/    — ?period=
```

P&L action: aggregate `JournalEntryLine` by `cost_centre` for the period. Revenue lines (credit on revenue accounts) vs expense lines (debit on expense accounts). Group by account.

### 9.9 AP Invoice Capture

```
GET    /api/v1/billing/suppliers/
POST   /api/v1/billing/suppliers/
PATCH  /api/v1/billing/suppliers/{id}/
GET    /api/v1/billing/ap-invoices/             — ?status=&supplier=
POST   /api/v1/billing/ap-invoices/
PATCH  /api/v1/billing/ap-invoices/{id}/
POST   /api/v1/billing/ap-invoices/{id}/approve/    — blocked 400 if any line has account=null
POST   /api/v1/billing/ap-invoices/{id}/mark-paid/
POST   /api/v1/billing/ap-invoices/{id}/void/
POST   /api/v1/billing/ap-invoices/ocr-webhook/    — generic OCR normaliser
GET    /api/v1/billing/purchase-orders/
POST   /api/v1/billing/purchase-orders/
PATCH  /api/v1/billing/purchase-orders/{id}/
POST   /api/v1/billing/purchase-orders/{id}/receive/
```

`approve` action: validates all `APInvoiceLineItem.account` are non-null. Calls `post_ap_invoice_gl(ap_invoice)`. Returns `400` if any line unmapped.

`ocr-webhook`: accepts provider-agnostic payload. Normalises to `APInvoice` draft fields using a `NORMALISER_MAP` dict keyed by `X-OCR-Provider` header. Creates `APInvoice` + `APInvoiceLineItem` records (with `account=None` for unresolved lines).

### 9.10 Reports

```
GET    /api/v1/reports/balance-sheet/           — ?as_of_date=YYYY-MM-DD[&format=pdf]
GET    /api/v1/reports/profit-and-loss/         — ?period_from=&period_to=&compare_prior=true[&format=pdf]
GET    /api/v1/reports/cash-flow/               — ?period_from=&period_to=[&format=pdf]
GET    /api/v1/reports/cash-forecast/           — rolling 8-week forward view
GET    /api/v1/reports/deferred-revenue/        — liability schedule
GET    /api/v1/reports/cost-centre-pl/          — all cost centres any period
```

`?format=pdf`: renders via WeasyPrint. Template files:
- `billing/templates/billing/reports/balance_sheet.html`
- `billing/templates/billing/reports/profit_and_loss.html`
- `billing/templates/billing/reports/cash_flow.html`

Balance sheet: aggregates `JournalEntryLine` by `account.account_type`. Assets = sum(debit) - sum(credit) on asset accounts. Liabilities and equity = sum(credit) - sum(debit) on liability/equity accounts.

### 9.11 Accounting Integrations

```
GET    /api/v1/billing/accounting-configs/
POST   /api/v1/billing/accounting-configs/
PATCH  /api/v1/billing/accounting-configs/{id}/
POST   /api/v1/billing/accounting-configs/{id}/sync-now/
POST   /api/v1/billing/accounting-configs/{id}/test/
GET    /api/v1/billing/accounting-configs/{id}/sync-log/
```

`sync-now`: dispatches `accounting_sync_push.delay(config_id)`. Returns `202 Accepted`.
`test`: instantiates adapter, calls `adapter.test_connection()`. Returns `200` or `400` with error.

### 9.12 Multi-Currency

```
GET    /api/v1/billing/currencies/
POST   /api/v1/billing/currencies/
PATCH  /api/v1/billing/currencies/{id}/    — returns 409 if changing is_base after JE exists
GET    /api/v1/billing/exchange-rates/     — ?from_currency=&date=
POST   /api/v1/billing/exchange-rates/     — manual rate override
```

`PATCH currencies/{id}/` with `is_base=true`: check `JournalEntry.objects.filter(marina=marina).exists()`. If yes, return `HTTP 409 Conflict`.

---

## 10. Admin

Register all new models in `billing/admin.py`. Key admin configs:

```python
@admin.register(JournalEntry)
class JournalEntryAdmin(admin.ModelAdmin):
    list_display = ['pk', 'marina', 'entry_date', 'source_type', 'currency', 'is_posted']
    readonly_fields = ['created_at', 'is_posted']  # never editable in admin after posting

    def has_change_permission(self, request, obj=None):
        if obj and obj.is_posted:
            return False
        return super().has_change_permission(request, obj)

@admin.register(PaymentPlan)
class PaymentPlanAdmin(admin.ModelAdmin):
    list_display = ['name', 'marina', 'member', 'total_amount', 'status']
    inlines = [PaymentPlanInstalmentInline]

@admin.register(APInvoice)
class APInvoiceAdmin(admin.ModelAdmin):
    list_display = ['pk', 'marina', 'supplier', 'supplier_invoice_number', 'total_amount', 'status']
    inlines = [APInvoiceLineItemInline]

@admin.register(AccountingIntegrationConfig)
class AccountingIntegrationConfigAdmin(admin.ModelAdmin):
    list_display = ['marina', 'platform', 'is_active', 'last_synced_at']
    # credentials field MUST NOT be displayed in admin — it contains encrypted tokens
    exclude = ['credentials']
```

---

## 11. Settings / URL Wiring

### `config/settings/base.py`

Full additions listed in §2. Also ensure:
```python
THIRD_PARTY_APPS += [
    'fernet_fields',
]
```

### `config/urls.py`

`billing/urls.py` is already included. The new endpoints are all added to `billing/urls.py` and `reports/urls.py` (existing). No new top-level URL file needed unless `reports/urls.py` is separate.

Ensure `fuel_dock/urls.py` is included (for the red diesel declaration endpoint):
```python
path('api/v1/', include('apps.fuel_dock.urls')),
```

Portal credit top-up:
```python
path('api/v1/', include('apps.portal.urls')),  # already included
```
Add `POST /portal/credit/top-up/` to `portal/urls.py`.

---

## 12. Data Migrations (RunPython)

### Migration: Seed default Chart of Accounts for existing marinas
After `Account` model is created. Run as `RunPython` in the billing migration:
```python
DEFAULT_ACCOUNTS = [
    ('1100', 'Trade Debtors',         'asset'),
    ('2100', 'Trade Creditors',       'liability'),
    ('2200', 'VAT Liability',         'liability'),
    ('2300', 'Deferred Revenue',      'liability'),
    ('4100', 'Berth Revenue',         'revenue'),
    ('4200', 'Fuel Revenue',          'revenue'),
    ('4300', 'Service Revenue',       'revenue'),
    ('4400', 'Retail Revenue',        'revenue'),
    ('5100', 'Direct Labour',         'expense'),
    ('5200', 'Fuel Cost of Goods',    'expense'),
    ('6100', 'Admin & General',       'expense'),
]
# For each existing Marina, create these accounts if they don't exist.
```

### Migration: Seed one `MemberCreditAccount` per existing member
After `MemberCreditAccount` model is created:
```python
def seed_credit_accounts(apps, schema_editor):
    Member = apps.get_model('members', 'Member')
    MemberCreditAccount = apps.get_model('billing', 'MemberCreditAccount')
    for member in Member.objects.all():
        MemberCreditAccount.objects.get_or_create(
            marina=member.marina, member=member,
            defaults={'balance': 0, 'auto_deduct': False}
        )
```

### Migration: Add `red_diesel` to `FuelDockEntry.FUEL_TYPE_CHOICES`
This is a model-level choices change only — no database column change. Run `makemigrations fuel_dock` to record it.

---

## 13. Migration Order (respect FK dependencies)

Run `makemigrations` in this order, then `migrate` once at the end:

1. `python manage.py makemigrations accounts` — `hmrc_fuel_duty_enabled`, `dd_retry_days`, `base_currency`.
2. `python manage.py makemigrations fuel_dock` — add `'red_diesel'` to `FUEL_TYPE_CHOICES`.
3. `python manage.py makemigrations billing` — all new models. This single migration file must be created with models in dependency order: `CostCentre` → `Account` → `CostCentreBudget` → `JournalEntry` → `JournalEntryLine` → `Currency` → `ExchangeRate` → `MemberCreditAccount` → `MemberCreditTransaction` → `SurchargeRule` → `PaymentPlan` → `PaymentPlanInstalment` → `DeferredRevenueEntry` → `DeferredRevenueRecognitionLog` → `FuelDutyRate` → `RedDieselSaleDeclaration` → `HMRCFuelDutyReturn` → `Supplier` → `APPurchaseOrder` → `APInvoice` → `APInvoiceLineItem` → `AccountingIntegrationConfig` → `AccountingSyncRecord` → `ChargeableItem.cost_centre` (additive field) → `Invoice.billing_contact` (additive field).
4. Include `RunPython` steps for: default chart of accounts seed, member credit account seed.
5. `python manage.py migrate`

---

## 14. Implementation Order (numbered steps)

1. **Add `django-fernet-fields`, `celery[redis]`, `weasyprint`, `python-dateutil` to `requirements.txt`.** Run `pip install -r requirements.txt`.

2. **Add Marina fields** (`hmrc_fuel_duty_enabled`, `dd_retry_days`, `base_currency`) to `accounts/models.py`. Run migration.

3. **Add `red_diesel` to `FuelDockEntry.FUEL_TYPE_CHOICES`** in `fuel_dock/models.py`. Run migration.

4. **Create `CostCentre` model** in `billing/models.py`. Run migration.

5. **Create `Account` and `CostCentreBudget` models** in `billing/models.py`. Run migration.

6. **Create `JournalEntry` and `JournalEntryLine` models** in `billing/models.py`. Include `CheckConstraint` and `clean()`. Run migration.

7. **Create `Currency` and `ExchangeRate` models**. Run migration.

8. **Create `MemberCreditAccount` and `MemberCreditTransaction` models**. Include `RunPython` data migration to seed one `MemberCreditAccount` per existing member. Run migration.

9. **Create `SurchargeRule` model**. Run migration.

10. **Create `PaymentPlan` and `PaymentPlanInstalment` models**. Run migration.

11. **Create `DeferredRevenueEntry` and `DeferredRevenueRecognitionLog` models**. Run migration.

12. **Create `FuelDutyRate`, `RedDieselSaleDeclaration`, `HMRCFuelDutyReturn` models**. Run migration.

13. **Create `Supplier`, `APPurchaseOrder`, `APInvoice`, `APInvoiceLineItem` models**. Run migration.

14. **Create `AccountingIntegrationConfig` and `AccountingSyncRecord` models**. Run migration.

15. **Add `cost_centre` FK to `ChargeableItem`** (nullable). Add `billing_contact` FK to `Invoice` (nullable). Run migration.

16. **Seed default chart of accounts** via `RunPython` in billing migration (or as a management command `python manage.py seed_chart_of_accounts`).

17. **Create `billing/services/` package** with files: `gl_posting.py`, `deferred_revenue.py`, `payment_plans.py`, `credit.py`. Implement all service functions. Write unit tests first (TDD): `billing/tests/test_gl_posting.py`, `billing/tests/test_deferred_revenue.py`, `billing/tests/test_payment_plans.py`.

18. **Create `billing/integrations/` package** — `base.py` with `AccountingAdapter` ABC. `xero.py` full implementation. `netsuite.py`, `dynamics365.py`, `sage_intacct.py`, `myob.py` as stubs raising `NotImplementedError`.

19. **Create `config/celery.py`** and update `config/__init__.py`. Add Celery Beat schedule to `config/settings/base.py`.

20. **Create `billing/tasks.py`** — implement all 5 tasks: `instalment_processor`, `deferred_revenue_recogniser`, `hmrc_duty_period_aggregator`, `fx_rate_updater`, `accounting_sync_push`, `credit_auto_deduct`.

21. **Wire signals** in `billing/signals.py` — `post_invoice_to_gl`, `post_payment_to_gl`, `handle_booking_cancellation`. Register in `billing/apps.py` `ready()`.

22. **Create serializers** in `billing/serializers.py` — one serializer per new model. `PaymentPlanCreateSerializer` accepts nested `instalments[]`. `JournalEntrySerializer` includes nested `lines[]`.

23. **Create ViewSets and views** — implement all endpoints in §9. Add to `billing/urls.py` using `DefaultRouter` for ViewSets.

24. **Create report views** — balance sheet, P&L, cash flow, cash forecast, deferred revenue schedule, cost centre P&L. Wire `?format=pdf` to WeasyPrint renderer. Add WeasyPrint HTML templates under `billing/templates/billing/reports/`.

25. **Add portal credit top-up endpoint** — `POST /api/v1/portal/credit/top-up/` in `portal/views.py` using existing Stripe integration pattern.

26. **Register all new models in `billing/admin.py`**. Ensure `AccountingIntegrationConfig` excludes `credentials` from display.

27. **Integration tests** — end-to-end: create seasonal booking → auto-create `DeferredRevenueEntry` → run `deferred_revenue_recogniser` task → verify GL balance → mock Xero adapter push → verify `AccountingSyncRecord(status='ok')`. Also test: cancel booking in month 6 → verify `adjust_deferred_entry` zeroes remaining deferred amount → recogniser posts zero in subsequent months.

28. **Frontend** — (separate developer or branch) implement `Finance` sidebar group with all screens per spec §5. Start with `PaymentPlansScreen`, then `DeferredRevenueScreen`, then `APInvoiceScreen`, then reports.

29. **NetSuite adapter** — second integration, after Xero is battle-tested in staging. Follow `AccountingAdapter` pattern exactly.
