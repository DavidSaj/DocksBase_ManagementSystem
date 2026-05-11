# Track 4 — Financial Accounting: Installation Guide

## 1. Python packages

Add the following to `requirements.txt` (or `requirements/base.txt` if split):

```
django-fernet-fields>=0.6
celery[redis]>=5.3
redis>=5.0
weasyprint>=60.0
python-dateutil>=2.8
requests>=2.31
```

Then install:

```bash
pip install -r requirements.txt
```

---

## 2. Django settings — `config/settings/base.py`

### 2a. Add to INSTALLED_APPS

Add `apps.accounting` to `LOCAL_APPS` (or directly to `INSTALLED_APPS`):

```python
LOCAL_APPS = [
    # ... existing apps ...
    'apps.accounting',
    'fernet_fields',   # django-fernet-fields for EncryptedJSONField
]
```

### 2b. Fernet encryption key

```python
# Required by django-fernet-fields (AccountingIntegrationConfig.credentials)
# Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
FERNET_KEYS = [os.environ.get('FERNET_KEY', '')]
```

### 2c. Celery configuration

```python
from celery.schedules import crontab

CELERY_BROKER_URL    = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
CELERY_RESULT_BACKEND = os.environ.get('REDIS_URL', 'redis://localhost:6379/0')
CELERY_TIMEZONE      = 'UTC'

CELERY_BEAT_SCHEDULE = {
    'instalment-processor': {
        'task': 'apps.accounting.tasks.instalment_processor',
        'schedule': crontab(hour=0, minute=30),
    },
    'deferred-revenue-recogniser': {
        'task': 'apps.accounting.tasks.deferred_revenue_recogniser',
        'schedule': crontab(hour=1, minute=0),
    },
    'hmrc-duty-aggregator': {
        'task': 'apps.accounting.tasks.hmrc_duty_period_aggregator',
        'schedule': crontab(hour=2, minute=0, day_of_month='31,30,29,28', month_of_year='3,6,9,12'),
    },
    'fx-rate-updater': {
        'task': 'apps.accounting.tasks.fx_rate_updater',
        'schedule': crontab(hour=6, minute=0),
    },
    'accounting-sync-push': {
        'task': 'apps.accounting.tasks.accounting_sync_push',
        'schedule': crontab(minute='*/15'),
    },
}
```

### 2d. Additional marina settings

```python
DEFAULT_BASE_CURRENCY = os.environ.get('DEFAULT_BASE_CURRENCY', 'EUR')
DD_RETRY_DAYS_DEFAULT = 3
```

---

## 3. Celery application — `config/celery.py` (NEW FILE)

Create `backend/config/celery.py`:

```python
import os
from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.dev')
app = Celery('docksbase')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()
```

Then update `backend/config/__init__.py`:

```python
from .celery import app as celery_app
__all__ = ('celery_app',)
```

---

## 4. URL wiring — `config/urls.py`

Add the following `include` to `config/urls.py`:

```python
from django.urls import path, include

urlpatterns = [
    # ... existing patterns ...
    path('api/v1/', include('apps.accounting.urls')),
]
```

This single include registers all accounting endpoints under `api/v1/`:
- `api/v1/billing/accounts/`
- `api/v1/billing/journal-entries/`
- `api/v1/billing/cost-centres/`
- `api/v1/billing/payment-plans/`
- `api/v1/billing/instalments/`
- `api/v1/billing/credit-accounts/`
- `api/v1/billing/surcharge-rules/`
- `api/v1/billing/fuel-duty-rates/`
- `api/v1/billing/hmrc-returns/`
- `api/v1/billing/deferred-revenue/`
- `api/v1/billing/suppliers/`
- `api/v1/billing/purchase-orders/`
- `api/v1/billing/ap-invoices/`
- `api/v1/billing/accounting-configs/`
- `api/v1/billing/currencies/`
- `api/v1/billing/exchange-rates/`
- `api/v1/fuel-dock/entries/<id>/red-diesel-declaration/`
- `api/v1/reports/balance-sheet/`
- `api/v1/reports/profit-and-loss/`
- `api/v1/reports/cash-flow/`
- `api/v1/reports/cash-forecast/`
- `api/v1/reports/deferred-revenue/`
- `api/v1/reports/cost-centre-pl/`

---

## 5. Marina model additions — `apps/accounts/models.py`

Add the following fields to the existing `Marina` model:

```python
# Accounting — Track 4
hmrc_fuel_duty_enabled = models.BooleanField(default=False)
dd_retry_days          = models.PositiveIntegerField(default=3)
base_currency          = models.CharField(max_length=3, default='EUR')
```

Then run:
```bash
python manage.py makemigrations accounts
```

---

## 6. FuelDockEntry red diesel — `apps/fuel_dock/models.py`

Add `'red_diesel'` to `FuelDockEntry.FUEL_TYPE_CHOICES`:

```python
FUEL_TYPE_CHOICES = [
    ('diesel',     'Diesel'),
    ('petrol',     'Petrol'),
    ('pump_out',   'Pump-out'),
    ('red_diesel', 'Red Diesel'),   # ADD THIS
]
```

Then run:
```bash
python manage.py makemigrations fuel_dock
```

---

## 7. ChargeableItem addition — `apps/billing/models.py`

Add `cost_centre` FK to `ChargeableItem`:

```python
cost_centre = models.ForeignKey(
    'accounting.CostCentre', null=True, blank=True, on_delete=models.SET_NULL,
    related_name='chargeable_items',
)
```

---

## 8. Invoice addition — `apps/billing/models.py`

Add `billing_contact` FK to `Invoice`:

```python
billing_contact = models.ForeignKey(
    'members.SecondaryContact', on_delete=models.SET_NULL,
    null=True, blank=True, related_name='billed_invoices',
    help_text="When set, invoice PDF uses this contact's details in the Bill To block.",
)
```

---

## 9. Migrations

Run in this order:

```bash
# 1. accounts — new Marina fields
python manage.py makemigrations accounts

# 2. fuel_dock — red_diesel choice
python manage.py makemigrations fuel_dock

# 3. accounting — all new models
python manage.py makemigrations accounting

# 4. billing — ChargeableItem.cost_centre FK + Invoice.billing_contact FK
python manage.py makemigrations billing

# 5. Apply all
python manage.py migrate
```

---

## 10. Prerequisite migrations from other apps

The `apps.accounting` migrations depend on:
- `accounts` (Marina FK)
- `members` (Member FK)
- `billing` (Invoice, Payment, ChargeableItem FKs)
- `staff` (StaffMember FK)
- `fuel_dock` (FuelDockEntry FK)
- `reservations` (Booking FK)

Ensure all existing migrations are applied before running `accounting` migrations.

---

## 11. Environment variables required

| Variable       | Description                                          | Example                      |
|----------------|------------------------------------------------------|------------------------------|
| `FERNET_KEY`   | Secret key for EncryptedJSONField                    | (output of Fernet.generate_key()) |
| `REDIS_URL`    | Redis connection URL for Celery broker/backend       | `redis://localhost:6379/0`   |
| `DEFAULT_BASE_CURRENCY` | ISO 4217 default currency code             | `EUR`                        |

---

## 12. Seeding default Chart of Accounts

After migrations, seed default accounts for existing marinas:

```python
# Run in Django shell or as a management command
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

from apps.accounts.models import Marina
from apps.accounting.models import Account

for marina in Marina.objects.all():
    for code, name, account_type in DEFAULT_ACCOUNTS:
        Account.objects.get_or_create(
            marina=marina, code=code,
            defaults={'name': name, 'account_type': account_type},
        )
```

Also seed one `MemberCreditAccount` per existing member:

```python
from apps.members.models import Member
from apps.accounting.models import MemberCreditAccount

for member in Member.objects.all():
    MemberCreditAccount.objects.get_or_create(
        marina=member.marina, member=member,
        defaults={'balance': 0, 'auto_deduct': False},
    )
```
